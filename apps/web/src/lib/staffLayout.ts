import { toFloat, type StaffBar, type StaffItem, type StaffTrack } from "@mmlce/core";

/**
 * 오선보 보기 자리 잡기 (그리기 전 계산, VexFlow 없이). 마디 폭은 음표 수·모양으로 어림해 미리 정해 두고,
 * 화면에 보이는 마디만 그린다. 그래서 스크롤 막대 길이와 마디 자리는 그리기 전에도 안다
 */

/** 맨 앞 음자리표·트랙 이름 칸 폭 (스크롤해도 왼쪽에 붙어 있다) */
export const STAFF_GUTTER = 84;
/** 트랙 한 단의 높이 (덧줄·셈여림 자리 포함) */
export const STAFF_ROW = 112;
/** 맨 위 템포 표시 자리 */
export const STAFF_TOP = 26;
/** 확대 배율 범위 */
export const STAFF_ZOOM = { min: 0.6, max: 2.5, step: 1.2 } as const;

/** 음표 모양마다 어림 폭 (px, 배율 1) */
function itemWidth(item: StaffItem): number {
  const base = item.base <= 1 ? 34 : item.base <= 2 ? 30 : item.base <= 4 ? 26 : 22;
  return base + item.dots * 6 + (item.accidental ? 11 : 0) + (item.dynamic ? 4 : 0);
}

/** 마디마다 폭 (px). 모든 트랙 가운데 가장 넓은 것 + 박자표·템포 자리 */
export function barWidths(bars: readonly StaffBar[], tracks: readonly StaffTrack[], zoom: number): number[] {
  return bars.map((bar, i) => {
    let notes = 0;
    for (const t of tracks) {
      const m = t.measures[i];
      if (!m || m.fullRest) continue;
      notes = Math.max(notes, m.items.reduce((s, it) => s + itemWidth(it), 0));
    }
    const fixed = 24 + (bar.showSig ? 26 : 0);
    const tempo = bar.tempo.length * 60;
    return Math.round(Math.max(64 * zoom, notes * zoom, tempo) + fixed);
  });
}

/** 마디 왼쪽 끝 자리 (px, 그림 칸 기준. 길이 = 마디 수 + 1, 마지막은 전체 폭) */
export function barOffsets(widths: readonly number[]): number[] {
  const out = [0];
  for (const w of widths) out.push(out[out.length - 1]! + w);
  return out;
}

/** 보이는 [left, left + width) 에 걸친 마디 [첫, 끝] (번호가 아니라 순서, 앞뒤 margin 마디 더). 마디가 없으면 undefined */
export function visibleBars(offsets: readonly number[], left: number, width: number, margin = 1): readonly [number, number] | undefined {
  const n = offsets.length - 1;
  if (n <= 0) return undefined;
  let first = 0;
  while (first < n - 1 && offsets[first + 1]! <= left) first++;
  let last = first;
  while (last < n - 1 && offsets[last + 1]! < left + width) last++;
  return [Math.max(0, first - margin), Math.min(n - 1, last + margin)];
}

/** 곡 시간(온음표 단위) → 마디 순서. 곡 밖이면 앞·뒤 끝 마디 */
export function barIndexAt(bars: readonly StaffBar[], at: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (toFloat(bars[mid]!.start) <= at + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** 그린 마디 안의 시간 → x 자리 (그린 음표 자리). 시간 순 */
export type TimeAnchors = readonly { readonly at: number; readonly x: number }[];

/** 마디 i 안의 (시간, x) 점들: 마디 시작(첫 음이 마디 시작에 있으면 그 음 자리)·그린 음 자리·마디 끝 */
function anchorLine(bars: readonly StaffBar[], offsets: readonly number[], anchors: ReadonlyMap<number, TimeAnchors>, i: number): { at: number; x: number }[] {
  const s = toFloat(bars[i]!.start);
  const inner = anchors.get(i) ?? [];
  const head = inner[0] && Math.abs(inner[0].at - s) < 1e-9 ? [] : [{ at: s, x: offsets[i]! }];
  return [...head, ...inner, { at: toFloat(bars[i]!.end), x: offsets[i + 1]! }];
}

/**
 * 곡 시간 → x (px, 그림 칸 기준). 그린 마디면 음표 자리 사이를 잇고, 아직 안 그린 마디면 마디 폭 안에서 고르게 나눈다
 */
export function timeToX(bars: readonly StaffBar[], offsets: readonly number[], anchors: ReadonlyMap<number, TimeAnchors>, at: number): number {
  if (bars.length === 0) return 0;
  const i = barIndexAt(bars, at);
  const bar = bars[i]!;
  const s = toFloat(bar.start);
  const e = toFloat(bar.end);
  const right = offsets[i + 1]!;
  const pts = anchorLine(bars, offsets, anchors, i);
  const t = Math.min(Math.max(at, s), e);
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    if (t <= b.at + 1e-12) return b.at - a.at <= 1e-12 ? a.x : a.x + ((t - a.at) / (b.at - a.at)) * (b.x - a.x);
  }
  return right;
}

/** x (px, 그림 칸 기준) → 곡 시간. timeToX를 거꾸로 (빈 곳을 누르면 그 자리로 커서) */
export function xToTime(bars: readonly StaffBar[], offsets: readonly number[], anchors: ReadonlyMap<number, TimeAnchors>, x: number): number {
  if (bars.length === 0) return 0;
  let i = 0;
  while (i < bars.length - 1 && offsets[i + 1]! <= x) i++;
  const bar = bars[i]!;
  const pts = anchorLine(bars, offsets, anchors, i);
  const cx = Math.min(Math.max(x, pts[0]!.x), pts[pts.length - 1]!.x);
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    if (cx <= b.x + 1e-9) return b.x - a.x <= 1e-9 ? a.at : a.at + ((cx - a.x) / (b.x - a.x)) * (b.at - a.at);
  }
  return toFloat(bar.end);
}
