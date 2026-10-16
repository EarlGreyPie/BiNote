import { DEFAULT_BPM, normalizeTempo, toFloat, type TempoEvent } from "@mmlce/core";

/** 원곡 파형 요약: 1초를 perSecond 칸으로 나눈 칸마다 가장 낮은·높은 값 (모든 채널을 섞은 값, -1~1) */
export interface Peaks {
  readonly perSecond: number;
  readonly min: Float32Array;
  readonly max: Float32Array;
  /** 곡 전체에서 가장 큰 크기 (조용한 원곡도 띠 높이를 다 쓰게 그릴 때 나눈다) */
  readonly peak: number;
}

/** 디코딩한 채널들에서 파형 요약을 만든다. 5분 곡도 칸 6만 개 정도라 한 번만 만들어 두고 그린다 */
export function computePeaks(channels: readonly Float32Array[], sampleRate: number, perSecond = 200): Peaks {
  const length = channels[0]?.length ?? 0;
  const span = sampleRate / perSecond;
  const count = Math.ceil(length / span);
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  const n = channels.length;
  let peak = 0;
  for (let b = 0; b < count; b++) {
    const from = Math.floor(b * span);
    const to = Math.min(length, Math.floor((b + 1) * span));
    let lo = 0;
    let hi = 0;
    for (let i = from; i < to; i++) {
      let sum = 0;
      for (const ch of channels) sum += ch[i]!;
      const x = sum / n;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    min[b] = lo;
    max[b] = hi;
    peak = Math.max(peak, hi, -lo);
  }
  return { perSecond, min, max, peak };
}

/** 원곡 시간 [from, to)초 사이의 가장 낮은·높은 값. 원곡 밖이면 undefined */
export function peakRange(peaks: Peaks, from: number, to: number): [number, number] | undefined {
  const first = Math.floor(from * peaks.perSecond);
  const end = Math.ceil(to * peaks.perSecond);
  if (end <= 0 || first >= peaks.min.length) return undefined;
  const a = Math.max(0, first);
  // 확대해서 한 픽셀이 한 칸보다 좁아도 그 칸은 그린다
  const b = Math.min(peaks.min.length, Math.max(a + 1, end));
  let lo = 0;
  let hi = 0;
  for (let i = a; i < b; i++) {
    if (peaks.min[i]! < lo) lo = peaks.min[i]!;
    if (peaks.max[i]! > hi) hi = peaks.max[i]!;
  }
  return [lo, hi];
}

/**
 * 곡 위치(온음표 단위, 소수) → 초. 화면 한 칸마다 부르므로 템포 지도를 한 번 펴 두고 쓴다.
 * 화면에 그리는 값이라 분수 대신 소수로 계산한다
 */
export function wholeToSecondsFn(tempo: readonly TempoEvent[]): (whole: number) => number {
  const events = normalizeTempo(tempo);
  // 구간마다 [시작 위치, 시작 초, 온음표 하나의 초]
  const segments: [number, number, number][] = [[0, 0, 240 / DEFAULT_BPM]];
  for (const e of events) {
    const at = toFloat(e.at);
    const [pos, sec, per] = segments[segments.length - 1]!;
    const seconds = sec + (at - pos) * per;
    if (at <= pos) segments[segments.length - 1] = [pos, sec, 240 / e.bpm];
    else segments.push([at, seconds, 240 / e.bpm]);
  }
  return (whole) => {
    let seg = segments[0]!;
    for (const s of segments) {
      if (s[0] > whole) break;
      seg = s;
    }
    return seg[1] + (whole - seg[0]) * seg[2];
  };
}
