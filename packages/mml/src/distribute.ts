import { add, cmp, eq, trackInstrument, type GameProfile, type Note, type Rat, type Song, type Track } from "@mmlce/core";
import { chordsPerScore } from "./clipboard.js";
import { optimizeMml } from "./optimizer.js";
import { placeTempoByScore } from "./tempo-placement.js";

/**
 * 화음 분산 (설계 8장). 같은 연주자 안에서 글자 수가 넘치는 채널의 음 묶음을
 * 그 시간에 비어 있는 다른 채널로 옮긴다. 같은 악기 안에서 옮기므로 소리는 같다.
 *
 * 묶음 = 넘치는 채널에서 받는 채널이 쉬는 동안 이어지는 음들(&로 이어진 음은 함께).
 * 넘친 글자 수에 가장 가까운 묶음부터 옮겨 보고, 받는 채널이 넘치면 되돌린다.
 */
export interface DistributeResult {
  readonly song: Song;
  /** 옮긴 음 수 */
  readonly moved: number;
  /** 그래도 한도를 넘는 트랙 id */
  readonly over: string[];
}

/** 한 연주자에서 시도할 최대 옮기기 횟수 */
const MAX_MOVES = 200;

export function distributeChords(song: Song, profile: GameProfile): DistributeResult {
  const limit = profile.charLimitPerScore;
  let tracks = song.tracks.map((t) => ({ ...t, notes: [...t.notes].sort((a, b) => cmp(a.start, b.start)) }));
  let moved = 0;

  // 템포 자리는 처음 한 번 정해 두고 어림한다 (옮기는 동안 매번 다시 정하면 느리다)
  // 게임에는 악보마다 템포를 넣으므로 악보마다 자리를 정한다
  const placedBy = placeTempoByScore({ ...song, tracks }, chordsPerScore(song, profile));
  const placed = tracks.map((t) => placedBy.get(t.id) ?? []);
  const lengthOf = (k: number) => optimizeMml(tracks[k]!.notes, { tempo: placed[k] ?? [] }).text.length;
  let sizes = tracks.map((_, k) => lengthOf(k));

  // 같은 악보 안에서도 트랙마다 악기가 다를 수 있으니, 실제 악기가 같은 트랙끼리만 옮긴다 (소리가 바뀌지 않게)
  const groups = new Map<string, number[]>();
  tracks.forEach((t, k) => {
    const inst = trackInstrument(song, t);
    const key = `${t.playerId}|${inst.canonical}|${inst.program ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), k]);
  });
  for (const mine of groups.values()) {
    if (mine.length < 2) continue;
    const tried = new Set<string>();
    for (let step = 0; step < MAX_MOVES; step++) {
      const from = mine.reduce((a, b) => (sizes[b]! > sizes[a]! ? b : a));
      const excess = sizes[from]! - limit;
      if (excess <= 0) break;
      let done = false;
      // 여유가 많은 채널부터
      for (const to of [...mine].filter((k) => k !== from).sort((a, b) => sizes[a]! - sizes[b]!)) {
        const room = limit - sizes[to]!;
        if (room <= 0) continue;
        const runs = freeRuns(tracks[from]!.notes, tracks[to]!.notes).flatMap(halves).filter(
          (r) => !tried.has(`${from}>${to}:${r[0]!.id}:${r.length}`),
        );
        // 넘친 만큼에 가장 가까운 묶음부터 (음 하나당 대략 2.5자로 어림)
        runs.sort((a, b) => Math.abs(a.length * 2.5 - excess) - Math.abs(b.length * 2.5 - excess));
        for (const run of runs.slice(0, 8)) {
          tried.add(`${from}>${to}:${run[0]!.id}:${run.length}`);
          const ids = new Set(run.map((n) => n.id));
          const next = tracks.map((t, k) => {
            if (k === from) return { ...t, notes: t.notes.filter((n) => !ids.has(n.id)) };
            if (k === to) return { ...t, notes: [...t.notes, ...run].sort((a, b) => cmp(a.start, b.start)) };
            return t;
          });
          const before = tracks;
          tracks = next;
          const after = [...sizes];
          after[from] = lengthOf(from);
          after[to] = lengthOf(to);
          if (after[to]! <= limit && after[from]! < sizes[from]!) {
            sizes = after;
            moved += run.length;
            done = true;
            break;
          }
          tracks = before;
        }
        if (done) break;
      }
      if (!done) break;
    }
  }

  const changed = new Set<string>();
  song.tracks.forEach((t, k) => {
    if (tracks[k]!.notes.length !== t.notes.length) changed.add(t.id);
  });
  const out: Track[] = tracks.map((t) => {
    if (!changed.has(t.id)) return song.tracks.find((x) => x.id === t.id)!;
    // 음이 바뀐 트랙은 원문을 지우고 출력기가 다시 쓴다
    const { mml: _mml, ...rest } = t;
    return rest;
  });
  return {
    song: { ...song, tracks: out },
    moved,
    over: out.filter((_, k) => sizes[k]! > limit).map((t) => t.id),
  };
}

/**
 * from 채널의 음을, to 채널이 쉬는 동안 이어지는 묶음으로 나눈다.
 * &로 이어진 음은 한 묶음에 넣고, to 채널의 음과 겹치는 음이 나오면 묶음을 끊는다.
 */
export function freeRuns(from: readonly Note[], to: readonly Note[]): Note[][] {
  const runs: Note[][] = [];
  let run: Note[] = [];
  let chain: Note[] = [];
  let j = 0;
  const busy = (start: Rat, end: Rat) => {
    while (j < to.length && cmp(add(to[j]!.start, to[j]!.dur), start) <= 0) j++;
    for (let k = j; k < to.length && cmp(to[k]!.start, end) < 0; k++) {
      if (cmp(add(to[k]!.start, to[k]!.dur), start) > 0) return true;
    }
    return false;
  };
  const close = () => {
    if (run.length > 0) runs.push(run);
    run = [];
  };
  for (let i = 0; i < from.length; i++) {
    const n = from[i]!;
    chain.push(n);
    const next = from[i + 1];
    const tied = n.tie === "next" && next && eq(add(n.start, n.dur), next.start);
    if (tied) continue;
    // & 묶음 전체가 비어 있는 시간에 들어가야 옮길 수 있다
    const start = chain[0]!.start;
    const end = add(n.start, n.dur);
    if (busy(start, end)) close();
    else run.push(...chain);
    chain = [];
  }
  close();
  return runs;
}

/** 큰 묶음은 반씩 나눈 묶음도 후보로 낸다 (&로 이어진 음 사이에서는 나누지 않는다) */
function halves(run: Note[]): Note[][] {
  const out: Note[][] = [run];
  if (run.length < 8) return out;
  let mid = run.length >> 1;
  while (mid < run.length - 1 && run[mid - 1]!.tie === "next") mid++;
  if (mid <= 0 || mid >= run.length) return out;
  return [...out, ...halves(run.slice(0, mid)), ...halves(run.slice(mid))];
}
