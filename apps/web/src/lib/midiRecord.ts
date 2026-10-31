import { add, div, gridLines, meterAt, meterGrid, mul, positionToSeconds, rat, secondsToWhole, toFloat, type Rat, type Song } from "@mmlce/core";

/**
 * MIDI 건반 녹음(실험실): 곡을 들으며 친 건반을 격자에 맞춰 음으로 넣는다.
 * 친 시각은 곡 위치(온음표 단위, 실수)로 받아, 여기서 격자에 맞춘 분수로 바꾼다 (정수 tick으로 반올림하지 않는다).
 */

/** 녹음한 건반 하나 (곡 위치, 온음표 단위) */
export interface TakeKey {
  readonly pitch: number;
  readonly velocity: number;
  readonly on: number;
  readonly off: number;
}

/** 격자에 맞춘 음 */
export interface TakeNote {
  readonly pitch: number;
  readonly velocity: number;
  readonly start: Rat;
  readonly dur: Rat;
}

/**
 * 격자에 맞춘다. 시작·끝을 가장 가까운 격자 칸으로 옮기고, 녹음 시작(from) 앞이면 from으로 당긴다.
 * 너무 짧아 시작과 끝이 같은 칸이 되면 한 칸 길이로 둔다. 같은 높이 음이 겹치면 앞 음을 뒤 음 시작에서 끊는다
 * (게임은 한 트랙에 한 음이라, 같은 높이를 다시 친 것은 다시 친 음으로 본다)
 */
export function quantizeTake(keys: readonly TakeKey[], grid: Rat, from: Rat): TakeNote[] {
  const g = toFloat(grid);
  const f = toFloat(from);
  const cell = (x: number) => Math.max(0, Math.round((x - f) / g));
  const raw = keys
    .map((k) => {
      const a = cell(k.on);
      const b = Math.max(a + 1, cell(k.off));
      return { pitch: k.pitch, velocity: k.velocity, a, b };
    })
    .sort((x, y) => x.a - y.a || y.pitch - x.pitch);
  // 같은 높이: 앞 음을 뒤 음 시작에서 끊고, 같은 칸에서 시작한 같은 높이는 하나만 둔다
  const out: { pitch: number; velocity: number; a: number; b: number }[] = [];
  for (const n of raw) {
    const prev = out.filter((o) => o.pitch === n.pitch).at(-1);
    if (prev && prev.a === n.a) {
      prev.b = Math.max(prev.b, n.b);
      prev.velocity = Math.max(prev.velocity, n.velocity);
      continue;
    }
    if (prev && prev.b > n.a) prev.b = n.a;
    out.push({ ...n });
  }
  return out.map((n) => ({ pitch: n.pitch, velocity: n.velocity, start: add(from, mul(grid, rat(n.a))), dur: mul(grid, rat(n.b - n.a)) }));
}

/** 메트로놈 딸깍 하나: 곡 시각(초), 마디 첫 박이면 accent */
export interface Click {
  readonly at: number;
  readonly accent: boolean;
}

/** 화면 위치(실수) → 곡 초. 격자선 위치는 박자표 칸이라 1/3840 칸으로 충분하다 */
const secondsAt = (song: Song, at: number) => positionToSeconds(song.tempo, rat(Math.round(at * 3840), 3840));

/**
 * 예비박: 시작 자리(from) 앞 한 마디의 박. 박 길이는 from의 템포·박자로 잰다.
 * seconds는 그 마디 길이(곡 초). 재생 속도가 느리면 오디오에서는 그만큼 길어진다.
 * from이 박 가운데(일시정지한 자리 등)면 딸깍을 곡의 박 자리에 맞춰 당긴다. 그래야 예비박과 이어지는 곡 박이 엇박이 되지 않는다
 * (녹음은 마디 시작에서 하므로 그대로)
 */
export function countIn(song: Song, from: Rat): { clicks: Click[]; seconds: number } {
  const { beat, measure } = meterGrid(meterAt(song.timeSig, from));
  const base = positionToSeconds(song.tempo, from);
  const beatSeconds = positionToSeconds(song.tempo, add(from, beat)) - base;
  const beats = Math.max(1, Math.round(toFloat(div(measure, beat))));
  // 마지막 딸깍: from 바로 앞(같은 자리는 빼고)의 박. from이 박 위면 한 박 앞
  const f = toFloat(from);
  const before = beatClicks(song, Math.max(0, f - toFloat(beat)), f + 1e-9).at(-1);
  const gap = before && base - before.at > 1e-6 ? Math.min(beatSeconds, base - before.at) : beatSeconds;
  const clicks = Array.from({ length: beats }, (_, k) => ({ at: base - gap - (beats - 1 - k) * beatSeconds, accent: k === 0 }));
  return { clicks, seconds: beats * beatSeconds };
}

/** [from, to) 위치(온음표, 실수)의 박마다 딸깍. 마디 첫 박은 accent */
export function beatClicks(song: Song, from: number, to: number): Click[] {
  return gridLines(song.timeSig, from, to)
    .filter((l) => l.kind !== "unit")
    .map((l) => ({ at: secondsAt(song, l.at), accent: l.kind === "measure" }));
}

/**
 * 재생 시작 뒤 [a, b) 시각의 박 딸깍. 시각은 시작 자리(from)부터 흐른 곡 시간(초)이고,
 * 반복(loop, 곡 초)이면 회차마다 이어 센다 (2회차 첫 박 = loop). 시작 앞(음수)에는 박이 없다 (예비박은 countIn)
 */
export function runClicks(song: Song, from: Rat, loop: number | undefined, a: number, b: number): Click[] {
  const base = positionToSeconds(song.tempo, from);
  // 한 회차 안의 [lo, hi) (시작 자리부터 곡 초). 칸 경계에 걸친 박이 앞뒤 두 칸에 다 들거나 빠지지 않게 같은 기준으로 자른다
  const span = (lo: number, hi: number, shift: number) =>
    beatClicks(song, secondsToWhole(song.tempo, base + lo), secondsToWhole(song.tempo, base + hi) + 1e-9)
      .map((c) => ({ at: c.at - base, accent: c.accent }))
      .filter((c) => c.at >= lo - 1e-6 && c.at < hi - 1e-6)
      .map((c) => ({ at: c.at + shift, accent: c.accent }));
  const lo = Math.max(0, a);
  if (!(b > lo)) return [];
  if (loop === undefined || !(loop > 0)) return span(lo, b, 0);
  const out: Click[] = [];
  for (let k = Math.floor(lo / loop); k * loop < b; k++) {
    const from = Math.max(lo, k * loop) - k * loop;
    const to = Math.min(b, (k + 1) * loop) - k * loop;
    if (to > from) out.push(...span(from, to, k * loop));
  }
  return out;
}

/** 메트로놈이 쓰는 재생 시계. 시각은 이번 재생 시작 자리부터 흐른 곡 시간(초)이고, 반복해도 처음으로 돌아가지 않고 계속 는다 */
export interface MetronomeClock {
  /** 지금 들리는 시각. 예비박 동안은 음수. 재생 중이 아니면 undefined */
  heard(): number | undefined;
  /** 이 시각에 딸깍 (이미 지난 시각이면 엔진이 버린다) */
  click(at: number, accent: boolean): void;
}

/** 메트로놈을 울릴 재생 하나 */
export interface MetronomeRun {
  readonly song: Song;
  /** 재생 시작 자리 (반복이면 구간 시작) */
  readonly from: Rat;
  /** 반복 길이(곡 초). 있으면 이 길이마다 시작 자리로 돌아간다 */
  readonly loop?: number | undefined;
  /** 시작 앞 한 마디 예비박 */
  readonly countIn: boolean;
  /** 박마다 딸깍 (끄면 예비박만) */
  readonly beats: boolean;
}

/** 메트로놈을 이만큼(곡 초) 앞서 예약한다 */
const CLICK_AHEAD = 1.5;
const TICK_MS = 100;

/**
 * 메트로놈: 재생에 맞춰 박마다 딸깍(마디 첫 박은 높게)을 조금씩 앞서 예약한다. 예비박도 여기서 넣는다.
 * MIDI 건반 녹음과 일반 재생이 함께 쓴다
 */
export class Metronome {
  private run: MetronomeRun | undefined;
  /** 박을 예약해 둔 곳까지 (시작 뒤 곡 초) */
  private clickedTo = 0;
  /** 마지막으로 예약한 박 (칸 경계에서 같은 박을 두 번 넣지 않으려고) */
  private last = -Infinity;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly clock: MetronomeClock) {}

  /** 박을 울리는 중인지 (예비박만 넣었으면 아니다) */
  get running(): boolean {
    return this.timer !== undefined;
  }

  /** 재생이 시작된 뒤 부른다. 재생 중에 켜면 지금 들리는 자리부터 울린다 */
  begin(run: MetronomeRun): void {
    this.end();
    const base = positionToSeconds(run.song.tempo, run.from);
    if (run.countIn) for (const c of countIn(run.song, run.from).clicks) this.clock.click(c.at - base, c.accent);
    if (!run.beats) return;
    this.run = run;
    this.clickedTo = Math.max(0, this.clock.heard() ?? 0);
    this.last = -Infinity;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** 지금 + 조금 앞까지의 박을 예약한다. 보통 타이머가 부르고, 시험에서는 직접 부른다 */
  tick(): void {
    const run = this.run;
    if (!run) return;
    const heard = this.clock.heard();
    if (heard === undefined) return;
    const to = Math.max(0, heard) + CLICK_AHEAD;
    if (to <= this.clickedTo) return;
    for (const c of runClicks(run.song, run.from, run.loop, this.clickedTo, to)) {
      if (c.at <= this.last + 1e-6) continue;
      this.clock.click(c.at, c.accent);
      this.last = c.at;
    }
    this.clickedTo = to;
  }

  /** 더 예약하지 않는다 (이미 예약한 딸깍은 엔진이 정지할 때 끈다) */
  end(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.run = undefined;
  }
}

/** 녹음에 쓰는 재생 쪽 기능 (엔진) */
export interface RecordClock {
  /** 지금 들리는 곡 시각(초). 예비박 동안은 시작 자리보다 앞. 재생 중이 아니면 undefined */
  heardSeconds(): number | undefined;
  /** 곡 시각(초)에 메트로놈 딸깍 */
  click(songSeconds: number, accent: boolean): void;
}

/** 녹음 중 화면에 보일 것 */
export interface RecordStatus {
  readonly from: Rat;
  readonly count: number;
  /** 재생 번호 (다른 재생이 시작되면 녹음을 끝낸다) */
  readonly run: number;
}

interface Session {
  readonly song: Song;
  readonly from: Rat;
  /** 재생 번호 (다른 재생이 시작되면 녹음을 끝낸다) */
  readonly run: number;
  /** 마지막으로 잰 곡 시각(초). 정지 뒤 누르고 있던 건반의 끝으로 쓴다 */
  now: number;
  /** 재생이 멈춘 순간(cut). 그 뒤 시계는 다른 재생이거나 없으므로 건반·시각을 더 받지 않는다 */
  cut: boolean;
  readonly keys: { pitch: number; velocity: number; on: number; off: number }[];
  readonly held: Map<number, { velocity: number; on: number }>;
}

/**
 * MIDI 건반 녹음 (실험실). 곡을 재생하며 누른 건반의 시각을 곡 초로 모으고, 끝낼 때 곡 위치(온음표)로 바꿔 돌려준다.
 * 격자 맞추기는 quantizeTake, 트랙 나누기는 recordPlan.ts가 한다
 */
export class MidiRecorder {
  /** 녹음 중이면 시작 자리와 모은 음 수 */
  status: RecordStatus | undefined;
  /** status가 바뀔 때 (화면에 보이려고) */
  onstatus: ((status: RecordStatus | undefined) => void) | undefined;
  /** 녹음 중 모은 건반이 바뀌거나 누르고 있는 건반이 길어질 때 (치는 대로 화면에 보이려고) */
  onlive: (() => void) | undefined;
  private session: Session | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** 녹음 메트로놈. 시각은 녹음 시작 자리부터 흐른 곡 초 (녹음은 반복하지 않는다) */
  private readonly metronome: Metronome;
  private fromSeconds = 0;

  constructor(private readonly clock: RecordClock) {
    this.metronome = new Metronome({
      heard: () => {
        const heard = this.session?.cut ? undefined : clock.heardSeconds();
        return heard === undefined ? undefined : heard - this.fromSeconds;
      },
      click: (at, accent) => clock.click(this.fromSeconds + at, accent),
    });
  }

  private setStatus(status: RecordStatus | undefined): void {
    this.status = status;
    this.onstatus?.(status);
  }

  get recording(): boolean {
    return this.session !== undefined;
  }

  /** 재생이 시작된 뒤 부른다: 예비박을 예약하고 건반을 모으기 시작한다 */
  begin(song: Song, from: Rat, run: number, metronome: boolean): void {
    this.end();
    const fromSeconds = positionToSeconds(song.tempo, from);
    this.session = { song, from, run, now: fromSeconds, cut: false, keys: [], held: new Map() };
    this.fromSeconds = fromSeconds;
    if (metronome) this.metronome.begin({ song, from, countIn: true, beats: true });
    this.setStatus({ from, count: 0, run });
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const s = this.session;
    if (!s || s.cut) return;
    const heard = this.clock.heardSeconds();
    if (heard === undefined) return;
    s.now = Math.max(s.now, heard);
    if (s.held.size > 0) this.onlive?.();
  }

  keyOn(pitch: number, velocity: number): void {
    const s = this.session;
    const at = this.clock.heardSeconds();
    if (!s || s.cut || at === undefined) return;
    s.now = Math.max(s.now, at);
    this.release(s, pitch, at);
    s.held.set(pitch, { velocity, on: at });
    this.onlive?.();
  }

  keyOff(pitch: number): void {
    const s = this.session;
    if (!s || s.cut) return;
    const at = this.clock.heardSeconds() ?? s.now;
    this.release(s, pitch, at);
  }

  /**
   * 재생이 멈추는(또는 다른 재생으로 바뀌는) 바로 그 순간 들리던 곡 시각(초)을 받는다 (엔진이 멈추기 직전에 부른다).
   * 누르고 있던 건반은 이 시각에 뗀 것으로 보고, 그 뒤 건반·시각은 받지 않는다.
   * 마지막 주기 표본(최대 100ms 전)으로 닫으면 누른 채 멈춘 음이 격자 한 칸 짧아질 수 있어서
   */
  cut(heardSeconds: number): void {
    const s = this.session;
    if (!s || s.cut) return;
    s.now = Math.max(s.now, heardSeconds);
    for (const pitch of [...s.held.keys()]) this.release(s, pitch, s.now);
    s.cut = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.metronome.end();
  }

  private release(s: Session, pitch: number, at: number): void {
    const held = s.held.get(pitch);
    if (!held) return;
    s.held.delete(pitch);
    s.keys.push({ pitch, velocity: held.velocity, on: held.on, off: Math.max(held.on, at) });
    this.setStatus({ from: s.from, count: s.keys.length, run: s.run });
    this.onlive?.();
  }

  /**
   * 녹음 중 지금까지 친 건반 (곡 위치, 온음표). 누르고 있는 건반은 지금 들리는 시각(멈췄으면 멈춘 시각)까지로 본다.
   * 치는 동안 화면에 미리 보이는 데만 쓴다 (넣는 것은 end가 돌려준 것)
   */
  live(): { from: Rat; keys: TakeKey[] } | undefined {
    const s = this.session;
    if (!s) return undefined;
    const now = s.cut ? s.now : Math.max(s.now, this.clock.heardSeconds() ?? s.now);
    const whole = (sec: number) => secondsToWhole(s.song.tempo, Math.max(0, sec));
    const keys = [...s.keys, ...[...s.held].map(([pitch, h]) => ({ pitch, velocity: h.velocity, on: h.on, off: Math.max(h.on, now) }))];
    return { from: s.from, keys: keys.map((k) => ({ pitch: k.pitch, velocity: k.velocity, on: whole(k.on), off: whole(k.off) })) };
  }

  /**
   * 녹음을 끝내고 모은 건반을 곡 위치(온음표)로 돌려준다. 누르고 있던 건반은 멈춘 순간(cut), cut이 없었으면
   * 지금 들리는 시각, 그것도 없으면 마지막으로 잰 시각에 뗀 것으로 본다
   */
  end(): { song: Song; from: Rat; keys: TakeKey[] } | undefined {
    clearInterval(this.timer);
    this.timer = undefined;
    this.metronome.end();
    const s = this.session;
    this.session = undefined;
    if (!s) return undefined;
    if (!s.cut) s.now = Math.max(s.now, this.clock.heardSeconds() ?? s.now);
    for (const pitch of [...s.held.keys()]) this.release(s, pitch, s.now);
    this.setStatus(undefined);
    const whole = (sec: number) => secondsToWhole(s.song.tempo, Math.max(0, sec));
    return { song: s.song, from: s.from, keys: s.keys.map((k) => ({ pitch: k.pitch, velocity: k.velocity, on: whole(k.on), off: whole(k.off) })) };
  }
}

/** 녹음이 넣을 곳: 시작할 때의 곡 기록(owner)과 넣을 곳(target, 시작할 때 정한 녹음 트랙) */
export interface RecordJob<O, T = string> {
  readonly owner: O;
  readonly target: T;
}

/** 녹음 흐름이 앱에 바라는 것 */
export interface RecordHost<O, T = string> {
  /** 지금 곡 기록 (곡을 바꾸면 다른 것이 된다) */
  owner(): O | undefined;
  /** 녹음 줄이 열려 있고 실험실이 켜져 있는지 */
  open(): boolean;
  /** 예비박을 두고 재생을 시작한다. 시작했으면 그 재생 번호 */
  play(): Promise<number | undefined>;
  stop(): void;
  /** 건반을 녹음으로 보낼지 */
  capture(on: boolean): void;
  /** 모은 건반을 넣는다 (격자 맞추기·트랙 나누기·commit) */
  apply(take: { from: Rat; keys: TakeKey[] }, job: RecordJob<O, T>): void;
  /** 시작한 곡이 아니어서 넣지 않았다 */
  lost(): void;
}

/**
 * 녹음 시작·끝의 순서를 한곳에서 지킨다.
 * - 재생 준비를 기다리는 동안 닫기·실험실 끄기·곡 바꾸기·새 녹음이 오면(end) 요청 세대가 바뀌어, 준비가 끝나도 시작하지 않는다
 * - 녹음은 시작한 곡 기록(owner)에만 넣는다. 곡을 바꾸기 전에 end를 부르면 앞 곡에 넣고, 바뀐 뒤 끝나면 넣지 않는다
 */
export class RecordFlow<O, T = string> {
  private token = 0;
  private pending = false;
  private job: RecordJob<O, T> | undefined;

  constructor(
    private readonly recorder: MidiRecorder,
    private readonly host: RecordHost<O, T>,
  ) {}

  /** 준비 중이거나 녹음 중 */
  get busy(): boolean {
    return this.pending || this.recorder.recording;
  }

  async start(target: T, song: Song, from: Rat, metronome: boolean): Promise<boolean> {
    this.end();
    const owner = this.host.owner();
    if (owner === undefined) return false;
    const token = ++this.token;
    this.pending = true;
    // 재생을 기다리는 동안 누른 건반은 녹음 세션이 없어 버려진다
    this.host.capture(true);
    const run = await this.host.play();
    if (token !== this.token) return false;
    this.pending = false;
    if (run === undefined || !this.host.open() || this.host.owner() !== owner) {
      this.host.capture(false);
      if (run !== undefined) this.host.stop();
      return false;
    }
    this.job = { owner, target };
    this.recorder.begin(song, from, run, metronome);
    return true;
  }

  /** 지금 끝낸다: 준비 중이면 취소(재생도 멈춤), 녹음 중이면 멈추고 시작한 곡에 넣는다 */
  end(): void {
    this.token++;
    if (this.pending) {
      this.pending = false;
      this.host.capture(false);
      this.host.stop();
    }
    if (this.recorder.recording) {
      this.host.stop();
      this.finish();
    }
  }

  /** 재생이 멈췄거나 다른 재생으로 바뀌었다: 녹음을 넣는다. 녹음 중이 아니면 아무것도 하지 않는다 */
  finish(): void {
    if (!this.recorder.recording) return;
    this.host.capture(false);
    const take = this.recorder.end();
    const job = this.job;
    this.job = undefined;
    if (!take || !job) return;
    if (this.host.owner() !== job.owner) return this.host.lost();
    this.host.apply(take, job);
  }
}
