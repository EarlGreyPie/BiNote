import { add, cmp, normalizeTempo, rat, sub, tempoClock, toFloat, ZERO, type Note, type Rat, type TempoEvent } from "@mmlce/core";
import { attackPositions, matchOnsets } from "./noteOnsets";
import { bpmAt, tempoThrough, type TempoPlan } from "./tempoSync";

/**
 * 1.1 템포 작업 도구 (실험실): 음 시작에 템포 넣기(원곡 시작점)와 템포 정리(허용 오차로 합치기).
 * 둘 다 곡 템포 지도만 바꾼다. 결과는 TempoPlan(넣을 것·지울 것)이라 setTempos 명령 하나로 넣는다 (실행 취소 한 칸)
 */

type Tracks = readonly { readonly notes: readonly Note[] }[];
type Range = { readonly min: number; readonly max: number };
/** 고른 구간 [from, to). to가 없으면 곡 끝까지 */
export type SnapSpan = readonly [Rat, Rat | undefined];

/** 곡 끝: 가장 늦게 끝나는 음 (음이 없으면 0) */
export function notesEnd(tracks: Tracks): Rat {
  let end = ZERO;
  for (const t of tracks) for (const n of t.notes) if (cmp(add(n.start, n.dur), end) > 0) end = add(n.start, n.dur);
  return end;
}

/** 템포 지도에 계획을 넣은 결과 (setTempos와 같은 차례: 지우고 넣기) */
export function applyTempoPlan(tempo: readonly TempoEvent[], plan: TempoPlan): TempoEvent[] {
  const kept = normalizeTempo(tempo).filter((e) => !plan.remove.some((at) => cmp(at, e.at) === 0));
  return normalizeTempo([...kept, ...plan.set]);
}

/** 두 템포 지도의 차이를 계획으로 (구간을 여럿 차례로 고친 뒤 한 번에 넣는다) */
export function tempoPlanBetween(before: readonly TempoEvent[], after: readonly TempoEvent[]): TempoPlan {
  const a = normalizeTempo(before);
  const b = normalizeTempo(after);
  const set = b.filter((e) => !a.some((x) => cmp(x.at, e.at) === 0 && x.bpm === e.bpm));
  const remove = a.filter((x) => !b.some((e) => cmp(x.at, e.at) === 0)).map((x) => x.at);
  return { set, remove };
}

/** 구간 [from, to) 안 템포 수 (구간 처음 자리 포함) */
export function temposIn(tempo: readonly TempoEvent[], from: Rat, to: Rat | undefined): number {
  return normalizeTempo(tempo).filter((e) => cmp(e.at, from) >= 0 && (to === undefined || cmp(e.at, to) < 0)).length;
}

/** 모든 음 시작이 두 템포 지도 사이에서 가장 많이 움직인 양 (초) */
export function maxOnsetShift(tracks: Tracks, before: readonly TempoEvent[], after: readonly TempoEvent[]): number {
  const a = tempoClock(before);
  const b = tempoClock(after);
  let most = 0;
  for (const t of tracks) for (const n of t.notes) most = Math.max(most, Math.abs(b(n.start) - a(n.start)));
  return most;
}

/** 구간 끝을 곡 끝으로 채우고, 빈 구간은 뺀다 */
function closedSpans(tracks: Tracks, spans: readonly SnapSpan[]): [Rat, Rat][] {
  const end = notesEnd(tracks);
  return spans.map(([from, to]) => [from, to ?? end] as [Rat, Rat]).filter(([from, to]) => cmp(from, to) < 0);
}

export interface SnapResult {
  readonly plan: TempoPlan;
  /** 구간 안 음 시작 수 (같은 자리는 하나) */
  readonly total: number;
  /** 원곡 시작점을 찾아 템포를 넣은 음 수 */
  readonly found: number;
  /** 찾은 음이 움직인 평균 (초) */
  readonly meanShift: number;
  /**
   * 못 맞춘 음 (게임 템포 범위 밖): 원곡 시작점은 찾았지만 그 시각에 맞추면 앞 표시 자리와의 템포가 범위를 넘어 표시에서 뺀 음 (위치순).
   * 못 찾은 음처럼 앞뒤 템포가 이어서 지나간다. 끝값으로 막은 템포는 만들지 않는다
   */
  readonly outOfRange: readonly Rat[];
}

/**
 * 표시 자리 사이 템포가 range 밖이면 그 간격을 끝내는 뒤쪽 음을 표시에서 뺀다 (뒤쪽이 구간 끝 고정점이면 앞쪽 음).
 * 범위 밖이 없어질 때까지 되풀이한다. 정수 반올림·합치기까지 친 tempoThrough 결과로도 다시 본다. 뺀 음 자리를 돌려준다.
 * marks·times의 처음과 끝은 고정점이라 빼지 않는다 (표시가 고정점 둘만 남으면 더 볼 것이 없다)
 */
function dropOutOfRange(
  tempo: readonly TempoEvent[],
  marks: Rat[],
  times: number[],
  slack: number,
  range: Range | undefined,
): { plan: TempoPlan | undefined; dropped: Rat[] } {
  const dropped: Rat[] = [];
  const drop = (i: number) => {
    // i: 범위 밖 간격 [i-1, i]의 뒤쪽 자리. 구간 끝이면 앞쪽 음을 뺀다
    const k = i === marks.length - 1 ? i - 1 : i;
    dropped.push(marks[k]!);
    marks.splice(k, 1);
    times.splice(k, 1);
  };
  for (;;) {
    if (marks.length <= 2 && dropped.length > 0) return { plan: undefined, dropped };
    if (range) {
      const bad = marks.findIndex((at, i) => {
        if (i === 0) return false;
        const bpm = (240 * toFloat(sub(at, marks[i - 1]!))) / (times[i]! - times[i - 1]!);
        return !(bpm >= range.min - 0.5 && bpm < range.max + 0.5);
      });
      if (bad > 0) {
        drop(bad);
        continue;
      }
    }
    const plan = tempoThrough(tempo, marks, times, { slack, range });
    const first = plan?.clamped?.[0];
    if (!plan || !first) return { plan, dropped };
    // 반올림·합치기로 범위를 넘은 묶음: 그 묶음 시작 다음 자리를 뺀다
    const start = marks.findIndex((at) => cmp(at, first.at) === 0);
    drop(Math.min(marks.length - 1, start + 1));
  }
}

/**
 * 음 시작에 템포 넣기: 구간마다 소리 시작 자리에서 onset(곡 초 → 찾은 곡 초)으로 원곡 시작점을 찾아, 음이 그 시각에 나도록 템포를 넣는다.
 * 구간 처음과 끝은 고정점 (구간 밖은 움직이지 않는다, 끝은 반올림 오차만). 못 찾은 음은 빼고 앞뒤 템포가 이어서 지나간다.
 * slack(초) 안이면 이웃 간격을 한 템포로 합친다 (템포 정리와 같은 값). 구간이 여럿이면 앞에서부터 차례로 고쳐 한 계획으로 만든다
 */
export function snapTemposToOnsets(
  tempo: readonly TempoEvent[],
  tracks: Tracks,
  spans: readonly SnapSpan[],
  onset: (seconds: number) => number | undefined,
  options: { readonly slack?: number; readonly range?: Range } = {},
): SnapResult {
  let map = normalizeTempo(tempo);
  let total = 0;
  let found = 0;
  let shift = 0;
  const outOfRange: Rat[] = [];
  for (const [from, to] of closedSpans(tracks, spans)) {
    const clock = tempoClock(map);
    // 구간 처음 자리는 고정점이라 찾지 않는다
    const inner = attackPositions(tracks, from, to).filter((at) => cmp(at, from) > 0);
    total += inner.length;
    const start = clock(from);
    const end = clock(to);
    const matches = matchOnsets(map, inner, onset, { lower: start, upper: end });
    const hits = matches.filter((m) => m.found !== undefined);
    if (hits.length === 0) continue;
    const marks = [from, ...hits.map((m) => m.at), to];
    const times = [start, ...hits.map((m) => m.found!), end];
    const { plan, dropped } = dropOutOfRange(map, marks, times, options.slack ?? 0, options.range);
    outOfRange.push(...dropped);
    const kept = hits.filter((m) => !dropped.some((at) => cmp(at, m.at) === 0));
    found += kept.length;
    shift += kept.reduce((sum, m) => sum + Math.abs(m.found! - m.seconds), 0);
    // 표시가 고정점 둘만 남으면 그 구간은 그대로 둔다
    if (!plan || kept.length === 0) continue;
    map = applyTempoPlan(map, plan);
  }
  // 곡 끝 뒤에는 연주할 음이 없으므로, 거기 새로 생긴 "원래 템포로 돌아가기"는 넣지 않는다
  const songEnd = notesEnd(tracks);
  const before = normalizeTempo(tempo);
  map = map.filter((e) => cmp(e.at, songEnd) < 0 || before.some((x) => cmp(x.at, e.at) === 0));
  return { plan: tempoPlanBetween(tempo, map), total, found, meanShift: found > 0 ? shift / found : 0, outOfRange: outOfRange.sort(cmp) };
}

/**
 * 템포 정리: 음은 그대로 두고, 지킬 자리(구간 안 모든 음 시작과 끝, 템포 자리, 구간 끝)가 tolerance(초) 안에서만 움직이도록
 * 이웃한 템포를 합친다. 앞에서부터 욕심내어 묶는다: 묶음을 한 템포(정수, range 안)로 쳐도 묶음 안 모든 자리가 오차 안이면
 * 다음 템포 자리까지 넓힌다. 묶음 템포는 실제로 닿은 시각부터 재므로 오차가 쌓이지 않는다.
 * 묶음 경계는 원래 템포 자리 가운데서만 고른다 (새 자리에 템포를 만들지 않아 게임 출력이 옮겨 쓸 템포가 늘지 않는다).
 * 구간 처음이 템포 자리가 아니면 첫 템포 자리 앞까지는 그대로 둔다. 구간 끝에서는 원래 템포로 돌아간다
 */
export function tidyTempos(tempo: readonly TempoEvent[], tracks: Tracks, spans: readonly SnapSpan[], tolerance: number, range?: Range): TempoPlan {
  let map = normalizeTempo(tempo);
  const songEnd = notesEnd(tracks);
  for (const [from, to] of closedSpans(tracks, spans)) map = tidySpan(map, tracks, from, to, songEnd, tolerance, range);
  return tempoPlanBetween(tempo, map);
}

function tidySpan(map: TempoEvent[], tracks: Tracks, from: Rat, to: Rat, songEnd: Rat, tolerance: number, range?: Range): TempoEvent[] {
  const bounds = map.filter((e) => cmp(e.at, from) >= 0 && cmp(e.at, to) < 0);
  if (bounds.length < 2) return map;
  const clock = tempoClock(map);
  const first = bounds[0]!.at;
  // 지킬 자리 (위치순, 온음표 소수와 지금 시각)
  const keys: Rat[] = [...bounds.map((e) => e.at), to];
  for (const t of tracks)
    for (const n of t.notes) {
      for (const at of [n.start, add(n.start, n.dur)]) if (cmp(at, first) >= 0 && cmp(at, to) <= 0) keys.push(at);
    }
  keys.sort(cmp);
  const points = keys.filter((at, i) => i === 0 || cmp(keys[i - 1]!, at) !== 0).map((at) => ({ at, x: toFloat(at), t: clock(at) }));
  const edges = [...bounds.map((e) => e.at), to];
  // 묶음 [edges[g], edges[j]]를 bpm 하나로 쳤을 때 모든 지킬 자리가 오차 안인지
  const fitsGroup = (g: number, j: number, reached: number, bpm: number) => {
    const x0 = toFloat(edges[g]!);
    const x1 = toFloat(edges[j]!);
    return points.every((p) => p.x < x0 - 1e-12 || p.x > x1 + 1e-12 || Math.abs(reached + (240 * (p.x - x0)) / bpm - p.t) <= tolerance + 1e-9);
  };
  const groups: TempoEvent[] = [];
  let reached = clock(first);
  let g = 0;
  while (g < bounds.length) {
    // 혼자인 조각은 원래 템포 그대로 (닿은 시각의 어긋남은 오차 안에서 그대로 이어진다)
    let end = g + 1;
    let bpm = bounds[g]!.bpm;
    for (let j = g + 2; j <= bounds.length; j++) {
      const length = toFloat(sub(edges[j]!, edges[g]!));
      const seconds = clock(edges[j]!) - reached;
      if (!(seconds > 0)) break;
      const candidate = Math.max(1, Math.round((240 * length) / seconds));
      if (range && (candidate < range.min || candidate > range.max)) break;
      if (!fitsGroup(g, j, reached, candidate)) break;
      end = j;
      bpm = candidate;
    }
    groups.push({ at: edges[g]!, bpm });
    reached += (240 * toFloat(sub(edges[end]!, edges[g]!))) / bpm;
    g = end;
  }
  // 앞과 같은 템포는 생략
  const out: TempoEvent[] = [];
  let current = cmp(first, ZERO) > 0 ? bpmAt(map, sub(first, rat(1, 3840 * 64))) : undefined;
  for (const e of groups) {
    if (e.bpm !== current) out.push(e);
    current = e.bpm;
  }
  // 구간 끝에서 원래 템포로 (그 자리에 템포가 있으면 그대로 남는다, 곡 끝이면 넣지 않는다)
  const atEnd = map.some((e) => cmp(e.at, to) === 0);
  const back = bpmAt(map, to);
  if (!atEnd && cmp(to, songEnd) < 0 && back !== current) out.push({ at: to, bpm: back });
  const outside = map.filter((e) => cmp(e.at, first) < 0 || cmp(e.at, to) >= 0);
  return normalizeTempo([...outside, ...out]);
}
