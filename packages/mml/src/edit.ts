import {
  add,
  carryTabStrings,
  cmp,
  eq,
  sub,
  ZERO,
  DEFAULT_BPM,
  normalizeTempo,
  getProfile,
  PROFILES,
  type Command,
  type GameProfile,
  type Note,
  type Rat,
  type Song,
  type TempoEvent,
  type Track,
  type TrackText,
} from "@mmlce/core";
import { parseMml, type ParseResult } from "./parser.js";
import { optimizeMml } from "./optimizer.js";
import { lengthPieces } from "./printer.js";
import { bpmBefore, padScore, scoreEnd, tempoBefore, textEnd, trackEnd } from "./score-end.js";
import { placeTempo, placeTempoByScore, scoreTrackIds, type TempoMove } from "./tempo-placement.js";
import { chordsPerScore } from "./clipboard.js";
import { distributeChords } from "./distribute.js";
import { mergeChords, type MergeResult } from "./merge.js";
import { gameTimeline } from "./game-timeline.js";
import { sameSound } from "./compare.js";
import { audibleTempo, localAt, spliceText, surgicalSource, sameTempo, tempoInsertOffset, tempoTokens, type TempoToken } from "./tempo-text.js";

/** 곡 프로필로 연주자마다 악보 하나에 담는 트랙 수 (모르는 프로필이면 모바일) */
export function songChordsPerScore(song: Song): (playerId: string) => number {
  return chordsPerScore(song, PROFILES[song.meta.profileId] ?? getProfile("mobile"));
}

/** 곡의 게임 악보마다 트랙 id (출력·악보책 나누기와 같은 묶음) */
export function songScores(song: Song): string[][] {
  return scoreTrackIds(song, songChordsPerScore(song));
}

/** 들리는 템포마다 그 빠르기가 이어지는 구간 [event.at, next) */
interface TempoWindow {
  readonly event: TempoEvent;
  readonly next: Rat | undefined;
}

function tempoWindows(map: readonly TempoEvent[]): TempoWindow[] {
  const audible = audibleTempo(map);
  return audible.map((event, k) => ({ event, next: audible[k + 1]?.at }));
}

/** 원문의 t가 이 템포를 나타내는지: 같은 빠르기이고 그 구간 안 (음 경계로 옮겨 적은 t도 여기 든다) */
function inWindow(token: { readonly at: Rat; readonly bpm: number }, w: TempoWindow): boolean {
  return token.bpm === w.event.bpm && cmp(token.at, w.event.at) >= 0 && (w.next === undefined || cmp(token.at, w.next) < 0);
}

/**
 * 악보 하나의 글 템포. 게임은 악보마다 템포를 따로 읽으므로 악보마다 들리는 곡 템포가 모두 있어야 한다.
 * 원문(mml)에 이미 적힌 템포는 그대로 두고, 나머지는 원문 없는 첫 트랙에 출력기가 쓴다.
 * 원문 없는 트랙이 없으면 나머지는 빠진 템포다.
 */
function scoreTempo(song: Song, ids: readonly string[]): { generated: Map<string, TempoEvent[]>; missing: TempoEvent[] } {
  const tracks = ids.map((id) => song.tracks.find((t) => t.id === id)!);
  const declared = tracks.flatMap((t) => (t.mml ? tempoTokens(t.mml) : []));
  // 악보가 끝난 뒤 템포는 그 악보에 쓰지 않는다 (score-end.ts)
  const end = scoreEnd(tracks);
  const open = tempoWindows(song.tempo).filter((w) => cmp(w.event.at, end) < 0 && !declared.some((d) => inWindow(d, w)));
  const free = tracks.filter((t) => !t.mml);
  const generated = new Map<string, TempoEvent[]>();
  if (free.length === 0) return { generated, missing: open.map((w) => w.event) };
  // 원문 없는 첫 트랙에 모두 넣는다 (음 가운데면 출력기가 &로 나누고, 그럴 수 없으면 뒤쪽 음 경계로 옮긴다)
  const [placed] = placeTempo(
    [free[0]!.notes],
    open.map((w) => w.event),
    undefined,
    (e) => open.find((w) => eq(w.event.at, e.at))?.next,
  );
  generated.set(free[0]!.id, placed ?? []);
  return { generated, missing: [] };
}

/**
 * 트랙을 화면에 보여 줄 MML. 원문이 있으면 원문, 없으면 출력기로 쓴다.
 * 출력할 때는 그 악보 원문에 적히지 않은 곡 템포를 원문 없는 트랙에 넣는다 (scoreTempo).
 */
export function trackSource(song: Song, track: Track): TrackText {
  if (track.mml) return track.mml;
  const score = songScores(song).find((ids) => ids.includes(track.id)) ?? [track.id];
  return { text: optimizeMml(track.notes, { tempo: scoreTempo(song, score).generated.get(track.id) ?? [] }).text };
}

export interface ParsedTrackText {
  readonly parsed: ParseResult;
  readonly notes: Note[];
  /** 곡 위치로 옮긴 템포 */
  readonly tempo: TempoEvent[];
}

/** 원문을 읽어 트랙 음과 템포로. 음 id는 트랙 id + 순번이라 같은 글이면 같은 id가 나온다 */
export function parseTrackText(trackId: string, source: TrackText): ParsedTrackText {
  const parsed = parseMml(source.text);
  const shift = (r: Rat) => (source.offset ? add(r, source.offset) : r);
  const notes = parsed.notes.map((n, k) => ({
    id: `${trackId}.${k + 1}`,
    start: shift(n.start),
    dur: n.dur,
    pitch: n.pitch,
    vol: n.vol,
    tie: n.tie,
  }));
  return { parsed, notes, tempo: parsed.tempo.map((t) => ({ at: shift(t.at), bpm: t.bpm })) };
}

/**
 * 곡 전체에서 음 id가 겹치지 않게 한다. 다시 읽은 트랙은 "트랙 id.순번"을 받는데, 다른 트랙으로 옮겨 간 음
 * (높이 순 나누기·화음 병합 등)이 옛 id를 그대로 갖고 있으면 겹친다. 겹치는 음(뒤에 나온 것)만 새 id를 준다
 */
export function uniqueNoteIds(tracks: readonly Track[]): Track[] {
  const seen = new Set<string>();
  const all = new Set(tracks.flatMap((t) => t.notes.map((n) => n.id)));
  let counter = 0;
  const fresh = (trackId: string) => {
    let id: string;
    do id = `${trackId}.u${++counter}`;
    while (all.has(id));
    all.add(id);
    return id;
  };
  return tracks.map((t) => {
    let changed = false;
    const notes = t.notes.map((n) => {
      if (!seen.has(n.id)) {
        seen.add(n.id);
        return n;
      }
      changed = true;
      const id = fresh(t.id);
      seen.add(id);
      return { ...n, id };
    });
    return changed ? { ...t, notes } : t;
  });
}

/** 템포 목록에서 지울 것들을 하나씩만 뺀다 (같은 위치·같은 빠르기가 여러 트랙에 있을 수 있음) */
function removeEach(from: readonly TempoEvent[], remove: readonly TempoEvent[]): TempoEvent[] {
  const out = [...from];
  for (const r of remove) {
    const i = out.findIndex((e) => e.bpm === r.bpm && cmp(e.at, r.at) === 0);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}

/**
 * 트랙 MML 원문을 바꾸는 명령. 음은 새 원문에서 다시 읽고, 곡 템포 지도는
 * 옛 원문이 넣었던 템포를 빼고 새 원문의 템포를 더한다(다른 트랙의 템포는 그대로).
 */
export function setTrackText(trackId: string, text: string): Command {
  return {
    label: "MML 입력",
    apply(song) {
      const track = song.tracks.find((t) => t.id === trackId);
      if (!track) return song;
      const before = trackSource(song, track);
      const next: TrackText = before.offset ? { text, offset: before.offset } : { text };
      const old = parseTrackText(trackId, before);
      const now = parseTrackText(trackId, next);
      // 읽을 때 여러 트랙에 같이 적힌 템포는 하나로 합쳐졌으므로, 다른 트랙 원문에 아직 적혀 있는 템포는 빼지 않는다
      const others = song.tracks.filter((t) => t.id !== trackId && t.mml).flatMap((t) => parseTrackText(t.id, t.mml!).tempo);
      const stillDeclared = (e: TempoEvent) => others.some((o) => o.bpm === e.bpm && cmp(o.at, e.at) === 0);
      // 지도에 없던 옛 원문의 t(다른 악보 때문에 음 경계로 옮겨 적은 t)가 그대로 남아 있으면 지도에 더하지 않는다
      const mirror = (e: TempoEvent) =>
        old.tempo.some((o) => o.bpm === e.bpm && eq(o.at, e.at)) && !song.tempo.some((m) => m.bpm === e.bpm && eq(m.at, e.at));
      return {
        ...song,
        tempo: normalizeTempo([...removeEach(song.tempo, old.tempo.filter((e) => !stillDeclared(e))), ...now.tempo.filter((e) => !mirror(e))]),
        // 글에는 타브 줄이 없으므로 옛 음의 줄을 시간·높이로 옮겨 받는다
        tracks: uniqueNoteIds(song.tracks.map((t) => (t.id === trackId ? { ...t, notes: carryTabStrings(track.notes, now.notes), mml: next } : t))),
      };
    },
    invert(before) {
      const track = before.tracks.find((t) => t.id === trackId);
      return restoreTrack(trackId, track, before.tempo);
    },
  };
}

/** 트랙과 템포 지도를 이전 상태로 되돌리는 명령 */
function restoreTrack(trackId: string, track: Track | undefined, tempo: readonly TempoEvent[]): Command {
  return {
    label: "MML 입력 되돌리기",
    apply(song) {
      if (!track) return song;
      return { ...song, tempo, tracks: song.tracks.map((t) => (t.id === trackId ? track : t)) };
    },
    invert(before) {
      return restoreTrack(trackId, before.tracks.find((t) => t.id === trackId), before.tempo);
    },
  };
}

/**
 * 피아노롤처럼 음을 직접 고치는 명령. 원문은 지우고, 그때부터 화면 글은 출력기가 쓴다.
 * 곡 템포 지도는 건드리지 않는다.
 */
export function setTrackNotes(trackId: string, notes: readonly Note[], label = "음 편집"): Command {
  return {
    label,
    apply(song) {
      const next = {
        ...song,
        tracks: song.tracks.map((t) => {
          if (t.id !== trackId) return t;
          const { mml: _mml, ...rest } = t;
          return { ...rest, notes };
        }),
      };
      return keepTextEnd(song, next, [trackId]);
    },
    invert(before) {
      const track = before.tracks.find((t) => t.id === trackId);
      return restoreTrack(trackId, track, before.tempo);
    },
  };
}

/** 글자 수 줄이기 결과. kept면 곡을 그대로 두었고 그 까닭 */
export type CompactResult =
  | { readonly song: Song; readonly kept?: undefined }
  | {
      readonly song: Song;
      /** notes: 출력기가 쓸 수 없는 길이의 음이 있다. tempo: 어느 악보의 템포를 글에 다 적을 수 없다(잠근 트랙 등) */
      readonly kept: "notes" | "tempo";
    };

/**
 * 모든 트랙을 최적화 출력기로 다시 쓴다 (소리는 같고 글자 수만 준다). compactSong과 같고, 그대로 둔 까닭을 함께 돌려준다.
 * 게임은 악보마다 템포를 따로 읽으므로 곡 템포를 악보마다 모두 넣는다 (profile이 없으면 곡 프로필로 악보를 묶는다).
 * 사용자가 쓴 원문 표기는 바뀐다. locked에 든 트랙(잠근 트랙)은 그대로 두고 템포도 맡기지 않는다.
 * 다시 쓴 뒤 음이 달라지거나, 어느 채널에도 쓸 수 없는 템포가 있거나, 다시 읽은 악보 템포가 곡 템포와 다르면 곡을 그대로 둔다
 */
export function compactResult(song: Song, profile?: GameProfile, locked?: ReadonlySet<string>, ends?: ReadonlyMap<string, Rat>): CompactResult {
  // 잠근 트랙에는 템포를 맡기지 않는다 (그 글은 다시 쓰지 않으므로 맡기면 템포가 악보에서 사라진다)
  const dropped: TempoEvent[] = [];
  const moved = new Map<string, TempoMove[]>();
  const chords = profile ? chordsPerScore(song, profile) : songChordsPerScore(song);
  const placed = placeTempoByScore(song, chords, moved, locked, dropped, ends);
  // 어느 채널에도 쓸 수 없는 템포가 있으면 (잠근 트랙만 경계가 맞는 등) 그대로 둔다. 뒤 음 경계로 옮겨 쓴 템포는 출력과 같으므로 괜찮다
  if (dropped.length > 0) return { song, kept: "tempo" };
  const tracks: Track[] = [];
  for (const t of song.tracks) {
    // 잠근 트랙은 글도 그대로 둔다
    if (locked?.has(t.id)) {
      tracks.push(t);
      continue;
    }
    const mml: TrackText = { text: optimizeMml(t.notes, { tempo: placed.get(t.id) ?? [] }).text };
    const notes = carryTabStrings(t.notes, parseTrackText(t.id, mml).notes);
    // 출력기가 쓸 수 없는 길이(아주 짧은 셋잇단 등)는 버려지므로, 다시 읽은 음이 원래 음과 다르면
    // 곡을 그대로 둔다 (글자 수를 줄이려다 음을 잃지 않게)
    if (!sameSound(t.notes, notes)) return { song, kept: "notes" };
    tracks.push({ ...t, notes, mml });
  }
  // 원문 끝 쉼표가 사라져 악보가 짧아지지 않게 악보 길이를 지킨다 (score-end.ts). 쉼표와 그 자리 템포만 붙으므로 음은 그대로.
  // 붙인 뒤에도 트랙당 글자 한도 안인 글을 먼저 고른다
  const songProfile = profile ?? PROFILES[song.meta.profileId] ?? getProfile("mobile");
  const charLimit = songProfile.charLimitPerScore;
  const scoreEnds = new Map<string, Rat>();
  for (const ids of scoreTrackIds(song, chords)) {
    const end = scoreEnd(ids.map((id) => song.tracks.find((x) => x.id === id)!), ends);
    ids.forEach((id) => scoreEnds.set(id, end));
    const at = ids.map((id) => tracks.findIndex((x) => x.id === id));
    const padded = padScore(at.map((k) => tracks[k]!.mml?.text ?? ""), end, bpmBefore(song.tempo, end), songProfile.length, ids.map((id) => !locked?.has(id)), charLimit);
    at.forEach((k, i) => {
      const t = tracks[k]!;
      if (t.mml && padded[i] !== t.mml.text) tracks[k] = { ...t, mml: { text: padded[i]! } };
    });
  }
  // 악보마다 글에 적힌 들리는 템포가 곡 템포(뒤 음 경계로 옮겨 쓴 것은 옮긴 자리)와 같은지 다시 읽어 본다.
  // 출력기가 아주 짧은 쉼표를 빼면 두 템포가 한 자리에 겹쳐 앞 템포가 들리지 않을 수 있다
  const map = audibleTempo(song.tempo);
  for (const ids of scoreTrackIds(song, chords)) {
    // 글이 하나도 바뀌지 않은 악보(모두 잠근 악보 등)는 볼 것이 없다. 전에 뒤 음 경계로 옮겨 쓴 템포가 그대로 남아 있어도 괜찮다
    const unchanged = ids.every((id) => {
      const before = song.tracks.find((x) => x.id === id);
      const after = tracks.find((x) => x.id === id);
      return before === after || (!!before?.mml && before.mml.text === after?.mml?.text && !before.mml.offset);
    });
    if (unchanged) continue;
    const moves = moved.get(ids[0]!) ?? [];
    // 악보가 끝난 뒤 템포는 쓰지 않았고, 길이를 지키려고 끝에 붙인 템포는 보지 않는다
    const end = scoreEnds.get(ids[0]!) ?? ZERO;
    const expected = audibleTempo(
      normalizeTempo(
        tempoBefore(map, end).map((e) => {
          const move = moves.find((m) => eq(m.from, e.at) && m.bpm === e.bpm);
          return move ? { at: move.to, bpm: e.bpm } : e;
        }),
      ),
    );
    const written = audibleTempo(
      normalizeTempo(
        ids.flatMap((id) => {
          const t = tracks.find((x) => x.id === id);
          return t?.mml ? tempoBefore(parseTrackText(t.id, t.mml).tempo, end) : [];
        }),
      ),
    );
    if (!sameTempo(written, expected)) return { song, kept: "tempo" };
  }
  return {
    song: {
      ...song,
      // 채널마다 같은 템포가 적혀 있던 것은 하나로 합치고, 들리지 않는 같은 빠르기 템포는 쓰지 않으므로 지도에서도 뺀다
      tempo: audibleTempo(song.tempo),
      tracks: uniqueNoteIds(tracks),
    },
  };
}

/**
 * 모든 트랙을 최적화 출력기로 다시 쓰는 명령 (소리는 같고 글자 수만 준다). 그대로 둘 때는 compactResult를 본다.
 * locked에 든 트랙(잠근 트랙)은 그대로 둔다.
 */
export function compactSong(profile?: GameProfile, label = "글자 수 줄이기", locked?: ReadonlySet<string>): Command {
  return {
    label,
    apply: (song) => compactResult(song, profile, locked).song,
    invert(before) {
      return restoreSong(before);
    },
  };
}

/** 실행 취소용: 곡을 통째로 앞 곡으로 돌리는 명령 */
export function restoreSong(song: Song): Command {
  return {
    label: "되돌리기",
    apply: () => song,
    invert: (before) => restoreSong(before),
  };
}

/**
 * 화음 분산 명령. 음을 옮긴 뒤 모든 트랙을 최적화 출력기로 다시 쓴다
 * (곡 템포를 채널마다 다시 나눠 넣어야 하므로 옮기지 않은 트랙의 표기도 바뀐다). 잠근 트랙은 음도 글도 그대로 둔다.
 */
export function distributeSong(profile: GameProfile, label = "화음 분산", limit?: number, locked?: ReadonlySet<string>): Command {
  return {
    label,
    // 음을 옮긴 트랙은 원문이 지워지므로, 옮기기 전 트랙 길이(원문 끝 쉼표 포함)를 지킬 길이로 넘긴다
    apply: (song) =>
      compactResult(
        distributeChords(song, profile, { ...(limit === undefined ? {} : { limit }), ...(locked ? { locked } : {}) }).song,
        profile,
        locked,
        new Map(song.tracks.map((t) => [t.id, trackEnd(t)])),
      ).song,
    invert: (before) => restoreSong(before),
  };
}

/**
 * 화음 병합 결과. 드문 트랙의 음을 같은 악기의 쉬는 트랙으로 옮기고, 음을 모두 보낸 트랙은 지운 뒤
 * 모든 트랙을 최적화 출력기로 다시 쓴다 (화음 분산과 같다). 잠근 트랙은 음도 글도 그대로 둔다.
 *
 * 받아들이는 기준은 하나: 게임에 붙여넣을 최종 출력을 악보마다 다시 읽은 결과(gameTimeline)가
 * 병합 전과 같아야 한다 (같은 악보 안에서 음이 어느 트랙으로 갔는지만 다르고, 악보 나뉨·템포·끝·시작·길이·높이·볼륨·&가 같음).
 * 비운 트랙을 지워 악보 나뉨이 바뀌면 빈 트랙으로 남겨 다시 본다.
 * 연주자마다 따로 병합해 보고 같은 연주자만 받아들인다. 병합 안의 다른 검사(겹침·도약·글자 수·템포 자리)는
 * 이 검사에서 떨어질 이동을 미리 거르는 것일 뿐이다
 */
export function mergeResult(song: Song, profile: GameProfile, locked?: ReadonlySet<string>): MergeResult {
  const players = [...new Set(song.tracks.filter((t) => !locked?.has(t.id)).map((t) => t.playerId))].filter(
    (id) => song.tracks.filter((t) => t.playerId === id && !locked?.has(t.id)).length > 1,
  );
  if (players.length === 0) return { song, moved: 0, removed: [] };
  let current = song;
  let moved = 0;
  const removed: string[] = [];
  for (const id of players) {
    const options = { ...(locked ? { locked } : {}), players: new Set([id]) };
    // 악보는 연주자마다 따로 쓰므로 그 연주자 악보만 비교하면 된다
    const before = gameTimeline(song, profile, id);
    let merged = mergeChords(current, profile, options);
    if (merged.moved === 0) continue;
    if (gameTimeline(merged.song, profile, id) !== before) {
      // 비운 트랙을 지우면 뒤 트랙이 앞 악보로 당겨져 악보 나뉨이 바뀐다. 빈 트랙으로 남겨 다시 본다
      if (merged.removed.length === 0) continue;
      merged = mergeChords(current, profile, { ...options, keepEmpty: true });
      if (merged.moved === 0 || gameTimeline(merged.song, profile, id) !== before) continue;
    }
    current = merged.song;
    moved += merged.moved;
    removed.push(...merged.removed);
  }
  if (moved === 0) return { song, moved: 0, removed: [] };
  const compact = compactResult(current, profile, locked);
  // 다시 쓴 곡 전체의 최종 출력도 한 번 더 본다
  if (compact.kept || gameTimeline(compact.song, profile) !== gameTimeline(song, profile)) return { song, moved: 0, removed: [] };
  return { song: compact.song, moved, removed };
}

/** 화음 병합 명령 (mergeResult). 실행 취소하면 병합 전 곡으로 돌아간다 */
export function mergeSong(profile: GameProfile, label = "화음 병합", locked?: ReadonlySet<string>): Command {
  return {
    label,
    apply: (song) => mergeResult(song, profile, locked).song,
    invert: (before) => restoreSong(before),
  };
}

/**
 * 다른 곡의 연주자·트랙을 지금 곡 뒤에 더하는 명령 (MML@ 붙여넣기 등).
 * id가 겹치지 않게 연주자·트랙 id를 새로 매기고, 템포 지도는 합친다.
 */
export function appendSong(other: Song, label = "악보 더하기"): Command {
  return {
    label,
    apply(song) {
      const next = (ids: readonly string[], prefix: string) => {
        let n = Math.max(0, ...ids.map((id) => Number(id.slice(prefix.length)) || 0));
        return () => `${prefix}${++n}`;
      };
      const playerId = next(
        song.players.map((p) => p.id).filter((id) => id.startsWith("p")),
        "p",
      );
      const trackId = next(
        song.tracks.map((t) => t.id).filter((id) => id.startsWith("t")),
        "t",
      );
      const players = new Map(other.players.map((p) => [p.id, { ...p, id: playerId() }]));
      // 떼어 낸 악보 표시(splitFrom)도 새 id로 옮긴다. 더하는 곡에 없는 악보를 가리키면 버린다
      for (const [key, p] of players) {
        if (p.splitFrom === undefined) continue;
        const { splitFrom, ...rest } = p;
        const to = players.get(splitFrom)?.id;
        players.set(key, to ? { ...rest, splitFrom: to } : rest);
      }
      const tracks = other.tracks.map((t) => {
        const id = trackId();
        const notes = t.mml ? carryTabStrings(t.notes, parseTrackText(id, t.mml).notes) : t.notes.map((n, k) => ({ ...n, id: `${id}.${k + 1}` }));
        return { ...t, id, playerId: players.get(t.playerId)?.id ?? t.playerId, notes };
      });
      return {
        ...song,
        tempo: normalizeTempo([...song.tempo, ...other.tempo]),
        players: [...song.players, ...players.values()],
        tracks: [...song.tracks, ...tracks],
      };
    },
    invert: (before) => restoreSong(before),
  };
}

/**
 * 마디 넣기: at 자리에 length만큼 빈 시간을 넣는다. at 뒤에서 시작하는 음·템포·마커를 모두 민다.
 * at에 걸쳐 있는 음은 그대로 둔다(길이 유지). 바뀐 트랙은 원문 대신 출력기로 다시 쓴다.
 */
export function insertTime(at: Rat, length: Rat, label = "마디 넣기"): Command {
  const shift = (r: Rat) => (cmp(r, at) >= 0 ? add(r, length) : r);
  return {
    label,
    apply(song) {
      return {
        ...song,
        tempo: song.tempo.map((t) => ({ ...t, at: shift(t.at) })),
        // 첫 박자(0)는 그대로, 넣는 자리 뒤의 박자 변화는 함께 민다
        timeSig: song.timeSig.map((s) => (cmp(s.at, ZERO) === 0 ? s : { ...s, at: shift(s.at) })),
        markers: song.markers.map((m) => ({ ...m, at: shift(m.at) })),
        tracks: song.tracks.map((t) => {
          if (!t.notes.some((n) => cmp(n.start, at) >= 0)) return t;
          const { mml: _mml, ...rest } = t;
          const sorted = [...t.notes].sort((a, b) => cmp(a.start, b.start));
          const notes = sorted.map((n, i) => {
            const next = sorted[i + 1];
            // 넣는 자리 앞 음이 뒤로 밀린 음과 &로 이어져 있었으면 사이가 벌어지므로 &를 푼다
            const split = n.tie === "next" && next && cmp(n.start, at) < 0 && cmp(next.start, at) >= 0;
            return { ...n, start: shift(n.start), ...(split ? { tie: "none" as const } : {}) };
          });
          return { ...rest, notes };
        }),
      };
    },
    invert: (before) => restoreSong(before),
  };
}

/** 구간 [at, end) 안의 변화(템포·박자)를 빼고 뒤를 당긴다. 구간 안 마지막 값은 at에 남긴다 */
function removeSpan<T extends { readonly at: Rat }>(events: readonly T[], at: Rat, end: Rat, length: Rat): T[] {
  const inside = events.filter((e) => cmp(e.at, at) >= 0 && cmp(e.at, end) < 0);
  const kept = events
    .filter((e) => cmp(e.at, at) < 0 || cmp(e.at, end) >= 0)
    .map((e) => (cmp(e.at, end) >= 0 ? { ...e, at: sub(e.at, length) } : e));
  const last = inside[inside.length - 1];
  const out = last && !kept.some((e) => cmp(e.at, at) === 0) ? [...kept, { ...last, at }] : kept;
  return out.sort((a, b) => cmp(a.at, b.at));
}

/**
 * 마디 빼기: [at, at+length) 구간을 지우고 뒤를 당긴다. 구간 안의 음은 지우고,
 * 구간에 걸친 음은 구간 밖 부분만 남긴다. 구간 안의 템포·박자는 마지막 값을 at에 남긴다.
 * &로 이어 주던 다음 음이 지워졌거나 더 이상 바로 붙지 않으면 &를 푼다.
 */
export function deleteTime(at: Rat, length: Rat, label = "마디 빼기"): Command {
  const end = add(at, length);
  const back = (r: Rat) => (cmp(r, end) >= 0 ? sub(r, length) : r);
  return {
    label,
    apply(song) {
      return {
        ...song,
        tempo: removeSpan(song.tempo, at, end, length),
        timeSig: removeSpan(song.timeSig, at, end, length),
        markers: song.markers.filter((m) => cmp(m.at, at) < 0 || cmp(m.at, end) >= 0).map((m) => ({ ...m, at: back(m.at) })),
        tracks: song.tracks.map((t) => {
          const touched = t.notes.some((n) => cmp(add(n.start, n.dur), at) > 0);
          if (!touched) return t;
          const sorted = [...t.notes].sort((a, b) => cmp(a.start, b.start));
          // 원래 음 → 남은 음 (지워졌으면 없음)
          const kept = new Map<Note, Note>();
          for (const n of sorted) {
            const nEnd = add(n.start, n.dur);
            if (cmp(nEnd, at) <= 0) kept.set(n, n);
            else if (cmp(n.start, end) >= 0) kept.set(n, { ...n, start: sub(n.start, length) });
            else if (cmp(n.start, at) < 0) {
              // 구간 앞에서 시작: 앞부분 + (구간 뒤로 넘친 부분)
              const tail = cmp(nEnd, end) > 0 ? sub(nEnd, end) : undefined;
              kept.set(n, { ...n, dur: tail ? add(sub(at, n.start), tail) : sub(at, n.start) });
            } else if (cmp(nEnd, end) > 0) {
              // 구간 안에서 시작해 밖으로 넘침: 넘친 부분만 at에서
              kept.set(n, { ...n, start: at, dur: sub(nEnd, end) });
            }
          }
          const notes: Note[] = [];
          sorted.forEach((n, k) => {
            const now = kept.get(n);
            if (!now) return;
            if (now.tie !== "next") return void notes.push(now);
            // 원래 &로 이어 주던 음(바로 붙은 다음 음)이 남아 있고 여전히 바로 붙어야 &를 둔다
            const target = sorted[k + 1];
            const targetNow = target && eq(add(n.start, n.dur), target.start) ? kept.get(target) : undefined;
            const joined = targetNow && eq(add(now.start, now.dur), targetNow.start);
            notes.push(joined ? now : { ...now, tie: "none" });
          });
          const { mml: _mml, ...rest } = t;
          return { ...rest, notes };
        }),
      };
    },
    invert: (before) => restoreSong(before),
  };
}

/** 음 목록의 끝 (마지막 음 끝) */
function notesEnd(notes: readonly Note[]): Rat {
  let end: Rat = ZERO;
  for (const n of notes) {
    const e = add(n.start, n.dur);
    if (cmp(e, end) > 0) end = e;
  }
  return end;
}

/**
 * 악보 글에 적힌 템포로 at 자리(at에 적힌 템포 포함)의 빠르기. 길이를 지키려고 끝에 붙이는 템포가
 * 같은 자리에 다른 트랙이 적은 템포(예: 다른 트랙의 t90)를 덮어쓰지 않게, 그 자리 템포를 그대로 쓴다.
 * 이 트랙은 text(새로 쓴 글)로 본다. 같은 자리에 템포가 여럿이면 곡 템포 지도와 같은 규칙(normalizeTempo:
 * 악보 트랙 순서에서 뒤 트랙 것)으로 고른다
 */
function writtenBpmAt(song: Song, trackId: string, text: string, at: Rat): number {
  const score = songScores(song).find((ids) => ids.includes(trackId)) ?? [trackId];
  const written = normalizeTempo(
    score.flatMap((tid) => {
      if (tid === trackId) return parseTrackText(trackId, { text }).tempo;
      const t = song.tracks.find((x) => x.id === tid);
      return t ? parseTrackText(t.id, trackSource(song, t)).tempo : [];
    }),
  );
  let bpm = DEFAULT_BPM;
  for (const e of written) if (cmp(e.at, at) <= 0) bpm = e.bpm;
  return bpm;
}

/**
 * 음을 직접 고치는 편집(원문을 지움)에서 원문 끝 쉼표로 지키던 트랙 길이를 지킨다 (score-end.ts).
 * 원문이 있던 트랙의 마지막 음 끝이 그대로인데(볼륨·높이만 바꿈 등) 원문 게임 길이가 더 길면, 출력기로 다시 쓴 글에
 * 모자란 쉼표와 그 자리 템포를 붙여 원문으로 남긴다. 음 끝이 바뀐 편집(끝 음을 지우거나 늘림)은 전처럼 음 끝이 길이다.
 * 다시 읽은 음이 고친 음과 다르면(출력기가 쓸 수 없는 길이 등) 전처럼 원문 없이 둔다
 */
function keepTextEnd(before: Song, after: Song, trackIds: readonly string[]): Song {
  const lengths = (PROFILES[after.meta.profileId] ?? getProfile("mobile")).length;
  let out = after;
  for (const id of trackIds) {
    const old = before.tracks.find((t) => t.id === id);
    const now = out.tracks.find((t) => t.id === id);
    if (!old?.mml || !now || now.mml) continue;
    const end = textEnd(old.mml);
    const last = notesEnd(now.notes);
    if (!eq(notesEnd(old.notes), last) || cmp(end, last) <= 0) continue;
    const base = trackSource(out, now).text;
    const text = padScore([base], end, writtenBpmAt(out, id, base, end), lengths)[0]!;
    const mml: TrackText = { text };
    if (!eq(textEnd(mml), end) || !sameSound(now.notes, parseTrackText(id, mml).notes)) continue;
    out = { ...out, tracks: out.tracks.map((t) => (t.id === id ? { ...now, mml } : t)) };
  }
  return out;
}

/** 여러 트랙의 음을 한 번에 바꾸는 명령 (MIDI 건반 화음 입력 등). 실행 취소 한 칸 */
export function setTracksNotes(changes: readonly { trackId: string; notes: readonly Note[] }[], label = "음 넣기"): Command {
  const byId = new Map(changes.map((c) => [c.trackId, c.notes]));
  return {
    label,
    apply(song) {
      const next = {
        ...song,
        tracks: song.tracks.map((t) => {
          const notes = byId.get(t.id);
          if (!notes) return t;
          const { mml: _mml, ...rest } = t;
          return { ...rest, notes };
        }),
      };
      return keepTextEnd(song, next, [...byId.keys()]);
    },
    invert: (before) => restoreSong(before),
  };
}

/** 곡 전체를 바꾸고 되돌릴 때 통째로 돌려놓는 명령 */
function songCommand(label: string, change: (song: Song) => Song): Command {
  return { label, apply: change, invert: (before) => restoreSong(before) };
}

/**
 * at 위치 템포를 bpm으로 (없으면 넣는다). 곡 템포 지도를 고치고 원문에 쓴 t도 함께 고친다:
 * 그 템포를 나타내던 원문의 t(그 자리 t, 음 경계로 옮겨 적은 t)는 숫자만 바꾸고, 그 템포가 없는 악보는 음·쉼표 경계가 있는
 * 원문 하나에 끼운다 (이미 t를 쓴 트랙 먼저. 원문 없는 트랙이 있으면 출력기가 넣으므로 끼우지 않는다).
 * 끼울 경계가 그 악보 어느 원문에도 없으면 그 악보 첫 원문을 버려 출력기가 쓰게 한다.
 * 문법 오류가 있는 원문은 손대지 않는다 (검사의 tempo-mismatch 경고가 알려 준다)
 */
export function setTempoAt(at: Rat, bpm: number, label = "템포"): Command {
  return tempoCommand(label, (song) => withTempo(song, at, bpm));
}

/** 화면 글(원문 또는 출력)에 곡 템포가 다 적혀 있지 않은 악보 (악보마다 트랙 id). 게임은 악보마다 템포를 따로 읽는다 */
export function scoresMissingTempo(song: Song): string[][] {
  if (song.tempo.length === 0) return [];
  return songScores(song).filter((ids) => scoreTempo(song, ids).missing.length > 0);
}

/** 곡 템포를 모든 악보의 글에 적는다 (악보 1에만 템포를 적은 곡 등). 실행 취소 한 칸 */
export function fillScoreTempo(label = "악보마다 템포 넣기"): Command {
  return songCommand(label, (song) => songScores(song).reduce((next, ids) => fillScore(next, ids, scoreTempo(next, ids).missing), song));
}

/**
 * 트랙을 다른 악보로 옮기는 명령(악기를 바꿔 새 악보로 떼어 내기, 트랙 옮기기 등)을 감싼다.
 * 옮긴 뒤 새로 곡 템포가 빠진 악보는 그 악보 원문에도 적는다 (원문만 있는 트랙을 옮기면 출력기가 템포를 넣어 주지 않는다).
 * 옮기기 전부터 빠져 있던 템포만 남은 악보는 그대로 둔다 (곡 메뉴 "악보마다 템포 넣기"가 따로 채운다). 실행 취소 한 칸
 */
export function keepScoreTempo(command: Command): Command {
  return songCommand(command.label, (song) => {
    const next = command.apply(song);
    if (next === song || next.tempo.length === 0) return next;
    // 트랙마다 옮기기 전 그 트랙의 악보에 빠져 있던 템포
    const key = (id: string, e: TempoEvent) => `${id}|${e.bpm}@${e.at.n}/${e.at.d}`;
    const before = new Set(songScores(song).flatMap((ids) => scoreTempo(song, ids).missing.flatMap((e) => ids.map((id) => key(id, e)))));
    return songScores(next).reduce((out, ids) => {
      const missing = scoreTempo(out, ids).missing;
      return missing.some((e) => ids.some((id) => !before.has(key(id, e)))) ? fillScore(out, ids, missing) : out;
    }, next);
  });
}

/** at 위치 템포를 지운다. 그 템포를 나타내던 원문의 t도 모두 지운다 */
export function removeTempoAt(at: Rat, label = "템포 지우기"): Command {
  return tempoCommand(label, (song) => withoutTempo(song, at));
}

/** 템포를 다른 위치로 옮긴다 (가는 자리에 있던 템포는 덮는다). 실행 취소 한 칸 */
export function moveTempo(from: Rat, to: Rat, label = "템포 옮기기"): Command {
  return tempoCommand(label, (song) => {
    const event = song.tempo.find((e) => eq(e.at, from));
    if (!event || eq(from, to)) return song;
    return withTempo(withoutTempo(song, from), to, event.bpm);
  });
}

/** 템포 여러 개를 한 번에 지우고 넣는다 (원곡에 템포 맞추기). 실행 취소 한 칸 */
export function setTempos(set: readonly TempoEvent[], remove: readonly Rat[], label = "템포 맞추기"): Command {
  return tempoCommand(label, (song) => {
    let next = song;
    for (const at of remove) next = withoutTempo(next, at);
    for (const e of set) next = withTempo(next, e.at, e.bpm);
    return next;
  });
}

/** 템포 한꺼번에 바꾸기: 모두 한 값으로 · ±BPM · % */
export type TempoChange = { readonly mode: "set" | "add" | "scale"; readonly value: number };

/** 바꾼 템포 (정수, 1~999) */
export function changedBpm(bpm: number, change: TempoChange): number {
  const raw = change.mode === "set" ? change.value : change.mode === "add" ? bpm + change.value : (bpm * change.value) / 100;
  return Math.min(999, Math.max(1, Math.round(raw)));
}

/** 템포 한꺼번에 바꾸기가 고칠 대상. 미리보기와 실제 수정이 같은 목록을 쓴다 */
export interface TempoChangeTargets {
  /**
   * 바뀔 템포 값 (구간 처음 자리 템포, 구간 안 지도 템포, 구간 안 원문의 t를 자리·값이 같은 것끼리 하나로).
   * 같은 자리에 겹쳐 쓴 t(t250t100)도 따로 센다
   */
  readonly bpms: readonly number[];
  /** 원문에서 고칠 수 있는 t (트랙 id → 구간 안 t). 문법 오류가 있는 원문은 손대지 않으므로 없다 */
  readonly tokens: ReadonlyMap<string, readonly TempoToken[]>;
}

export function tempoChangeTargets(song: Song, from: Rat = ZERO, to?: Rat): TempoChangeTargets {
  const inside = (at: Rat) => cmp(at, from) >= 0 && (to === undefined || cmp(at, to) < 0);
  const map = normalizeTempo(song.tempo);
  const startBpm = map.filter((e) => cmp(e.at, from) <= 0).at(-1)?.bpm ?? DEFAULT_BPM;
  const tokens = new Map<string, TempoToken[]>();
  for (const t of song.tracks) {
    const hits = (t.mml ? surgicalSource(t.mml)?.tokens : undefined)?.filter((h) => inside(h.at)) ?? [];
    if (hits.length > 0) tokens.set(t.id, hits);
  }
  const seen = new Set<string>();
  const bpms: number[] = [];
  const push = (at: Rat, bpm: number) => {
    const key = `${at.n}/${at.d}@${bpm}`;
    if (seen.has(key)) return;
    seen.add(key);
    bpms.push(bpm);
  };
  push(from, startBpm);
  for (const e of map) if (cmp(e.at, from) > 0 && inside(e.at)) push(e.at, e.bpm);
  for (const list of tokens.values()) for (const h of list) push(h.at, h.bpm);
  return { bpms, tokens };
}

/** 구간 경계 템포를 원문에 넣지 못한 까닭: 게임 길이가 바뀌는 자리뿐이라 거절 / 나눌 수 없는 n 음표 */
export type TempoEdgeFailure = "length" | "n-note";

/** 템포 한꺼번에 바꾸기 결과: 바뀐 곡과, 경계 템포를 넣지 못해 원문을 그대로 둔 악보 (songScores 순서, 0부터) */
export interface TempoChangeResult {
  readonly song: Song;
  readonly failed: readonly { readonly score: number; readonly reasons: readonly TempoEdgeFailure[] }[];
}

/**
 * 구간 [from, to)의 템포를 한꺼번에 바꾼다 (to가 없으면 곡 끝까지). 원문의 t는 구간 안에 적힌 것만 같은 규칙으로 고친다
 * (tempoChangeTargets의 목록. 지도 값은 그대로여도 원문 t가 바뀌면 고친다).
 * 구간 처음(바꾼 값)·끝(원래 값)에서 빠르기가 실제로 달라질 때만 그 자리에 템포를 새로 넣고 (그 뒤에 음이 있을 때),
 * 악보마다 그 자리에 그 빠르기가 울리지 않으면 원문에 t를 끼운다 (insertEdge). 원문은 버리지 않는다.
 * 끼우지 못한 악보는 원문을 그대로 두고 failed로 알린다
 */
export function changeTemposResult(song: Song, change: TempoChange, from: Rat = ZERO, to?: Rat): TempoChangeResult {
  const unchanged = { song, failed: [] };
  const inside = (at: Rat) => cmp(at, from) >= 0 && (to === undefined || cmp(at, to) < 0);
  if (to !== undefined && cmp(to, from) <= 0) return unchanged;
  const before = normalizeTempo(song.tempo);
  const bpmAt = (at: Rat) => before.filter((e) => cmp(e.at, at) <= 0).at(-1)?.bpm ?? DEFAULT_BPM;
  const map: TempoEvent[] = before.map((e) => (inside(e.at) ? { at: e.at, bpm: changedBpm(e.bpm, change) } : e));
  const end = song.tracks.reduce<Rat>((m, t) => t.notes.reduce((mm, n) => (cmp(add(n.start, n.dur), mm) > 0 ? add(n.start, n.dur) : mm), m), ZERO);
  // 새로 만드는 구간 경계 템포: 그 자리 앞뒤 빠르기가 달라지고 그 뒤에 음이 있을 때만
  const edges: TempoEvent[] = [];
  const edgeAt = (at: Rat, bpm: number) => {
    if (cmp(end, at) > 0 && !before.some((e) => eq(e.at, at)) && changedBpm(bpmAt(at), change) !== bpmAt(at)) edges.push({ at, bpm });
  };
  edgeAt(from, changedBpm(bpmAt(from), change));
  if (to !== undefined) edgeAt(to, bpmAt(to));
  map.push(...edges);
  const tempo = normalizeTempo(map);
  const { tokens } = tempoChangeTargets(song, from, to);
  let textChanged = false;
  const tracks = song.tracks.map((t) => {
    const hits = (tokens.get(t.id) ?? []).filter((h) => changedBpm(h.bpm, change) !== h.bpm);
    if (!t.mml || hits.length === 0) return t;
    textChanged = true;
    return { ...t, mml: { ...t.mml, text: spliceText(t.mml.text, hits.map((h) => ({ span: h.span, text: `t${changedBpm(h.bpm, change)}` }))) } };
  });
  if (sameTempo(tempo, before) && !textChanged) return unchanged;
  const failures = new Map<number, Set<TempoEdgeFailure>>();
  const next = edges.reduce<Song>(
    (out, e) =>
      songScores(out).reduce<Song>((acc, ids, score) => {
        const done = insertEdge(acc, ids, e);
        if (done.failed) failures.set(score, new Set([...(failures.get(score) ?? []), ...done.failed]));
        return done.song;
      }, out),
    { ...song, tempo, tracks },
  );
  return { song: next, failed: [...failures].sort(([a], [b]) => a - b).map(([score, reasons]) => ({ score, reasons: [...reasons] })) };
}

/** changeTemposResult를 실행 취소 한 칸 명령으로 (넣지 못한 악보는 changeTemposResult로 미리 알아본다) */
export function changeTempos(change: TempoChange, from: Rat = ZERO, to?: Rat, label = "템포 한꺼번에 바꾸기"): Command {
  return songCommand(label, (song) => changeTemposResult(song, change, from, to).song);
}

/**
 * 악보 하나에서 e.at에 e.bpm이 울리게 한다. 그 자리까지 그 악보 글(원문 t와 출력기가 원문 없는 트랙에 쓸 t)의
 * 마지막 템포가 이미 e.bpm이면 그대로 둔다. 뒤에 같은 값 t가 있어도 그 자리를 채운 것으로 보지 않는다.
 * 아니면 원문 하나에 t를 끼운다: 그 자리에서 시작하는 음·쉼표 앞, 없으면 그 자리에 걸친 쉼표를 둘로 나눠 사이에,
 * 그래도 없으면 걸친 음을 &로 나눠 사이에 (원문을 버려 다시 쓰지 않으므로 쉼표·손으로 쓴 모양·잠근 트랙이 남는다)
 */
function insertEdge(song: Song, ids: readonly string[], e: TempoEvent): { song: Song; failed?: readonly TempoEdgeFailure[] } {
  const tracks = ids.map((id) => song.tracks.find((t) => t.id === id)!);
  // 이미 끝난 악보에는 그 뒤 템포가 필요 없다 (출력기도 악보 길이 뒤 템포는 쓰지 않는다: score-end.ts)
  if (cmp(e.at, scoreEnd(tracks)) >= 0) return { song };
  // 쉼표·음을 나눠 쓸 음길이 한도 (곡 프로필)
  const lengths = (PROFILES[song.meta.profileId] ?? getProfile("mobile")).length;
  const generated = scoreTempo(song, ids).generated;
  const heard = [
    ...tracks.flatMap((t) => (t.mml ? tempoTokens(t.mml) : [])),
    ...tracks.flatMap((t) => generated.get(t.id) ?? []),
  ].filter((k) => cmp(k.at, e.at) <= 0);
  const last = heard.reduce<Rat | undefined>((m, k) => (m === undefined || cmp(k.at, m) > 0 ? k.at : m), undefined);
  if (last !== undefined && heard.filter((k) => eq(k.at, last)).every((k) => k.bpm === e.bpm)) return { song };
  const t = `t${e.bpm}`;
  const sources = tracks
    .map((track) => ({ track, mml: track.mml, src: track.mml ? surgicalSource(track.mml) : undefined }))
    .filter((c): c is { track: Track; mml: TrackText; src: NonNullable<ReturnType<typeof surgicalSource>> } => c.mml !== undefined && c.src !== undefined)
    .sort((a, b) => Number(b.src.tokens.length > 0) - Number(a.src.tokens.length > 0));
  // 끼울 원문이 없으면(원문 없는 트랙뿐) 출력기가 템포를 쓴다
  if (sources.length === 0) return { song };
  // 끼우지 못했을 때 알릴 까닭 (길이가 바뀌어 거절한 자리가 있었는지, 나눌 수 없는 n 음표에 걸렸는지)
  let lengthRefused = false;
  let nNote = false;
  // 음을 나누면 트랙 음도 새 글에서 다시 읽는다 (& 잇기가 하나 늘 뿐 소리는 같다. 타브 줄은 옮겨 받는다)
  // 게임 길이가 달라지는 수술(마지막 쉼표 뒤에 t를 붙이거나 마지막 쉼표를 나누기)은 하지 않는다
  const write = (id: string, mml: TrackText, span: readonly [number, number], text: string, renote = false): Song | undefined => {
    const next = { ...mml, text: spliceText(mml.text, [{ span, text }]) };
    if (!eq(textEnd(next), textEnd(mml))) {
      lengthRefused = true;
      return undefined;
    }
    return {
      ...song,
      tracks: song.tracks.map((tr) => {
        if (tr.id !== id) return tr;
        return renote ? { ...tr, notes: carryTabStrings(tr.notes, parseTrackText(id, next).notes), mml: next } : { ...tr, mml: next };
      }),
    };
  };
  for (const { track, mml, src } of sources) {
    const local = localAt(mml, e.at);
    const offset = local && tempoInsertOffset(mml.text, src.parsed, local);
    const done = offset !== undefined && offset !== null ? write(track.id, mml, [offset, offset], t) : undefined;
    if (done) return { song: done };
  }
  const within = (x: { start: Rat; dur: Rat }, at: Rat) => cmp(x.start, at) < 0 && cmp(add(x.start, x.dur), at) > 0;
  for (const { track, mml, src } of sources) {
    const local = localAt(mml, e.at);
    const rest = local && src.parsed.rests.find((r) => within(r, local));
    if (!local || !rest) continue;
    const a = lengthPieces(sub(local, rest.start), lengths);
    const b = lengthPieces(sub(add(rest.start, rest.dur), local), lengths);
    const done = a && b ? write(track.id, mml, rest.span, [...a.map((l) => `r${l}`), t, ...b.map((l) => `r${l}`)].join("")) : undefined;
    if (done) return { song: done };
  }
  for (const { track, mml, src } of sources) {
    const local = localAt(mml, e.at);
    const note = local && src.parsed.notes.find((n) => within(n, local));
    if (!local || !note) continue;
    // n 음표는 길이를 붙일 수 없어 나누지 않는다
    const pitch = /^[a-g][+#-]*/i.exec(mml.text.slice(note.span[0], note.span[1]))?.[0];
    if (!pitch) nNote = true;
    const a = lengthPieces(sub(local, note.start), lengths);
    const b = lengthPieces(sub(add(note.start, note.dur), local), lengths);
    const done = pitch && a && b ? write(track.id, mml, note.span, `${a.map((l) => pitch + l).join("&")}&${t}${b.map((l) => pitch + l).join("&")}`, true) : undefined;
    if (done) return { song: done };
  }
  // 끼울 자리를 하나도 못 찾은 경우도 길이가 바뀌는 자리뿐이었던 것으로 본다
  const failed: TempoEdgeFailure[] = [...(lengthRefused || !nNote ? ["length" as const] : []), ...(nNote ? ["n-note" as const] : [])];
  return { song, failed };
}

/**
 * 템포를 고치는 명령. 고친 뒤 새로 빠진 템포(고친 템포, 또는 뒤 템포가 사라져 다시 들리게 된 앞 템포)는
 * 그 악보 원문에도 적는다. 고치기 전부터 빠져 있던 것은 그대로 둔다 (곡 메뉴 "악보마다 템포 넣기"가 따로 채운다)
 */
function tempoCommand(label: string, change: (song: Song) => Song): Command {
  return songCommand(label, (song) => {
    const next = change(song);
    if (next === song) return song;
    const key = (ids: readonly string[], e: TempoEvent) => `${ids[0]}|${e.bpm}@${e.at.n}/${e.at.d}`;
    const before = new Set(songScores(song).flatMap((ids) => scoreTempo(song, ids).missing.map((e) => key(ids, e))));
    return songScores(next).reduce((out, ids) => {
      const fresh = scoreTempo(out, ids).missing.filter((e) => !before.has(key(ids, e)));
      return fresh.length > 0 ? fillScore(out, ids, fresh) : out;
    }, next);
  });
}

/** 지도 템포 at을 나타내는 원문의 t: 그 자리 t와, 같은 빠르기로 그 구간 안에 옮겨 적힌 t (그 자리에 다른 지도 템포가 있으면 빼고) */
function tokensFor(song: Song, at: Rat): (token: TempoToken) => boolean {
  const window = tempoWindows(song.tempo).find((w) => eq(w.event.at, at));
  return (token) =>
    eq(token.at, at) || (window !== undefined && inWindow(token, window) && !song.tempo.some((e) => eq(e.at, token.at)));
}

function withTempo(song: Song, at: Rat, bpm: number): Song {
  const represents = tokensFor(song, at);
  const tracks = song.tracks.map((t) => {
    const hits = (t.mml ? surgicalSource(t.mml)?.tokens : undefined)?.filter(represents) ?? [];
    if (!t.mml || hits.length === 0) return t;
    return { ...t, mml: { ...t.mml, text: spliceText(t.mml.text, hits.map((h) => ({ span: h.span, text: `t${bpm}` }))) } };
  });
  return { ...song, tempo: normalizeTempo([...song.tempo.filter((e) => !eq(e.at, at)), { at, bpm }]), tracks };
}

function withoutTempo(song: Song, at: Rat): Song {
  const represents = tokensFor(song, at);
  const tracks = song.tracks.map((t) => {
    if (!t.mml) return t;
    const hits = surgicalSource(t.mml)?.tokens.filter(represents) ?? [];
    if (hits.length === 0) return t;
    const text = t.mml.text;
    // 앞뒤가 모두 빈칸이면 빈칸 하나도 같이 지워 두 칸이 남지 않게 한다
    const spans = hits.map((h): [number, number] => {
      const [a, b] = h.span;
      const spaceBefore = a === 0 || /\s/.test(text[a - 1]!);
      return spaceBefore && /\s/.test(text[b] ?? "") ? [a, b + 1] : [a, b];
    });
    return { ...t, mml: { ...t.mml, text: spliceText(text, spans.map((span) => ({ span, text: "" }))) } };
  });
  return { ...song, tempo: song.tempo.filter((e) => !eq(e.at, at)), tracks };
}

/**
 * 악보 하나에 빠진 템포를 원문에 적는다: 음·쉼표 경계가 있는 원문 하나에 끼우고 (이미 t를 쓴 원문 먼저, 그다음 트랙 순서),
 * 끼울 곳이 없으면 그 악보 첫 원문을 버려 출력기가 쓰게 한다 (음 가운데면 출력기가 &로 나누거나 뒤쪽 음 경계로 옮긴다)
 */
function fillScore(song: Song, ids: readonly string[], missing: readonly TempoEvent[]): Song {
  let out = song;
  for (const e of missing) {
    const tracks = ids.map((id) => out.tracks.find((t) => t.id === id)!);
    if (tracks.some((t) => !t.mml)) break;
    const sources = tracks.map((t) => surgicalSource(t.mml!));
    const order = tracks.map((_, k) => k).filter((k) => sources[k]);
    order.sort((a, b) => Number(sources[b]!.tokens.length > 0) - Number(sources[a]!.tokens.length > 0));
    let done = false;
    for (const k of order) {
      const mml = tracks[k]!.mml!;
      const local = localAt(mml, e.at);
      const offset = local && tempoInsertOffset(mml.text, sources[k]!.parsed, local);
      if (offset === undefined || offset === null) continue;
      const id = tracks[k]!.id;
      out = { ...out, tracks: out.tracks.map((t) => (t.id === id ? { ...t, mml: { ...mml, text: spliceText(mml.text, [{ span: [offset, offset], text: `t${e.bpm}` }]) } } : t)) };
      done = true;
      break;
    }
    if (done) continue;
    // 경계가 없다: 첫 원문을 버리면 출력기가 그 트랙을 쓰며 남은 템포를 모두 넣는다
    const first = order[0];
    if (first === undefined) break;
    const id = tracks[first]!.id;
    out = {
      ...out,
      tracks: out.tracks.map((t) => {
        if (t.id !== id) return t;
        const { mml: _mml, ...rest } = t;
        return rest;
      }),
    };
    break;
  }
  return out;
}

