import { add, cmp, rampVolumes, rat, toFloat, voiceRanks, volumeBars, type Note, type Rat, type VoiceRank, type VolumeBar } from "@mmlce/core";
import { laneBarAt } from "./roll";

/**
 * 음량 레인 획 계산 (피아노롤·타브가 함께 쓴다). 레인에 그리는 트랙이 하나면 그은 값 그대로,
 * 여럿이면 멜로디 트랙은 그은 값, 나머지는 그 순간 높이 자리(맨 위·가운데·맨 아래)마다 정한 차이를 더한다
 */

/** 여러 트랙에 그릴 때 자리마다 더하는 차이 */
export interface RankOffsets {
  readonly top: number;
  readonly middle: number;
  readonly bottom: number;
}

export interface LaneTrack {
  readonly id: string;
  readonly notes: readonly Note[];
  readonly melody: boolean;
  /** 잠근 트랙은 그리기만 하고 바꾸지 않는다 */
  readonly locked: boolean;
}

/** 레인 막대 하나: 어느 트랙의 어느 사슬인지, 여러 트랙일 때의 자리, 이번 획에서 바꿀 수 있는지 */
export interface LaneItem {
  readonly trackId: string;
  readonly bar: VolumeBar;
  readonly rank: VoiceRank | undefined;
  readonly editable: boolean;
}

/** 트랙 id → (사슬 첫 음 id → v) */
export type LaneChanges = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * 레인에 그릴 막대들. tracks[0]이 고른 트랙. 고른 음이 있으면 고른 트랙은 그 음이 든 사슬만,
 * 다른 트랙은 고른 음 구간에 걸친 사슬만 바꾼다
 */
export function laneItems(tracks: readonly LaneTrack[], selected: ReadonlySet<string>): LaneItem[] {
  const multi = tracks.length > 1;
  const ranks = multi ? voiceRanks(tracks) : undefined;
  const active = tracks[0];
  const chosen = active ? active.notes.filter((n) => selected.has(n.id)) : [];
  let from: Rat | undefined;
  let to: Rat | undefined;
  for (const n of chosen) {
    const e = add(n.start, n.dur);
    if (!from || cmp(n.start, from) < 0) from = n.start;
    if (!to || cmp(e, to) > 0) to = e;
  }
  const out: LaneItem[] = [];
  tracks.forEach((track, i) => {
    for (const bar of volumeBars(track.notes)) {
      let editable = !track.locked;
      if (editable && chosen.length > 0) {
        editable = i === 0 ? bar.ids.some((id) => selected.has(id)) : !!from && !!to && cmp(bar.start, to) < 0 && cmp(bar.end, from) > 0;
      }
      out.push({ trackId: track.id, bar, rank: ranks?.get(track.id)?.get(bar.head.id), editable });
    }
  });
  return out;
}

/** 그은 값에 자리 차이를 더해 범위 안으로 */
export function rankValue(drawn: number, rank: VoiceRank | undefined, offsets: RankOffsets, range: { readonly min: number; readonly max: number }): number {
  const v = Math.round(drawn) + (rank === undefined || rank === "melody" ? 0 : offsets[rank]);
  return Math.min(range.max, Math.max(range.min, v));
}

function put(changes: Map<string, Map<string, number>>, item: LaneItem, v: number) {
  let m = changes.get(item.trackId);
  if (!m) changes.set(item.trackId, (m = new Map()));
  m.set(item.bar.head.id, v);
}

/** 바뀐 값 겹쳐 쓰기용 복사 */
export function copyChanges(changes: LaneChanges): Map<string, Map<string, number>> {
  return new Map([...changes].map(([id, m]) => [id, new Map(m)]));
}

/**
 * 붓: (t0,v0)에서 (t1,v1)로 손이 지나간 막대마다 그 자리 선 높이. 손이 막대 위에 머물며 위아래로만 움직여도 바뀐다.
 * 고른 트랙에서 손 바로 아래 막대가 좁으면 넓혀 잡는다
 */
export function brushStroke(
  items: readonly LaneItem[],
  changes: Map<string, Map<string, number>>,
  t0: number,
  v0: number,
  t1: number,
  v1: number,
  pxPerWhole: number,
  touch: boolean,
  offsets: RankOffsets,
  range: { readonly min: number; readonly max: number },
): void {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  const near = new Set<LaneItem>();
  // 트랙마다 손 아래 좁은 막대를 넓혀 찾는다
  const byTrack = new Map<string, LaneItem[]>();
  for (const it of items) byTrack.set(it.trackId, [...(byTrack.get(it.trackId) ?? []), it]);
  for (const list of byTrack.values()) {
    const hit = laneBarAt(list.map((it) => ({ start: it.bar.start, end: it.bar.end, it })), t1, pxPerWhole, touch);
    if (hit) near.add(hit.it);
  }
  for (const it of items) {
    if (!it.editable) continue;
    const a = toFloat(it.bar.start);
    const b = toFloat(it.bar.end);
    if (!near.has(it) && !(a <= hi && b > lo)) continue;
    const at = Math.min(hi, Math.max(lo, a));
    const f = t1 === t0 ? 1 : Math.min(1, Math.max(0, (at - t0) / (t1 - t0)));
    put(changes, it, rankValue(v0 + (v1 - v0) * f, it.rank, offsets, range));
  }
}

/** 직선: from(v0)에서 to(v1)까지, 시작이 그 사이(양 끝 포함)인 막대마다 */
export function lineStroke(
  items: readonly LaneItem[],
  from: Rat,
  to: Rat,
  v0: number,
  v1: number,
  offsets: RankOffsets,
  range: { readonly min: number; readonly max: number },
): Map<string, Map<string, number>> {
  const changes = new Map<string, Map<string, number>>();
  // 선 높이는 자르지 않고 읽어 자리 차이를 더한 뒤 자른다 (트랙마다 첫 음 id가 겹칠 수 있어 막대마다 읽는다)
  const wide = { min: -1e6, max: 1e6 };
  for (const it of items) {
    if (!it.editable) continue;
    const v = rampVolumes([it.bar], from, to, v0, v1, wide).get(it.bar.head.id);
    if (v !== undefined) put(changes, it, rankValue(v, it.rank, offsets, range));
  }
  return changes;
}

/** 직선 끝: 그 자리 막대가 있으면 막대 시작 (누른 막대가 늘 들어가게), 없으면 그 시간 */
export function lineEnd(items: readonly LaneItem[], t: number, pxPerWhole: number, touch: boolean): Rat {
  const hit = laneBarAt(items.map((it) => ({ start: it.bar.start, end: it.bar.end })), t, pxPerWhole, touch);
  return hit ? hit.start : rat(Math.max(0, Math.round(t * 3840)), 3840);
}
