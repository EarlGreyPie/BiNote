import type { Unresolved } from "@mmlce/audio/browser";
import { positionToSeconds, rat, secondsToWhole, type Song } from "@mmlce/core";
import type { Engine } from "./engine";

const asRat = (time: number) => rat(Math.round(time * 960), 960);

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
  private generation = 0;

  constructor(private readonly engine: Engine) {
    engine.onEnd = () => (this.playing = false);
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

  /** start(온음표, 없으면 처음)부터 재생. loop가 있으면 그 구간을 끊김 없이 되풀이한다 */
  async play(song: Song, start: number | undefined, loop: readonly [number, number] | undefined): Promise<void> {
    const generation = ++this.generation;
    const begin = loop ? loop[0] : start;
    const from = begin !== undefined && begin > 0 ? asRat(begin) : undefined;
    const fromSeconds = from ? positionToSeconds(song.tempo, from) : 0;
    const loopSeconds = loop ? positionToSeconds(song.tempo, asRat(loop[1])) - fromSeconds : undefined;
    const result = await this.engine.play(song, from, loopSeconds && loopSeconds > 0 ? loopSeconds : undefined);
    if (generation !== this.generation) return;
    this.unresolved = result;
    this.from = fromSeconds;
    this.position = 0;
    this.playing = true;
    this.runs++;
    const frame = () => {
      if (generation !== this.generation) return;
      this.position = this.engine.position;
      if (this.engine.playing) requestAnimationFrame(frame);
      else this.playing = false;
    };
    requestAnimationFrame(frame);
  }

  stop(): void {
    this.generation++;
    this.engine.stop();
    this.playing = false;
    this.position = 0;
    this.from = 0;
  }
}
