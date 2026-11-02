import type { Unresolved } from "@mmlce/audio/browser";
import { positionToSeconds, rat, secondsToWhole, ZERO, type Rat, type Song, type TempoEvent } from "@mmlce/core";
import type { Engine } from "./engine";
import { countIn, Metronome } from "./midiRecord";

const asRat = (time: number) => rat(Math.round(time * 960), 960);
const toWhole = (r: Rat) => r.n / r.d;

/** 재생 중 고친 것을 이어 붙이는 가장 짧은 간격(밀리초). 드래그 중에도 이보다 자주 일정을 다시 만들지 않는다 */
const FOLLOW_MS = 120;

/** 재생 하나의 덧붙임 */
export interface PlayOptions {
  /** MIDI 건반 녹음: 한 마디 예비박만큼 비우고 시작하고, 곡이 끝나도 정지할 때까지 돈다. 딸깍은 녹음이 따로 울린다 */
  readonly record?: boolean;
  /** 시작 앞 한 마디 예비박 (딸깍) */
  readonly countIn?: boolean;
  /** 메트로놈을 울리지 않는다 (고친 자리 짧게 듣기) */
  readonly noClicks?: boolean;
}

/**
 * 재생 상태: 엔진으로 재생을 시작·정지하고, 화면 갱신 루프로 지금 위치를 따라간다.
 * 재생을 새로 시작하거나 멈추면 이전 화면 갱신 루프는 세대 번호로 스스로 끝난다.
 */
export class Playback {
  playing = $state(false);
  /** 이번 재생을 시작한 곡 시각(초) */
  from = $state(0);
  /** 시작 뒤 흐른 시간(초) */
  position = $state(0);
  /** 사운드팩에서 못 찾은 악기 */
  unresolved = $state.raw<Unresolved[]>([]);
  /** 재생을 새로 시작할 때마다 하나씩 는다 (자리를 옮겨 다시 재생했는지 알아보는 데 쓴다) */
  runs = $state(0);
  /** 이번 재생 속도 (1 = 원래). 배경 영상도 이 속도로 돈다 */
  rate = $state(1);
  /** 이번 재생에 쓴 템포 지도 (재생 중에 곡 템포를 바꿔도 소리는 이 템포로 난다. 탭 템포가 쓴다) */
  tempo: readonly TempoEvent[] = [];
  private generation = 0;
  /** 지금 소리 내는 곡 (재생 중에 고친 것을 이어 붙이면 그 곡). 녹음·짧게 듣기면 undefined (고친 것을 따라가지 않는다) */
  private heard: Song | undefined;
  /** 재생 중 고친 것 바로 듣기: 기다리는 곡과 반복 구간, 이어 붙이는 중인지 */
  private follow: { song: Song | undefined; loop: readonly [number, number] | undefined; timer: ReturnType<typeof setTimeout> | undefined; busy: number | undefined } = {
    song: undefined,
    loop: undefined,
    timer: undefined,
    /** 엔진에 넣는 중인 재생의 세대. 앞 재생의 넣기가 늦게 끝나도 새 재생의 바로 듣기를 막지 않게 세대로 둔다 */
    busy: undefined,
  };
  /** 준비 중(아직 소리 나기 전)인 재생 요청. 그사이 속도를 바꾸면 이것을 새 속도로 다시 요청한다 */
  pending: { song: Song; start: number | undefined; loop: readonly [number, number] | undefined; rate: number; options: PlayOptions } | undefined;
  /** 일반 재생 메트로놈 (녹음 메트로놈은 녹음 쪽에 따로 있다) */
  private readonly metronome: Metronome;
  /** 메트로놈을 켰는지 (설정은 playPrefs가 기억하고, 여기는 앱이 넣어 준다) */
  private clicking = false;
  /** 지금 재생의 메트로놈 자리. 녹음·짧게 듣기면 없다 (재생 중에 메트로놈을 켜면 여기서 시작한다) */
  private clickRun: { song: Song; from: Rat; loop: number | undefined } | undefined;

  constructor(private readonly engine: Engine) {
    this.metronome = new Metronome(engine.runClock);
    engine.onEnd = () => {
      this.playing = false;
      // 곡 끝 뒤로 앞서 예약해 둔 딸깍도 끈다
      this.metronome.end();
      this.engine.clearClicks();
      this.clickRun = undefined;
    };
  }

  /** 메트로놈 켜기·끄기. 재생 중이면 바로 지금 자리부터 울리거나 남은 딸깍을 끈다 */
  setMetronome(on: boolean): void {
    if (this.clicking === on) return;
    this.clicking = on;
    if (!on) {
      this.metronome.end();
      // 녹음 중이면(clickRun 없음) 녹음 쪽 메트로놈의 딸깍은 그대로 둔다
      if (this.clickRun) this.engine.clearClicks();
      return;
    }
    const run = this.clickRun;
    if (run && this.engine.playing) this.metronome.begin({ ...run, countIn: false, beats: true });
  }

  /** 지금 곡 시각(초) */
  get seconds(): number {
    return this.from + this.position;
  }

  /** 지금 들리는 곡 시각(초)을 화면 갱신을 기다리지 않고 바로 잰다 (탭 템포). 멈춰 있으면 undefined */
  now(): number | undefined {
    return this.playing ? this.from + this.engine.position : undefined;
  }

  /** 지금 재생 위치(온음표 단위). 멈춰 있으면 undefined */
  playhead(song: Song | undefined): number | undefined {
    return this.playing && song ? secondsToWhole(song.tempo, this.seconds) : undefined;
  }

  /**
   * start(온음표, 없으면 처음)부터 재생. loop가 있으면 그 구간을 끊김 없이 되풀이한다.
   * rate: 재생 속도 (탭 템포를 느리게 찍을 때). 위치·탭 시각은 늘 곡 시간(초)으로 잰다.
   * at: 반복 구간이 있을 때 이 곡 시각(초)이 구간 안이면 처음이 아니라 거기서부터 이어 재생한다 (속도 바꾸기).
   * options: 녹음·예비박·메트로놈 끄기 (PlayOptions). 메트로놈은 setMetronome으로 켠 동안 울린다
   */
  async play(song: Song, start: number | undefined, loop: readonly [number, number] | undefined, rate = 1, at?: number, options: PlayOptions = {}): Promise<boolean> {
    const generation = ++this.generation;
    this.clearFollow();
    this.pending = { song, start, loop, rate, options };
    // 앞 재생의 박은 더 예약하지 않는다 (이미 예약한 것은 엔진이 새 재생을 시작할 때 끈다)
    this.metronome.end();
    this.clickRun = undefined;
    const begin = loop ? loop[0] : start;
    const from = begin !== undefined && begin > 0 ? asRat(begin) : undefined;
    const fromSeconds = from ? positionToSeconds(song.tempo, from) : 0;
    const loopSeconds = loop ? positionToSeconds(song.tempo, asRat(loop[1])) - fromSeconds : undefined;
    const offset = loopSeconds && at !== undefined && at > fromSeconds && at < fromSeconds + loopSeconds ? at - fromSeconds : 0;
    // 예비박 한 마디만큼 비우고 시작한다. 반복 구간 가운데서 이어 재생하면(offset) 예비박을 두지 않는다
    const counting = options.record || (options.countIn && offset === 0);
    const lead = counting ? { leadIn: countIn(song, from ?? ZERO).seconds / rate, endless: !!options.record } : undefined;
    const result = await this.engine.play(song, from, loopSeconds && loopSeconds > 0 ? loopSeconds : undefined, rate, offset, lead);
    if (generation !== this.generation) return false;
    this.pending = undefined;
    this.heard = options.record || options.noClicks ? undefined : song;
    this.unresolved = result;
    this.from = fromSeconds;
    this.tempo = song.tempo;
    this.rate = rate;
    this.position = 0;
    this.playing = true;
    this.runs++;
    if (!options.record && !options.noClicks && this.engine.playing) {
      const run = { song, from: from ?? ZERO, loop: loopSeconds && loopSeconds > 0 ? loopSeconds : undefined };
      this.clickRun = run;
      if (this.clicking || counting) this.metronome.begin({ ...run, countIn: !!counting, beats: this.clicking });
    }
    const frame = () => {
      if (generation !== this.generation) return;
      this.position = this.engine.position;
      if (this.engine.playing) requestAnimationFrame(frame);
      else this.playing = false;
    };
    requestAnimationFrame(frame);
    return this.engine.playing;
  }

  /**
   * 실험실 "재생 중 고친 것 바로 듣기": 재생 중에 곡이 바뀌면 멈추지 않고 이어 붙인다 (Engine.update). 드래그처럼
   * 잇달아 바뀌면 FOLLOW_MS에 한 번만, 하나씩 차례로 한다. 템포·트랙 구성이 바뀌었으면 지금 들리는 자리(박자 기준)부터 다시 재생한다.
   * loop: 지금 반복 구간 (다시 재생할 때 쓴다)
   */
  followEdit(song: Song, loop: readonly [number, number] | undefined): void {
    if (!this.playing || !this.heard) return;
    // 되돌리기로 들리는 곡과 같아져도 기다리는 곡을 바꿔 둔다 (안 그러면 120ms 뒤 되돌린 편집을 다시 들려준다)
    this.follow.song = song;
    this.follow.loop = loop;
    // 템포 등이 바뀌어 다시 재생을 준비하는 중이면 그 곡과 견준다 (준비 중에 되돌리면 준비가 끝난 뒤 되돌린 곡을 넣는다)
    if (song === (this.pending?.song ?? this.heard)) return;
    if (this.follow.timer === undefined && this.follow.busy !== this.generation) this.follow.timer = setTimeout(() => void this.applyFollow(), FOLLOW_MS);
  }

  private async applyFollow(): Promise<void> {
    this.follow.timer = undefined;
    const generation = this.generation;
    const { song, loop } = this.follow;
    if (!song || !this.playing || !this.heard || song === this.heard) return;
    // 다시 재생을 준비하는 중이면 끝난 뒤에 한다
    if (this.pending) {
      this.follow.timer = setTimeout(() => void this.applyFollow(), FOLLOW_MS);
      return;
    }
    this.follow.busy = generation;
    try {
      const done = await this.engine.update(song);
      if (generation !== this.generation) return;
      if (done.result === "live") {
        this.heard = song;
        this.unresolved = done.unresolved;
      } else if (done.result === "restart") {
        const seconds = this.now();
        if (seconds === undefined) return;
        // 박자 자리를 지켜 바뀐 템포로 다시 잰다
        const whole = asRat(secondsToWhole(this.tempo, seconds));
        void this.play(song, toWhole(whole), loop, this.rate, positionToSeconds(song.tempo, whole), {});
        return;
      }
    } finally {
      if (this.follow.busy === generation) this.follow.busy = undefined;
    }
    if (generation === this.generation && this.follow.song !== this.heard && this.follow.timer === undefined) {
      this.follow.timer = setTimeout(() => void this.applyFollow(), FOLLOW_MS);
    }
  }

  /** 새 재생·정지 때 앞 재생에서 기다리던 바로 듣기를 버린다 (앞 재생의 곡을 새 재생에 덮지 않게) */
  private clearFollow(): void {
    if (this.follow.timer !== undefined) clearTimeout(this.follow.timer);
    this.follow.timer = undefined;
    this.follow.song = undefined;
    this.follow.loop = undefined;
  }

  stop(): void {
    this.generation++;
    this.clearFollow();
    this.pending = undefined;
    this.metronome.end();
    this.clickRun = undefined;
    this.engine.stop();
    this.playing = false;
    this.position = 0;
    this.from = 0;
    this.rate = 1;
  }
}
