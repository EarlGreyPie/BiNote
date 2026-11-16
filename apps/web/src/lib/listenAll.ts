import type { Track } from "@mmlce/core";

/**
 * 여러 트랙의 끄기·솔로를 한 번에 바꾸는 방법.
 * - mute: 모든 트랙을 끈다
 * - unmute: 모든 트랙을 켠다 (끄기·솔로 모두 푼다)
 * - only: 이 트랙만 켜고 나머지는 끈다 (솔로는 푼다)
 */
export type ListenAll = { readonly kind: "mute" } | { readonly kind: "unmute" } | { readonly kind: "only"; readonly trackId: string };

/** how대로 바꾼 트랙들. 바뀐 트랙이 없으면 같은 배열을 돌려준다 (곡을 새로 만들지 않게) */
export function listenAllTracks(tracks: readonly Track[], how: ListenAll): readonly Track[] {
  let changed = false;
  const next = tracks.map((tr) => {
    const mute = how.kind === "mute" ? true : how.kind === "unmute" ? false : tr.id !== how.trackId;
    const solo = how.kind === "mute" ? tr.solo : false;
    if (tr.mute === mute && tr.solo === solo) return tr;
    changed = true;
    return { ...tr, mute, solo };
  });
  return changed ? next : tracks;
}

/** 이 방법으로 바꿀 것이 있는지 (메뉴 항목을 막을 때) */
export function canListenAll(tracks: readonly Track[], how: ListenAll): boolean {
  return listenAllTracks(tracks, how) !== tracks;
}
