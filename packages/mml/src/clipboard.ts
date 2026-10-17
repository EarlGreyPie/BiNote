import { add, cmp, maxChordsOf, ZERO, type GameProfile, type Rat, type Song } from "@mmlce/core";

/**
 * 게임에 붙여넣는 글. 악보 하나 = "MML@트랙1,트랙2,...;" (PC 마비노기와 같은 형식).
 * 한 번에 붙여넣는 것은 악보 하나(연주자 한 명, 최대 maxChordsPerPlayer 트랙)뿐이다.
 */
export function mmlAt(texts: readonly string[]): string {
  return `MML@${texts.join(",")};`;
}

export interface PlayerScore {
  readonly playerId: string;
  /** 붙여넣는 글에 더 붙은, 소리 내지 않는 트랙 수 (오르골·축음기. pasteTrackIds) */
  readonly silent: number;
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
 * 악보 하나를 게임에 붙여넣을 때 넣는 채널 (트랙 id, null은 빈 채널). 보통은 그 악보 트랙 그대로다.
 * 오르골·축음기처럼 악보 하나에 pasteLimit(게임 악보 한도 6)보다 적게 치는 악기는 앞 size채널만 소리 내고 뒤 채널은 치지 않지만,
 * 악보 길이·템포는 붙여넣은 모든 채널로 정해진다. 그래서 이 악보 트랙으로 소리 칸을 채우고(모자라면 빈 채널),
 * 그 뒤에 그 연주자의 나머지 트랙을 차례로(맨 끝에서 처음으로 돌아) pasteLimit까지 붙여, 같은 곡을 나눠 치는
 * 오르골들의 길이·템포가 같게 한다. 소리 칸에 다른 악보 트랙이 들어가면 두 대에서 겹쳐 나므로 넣지 않는다
 * (6트랙 오르골: 1장 1~6, 2장 4·5·6·1·2·3 / 4트랙: 1장 1~4, 2장 4·빈·빈·1·2·3)
 * 트랙이 pasteLimit보다 많아 다 못 붙이면, 가장 늦게 끝나는 트랙이 빠진 악보는 마지막 붙임 자리를 그 트랙으로 바꿔
 * 모든 오르골의 반복 길이가 같게 한다 (음은 빼지 않는다: 소리 칸은 그대로)
 */
export function pasteTrackIds(
  song: Song,
  chunk: ScoreChunk,
  maxChords: number | ((playerId: string) => number),
  pasteLimit?: number,
): readonly (string | null)[] {
  const size = Math.max(1, typeof maxChords === "number" ? maxChords : maxChords(chunk.playerId));
  const mine = song.tracks.filter((t) => t.playerId === chunk.playerId).map((t) => t.id);
  if (pasteLimit === undefined || size >= pasteLimit || mine.length <= chunk.trackIds.length || chunk.trackIds.length === 0) return chunk.trackIds;
  const start = mine.indexOf(chunk.trackIds[0]!);
  const rest = [...mine.slice(start), ...mine.slice(0, start)].filter((id) => !chunk.trackIds.includes(id));
  const sounding = [...chunk.trackIds, ...Array<null>(Math.max(0, size - chunk.trackIds.length)).fill(null)];
  const out = [...sounding, ...rest].slice(0, Math.max(pasteLimit, chunk.trackIds.length));
  if (out.length >= sounding.length + rest.length) return out;
  const endOf = (id: string): Rat => (song.tracks.find((t) => t.id === id)?.notes ?? []).reduce((end, n) => {
    const e = add(n.start, n.dur);
    return cmp(e, end) > 0 ? e : end;
  }, ZERO);
  const songEnd = mine.reduce((end, id) => {
    const e = endOf(id);
    return cmp(e, end) > 0 ? e : end;
  }, ZERO);
  const reaches = (id: string | null) => id !== null && cmp(endOf(id), songEnd) >= 0;
  if (out.some(reaches) || out.length <= sounding.length) return out;
  const longest = rest.find(reaches);
  if (longest !== undefined) out[out.length - 1] = longest;
  return out;
}

/**
 * 채널별 글을 연주자마다 악보 하나로 묶는다 (scoreChunks와 같은 묶음). 글이 없는 트랙은 뺀다
 */
export function playerScores(
  song: Song,
  texts: readonly { readonly trackId: string; readonly text: string }[],
  maxChords: number | ((playerId: string) => number),
  /** 게임 악보 하나의 트랙 한도 (profile.maxChordsPerPlayer). 주면 오르골·축음기 악보에 나머지 트랙을 붙인다 (pasteTrackIds) */
  pasteLimit?: number,
): PlayerScore[] {
  const textOf = (id: string) => texts.find((x) => x.trackId === id);
  const has = (x: { trackId: string; text: string } | undefined): x is { trackId: string; text: string } => x !== undefined;
  return scoreChunks(song, maxChords).flatMap((chunk) => {
    const mine = chunk.trackIds.map(textOf).filter(has);
    if (mine.length === 0) return [];
    const pasted = pasteTrackIds(song, chunk, maxChords, pasteLimit);
    if (pasted === chunk.trackIds) return [{ ...chunk, trackIds: mine.map((x) => x.trackId), text: mmlAt(mine.map((x) => x.text)), silent: 0 }];
    // 소리 칸 자리가 밀리지 않게 글이 없는 트랙·빈 채널도 자리를 지킨다
    const silent = pasted.filter((id) => id !== null && !chunk.trackIds.includes(id) && textOf(id)).length;
    return [{ ...chunk, trackIds: mine.map((x) => x.trackId), text: mmlAt(pasted.map((id) => (id === null ? "" : (textOf(id)?.text ?? "")))), silent }];
  });
}
