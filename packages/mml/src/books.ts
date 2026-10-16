import type { GameProfile, Song } from "@mmlce/core";
import { distributeChords } from "./distribute.js";
import { compactSong } from "./edit.js";
import { splitSong } from "./split.js";

/**
 * 악보책 권 수 줄이기. 권 수는 가장 긴 채널이 정하므로, 같은 악기 트랙끼리 음을 옮겨
 * 채널 길이를 고르게 하면 권이 줄 수 있다. 한 권 적게 나눌 수 있는 채널 길이를 몇 가지 시도해,
 * 실제로 나눠 봐서 줄어들면 그 길이를 알려 준다 (적용은 distributeSong(profile, label, limit)).
 */
export interface FewerBooks {
  /** 지금 권 수 */
  readonly from: number;
  /** 음을 옮긴 뒤 권 수 */
  readonly to: number;
  /** distributeChords에 줄 채널 글자 수 */
  readonly limit: number;
  /** 옮기는 음 수 */
  readonly moved: number;
}

/** 권마다 다시 적는 머리(템포·옥타브·길이)와 끝 쉼표 몫을 어림해 한도에서 뺀다 */
const SHARES = [0.95, 0.88, 0.8];

export function fewerBooks(song: Song, profile: GameProfile, books: number): FewerBooks | undefined {
  if (books < 2) return undefined;
  const target = books - 1;
  for (const share of SHARES) {
    const limit = Math.floor(profile.charLimitPerScore * target * share);
    const spread = distributeChords(song, profile, { limit });
    if (spread.moved === 0) continue;
    const next = compactSong(profile).apply(spread.song);
    const parts = splitSong(next, profile).parts.length;
    if (parts <= target) return { from: books, to: parts, limit, moved: spread.moved };
  }
  return undefined;
}
