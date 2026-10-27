import { add, cmp, measureStart, meterAt, meterGrid, placeNote, sub, tieChains, type Note, type Rat, type Song, type TimeSigEvent } from "@mmlce/core";
import type { ScoreGroup } from "./scores";
import type { TakeNote } from "./midiRecord";

/**
 * MIDI 건반 녹음이 곡을 어떻게 바꿀지 정하는 곳 (한 곳). 치는 동안 롤·타브에 미리 보이는 것도, 멈출 때 넣는 것도
 * 같은 assignTake 결과다. 그래서 보이는 대로 들어간다. 곡을 바꾸는 길은 planChanges → setTracksNotesAddingTracks → commit 하나뿐이다
 */

/** 덧녹음: 곡에 있던 음은 두고 그 자리는 다음 트랙에 / 바꿔 녹음: 친 마디의 녹음 트랙 음을 비우고 넣는다 */
export type RecordMode = "overdub" | "replace";

/** 녹음이 넣을 곳 (녹음을 시작할 때 정해 두고 끝까지 쓴다) */
export interface RecordTarget {
  readonly playerId: string;
  /** 녹음할 트랙. 이 순서대로 화음의 높은 음부터 넣는다 (악보 안 트랙 순서) */
  readonly trackIds: readonly string[];
  /** 모자랄 때 더할 수 있는 새 트랙 수 (트랙 더하기를 끄면 0) */
  readonly room: number;
  /** 트랙 더하기를 켜면 더할 수 있는지 (그 연주자의 마지막 악보이고 악보 트랙 한도가 남았는지) */
  readonly canAdd: boolean;
  /** 고르지 않아 저절로 정했는지 (고른 트랙과 그 뒤 트랙들) */
  readonly auto: boolean;
  /** 그 악보의 트랙 전체 (녹음 줄에 고를 수 있게 보인다) */
  readonly groupTrackIds: readonly string[];
}

/**
 * 녹음할 곳을 정한다. 고른 트랙(activeTrackId)이 든 악보 안에서:
 * - armed에 이 악보 트랙이 있으면 그 트랙들 (잠긴 트랙은 뺀다)
 * - 없으면 고른 트랙과 그 뒤 트랙들 (잠긴 트랙은 뺀다. 예전 녹음과 같은 규칙)
 * 트랙이 모자랄 때는 addTracks가 켜져 있고 그 악보가 연주자의 마지막 악보일 때만 악보 트랙 한도(limit)까지 더한다
 * (앞 악보에 트랙을 더하면 뒤 악보로 넘어가서)
 */
export function recordTarget(
  song: Song,
  groups: readonly ScoreGroup[],
  activeTrackId: string | undefined,
  armed: ReadonlySet<string> | undefined,
  locked: ReadonlySet<string>,
  limit: number,
  addTracks: boolean,
): RecordTarget | undefined {
  const active = song.tracks.find((t) => t.id === activeTrackId);
  if (!active) return undefined;
  const group = groups.find((g) => g.trackIds.includes(active.id));
  const ids = group ? group.trackIds : [active.id];
  const chosen = armed ? ids.filter((id) => armed.has(id) && !locked.has(id)) : [];
  const auto = chosen.length === 0;
  const trackIds = auto ? ids.slice(ids.indexOf(active.id)).filter((id) => !locked.has(id)) : chosen;
  const lastOfPlayer = !group || groups.filter((g) => g.playerId === group.playerId).at(-1) === group;
  const free = lastOfPlayer ? Math.max(0, limit - ids.length) : 0;
  return { playerId: active.playerId, trackIds, room: addTracks ? free : 0, canAdd: free > 0, auto, groupTrackIds: ids };
}

/**
 * 녹음 중 곡이 바뀐 뒤의 넣을 곳 (미리 보기와 넣기가 같이 쓴다). 시작할 때 정한 트랙 중
 * 지금도 곡에 있고 잠기지 않았고 같은 연주자이면서 같은 악보에 남은 것만 쓴다
 * (녹음 중 트랙을 다른 악보로 옮기면 그 악보에 녹음이 들어가지 않게). 시작 때 트랙이 가장 많이 남은 악보를 고른다.
 * 새 트랙은 그 악보가 지금도 연주자의 마지막 악보이고 한도(limit)가 남은 만큼만 (시작 때 room보다 늘리지 않는다)
 */
export function liveTarget(song: Song, groups: readonly ScoreGroup[], target: RecordTarget, locked: ReadonlySet<string>, limit: number): RecordTarget {
  const mineNow = (id: string) => song.tracks.some((t) => t.id === id && t.playerId === target.playerId);
  const present = target.trackIds.filter((id) => mineNow(id) && !locked.has(id));
  // 악보는 녹음할 트랙이 아니라 시작 때 악보의 트랙 전체로 찾는다 (녹음할 트랙 하나만 다른 악보로 옮겨도 따라가지 않게)
  const anchor = target.groupTrackIds.filter(mineNow);
  const mine = groups.filter((g) => g.playerId === target.playerId);
  const count = (g: ScoreGroup) => anchor.filter((id) => g.trackIds.includes(id)).length;
  // 트랙이 모두 사라졌으면 새 트랙은 연주자 끝에 더해지므로 마지막 악보로 본다
  const group = mine.reduce<ScoreGroup | undefined>((best, g) => (count(g) > (best ? count(best) : 0) ? g : best), undefined) ?? mine.at(-1);
  const trackIds = group ? present.filter((id) => group.trackIds.includes(id)) : [];
  const last = group !== undefined && mine.at(-1) === group;
  const free = last ? Math.max(0, limit - group.trackIds.length) : 0;
  return { ...target, trackIds, room: Math.min(target.room, free), groupTrackIds: group?.trackIds ?? [] };
}

/** 녹음 트랙 하나 (곡에 있는 트랙, 또는 더할 새 트랙) */
export interface TakeLane {
  /** 새 트랙이면 undefined */
  readonly trackId: string | undefined;
  /** 녹음 전 음 (바꿔 녹음이면 친 마디를 비운 뒤) */
  readonly base: readonly Note[];
  /** 녹음해 넣는 음 */
  readonly added: readonly Note[];
}

export interface TakeAssign {
  readonly lanes: readonly TakeLane[];
  /** 넣을 트랙이 없어 빠지는 음 */
  readonly dropped: readonly TakeNote[];
  /** 바꿔 녹음으로 비우는(지우거나 잘리는) 원래 음 */
  readonly cleared: readonly { readonly trackId: string; readonly note: Note }[];
  /** 바꿔 녹음으로 비우는 구간 */
  readonly range: readonly [Rat, Rat] | undefined;
}

const end = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);
const overlaps = (a: { start: Rat; dur: Rat }, start: Rat, stop: Rat) => cmp(a.start, stop) < 0 && cmp(start, end(a)) < 0;

/** 위치가 든 마디의 끝 (위치가 마디선이면 그 위치) */
function measureEnd(timeSig: readonly TimeSigEvent[], at: Rat): Rat {
  const start = measureStart(timeSig, at);
  if (cmp(start, at) === 0) return at;
  return add(start, meterGrid(meterAt(timeSig, start)).measure);
}

/**
 * 바꿔 녹음으로 비울 구간: 실제로 친 음의 첫 마디 시작부터 마지막 마디 끝까지 (정지를 늦게 눌러도 뒤 마디는 지우지 않는다).
 * 친 음이 없으면 undefined
 */
export function replaceRange(timeSig: readonly TimeSigEvent[], take: readonly TakeNote[]): [Rat, Rat] | undefined {
  if (take.length === 0) return undefined;
  let first = take[0]!.start;
  let last = end(take[0]!);
  for (const n of take) {
    if (cmp(n.start, first) < 0) first = n.start;
    if (cmp(end(n), last) > 0) last = end(n);
  }
  return [measureStart(timeSig, first), measureEnd(timeSig, last)];
}

/**
 * 한 트랙에서 [from, to)를 비운다. 구간에 걸친 음은 구간 앞·뒤 부분만 남긴다:
 * & 사슬이 from에 걸치면 from에서 자르고 &를 풀고, to에 걸치면 to부터 남은 조각을 새로 시작하는 음으로 남긴다
 * (구간 뒤 마디의 소리는 지우지 않는다). 구간 밖 사슬은 그대로
 */
export function clearRange(notes: readonly Note[], from: Rat, to: Rat): { notes: Note[]; cleared: Note[] } {
  const kept: Note[] = [];
  const cleared: Note[] = [];
  for (const chain of tieChains(notes)) {
    if (!chain.some((n) => cmp(n.start, to) < 0 && cmp(end(n), from) > 0)) {
      kept.push(...chain);
      continue;
    }
    const before: Note[] = [];
    const after: Note[] = [];
    for (const n of chain) {
      if (cmp(end(n), from) <= 0) before.push(n);
      else if (cmp(n.start, to) >= 0) after.push(n);
      else {
        if (cmp(n.start, from) < 0) before.push({ ...n, dur: sub(from, n.start) });
        if (cmp(end(n), to) > 0) after.push({ ...n, id: `${n.id}.after`, start: to, dur: sub(end(n), to) });
        cleared.push(n);
      }
    }
    if (before.length > 0) before[before.length - 1] = { ...before[before.length - 1]!, tie: "none" };
    kept.push(...before, ...after);
  }
  return { notes: kept.sort((a, b) => cmp(a.start, b.start)), cleared };
}

/**
 * 격자에 맞춘 녹음 음을 녹음 트랙에 나눈다. 같은 시각에 친 음은 높은 음부터 그 자리가 빈 첫 트랙에 (트랙은 한 번에 한 음),
 * 트랙이 모자라면 새 트랙(room까지), 그래도 없으면 빠진다.
 * - 덧녹음: 곡에 있던 음은 지우지 않고 그 자리는 찬 것으로 본다
 * - 바꿔 녹음: 친 마디(replaceRange)의 녹음 트랙 음을 먼저 비운다
 * - 같은 트랙의 앞 녹음 음이 격자 한 칸 이하로만 겹치면(이어 치기에서 조금 늦게 뗀 것) 앞 음을 끊고 같은 트랙에 넣는다.
 *   그래야 선율이 트랙을 옮겨 다니지 않는다
 * volumeOf: 넣을 자리의 v (그 트랙 음, 자리, 건반 세기)
 */
export function assignTake(
  song: Song,
  target: RecordTarget,
  take: readonly TakeNote[],
  grid: Rat,
  mode: RecordMode,
  volumeOf: (track: readonly Note[], at: Rat, velocity: number) => number,
): TakeAssign {
  const range = mode === "replace" ? replaceRange(song.timeSig, take) : undefined;
  const cleared: { trackId: string; note: Note }[] = [];
  const lanes = target.trackIds
    .map((id) => song.tracks.find((t) => t.id === id))
    .filter((t) => t !== undefined)
    .map((t) => {
      if (!range) return { trackId: t.id as string | undefined, base: t.notes as readonly Note[], added: [] as Note[] };
      const out = clearRange(t.notes, range[0], range[1]);
      for (const note of out.cleared) cleared.push({ trackId: t.id, note });
      return { trackId: t.id as string | undefined, base: out.notes as readonly Note[], added: [] as Note[] };
    });
  const volumeBase = lanes[0]?.base ?? [];
  for (let k = 0; k < target.room; k++) lanes.push({ trackId: undefined, base: [], added: [] });
  const stamp = Date.now().toString(36);
  const dropped: TakeNote[] = [];
  let serial = 0;
  for (const n of [...take].sort((a, b) => cmp(a.start, b.start) || b.pitch - a.pitch)) {
    const stop = end(n);
    const fits = (lane: (typeof lanes)[number]) => {
      if (lane.base.some((o) => overlaps(o, n.start, stop))) return false;
      const hit = lane.added.filter((o) => overlaps(o, n.start, stop));
      if (hit.length === 0) return true;
      // 앞에서 시작해 격자 한 칸 이하로 겹친 녹음 음 하나면 끊을 수 있다
      return hit.length === 1 && cmp(hit[0]!.start, n.start) < 0 && cmp(sub(end(hit[0]!), n.start), grid) <= 0;
    };
    // 새 트랙은 원래 트랙 뒤에 있어, 앞 새 트랙을 다 쓴 뒤에야 다음 새 트랙을 연다
    const pick = lanes.find(fits);
    if (!pick) {
      dropped.push(n);
      continue;
    }
    pick.added = pick.added.map((o) => (overlaps(o, n.start, stop) ? { ...o, dur: sub(n.start, o.start) } : o));
    pick.added.push({
      id: `${pick.trackId ?? `${target.playerId}.r`}.rec${stamp}${serial++}`,
      start: n.start,
      dur: n.dur,
      pitch: n.pitch,
      vol: volumeOf(pick.trackId !== undefined ? [...pick.base, ...pick.added] : volumeBase, n.start, n.velocity),
      tie: "none",
    });
  }
  return { lanes, dropped, cleared, range };
}

/** 넣을 바꿈: 곡에 있는 트랙의 바뀐 뒤 음 전체와, 더할 새 트랙의 음 (setTracksNotesAddingTracks에 그대로 넘긴다) */
export function planChanges(assign: TakeAssign): { changes: { trackId: string; notes: Note[] }[]; newTracks: Note[][] } {
  const touched = new Set(assign.cleared.map((c) => c.trackId));
  const changes: { trackId: string; notes: Note[] }[] = [];
  const newTracks: Note[][] = [];
  for (const lane of assign.lanes) {
    if (lane.trackId === undefined) {
      if (lane.added.length > 0) newTracks.push([...lane.added]);
      continue;
    }
    if (lane.added.length === 0 && !touched.has(lane.trackId)) continue;
    changes.push({ trackId: lane.trackId, notes: lane.added.reduce<Note[]>((notes, n) => placeNote(notes, n), [...lane.base]) });
  }
  return { changes, newTracks };
}

/** 롤·타브에 미리 보일 녹음 음 */
export interface RecordGhost {
  readonly start: Rat;
  readonly dur: Rat;
  readonly pitch: number;
  /** placed: 넣을 음 (color = 들어갈 트랙 색, 새 트랙이면 없음) / dropped: 트랙이 모자라 빠질 음 / cleared: 바꿔 녹음으로 비울 원래 음 */
  readonly kind: "placed" | "dropped" | "cleared";
  readonly color?: string | undefined;
}

export function takeGhosts(assign: TakeAssign, colors: ReadonlyMap<string, string>): RecordGhost[] {
  const out: RecordGhost[] = [];
  for (const c of assign.cleared) out.push({ start: c.note.start, dur: c.note.dur, pitch: c.note.pitch, kind: "cleared" });
  for (const lane of assign.lanes) {
    const color = lane.trackId !== undefined ? colors.get(lane.trackId) : undefined;
    for (const n of lane.added) out.push({ start: n.start, dur: n.dur, pitch: n.pitch, kind: "placed", color });
  }
  for (const n of assign.dropped) out.push({ start: n.start, dur: n.dur, pitch: n.pitch, kind: "dropped" });
  return out;
}
