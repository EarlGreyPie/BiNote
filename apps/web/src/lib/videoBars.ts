/**
 * 실험실 영상 마디 넘김: 악보 영상에서 지금 마디에 색 상자가 칠해졌다가 다음 마디로 한 번에 옮겨지는 순간을 찾는다.
 * 찾은 시각은 마디 단위 탭으로 탭 템포에 넣는다. 여기는 브라우저 없이 시험할 수 있는 계산만 둔다 (프레임 읽기는 videoScan.ts)
 */

/** 줄인 프레임 가로 크기 (점). 세로는 영상 비율을 따른다 */
export const SCAN_WIDTH = 160;

/** 흰 바탕으로 보는 밝기 */
const WHITE = 240;
/** 칠한 상자로 보는 밝기 범위. 검은 음표·글자는 빠진다 */
const TINT_LOW = 150;
const TINT_HIGH = 238;
/** 한 프레임에 이만큼은 어두워져야 상자가 새로 칠해진 것으로 본다. 서서히 바뀌는 화면 전환은 빠진다 */
const STEP = 15;
/** 상자가 새로 칠해진 점이 프레임의 이 비율을 넘으면 마디가 바뀐 것으로 본다 */
const SHARE = 0.004;
/** 이보다 가까운 두 변화는 하나로 본다 (초) */
const MIN_GAP = 0.2;
/** 앞뒤 끝 간격이 가운데 간격의 이 배를 넘으면 제목·끝 화면으로 보고 뺀다 */
const EDGE_RATIO = 3;

/**
 * RGBA 프레임을 점마다 한 값으로 줄인다. 세 색 가운데 가장 낮은 값을 써서
 * 회색뿐 아니라 연한 노랑·파랑 상자도 흰 바탕과 구별한다
 */
export function toLevels(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.floor(rgba.length / 4));
  for (let i = 0; i < out.length; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    out[i] = Math.min(r, g, b);
  }
  return out;
}

/** 앞 프레임에서 흰 바탕이었다가 이번 프레임에 연하게 칠해진 점 수 */
export function tintedCount(prev: Uint8Array, cur: Uint8Array): number {
  const n = Math.min(prev.length, cur.length);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const p = prev[i]!;
    const c = cur[i]!;
    if (p >= WHITE && c >= TINT_LOW && c <= TINT_HIGH && p - c >= STEP) count++;
  }
  return count;
}

export interface ScanSample {
  /** 영상 시각 (초) */
  readonly time: number;
  /** tintedCount (첫 프레임은 0) */
  readonly count: number;
}

/**
 * 프레임마다 센 값에서 마디가 바뀐 시각(영상 초)을 고른다.
 * 맨 앞·맨 뒤에 간격이 크게 벌어진 변화(제목 화면, 끝 화면)는 뺀다
 */
export function pickBarStarts(samples: readonly ScanSample[], pixels: number): number[] {
  const threshold = Math.max(8, pixels * SHARE);
  const times: number[] = [];
  for (const s of samples) {
    if (s.count < threshold) continue;
    const last = times.at(-1);
    if (last !== undefined && s.time - last < MIN_GAP) continue;
    times.push(s.time);
  }
  if (times.length < 4) return times;
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  let from = 0;
  let to = times.length;
  while (to - from > 2 && times[from + 1]! - times[from]! > median * EDGE_RATIO) from++;
  while (to - from > 2 && times[to - 1]! - times[to - 2]! > median * EDGE_RATIO) to--;
  return times.slice(from, to);
}
