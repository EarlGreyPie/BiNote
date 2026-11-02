import { cmp, type Note, type Song } from "@mmlce/core";

/**
 * 고른 음 가운데 쓸 줄(트랙) 고르기: 슬라이드·트릴·트레몰로·꾸밈음 창이 함께 쓴다 (아르페지오 "화음에 넣을 트랙"과 같은 생각).
 * 타브는 시간 범위로 고르면 화음 줄이 모두 들어오고, 피아노롤도 여러 트랙 음을 함께 고를 수 있어서
 * 창에서 줄을 빼면 그 줄의 고른 음은 계산에 넘기지 않고 그대로 둔다
 */

/** 고른 음이 든 트랙 (곡의 트랙 순서) */
export function pickedTracks<T extends Pick<Song["tracks"][number], "id" | "notes">>(song: { readonly tracks: readonly T[] }, picked: readonly Note[]): T[] {
  const ids = new Set(picked.map((n) => n.id));
  return song.tracks.filter((t) => t.notes.some((n) => ids.has(n.id)));
}

/** 뺀 트랙의 음을 고른 음에서 덜어 낸다 (실제로 쓸 음) */
export function pickedWithout(song: Pick<Song, "tracks">, picked: readonly Note[], excluded: ReadonlySet<string>): Note[] {
  if (excluded.size === 0) return [...picked];
  const out = new Set<string>();
  for (const t of song.tracks) if (excluded.has(t.id)) for (const n of t.notes) out.add(n.id);
  return picked.filter((n) => !out.has(n.id));
}

/** 창에서 뺀 트랙 가운데 고른 음이 든 것만 (만든 기록에 남긴다) */
export function excludedOf(song: Pick<Song, "tracks">, picked: readonly Note[], excluded: ReadonlySet<string>): string[] {
  return pickedTracks(song, picked)
    .map((t) => t.id)
    .filter((id) => excluded.has(id));
}

/** 만든 기록의 뺀 트랙 (옛 기록·모르는 값은 빈 목록: 모두 씀) */
export function parseExcluded(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

/** 기준 본음: 가장 먼저 시작하는 음 중 가장 높은 음 (화음이면 트릴·꾸밈음을 거는 음) */
export function mainNoteOf(picked: readonly Note[]): Note | undefined {
  return [...picked].sort((a, b) => cmp(a.start, b.start) || b.pitch - a.pitch)[0];
}
