import { cmp, type Song } from "@mmlce/core";
import { mmlAt, pasteTrackIds, scoreChunks, type ScoreChunk } from "./clipboard.js";
import { sameSound } from "./compare.js";
import { parseTrackText, trackSource } from "./edit.js";
import { optimizeMml } from "./optimizer.js";
import { placeTempoByScore, type TempoMove } from "./tempo-placement.js";

/** 게임에 붙여넣을 악보 하나 */
export interface GameScore extends ScoreChunk {
  /** 트랙마다 넣을 글 (악보 안 트랙 순서) */
  readonly texts: readonly { readonly trackId: string; readonly text: string }[];
  /** 붙여넣을 글 전체 (MML@트랙1,트랙2,...;). 오르골·축음기는 소리 내지 않는 나머지 트랙도 뒤에 붙는다 (pasteTrackIds) */
  readonly text: string;
  /** 붙여넣는 글의 채널 (null은 빈 채널). 오르골·축음기는 소리 칸 뒤에 소리 내지 않는 나머지 트랙이 붙는다 */
  readonly pasted: readonly (string | null)[];
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
export function gameScores(
  song: Song,
  maxChords: number | ((playerId: string) => number),
  /** 게임 악보 하나의 트랙 한도 (profile.maxChordsPerPlayer). 주면 오르골·축음기 악보에 나머지 트랙을 붙인다 */
  pasteLimit?: number,
): GameScore[] {
  const moved = new Map<string, TempoMove[]>();
  const placed = placeTempoByScore(song, maxChords, moved);
  const chunks = scoreChunks(song, maxChords);
  /** 트랙마다 쓴 글. 출력기로 정확히 쓸 수 없으면 화면의 글 그대로 (asIs) */
  const written = new Map<string, { text: string; asIs: boolean }>();
  for (const id of chunks.flatMap((c) => c.trackIds)) {
    const t = song.tracks.find((x) => x.id === id)!;
    const notes = [...t.notes].sort((a, b) => cmp(a.start, b.start));
    const text = optimizeMml(notes, { tempo: placed.get(t.id) ?? [] }).text;
    written.set(id, sameSound(parseTrackText(t.id, { text }).notes, notes) ? { text, asIs: false } : { text: trackSource(song, t).text, asIs: true });
  }
  return chunks.map((chunk) => {
    const texts = chunk.trackIds.map((trackId) => ({ trackId, text: written.get(trackId)!.text }));
    const asIs = chunk.trackIds.filter((id) => written.get(id)!.asIs);
    const pasted = pasteTrackIds(song, chunk, maxChords, pasteLimit);
    return { ...chunk, texts, text: mmlAt(pasted.map((id) => (id === null ? "" : written.get(id)!.text))), pasted, asIs, moved: moved.get(chunk.trackIds[0]!) ?? [] };
  });
}
