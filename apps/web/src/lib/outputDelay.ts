/**
 * 실제 출력 지연 재기.
 * 재생선은 "오디오 시계 - 출력 지연"으로 그린다. 출력 지연은 브라우저가 알려 주는 값(outputLatency·baseLatency)을 써 왔는데,
 * 아이패드는 절전·화면 잠금 뒤 실제 지연이 커져도 이 값이 그대로일 수 있다. 그러면 오디오를 새로 만들어도
 * 소리가 재생선보다 늦게 난다(밀림). 브라우저가 주는 출력 시각(getOutputTimestamp: 지금 스피커에서 나는 소리의
 * 오디오 시각과 그 벽시계 시각)으로 실제 지연을 재서, 알려 준 값보다 뚜렷이 크면 그 값을 쓴다.
 */

/** getOutputTimestamp가 돌려주는 값 (모르는 칸은 undefined) */
export interface OutputStamp {
  contextTime?: number | undefined;
  performanceTime?: number | undefined;
}

/** 이보다 크게(초) 잰 값은 믿지 않는다 (깨어난 직전처럼 출력 시각이 아직 옛것일 때) */
export const OUTPUT_DELAY_MAX = 1;
/** 가운데 값을 고를 최근 재기 수 */
export const OUTPUT_DELAY_SAMPLES = 5;
/** 잰 값이 알려 준 지연보다 이만큼(초) 넘게 커야 잰 값을 쓴다 (재는 오차로 재생선이 흔들리지 않게) */
export const OUTPUT_DELAY_SLACK = 0.02;
/** 쓰는 값과 이만큼(초) 넘게 달라야 바꾼다 */
export const OUTPUT_DELAY_STEP = 0.01;

/**
 * 한 번 잰 출력 지연(초). now는 읽은 때의 오디오 시계, nowMs는 그때의 performance.now().
 * 지금 들리는 소리의 오디오 시각 = contextTime + (nowMs - performanceTime)/1000. 쓸 수 없으면 undefined
 */
export function outputDelayOf(stamp: OutputStamp | undefined, now: number, nowMs: number): number | undefined {
  const ctx = stamp?.contextTime;
  const perf = stamp?.performanceTime;
  if (typeof ctx !== "number" || typeof perf !== "number" || !Number.isFinite(ctx) || !Number.isFinite(perf)) return undefined;
  // 출력 시각을 아직 모르면 브라우저가 0을 준다
  if (ctx <= 0 || perf <= 0) return undefined;
  const heard = ctx + (nowMs - perf) / 1000;
  const delay = now - heard;
  if (!(delay >= 0) || delay > OUTPUT_DELAY_MAX) return undefined;
  return delay;
}

/** 최근 재기를 모아 가운데 값을 쓴다. 오디오를 새로 만들거나 깨어나면 비운다 */
export class OutputDelay {
  private readonly samples: number[] = [];
  /** 지금 쓰는 잰 지연(초). 아직 모르면 undefined */
  value: number | undefined;

  add(delay: number | undefined): void {
    if (delay === undefined) return;
    this.samples.push(delay);
    if (this.samples.length > OUTPUT_DELAY_SAMPLES) this.samples.shift();
    // 하나만 잰 값으로는 바꾸지 않는다 (깨어난 직후 튀는 값)
    if (this.samples.length < 3) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)]!;
    if (this.value === undefined || Math.abs(mid - this.value) > OUTPUT_DELAY_STEP) this.value = mid;
  }

  clear(): void {
    this.samples.length = 0;
    this.value = undefined;
  }
}

/** 재생선에 쓸 출력 지연(초): 알려 준 값, 다만 잰 값이 그보다 OUTPUT_DELAY_SLACK 넘게 크면 잰 값 */
export function effectiveOutputDelay(reported: number, measured: number | undefined): number {
  if (measured === undefined) return reported;
  return measured - reported > OUTPUT_DELAY_SLACK ? measured : reported;
}
