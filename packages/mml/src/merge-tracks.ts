import { add, cmp, type Command, type GameProfile, type Note, type Rat, type Song, type Track } from "@mmlce/core";
import { compactResult, restoreSong } from "./edit.js";
import { gameTimeline } from "./game-timeline.js";
import { mergeFit, noteChains } from "./merge.js";
import { trackEnd } from "./score-end.js";

/**
 * 화음 병합 창 (곡 메뉴). 고른 트랙(비울 트랙)의 음을 같은 소리 묶음의 다른 트랙(남길 트랙)이 쉬는 자리로 옮기고,
 * 다 옮기면 그 트랙을 지운다. 자리가 없는 음은 단계에 따라 다루고, 뺀 음은 하나하나 돌려줘 미리 보여 준다.
 *
 * - 1단계: 음을 빼지 않는다. 자리가 모자라면 그 트랙은 그대로 둔다 (지금까지의 화음 병합과 같은 결과를 바란다).
 * - 2단계: 겹친 음만 뺀다. 그 음이 나는 순간 같은 음 이름(같은 음·옥타브)이 다른 트랙에서 울리고 있으면 뺀다.
 * - 3단계: 자리가 없는 음은 뺀다. 다만 그 순간 가장 높은 음·가장 낮은 음(바깥 음)이면 남길 트랙의 가운데 음을 대신 빼고 넣는다
 *   (EarlGreyPie 손 규칙: 가운데 음부터 빼고 오른손 맨 위·왼손 맨 아래는 지킨다).
 * - 우선 트랙: 이 트랙 음은 어느 단계에서도 빼지 않는다. 비울 트랙이면 남길 트랙의 (단계가 허락하는) 음을 대신 빼고 넣는다.
 * - 옮기는 단위는 음 하나 또는 &로 이은 묶음 전체. 겹치거나 &가 새로 이어지는 자리에는 넣지 않는다.
 *
 * 받아들이는 기준: 게임 출력을 다시 읽은 결과가 "원래 곡에서 뺀 음만 지운 곡"과 같아야 한다.
 */

export type MergeLevel = 1 | 2 | 3;

export interface MergeTracksOptions {
  /** 비울 트랙 (음을 보내고, 다 보내면 지운다) */
  readonly remove: readonly string[];
  /** 받을 트랙 */
  readonly keep: readonly string[];
  readonly level: MergeLevel;
  /** 우선 트랙: 이 트랙 음은 빼지 않는다 */
  readonly priority?: string | undefined;
}

export interface DroppedNote {
  /** 그 음이 원래 있던 트랙 */
  readonly trackId: string;
  readonly note: Note;
}

export interface MergeTracksPlan {
  /** 음을 옮기고 뺀 곡 (글자 수 정리 전) */
  readonly song: Song;
  /** 다른 트랙으로 옮긴 음 수 */
  readonly moved: number;
  readonly dropped: readonly DroppedNote[];
  /** 옮긴 음마다 원래 트랙과 받은 트랙 (미리보기 띠용) */
  readonly moves: readonly { readonly from: string; readonly to: string; readonly note: Note }[];
  /** 다 비워 지운(또는 빈 트랙으로 남긴) 트랙 */
  readonly emptied: readonly string[];
  /** 자리가 모자라 그대로 둔 비울 트랙과, 넣지 못한 음 수 */
  readonly stuck: readonly { readonly trackId: string; readonly left: number }[];
}

const endOf = (n: Note) => add(n.start, n.dur);
const sorted = (notes: readonly Note[]) => [...notes].sort((a, b) => cmp(a.start, b.start));

/** 두 시간 구간이 겹치는지 */
const overlaps = (a0: Rat, a1: Rat, b0: Rat, b1: Rat) => cmp(a0, b1) < 0 && cmp(b0, a1) < 0;

/**
 * 음을 옮기고 뺄 계획. keepEmpty면 다 비운 트랙도 빈 트랙으로 남긴다 (지우면 악보 나뉨이 바뀔 때)
 */
export function planTrackMerge(song: Song, options: MergeTracksOptions, keepEmpty = false): MergeTracksPlan {
  const keep = options.keep.filter((id) => song.tracks.some((t) => t.id === id));
  const state = new Map(song.tracks.map((t) => [t.id, sorted(t.notes)]));
  const origin = new Map<Note, string>();
  for (const t of song.tracks) for (const n of t.notes) origin.set(n, t.id);
  const group = [...new Set([...keep, ...options.remove])];
  const priority = options.priority;
  const dropped: DroppedNote[] = [];
  const emptied: string[] = [];
  const stuck: { trackId: string; left: number }[] = [];
  const moves: { from: string; to: string; note: Note }[] = [];

  /** 그 순간 묶음 트랙들에서 울리는 음 (옮긴 음은 받은 트랙에만, 뺀 음은 어디에도 없다) */
  const sounding = (at: Rat) => group.flatMap((id) => state.get(id) ?? []).filter((n) => cmp(n.start, at) <= 0 && cmp(at, endOf(n)) < 0);
  /** 묶음의 모든 음이, 그 음이 나는 순간 다른 음이 같은 음 이름(같은 음·옥타브)으로 울리고 있는지 (2단계) */
  const doubled = (unit: readonly Note[]) => unit.every((n) => sounding(n.start).some((m) => !unit.includes(m) && (m.pitch - n.pitch) % 12 === 0));
  /** 묶음 어느 음이든 그 순간 가장 높거나 가장 낮은 음인지 (바깥 음) */
  const outer = (unit: readonly Note[]) =>
    unit.some((n) => {
      const pitches = [...sounding(n.start).filter((m) => !unit.includes(m)).map((m) => m.pitch), n.pitch];
      return pitches.length > 1 && (n.pitch >= Math.max(...pitches) || n.pitch <= Math.min(...pitches));
    });
  const own = (unit: readonly Note[]) => origin.get(unit[0]!) ?? "";
  /** 이 단계에서 그냥 뺄 수 있는 묶음인지: 2단계는 겹친 음, 3단계는 가운데 음. 우선 트랙 음은 늘 못 뺀다 */
  const droppable = (unit: readonly Note[]) => {
    if (own(unit) === priority) return false;
    if (options.level === 2) return doubled(unit);
    if (options.level === 3) return !outer(unit);
    return false;
  };
  const without = (id: string, notes: Iterable<Note>) => {
    const out = new Set(notes);
    state.set(id, state.get(id)!.filter((n) => !out.has(n)));
  };

  const order = options.remove
    .filter((id) => !keep.includes(id) && state.has(id))
    .sort((a, b) => (state.get(a)?.length ?? 0) - (state.get(b)?.length ?? 0));
  for (const from of order) {
    // 트랙 하나를 다 비울 수 있을 때만 바꾼다. 못 비우면 그 트랙 몫은 모두 되돌린다
    const before = new Map([...state].map(([k, v]) => [k, [...v]]));
    const lost: DroppedNote[] = [];
    const went: { from: string; to: string; note: Note }[] = [];
    let left = 0;
    for (const unit of noteChains(state.get(from)!)) {
      const start = unit[0]!.start;
      const end = endOf(unit[unit.length - 1]!);
      // 쉬는 자리가 있으면 앞뒤 음 높이가 가장 가까운 트랙으로 (음을 빼는 것보다는 선율이 튀는 편이 낫다)
      let best: string | undefined;
      let bestCost = Infinity;
      for (const to of keep) {
        const cost = mergeFit(state.get(to)!, unit, Infinity);
        if (cost < bestCost) {
          bestCost = cost;
          best = to;
        }
      }
      if (best !== undefined) {
        without(from, unit);
        state.set(best, sorted([...state.get(best)!, ...unit]));
        went.push(...unit.map((note) => ({ from, to: best!, note })));
        continue;
      }
      if (options.level === 1) {
        left += unit.length;
        continue;
      }
      if (droppable(unit)) {
        without(from, unit);
        lost.push(...unit.map((note) => ({ trackId: own(unit), note })));
        continue;
      }
      // 지켜야 할 음(우선 트랙 음, 3단계의 바깥 음, 2단계의 겹치지 않은 음): 남길 트랙에서 그 자리 음을 대신 빼고 넣어 본다.
      // 대신 뺄 음도 이 단계에서 뺄 수 있는 음이어야 하고, 뺄 음이 가장 적은 트랙을 고른다
      let swap: { to: string; victims: Note[][] } | undefined;
      for (const to of keep) {
        const chains = noteChains(state.get(to)!).filter((c) => overlaps(c[0]!.start, endOf(c[c.length - 1]!), start, end));
        if (chains.length === 0 || !chains.every((c) => droppable(c))) continue;
        const victims = new Set(chains.flat());
        if (mergeFit(state.get(to)!.filter((n) => !victims.has(n)), unit, Infinity) === Infinity) continue;
        if (!swap || victims.size < swap.victims.flat().length) swap = { to, victims: chains };
      }
      if (swap) {
        const { to, victims } = swap;
        for (const c of victims) lost.push(...c.map((note) => ({ trackId: origin.get(note) ?? to, note })));
        without(to, victims.flat());
        without(from, unit);
        state.set(to, sorted([...state.get(to)!, ...unit]));
        went.push(...unit.map((note) => ({ from, to, note })));
        continue;
      }
      // 3단계: 바깥 음이라도 넣을 자리를 못 만들면 뺀다 (우선 트랙 음은 빼지 않는다)
      if (options.level === 3 && own(unit) !== priority) {
        without(from, unit);
        lost.push(...unit.map((note) => ({ trackId: own(unit), note })));
        continue;
      }
      left += unit.length;
    }
    if (left > 0) {
      for (const [k, v] of before) state.set(k, v);
      stuck.push({ trackId: from, left });
      continue;
    }
    emptied.push(from);
    dropped.push(...lost);
    // 옮긴 음이 뒤에서 대신 빠졌으면 옮긴 목록에서 뺀다
    const lostNotes = new Set(lost.map((d) => d.note));
    for (let i = moves.length - 1; i >= 0; i--) if (lostNotes.has(moves[i]!.note)) moves.splice(i, 1);
    moves.push(...went.filter((m) => !lostNotes.has(m.note)));
  }

  if (emptied.length === 0) return { song, moved: 0, dropped: [], moves: [], emptied: [], stuck };
  const tracks: Track[] = [];
  for (const t of song.tracks) {
    const next = state.get(t.id)!;
    const was = new Set(t.notes);
    if (next.length === t.notes.length && next.every((n) => was.has(n))) {
      tracks.push(t);
      continue;
    }
    if (next.length === 0 && emptied.includes(t.id) && !keepEmpty) continue;
    const { mml: _mml, ...rest } = t;
    tracks.push({ ...rest, notes: next });
  }
  return { song: { ...song, tracks }, moved: moves.length, dropped, moves, emptied, stuck };
}

export interface MergeTracksResult extends MergeTracksPlan {
  /** 곡을 그대로 둔 까닭: notes·tempo = 글자 수 정리를 못 함, sound = 게임 소리가 뺀 음 말고도 달라짐 */
  readonly kept?: "notes" | "tempo" | "sound";
}

/** 원래 곡에서 뺀 음만 지운 곡 (받아들이는 기준과 비교할 곡) */
function withoutDropped(song: Song, dropped: readonly DroppedNote[]): Song {
  if (dropped.length === 0) return song;
  const gone = new Set(dropped.map((d) => d.note));
  return { ...song, tracks: song.tracks.map((t) => (t.notes.some((n) => gone.has(n)) ? { ...t, notes: t.notes.filter((n) => !gone.has(n)) } : t)) };
}

/**
 * 화음 병합 창의 결과: 계획대로 옮기고 뺀 뒤 모든 트랙을 최적화 출력기로 다시 쓴다 (잠근 트랙은 글도 그대로).
 * 게임 출력이 "원래 곡에서 뺀 음만 지운 곡"과 다르면, 비운 트랙을 빈 트랙으로 남겨 다시 보고, 그래도 다르면 곡을 그대로 둔다
 */
export function mergeTracksResult(song: Song, profile: GameProfile, options: MergeTracksOptions, locked?: ReadonlySet<string>): MergeTracksResult {
  const safe: MergeTracksOptions = {
    ...options,
    keep: options.keep.filter((id) => !locked?.has(id)),
    remove: options.remove.filter((id) => !locked?.has(id)),
  };
  const players = [...new Set(song.tracks.filter((t) => safe.keep.includes(t.id) || safe.remove.includes(t.id)).map((t) => t.playerId))];
  const ends = new Map(song.tracks.map((t) => [t.id, trackEnd(t)]));
  let last: MergeTracksResult | undefined;
  for (const keepEmpty of [false, true]) {
    const plan = planTrackMerge(song, safe, keepEmpty);
    if (plan.emptied.length === 0) return plan;
    const compact = compactResult(plan.song, profile, locked, ends);
    if (compact.kept) return { ...plan, song, moved: 0, dropped: [], moves: [], emptied: [], kept: compact.kept };
    const expected = withoutDropped(song, plan.dropped);
    if (players.every((p) => gameTimeline(compact.song, profile, p) === gameTimeline(expected, profile, p))) return { ...plan, song: compact.song };
    last = { ...plan, song, moved: 0, dropped: [], moves: [], emptied: [], kept: "sound" };
  }
  return last!;
}

/** 화음 병합 창의 명령 (mergeTracksResult). 실행 취소하면 병합 전 곡으로 돌아간다 */
export function mergeTracksSong(profile: GameProfile, options: MergeTracksOptions, locked?: ReadonlySet<string>, label = "화음 병합"): Command {
  return {
    label,
    apply: (song) => mergeTracksResult(song, profile, options, locked).song,
    invert: (before) => restoreSong(before),
  };
}
