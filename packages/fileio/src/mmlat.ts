import { emptySong, INSTRUMENTS, type InstrumentRef, type Player, type Song, type TempoEvent, type Track } from "@mmlce/core";
import { channelToTrack, idMaker, mergeTempo, type ChannelTempo, type FileDiagnostic } from "./common.js";
import type { ReadResult } from "./threemle.js";

/**
 * 게임에 붙여넣는 글 "MML@트랙1,트랙2,...;" (PC 마비노기와 같은 형식)을 읽는다.
 * 글 안에 MML@ 악보가 여러 개 있으면 각각을 연주자 한 명으로 본다(같이 연주하는 합주).
 * 마지막 ; 가 없어도 글 끝까지를 악보로 읽는다.
 */
export function findMmlAt(text: string): string[][] {
  const scores: string[][] = [];
  for (const m of text.matchAll(/MML@([^;]*)(;|$)/gi)) {
    scores.push(m[1]!.split(",").map((t) => t.trim()));
  }
  return scores;
}

export interface MmlAtOptions {
  /** 연주자 악기. 글에는 악기 정보가 없으므로 고른 악기를 쓴다 (기본 피아노) */
  readonly instrument?: InstrumentRef;
  /** 연주자 이름 앞부분 (기본 "연주자") */
  readonly playerName?: string;
}

export function readMmlAt(text: string, options: MmlAtOptions = {}): ReadResult {
  const piano = INSTRUMENTS.find((i) => i.id === "piano")!;
  const instrument: InstrumentRef = options.instrument ?? { canonical: piano.id, program: piano.program! };
  const prefix = options.playerName ?? "연주자";
  const diagnostics: FileDiagnostic[] = [];
  const players: Player[] = [];
  const tracks: Track[] = [];
  const tempo: ChannelTempo[] = [];
  const nextNoteId = idMaker("n");

  const scores = findMmlAt(text);
  if (scores.length === 0) diagnostics.push({ level: "error", code: "mmlat-not-found", span: [0, 0], where: "" });
  scores.forEach((parts, k) => {
    const player: Player = { id: `p${k + 1}`, name: `${prefix} ${k + 1}`, instrument };
    players.push(player);
    parts.forEach((part, i) => {
      tracks.push(
        channelToTrack({ name: `${player.name}-${i + 1}`, text: part, player }, tracks.length, nextNoteId, tempo, diagnostics),
      );
    });
  });

  const song: Song = {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: mergeTempo(tempo),
    players,
    tracks,
  };
  return { song, diagnostics };
}

/** 3MLE·마비꼬 파일이 아니고 MML@ 악보가 들어 있는 글인지 */
export function looksLikeMmlAt(text: string): boolean {
  return !/^\s*\[[^\]]+\]\s*$/m.test(text) && /MML@/i.test(text);
}
