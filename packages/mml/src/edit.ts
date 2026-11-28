import {
  add,
  div,
  mul,
  rat,
  meterAt,
  meterGrid,
  measureStart,
  barAt,
  barBounds,
  barsOfRange,
  pruneMade,
  songProfile,
  type BarRange,
  METER_UNITS,
  carryTabStrings,
  unmarkNotes,
  cmp,
  eq,
  sub,
  toFloat,
  ZERO,
  DEFAULT_BPM,
  normalizeTempo,
  tempoClock,
  type Command,
  type GameProfile,
  type LengthLimit,
  type MadeRecord,
  type Marker,
  type Note,
  type Rat,
  type Song,
  type TempoEvent,
  type TimeSigEvent,
  type Track,
  type TrackText,
} from "@mmlce/core";
import { parseMml, type ParseResult } from "./parser.js";
import { optimizeMml } from "./optimizer.js";
import { canWriteExactly, lengthPieces, restText } from "./printer.js";
import { bpmBefore, padScore, scoreEnd, tempoBefore, textEnd, trackEnd } from "./score-end.js";
import { placeTempo, placeTempoByScore, scoreTrackIds, type TempoMove } from "./tempo-placement.js";
import { chordsPerScore } from "./clipboard.js";
import { limitOf, trackLimits } from "./track-limits.js";
import { distributeChords, type BookFit } from "./distribute.js";
import { mergeChords, type MergeResult } from "./merge.js";
import { gameTimeline } from "./game-timeline.js";
import { TRACK_COLORS } from "./track-color.js";
import { fitSlots } from "./slot-fit.js";
import { gameScores, withoutDefaultStart } from "./game-output.js";
import { pitchlessForOutput } from "./pitchless.js";
import { mergeTies, sameSound } from "./compare.js";
import { audibleTempo, gameSource, localAt, shortestWriting, spliceText, surgicalSource, sameTempo, tempoAtPosition, tempoInsertOffset, tempoTokens, type TempoToken } from "./tempo-text.js";

/** 곡 프로필로 연주자마다 악보 하나에 담는 트랙 수 (모르는 프로필이면 모바일) */
export function songChordsPerScore(song: Song): (playerId: string) => number {
  return chordsPerScore(song, songProfile(song));
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
  const lengths = songProfile(song).length;
  const declared = tracks.flatMap((t) => (t.mml ? tempoTokens(t.mml, undefined, lengths) : []));
  // 악보가 끝난 뒤 템포는 그 악보에 쓰지 않는다 (score-end.ts)
  const end = scoreEnd(tracks, undefined, lengths);
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
    undefined,
    lengths,
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
  return { text: optimizeMml(track.notes, { tempo: scoreTempo(song, score).generated.get(track.id) ?? [], profile: songProfile(song) }).text };
}

export interface ParsedTrackText {
  readonly parsed: ParseResult;
  readonly notes: Note[];
  /** 곡 위치로 옮긴 템포 */
  readonly tempo: TempoEvent[];
}

/**
 * 원문을 읽어 트랙 음과 템포로. 음 id는 트랙 id + 순번이라 같은 글이면 같은 id가 나온다.
 * lengths: 곡 프로필의 길이 한도 (길이 숫자의 값). 곡이 닿는 곳은 늘 songProfile(song).length를 넘긴다
 */
export function parseTrackText(trackId: string, source: TrackText, lengths?: LengthLimit): ParsedTrackText {
  const parsed = parseMml(source.text, { lengths });
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
      const lengths = songProfile(song).length;
      const old = parseTrackText(trackId, before, lengths);
      const now = parseTrackText(trackId, next, lengths);
      // 읽을 때 여러 트랙에 같이 적힌 템포는 하나로 합쳐졌으므로, 다른 트랙 원문에 아직 적혀 있는 템포는 빼지 않는다
      const others = song.tracks.filter((t) => t.id !== trackId && t.mml).flatMap((t) => parseTrackText(t.id, t.mml!, lengths).tempo);
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
 * 템포만 고치고 주석·빈칸을 벗긴 원문이 출력기 글보다 짧고 음·템포가 같으면 그 원문을 쓴다 (원문보다 길어지지 않게).
 * 게임은 악보마다 템포를 따로 읽으므로 곡 템포를 악보마다 모두 넣는다 (profile이 없으면 곡 프로필로 악보를 묶는다).
 * 사용자가 쓴 원문 표기는 바뀐다(원문을 쓸 때도 주석·빈칸은 빠진다). locked에 든 트랙(잠근 트랙)은 그대로 두고 템포도 맡기지 않는다.
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
  const outProfile = profile ?? songProfile(song);
  const tracks: Track[] = [];
  for (const t of song.tracks) {
    // 잠근 트랙은 글도 그대로 둔다
    if (locked?.has(t.id)) {
      tracks.push(t);
      continue;
    }
    const tempo = placed.get(t.id) ?? [];
    const optimized = optimizeMml(t.notes, { tempo, profile: outProfile }).text;
    // 출력기는 원문을 보지 않아 원문보다 길게 쓸 때가 있다. 템포만 고친 원문이 음·템포가 같고 더 짧으면 그것을 쓴다
    const source = t.mml ? gameSource(t.mml, tempo, outProfile) : undefined;
    const shorter = source !== undefined && source.length < optimized.length ? shortestWriting(t.notes, tempo, [source], outProfile.length) : undefined;
    const mml: TrackText = { text: shorter ?? optimized };
    const notes = carryTabStrings(t.notes, parseTrackText(t.id, mml, outProfile.length).notes);
    // 출력기가 쓸 수 없는 길이(아주 짧은 셋잇단 등)는 버려지므로, 다시 읽은 음이 원래 음과 다르면
    // 곡을 그대로 둔다 (글자 수를 줄이려다 음을 잃지 않게)
    if (!sameSound(t.notes, notes)) return { song, kept: "notes" };
    tracks.push({ ...t, notes, mml });
  }
  // 원문 끝 쉼표가 사라져 악보가 짧아지지 않게 악보 길이를 지킨다 (score-end.ts). 쉼표와 그 자리 템포만 붙으므로 음은 그대로.
  // 붙인 뒤에도 그 트랙 자리 글자 한도 안인 글을 먼저 고른다
  const limits = trackLimits(song, outProfile);
  const scoreEnds = new Map<string, Rat>();
  for (const ids of scoreTrackIds(song, chords)) {
    const end = scoreEnd(ids.map((id) => song.tracks.find((x) => x.id === id)!), ends, outProfile.length);
    ids.forEach((id) => scoreEnds.set(id, end));
    const at = ids.map((id) => tracks.findIndex((x) => x.id === id));
    const padded = padScore(at.map((k) => tracks[k]!.mml?.text ?? ""), end, bpmBefore(song.tempo, end), outProfile.length, ids.map((id) => !locked?.has(id)), ids.map((id) => limitOf(limits, id, outProfile)));
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
          return t?.mml ? tempoBefore(parseTrackText(t.id, t.mml, outProfile.length).tempo, end) : [];
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

/** 화음 분산을 곡에 적용한 결과. kept면 옮기기 전 곡을 그대로 두었고 그 까닭 (sound: 게임 소리가 달라짐) */
export type DistributedResult =
  | { readonly song: Song; readonly kept?: undefined }
  | { readonly song: Song; readonly kept: "notes" | "tempo" | "sound" };

/** 옮기기 전 곡의 연주자별 게임 시간표 (악보책 나누기는 같은 곡을 한도를 바꿔 가며 여러 번 확인한다) */
const timelineCache = new WeakMap<Song, WeakMap<GameProfile, Map<string, string>>>();

function timelineBefore(song: Song, profile: GameProfile, player: string): string {
  const byProfile = timelineCache.get(song) ?? new WeakMap<GameProfile, Map<string, string>>();
  timelineCache.set(song, byProfile);
  const byPlayer = byProfile.get(profile) ?? new Map<string, string>();
  byProfile.set(profile, byPlayer);
  let text = byPlayer.get(player);
  if (text === undefined) {
    text = gameTimeline(song, profile, player);
    byPlayer.set(player, text);
  }
  return text;
}

/**
 * distributeChords로 음을 옮긴 곡(moved)을 곡에 넣을 모양으로 마무리한다.
 * 모든 트랙을 글자 수 줄이기로 다시 쓰고(옮기기 전 트랙 길이를 지킨다), 음이 옮겨 간 연주자는 게임 출력을 다시 읽어
 * 옮기기 전(song)과 소리가 같은지 본다 (화음 분산 창의 spreadResult와 같다).
 * 글자 수 줄이기가 곡을 그대로 두거나(kept: 원문이 지워진 곡이라 끝 길이를 잃는다) 소리가 다르면 옮기기 전 곡을 그대로 돌려준다
 */
export function settleDistributed(song: Song, moved: Song, profile: GameProfile, locked?: ReadonlySet<string>): DistributedResult {
  if (moved === song) return { song };
  // 음을 옮긴 트랙은 원문이 지워지므로, 옮기기 전 트랙 길이(원문 끝 쉼표 포함)를 지킬 길이로 넘긴다
  const compact = compactResult(moved, profile, locked, new Map(song.tracks.map((t) => [t.id, trackEnd(t, songProfile(song).length)])));
  if (compact.kept) return { song, kept: compact.kept };
  const players = new Set(moved.tracks.filter((t, k) => t !== song.tracks[k]).map((t) => t.playerId));
  for (const player of players) {
    if (gameTimeline(compact.song, profile, player) !== timelineBefore(song, profile, player)) return { song, kept: "sound" };
  }
  return { song: compact.song };
}

/**
 * 화음 분산 명령. 음을 옮긴 뒤 모든 트랙을 최적화 출력기로 다시 쓴다
 * (곡 템포를 채널마다 다시 나눠 넣어야 하므로 옮기지 않은 트랙의 표기도 바뀐다). 잠근 트랙은 음도 글도 그대로 둔다.
 * 다시 쓸 수 없거나 게임 소리가 달라지면 곡을 그대로 둔다 (settleDistributed).
 * slots면 먼저 자리를 맞춘다(fitSlots: 자리마다 한도가 다른 게임에서 큰 트랙을 큰 자리로). 모바일은 그대로다
 */
export function distributeSong(profile: GameProfile, label = "화음 분산", fit?: BookFit, locked?: ReadonlySet<string>, slots = true): Command {
  return {
    label,
    apply: (song) => {
      const fitted = slots ? fitSlots(song, profile, locked).song : song;
      return settleDistributed(
        fitted,
        distributeChords(fitted, profile, { ...(fit === undefined ? {} : { fit }), ...(locked ? { locked } : {}) }).song,
        profile,
        locked,
      ).song;
    },
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
export function mergeResult(song: Song, profile: GameProfile, locked?: ReadonlySet<string>, slots = true): MergeResult {
  const merged = mergeOnly(song, profile, locked);
  // 병합으로 트랙이 빠지면 뒤 트랙 자리가 바뀌므로, 병합한 뒤에 자리를 맞춘다 (모바일은 그대로)
  if (!slots || merged.moved === 0) return merged;
  return { ...merged, song: fitSlots(merged.song, profile, locked).song };
}

function mergeOnly(song: Song, profile: GameProfile, locked?: ReadonlySet<string>): MergeResult {
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
    // 비운 트랙을 지우면 뒤 트랙이 앞 자리로 당겨진다. 자리 한도가 줄어드는 트랙이 생기면(자리마다 한도가 다른 게임) 빈 트랙으로 남긴다
    if (merged.removed.length > 0 && limitsShrink(current, merged.song, profile)) merged = mergeChords(current, profile, { ...options, keepEmpty: true });
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

/** 곡을 바꾼 뒤 자리 한도가 줄어든 트랙이 있는지 (병합으로 트랙을 지워 뒤 트랙이 앞 자리로 당겨질 때) */
function limitsShrink(before: Song, after: Song, profile: GameProfile): boolean {
  const was = trackLimits(before, profile);
  return [...trackLimits(after, profile)].some(([id, limit]) => limit < (was.get(id) ?? limit));
}

/** 자리 맞추기 명령 (fitSlots, 글자 수 맞추기 창). 실행 취소하면 바꾸기 전 곡으로 돌아간다 */
export function fitSlotsSong(profile: GameProfile, locked?: ReadonlySet<string>, label = "자리 맞추기"): Command {
  return {
    label,
    apply: (song) => fitSlots(song, profile, locked).song,
    invert: (before) => restoreSong(before),
  };
}

/** 화음 병합 명령 (mergeResult). 실행 취소하면 병합 전 곡으로 돌아간다 */
export function mergeSong(profile: GameProfile, label = "화음 병합", locked?: ReadonlySet<string>, slots = true): Command {
  return {
    label,
    apply: (song) => mergeResult(song, profile, locked, slots).song,
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
        // 더하는 곡의 만든 기록은 가져오지 않으므로 그 표시도 뗀다
        const notes = unmarkNotes(t.mml ? carryTabStrings(t.notes, parseTrackText(id, t.mml, songProfile(other).length).notes) : t.notes.map((n, k) => ({ ...n, id: `${id}.${k + 1}` })));
        return { ...t, id, playerId: players.get(t.playerId)?.id ?? t.playerId, notes };
      });
      // 트랙 색을 트랙마다 정해 두지 않은 곡(MML 글 등)은 그동안 보이던 대로 악보 안 위치 색을 준다
      const placed = new Map<string, number>();
      const colored = other.colorsKept
        ? tracks
        : tracks.map((t) => {
            const k = placed.get(t.playerId) ?? 0;
            placed.set(t.playerId, k + 1);
            return t.colorPinned ? t : { ...t, color: TRACK_COLORS[k % TRACK_COLORS.length]! };
          });
      return {
        ...song,
        tempo: normalizeTempo([...song.tempo, ...other.tempo]),
        players: [...song.players, ...players.values()],
        tracks: [...song.tracks, ...colored],
      };
    },
    invert: (before) => restoreSong(before),
  };
}

/** 마디 넣기의 템포 지도: 곡 처음(0)의 템포는 그대로 두고, 넣는 자리(at)와 그 뒤의 템포는 넣는 길이만큼 민다 */
function insertTempo(tempo: Song["tempo"], at: Rat, length: Rat): Song["tempo"] {
  return tempo.map((t) => (cmp(t.at, ZERO) === 0 || cmp(t.at, at) < 0 ? t : { ...t, at: add(t.at, length) }));
}

/**
 * 마디 넣기: at 자리에 length만큼 빈 시간을 넣는다. at 뒤에서 시작하는 음·템포·마커를 모두 민다
 * (곡 처음 0의 템포·박자는 곡 전체의 시작 값이므로 제자리에 둔다).
 * at에 걸쳐 있는 음은 그대로 둔다(길이 유지). 바뀐 트랙은 원문 대신 출력기로 다시 쓰고, 끝 쉼표로 지키던 길이도 밀어 지킨다 (keepMovedEnd).
 * 음이 안 바뀐 트랙의 원문은 쉼표를 끼워 at 뒤의 t·끝 쉼표도 함께 민다 (insertTextTime).
 */
export function insertTime(at: Rat, length: Rat, label = "마디 넣기"): Command {
  const shift = (r: Rat) => (cmp(r, at) >= 0 ? add(r, length) : r);
  return {
    label,
    apply(song) {
      const lengths = songProfile(song).length;
      const next: Song = {
        ...song,
        // 곡 처음(0)의 템포·박자는 그대로 둔다. 밀면 넣은 마디가 기본 템포(t120)로 연주된다.
        // 넣는 자리 뒤의 변화는 함께 민다
        tempo: insertTempo(song.tempo, at, length),
        timeSig: song.timeSig.map((s) => (cmp(s.at, ZERO) === 0 ? s : { ...s, at: shift(s.at) })),
        // 범위 메모의 끝은 넣는 자리보다 뒤일 때만 민다 (끝이 넣는 자리와 같으면 범위를 늘리지 않는다)
        markers: song.markers.map((m) => ({ ...m, at: shift(m.at), ...(m.end ? { end: cmp(m.end, at) > 0 ? add(m.end, length) : m.end } : {}) })),
        ...(song.keys ? { keys: song.keys.map((k) => (cmp(k.at, ZERO) === 0 ? k : { ...k, at: shift(k.at) })) } : {}),
        tracks: song.tracks.map((t) => {
          if (!t.notes.some((n) => cmp(n.start, at) >= 0)) return keepText(t, t.mml && insertTextTime(t.mml, at, length, lengths));
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
      // 곡 처음(0)의 t는 지도처럼 제자리에 둔다
      return keepMovedEnd(song, next, (r) => (cmp(r, ZERO) === 0 ? r : shift(r)));
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
 * 마디 빼기의 마커: 구간 안 마커(한 자리)는 지우고 뒤는 당긴다.
 * 범위 메모는 구간 밖으로 남는 부분이 있으면 남기고 (구간 안 끝은 at으로), 모두 구간 안이면 지운다
 */
function removeMarkerSpan(markers: readonly Marker[], at: Rat, end: Rat, length: Rat): Marker[] {
  const pull = (r: Rat) => (cmp(r, at) < 0 ? r : cmp(r, end) >= 0 ? sub(r, length) : at);
  return markers.flatMap((m) => {
    if (!m.end) return cmp(m.at, at) < 0 || cmp(m.at, end) >= 0 ? [{ ...m, at: pull(m.at) }] : [];
    const from = pull(m.at);
    const to = pull(m.end);
    return cmp(to, from) > 0 ? [{ ...m, at: from, end: to }] : [];
  });
}

/**
 * 마디 빼기: [at, at+length) 구간을 지우고 뒤를 당긴다. 구간 안의 음은 지우고,
 * 구간에 걸친 음은 구간 밖 부분만 남긴다. 구간 안의 템포·박자는 마지막 값을 at에 남긴다.
 * &로 이어 주던 다음 음이 지워졌거나 더 이상 바로 붙지 않으면 &를 푼다.
 * 음이 바뀐 트랙은 출력기로 다시 쓰고, 끝 쉼표로 지키던 길이도 당겨 지킨다 (keepMovedEnd).
 * 음이 안 바뀐 트랙의 원문은 구간 안 쉼표를 줄여 뒤의 t·끝 쉼표도 함께 당긴다 (deleteTextTime).
 */
export function deleteTime(at: Rat, length: Rat, label = "마디 빼기"): Command {
  const end = add(at, length);
  const back = (r: Rat) => (cmp(r, end) >= 0 ? sub(r, length) : r);
  return {
    label,
    apply(song) {
      const lengths = songProfile(song).length;
      const tempo = removeSpan(song.tempo, at, end, length);
      // 구간 끝(end)에 템포가 있으면 그것이 at으로 당겨지고, 구간 안 템포는 하나도 남지 않는다 (removeSpan)
      const left = { bpm: tempoAtPosition(tempo, at), endTempo: song.tempo.some((e) => eq(e.at, end)) };
      const broken = new Set<string>();
      const next: Song = {
        ...song,
        tempo,
        timeSig: removeSpan(song.timeSig, at, end, length),
        markers: removeMarkerSpan(song.markers, at, end, length),
        ...(song.keys ? { keys: removeSpan(song.keys, at, end, length) } : {}),
        tracks: song.tracks.map((t) => {
          const touched = t.notes.some((n) => cmp(add(n.start, n.dur), at) > 0);
          if (!touched) return keepText(t, t.mml && deleteTextTime(t.mml, at, length, left, lengths));
          const sorted = [...t.notes].sort((a, b) => cmp(a.start, b.start));
          // 원래 음 → 남은 음 (지워졌으면 없음)
          const kept = new Map<Note, Note>();
          for (const n of sorted) {
            const nEnd = add(n.start, n.dur);
            // 구간에 걸리는 만든 음(지워지거나 잘림)은 그 기록을 끊는다 (아래 broken)
            if (n.made !== undefined && cmp(nEnd, at) > 0 && cmp(n.start, end) < 0) broken.add(n.made);
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
      // 구간 안 자리는 구간 시작으로, 뒤는 구간만큼 당긴다
      const moved = keepMovedEnd(song, next, (r) => (cmp(r, at) < 0 ? r : cmp(r, end) < 0 ? at : sub(r, length)));
      return broken.size === 0 ? moved : breakMade(moved, broken);
    },
    invert: (before) => restoreSong(before),
  };
}

/**
 * 마디 빼기로 일부가 지워지거나 잘린 만든 기록(아르페지오·꾸밈음·슬라이드·트릴)은 그 표시를 모두 떼고 기록을 버린다.
 * 남겨 두면 되돌리기가 지운 마디의 원래 음을 앞 마디 자리에 다시 넣을 수 있다. 남은 음은 보통 음으로 그대로 둔다
 */
function breakMade(song: Song, broken: ReadonlySet<string>): Song {
  const tracks = song.tracks.map((t) =>
    t.notes.some((n) => n.made !== undefined && broken.has(n.made))
      ? { ...t, notes: t.notes.map((n) => (n.made !== undefined && broken.has(n.made) ? unmarkNotes([n])[0]! : n)) }
      : t,
  );
  return pruneMade({ ...song, tracks });
}

/** 곡에서 지울 마디 구간 [시작, 끝) 목록 (앞에서부터, 붙은 범위는 하나로). 곡 끝 뒤 마디는 뺀다 ("20-"는 곡 끝 마디까지) */
export function barSpans(song: Song, ranges: readonly BarRange[]): (readonly [Rat, Rat])[] {
  // 원문 길이(끝 쉼표 포함)와 음 끝 가운데 늦은 쪽
  let songEnd = scoreEnd(song.tracks, undefined, songProfile(song).length);
  for (const t of song.tracks) if (cmp(notesEnd(t.notes), songEnd) > 0) songEnd = notesEnd(t.notes);
  if (cmp(songEnd, ZERO) <= 0) return [];
  const lastBar = barsOfRange(song.timeSig, ZERO, songEnd)[1];
  const bars = new Set<number>();
  for (const [a, b] of ranges) for (let k = Math.max(1, a); k <= Math.min(b, lastBar); k++) bars.add(k);
  const out: [Rat, Rat][] = [];
  for (const k of [...bars].sort((x, y) => x - y)) {
    const [start, stop] = barBounds(song.timeSig, k);
    const prev = out[out.length - 1];
    if (prev && eq(prev[1], start)) prev[1] = stop;
    else out.push([start, stop]);
  }
  return out;
}

/** 마디 지우기 미리 보기: 지울 마디 수, 지울 음 수, 잘릴(구간에 걸친) 음 수, 끊길 만든 기록 수 */
export interface DeleteBarsCheck {
  readonly bars: number;
  readonly removed: number;
  readonly cut: number;
  readonly made: number;
  /** 지워지는 안 끝낸 작업 메모 수 (할 일이 조용히 사라지지 않게 창에 적는다) */
  readonly memos: number;
}

/** before에 있던 안 끝낸 작업 메모 가운데 after에 없는 것의 수 (마디 빼기·지우기로 사라진 할 일) */
export function lostOpenMemos(before: Song, after: Song): number {
  const kept = new Set(after.markers.map((m) => m.id));
  return before.markers.filter((m) => m.kind === "memo" && !m.done && !kept.has(m.id)).length;
}

export function checkDeleteBars(song: Song, ranges: readonly BarRange[]): DeleteBarsCheck {
  const spans = barSpans(song, ranges);
  let bars = 0;
  for (const [start, stop] of spans) {
    const [a, b] = barsOfRange(song.timeSig, start, stop);
    bars += b - a + 1;
  }
  let removed = 0;
  let cut = 0;
  const made = new Set<string>();
  for (const t of song.tracks)
    for (const n of t.notes) {
      const nEnd = add(n.start, n.dur);
      const hit = spans.find(([start, stop]) => cmp(nEnd, start) > 0 && cmp(n.start, stop) < 0);
      if (!hit) continue;
      if (cmp(n.start, hit[0]) >= 0 && cmp(nEnd, hit[1]) <= 0) removed++;
      else cut++;
      if (n.made !== undefined) made.add(n.made);
    }
  const live = new Set((song.made ?? []).map((r) => r.id));
  const memos = song.markers.some((m) => m.kind === "memo" && !m.done) ? lostOpenMemos(song, deleteBars(ranges).apply(song)) : 0;
  return { bars, removed, cut, made: [...made].filter((id) => live.has(id)).length, memos };
}

/**
 * 고른 마디들 지우기: 모든 트랙에서 그 마디를 지우고 뒤 음·템포·박자·마커를 당긴다 (마디 빼기를 뒤 범위부터 차례로).
 * 실행 취소 한 칸. 곡 끝 뒤 마디만 고르면 곡 그대로
 */
export function deleteBars(ranges: readonly BarRange[], label = "마디 지우기"): Command {
  return {
    label,
    apply(song) {
      // 뒤 구간부터 지워야 앞 구간 자리가 그대로다
      return barSpans(song, ranges)
        .reverse()
        .reduce((s, [start, stop]) => deleteTime(start, sub(stop, start), label).apply(s), song);
    },
    invert: (before) => restoreSong(before),
  };
}

/**
 * 마디를 지우거나 넣을 때 원곡 대조(원곡 동시재생) 위치를 어떻게 맞출지. 배경 영상 어긋남도 뜻이 같아 같은 계획을 쓴다.
 * 원곡 어긋남은 "원곡 시각(초) = 곡 시각(초) + 어긋남"이다
 */
export interface ReferenceShiftPlan {
  /**
   * 어긋남에 더할 초 (지운 구간이 원곡보다 앞이거나 곡 처음이면 그 구간의 실제 길이, 넣을 때는 넣은 길이만큼 음수).
   * 0이면 그대로
   */
  readonly shiftSec: number;
  /**
   * 어긋남 하나로는 맞출 수 없는(원곡이 울리는 가운데를 지우는) 첫 구간의 첫 마디. 지운 뒤 이 마디부터 원곡과 어긋난다.
   * 이 마디 앞은 지운 만큼(shiftSec) 당겨 맞춘다. 모두 맞출 수 있으면 undefined
   */
  readonly brokenBar?: number;
}

/** 원곡 어긋남은 ms로 맞추므로 0.5ms 안의 차이는 같은 자리로 본다 */
const REFERENCE_EPS = 0.0005;

/**
 * 곡에서 spans 구간들(앞에서부터, [시작, 끝) 온음표 단위)을 지울 때 원곡 어긋남을 얼마나 옮기면 남은 곡과 원곡이 맞는지.
 * 지운 구간이 원곡이 울리기 시작하는 곡 시각(-offsetSec)보다 앞에서 끝나거나 곡 처음(0)에서 시작하면,
 * 그 뒤 곡은 구간의 실제 길이(지우기 전 곡 템포로 잰 초)만큼 일찍 울리므로 어긋남에 그만큼 더하면 맞는다.
 * (지우기는 구간 끝에서 울리던 템포를 구간 시작에 남기므로 뒤 곡의 템포는 그대로다)
 * 원곡이 울리는 가운데를 지우면 그 자리부터는 어긋남 하나로 맞출 수 없다 (brokenBar).
 * durationSec(원곡 길이)를 알면 원곡이 끝난 뒤를 지우는 구간은 원곡과 상관없다고 본다
 */
export function referenceShiftForDelete(
  song: Pick<Song, "tempo" | "timeSig">,
  spans: readonly (readonly [Rat, Rat])[],
  offsetSec: number,
  durationSec?: number,
): ReferenceShiftPlan {
  const clock = tempoClock(song.tempo);
  // 원곡이 울리기 시작·끝나는 곡 시각(초)
  const start = -offsetSec;
  const end = durationSec === undefined ? Infinity : durationSec - offsetSec;
  let shiftSec = 0;
  for (const [from, to] of [...spans].sort((a, b) => cmp(a[0], b[0]))) {
    const a = clock(from);
    const b = clock(to);
    if (a >= end - REFERENCE_EPS) break;
    if (cmp(from, ZERO) === 0 || b <= start + REFERENCE_EPS) shiftSec += b - a;
    else return { shiftSec, brokenBar: barAt(song.timeSig, from) };
  }
  return { shiftSec };
}

/**
 * 곡의 at 자리에 length(온음표 단위)만큼 마디를 넣을 때 원곡 대조(또는 배경 영상) 어긋남을 얼마나 옮기면 넣은 뒤 곡과 맞는지.
 * 마디 지우기(referenceShiftForDelete)와 같은 규칙: 곡 처음(0)에 넣거나 원곡이 울리기 시작하는 곡 시각(-offsetSec)
 * 앞에 넣으면 그 뒤 곡이 넣은 마디의 실제 길이(넣은 자리 템포로 잰 초)만큼 늦게 울리므로 어긋남에서 그만큼 뺀다 (shiftSec가 음수).
 * 원곡이 울리는 가운데에 넣으면 어긋남 하나로 맞출 수 없다 (brokenBar = 넣은 마디). durationSec를 알면 원곡이 끝난 뒤에 넣는 것은 상관없다
 */
export function referenceShiftForInsert(
  song: Pick<Song, "tempo" | "timeSig">,
  at: Rat,
  length: Rat,
  offsetSec: number,
  durationSec?: number,
): ReferenceShiftPlan {
  const a = tempoClock(song.tempo)(at);
  const start = -offsetSec;
  const end = durationSec === undefined ? Infinity : durationSec - offsetSec;
  if (cmp(length, ZERO) <= 0) return { shiftSec: 0 };
  if (cmp(at, ZERO) !== 0 && a >= end - REFERENCE_EPS) return { shiftSec: 0 };
  if (cmp(at, ZERO) === 0 || a <= start + REFERENCE_EPS) {
    // 넣은 마디는 넣는 자리 앞에서 울리던 템포로 연주된다 (마디 넣기의 템포 지도로 잰다)
    const after = tempoClock(insertTempo(song.tempo, at, length));
    return { shiftSec: -(after(add(at, length)) - after(at)) };
  }
  return { shiftSec: 0, brokenBar: barAt(song.timeSig, at) };
}

/** 고친 원문을 트랙에 넣는다. 원문이 그대로면 트랙도 그대로 돌려준다 */
function keepText(t: Track, mml: TrackText | undefined): Track {
  return !mml || mml === t.mml ? t : { ...t, mml };
}

/** 쉼표로 쓴 길이 (음길이 한도 안 숫자·점으로 정확히). 쓸 수 없으면 undefined */
function restPieces(dur: Rat, lengths: LengthLimit): string | undefined {
  return lengthPieces(dur, lengths)?.map((p) => `r${p}`).join("");
}

/**
 * 마디 넣기에서 음은 안 바뀌어 원문을 그대로 두는 트랙(at 뒤에서 시작하는 음이 없는 트랙)의 원문도 곡 템포 지도와 함께 민다.
 * 이런 원문은 at 뒤에 쉼표와 t만 있다(템포 트랙, 끝 쉼표로 길이를 지키는 트랙). at 뒤 첫 쉼표·t 앞에, at에 걸친 쉼표만
 * 있으면 그 쉼표 뒤에 넣는 길이만큼 쉼표를 끼운다. 그러면 at 뒤의 t가 지도처럼 밀리고, 끝 쉼표로 지키던 길이도 함께 늘어난다.
 * 곡 처음(0)의 t는 지도처럼 제자리에 둔다. at에 걸친 음은 음처럼 그대로 두고(끝도 그대로),
 * 게임이 길이에서 빼는 맨 끝 쉼표 하나(score-end.ts)도 길이에 들지 않으므로 밀 것으로 보지 않는다.
 * 원문이 at 뒤에서 시작하면(offset) offset만 민다. 문법 오류가 있거나 쉼표로 정확히 쓸 수 없는 길이면 원문을 그대로 둔다
 */
function insertTextTime(mml: TrackText, at: Rat, length: Rat, lengths: LengthLimit): TrackText {
  const offset = mml.offset ?? ZERO;
  if (cmp(offset, ZERO) > 0 && cmp(at, offset) <= 0) return { ...mml, offset: add(offset, length) };
  const source = surgicalSource(mml, lengths);
  if (!source) return mml;
  const { parsed, tokens } = source;
  const local = sub(at, offset);
  // 게임이 길이에서 빼는 맨 끝 쉼표 (있으면 gameEnd가 end보다 앞)
  const trailing = cmp(parsed.gameEnd, parsed.end) < 0 ? parsed.rests[parsed.rests.length - 1] : undefined;
  const elements = [
    ...parsed.notes.map((n) => ({ start: n.start, end: add(n.start, n.dur), span: n.span, rest: false })),
    ...parsed.rests.filter((r) => r !== trailing).map((r) => ({ start: r.start, end: add(r.start, r.dur), span: r.span, rest: true })),
  ].sort((a, b) => a.span[0] - b.span[0]);
  // at 뒤에서 시작하는 첫 쉼표·t 앞 (그 자리의 t도 함께 밀리게 t 앞에 끼운다)
  const after = [
    ...elements.filter((e) => cmp(e.start, local) >= 0).map((e) => e.span[0]),
    ...tokens.filter((k) => cmp(k.at, at) >= 0 && cmp(k.at, ZERO) > 0).map((k) => k.span[0]),
  ];
  let where = after.length > 0 ? Math.min(...after) : undefined;
  if (where === undefined) {
    // 뒤에 아무것도 없고 마지막 쉼표가 at에 걸쳐 있으면 그 쉼표를 늘린다 (그 쉼표 뒤에 끼운다)
    const last = elements[elements.length - 1];
    if (last?.rest && cmp(last.end, local) > 0) where = last.span[1];
  }
  if (where === undefined) return mml;
  const rests = restPieces(length, lengths);
  if (!rests) return mml;
  return { ...mml, text: spliceText(mml.text, [{ span: [where, where], text: rests }]) };
}

/**
 * 마디 빼기에서 음은 안 바뀌어 원문을 그대로 두는 트랙(at 뒤로 넘는 음이 없는 트랙)의 원문도 곡 템포 지도와 함께 당긴다.
 * 이런 원문은 at 뒤에 쉼표와 t만 있으므로, [at, at+length) 구간에 든 쉼표를 그만큼 줄이거나 지운다.
 * 그러면 구간 뒤의 t가 지도처럼 당겨지고, 끝 쉼표로 지키던 길이도 함께 준다.
 * 게임이 길이에서 빼는 맨 끝 쉼표는 길이에 들지 않으므로 줄이지 않는다 (지우면 앞 쉼표가 맨 끝이 돼 길이가 준다).
 * 구간 안의 t는 지도(removeSpan)처럼 마지막 하나만 남긴다(쉼표가 줄어 at 자리에 온다). kept.bpm은 그 자리에 남은 지도 빠르기로,
 * 다른 트랙이 적은 템포가 남았으면 그 빠르기로 적는다. kept.endTempo면(구간 끝 템포가 at으로 당겨짐) 구간 안 t를 모두 지운다.
 * 다만 지운 t가 맨 끝 쉼표 뒤의 명령이었으면 그 쉼표가 맨 끝이 돼 게임이 버리므로, 마지막 t를 그 자리 빠르기로 남긴다.
 * 원문이 구간 뒤에서 시작하면(offset) offset만 당긴다. 문법 오류가 있거나 쉼표로 정확히 쓸 수 없는 길이,
 * 고친 원문의 게임 길이가 구간만큼 준 길이와 다르면 원문을 그대로 둔다
 */
function deleteTextTime(
  mml: TrackText,
  at: Rat,
  length: Rat,
  kept: { readonly bpm: number | undefined; readonly endTempo: boolean },
  lengths: LengthLimit,
): TrackText {
  const end = add(at, length);
  const offset = mml.offset ?? ZERO;
  if (cmp(offset, ZERO) > 0 && cmp(offset, end) >= 0) return { ...mml, offset: sub(offset, length) };
  const source = surgicalSource(mml, lengths);
  if (!source) return mml;
  const { parsed, tokens } = source;
  // 원문 안 위치로 본 구간
  const from = cmp(at, offset) > 0 ? sub(at, offset) : ZERO;
  const to = sub(end, offset);
  // 게임이 길이에서 빼는 맨 끝 쉼표 (있으면 gameEnd가 end보다 앞)
  const trailing = cmp(parsed.gameEnd, parsed.end) < 0 ? parsed.rests[parsed.rests.length - 1] : undefined;
  const rests: { span: readonly [number, number]; text: string }[] = [];
  for (const r of parsed.rests) {
    if (r === trailing) continue;
    const rEnd = add(r.start, r.dur);
    const cutFrom = cmp(r.start, from) > 0 ? r.start : from;
    const cutTo = cmp(rEnd, to) < 0 ? rEnd : to;
    if (cmp(cutTo, cutFrom) <= 0) continue;
    const left = sub(r.dur, sub(cutTo, cutFrom));
    const text = left.n > 0 ? restPieces(left, lengths) : "";
    if (text === undefined) return mml;
    rests.push({ span: r.span, text });
  }
  // 빼고 난 원문의 게임 길이 (원문 안 위치): 구간 앞이면 그대로, 구간 안이면 구간 시작, 구간 뒤면 구간만큼 당긴다
  const g = parsed.gameEnd;
  const want = cmp(g, from) <= 0 ? g : cmp(g, to) >= 0 ? sub(g, sub(to, from)) : from;
  const inside = tokens.filter((k) => cmp(k.at, at) >= 0 && cmp(k.at, end) < 0);
  const moved = cmp(offset, at) > 0;
  for (const keepLast of kept.endTempo ? [false, true] : [true]) {
    const last = keepLast ? inside[inside.length - 1] : undefined;
    const edits = [...rests];
    for (const k of inside) {
      const bpm = kept.bpm ?? k.bpm;
      if (k !== last) edits.push({ span: k.span, text: "" });
      else if (k.bpm !== bpm) edits.push({ span: k.span, text: `t${bpm}` });
    }
    if (edits.length === 0 && !moved) return mml;
    const text = spliceText(mml.text, edits);
    if (eq(parseMml(text, { lengths }).gameEnd, want)) return { ...mml, text, ...(moved ? { offset: at } : {}) };
  }
  return mml;
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
  // 원문 없는 트랙의 템포는 출력기가 그 트랙에 쓰는 템포(scoreTempo)다. 글을 다시 쓰고 읽지 않고 악보마다 한 번 계산한다
  let generated: Map<string, TempoEvent[]> | undefined;
  const lengths = songProfile(song).length;
  const written = normalizeTempo(
    score.flatMap((tid) => {
      if (tid === trackId) return parseTrackText(trackId, { text }, lengths).tempo;
      const t = song.tracks.find((x) => x.id === tid);
      if (!t) return [];
      if (t.mml) return textTempo(t.id, t.mml, lengths);
      generated ??= scoreTempo(song, score).generated;
      return generated.get(t.id) ?? [];
    }),
  );
  let bpm = DEFAULT_BPM;
  for (const e of written) if (cmp(e.at, at) <= 0) bpm = e.bpm;
  return bpm;
}

/**
 * 원문의 템포 (곡 위치). 원문 글은 바뀌지 않는 값이라 글마다 한 번만 읽는다 (여러 트랙 일괄 편집에서 같은 글을 되풀이해 읽지 않게).
 * 길이 한도가 다르면 같은 글도 템포 자리가 달라 다시 읽는다
 */
const textTempoCache = new WeakMap<TrackText, { readonly lengths: LengthLimit; readonly tempo: TempoEvent[] }>();
function textTempo(trackId: string, mml: TrackText, lengths: LengthLimit): TempoEvent[] {
  const hit = textTempoCache.get(mml);
  if (hit && hit.lengths === lengths) return hit.tempo;
  const tempo = parseTrackText(trackId, mml, lengths).tempo;
  textTempoCache.set(mml, { lengths, tempo });
  return tempo;
}

/**
 * 음을 직접 고치는 편집(원문을 지움)에서 원문 끝 쉼표로 지키던 트랙 길이를 지킨다 (score-end.ts).
 * 원문이 있던 트랙의 마지막 음 끝이 그대로인데(볼륨·높이만 바꿈 등) 원문 게임 길이가 더 길면, 출력기로 다시 쓴 글에
 * 모자란 쉼표와 그 자리 템포를 붙여 원문으로 남긴다. 마지막 음 끝과 지킨 끝 사이에 이 트랙이 적은 템포
 * (예: `t60c4t80r4r4`의 t80)도 같은 자리에 쉼표로 띄워 다시 적는다 (빠지면 끝 쉼표의 시간이 달라진다).
 * 음 끝이 바뀐 편집(끝 음을 지우거나 늘림)은 전처럼 음 끝이 길이다. 단 mode "tail"(만든 것 되돌리기·아르페지오 적용)은
 * 원문에 마지막 음 뒤 끝 쉼표가 실제로 있었으면(원문 게임 길이 > 옛 음 끝) 음 끝이 바뀌어도 그 길이를 지킨다
 * (쉼표만 있던 트랙에 원래 화음을 돌려놓거나, 접기로 베이스를 다른 트랙에 옮겨 비운 트랙의 끝 쉼표가 사라지지 않게).
 * 끝 쉼표가 없던 원문(음이 끝까지 찬 원문)은 음 끝이 길이라, 손으로 늘린 음을 되돌릴 때 없던 쉼표를 새로 만들지 않는다.
 * 다시 읽은 음이 고친 음과 다르면(출력기가 쓸 수 없는 길이 등) 전처럼 원문 없이 둔다
 */
export function keepTextEnd(before: Song, after: Song, trackIds: readonly string[], mode: "same-end" | "tail" = "same-end"): Song {
  const lengths = songProfile(after).length;
  let out = after;
  for (const id of trackIds) {
    const old = before.tracks.find((t) => t.id === id);
    const now = out.tracks.find((t) => t.id === id);
    if (!old?.mml || !now || now.mml) continue;
    const end = textEnd(old.mml, undefined, lengths);
    const last = notesEnd(now.notes);
    const kept = mode === "tail" ? cmp(end, notesEnd(old.notes)) > 0 : eq(notesEnd(old.notes), last);
    if (!kept || cmp(end, last) <= 0) continue;
    const mml = paddedText(out, now, textTempo(id, old.mml, lengths), end, lengths);
    if (mml) out = { ...out, tracks: out.tracks.map((t) => (t.id === id ? { ...now, mml } : t)) };
  }
  return out;
}

/**
 * 원문 없는 트랙의 글을 end(곡 위치)까지 끝 쉼표로 늘여 악보 길이를 지킨다 (MML@ 권 잇기에서 마지막 권 끝 쉼표 등).
 * 다시 읽은 음이 같고 길이가 end일 때만 바꾸고, 아니면 곡을 그대로 돌려준다
 */
export function padTrackEnd(song: Song, trackId: string, end: Rat): Song {
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track || track.mml || cmp(end, notesEnd(track.notes)) <= 0) return song;
  const mml = paddedText(song, track, [], end, songProfile(song).length);
  return mml ? { ...song, tracks: song.tracks.map((t) => (t.id === trackId ? { ...track, mml } : t)) } : song;
}

/**
 * 출력기로 다시 쓴 트랙 글을 end(곡 위치)까지 가게 한다: 마지막 음 뒤 end 앞까지 own(원문이 적었던 템포)을 다시 적고,
 * 모자란 쉼표와 그 자리 템포를 붙인다. 다시 읽은 음이 고친 음과 다르거나 길이가 end가 아니면 undefined
 */
function paddedText(song: Song, track: Track, own: readonly TempoEvent[], end: Rat, lengths: LengthLimit): TrackText | undefined {
  const base = withTailTempo(trackSource(song, track).text, own, end, lengths);
  const text = padScore([base], end, writtenBpmAt(song, track.id, base, end), lengths)[0]!;
  const mml: TrackText = { text };
  return eq(textEnd(mml, undefined, lengths), end) && sameSound(track.notes, parseTrackText(track.id, mml, lengths).notes) ? mml : undefined;
}

/**
 * 마디 넣기·빼기로 음을 옮겨 원문을 지운 트랙도 원문 끝 쉼표로 지키던 길이를 지킨다 (keepTextEnd의 "tail"과 같은 생각).
 * 원문에 마지막 음 뒤 끝 쉼표가 실제로 있었으면(원문 게임 길이 > 옛 음 끝) 그 길이를 move로 옮긴 자리까지 쉼표를 붙인다.
 * 끝 쉼표 사이에 원문이 적었던 t도 옮긴 자리에 다시 적는다. 빠르기는 그 자리 지도 빠르기로 적는다
 * (마디 빼기로 구간 안 템포가 다른 트랙의 템포로 바뀌었을 수 있다). 지킬 수 없으면 전처럼 원문 없이 둔다.
 * extra: 원문이 적지 않았어도 끝 쉼표 사이에 적을 지도 템포 자리 (템포 변환이 새로 넣은 구간 처음·끝 템포. 고친 곡 자리)
 */
export function keepMovedEnd(before: Song, after: Song, move: (r: Rat) => Rat, extra: readonly Rat[] = []): Song {
  const lengths = songProfile(after).length;
  // 원문은 바꾸기 전 곡의 게임 셈으로 읽는다 (게임 바꾸기에서는 두 셈이 다르다)
  const was = songProfile(before).length;
  let out = after;
  for (const old of before.tracks) {
    const now = out.tracks.find((t) => t.id === old.id);
    if (!old.mml || !now || now.mml) continue;
    const oldEnd = textEnd(old.mml, undefined, was);
    if (cmp(oldEnd, notesEnd(old.notes)) <= 0) continue;
    const end = move(oldEnd);
    if (cmp(end, notesEnd(now.notes)) <= 0) continue;
    const own = [
      ...textTempo(old.id, old.mml, was).map((e) => {
        const at = move(e.at);
        return { at, bpm: tempoAtPosition(out.tempo, at) ?? e.bpm };
      }),
      ...extra.map((at) => ({ at, bpm: tempoAtPosition(out.tempo, at) ?? DEFAULT_BPM })),
    ];
    const mml = paddedText(out, now, own, end, lengths);
    if (mml) out = { ...out, tracks: out.tracks.map((t) => (t.id === now.id ? { ...now, mml } : t)) };
  }
  return out;
}

/**
 * 다시 쓴 글 끝(마지막 음 뒤)부터 end 앞까지, 원문이 적었던 템포를 그 자리에 다시 적는다 (모자란 만큼 쉼표를 띄운다).
 * 다시 쓴 글이 그 자리에 같은 빠르기를 이미 적었으면 두 번 적지 않는다. 한 자리에 여럿 적힌 템포는 마지막 것만 다시 적는다
 */
function withTailTempo(text: string, own: readonly TempoEvent[], end: Rat, lengths: LengthLimit): string {
  const parsed = parseMml(text, { lengths });
  let at = parsed.end;
  let out = text;
  // 같은 자리에 둘 이상 적혔으면 마지막 것이 그 자리 빠르기다 (적힌 순서를 지키는 정렬 뒤 자리마다 마지막만)
  const sorted = [...own].sort((a, b) => cmp(a.at, b.at));
  const last = sorted.filter((e, i) => !(sorted[i + 1] && eq(sorted[i + 1]!.at, e.at)));
  // 다시 쓴 글 끝 자리에 이미 적힌 빠르기 (그 자리 마지막 t)
  const written = parsed.tempo.filter((t) => eq(t.at, parsed.end)).pop()?.bpm;
  for (const e of last) {
    if (cmp(e.at, at) < 0 || cmp(e.at, end) >= 0) continue;
    if (eq(e.at, parsed.end) && written === e.bpm) continue;
    const gap = sub(e.at, at);
    out += (gap.n > 0 ? restText(gap, lengths) : "") + `t${e.bpm}`;
    at = e.at;
  }
  return out;
}

/** 여러 트랙의 음을 한 번에 바꾸는 명령 (MIDI 건반 화음 입력 등). 실행 취소 한 칸 */
export function setTracksNotes(changes: readonly { trackId: string; notes: readonly Note[] }[], label = "음 넣기", keep: "same-end" | "tail" = "same-end"): Command {
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
      return keepTextEnd(song, next, [...byId.keys()], keep);
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
  const lengths = songProfile(song).length;
  for (const t of song.tracks) {
    const hits = (t.mml ? surgicalSource(t.mml, lengths)?.tokens : undefined)?.filter((h) => inside(h.at)) ?? [];
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
 * 점점 느리게·빠르게 (rit.·accel.): 게임 MML에는 서서히 바뀌는 템포가 없어 step마다 t를 계단처럼 적는다.
 * curve: linear = 고르게, in = 처음엔 조금씩 바꾸다 끝에서 크게, out = 처음에 크게 바꾸고 끝에서 조금씩
 */
export type TempoCurve = "linear" | "in" | "out";

export interface TempoRamp {
  readonly startBpm: number;
  readonly endBpm: number;
  /** 계단 하나 길이 (온음표 단위. 1/4 = 4분음표마다) */
  readonly step: Rat;
  readonly curve: TempoCurve;
  /** 구간 끝에 원래 템포를 다시 적는다 */
  readonly restore: boolean;
}

/**
 * 구간 [from, to)에 적을 계단 템포. 구간 처음부터 step마다 하나씩, 첫 계단은 startBpm, 마지막 계단은 endBpm이고
 * 사이는 curve로 나눈다. 정수로 반올림해 range 안으로 맞추고, 바로 앞 계단과 같은 값은 뺀다 (글자 수를 아끼려고)
 */
export function rampSteps(from: Rat, to: Rat, ramp: TempoRamp, range: { readonly min: number; readonly max: number }): TempoEvent[] {
  if (cmp(to, from) <= 0 || cmp(ramp.step, ZERO) <= 0) return [];
  const at: Rat[] = [];
  for (let p = from; cmp(p, to) < 0; p = add(p, ramp.step)) at.push(p);
  const shape = (f: number) => (ramp.curve === "in" ? f * f : ramp.curve === "out" ? 1 - (1 - f) * (1 - f) : f);
  const out: TempoEvent[] = [];
  at.forEach((p, k) => {
    const f = at.length === 1 ? 1 : k / (at.length - 1);
    const bpm = Math.min(range.max, Math.max(range.min, Math.round(ramp.startBpm + (ramp.endBpm - ramp.startBpm) * shape(f))));
    if (out.at(-1)?.bpm !== bpm) out.push({ at: p, bpm });
  });
  return out;
}

/** 점점 느리게·빠르게 결과: 바뀐 곡, 적은 계단, 구간 안에서 지운 지도 템포 수, 계단 템포를 넣지 못해 원문을 그대로 둔 악보 */
export interface TempoRampResult extends TempoChangeResult {
  readonly steps: readonly TempoEvent[];
  readonly replaced: number;
}

/**
 * 구간 [from, to)를 계단 템포로 바꾼다. 구간 안에 있던 템포(지도와 원문의 t)는 지우고, rampSteps를 그 뒤에 음이 있는 자리만 적는다.
 * restore면 구간 끝에 원래 그 자리 템포를 다시 적는다 (끝 자리에 이미 템포가 있거나 뒤에 음이 없으면 적지 않는다).
 * 원문에는 changeTemposResult처럼 insertEdge로 끼운다: 음·쉼표 경계 → 걸친 쉼표 나누기 → 걸친 음을 &로 나누기.
 * 게임 길이가 바뀌는 자리(끝난 악보, 마지막 쉼표)에는 적지 않으므로 끝난 악보가 길어지지 않는다
 */
export function rampTemposResult(song: Song, ramp: TempoRamp, from: Rat, to: Rat, range?: { readonly min: number; readonly max: number }): TempoRampResult {
  const unchanged = { song, failed: [], steps: [], replaced: 0 };
  if (cmp(to, from) <= 0) return unchanged;
  const limit = range ?? songProfile(song).tempo;
  const lengths = songProfile(song).length;
  const inside = (at: Rat) => cmp(at, from) >= 0 && cmp(at, to) < 0;
  const before = normalizeTempo(song.tempo);
  const bpmAt = (at: Rat) => before.filter((e) => cmp(e.at, at) <= 0).at(-1)?.bpm ?? DEFAULT_BPM;
  const end = song.tracks.reduce<Rat>((m, t) => t.notes.reduce((mm, n) => (cmp(add(n.start, n.dur), mm) > 0 ? add(n.start, n.dur) : mm), m), ZERO);
  const steps = rampSteps(from, to, ramp, limit).filter((e) => cmp(end, e.at) > 0);
  if (steps.length === 0) return unchanged;
  const edges: TempoEvent[] = [...steps];
  const back = bpmAt(to);
  if (ramp.restore && cmp(end, to) > 0 && !before.some((e) => eq(e.at, to)) && back !== steps.at(-1)!.bpm) edges.push({ at: to, bpm: back });
  // 구간 안 지도 템포는 그것을 나타내던 원문의 t(음 경계로 옮겨 적은 t 포함)와 함께 지우고,
  // 남은 구간 안 원문의 t(같은 자리에 겹쳐 쓴 t 등)도 지운다. 계단과 자리·값이 같은 것은 그대로 둔다
  const same = (e: TempoEvent) => edges.some((x) => eq(x.at, e.at) && x.bpm === e.bpm);
  const removed = before.filter((e) => inside(e.at) && !same(e));
  const cleared = removed.reduce<Song>((out, e) => withoutTempo(out, e.at), song);
  const { tokens } = tempoChangeTargets(cleared, from, to);
  const tracks = cleared.tracks.map((t) => {
    const hits = tokens.get(t.id)?.filter((h) => !same(h));
    if (!t.mml || !hits || hits.length === 0) return t;
    const text = t.mml.text;
    const spans = hits.map((h): [number, number] => {
      const [a, b] = h.span;
      const spaceBefore = a === 0 || /\s/.test(text[a - 1]!);
      return spaceBefore && /\s/.test(text[b] ?? "") ? [a, b + 1] : [a, b];
    });
    return { ...t, mml: { ...t.mml, text: spliceText(text, spans.map((span) => ({ span, text: "" }))) } };
  });
  const tempo = normalizeTempo([...before.filter((e) => !inside(e.at)), ...edges]);
  // 지운 t가 마지막 쉼표 뒤에 있으면 그 쉼표가 마지막 명령이 돼 게임이 버리고 악보가 짧아진다.
  // 그런 원문은 지우는 대신 그 자리의 새 템포 값으로 바꿔 적어 게임 길이를 그대로 둔다
  const keptTracks = tracks.map((t, k) => {
    const old = song.tracks[k]!;
    if (!t.mml || !old.mml || t.mml.text === old.mml.text || eq(textEnd(t.mml, undefined, lengths), textEnd(old.mml, undefined, lengths))) return t;
    return { ...t, mml: { ...old.mml, text: retempoRemoved(old.mml, t.mml, tempo, lengths) } };
  });
  const failures = new Map<number, Set<TempoEdgeFailure>>();
  const next = edges.reduce<Song>(
    (out, e) =>
      songScores(out).reduce<Song>((acc, ids, score) => {
        const done = insertEdge(acc, ids, e);
        if (done.failed) failures.set(score, new Set([...(failures.get(score) ?? []), ...done.failed]));
        return done.song;
      }, out),
    { ...cleared, tempo, tracks: keptTracks },
  );
  if (sameTempo(next.tempo, before) && next.tracks.every((t, k) => t.mml?.text === song.tracks[k]?.mml?.text)) return unchanged;
  return {
    song: next,
    failed: [...failures].sort(([a], [b]) => a - b).map(([score, reasons]) => ({ score, reasons: [...reasons] })),
    steps,
    replaced: removed.length,
  };
}

/**
 * 계단 템포가 지운 원문 t를 지우지 않고 바꿔 적은 글. old에 있던 t 중 now에 남지 않은 것(같은 순서로 맞춰 본다)을
 * 그 자리에서 tempo 지도가 울리는 값으로 바꾼다. t 자리·글 길이 구조는 그대로라 게임 길이가 바뀌지 않는다
 */
function retempoRemoved(old: TrackText, now: TrackText, tempo: readonly TempoEvent[], lengths: LengthLimit): string {
  const was = tempoTokens(old, undefined, lengths);
  const left = tempoTokens(now, undefined, lengths);
  const removed: TempoToken[] = [];
  let j = 0;
  for (const k of was) {
    const n = left[j];
    if (n && eq(n.at, k.at) && n.bpm === k.bpm) j++;
    else removed.push(k);
  }
  const bpmAt = (at: Rat) => tempo.filter((e) => cmp(e.at, at) <= 0).at(-1)?.bpm ?? DEFAULT_BPM;
  return spliceText(old.text, removed.map((k) => ({ span: k.span, text: `t${bpmAt(k.at)}` })));
}

/** rampTemposResult를 실행 취소 한 칸 명령으로 (넣지 못한 악보는 rampTemposResult로 미리 알아본다) */
export function rampTempos(ramp: TempoRamp, from: Rat, to: Rat, label = "점점 느리게·빠르게", range?: { readonly min: number; readonly max: number }): Command {
  return songCommand(label, (song) => rampTemposResult(song, ramp, from, to, range).song);
}

/**
 * 실제 시간 유지 템포 변환에서 거절한 까닭. at은 모두 바꾸기 전 곡의 자리다 (거절하면 곡은 그대로라서)
 * - length: 늘이거나 줄인 음(rest면 쉼표) 길이를 게임 음길이로 정확히 쓸 수 없다 (예: l64를 반으로)
 * - end: 원문 끝 쉼표로 지키던 트랙 길이를 다시 쓸 수 없다
 * - tempo: 바꾼 템포 자리가 그 악보 모든 채널에서 쪼갤 수 없는 음 가운데라 게임 출력이 뒤로 옮겨 쓴다
 * - meter: 박자표 마디 길이를 바꿔 쓸 분모·분자가 없다
 */
export type TempoConvertFailure =
  | { readonly kind: "length"; readonly trackId: string; readonly at: Rat; readonly length: Rat; readonly rest: boolean }
  | { readonly kind: "end"; readonly trackId: string; readonly at: Rat }
  | { readonly kind: "tempo"; readonly at: Rat; readonly bpm: number }
  | { readonly kind: "meter"; readonly at: Rat; readonly beats: number; readonly unit: number };

/** convertTempoResult 선택 */
export interface ConvertTempoOptions {
  /** 구간 안 템포(바꾸기 전 자리, 원래 값)마다 쓸 정수 템포. undefined면 반올림 (범위 밖 템포 풀기가 쌓이는 오차를 줄이려고 올림·내림을 고른다) */
  readonly bpm?: (at: Rat, bpm: number) => number | undefined;
}

/** 실제 시간 유지 템포 변환 결과. failed가 있으면 song은 바꾸기 전 곡 그대로다 */
export interface TempoConvertResult {
  readonly song: Song;
  readonly failed: readonly TempoConvertFailure[];
  /** 템포 × 배율이 정수가 아니라 반올림한 템포 (바꾸기 전 자리, 원래 값, 쓴 값). 이 구간은 빠르기가 아주 조금 달라진다 */
  readonly rounded: readonly { readonly at: Rat; readonly bpm: number; readonly to: number }[];
}

/**
 * 박자표 한 마디 길이를 scale배로. 분모를 먼저 바꾸고(4/4 ×1/2 → 4/8), 안 되면 분자를 바꾸고(4/1 ×2 → 8/1),
 * 그래도 안 되면 그 길이를 정수 분자로 쓸 수 있는 가장 작은 분모를 고른다. 쓸 수 없으면 undefined
 */
function scaledMeter(sig: { readonly beats: number; readonly unit: number }, scale: Rat): { beats: number; unit: number } | undefined {
  const units: readonly number[] = METER_UNITS;
  const byUnit = div(rat(sig.unit), scale);
  if (byUnit.d === 1 && units.includes(byUnit.n)) return { beats: sig.beats, unit: byUnit.n };
  const byBeats = mul(rat(sig.beats), scale);
  if (byBeats.d === 1) return { beats: byBeats.n, unit: sig.unit };
  const measure = mul(rat(sig.beats, sig.unit), scale);
  for (const unit of units) {
    const beats = mul(measure, rat(unit));
    if (beats.d === 1) return { beats: beats.n, unit };
  }
  return undefined;
}

/**
 * 실제 시간 유지 템포 변환 (마비꼬 '틱 변환'과 같은 생각). 구간 [from, to)의 음 길이·자리를 scale배로 늘이거나 줄이고
 * 그 구간 템포도 scale배로 바꾼다 (to가 없으면 곡 끝까지). 음 하나의 초 = 길이 × 240 / 템포라서 빠르기는 그대로다.
 * 범위 밖 템포를 고칠 때 쓴다: t300이면 scale 1/2로 t150에 길이 반(4분음표 → 8분음표), t20이면 scale 2로 t40에 길이 두 배.
 * 구간 뒤는 늘어나거나 준 만큼 함께 민다. 박자표·마커도 같은 자리로 옮기고, 구간 안 박자표는 마디 길이를 함께 바꿔
 * (4/4 → 4/8) 마디선이 음과 맞게 한다. 구간 처음에 템포·박자표가 없으면 넣고, 구간 끝에는 원래 값을 다시 적는다
 * (구간 처음·끝이 마디 가운데면 걸친 마디를 옮긴 길이의 박자표로 쓰고 다음 마디선에서 박자를 잇는다).
 * 만든 기록(Song.made)의 음도 같은 자리로 옮긴다. 구간에 닿는 트랙은 원문을 지우고 출력기로 다시 쓴다
 * (끝 쉼표로 지키던 길이는 옮긴 자리까지 지킨다: keepMovedEnd). 구간 앞에서 끝난 트랙의 원문은 그대로 둔다.
 * 게임 음길이(profile.length)로 정확히 쓸 수 없는 길이가 새로 생기거나, 바꾼 템포를 게임 출력이 그 자리에 쓰지 못하면
 * 곡을 바꾸지 않고 failed로 알린다 (바꾸기 전부터 쓸 수 없던 길이는 탓하지 않는다)
 */
export function convertTempoResult(song: Song, scale: Rat, from: Rat = ZERO, to?: Rat, options: ConvertTempoOptions = {}): TempoConvertResult {
  const unchanged: TempoConvertResult = { song, failed: [], rounded: [] };
  if (scale.n <= 0 || eq(scale, rat(1))) return unchanged;
  const songEnd = scoreEnd(song.tracks, undefined, songProfile(song).length);
  // 구간이 곡 끝을 넘으면 곡 끝까지로 본다 (끝에 다시 적을 템포·박자표가 필요 없다)
  const until = to !== undefined && cmp(to, songEnd) < 0 ? to : undefined;
  if (cmp(songEnd, from) <= 0 || (until !== undefined && cmp(until, from) <= 0)) return unchanged;
  const lengths = songProfile(song).length;
  // 구간이 늘어나거나 준 만큼 (구간 뒤를 그만큼 민다)
  const grow = until === undefined ? ZERO : mul(sub(until, from), sub(scale, rat(1)));
  const move = convertMove(scale, from, until);
  const newUntil = until === undefined ? undefined : move(until);
  const back = (r: Rat): Rat => (cmp(r, from) <= 0 ? r : newUntil === undefined || cmp(r, newUntil) <= 0 ? add(from, div(sub(r, from), scale)) : sub(r, grow));
  const inside = (at: Rat) => cmp(at, from) >= 0 && (until === undefined || cmp(at, until) < 0);
  const failed: TempoConvertFailure[] = [];

  // 템포: 구간 안은 scale배 (정수로 반올림), 구간 처음·끝에 없으면 넣는다
  const before = normalizeTempo(song.tempo);
  const bpmAt = (at: Rat) => tempoAtPosition(before, at) ?? DEFAULT_BPM;
  // 바꾼 템포 (정수, 1~999)
  // 바꾼 템포: 부르는 쪽이 자리마다 정수를 골라 주면(options.bpm) 그 값, 아니면 반올림
  const scaledBpm = (bpm: number, at?: Rat) => Math.min(999, Math.max(1, (at && options.bpm?.(at, bpm)) ?? Math.round((bpm * scale.n) / scale.d)));
  const rounded: { at: Rat; bpm: number; to: number }[] = [];
  const scaled = (at: Rat, bpm: number) => {
    const to = scaledBpm(bpm, at);
    if (to * scale.d !== bpm * scale.n) rounded.push({ at, bpm, to });
    return to;
  };
  const tempo: TempoEvent[] = before.map((e) => ({ ...e, at: move(e.at), bpm: inside(e.at) ? scaled(e.at, e.bpm) : e.bpm }));
  if (!before.some((e) => eq(e.at, from))) tempo.push({ at: from, bpm: scaled(from, bpmAt(from)) });
  if (until !== undefined && !before.some((e) => eq(e.at, until))) tempo.push({ at: newUntil!, bpm: bpmAt(until) });

  // 박자표: 구간 안은 마디 길이를 scale배로 (마디선이 음과 맞게). 구간 처음·끝이 마디선이면 그 자리에 바꾼 박자표·원래 박자표를 넣는다.
  // 마디 가운데면 그 마디는 옮긴 길이 그대로의 박자표로 쓰고(4/4의 뒤 반만 반으로 → 3/4) 다음 마디선부터 박자를 이어 간다.
  // 마디 가운데에 박자표를 넣으면 거기서 새 마디가 시작해, 구간 안과 뒤의 마디선이 옮긴 음과 모두 어긋나기 때문이다.
  // 그 마디 길이를 박자표로 쓸 수 없으면 그 자리에서 덜 찬 마디로 끊고 다음 마디선부터 맞춘다 (거절하지 않는다)
  const sigs = [...song.timeSig].sort((a, b) => cmp(a.at, b.at));
  const failMeter = (at: Rat, sig: { readonly beats: number; readonly unit: number }) => {
    if (!failed.some((f) => f.kind === "meter" && eq(f.at, at))) failed.push({ kind: "meter", at, beats: sig.beats, unit: sig.unit });
  };
  const meter = (sig: TimeSigEvent, at: Rat): TimeSigEvent | undefined => {
    const m = scaledMeter(sig, scale);
    if (!m) failMeter(at, sig);
    return m && { ...sig, at: move(at), ...m };
  };
  // 고친 곡 자리마다 박자표 하나 (나중에 넣은 것이 이긴다). 원래 박자표를 옮긴 것은 표시해 두어, 쓸모없는 박자표를 뺄 때 남긴다
  const placed = new Map<string, TimeSigEvent>();
  const original = new Set<TimeSigEvent>();
  const put = (e: TimeSigEvent | undefined, kept = false) => {
    if (!e) return;
    placed.set(`${e.at.n}/${e.at.d}`, e);
    if (kept) original.add(e);
  };
  for (const s of sigs) put(inside(s.at) ? meter(s, s.at) : { ...s, at: move(s.at) }, true);
  // 바꾸기 전 자리 at부터 이어 갈 박자표 (구간 안이면 마디 길이를 바꾼 것). 그 자리에 원래 박자표가 있으면 그것이 이어 간다
  const resume = (at: Rat) => {
    if (sigs.some((s) => eq(s.at, at))) return;
    const sig = { ...meterAt(sigs, at), at };
    put(inside(at) ? meter(sig, at) : { ...sig, at: move(at) });
  };
  const edge = (at: Rat) => {
    const start = measureStart(sigs, at);
    if (eq(start, at)) return resume(at);
    // at이 걸친 마디 [start, end): 다음 박자표가 마디 끝 앞에 있으면 거기까지 (덜 찬 마디)
    const sig = meterAt(sigs, at);
    const full = add(start, meterGrid(sig).measure);
    const nextSig = sigs.find((s) => cmp(s.at, at) > 0);
    const end = nextSig && cmp(nextSig.at, full) < 0 ? nextSig.at : full;
    const length = sub(move(end), move(start));
    const units: readonly number[] = [sig.unit, scaledMeter(sig, scale)?.unit ?? sig.unit, ...METER_UNITS];
    const unit = units.find((u) => mul(length, rat(u)).d === 1);
    // 그 길이를 박자표로 쓸 수 없으면(1/96 자리 등) 전처럼 at에서 새 마디를 시작하고 다음 마디선에서 다시 맞춘다
    if (unit === undefined) resume(at);
    else put({ ...sig, at: move(start), beats: mul(length, rat(unit)).n, unit });
    resume(end);
  };
  edge(from);
  if (until !== undefined) edge(until);
  // 넣은 박자표가 바로 앞 박자표와 같고 그 마디선 위에 있으면 뺀다 (마디선이 그대로라 쓸모없다)
  const timeSig: TimeSigEvent[] = [];
  for (const e of [...placed.values()].sort((a, b) => cmp(a.at, b.at))) {
    const last = timeSig[timeSig.length - 1];
    const same = last && last.beats === e.beats && last.unit === e.unit && div(sub(e.at, last.at), meterGrid(last).measure).d === 1;
    if (!same || original.has(e)) timeSig.push(e);
  }

  const moveNote = (n: Note): Note => {
    const start = move(n.start);
    return { ...n, start, dur: sub(move(add(n.start, n.dur)), start) };
  };
  // 구간 앞에서 끝난 트랙(음·원문 길이·원문의 t가 모두 구간 앞)은 그대로 둔다
  const untouched = (t: Track) =>
    cmp(notesEnd(t.notes), from) <= 0 && (!t.mml || (cmp(textEnd(t.mml, undefined, lengths), from) <= 0 && tempoTokens(t.mml, undefined, lengths).every((k) => cmp(k.at, from) < 0)));
  const tracks = song.tracks.map((t) => {
    if (untouched(t)) return t;
    const { mml: _mml, ...rest } = t;
    return { ...rest, notes: t.notes.map(moveNote) };
  });

  // 새로 생긴 쓸 수 없는 길이: 구간에 닿는 음·쉼표(음 사이, 원문 끝 쉼표)마다 바꾼 뒤 길이와 바꾸기 전 길이를 견준다
  const check = (trackId: string, start: Rat, end: Rat, isRest: boolean) => {
    if (cmp(end, from) < 0 || (newUntil !== undefined && cmp(start, newUntil) > 0)) return;
    const length = sub(end, start);
    if (!canWriteExactly(length, lengths) && canWriteExactly(sub(back(end), back(start)), lengths)) {
      failed.push({ kind: "length", trackId, at: back(start), length, rest: isRest });
    }
  };
  tracks.forEach((t, k) => {
    if (t === song.tracks[k]) return;
    let pos: Rat = ZERO;
    for (const n of [...t.notes].sort((a, b) => cmp(a.start, b.start))) {
      if (cmp(n.start, pos) > 0) check(t.id, pos, n.start, true);
      check(t.id, n.start, add(n.start, n.dur), false);
      if (cmp(add(n.start, n.dur), pos) > 0) pos = add(n.start, n.dur);
    }
    const old = song.tracks[k]!;
    if (old.mml && cmp(textEnd(old.mml, undefined, lengths), notesEnd(old.notes)) > 0 && cmp(move(textEnd(old.mml, undefined, lengths)), pos) > 0) check(t.id, pos, move(textEnd(old.mml, undefined, lengths)), true);
  });
  if (failed.length > 0) return { song, failed, rounded };

  const moveRecord = (r: MadeRecord): MadeRecord => {
    const notes = (list: MadeRecord["before"]) => list.map((m) => ({ ...m, notes: m.notes.map(moveNote) }));
    return { ...r, before: notes(r.before), after: notes(r.after) };
  };
  const moved: Song = {
    ...song,
    tempo: normalizeTempo(tempo),
    timeSig,
    markers: song.markers.map((m) => ({ ...m, at: move(m.at), ...(m.end ? { end: move(m.end) } : {}) })),
    ...(song.keys ? { keys: song.keys.map((k) => ({ ...k, at: move(k.at) })) } : {}),
    tracks,
    ...(song.made ? { made: song.made.map(moveRecord) } : {}),
  };
  // 새로 넣은 구간 처음·끝 템포는 원문 끝 쉼표 사이에도 적는다 (끝 쉼표 안에 쪼갤 자리가 없으면 템포를 채우다 원문을 잃는다)
  const added = [...(before.some((e) => eq(e.at, from)) ? [] : [from]), ...(until === undefined || before.some((e) => eq(e.at, until)) ? [] : [newUntil!])];
  const kept = keepMovedEnd(song, moved, move, added);
  const next = withFreshTempo(song, kept, (e) => ({ at: move(e.at), bpm: inside(e.at) ? scaledBpm(e.bpm, e.at) : e.bpm }));

  // 원문 끝 쉼표로 지키던 길이를 다시 쓰지 못한 트랙
  for (const old of song.tracks) {
    if (!old.mml || cmp(textEnd(old.mml, undefined, lengths), notesEnd(old.notes)) <= 0) continue;
    const now = next.tracks.find((t) => t.id === old.id);
    if (now && now !== old && !(now.mml && eq(textEnd(now.mml, undefined, lengths), move(textEnd(old.mml, undefined, lengths))))) failed.push({ kind: "end", trackId: old.id, at: textEnd(old.mml, undefined, lengths) });
  }
  failed.push(...outputTempoFailures(song, next, move, back, from, newUntil, failed.length > 0));
  if (failed.length > 0) return { song, failed, rounded };
  return { song: next, failed: [], rounded };
}

/**
 * 음 자리를 옮긴 편집(실제 시간 유지 템포 변환, 템포를 음 길이로 바꾸기)에서 게임 출력이 새로 템포를 제자리에 못 쓰는 곳.
 * move: 고치기 전 자리 → 고친 자리, back: 알릴 자리를 고치기 전 자리로. [from, until] 밖과 고치기 전에도 그렇던 곳은 빼고 본다.
 * skipOff가 참이면(이미 다른 까닭으로 거절) 게임 글을 다시 읽는 마지막 검사는 건너뛴다
 */
function outputTempoFailures(song: Song, next: Song, move: (r: Rat) => Rat, back: (r: Rat) => Rat, from: Rat, newUntil: Rat | undefined, skipOff: boolean): TempoConvertFailure[] {
  const failed: TempoConvertFailure[] = [];
  // 게임 출력이 바꾼 템포를 그 자리에 쓰지 못하고 뒤로 옮긴 곳 (바꾸기 전에도 옮기던 곳은 빼고)
  const movedTempo = (s: Song) => gameScores(s, songChordsPerScore(s)).flatMap((score) => score.moved);
  const was = new Set(movedTempo(song).map((m) => `${move(m.from).n}/${move(m.from).d}`));
  for (const m of movedTempo(next)) {
    if (cmp(m.from, from) < 0 || (newUntil !== undefined && cmp(m.from, newUntil) > 0) || was.has(`${m.from.n}/${m.from.d}`)) continue;
    if (!failed.some((f) => f.kind === "tempo" && eq(f.at, back(m.from)))) failed.push({ kind: "tempo", at: back(m.from), bpm: m.bpm });
  }
  // 게임 출력이 옮길 자리까지 다음 템포가 와서 아예 버린 템포 (그 구간 빠르기가 사라진다. 바꾸기 전에도 버리던 곳은 빼고)
  const droppedTempo = (s: Song) => {
    const out: TempoEvent[] = [];
    placeTempoByScore({ ...s, tempo: withoutDefaultStart(audibleTempo(s.tempo)) }, songChordsPerScore(s), undefined, undefined, out);
    return out;
  };
  const wasDropped = new Set(droppedTempo(song).map((e) => `${move(e.at).n}/${move(e.at).d}`));
  for (const e of droppedTempo(next)) {
    if (cmp(e.at, from) < 0 || (newUntil !== undefined && cmp(e.at, newUntil) > 0) || wasDropped.has(`${e.at.n}/${e.at.d}`)) continue;
    if (!failed.some((f) => f.kind === "tempo" && eq(f.at, back(e.at)))) failed.push({ kind: "tempo", at: back(e.at), bpm: e.bpm });
  }
  // 마지막으로 게임에 넣을 글을 다시 읽어 음마다 실제 시각이 곡과 같은지 본다. 템포 둘이 한 음 안에 붙어
  // 그 사이 틈을 쓸 수 없으면 출력기는 두 t를 이어 써 틈을 잃는다 (바꾸기 전에도 어긋나던 음은 빼고)
  if (!skipOff && failed.length === 0) {
    // 트랙·높이·자리로 견준다 (한 트랙에 이미 있던 어긋남이 다른 트랙의 새 어긋남을 가리지 않게)
    const offKey = (n: { readonly trackId: string; readonly pitch: number }, at: Rat) => `${n.trackId}|${n.pitch}|${at.n}/${at.d}`;
    const wasOff = new Set(offOutput(song).map((n) => offKey(n, move(n.start))));
    for (const n of offOutput(next)) {
      if (wasOff.has(offKey(n, n.start))) continue;
      // 알릴 자리는 그 음 안의 템포 (없으면 음 시작과 그때 빠르기)
      const end = add(n.start, n.dur);
      const tempo = normalizeTempo(next.tempo);
      const inner = tempo.find((e) => cmp(e.at, n.start) > 0 && cmp(e.at, end) < 0);
      const e = inner ?? { at: n.start, bpm: tempo.filter((t) => cmp(t.at, n.start) <= 0).at(-1)?.bpm ?? DEFAULT_BPM };
      if (!failed.some((f) => f.kind === "tempo" && eq(f.at, back(e.at)))) failed.push({ kind: "tempo", at: back(e.at), bpm: e.bpm });
      break;
    }
  }
  return failed;
}

/** 곡 위치를 실제 초로 (분수 그대로) */
function exactSeconds(tempo: readonly TempoEvent[], at: Rat): Rat {
  let sec: Rat = ZERO;
  let pos: Rat = ZERO;
  let bpm = DEFAULT_BPM;
  for (const e of tempo) {
    if (cmp(e.at, at) >= 0) break;
    sec = add(sec, mul(sub(e.at, pos), rat(240, bpm)));
    pos = e.at;
    bpm = e.bpm;
  }
  return add(sec, mul(sub(at, pos), rat(240, bpm)));
}

/**
 * 게임에 넣을 글(gameScores)을 다시 읽어 센 실제 시각이 곡 모델과 다른 음 (곡 위치).
 * 악보마다 그 악보 채널에 적힌 템포로 세고, &로 이은 음은 하나로 본다
 */
function offOutput(song: Song): { readonly trackId: string; readonly pitch: number; readonly start: Rat; readonly dur: Rat }[] {
  // 서로 다른 템포 값이 많으면 분수로 세다 넘칠 것이 뻔하므로 처음부터 마이크로초로 센다 (헛계산을 줄인다)
  if (new Set(song.tempo.map((e) => e.bpm)).size > 24) return offOutputBy(song, "micro");
  try {
    return offOutputBy(song, "exact");
  } catch (e) {
    // 서로 다른 템포가 아주 많으면(원곡에 음마다 템포로 맞춘 곡) 초 분수의 분모가 안전한 정수를 넘는다.
    // 그때는 초를 마이크로초로 반올림해 견준다 (출력기가 템포를 옮겨 생기는 어긋남은 밀리초 단위라 충분하다)
    if (!(e instanceof RangeError)) throw e;
    return offOutputBy(song, "micro");
  }
}

function offOutputBy(song: Song, mode: "exact" | "micro"): { readonly trackId: string; readonly pitch: number; readonly start: Rat; readonly dur: Rat }[] {
  const out: { trackId: string; pitch: number; start: Rat; dur: Rat }[] = [];
  const modelTempo = normalizeTempo(song.tempo);
  const clocks = new WeakMap<readonly TempoEvent[], (pos: Rat) => number>();
  const seconds = (tempo: readonly TempoEvent[], at: Rat): string => {
    if (mode === "exact") {
      const r = exactSeconds(tempo, at);
      return `${r.n}/${r.d}`;
    }
    let clock = clocks.get(tempo);
    if (!clock) clocks.set(tempo, (clock = tempoClock(tempo)));
    return String(Math.round(clock(at) * 1e6));
  };
  const key = (tempo: readonly TempoEvent[], n: { readonly start: Rat; readonly dur: Rat; readonly pitch: number }) =>
    `${seconds(tempo, n.start)}|${seconds(tempo, add(n.start, n.dur))}|${n.pitch}`;
  // 게임 글은 높이와 상관없는 타악기를 한 높이로 쓰므로 곡 모델도 같게 바꿔 견준다
  const model = pitchlessForOutput(song, songProfile(song));
  for (const score of gameScores(song, songChordsPerScore(song))) {
    const parsed = score.texts.map(({ trackId, text }) => ({ trackId, result: parseMml(text, { lengths: songProfile(song).length }) }));
    const tempo = normalizeTempo(parsed.flatMap((p) => p.result.tempo));
    for (const { trackId, result } of parsed) {
      const track = model.tracks.find((t) => t.id === trackId);
      if (!track) continue;
      const heard = new Map<string, number>();
      for (const n of mergeTies(result.notes)) heard.set(key(tempo, n), (heard.get(key(tempo, n)) ?? 0) + 1);
      for (const n of mergeTies(track.notes)) {
        const k = key(modelTempo, n);
        const left = heard.get(k) ?? 0;
        if (left > 0) heard.set(k, left - 1);
        else out.push({ trackId, pitch: n.pitch, start: n.start, dur: n.dur });
      }
    }
  }
  return out;
}

/** convertTempoResult가 자리를 옮기는 규칙: from 앞은 그대로, [from, until]은 scale배, 그 뒤는 늘거나 준 만큼 민다 (until이 없으면 곡 끝까지) */
function convertMove(scale: Rat, from: Rat, until: Rat | undefined): (r: Rat) => Rat {
  const grow = until === undefined ? ZERO : mul(sub(until, from), sub(scale, rat(1)));
  return (r) => (cmp(r, from) <= 0 ? r : until === undefined || cmp(r, until) <= 0 ? add(from, mul(sub(r, from), scale)) : add(r, grow));
}

/** convertTempoResult(song, scale, from, to)가 바꾸기 전 자리를 어디로 옮기는지 (구간이 곡 끝을 넘으면 곡 끝까지로 본다) */
export function tempoConvertMove(song: Song, scale: Rat, from: Rat = ZERO, to?: Rat): (r: Rat) => Rat {
  const songEnd = scoreEnd(song.tracks, undefined, songProfile(song).length);
  return convertMove(scale, from, to !== undefined && cmp(to, songEnd) < 0 ? to : undefined);
}

/** convertTempoResult를 실행 취소 한 칸 명령으로 (거절할 까닭·반올림한 템포는 convertTempoResult로 미리 알아본다) */
export function convertTempo(scale: Rat, from: Rat = ZERO, to?: Rat, label = "실제 시간 유지 템포 변환"): Command {
  return songCommand(label, (song) => convertTempoResult(song, scale, from, to).song);
}

/**
 * 템포 한꺼번에 바꾸기를 실제 시간을 지키며 한다. 구간 [from, to)를 템포 지도로 나눠(구간 처음 자리, 구간 안 템포마다)
 * 조각마다 템포를 changedBpm으로 바꾸고, 그 조각의 음 길이·자리·박자표를 (바꾼 템포 / 원래 템포)배로 함께 맞춘다
 * (convertTempoResult를 조각마다). 들리는 빠르기는 그대로이고, 구간 뒤는 늘거나 준 만큼 밀린다.
 * 뒤 조각부터 바꿔서 앞 조각의 자리는 바꾸기 전 곡 자리 그대로다 (거절 자리도 바꾸기 전 곡 기준).
 * 한 조각이라도 거절하면 곡을 바꾸지 않는다. rounded는 이 경로에서 생기지 않는다 (바꾼 템포가 처음부터 정수)
 */
export function changeTemposKeepTimeResult(song: Song, change: TempoChange, from: Rat = ZERO, to?: Rat): TempoConvertResult {
  const unchanged: TempoConvertResult = { song, failed: [], rounded: [] };
  if (to !== undefined && cmp(to, from) <= 0) return unchanged;
  const map = normalizeTempo(song.tempo);
  const startBpm = map.filter((e) => cmp(e.at, from) <= 0).at(-1)?.bpm ?? DEFAULT_BPM;
  const inside = map.filter((e) => cmp(e.at, from) > 0 && (to === undefined || cmp(e.at, to) < 0));
  const pieces: { at: Rat; bpm: number; end: Rat | undefined }[] = [];
  [{ at: from, bpm: startBpm }, ...inside].forEach((e, k, all) => pieces.push({ at: e.at, bpm: e.bpm, end: all[k + 1]?.at ?? to }));
  let cur = song;
  const failed: TempoConvertFailure[] = [];
  for (const p of [...pieces].reverse()) {
    const target = changedBpm(p.bpm, change);
    if (target === p.bpm) continue;
    const r = convertTempoResult(cur, rat(target, p.bpm), p.at, p.end);
    if (r.failed.length > 0) {
      failed.push(...r.failed);
      continue;
    }
    cur = r.song;
  }
  if (failed.length > 0) return { song, failed, rounded: [] };
  return { song: cur, failed: [], rounded: [] };
}

/** changeTemposKeepTimeResult를 실행 취소 한 칸 명령으로 */
export function changeTemposKeepTime(change: TempoChange, from: Rat = ZERO, to?: Rat, label = "템포 한꺼번에 바꾸기"): Command {
  return songCommand(label, (song) => changeTemposKeepTimeResult(song, change, from, to).song);
}

/** 범위 밖 템포를 음 길이로 풀 때 쓰는 배율 (변화가 작은 것부터): 느리면 2배·4배, 빠르면 반·4분의 1 */
const FOLD_SCALES = { low: [rat(2), rat(4)], high: [rat(1, 2), rat(1, 4)] } as const;

/** 범위 밖 템포 하나를 길이로 풀 배율 (2, 4, 1/2, 1/4 가운데 바꾼 템포가 범위에 드는 가장 작은 변화). 범위 안이거나 못 풀면 undefined */
export function tempoFoldScale(bpm: number, range: { readonly min: number; readonly max: number }): Rat | undefined {
  if (bpm >= range.min && bpm <= range.max) return undefined;
  return (bpm < range.min ? FOLD_SCALES.low : FOLD_SCALES.high).find((s) => {
    const to = Math.round((bpm * s.n) / s.d);
    return to >= range.min && to <= range.max;
  });
}

/** 길이로 푼 한 곳: 바꾸기 전 자리, 원래 템포, 음 길이·템포에 곱한 배율, 넣은 템포 */
export interface TempoFold {
  readonly at: Rat;
  readonly bpm: number;
  readonly scale: Rat;
  readonly to: number;
}

/** 범위 밖 템포를 길이로 푼 결과. failed가 있으면 song은 바꾸기 전 곡 그대로이고 move도 제자리다 */
export interface TempoFoldResult {
  readonly song: Song;
  readonly folded: readonly TempoFold[];
  /** 못 푼 까닭 (자리는 바꾸기 전 곡 기준). 배율 4로도 범위에 들지 않는 템포는 kind "tempo" */
  readonly failed: readonly TempoConvertFailure[];
  /** 템포 × 배율이 정수가 아니라 반올림한 곳 (convertTempoResult와 같다) */
  readonly rounded: TempoConvertResult["rounded"];
  /** 바꾸기 전 자리 → 바꾼 뒤 자리 */
  readonly move: (at: Rat) => Rat;
  /** 정수 템포로 적어 생긴, 마지막으로 푼 조각 끝(그 뒤 전체)의 시각 차이 (초, +면 늦게). 반올림이 없으면 0 */
  readonly shift: number;
}

/**
 * 게임 템포 범위(range) 밖 템포를 음 길이로 푼다 (1.1 설계 4번). 템포 조각 [그 템포 자리, 다음 템포 자리)마다
 * tempoFoldScale 배율로 convertTempoResult를 돌려, 들리는 시각은 그대로 두고 템포를 범위 안으로, 음 길이·마디 길이(박자표)를 그만큼 바꾼다.
 * only를 주면 그 자리의 템포만 본다 (방금 넣은 템포). 곡 끝 뒤 템포는 음이 없어 보지 않는다.
 * 같은 배율로 풀 조각이 이어져 있으면 한 구간으로 묶어 바꾼다 (박자표가 조각마다 끊기지 않게).
 * 앞 변환이 뒤 자리를 밀므로 뒤 구간부터 바꾼다. 하나라도 못 풀면 곡을 바꾸지 않는다 (부르는 쪽이 끝값으로 넣고 알린다)
 */
export function foldTempoRangeResult(song: Song, range: { readonly min: number; readonly max: number }, only?: readonly Rat[]): TempoFoldResult {
  const still = (at: Rat) => at;
  const map = normalizeTempo(song.tempo);
  const songEnd = scoreEnd(song.tracks, undefined, songProfile(song).length);
  const failed: TempoConvertFailure[] = [];
  const folded: TempoFold[] = [];
  // 묶은 구간: 시작 자리, 끝(다음 템포 자리, 없으면 곡 끝까지), 배율
  const groups: { from: Rat; to: Rat | undefined; scale: Rat; last: number }[] = [];
  map.forEach((e, i) => {
    if (e.bpm >= range.min && e.bpm <= range.max) return;
    if (cmp(e.at, songEnd) >= 0 || (only && !only.some((at) => eq(at, e.at)))) return;
    const scale = tempoFoldScale(e.bpm, range);
    if (!scale) {
      failed.push({ kind: "tempo", at: e.at, bpm: e.bpm });
      return;
    }
    folded.push({ at: e.at, bpm: e.bpm, scale, to: Math.round((e.bpm * scale.n) / scale.d) });
    const to = map[i + 1]?.at;
    const g = groups.at(-1);
    if (g && g.last === i - 1 && eq(g.scale, scale)) {
      g.to = to;
      g.last = i;
    } else groups.push({ from: e.at, to, scale, last: i });
  });
  if (failed.length > 0) return { song, folded: [], failed, rounded: [], move: still, shift: 0 };
  // 템포 × 배율이 정수가 아니면(t301의 반) 올림·내림 가운데 그때까지 쌓인 시각 오차를 줄이는 쪽을 고른다
  // (늘 반올림하면 조각이 여럿일 때 오차가 한쪽으로 쌓인다). 앞에서부터 고르고, 고른 값은 자리로 변환에 넘긴다
  const chosen = new Map<string, number>();
  const key = (at: Rat) => `${at.n}/${at.d}`;
  let shift = 0;
  for (const f of folded) {
    const i = map.findIndex((e) => eq(e.at, f.at));
    const next = map[i + 1]?.at;
    const end = next === undefined || cmp(next, songEnd) > 0 ? songEnd : next;
    const length = toFloat(sub(end, f.at));
    const exact = (f.bpm * f.scale.n) / f.scale.d;
    const before = (240 * length) / f.bpm;
    const after = (c: number) => (240 * length * toFloat(f.scale)) / c;
    const options = [...new Set([Math.floor(exact), Math.ceil(exact)])].filter((c) => c >= range.min && c <= range.max);
    const pick = options.reduce((best, c) => (Math.abs(shift + after(c) - before) < Math.abs(shift + after(best) - before) ? c : best), options[0] ?? f.to);
    shift += after(pick) - before;
    chosen.set(key(f.at), pick);
  }
  folded.forEach((f, k) => (folded[k] = { ...f, to: chosen.get(key(f.at)) ?? f.to }));
  const bpmOption = { bpm: (at: Rat) => chosen.get(key(at)) };
  let cur = song;
  const rounded: TempoConvertResult["rounded"][number][] = [];
  const moves: ((r: Rat) => Rat)[] = [];
  for (const g of [...groups].reverse()) {
    const r = convertTempoResult(cur, g.scale, g.from, g.to, bpmOption);
    if (r.failed.length > 0) {
      failed.push(...r.failed);
      continue;
    }
    moves.push(tempoConvertMove(cur, g.scale, g.from, g.to));
    rounded.push(...r.rounded);
    cur = r.song;
  }
  if (failed.length > 0) return { song, folded: [], failed: [...failed].sort((a, b) => cmp(a.at, b.at)), rounded: [], move: still, shift: 0 };
  return { song: cur, folded, failed: [], rounded: rounded.sort((a, b) => cmp(a.at, b.at)), move: (at) => moves.reduce((p, m) => m(p), at), shift };
}

/** foldTempoRangeResult를 실행 취소 한 칸 명령으로 (못 풀면 곡 그대로) */
export function foldTempoRange(range: { readonly min: number; readonly max: number }, only?: readonly Rat[], label = "범위 밖 템포를 길이로 풀기"): Command {
  return songCommand(label, (song) => foldTempoRangeResult(song, range, only).song);
}

/** 템포를 바꿀 구간 [from, to) (to가 없으면 곡 끝까지) */
export type TempoSpan = readonly [Rat, Rat | undefined];

/**
 * 여러 구간을 앞에서부터 차례로, 겹치거나 붙은 구간은 하나로 (±BPM이 두 번 더해지지 않게).
 * 끝이 없는(곡 끝까지) 구간 뒤는 모두 그 안이다
 */
function tidySpans(spans: readonly TempoSpan[]): TempoSpan[] {
  const sorted = spans.filter(([a, b]) => b === undefined || cmp(b, a) > 0).sort((x, y) => cmp(x[0], y[0]));
  const out: [Rat, Rat | undefined][] = [];
  for (const [a, b] of sorted) {
    const prev = out[out.length - 1];
    if (prev && (prev[1] === undefined || cmp(a, prev[1]) <= 0)) {
      if (prev[1] !== undefined && (b === undefined || cmp(b, prev[1]) > 0)) prev[1] = b;
      continue;
    }
    out.push([a, b]);
  }
  return out;
}

/** 여러 구간(고른 마디들)에서 바뀔 템포 값. 미리보기용으로 구간마다 tempoChangeTargets를 모은다 */
export function tempoChangeTargetsInSpans(song: Song, spans: readonly TempoSpan[]): readonly number[] {
  return tidySpans(spans).flatMap(([from, to]) => tempoChangeTargets(song, from, to).bpms);
}

/**
 * 고른 마디들만 템포 한꺼번에 바꾸기: 구간마다 changeTemposResult를 앞에서부터 차례로 (시간을 옮기지 않으니 자리는 그대로).
 * 구간 처음에 바꾼 템포, 구간 끝에 원래 템포를 넣으므로 구간 밖 빠르기는 그대로다. 넣지 못한 악보는 모아서 알린다
 */
export function changeTemposInSpansResult(song: Song, change: TempoChange, spans: readonly TempoSpan[]): TempoChangeResult {
  const failures = new Map<number, Set<TempoEdgeFailure>>();
  let cur = song;
  for (const [from, to] of tidySpans(spans)) {
    const r = changeTemposResult(cur, change, from, to);
    for (const f of r.failed) failures.set(f.score, new Set([...(failures.get(f.score) ?? []), ...f.reasons]));
    cur = r.song;
  }
  return { song: cur, failed: [...failures].sort(([a], [b]) => a - b).map(([score, reasons]) => ({ score, reasons: [...reasons] })) };
}

/** changeTemposInSpansResult를 실행 취소 한 칸 명령으로 */
export function changeTemposInSpans(change: TempoChange, spans: readonly TempoSpan[], label = "템포 한꺼번에 바꾸기"): Command {
  return songCommand(label, (song) => changeTemposInSpansResult(song, change, spans).song);
}

/**
 * 고른 마디들만 템포 바꾸기 + 실제 시간 지키기: 뒤 구간부터 changeTemposKeepTimeResult (앞 구간 자리는 바꾸기 전 곡 그대로).
 * 한 구간이라도 거절하면 곡을 바꾸지 않고, 거절 자리는 모두 바꾸기 전 곡 기준이다
 */
export function changeTemposKeepTimeInSpansResult(song: Song, change: TempoChange, spans: readonly TempoSpan[]): TempoConvertResult {
  const failed: TempoConvertFailure[] = [];
  let cur = song;
  for (const [from, to] of tidySpans(spans).reverse()) {
    const r = changeTemposKeepTimeResult(cur, change, from, to);
    if (r.failed.length > 0) {
      failed.push(...r.failed);
      continue;
    }
    cur = r.song;
  }
  if (failed.length > 0) return { song, failed, rounded: [] };
  return { song: cur, failed: [], rounded: [] };
}

/** changeTemposKeepTimeInSpansResult를 실행 취소 한 칸 명령으로 */
export function changeTemposKeepTimeInSpans(change: TempoChange, spans: readonly TempoSpan[], label = "템포 한꺼번에 바꾸기"): Command {
  return songCommand(label, (song) => changeTemposKeepTimeInSpansResult(song, change, spans).song);
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
  // 쉼표·음을 나눠 쓸 음길이 한도 (곡 프로필)
  const lengths = songProfile(song).length;
  if (cmp(e.at, scoreEnd(tracks, undefined, lengths)) >= 0) return { song };
  const generated = scoreTempo(song, ids).generated;
  const heard = [
    ...tracks.flatMap((t) => (t.mml ? tempoTokens(t.mml, undefined, lengths) : [])),
    ...tracks.flatMap((t) => generated.get(t.id) ?? []),
  ].filter((k) => cmp(k.at, e.at) <= 0);
  const last = heard.reduce<Rat | undefined>((m, k) => (m === undefined || cmp(k.at, m) > 0 ? k.at : m), undefined);
  if (last !== undefined && heard.filter((k) => eq(k.at, last)).every((k) => k.bpm === e.bpm)) return { song };
  const t = `t${e.bpm}`;
  const sources = tracks
    .map((track) => ({ track, mml: track.mml, src: track.mml ? surgicalSource(track.mml, lengths) : undefined }))
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
    if (!eq(textEnd(next, undefined, lengths), textEnd(mml, undefined, lengths))) {
      lengthRefused = true;
      return undefined;
    }
    return {
      ...song,
      tracks: song.tracks.map((tr) => {
        if (tr.id !== id) return tr;
        return renote ? { ...tr, notes: carryTabStrings(tr.notes, parseTrackText(id, next, lengths).notes), mml: next } : { ...tr, mml: next };
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
    return next === song ? song : withFreshTempo(song, next);
  });
}

/**
 * 고친 곡(next)에서 새로 빠진 템포를 그 악보 원문에도 적는다 (tempoCommand). 고치기 전(song)부터 빠져 있던 것은 그대로 둔다.
 * move를 주면 고치기 전 템포를 옮긴 자리·빠르기로 견준다 (템포 변환처럼 자리와 값이 함께 바뀐 편집)
 */
function withFreshTempo(song: Song, next: Song, move: (e: TempoEvent) => TempoEvent = (e) => e): Song {
  const key = (ids: readonly string[], e: TempoEvent) => `${ids[0]}|${e.bpm}@${e.at.n}/${e.at.d}`;
  const before = new Set(songScores(song).flatMap((ids) => scoreTempo(song, ids).missing.map((e) => key(ids, move(e)))));
  return songScores(next).reduce((out, ids) => {
    const fresh = scoreTempo(out, ids).missing.filter((e) => !before.has(key(ids, e)));
    return fresh.length > 0 ? fillScore(out, ids, fresh) : out;
  }, next);
}

/** 지도 템포 at을 나타내는 원문의 t: 그 자리 t와, 같은 빠르기로 그 구간 안에 옮겨 적힌 t (그 자리에 다른 지도 템포가 있으면 빼고) */
function tokensFor(song: Song, at: Rat): (token: TempoToken) => boolean {
  const window = tempoWindows(song.tempo).find((w) => eq(w.event.at, at));
  return (token) =>
    eq(token.at, at) || (window !== undefined && inWindow(token, window) && !song.tempo.some((e) => eq(e.at, token.at)));
}

function withTempo(song: Song, at: Rat, bpm: number): Song {
  const represents = tokensFor(song, at);
  const lengths = songProfile(song).length;
  const tracks = song.tracks.map((t) => {
    const hits = (t.mml ? surgicalSource(t.mml, lengths)?.tokens : undefined)?.filter(represents) ?? [];
    if (!t.mml || hits.length === 0) return t;
    return { ...t, mml: { ...t.mml, text: spliceText(t.mml.text, hits.map((h) => ({ span: h.span, text: `t${bpm}` }))) } };
  });
  return { ...song, tempo: normalizeTempo([...song.tempo.filter((e) => !eq(e.at, at)), { at, bpm }]), tracks };
}

function withoutTempo(song: Song, at: Rat): Song {
  const represents = tokensFor(song, at);
  const lengths = songProfile(song).length;
  const tracks = song.tracks.map((t) => {
    if (!t.mml) return t;
    const hits = surgicalSource(t.mml, lengths)?.tokens.filter(represents) ?? [];
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
  // 지울 템포가 없으면(적지 않은 t120 등) 곡을 그대로 돌려 빈 실행 취소 칸이 생기지 않게 한다
  if (!song.tempo.some((e) => eq(e.at, at)) && tracks.every((t, i) => t === song.tracks[i])) return song;
  return { ...song, tempo: song.tempo.filter((e) => !eq(e.at, at)), tracks };
}

/**
 * 악보 하나에 빠진 템포를 원문에 적는다: 음·쉼표 경계가 있는 원문 하나에 끼우고 (이미 t를 쓴 원문 먼저, 그다음 트랙 순서),
 * 끼울 곳이 없으면 그 악보 첫 원문을 버려 출력기가 쓰게 한다 (음 가운데면 출력기가 &로 나누거나 뒤쪽 음 경계로 옮긴다)
 */
function fillScore(song: Song, ids: readonly string[], missing: readonly TempoEvent[]): Song {
  let out = song;
  const lengths = songProfile(song).length;
  for (const e of missing) {
    const tracks = ids.map((id) => out.tracks.find((t) => t.id === id)!);
    if (tracks.some((t) => !t.mml)) break;
    const sources = tracks.map((t) => surgicalSource(t.mml!, lengths));
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


/** 템포로 때운 구간을 음 길이로 바꾸기: 템포를 펼 단위 (구간 전체 하나 · 마디마다 · 박마다) */
export type RespaceUnit = "span" | "bar" | "beat";

/** 음을 옮길 격자 (성긴 것부터). 한 번에 하나만 쓴다 (1/48과 1/64의 차는 쓸 수 없는 길이가 된다) */
export const RESPACE_GRIDS: readonly Rat[] = [rat(1, 16), rat(1, 24), rat(1, 32), rat(1, 48), rat(1, 64)];

/** 격자 오차 허용 기본값 (초) */
export const RESPACE_TOLERANCE = 0.015;

export interface RespaceOptions {
  /** 템포 단위 (기본 구간 전체 하나) */
  readonly unit?: RespaceUnit;
  /** 격자 (기본 1/64). "auto"면 허용 오차를 지키며 구간 길이를 나누는 가장 성긴 격자 */
  readonly grid?: Rat | "auto";
  /** 격자 오차 허용 (초, 기본 15ms). 배율과 자동 격자를 고를 때 쓴다 */
  readonly tolerance?: number;
  /** 배율: "auto"면 1·2·4에서 고르고, 1이면 묶어 둔다 (마디 길이를 바꾸지 않는다) */
  readonly scale?: "auto" | 1;
  /** 원곡 시작점으로 맞출 때: 바꾸기 전 곡 자리마다 맞출 곡 초 (찾은 음만). 그 사이 자리는 꺾은선으로 옮긴다 */
  readonly anchors?: readonly { readonly at: Rat; readonly seconds: number }[];
}

/**
 * 템포를 음 길이로 바꾸기에서 거절한 까닭 (at은 모두 바꾸기 전 곡 자리). 배율 변환의 까닭(TempoConvertFailure)에 더해
 * - range: 편 템포가 게임 템포 범위 밖 (더 큰 단위나 배율을 쓴다)
 * - crowded: 길이 0이 될 음의 끝을 밀다가 구간 끝에 닿았다 (배율을 올리거나 구간을 줄인다)
 * - grid: 고른 격자가 구간 길이를 나누지 못해 구간 끝에 닿는 길이를 쓸 수 없다
 */
export type RespaceFailure =
  | TempoConvertFailure
  | { readonly kind: "range"; readonly at: Rat; readonly bpm: number }
  | { readonly kind: "crowded"; readonly at: Rat }
  | { readonly kind: "grid"; readonly at: Rat; readonly grid: Rat; readonly length: Rat };

/** 구간마다 고른 값: 바꾸기 전 구간, 배율, 격자, 구간 평균 템포(배율 전) */
export interface RespaceSpanInfo {
  readonly from: Rat;
  readonly to: Rat;
  readonly scale: number;
  readonly grid: Rat;
  readonly bpm: number;
}

/** 템포를 음 길이로 바꾸기 결과. failed가 있으면 song은 바꾸기 전 곡 그대로다 */
export interface RespaceResult {
  readonly song: Song;
  readonly failed: readonly RespaceFailure[];
  readonly spans: readonly RespaceSpanInfo[];
  /** 음 시작이 맞출 시각(지금 시각 또는 원곡 시작점)에서 가장 많이 어긋난 양 (초, 구간 안) */
  readonly maxError: number;
  /** 곡 모든 음 시작이 바꾸기 전보다 가장 많이 움직인 양 (초, 구간 밖 반올림 오차 포함) */
  readonly maxShift: number;
  /** 시작과 끝이 같은 격자점이 되어 끝을 한 칸 민 음 수 */
  readonly collapsed: number;
  /** 서로 다른 음 시작이 한 격자점으로 모인 곳 수 */
  readonly merged: number;
  /** 그 가운데 만든 기록(아르페지오·꾸밈음 등)이 붙은 음이 낀 곳 수 */
  readonly mergedMade: number;
  /** 새로 생기거나 바뀐 박자표 (고친 곡 자리) */
  readonly meters: readonly TimeSigEvent[];
}

const ratKey = (r: Rat) => `${r.n}/${r.d}`;

/** at 다음 마디선(unit "bar") 또는 박선(unit "beat"). 박자표가 바뀌는 자리도 마디선이다 */
function nextLine(timeSig: readonly TimeSigEvent[], at: Rat, unit: "bar" | "beat"): Rat {
  const start = measureStart(timeSig, at);
  const grid = meterGrid(meterAt(timeSig, at));
  let next = add(start, grid.measure);
  const sig = [...timeSig].sort((a, b) => cmp(a.at, b.at)).find((s) => cmp(s.at, at) > 0);
  if (sig && cmp(sig.at, next) < 0) next = sig.at;
  if (unit === "beat") {
    const q = div(sub(at, start), grid.beat);
    const beat = add(start, mul(grid.beat, rat(Math.floor(q.n / q.d) + 1)));
    if (cmp(beat, next) < 0) next = beat;
  }
  return next;
}

/** 박 하나 [from, to) (마디 끝·박자표 자리에서 끊는다) */
function beatAround(timeSig: readonly TimeSigEvent[], at: Rat): readonly [Rat, Rat] {
  const start = measureStart(timeSig, at);
  const grid = meterGrid(meterAt(timeSig, at));
  const q = div(sub(at, start), grid.beat);
  const from = add(start, mul(grid.beat, rat(Math.floor(q.n / q.d))));
  return [from, nextLine(timeSig, from, "beat")];
}

/** 템포가 튀는 박: 박 안에서 울리는 템포가 둘 이상이고 가장 큰 값 ÷ 가장 작은 값이 ratio 이상인 곳 (위치순) */
export interface TempoJump {
  readonly from: Rat;
  readonly to: Rat;
  readonly min: number;
  readonly max: number;
}

export function tempoJumps(song: Pick<Song, "tempo" | "timeSig">, ratio = 1.4): TempoJump[] {
  const map = normalizeTempo(song.tempo);
  const out: TempoJump[] = [];
  const seen = new Set<string>();
  for (const e of map) {
    const [from, to] = beatAround(song.timeSig, e.at);
    // 박 처음에 놓인 템포 하나만으로는 박 안에 템포가 둘이 되지 않는다
    if (eq(from, e.at) || seen.has(ratKey(from))) continue;
    seen.add(ratKey(from));
    const bpms = [tempoAtPosition(map, from) ?? DEFAULT_BPM, ...map.filter((x) => cmp(x.at, from) > 0 && cmp(x.at, to) < 0).map((x) => x.bpm)];
    const min = Math.min(...bpms);
    const max = Math.max(...bpms);
    if (max / min >= ratio) out.push({ from, to, min, max });
  }
  return out.sort((a, b) => cmp(a.from, b.from));
}

interface RespaceSpanOut {
  readonly song: Song;
  readonly failed: readonly RespaceFailure[];
  readonly info?: RespaceSpanInfo;
  /** 음 id → 맞출 곡 초 (구간 안 음 시작) */
  readonly targets: ReadonlyMap<string, number>;
  readonly collapsed: number;
  readonly merged: number;
  readonly mergedMade: number;
}

/** 구간 하나 [from, to)를 바꾼다 (설계서 2번 계산 1-7). 구간 뒤는 배율만큼 밀리고, 구간 앞은 그대로다 */
function respaceSpan(song: Song, from: Rat, to: Rat, options: RespaceOptions): RespaceSpanOut {
  const none: RespaceSpanOut = { song, failed: [], targets: new Map(), collapsed: 0, merged: 0, mergedMade: 0 };
  const fail = (failed: readonly RespaceFailure[]): RespaceSpanOut => ({ ...none, failed });
  const profile = songProfile(song);
  const range = profile.tempo;
  const tolerance = options.tolerance ?? RESPACE_TOLERANCE;
  const unit = options.unit ?? "span";
  const clock = tempoClock(song.tempo);
  const c0 = clock(from);
  const c1 = clock(to);
  const length = sub(to, from);
  if (!(c1 > c0) || length.n <= 0) return none;

  // 1. 맞출 시각: 지금 시각, 원곡 시작점을 주면 그 점들을 잇는 꺾은선 (지금 초 → 맞출 초. 구간 처음·끝은 제자리)
  const knots: [number, number][] = [[c0, c0]];
  for (const a of [...(options.anchors ?? [])].sort((x, y) => cmp(x.at, y.at))) {
    if (cmp(a.at, from) <= 0 || cmp(a.at, to) >= 0) continue;
    const x = clock(a.at);
    const last = knots[knots.length - 1]!;
    if (x > last[0] && a.seconds > last[1] && x < c1 && a.seconds < c1) knots.push([x, a.seconds]);
  }
  knots.push([c1, c1]);
  const warp = (x: number): number => {
    let lo = 0;
    let hi = knots.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (knots[mid]![0] <= x) lo = mid;
      else hi = mid;
    }
    const [x0, y0] = knots[lo]!;
    const [x1, y1] = knots[hi]!;
    return x1 > x0 ? y0 + ((x - x0) * (y1 - y0)) / (x1 - x0) : y0;
  };
  const target = (p: Rat) => warp(clock(p));

  // 2. 배율과 격자: 격자 오차 120 × G ÷ (b0 × s)초가 허용 오차 안인 가장 작은 s (b0 × s는 게임 범위 안).
  // 격자는 구간 처음 기준이라 구간 길이(배율 뒤)를 나누어야 끝 자리에 닿는 길이를 쓸 수 있다
  const b0 = Math.round((240 * toFloat(length)) / (c1 - c0));
  const scales = (options.scale === 1 ? [1] : [1, 2, 4]).filter((s) => b0 * s >= range.min && b0 * s <= range.max);
  if (scales.length === 0) return fail([{ kind: "range", at: from, bpm: b0 }]);
  const divides = (g: Rat, s: number) => div(mul(length, rat(s)), g).d === 1;
  const fits = (g: Rat, s: number) => (120 * toFloat(g)) / (b0 * s) <= tolerance + 1e-9;
  const chosen = options.grid ?? rat(1, 64);
  let pick: { scale: number; grid: Rat } | undefined;
  if (chosen === "auto") {
    for (const s of scales) {
      const found = RESPACE_GRIDS.find((g) => divides(g, s) && fits(g, s));
      if (found) {
        pick = { scale: s, grid: found };
        break;
      }
    }
    if (!pick) {
      // 허용 오차를 지킬 수 없으면 가장 큰 배율의, 구간 길이를 나누는 가장 촘촘한 격자 (오차는 미리보기에 보인다)
      const s = scales[scales.length - 1]!;
      const found = [...RESPACE_GRIDS].reverse().find((g) => divides(g, s));
      if (!found) return fail([{ kind: "grid", at: from, grid: rat(1, 64), length: mul(length, rat(s)) }]);
      pick = { scale: s, grid: found };
    }
  } else {
    const s = scales.find((x) => fits(chosen, x)) ?? scales[scales.length - 1]!;
    if (!divides(chosen, s)) return fail([{ kind: "grid", at: from, grid: chosen, length: mul(length, rat(s)) }]);
    pick = { scale: s, grid: chosen };
  }
  const { scale, grid } = pick;
  const g = toFloat(grid);

  // 3. 배율이 1보다 크면 먼저 실제 시간 유지 템포 변환 (구간이 늘고 마디 길이도 함께 바뀐다). 시각은 그대로다
  let cur = song;
  if (scale > 1) {
    const r = convertTempoResult(song, rat(scale), from, to);
    if (r.failed.length > 0) return fail(r.failed);
    cur = r.song;
  }
  const S = rat(scale);
  const grow = mul(length, rat(scale - 1));
  const end = add(from, mul(length, S));
  /** 바꾼(배율 뒤) 곡 자리 → 바꾸기 전 곡 자리 */
  const back = (x: Rat): Rat => (cmp(x, from) <= 0 ? x : cmp(x, end) <= 0 ? add(from, div(sub(x, from), S)) : sub(x, grow));

  // 4. 템포 펴기: 단위 경계마다 템포 하나, 경계 사이 템포 = round(240 × 길이 ÷ 그 사이 시간). 반올림 오차는 다음 조각이 받는다
  const bounds: Rat[] = [from];
  if (unit !== "span") for (let at = nextLine(cur.timeSig, from, unit); cmp(at, end) < 0; at = nextLine(cur.timeSig, at, unit)) bounds.push(at);
  bounds.push(end);
  const failed: RespaceFailure[] = [];
  const pieces: { at: Rat; bpm: number; t0: number }[] = [];
  let reached = c0;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const L = toFloat(sub(bounds[i + 1]!, bounds[i]!));
    const seconds = target(back(bounds[i + 1]!)) - reached;
    const raw = seconds > 0 ? Math.round((240 * L) / seconds) : range.max + 1;
    if (raw < range.min || raw > range.max) failed.push({ kind: "range", at: back(bounds[i]!), bpm: raw });
    const bpm = Math.min(range.max, Math.max(range.min, raw));
    pieces.push({ at: bounds[i]!, bpm, t0: reached });
    reached += (240 * L) / bpm;
  }
  if (failed.length > 0) return fail(failed);
  const map = normalizeTempo(cur.tempo);
  const before = map.filter((e) => cmp(e.at, from) < 0);
  const after = map.filter((e) => cmp(e.at, end) >= 0);
  // 구간 끝에는 원래 템포를 다시 적는다 (그 자리에 템포가 있으면 그대로, 곡 끝이면 적지 않는다). 구간 안 템포는 지운다
  const backBpm = tempoAtPosition(map, end) ?? DEFAULT_BPM;
  let current = before[before.length - 1]?.bpm ?? DEFAULT_BPM;
  const inner: TempoEvent[] = [];
  for (const p of pieces) {
    if (p.bpm !== current) inner.push({ at: p.at, bpm: p.bpm });
    current = p.bpm;
  }
  if (!after.some((e) => eq(e.at, end)) && cmp(end, scoreEnd(cur.tracks, undefined, profile.length)) < 0 && backBpm !== current) inner.push({ at: end, bpm: backBpm });
  const tempo = normalizeTempo([...before, ...inner, ...after]);

  // 5. 음 옮기기: 맞출 시각을 새 템포로 자리로 바꿔 격자로 반올림 (구간 처음 기준 칸 번호 k, 구간 끝은 K)
  const K = Math.round(toFloat(sub(end, from)) / g);
  const cellOf = (p: Rat): number => {
    const sec = target(p);
    let i = 0;
    while (i + 1 < pieces.length && pieces[i + 1]!.t0 <= sec) i++;
    const piece = pieces[i]!;
    const offset = toFloat(sub(piece.at, from)) + ((sec - piece.t0) * piece.bpm) / 240;
    return Math.min(K, Math.max(0, Math.round(offset / g)));
  };
  // 자리 하나에 "옛 자리 → 새 자리" 함수 하나 (모든 트랙이 같이 쓴다: 같은 자리에서 시작하던 음은 같은 자리로).
  // 뒤로 가지 않게만 하고, 서로 가까운 음 시작은 한 점으로 모여도 된다. 미는 것은 어떤 음의 시작과 끝이 같은 점이 되어
  // 길이가 0이 될 때뿐이다: 그 끝 자리(와 그 뒤 자리를 필요한 만큼만)를 한 칸 뒤로. 구간 끝에 닿으면 거절
  const notes = cur.tracks.flatMap((t) => t.notes);
  const points = new Map<string, Rat>();
  const endsAt = new Map<string, Rat[]>();
  for (const n of notes) {
    const s0 = back(n.start);
    const e0 = back(add(n.start, n.dur));
    for (const p of [s0, e0]) if (cmp(p, from) > 0 && cmp(p, to) < 0) points.set(ratKey(p), p);
    if (cmp(s0, from) >= 0 && cmp(s0, to) < 0 && cmp(e0, to) <= 0) {
      const list = endsAt.get(ratKey(e0)) ?? [];
      list.push(s0);
      endsAt.set(ratKey(e0), list);
    }
  }
  const sorted = [...points.values(), to].sort(cmp);
  const cell = new Map<string, number>([[ratKey(from), 0]]);
  let prev = 0;
  let collapsed = 0;
  for (const p of sorted) {
    const fixed = eq(p, to);
    const raw = fixed ? K : cellOf(p);
    let need = prev;
    for (const s0 of endsAt.get(ratKey(p)) ?? []) {
      const k = cell.get(ratKey(s0))!;
      if (raw <= k) collapsed++;
      need = Math.max(need, k + 1);
    }
    const k = fixed ? K : Math.max(raw, need);
    if (k < need || k > K) {
      return fail([{ kind: "crowded", at: p }]);
    }
    cell.set(ratKey(p), k);
    prev = k;
  }
  const newAt = (k: number) => add(from, mul(grid, rat(k)));
  // 바꾼(배율 뒤) 곡 자리를 옮긴 자리로. 음 자리가 아닌 것(마커, 만든 기록의 음)도 같은 계산으로 (밀기는 없다)
  const place = (x: Rat): Rat => {
    if (cmp(x, from) <= 0 || cmp(x, end) >= 0) return x;
    const p = back(x);
    const k = cell.get(ratKey(p));
    return newAt(k ?? cellOf(p));
  };
  // 한 자리로 모인 음 시작 (서로 다른 옛 자리가 같은 칸으로)
  const groups = new Map<number, { starts: Set<string>; made: boolean }>();
  const targets = new Map<string, number>();
  for (const n of notes) {
    const s0 = back(n.start);
    if (cmp(s0, from) < 0 || cmp(s0, to) >= 0) continue;
    targets.set(n.id, target(s0));
    const k = cell.get(ratKey(s0))!;
    const gr = groups.get(k) ?? { starts: new Set<string>(), made: false };
    gr.starts.add(ratKey(s0));
    if (n.made) gr.made = true;
    groups.set(k, gr);
  }
  const mergedGroups = [...groups.values()].filter((gr) => gr.starts.size > 1);

  // 6. 붙임줄·v·타브 줄·실험실 표시는 음에 그대로 붙어 간다. 구간에 걸친 음은 안쪽 끝만 옮긴다
  const moveNote = (n: Note): Note => {
    const start = place(n.start);
    const stop = place(add(n.start, n.dur));
    return eq(start, n.start) && eq(stop, add(n.start, n.dur)) ? n : { ...n, start, dur: sub(stop, start) };
  };
  const untouched = (t: Track) =>
    cmp(notesEnd(t.notes), from) <= 0 && (!t.mml || (cmp(textEnd(t.mml, undefined, profile.length), from) <= 0 && tempoTokens(t.mml, undefined, profile.length).every((k) => cmp(k.at, from) < 0)));
  const tracks = cur.tracks.map((t) => {
    if (untouched(t)) return t;
    const { mml: _mml, ...rest } = t;
    return { ...rest, notes: t.notes.map(moveNote) };
  });
  const moveRecord = (r: MadeRecord): MadeRecord => {
    const list = (l: MadeRecord["before"]) => l.map((m) => ({ ...m, notes: m.notes.map(moveNote) }));
    return { ...r, before: list(r.before), after: list(r.after) };
  };
  const moved: Song = {
    ...cur,
    tempo,
    // 범위 메모는 끝도 함께 옮긴다. 반올림으로 끝이 시작보다 앞이 되거나 같아지면 끝을 빼서 한 점 메모로 둔다
    markers: cur.markers.map((m) => {
      const { end: _end, ...rest } = m;
      const at = place(m.at);
      const end = m.end ? place(m.end) : undefined;
      return end && cmp(end, at) > 0 ? { ...rest, at, end } : { ...rest, at };
    }),
    // 조표 바뀜도 음과 같은 자리 계산으로 옮긴다 (안 옮기면 옮긴 음이 앞 조표 아래로 간다). 두 조표가 한 자리로 모이면 뒤 것만 남긴다
    ...(cur.keys ? { keys: movedKeys(cur.keys, place) } : {}),
    tracks,
    ...(cur.made ? { made: cur.made.map(moveRecord) } : {}),
  };
  const kept = keepMovedEnd(cur, moved, place, inner.map((e) => e.at));
  const next = withFreshTempo(cur, kept);

  // 7. 검사: 새로 쓸 수 없게 된 음·쉼표 길이, 끝 쉼표로 지키던 길이, 게임 출력이 제자리에 못 쓰는 템포
  const lengths = profile.length;
  next.tracks.forEach((t, k) => {
    const old = cur.tracks[k]!;
    if (t === old || t.notes === old.notes) return;
    const gaps = (list: readonly Note[]) => {
      let pos: Rat = ZERO;
      return list.map((n) => {
        const gap = cmp(n.start, pos) > 0 ? sub(n.start, pos) : ZERO;
        if (cmp(add(n.start, n.dur), pos) > 0) pos = add(n.start, n.dur);
        return gap;
      });
    };
    const oldGaps = gaps(old.notes);
    const newGaps = gaps(t.notes);
    t.notes.forEach((n, i) => {
      const o = old.notes[i]!;
      if (cmp(add(o.start, o.dur), from) < 0 || cmp(o.start, end) > 0) return;
      const at = back(o.start);
      if (!canWriteExactly(newGaps[i]!, lengths) && canWriteExactly(oldGaps[i]!, lengths)) failed.push({ kind: "length", trackId: t.id, at, length: newGaps[i]!, rest: true });
      if (!canWriteExactly(n.dur, lengths) && canWriteExactly(o.dur, lengths)) failed.push({ kind: "length", trackId: t.id, at, length: n.dur, rest: false });
    });
  });
  for (const old of cur.tracks) {
    if (!old.mml || cmp(textEnd(old.mml, undefined, lengths), notesEnd(old.notes)) <= 0) continue;
    const now = next.tracks.find((t) => t.id === old.id);
    if (now && now !== old && !(now.mml && eq(textEnd(now.mml, undefined, lengths), place(textEnd(old.mml, undefined, lengths))))) failed.push({ kind: "end", trackId: old.id, at: back(textEnd(old.mml, undefined, lengths)) });
  }
  // 알릴 자리: 옮긴 자리 → 바꾸기 전 자리 (음 자리면 그 옛 자리, 아니면 배율만 되돌린다)
  const origin = new Map<string, Rat>();
  for (const [key, k] of cell) if (!origin.has(ratKey(newAt(k)))) origin.set(ratKey(newAt(k)), points.get(key) ?? (key === ratKey(from) ? from : to));
  const report = (x: Rat) => origin.get(ratKey(x)) ?? back(x);
  failed.push(...outputTempoFailures(cur, next, place, report, from, end, failed.length > 0));
  if (failed.length > 0) return fail(failed);
  return {
    song: next,
    failed: [],
    info: { from, to, scale, grid, bpm: b0 },
    targets,
    collapsed,
    merged: mergedGroups.length,
    mergedMade: mergedGroups.filter((gr) => gr.made).length,
  };
}

/**
 * 템포로 때운 구간을 음 길이로 바꾸기 (1.1 실험실). 고른 구간마다 템포를 단위(구간 하나 / 마디마다 / 박마다)로 고르게 펴고,
 * 음이 지금 나는 시각(또는 anchors로 준 원곡 소리 시작점)을 지키도록 음 자리와 길이를 격자에 맞춰 다시 쓴다.
 * 64분음표 간격이 거칠면 구간 템포를 2배(4배)로 올리고 음 길이도 같은 배로 늘린다 (convertTempoResult, 마디 길이도 바뀐다).
 * 여러 구간은 뒤 구간부터 바꿔 앞 구간 자리는 바꾸기 전 그대로다. 한 구간이라도 거절하면 곡을 바꾸지 않는다
 */
export function tempoToLengthsResult(song: Song, spans: readonly TempoSpan[], options: RespaceOptions = {}): RespaceResult {
  const empty = { spans: [], maxError: 0, maxShift: 0, collapsed: 0, merged: 0, mergedMade: 0, meters: [] };
  const songEnd = scoreEnd(song.tracks, undefined, songProfile(song).length);
  const closed = tidySpans(spans)
    .map(([a, b]): [Rat, Rat] => [a, b === undefined || cmp(b, songEnd) > 0 ? songEnd : b])
    .filter(([a, b]) => cmp(a, b) < 0);
  let cur = song;
  const failed: RespaceFailure[] = [];
  const infos: RespaceSpanInfo[] = [];
  const targets = new Map<string, number>();
  let collapsed = 0;
  let merged = 0;
  let mergedMade = 0;
  for (const [from, to] of closed.reverse()) {
    const r = respaceSpan(cur, from, to, options);
    if (r.failed.length > 0) {
      failed.push(...r.failed);
      continue;
    }
    cur = r.song;
    if (r.info) infos.unshift(r.info);
    for (const [id, sec] of r.targets) targets.set(id, sec);
    collapsed += r.collapsed;
    merged += r.merged;
    mergedMade += r.mergedMade;
  }
  if (failed.length > 0) return { song, failed: failed.sort((a, b) => cmp(a.at, b.at)), ...empty };
  const before = tempoClock(song.tempo);
  const after = tempoClock(cur.tempo);
  const was = new Map(song.tracks.flatMap((t) => t.notes.map((n) => [n.id, n.start] as const)));
  let maxError = 0;
  let maxShift = 0;
  for (const t of cur.tracks)
    for (const n of t.notes) {
      const sec = after(n.start);
      const want = targets.get(n.id);
      if (want !== undefined) maxError = Math.max(maxError, Math.abs(sec - want));
      const old = was.get(n.id);
      if (old !== undefined) maxShift = Math.max(maxShift, Math.abs(sec - before(old)));
    }
  const same = (a: TimeSigEvent, b: TimeSigEvent) => eq(a.at, b.at) && a.beats === b.beats && a.unit === b.unit;
  const meters = cur.timeSig.filter((e) => !song.timeSig.some((o) => same(o, e)));
  return { song: cur, failed: [], spans: infos, maxError, maxShift, collapsed, merged, mergedMade, meters };
}

/** tempoToLengthsResult를 실행 취소 한 칸 명령으로 (거절할 까닭은 tempoToLengthsResult로 미리 알아본다) */
export function tempoToLengths(spans: readonly TempoSpan[], options: RespaceOptions = {}, label = "템포를 음 길이로 바꾸기"): Command {
  return songCommand(label, (song) => tempoToLengthsResult(song, spans, options).song);
}

/** 조표 바뀜 자리를 place로 옮긴다. 같은 자리로 모인 것은 뒤 것만 남긴다 */
function movedKeys<K extends { readonly at: Rat }>(keys: readonly K[], place: (x: Rat) => Rat): K[] {
  const out: K[] = [];
  for (const k of keys) {
    const at = place(k.at);
    const moved = eq(at, k.at) ? k : { ...k, at };
    const last = out.at(-1);
    if (last && eq(last.at, at)) out[out.length - 1] = moved;
    else out.push(moved);
  }
  return out;
}
