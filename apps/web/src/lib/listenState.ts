import type { Song } from "@mmlce/core";

/** 지금 재생에 걸린 끄기(M)·솔로(S) 상태. 이름이 빈 트랙은 순서 번호로 부른다 */
export interface ListenState {
  readonly solo: readonly string[];
  readonly muted: readonly string[];
}

export function listenState(song: Song, unnamed: (n: number) => string): ListenState {
  const named = song.tracks.map((tr, k) => ({ tr, name: tr.name || unnamed(k + 1) }));
  return {
    solo: named.filter(({ tr }) => tr.solo).map(({ name }) => name),
    muted: named.filter(({ tr }) => tr.mute).map(({ name }) => name),
  };
}

/** 재생에서 이 트랙이 소리 나는지 (재생 일정과 같은 규칙: 끄면 안 나고, 솔로가 하나라도 있으면 솔로 트랙만) */
export function audible(song: Song, trackId: string): boolean {
  const track = song.tracks.find((tr) => tr.id === trackId);
  if (!track || track.mute) return false;
  return track.solo || !song.tracks.some((tr) => tr.solo);
}
