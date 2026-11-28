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

/**
 * 조표 자리 (px, 배율 1이 아니어도 같다). shown이 아니면 0.
 * 조표 하나에 올림·내림표 하나씩, 바뀐 마디는 지우는 제자리표도 (새 조표에 없는 앞 조표의 글자 수)
 */
/** 줄바꿈 배치에서 마디 i가 줄 첫 마디가 될 때 더 드는 조표 자리 (조표가 바뀐 마디는 이미 자리가 있다) */
export function keyLead(bars: readonly Pick<StaffBar, "fifths" | "showKey" | "cancelKey">[]): (i: number) => number {
  return (i) => {
    const bar = bars[i];
    return bar && !bar.showKey && bar.fifths !== 0 ? keyWidth(bar, true) : 0;
  };
}

export function keyWidth(bar: Pick<StaffBar, "fifths" | "cancelKey">, shown: boolean): number {
  if (!shown) return 0;
  const cancel = bar.cancelKey === undefined ? 0 : Math.sign(bar.cancelKey) !== Math.sign(bar.fifths) ? Math.abs(bar.cancelKey) : Math.max(0, Math.abs(bar.cancelKey) - Math.abs(bar.fifths));
  return 8 + (Math.abs(bar.fifths) + cancel) * 10;
}

/** 마디마다 폭 (px). 모든 트랙 가운데 가장 넓은 것 + 박자표·조표·템포 자리 */
export function barWidths(bars: readonly StaffBar[], tracks: readonly StaffTrack[], zoom: number): number[] {
  return bars.map((bar, i) => {
    let notes = 0;
    for (const t of tracks) {
      const m = t.measures[i];
      if (!m || m.fullRest) continue;
      notes = Math.max(notes, m.items.reduce((s, it) => s + itemWidth(it), 0));
    }
    const fixed = 24 + (bar.showSig ? 26 : 0) + keyWidth(bar, bar.showKey);
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

/**
 * 마디마다 그릴 자리: 그림 칸 안 왼쪽 끝과 폭 (px). 한 줄로 이어 그리면 left = 마디 왼쪽 끝 자리(barOffsets),
 * 줄바꿈 배치면 그 마디가 든 줄 안의 자리다
 */
export interface BarPlace {
  readonly left: readonly number[];
  readonly width: readonly number[];
}

/** 한 줄로 이어 그리는 자리 (가로 스크롤) */
export function linePlace(widths: readonly number[]): BarPlace {
  return { left: barOffsets(widths).slice(0, widths.length), width: widths };
}

/** 줄바꿈 배치의 한 줄: 마디 [first, last] */
export interface StaffSystem {
  readonly first: number;
  readonly last: number;
}

export interface WrappedLayout extends BarPlace {
  readonly systems: readonly StaffSystem[];
  /** 마디 순서 → 줄 번호 */
  readonly systemOf: readonly number[];
  /** 가장 넓은 줄의 폭 (마디 하나가 줄 폭보다 넓으면 줄 폭보다 넓다) */
  readonly lineWidth: number;
}

/** 줄 끝을 맞추려고 마디를 늘리는 최대 배율. 이보다 더 늘려야 하면(마디가 적은 줄) 늘리지 않는다 */
const MAX_STRETCH = 1.8;

/**
 * 악보처럼 줄바꿈: 마디를 차례로 줄 폭(lineWidth)에 들어가는 만큼 한 줄에 넣는다. 한 마디가 줄 폭보다 넓으면 그 마디만 한 줄.
 * 마지막 줄이 아닌 줄은 마디 폭을 같은 비율로 늘려 줄 끝을 맞춘다 (MAX_STRETCH까지)
 */
export function wrapBars(rawWidths: readonly number[], lineWidth: number, lead: (i: number) => number = () => 0): WrappedLayout {
  const systems: StaffSystem[] = [];
  let first = 0;
  let sum = 0;
  rawWidths.forEach((w, i) => {
    // 줄 첫 마디가 되면 조표를 다시 그릴 자리(lead)가 붙는다
    if (i > first && sum + w > lineWidth) {
      systems.push({ first, last: i - 1 });
      first = i;
      sum = lead(i);
    }
    sum += w;
  });
  if (rawWidths.length > 0) systems.push({ first, last: rawWidths.length - 1 });
  const starts = new Set(systems.map((sys) => sys.first));
  const widths = rawWidths.map((w, i) => (starts.has(i) ? w + lead(i) : w));
  const left: number[] = [];
  const width: number[] = [];
  const systemOf: number[] = [];
  let widest = 0;
  systems.forEach((sys, k) => {
    const natural = widths.slice(sys.first, sys.last + 1);
    const total = natural.reduce((a, b) => a + b, 0);
    const lastLine = k === systems.length - 1;
    const scale = !lastLine && total > 0 && total < lineWidth && lineWidth / total <= MAX_STRETCH ? lineWidth / total : 1;
    let x = 0;
    natural.forEach((w, j) => {
      const i = sys.first + j;
      // 늘린 폭은 정수로, 반올림 오차는 줄 끝 마디가 받는다
      const end = j === natural.length - 1 && scale !== 1 ? lineWidth : Math.round(x + w * scale);
      left[i] = x;
      width[i] = end - x;
      systemOf[i] = k;
      x = end;
    });
    widest = Math.max(widest, x);
  });
  return { systems, left, width, systemOf, lineWidth: widest };
}

/**
 * 줄바꿈 배치에서 재생선을 따라 넘길 세로 자리 (안 넘기면 undefined).
 * 재생선이 다른 줄로 넘어가면(followed와 다르면) 그 줄이 (칸에 들어가면 다) 보이게, 같은 줄에 있는 동안은
 * 그 줄이 화면에서 완전히 사라졌을 때만 넘긴다. 줄이 칸보다 높을 때 아래 단을 보려고 내린 스크롤을 되돌리지 않게
 */
export function followSystem(spot: { readonly system: number; readonly top: number }, height: number, scrollTop: number, viewHeight: number, followed: number): number | undefined {
  const offscreen = spot.top + height <= scrollTop || spot.top >= scrollTop + viewHeight;
  const partly = spot.top < scrollTop || spot.top + Math.min(height, viewHeight) > scrollTop + viewHeight;
  return offscreen || (spot.system !== followed && partly) ? Math.max(0, spot.top - 4) : undefined;
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
function anchorLine(bars: readonly StaffBar[], place: BarPlace, anchors: ReadonlyMap<number, TimeAnchors>, i: number): { at: number; x: number }[] {
  const s = toFloat(bars[i]!.start);
  const inner = anchors.get(i) ?? [];
  const head = inner[0] && Math.abs(inner[0].at - s) < 1e-9 ? [] : [{ at: s, x: place.left[i]! }];
  return [...head, ...inner, { at: toFloat(bars[i]!.end), x: place.left[i]! + place.width[i]! }];
}

/**
 * 곡 시간 → x (px, 그림 칸 기준. 줄바꿈 배치면 그 마디가 든 줄 안의 x). 그린 마디면 음표 자리 사이를 잇고, 아직 안 그린 마디면 마디 폭 안에서 고르게 나눈다
 */
export function timeToX(bars: readonly StaffBar[], place: BarPlace, anchors: ReadonlyMap<number, TimeAnchors>, at: number): number {
  if (bars.length === 0) return 0;
  const i = barIndexAt(bars, at);
  const bar = bars[i]!;
  const s = toFloat(bar.start);
  const e = toFloat(bar.end);
  const right = place.left[i]! + place.width[i]!;
  const pts = anchorLine(bars, place, anchors, i);
  const t = Math.min(Math.max(at, s), e);
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    if (t <= b.at + 1e-12) return b.at - a.at <= 1e-12 ? a.x : a.x + ((t - a.at) / (b.at - a.at)) * (b.x - a.x);
  }
  return right;
}

/**
 * x (px, 그림 칸 기준) → 곡 시간. timeToX를 거꾸로 (빈 곳을 누르면 그 자리로 커서).
 * range: 찾을 마디 [첫, 끝] (줄바꿈 배치에서 누른 줄의 마디). 없으면 모든 마디
 */
export function xToTime(bars: readonly StaffBar[], place: BarPlace, anchors: ReadonlyMap<number, TimeAnchors>, x: number, range?: readonly [number, number]): number {
  if (bars.length === 0) return 0;
  const [from, to] = range ?? [0, bars.length - 1];
  let i = from;
  while (i < to && place.left[i]! + place.width[i]! <= x) i++;
  const bar = bars[i]!;
  const pts = anchorLine(bars, place, anchors, i);
  const cx = Math.min(Math.max(x, pts[0]!.x), pts[pts.length - 1]!.x);
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    if (cx <= b.x + 1e-9) return b.x - a.x <= 1e-9 ? a.at : a.at + ((cx - a.x) / (b.x - a.x)) * (b.at - a.at);
  }
  return toFloat(bar.end);
}
