import { charLimitAt, type GameProfile, type Song } from "@mmlce/core";
import { chordsPerScore, scoreChunks } from "./clipboard.js";
import { gameChars } from "./game-output.js";
import { gameTimeline } from "./game-timeline.js";
import { slotLimitsDiffer, widestLimit } from "./track-limits.js";

/** 자리를 바꾼 악보 하나: 자리 순서대로 바꾸기 전·뒤 트랙 id */
export interface SlotSwap {
  readonly playerId: string;
  /** 그 연주자의 몇 번째 악보인지 (0부터) */
  readonly index: number;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

export interface SlotFit {
  /** 자리를 바꾼 곡. 바꾸지 않았으면 받은 곡 그대로 */
  readonly song: Song;
  readonly swaps: readonly SlotSwap[];
}

/**
 * 자리 맞추기 (설계 "자리별 글자 수 한도"). 자리마다 한도가 다른 게임(PC 1200/800/500)에서
 * 악보마다 트랙을 게임 글자 수가 큰 순으로, 자리를 한도가 큰 순으로 짝짓는다. 자리 = 악보 안 트랙 순서라
 * 트랙 순서만 바꾼다 (음·글은 그대로, 템포는 내보낼 때 새 자리로 다시 나눈다).
 * 잠근 트랙은 제자리에 두고 나머지 자리끼리만 바꾼다. 악보마다 넘친 글자 합이 줄 때만 그 악보를 바꾸고,
 * 바꾼 곡의 게임 시간표(gameTimeline)가 그대로일 때만 돌려준다 (같은 악보 안 자리만 바뀌므로 보통 같다).
 * 한도가 모두 같은 게임(모바일)이면 아무것도 하지 않는다
 */
export function fitSlots(song: Song, profile: GameProfile, locked?: ReadonlySet<string>): SlotFit {
  if (!slotLimitsDiffer(profile)) return { song, swaps: [] };
  const chords = chordsPerScore(song, profile);
  const count = (s: Song) => gameChars(s, chords, profile.maxChordsPerPlayer, widestLimit(profile));
  const was = count(song);
  const size = (id: string) => was.counts.get(id) ?? 0;

  // 악보마다 짝지어 본다
  const planned: SlotSwap[] = [];
  for (const chunk of scoreChunks(song, chords)) {
    const ids = chunk.trackIds;
    const free = ids.map((_, k) => k).filter((k) => !locked?.has(ids[k]!));
    if (free.length < 2) continue;
    const limit = (k: number) => charLimitAt(profile, k);
    // 같은 값이면 지금 순서를 지킨다 (쓸데없이 바꾸지 않게)
    const slots = [...free].sort((a, b) => limit(b) - limit(a) || a - b);
    const tracks = free.map((k) => ids[k]!).sort((a, b) => size(b) - size(a) || ids.indexOf(a) - ids.indexOf(b));
    const after = [...ids];
    slots.forEach((slot, i) => (after[slot] = tracks[i]!));
    if (after.every((id, k) => id === ids[k])) continue;
    planned.push({ playerId: chunk.playerId, index: chunk.index, before: ids, after });
  }
  if (planned.length === 0) return { song, swaps: [] };

  // 넘침은 실제 게임 글로 잰다 (템포를 다시 나누면 글자 수가 조금 달라진다)
  const overflow = (c: ReturnType<typeof count>, ids: readonly string[]) =>
    ids.reduce((sum, id) => sum + Math.max(0, (c.counts.get(id) ?? 0) - (c.limits.get(id) ?? 0)), 0);
  const all = reorder(song, planned);
  const now = count(all);
  const swaps = planned.filter((p) => overflow(now, p.after) < overflow(was, p.before));
  if (swaps.length === 0) return { song, swaps: [] };
  const next = swaps.length === planned.length ? all : reorder(song, swaps);
  if (gameTimeline(next, profile) !== gameTimeline(song, profile)) return { song, swaps: [] };
  return { song: next, swaps };
}

/** 악보마다 자리 순서를 바꾼 곡 (곡 트랙 목록에서 그 악보 트랙이 있던 자리끼리 맞바꾼다) */
function reorder(song: Song, swaps: readonly SlotSwap[]): Song {
  const to = new Map<string, string>();
  for (const s of swaps) s.before.forEach((id, k) => to.set(id, s.after[k]!));
  const byId = new Map(song.tracks.map((t) => [t.id, t]));
  return { ...song, tracks: song.tracks.map((t) => byId.get(to.get(t.id) ?? t.id)!) };
}
