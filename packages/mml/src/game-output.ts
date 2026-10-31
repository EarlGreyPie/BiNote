import { cmp, DEFAULT_BPM, getProfile, ZERO, type GameProfile, type Song, type TempoEvent, type Track, type TrackText } from "@mmlce/core";
import { mmlAt, pasteTrackIds, scoreChunks, type ScoreChunk } from "./clipboard.js";
import { sameSound } from "./compare.js";
import { trackSource } from "./edit.js";
import { optimizeMml } from "./optimizer.js";
import { parseMml } from "./parser.js";
import { placeTempo, placeTempoByScore, type TempoMove } from "./tempo-placement.js";
import { bpmBefore, padScore, scoreEnd, tempoBefore } from "./score-end.js";
import { audibleTempo, gameSource, sameTempo, shortestWriting, spliceText, surgicalSource, tempoTokens } from "./tempo-text.js";

/** 트랙마다 게임에 넣을 글. 트랙은 고치면 새 객체가 되므로, 같은 트랙·같은 템포 자리면 다시 쓰지 않는다 */
const rewriteCache = new WeakMap<Track, { key: string; text: string | undefined }>();

/**
 * 게임에 넣을 글: 출력기로 다시 쓴 글과 원문(템포만 고치고 주석·빈칸을 벗긴 것, gameSource) 가운데
 * 다시 읽은 음과 템포가 맞는 짧은 쪽. 출력기는 원문을 보지 않으므로 원문보다 길게 쓸 때가 있어 둘을 견준다.
 * 템포까지 맞는 글이 없으면 음만 맞는 출력기 글, 그것도 아니면(출력기가 쓸 수 없는 길이 등) undefined
 */
function rewritten(track: Track, tempo: readonly TempoEvent[], profile: GameProfile): string | undefined {
  const key = JSON.stringify([tempo, profile.length, profile.octave, profile.volume]);
  const hit = rewriteCache.get(track);
  if (hit && hit.key === key) return hit.text;
  const notes = [...track.notes].sort((a, b) => cmp(a.start, b.start));
  const optimized = optimizeMml(notes, { tempo, lengths: profile.length }).text;
  // 템포까지 맞는 글이 없으면 음만 맞는 출력기 글을 쓴다 (지금까지와 같다). 출력기가 64분보다 촘촘한 템포 바꿈을
  // 한 자리에 겹쳐 써서 조금 어긋난 것이라, 화면의 글을 그대로 쓰면(asIs) 이 트랙에 맡긴 템포가 모두 빠지는 것보다 낫다
  const out =
    shortestWriting(notes, tempo, [optimized, track.mml ? gameSource(track.mml, tempo, profile) : undefined]) ??
    (sameSound(parseMml(optimized).notes, notes) ? optimized : undefined);
  rewriteCache.set(track, { key, text: out });
  return out;
}

/**
 * 처음 자리 t120은 쓰지 않는다. 게임은 붙여넣은 글에 템포가 없으면 t120으로 치므로(다른 붙여넣기에서 이어받지 않음)
 * 소리는 같고 4자를 아낀다. 끝 쉼표를 지키는 t(score-end.ts)는 따로 붙는다
 */
export function withoutDefaultStart(tempo: readonly TempoEvent[]): TempoEvent[] {
  const first = tempo[0];
  return first && cmp(first.at, ZERO) === 0 && first.bpm === DEFAULT_BPM ? tempo.slice(1) : [...tempo];
}

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
 * (곡 전체에 한 번만 넣으면 그 채널이 없는 악보는 기본 템포로 친다). 글은 트랙마다 최적화 출력기로 다시 쓴 글과
 * 템포만 고친 원문 가운데 다시 읽은 음·템포가 맞는 짧은 쪽을 쓴다(출력기 글이 원문보다 길 수 있다).
 * 음이 맞는 글이 하나도 없으면(출력기가 쓸 수 없는 길이 등) 그 트랙만 화면의 글을 그대로 쓴다.
 * 템포 자리가 그 악보 모든 채널에서 음 가운데라 정확히 쪼갤 수 없으면 뒤쪽 가장 가까운 음 경계로 옮겨 쓰고 moved에 적는다.
 */
export function gameScores(
  song: Song,
  maxChords: number | ((playerId: string) => number),
  /** 게임 악보 하나의 트랙 한도 (profile.maxChordsPerPlayer). 주면 오르골·축음기 악보에 나머지 트랙을 붙인다 */
  pasteLimit?: number,
  /** 트랙당 글자 한도 (profile.charLimitPerScore). 주면 끝 채움을 붙인 뒤에도 한도 안인 글에 먼저 붙인다 */
  charLimit?: number,
): GameScore[] {
  const moved = new Map<string, TempoMove[]>();
  const profile = getProfile(song.meta.profileId);
  const lengths = profile.length;
  const placed = placeTempoByScore({ ...song, tempo: withoutDefaultStart(audibleTempo(song.tempo)) }, maxChords, moved);
  const chunks = scoreChunks(song, maxChords);
  /** 트랙마다 쓴 글. 출력기로 정확히 쓸 수 없으면 화면의 글 그대로 (asIs) */
  const written = new Map<string, { text: string; asIs: boolean }>();
  for (const id of chunks.flatMap((c) => c.trackIds)) {
    const t = song.tracks.find((x) => x.id === id)!;
    const text = rewritten(t, placed.get(t.id) ?? [], profile);
    written.set(id, text !== undefined ? { text, asIs: false } : { text: trackSource(song, t).text, asIs: true });
  }
  // 다시 쓴 글이 원문 끝 쉼표를 잃어 악보가 짧아지지 않게 악보 길이를 지킨다 (score-end.ts)
  for (const chunk of chunks) {
    const tracks = chunk.trackIds.map((id) => song.tracks.find((x) => x.id === id)!);
    const end = scoreEnd(tracks);
    const padded = padScore(chunk.trackIds.map((id) => written.get(id)!.text), end, bpmBefore(song.tempo, end), lengths, undefined, charLimit);
    chunk.trackIds.forEach((id, k) => written.set(id, { ...written.get(id)!, text: padded[k]! }));
  }
  return chunks.map((chunk) => {
    const texts = chunk.trackIds.map((trackId) => ({ trackId, text: written.get(trackId)!.text }));
    const asIs = chunk.trackIds.filter((id) => written.get(id)!.asIs);
    const pasted = pasteTrackIds(song, chunk, maxChords, pasteLimit);
    return { ...chunk, texts, text: mmlAt(pasted.map((id) => (id === null ? "" : written.get(id)!.text))), pasted, asIs, moved: moved.get(chunk.trackIds[0]!) ?? [] };
  });
}

/**
 * 트랙마다 게임에 넣을 글의 글자 수 (악보 단위로 내보낼 때, gameScores와 같은 글).
 * 원문은 주석·줄바꿈·빈칸과 겹친 v·l까지 들어 있어 게임에 넣는 글보다 길 수 있으므로, 한도는 이 수로 견준다
 */
export function gameCharCounts(
  song: Song,
  maxChords: number | ((playerId: string) => number),
  pasteLimit?: number,
  charLimit?: number,
): Map<string, number> {
  return new Map(gameScores(song, maxChords, pasteLimit, charLimit).flatMap((s) => s.texts.map((x) => [x.trackId, x.text.length] as const)));
}

/** 고른 트랙을 한 번에 붙여넣는 글 (MML로 내보내기 창) */
export interface GamePaste {
  /** 고른 트랙 (곡 트랙 순서) */
  readonly trackIds: readonly string[];
  /** 고른 트랙마다 넣을 글 */
  readonly texts: readonly { readonly trackId: string; readonly text: string }[];
  /** 붙여넣을 글 전체 (MML@...;) */
  readonly text: string;
  /** 붙여넣는 글의 채널 (null은 빈 채널). 오르골·축음기 악보 하나를 통째로 고르면 소리 없는 나머지 트랙도 붙는다 */
  readonly pasted: readonly (string | null)[];
  /** 붙여넣는 모든 채널의 글 (소리 없는 트랙 포함) */
  readonly written: ReadonlyMap<string, string>;
  readonly asIs: readonly string[];
  readonly moved: readonly TempoMove[];
}

export interface GamePasteOptions {
  /** 템포를 넣는다. 끄면 t를 하나도 쓰지 않는다 (게임은 t120으로 친다). 끝 쉼표를 길이에 넣는 t도 t120으로 쓴다 */
  readonly tempo: boolean;
  /** 넣을 템포 지도 (생략하면 곡 템포). 고른 악보끼리 원문 템포가 다를 때 사용자가 고른 것 */
  readonly tempoMap?: readonly TempoEvent[] | undefined;
  /** 트랙당 글자 한도 (끝 채움을 한도 안 글에 먼저 붙인다) */
  readonly charLimit?: number;
  /** 붙여넣는 글 안의 고른 트랙 순서 (곡은 그대로). 없거나 빠진 트랙은 곡 트랙 순서로 뒤에 */
  readonly order?: readonly string[] | undefined;
}

/** 붙여넣는 채널에서 고른 트랙 자리만 order 순서로 다시 채운다 (빈 채널·소리 없는 트랙 자리는 그대로) */
export function orderPasted(pasted: readonly (string | null)[], selected: readonly string[], order: readonly string[] | undefined): (string | null)[] {
  if (!order || order.length === 0) return [...pasted];
  const wanted = [...order.filter((id) => selected.includes(id)), ...selected.filter((id) => !order.includes(id))];
  let k = 0;
  return pasted.map((id) => (id !== null && selected.includes(id) ? wanted[k++]! : id));
}

/** 원문에서 t를 모두 지운다 (문법 오류가 있어 손댈 수 없으면 그대로) */
function withoutTempo(source: TrackText): string {
  const s = surgicalSource(source);
  return s ? spliceText(source.text, s.tokens.map((t) => ({ span: t.span, text: "" }))) : source.text;
}

/**
 * 여러 악보에서 고른 트랙(최대 pasteLimit개)을 붙여넣는 글 하나로 쓴다. 게임은 붙여넣은 글 하나를 악보 하나로 친다:
 * 템포는 이 글 안에서만 읽고(없으면 t120, 다른 붙여넣기에서 이어받지 않는다), 길이는 가장 긴 채널로 정한다.
 * 그래서 템포를 넣으면 곡 처음 템포(없으면 t120)부터 고른 트랙에 모두 넣고, 길이는 고른 트랙 중 가장 긴 트랙에 맞춘다(padScore).
 * 고른 트랙이 오르골·축음기 악보 하나와 똑같으면 지금까지처럼 나머지 트랙을 소리 없는 채널로 붙인다 (pasteTrackIds)
 */
export function gamePaste(
  song: Song,
  selected: readonly string[],
  maxChords: number | ((playerId: string) => number),
  pasteLimit: number,
  options: GamePasteOptions,
): GamePaste {
  const profile = getProfile(song.meta.profileId);
  const lengths = profile.length;
  const order = song.tracks.map((t) => t.id);
  const trackIds = order.filter((id) => selected.includes(id));
  const chunk = scoreChunks(song, maxChords).find((c) => c.trackIds.length === trackIds.length && c.trackIds.every((id, k) => id === trackIds[k]));
  const pasted = orderPasted(chunk ? pasteTrackIds(song, chunk, maxChords, pasteLimit) : trackIds, trackIds, options.order);
  const ids = pasted.filter((id): id is string => id !== null);
  const tracks = ids.map((id) => song.tracks.find((t) => t.id === id)!);
  const end = scoreEnd(tracks);
  const map = audibleTempo(options.tempoMap ?? song.tempo);
  const startsAtZero = map.length > 0 && cmp(map[0]!.at, ZERO) === 0;
  const tempo = options.tempo ? withoutDefaultStart(tempoBefore(startsAtZero ? map : [{ at: ZERO, bpm: DEFAULT_BPM }, ...map], cmp(end, ZERO) > 0 ? end : { n: 1, d: 1 })) : [];
  const moved: TempoMove[] = [];
  const placed = placeTempo(tracks.map((t) => t.notes), tempo, moved);
  const written = new Map<string, string>();
  const asIs: string[] = [];
  tracks.forEach((t, k) => {
    const text = rewritten(t, placed[k] ?? [], profile);
    if (text !== undefined) written.set(t.id, text);
    else {
      const source = trackSource(song, t);
      written.set(t.id, options.tempo ? source.text : withoutTempo(source));
      asIs.push(t.id);
    }
  });
  const padded = padScore(ids.map((id) => written.get(id)!), end, options.tempo ? bpmBefore(tempo, end) : DEFAULT_BPM, lengths, undefined, options.charLimit);
  ids.forEach((id, k) => written.set(id, padded[k]!));
  return {
    trackIds,
    texts: trackIds.map((trackId) => ({ trackId, text: written.get(trackId)! })),
    text: mmlAt(pasted.map((id) => (id === null ? "" : written.get(id)!))),
    pasted,
    written,
    asIs: trackIds.filter((id) => asIs.includes(id)),
    moved,
  };
}

/** 고른 트랙에 넣을 수 있는 템포 하나 (어느 악보의 원문 템포인지) */
export interface PasteTempoChoice {
  /** "song"은 곡 템포, 그 밖은 악보 첫 트랙 id */
  readonly key: string;
  /** 이 템포를 쓰는 악보 (scoreChunks 순서, 0부터) */
  readonly scores: readonly number[];
  readonly tempo: readonly TempoEvent[];
}

/**
 * 고른 트랙이 든 악보들의 템포가 서로 다른지. 곡 템포 지도는 곡에 하나지만, 원문에 t가 적힌 악보는
 * 그 원문 템포가 곡 템포와 다를 수 있다 (다른 템포로 쓴 MML을 모은 곡 등. 곡 검사 tempo-mismatch).
 * 악보마다 원문 t가 있으면 그 템포, 없으면 곡 템포를 고른 트랙의 길이까지 견주어, 둘 이상이면 고를 거리를 돌려준다.
 * 하나뿐이면 빈 목록
 */
export function pasteTempoChoices(song: Song, selected: readonly string[], maxChords: number | ((playerId: string) => number)): PasteTempoChoice[] {
  const chunks = scoreChunks(song, maxChords);
  const picked = song.tracks.filter((t) => selected.includes(t.id));
  const end = scoreEnd(picked);
  const songTempo = audibleTempo(tempoBefore(song.tempo, end));
  const out: { key: string; scores: number[]; tempo: TempoEvent[] }[] = [];
  chunks.forEach((chunk, k) => {
    if (!chunk.trackIds.some((id) => selected.includes(id))) return;
    const tracks = chunk.trackIds.map((id) => song.tracks.find((t) => t.id === id)!);
    const own = audibleTempo(tempoBefore(tracks.flatMap((t) => (t.mml ? tempoTokens(t.mml).map(({ at, bpm }) => ({ at, bpm })) : [])), scoreEnd(tracks)));
    const tempo = own.length > 0 ? tempoBefore(own, end) : songTempo;
    const same = out.find((c) => sameTempo(c.tempo, tempo));
    if (same) same.scores.push(k);
    else out.push({ key: own.length > 0 && !sameTempo(own, songTempo) ? chunk.trackIds[0]! : "song", scores: [k], tempo });
  });
  return out.length > 1 ? out : [];
}
