import { add, cmp, eq, normalizeTempo, sub, type Rat, type Song, type TempoEvent } from "@mmlce/core";
import { scoreChunks } from "./clipboard.js";
import { canWriteExactly, type PrintableNote } from "./printer.js";
import { audibleTempo } from "./tempo-text.js";

/** 음을 쪼갤 수 없어 다른 자리(뒤쪽 가장 가까운 음 경계)로 옮겨 쓴 템포 */
export interface TempoMove {
  readonly bpm: number;
  /** 곡 템포 지도의 자리 */
  readonly from: Rat;
  /** 실제로 쓴 자리 */
  readonly to: Rat;
}

/**
 * 곡 템포를 어느 채널에 쓸지 고른다. MML에서 템포는 채널 본문 안의 명령이라
 * 그 위치에 음 경계나 쉼표가 있는 채널에 넣어야 음을 쪼개지 않는다.
 *
 * 우선순위: (1) 어떤 채널에서 음의 시작·끝과 딱 맞는 위치
 *          (2) 쉼표 구간 안이고 앞뒤 쉼표를 정확히 쓸 수 있는 채널
 *          (3) 음 가운데지만 &로 나눈 두 토막을 정확히 쓸 수 있는 채널
 *          (4) 그래도 없으면 음을 버리지 않도록 뒤쪽 가장 가까운 음 경계로 옮겨 쓴다 (moved에 적는다).
 *              옮길 경계가 어느 채널에도 없으면(모든 음이 끝난 뒤) 그 자리 그대로 첫 채널에 쓴다
 * 같은 순위면 글자가 덜 찬 채널(음 수 + 이미 넣은 템포 글자로 어림)을 고른다.
 * 같은 위치에 템포가 여러 개면(3MLE 파일은 채널마다 같은 템포를 적곤 한다) 마지막 하나만 쓴다.
 * 옮긴 자리까지 다음 템포가 이미 바뀌면 옮긴 템포는 들리지 않으므로 쓰지 않는다.
 */
export function placeTempo(
  channels: readonly (readonly PrintableNote[])[],
  tempo: readonly TempoEvent[],
  moved?: TempoMove[],
  /** 이 템포 다음에 빠르기가 바뀌는 자리 (생략하면 tempo 목록의 다음 템포). 다른 곳에 이미 적힌 템포를 빼고 넘길 때 쓴다 */
  nextOf?: (event: TempoEvent) => Rat | undefined,
): TempoEvent[][] {
  const out: TempoEvent[][] = channels.map(() => []);
  if (channels.length === 0) return out;
  const sorted = channels.map((c) => [...c].sort((a, b) => cmp(a.start, b.start)));
  // 음 하나에 평균 3자 정도로 어림한 채널 글자 수
  const load = sorted.map((notes) => notes.length * 3);
  const events = normalizeTempo(tempo);

  events.forEach((t, k) => {
    let best = 0;
    let bestRank = 6;
    let bestSnap: Rat | undefined;
    sorted.forEach((notes, index) => {
      const { rank, snap } = rankAt(notes, t.at);
      const better =
        rank < bestRank ||
        (rank === bestRank && rank === 4 && cmp(snap!, bestSnap!) < 0) ||
        (rank === bestRank && (rank !== 4 || cmp(snap!, bestSnap!) === 0) && load[index]! < load[best]!);
      if (better) {
        best = index;
        bestRank = rank;
        bestSnap = snap;
      }
    });
    let event = t;
    if (bestRank === 4) {
      const to = bestSnap!;
      // 옮긴 자리까지 다음 템포가 나오면 이 템포는 들리지 않는다
      const next = nextOf ? nextOf(t) : events[k + 1]?.at;
      if (next && cmp(next, to) <= 0) return;
      event = { at: to, bpm: t.bpm };
      moved?.push({ bpm: t.bpm, from: t.at, to });
    }
    out[best]!.push(event);
    load[best]! += String(t.bpm).length + 1;
  });
  return out;
}

/** 이 채널에 템포를 쓰기 좋은 정도 (작을수록 좋다). 4면 snap(뒤쪽 가장 가까운 음 경계)으로 옮겨야 하고, 5면 옮길 곳도 없다 */
function rankAt(notes: readonly PrintableNote[], at: Rat): { rank: number; snap?: Rat } {
  let prevEnd: Rat = { n: 0, d: 1 };
  for (const n of notes) {
    const end = add(n.start, n.dur);
    if (eq(n.start, at) || eq(end, at)) return { rank: 1 };
    if (cmp(at, n.start) < 0) {
      // prevEnd ~ n.start 사이 쉼표 안
      return canWriteExactly(sub(at, prevEnd)) && canWriteExactly(sub(n.start, at)) ? { rank: 2 } : { rank: 4, snap: n.start };
    }
    if (cmp(at, end) < 0) {
      return canWriteExactly(sub(at, n.start)) && canWriteExactly(sub(end, at)) ? { rank: 3 } : { rank: 4, snap: end };
    }
    prevEnd = end;
  }
  // 마지막 음 뒤: 쉼표 하나로 자리를 만든다
  return cmp(at, prevEnd) === 0 || canWriteExactly(sub(at, prevEnd)) ? { rank: cmp(at, prevEnd) === 0 ? 1 : 2 } : { rank: 5 };
}

/** 악보마다 곡 트랙 id. 연주자 목록에 없는 트랙(읽다 만 곡 등)은 연주자 id끼리 악보 하나로 본다 */
export function scoreTrackIds(song: Song, maxChords: number | ((playerId: string) => number) = Number.MAX_SAFE_INTEGER): string[][] {
  const chunks = scoreChunks(song, maxChords).map((c) => [...c.trackIds]);
  const seen = new Set(chunks.flat());
  const loose = new Map<string, string[]>();
  for (const t of song.tracks) if (!seen.has(t.id)) loose.set(t.playerId, [...(loose.get(t.playerId) ?? []), t.id]);
  return [...chunks, ...loose.values()];
}

/**
 * 곡 템포를 악보마다 모두 넣을 자리 (트랙 id → 그 트랙에 쓸 템포). 게임은 악보(연주자)마다 템포를 따로 읽으므로
 * 악보마다 placeTempo를 돌린다. 앞 템포와 빠르기가 같은 템포(들리지 않는 t)는 쓰지 않는다.
 * maxChords를 주지 않으면 연주자 하나를 악보 하나로 본다.
 * moved를 주면 음을 쪼갤 수 없어 옮겨 쓴 템포를 악보(그 악보 첫 트랙 id)마다 적는다
 */
export function placeTempoByScore(
  song: Song,
  maxChords: number | ((playerId: string) => number) = Number.MAX_SAFE_INTEGER,
  moved?: Map<string, TempoMove[]>,
): Map<string, TempoEvent[]> {
  const out = new Map<string, TempoEvent[]>();
  for (const ids of scoreTrackIds(song, maxChords)) {
    const tracks = ids.map((id) => song.tracks.find((t) => t.id === id)!);
    const list: TempoMove[] = [];
    const placed = placeTempo(
      tracks.map((t) => t.notes),
      audibleTempo(song.tempo),
      list,
    );
    tracks.forEach((t, k) => out.set(t.id, placed[k] ?? []));
    if (list.length > 0) moved?.set(ids[0]!, list);
  }
  return out;
}
