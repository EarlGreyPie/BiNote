import { charLimitAt, type GameProfile, type Song } from "@mmlce/core";
import { chordsPerScore, scoreChunks } from "./clipboard.js";

/**
 * 트랙마다 글자 수 한도 (설계 "자리별 글자 수 한도"). 자리 = 그 악보(scoreChunks) 안에서 곡 트랙 순서이고,
 * 값은 프로필의 자리 한도(charLimitAt)다. 따로 저장하는 자리 값은 없다: 트랙 목록의 순서가 곧 멜로디·화음1·화음2.
 * 글자 수를 맞추거나 견주는 기능은 모두 숫자 하나(profile.charLimitPerScore) 대신 이 표에서 트랙의 한도를 읽는다.
 * 모바일처럼 모든 자리 한도가 같은 게임이면 표의 값이 모두 같다
 */
export type TrackLimits = ReadonlyMap<string, number>;

export function trackLimits(song: Song, profile: GameProfile): Map<string, number> {
  const out = new Map<string, number>();
  for (const chunk of scoreChunks(song, chordsPerScore(song, profile))) chunk.trackIds.forEach((id, k) => out.set(id, charLimitAt(profile, k)));
  return out;
}

/** 표에서 트랙의 한도. 표에 없는 트랙(곡에 없는 id)은 가장 큰 자리 한도 */
export function limitOf(limits: TrackLimits, trackId: string, profile: GameProfile): number {
  return limits.get(trackId) ?? widestLimit(profile);
}

/** 이 게임에서 가장 큰 자리 한도 (안내 문구에 한 숫자로 적을 때만) */
export function widestLimit(profile: GameProfile): number {
  return profile.charLimitPerScore;
}

/** 자리마다 한도가 다른 게임인지 (내보내기 창에서 붙이는 순서를 바꾸면 자리가 달라진다) */
export function slotLimitsDiffer(profile: GameProfile): boolean {
  return (profile.trackCharLimits ?? []).some((x) => x !== profile.charLimitPerScore);
}
