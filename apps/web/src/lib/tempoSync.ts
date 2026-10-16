import { add, cmp, rat, DEFAULT_BPM, measureStart, meterAt, meterGrid, normalizeTempo, positionToSeconds, sub, toFloat, ZERO, type Rat, type TempoEvent, type TimeSigEvent } from "@mmlce/core";

/**
 * 원곡에 템포 맞추기. 템포를 짐작하지 않고, 사람이 정해 준 자리(마디선을 파형 위 박으로 끌기, 마디마다 탭)를
 * 곡 템포로 옮긴다. 게임 템포는 정수라 bpm은 반올림한다.
 */

/** bpm은 4분음표 기준: 온음표 길이 L이 d초면 bpm = 240·L/d */
function bpmFor(length: Rat, seconds: number): number {
  return Math.max(1, Math.round((240 * toFloat(length)) / seconds));
}

/** 위치에서 쓰는 템포 */
export function bpmAt(tempo: readonly TempoEvent[], at: Rat): number {
  let bpm = DEFAULT_BPM;
  for (const e of normalizeTempo(tempo)) if (cmp(e.at, at) <= 0) bpm = e.bpm;
  return bpm;
}

export interface TempoPlan {
  /** 넣거나 고칠 템포 */
  readonly set: readonly TempoEvent[];
  /** 지울 템포 위치 (탭 구간 안에 있던 것) */
  readonly remove: readonly Rat[];
}

/**
 * 마디선 bar를 곡 시각 targetSeconds(지금 템포로 잰 초, 파형에서 그 박이 보이는 자리)에 오게 한다.
 * bar 앞의 마지막 템포 자리(없으면 곡 처음)부터 bar까지의 템포를 바꾸고, bar 뒤는 원래 템포를 이어 간다
 * (bar에 원래 템포를 하나 넣는다). 앞 자리보다 앞으로 끌면 undefined
 */
export function alignBarTempo(tempo: readonly TempoEvent[], bar: Rat, targetSeconds: number): TempoPlan | undefined {
  const events = normalizeTempo(tempo);
  const anchor = events.filter((e) => cmp(e.at, bar) < 0).at(-1)?.at ?? ZERO;
  if (cmp(anchor, bar) >= 0) return undefined;
  const seconds = targetSeconds - positionToSeconds(events, anchor);
  if (!(seconds > 0.01)) return undefined;
  const bpm = bpmFor(sub(bar, anchor), seconds);
  const after = bpmAt(events, bar);
  const atBar = events.some((e) => cmp(e.at, bar) === 0);
  const set: TempoEvent[] = [{ at: anchor, bpm }];
  if (!atBar && after !== bpm) set.push({ at: bar, bpm: after });
  return { set, remove: [] };
}

/** 위치에서 가장 가까운 마디 시작 */
export function nearestBar(timeSig: readonly TimeSigEvent[], at: Rat): Rat {
  const start = measureStart(timeSig, at);
  const next = add(start, meterGrid(meterAt(timeSig, start)).measure);
  return toFloat(sub(at, start)) <= toFloat(sub(next, at)) ? start : next;
}

/** 탭 단위: 마디 첫 박마다, 또는 박마다 (붙임줄로 첫 박이 안 들리는 곡) */
export type TapUnit = "bar" | "beat";

/** 위치에서 가장 가까운 박 (마디 시작부터 박 길이로 센다) */
export function nearestBeat(timeSig: readonly TimeSigEvent[], at: Rat): Rat {
  const start = measureStart(timeSig, at);
  const grid = meterGrid(meterAt(timeSig, start));
  const k = Math.round(toFloat(sub(at, start)) / toFloat(grid.beat));
  const beat = add(start, rat(grid.beat.n * k, grid.beat.d));
  return cmp(beat, add(start, grid.measure)) > 0 ? add(start, grid.measure) : beat;
}

/** 다음 탭 자리: 다음 마디, 또는 다음 박 (마디 끝을 넘지 않는다) */
function nextStep(timeSig: readonly TimeSigEvent[], at: Rat, unit: TapUnit): Rat {
  const start = measureStart(timeSig, at);
  const grid = meterGrid(meterAt(timeSig, start));
  const end = add(start, grid.measure);
  if (unit === "bar") return end;
  const next = add(at, grid.beat);
  return cmp(next, end) > 0 ? end : next;
}

/**
 * 묶음(points: 묶음 시작부터 길이·초)에 다음 간격을 더해도 되는지: 합친 평균 템포로 쳐도 묶음 안 모든 탭 자리가
 * slack(초) 안에 들면 손 떨림으로 보고 합친다. 그보다 쌓이면 연주자가 실제로 템포를 바꾼 것으로 본다
 */
function fits(points: readonly [number, number][], length: number, seconds: number, slack: number): boolean {
  if (!(slack > 0)) return false;
  const [l, t] = points.at(-1)!;
  const perWhole = (t + seconds) / (l + length);
  return [...points, [l + length, t + seconds] as [number, number]].every(([pl, pt]) => Math.abs(pl * perWhole - pt) <= slack + 1e-9);
}

/**
 * 탭한 시각(곡 시각, 초)으로 템포를 정한다. 첫 탭은 first(자리는 그대로 둔다), 다음 탭은 그다음 마디(또는 박)들.
 * 간격마다 템포를 재고, 합쳐도 탭 자리가 slack(초) 안이면 한 묶음으로 합친다. 묶음 템포는 묶음 전체 길이 ÷ 전체 시간이라
 * 묶음 끝은 탭 자리에 그대로 맞는다. 앞과 같은 템포는 생략하고, 마지막 탭 자리부터는 원래 템포로 돌아간다.
 * 그 사이에 있던 템포는 지운다. 탭이 둘보다 적으면 undefined
 */
export function tapTempos(
  tempo: readonly TempoEvent[],
  timeSig: readonly TimeSigEvent[],
  first: Rat,
  taps: readonly number[],
  options: { readonly slack?: number; readonly unit?: TapUnit } = {},
): TempoPlan | undefined {
  const { slack = 0, unit = "bar" } = options;
  if (taps.length < 2) return undefined;
  const marks: Rat[] = [first];
  for (let i = 1; i < taps.length; i++) marks.push(nextStep(timeSig, marks[i - 1]!, unit));
  const last = marks.at(-1)!;
  // 묶음: 시작 자리부터 탭마다 [묶음 시작부터 길이, 걸린 초]
  type Group = { start: Rat; points: [number, number][] };
  const groups: Group[] = [];
  for (let i = 0; i + 1 < taps.length; i++) {
    const seconds = taps[i + 1]! - taps[i]!;
    if (!(seconds > 0.05)) return undefined;
    const length = toFloat(sub(marks[i + 1]!, marks[i]!));
    const g = groups.at(-1);
    if (g && fits(g.points, length, seconds, slack)) {
      const [l, t] = g.points.at(-1)!;
      g.points.push([l + length, t + seconds]);
    } else groups.push({ start: marks[i]!, points: [[length, seconds]] });
  }
  const set: TempoEvent[] = [];
  let current = bpmAt(tempo, first);
  for (const g of groups) {
    const [length, seconds] = g.points.at(-1)!;
    const bpm = Math.max(1, Math.round((240 * length) / seconds));
    if (bpm !== current) set.push({ at: g.start, bpm });
    current = bpm;
  }
  const after = bpmAt(tempo, last);
  if (after !== current) set.push({ at: last, bpm: after });
  const remove = normalizeTempo(tempo)
    .map((e) => e.at)
    .filter((at) => cmp(at, first) > 0 && cmp(at, last) <= 0 && !set.some((s) => cmp(s.at, at) === 0));
  return { set, remove };
}
