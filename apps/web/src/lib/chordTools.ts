import { add, cmp, toFloat, ZERO, type GameProfile, type Rat, type Song } from "@mmlce/core";
import { soundGroups, trackSource, type MergeLevel } from "@mmlce/mml";

/**
 * 화음 분산·병합 창(곡 메뉴)이 함께 쓰는 계산. 곡을 바꾸지 않는다 (바꾸는 명령은 @mmlce/mml spread·merge-tracks).
 */

/** 트랙 글자 수 (화면에 보이는 글 그대로) */
export function trackChars(song: Song, id: string): number {
  const track = song.tracks.find((t) => t.id === id);
  return track ? trackSource(song, track).text.length : 0;
}

/** 분산 창이 처음 고를 보내는 트랙: 주면 그 트랙, 아니면 한도를 가장 많이 넘는 잠그지 않은 트랙, 없으면 가장 긴 트랙 */
export function defaultSpreadSource(song: Song, limit: number, locked: ReadonlySet<string>, wanted?: string): string | undefined {
  const open = song.tracks.filter((t) => !locked.has(t.id));
  if (wanted && open.some((t) => t.id === wanted)) return wanted;
  const sized = open.map((t) => ({ id: t.id, chars: trackChars(song, t.id) })).sort((a, b) => b.chars - a.chars);
  return sized.find((x) => x.chars > limit)?.id ?? sized[0]?.id;
}

/** 병합할 수 있는 트랙 묶음: 같은 악보·같은 악기(끄기·솔로·채널 볼륨·팬도 같음)인 잠그지 않은 트랙이 둘 이상 */
export function mergeGroups(song: Song, profile: GameProfile, locked: ReadonlySet<string>): string[][] {
  const groups = soundGroups(song, profile);
  const byKey = new Map<string, string[]>();
  for (const t of song.tracks) {
    if (locked.has(t.id)) continue;
    const key = groups.get(t.id)!;
    byKey.set(key, [...(byKey.get(key) ?? []), t.id]);
  }
  return [...byKey.values()].filter((ids) => ids.length > 1);
}

export type MergeRole = "keep" | "remove" | "skip";

/** 처음 역할: 음이 가장 적은 트랙 하나를 비우고 나머지는 남긴다 */
export function defaultMergeRoles(song: Song, ids: readonly string[]): Record<string, MergeRole> {
  const count = (id: string) => song.tracks.find((t) => t.id === id)?.notes.length ?? 0;
  const sparse = [...ids].sort((a, b) => count(a) - count(b) || ids.indexOf(b) - ids.indexOf(a))[0];
  return Object.fromEntries(ids.map((id) => [id, id === sparse ? "remove" : "keep"]));
}

/** 처음 우선 트랙: 그 묶음에서 "멜로디"로 표시한 트랙 */
export function defaultPriority(song: Song, ids: readonly string[]): string | undefined {
  return ids.find((id) => song.tracks.find((t) => t.id === id)?.role === "melody");
}

export const MERGE_LEVELS: readonly MergeLevel[] = [1, 2, 3];

/** 화음 병합 단계 기억 */
export const MERGE_LEVEL_KEY = "mmlce.mergeLevel";

export function parseMergeLevel(raw: string | null): MergeLevel {
  return raw === "2" ? 2 : raw === "3" ? 3 : 1;
}

const NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];

/** 음 높이를 MML 이름으로 (o4c = 60) */
export function pitchLabel(pitch: number): string {
  return `o${Math.floor(pitch / 12) - 1}${NAMES[((pitch % 12) + 12) % 12]}`;
}

/** 곡 끝 (가장 늦게 끝나는 음) */
export function songEnd(song: Song): Rat {
  let end = ZERO;
  for (const t of song.tracks) for (const n of t.notes) if (cmp(add(n.start, n.dur), end) > 0) end = add(n.start, n.dur);
  return end;
}

/** 미리보기 띠의 가로 위치 (0~1) */
export function spanX(at: Rat, end: Rat): number {
  const e = toFloat(end);
  return e > 0 ? Math.min(1, Math.max(0, toFloat(at) / e)) : 0;
}
