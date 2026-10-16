import { cmp, type Song } from "@mmlce/core";
import { mmlAt, scoreChunks, type ScoreChunk } from "./clipboard.js";
import { sameSound } from "./compare.js";
import { parseTrackText, trackSource } from "./edit.js";
import { optimizeMml } from "./optimizer.js";
import { placeTempoByScore, type TempoMove } from "./tempo-placement.js";

/** 게임에 붙여넣을 악보 하나 */
export interface GameScore extends ScoreChunk {
  /** 트랙마다 넣을 글 (악보 안 트랙 순서) */
  readonly texts: readonly { readonly trackId: string; readonly text: string }[];
  /** 붙여넣을 글 전체 (MML@트랙1,트랙2,...;) */
  readonly text: string;
  /** 출력기로 정확히 쓸 수 없어 화면의 글을 그대로 쓴 트랙 (템포가 빠졌을 수 있다) */
  readonly asIs: readonly string[];
  /** 음을 쪼갤 수 없어 뒤쪽 음 경계로 옮겨 쓴 템포 */
  readonly moved: readonly TempoMove[];
}

/**
 * 곡을 게임 악보 단위로 쓴다. 게임은 악보(연주자)마다 따로 붙여넣으므로 곡 템포를 악보마다 넣는다
 * (곡 전체에 한 번만 넣으면 그 채널이 없는 악보는 기본 템포로 친다). 글은 최적화 출력기로 다시 쓰고
 * (출력기는 사용자가 쓴 원문보다 길게 쓰지 않는다), 다시 읽은 음이 원래 음과 다르면
 * (출력기가 쓸 수 없는 길이) 그 트랙만 화면의 글을 그대로 쓴다.
 * 템포 자리가 그 악보 모든 채널에서 음 가운데라 정확히 쪼갤 수 없으면 뒤쪽 가장 가까운 음 경계로 옮겨 쓰고 moved에 적는다.
 */
export function gameScores(song: Song, maxChords: number | ((playerId: string) => number)): GameScore[] {
  const moved = new Map<string, TempoMove[]>();
  const placed = placeTempoByScore(song, maxChords, moved);
  return scoreChunks(song, maxChords).map((chunk) => {
    const tracks = chunk.trackIds.map((id) => song.tracks.find((t) => t.id === id)!);
    const notes = tracks.map((t) => [...t.notes].sort((a, b) => cmp(a.start, b.start)));
    const asIs: string[] = [];
    const texts = tracks.map((t, k) => {
      const text = optimizeMml(notes[k]!, { tempo: placed.get(t.id) ?? [] }).text;
      if (sameSound(parseTrackText(t.id, { text }).notes, notes[k]!)) return { trackId: t.id, text };
      asIs.push(t.id);
      return { trackId: t.id, text: trackSource(song, t).text };
    });
    return { ...chunk, texts, text: mmlAt(texts.map((x) => x.text)), asIs, moved: moved.get(chunk.trackIds[0]!) ?? [] };
  });
}
