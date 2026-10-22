import { add, cmp, tieChains, type Command, type GameProfile, type Note, type Rat, type Song, type Track } from "@mmlce/core";
import { compactResult, keepTextEnd, restoreSong } from "./edit.js";
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
 * - 화음 감쇠 다시 맞추기: 2·3단계로 화음 음이 빠지면, 같은 자리에서 함께 시작하던 같은 손의 남은 음 v를 올려
 *   화음 전체 크기를 빼기 전과 맞춘다 (같은 v로 n음을 치면 perDoublingDb × log2(n) dB 커진다, 인게임 실측).
 *
 * 받아들이는 기준: 게임 출력을 다시 읽은 결과가 "원래 곡에서 뺀 음만 지우고 남은 화음 v를 다시 맞춘 곡"과 같아야 한다.
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
  /** 화음 음이 빠져 v를 올린 음 (& 사슬은 첫 음만 센다) */
  readonly louder?: readonly { readonly note: Note; readonly vol: number }[];
}

/**
 * 손 나누기: 화음 음 높이에서 가장 넓은 틈(5반음 이상)의 위쪽 음부터 오른손. 틈이 좁으면 가운데 도(60)로 나눈다
 * (MIDI 가져오기의 화음 감쇠와 같은 규칙)
 */
function handSplit(pitches: readonly number[]): number {
  const p = [...new Set(pitches)].sort((a, b) => a - b);
  let best = -1;
  let at = 60;
  for (let i = 1; i < p.length; i++) {
    const gap = p[i]! - p[i - 1]!;
    if (gap >= 5 && gap > best) {
      best = gap;
      at = p[i]!;
    }
  }
  return at;
}

/** 화음이 count음에서 left음으로 줄었을 때 남은 음 v: 화음 전체 크기가 같게 (v보다 작아지지 않고 v최대에서 멈춘다) */
export function chordVolumeAfterDrop(vol: number, count: number, left: number, profile: Pick<GameProfile, "volume" | "volumeCurve" | "chordAttenuation">): number {
  if (left < 1 || left >= count || vol <= 0) return vol;
  const { min, max } = profile.volume;
  const dbOf = (v: number) => profile.volumeCurve[v - min] ?? -Infinity;
  const target = dbOf(vol) + profile.chordAttenuation.perDoublingDb * Math.log2(count / left);
  let best = vol;
  for (let v = vol; v <= max; v++) if (Math.abs(dbOf(v) - target) < Math.abs(dbOf(best) - target)) best = v;
  return best;
}

/**
 * 뺀 음과 같은 자리에서 시작하던 같은 손의 남은 음(& 사슬 첫 음) v를 올린다. 화음은 같은 악보 묶음 트랙에서 같은 자리에 시작하는
 * 소리 나는 음으로 본다. 원래 곡 음 객체 → 새 v
 */
function louderAfterDrop(song: Song, group: readonly string[], dropped: readonly DroppedNote[], profile: GameProfile): Map<Note, number> {
  const out = new Map<Note, number>();
  if (dropped.length === 0) return out;
  const gone = new Set(dropped.map((d) => d.note));
  const heads: Note[] = [];
  for (const t of song.tracks) if (group.includes(t.id)) for (const c of tieChains(t.notes)) if (c[0]!.vol > 0) heads.push(c[0]!);
  const byStart = new Map<string, Note[]>();
  for (const n of heads) {
    const key = `${n.start.n}/${n.start.d}`;
    byStart.set(key, [...(byStart.get(key) ?? []), n]);
  }
  for (const chord of byStart.values()) {
    if (!chord.some((n) => gone.has(n)) || chord.length < 2) continue;
    const split = handSplit(chord.map((n) => n.pitch));
    for (const right of [true, false]) {
      const hand = chord.filter((n) => n.pitch >= split === right);
      const left = hand.filter((n) => !gone.has(n));
      for (const n of left) {
        const vol = chordVolumeAfterDrop(n.vol, hand.length, left.length, profile);
        if (vol !== n.vol) out.set(n, vol);
      }
    }
  }
  return out;
}

/**
 * 곡의 음 v를 바꾼다 (& 사슬 첫 음을 주면 사슬 전체). 원문 끝 쉼표로 지키던 트랙 길이는 볼륨 편집과 같이 지킨다
 * (원문을 그냥 지우면 끝 쉼표가 빠져, 받아들이는 기준과 비교할 때 악보 끝이 달라 "소리 바뀜"으로 거절된다)
 */
function withVolumes(song: Song, louder: ReadonlyMap<Note, number>): Song {
  if (louder.size === 0) return song;
  const changed = song.tracks.filter((t) => t.notes.some((n) => louder.has(n))).map((t) => t.id);
  return keepTextEnd(song, {
    ...song,
    tracks: song.tracks.map((t) => {
      if (!t.notes.some((n) => louder.has(n))) return t;
      const set = new Map<Note, number>();
      for (const c of tieChains(t.notes)) {
        const v = louder.get(c[0]!);
        if (v !== undefined) for (const n of c) set.set(n, v);
      }
      const notes = t.notes.map((n) => (set.has(n) ? { ...n, vol: set.get(n)! } : n));
      const { mml: _mml, ...rest } = t;
      return { ...rest, notes };
    }),
  }, changed);
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
    // 잠근 트랙 음은 v도 바꾸지 않는다
    const lockedNotes = new Set(song.tracks.filter((t) => locked?.has(t.id)).flatMap((t) => t.notes));
    const louder = new Map([...louderAfterDrop(song, [...new Set([...safe.keep, ...safe.remove])], plan.dropped, profile)].filter(([n]) => !lockedNotes.has(n)));
    const compact = compactResult(withVolumes(plan.song, louder), profile, locked, ends);
    if (compact.kept) return { ...plan, song, moved: 0, dropped: [], moves: [], emptied: [], kept: compact.kept };
    const expected = withVolumes(withoutDropped(song, plan.dropped), louder);
    const changed = { louder: [...louder].map(([note, vol]) => ({ note, vol })) };
    if (players.every((p) => gameTimeline(compact.song, profile, p) === gameTimeline(expected, profile, p))) return { ...plan, ...changed, song: compact.song };
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
