import { maxChordsOf, type GameProfile, type Song } from "@mmlce/core";

/**
 * 게임에 붙여넣는 글. 악보 하나 = "MML@트랙1,트랙2,...;" (PC 마비노기와 같은 형식).
 * 한 번에 붙여넣는 것은 악보 하나(연주자 한 명, 최대 maxChordsPerPlayer 트랙)뿐이다.
 */
export function mmlAt(texts: readonly string[]): string {
  return `MML@${texts.join(",")};`;
}

export interface PlayerScore {
  readonly playerId: string;
  /** 연주자 한 명이 한도보다 많은 트랙을 가졌으면 악보를 여러 개로 나눈다 (0부터) */
  readonly index: number;
  readonly trackIds: readonly string[];
  readonly text: string;
}

/** 악보 하나에 드는 트랙: 연주자 순서대로, 연주자마다 곡의 트랙 순서대로 maxChords개씩 */
export interface ScoreChunk {
  readonly playerId: string;
  /** 연주자 한 명이 한도보다 많은 트랙을 가졌으면 악보를 여러 개로 나눈다 (0부터) */
  readonly index: number;
  readonly trackIds: readonly string[];
}

/** 연주자마다 악보 하나에 담는 트랙 수 (연주자 악기의 화음 수 한도) */
export function chordsPerScore(song: Song, profile: GameProfile): (playerId: string) => number {
  return (id) => maxChordsOf(profile, song.players.find((p) => p.id === id)?.instrument.canonical);
}

/**
 * 곡의 트랙을 게임 악보 단위로 묶는다. 트랙이 maxChords보다 많은 연주자는 maxChords개씩 끊어 악보를 더 만든다
 * (오르골처럼 화음 수가 적은 악기는 그만큼씩: 오르골 6트랙 = 3+3, 오르골 두 대)
 */
export function scoreChunks(song: Song, maxChords: number | ((playerId: string) => number)): ScoreChunk[] {
  const out: ScoreChunk[] = [];
  for (const player of song.players) {
    const size = Math.max(1, typeof maxChords === "number" ? maxChords : maxChords(player.id));
    const mine = song.tracks.filter((t) => t.playerId === player.id).map((t) => t.id);
    for (let i = 0; i * size < mine.length; i++) out.push({ playerId: player.id, index: i, trackIds: mine.slice(i * size, (i + 1) * size) });
  }
  return out;
}

/**
 * 채널별 글을 연주자마다 악보 하나로 묶는다 (scoreChunks와 같은 묶음). 글이 없는 트랙은 뺀다
 */
export function playerScores(
  song: Song,
  texts: readonly { readonly trackId: string; readonly text: string }[],
  maxChords: number | ((playerId: string) => number),
): PlayerScore[] {
  return scoreChunks(song, maxChords).flatMap((chunk) => {
    const mine = chunk.trackIds.map((id) => texts.find((x) => x.trackId === id)).filter((x): x is { trackId: string; text: string } => x !== undefined);
    return mine.length === 0 ? [] : [{ ...chunk, trackIds: mine.map((x) => x.trackId), text: mmlAt(mine.map((x) => x.text)) }];
  });
}
