import { charLimitAt, type GameProfile, type Song } from "@mmlce/core";
import { chordsPerScore } from "./clipboard.js";
import { distributeChords, type BookFit } from "./distribute.js";
import { settleDistributed } from "./edit.js";
import { gameScores } from "./game-output.js";
import { fitSlots } from "./slot-fit.js";
import { widestLimit } from "./track-limits.js";

/**
 * 파트마다 이어 읽는 악보책 (profile.scoreBook.perPart, PC 자브키엘의 악보집).
 * 게임은 장마다 같은 파트의 글을 이어 읽으므로, 파트(자리)마다 게임 글을 그 자리 한도에서 끊고 k번째 조각끼리 k번째 장에 담는다.
 * 장 머리에 템포·옥타브·길이·볼륨을 다시 적지 않고 끝을 채우지도 않는다: 조각을 이으면 원래 글과 똑같다.
 * 끊는 자리는 명령 경계뿐이다 (음·명령 가운데, & 바로 앞뒤에서는 끊지 않는다). 모바일 악보책(splitSong)과는 따로다
 */
export interface PartScroll {
  /** 붙여넣을 글 (MML@…;) */
  readonly text: string;
  /** 파트마다 이 장에 든 글 (조각이 모자란 파트는 빈 글) */
  readonly parts: readonly string[];
}

export interface PartBook {
  readonly playerId: string;
  /** 같은 연주자의 몇 번째 악보인지 (0부터) */
  readonly index: number;
  /** 파트마다 트랙 id (null은 빈 파트) */
  readonly trackIds: readonly (string | null)[];
  /** 파트마다 자리 한도 */
  readonly limits: readonly number[];
  readonly scrolls: readonly PartScroll[];
  /** 명령 경계에서 한도 안으로 끊을 수 없어(& 사슬이 한도보다 김 등) 한도를 넘긴 조각이 있는 트랙 */
  readonly stuck: readonly string[];
}

export interface PartSplit {
  readonly books: readonly PartBook[];
  /** 가장 많은 장 수 (악보책 하나에 담아야 하는 장 수) */
  readonly scrolls: number;
}

/** 글을 명령 하나씩 (음·쉼표·명령은 이어지는 숫자·#·+·-·.까지 한 덩어리, <·>·&는 한 글자) */
export function mmlTokens(text: string): string[] {
  const out: string[] = [];
  let k = 0;
  while (k < text.length) {
    let j = k + 1;
    if (/[a-zA-Z]/.test(text[k]!)) while (j < text.length && /[0-9#+\-.]/.test(text[j]!)) j++;
    out.push(text.slice(k, j));
    k = j;
  }
  return out;
}

/**
 * 글을 limit 글자 안 조각으로 끊는다. 이으면 원래 글과 같다. 끊는 자리는 명령 경계이고 & 바로 앞뒤는 피한다.
 * 피할 수 없으면(한 덩어리가 한도보다 김) 명령 경계에서 끊고 stuck
 */
export function cutText(text: string, limit: number): { pieces: string[]; stuck: boolean } {
  if (text.length <= limit) return { pieces: text ? [text] : [], stuck: false };
  const tokens = mmlTokens(text);
  const pieces: string[] = [];
  let stuck = false;
  let start = 0;
  while (start < tokens.length) {
    let size = 0;
    let end = start;
    /** 마지막으로 끊을 수 있는 자리 (그 앞까지 담는다) */
    let good = -1;
    while (end < tokens.length && size + tokens[end]!.length <= limit) {
      size += tokens[end]!.length;
      end++;
      if (end < tokens.length && tokens[end - 1] !== "&" && tokens[end] !== "&") good = end;
    }
    if (end === tokens.length) good = end;
    if (good <= start) {
      // & 사슬 등으로 한도 안에 끊을 자리가 없다: 명령 경계에서 끊는다 (한 명령이 한도보다 길면 그 명령만 담는다)
      stuck = true;
      good = Math.max(end, start + 1);
    }
    pieces.push(tokens.slice(start, good).join(""));
    start = good;
  }
  return { pieces, stuck };
}

/** 곡을 파트마다 이어 읽는 악보책으로 (게임 글은 gameScores와 같다) */
export function splitParts(song: Song, profile: GameProfile): PartSplit {
  const chords = chordsPerScore(song, profile);
  const indexOf = new Map<string, number>();
  const books = gameScores(song, chords, profile.maxChordsPerPlayer, widestLimit(profile)).map((score): PartBook => {
    const index = indexOf.get(score.playerId) ?? 0;
    indexOf.set(score.playerId, index + 1);
    const written = new Map(score.texts.map((x) => [x.trackId, x.text]));
    const limits = score.pasted.map((_, k) => charLimitAt(profile, k));
    const stuck: string[] = [];
    const cut = score.pasted.map((id, k) => {
      if (id === null) return [];
      const r = cutText(written.get(id) ?? "", limits[k]!);
      if (r.stuck) stuck.push(id);
      return r.pieces;
    });
    const count = Math.max(1, ...cut.map((c) => c.length));
    const scrolls = Array.from({ length: count }, (_, s) => {
      const parts = cut.map((c) => c[s] ?? "");
      return { parts, text: `MML@${parts.join(",")};` };
    });
    return { playerId: score.playerId, index, trackIds: score.pasted, limits, scrolls, stuck };
  });
  return { books, scrolls: Math.max(0, ...books.map((b) => b.scrolls.length)) };
}

/** 장 수를 줄이는 음 옮기기 (자리 맞추기 + 같은 악기 트랙끼리 분산). 적용은 distributeSong(profile, label, fit, locked) */
export interface FewerScrolls {
  readonly from: number;
  readonly to: number;
  readonly fit: BookFit;
}

/** 파트 글자 수를 "자리 한도 × 장 수"에 맞춰 고르게 하면 장이 줄어드는지 (한 장 적게부터 차례로) */
export function fewerScrolls(song: Song, profile: GameProfile, locked?: ReadonlySet<string>): FewerScrolls | undefined {
  const from = splitParts(song, profile).scrolls;
  if (from < 2) return undefined;
  const fitted = fitSlots(song, profile, locked).song;
  let best: FewerScrolls | undefined;
  for (let target = from - 1; target >= 1; target--) {
    let found = false;
    // 장 머리를 다시 적지 않으므로 거의 한도까지 채울 수 있다. 명령 경계에서 끊는 몫만 조금 남긴다
    for (const share of [0.98, 0.94, 0.9]) {
      const fit: BookFit = { books: target, share };
      const moved = distributeChords(fitted, profile, { fit, ...(locked ? { locked } : {}) });
      const settled = moved.moved === 0 ? { song: fitted } : settleDistributed(fitted, moved.song, profile, locked);
      if (settled.kept) continue;
      const to = splitParts(settled.song, profile).scrolls;
      if (to < (best?.to ?? from)) best = { from, to, fit };
      if (to <= target) {
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  return best;
}
