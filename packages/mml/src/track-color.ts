import type { Song } from "@mmlce/core";

/** 트랙을 만들 때 주는 기본 6색 (3MLE·마비꼬와 비슷한 색을 차례로). 파일에 저장되는 값 */
export const TRACK_COLORS: readonly string[] = ["#4f8cff", "#ff7a59", "#2bb673", "#b061ff", "#f2b705", "#00b8d9"];

/**
 * 악보(연주자)에 새로 넣는 트랙의 색: 그 악보 트랙이 아직 안 쓰는 기본 색 중 앞의 것.
 * 다 쓰고 있으면 그 악보 트랙 수 차례의 색. 한 번 정한 색은 트랙을 옮겨도 그대로 둔다
 */
export function newTrackColor(song: Pick<Song, "tracks">, playerId: string): string {
  const mine = song.tracks.filter((t) => t.playerId === playerId);
  const used = new Set(mine.map((t) => t.color.toLowerCase()));
  return TRACK_COLORS.find((c) => !used.has(c)) ?? TRACK_COLORS[mine.length % TRACK_COLORS.length]!;
}
