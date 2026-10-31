import { add, cmp, toFloat, type GameProfile, type Note, type Rat, type Song, type Track } from "@mmlce/core";
import {
  parseTrackText,
  trackSource,
  validateChannel,
  validateSong,
  type Diagnostic,
  type SongDiagnostic,
  type ValidateSongOptions,
} from "@mmlce/mml";

/** 트랙 하나의 원문과, 원문 위치를 짚는 검사 결과 */
export interface TrackAnalysis {
  readonly track: Track;
  readonly text: string;
  readonly diagnostics: readonly Diagnostic[];
}

interface ChannelResult {
  readonly profile: GameProfile;
  readonly text: string;
  readonly diagnostics: readonly Diagnostic[];
  /** 음마다 원문 위치 (트랙 음 순서와 같다) */
  readonly spans: readonly (readonly [number, number])[];
}

const cache = new WeakMap<Track, ChannelResult>();

function channel(song: Song, track: Track, profile: GameProfile): ChannelResult {
  const hit = track.mml ? cache.get(track) : undefined;
  if (hit && hit.profile === profile) return hit;
  const source = trackSource(song, track);
  const { parsed } = parseTrackText(track.id, source);
  const result: ChannelResult = {
    profile,
    text: source.text,
    // 원문 글자 수는 게임에 넣는 글 수가 아니다 (주석·줄바꿈·겹친 v·l은 내보낼 때 빠진다). 한도는 내보낼 때 글자 수로 본다 (gameCharCounts)
    diagnostics: [...parsed.diagnostics, ...validateChannel(source.text, parsed, profile).filter((d) => !(track.mml && d.code === "char-limit"))],
    spans: parsed.notes.map((n) => n.span),
  };
  // 원문에서 읽은 트랙만 담아 둔다 (출력한 글은 곡 템포에 따라 달라짐)
  if (track.mml) cache.set(track, result);
  return result;
}

/**
 * 음을 짚어도 편집기 밑줄로 옮기지 않고 곡 검사 목록에 남기는 진단. 여러 트랙에 걸친 순간이라 한 트랙 글에 묶기 어렵고,
 * 목록에서 그 자리로 가고 고치기 창을 연다
 */
const SONG_LIST_CODES: ReadonlySet<string> = new Set(["fast-run-drop"]);

/**
 * 곡 전체를 검사한다. 음을 짚는 곡 검사(음색 경계 & 등)는 그 음이 원문에서 차지한
 * 자리로 옮겨 편집기에 밑줄로 보이게 하고, 나머지(채널 수 등)는 따로 돌려준다.
 */
export function analyzeSong(song: Song, profile: GameProfile, options: ValidateSongOptions = {}): { tracks: TrackAnalysis[]; song: SongDiagnostic[] } {
  // options.canonicalOf: 번호로만 아는 악기의 실제 악기 (음역·샘플 길이를 재생과 같게)
  const songDiagnostics = validateSong(song, profile, options);
  const loose: SongDiagnostic[] = [];
  const located = new Map<string, Diagnostic[]>();

  const tracks = song.tracks.map((track) => ({ track, result: channel(song, track, profile) }));

  for (const d of songDiagnostics) {
    const entry = d.trackId ? tracks.find((t) => t.track.id === d.trackId) : undefined;
    const index = entry && d.noteId ? entry.track.notes.findIndex((n) => n.id === d.noteId) : -1;
    const span = entry?.result.spans[index];
    // 원문이 있는 트랙만 음 순서가 원문 순서와 같다 (출력한 글은 음이 나뉠 수 있음)
    if (entry?.track.mml && span && !SONG_LIST_CODES.has(d.code)) {
      const list = located.get(entry.track.id) ?? [];
      list.push(d.params ? { level: d.level, code: d.code, params: d.params, span } : { level: d.level, code: d.code, span });
      located.set(entry.track.id, list);
    } else {
      loose.push(d);
    }
  }

  return {
    tracks: tracks.map(({ track, result }) => ({
      track,
      text: result.text,
      diagnostics: [...result.diagnostics, ...(located.get(track.id) ?? [])],
    })),
    song: loose,
  };
}

/**
 * 롤에서 고른 음이 MML 글에서 차지한 자리. 원문이 있으면 음 순서가 같고, 출력한 글이면
 * 음이 템포 때문에 나뉘었을 수 있어 같은 높이로 그 위치에 걸린 첫 조각을 고른다
 */
export function noteSpan(song: Song, track: Track, note: Note): readonly [number, number] | undefined {
  const { parsed, notes } = parseTrackText(track.id, trackSource(song, track));
  if (track.mml) {
    const k = track.notes.findIndex((n) => n.id === note.id);
    if (k >= 0 && parsed.notes[k]) return parsed.notes[k]!.span;
  }
  const k = notes.findIndex(
    (n) => n.pitch === note.pitch && cmp(n.start, add(note.start, note.dur)) < 0 && cmp(note.start, add(n.start, n.dur)) < 0,
  );
  return k >= 0 ? parsed.notes[k]?.span : undefined;
}

/** 글 속 음 하나가 울리는 동안(온음표 단위)과 그 글 자리 */
export interface TimedSpan {
  readonly start: number;
  readonly end: number;
  readonly span: readonly [number, number];
}

// 출력한 글은 곡 템포에 따라 달라지므로 템포 목록도 같이 맞춰 본다
// 첫 트랙이면 템포 명령이 들어가 글이 달라지므로 그것도 맞춰 본다
const timelines = new WeakMap<Track, { tempo: Song["tempo"]; first: boolean; list: TimedSpan[] }>();

/** 트랙 글의 음을 시간 순으로 (재생 중 지금 울리는 음을 글에서 짚을 때) */
export function textTimeline(song: Song, track: Track): readonly TimedSpan[] {
  const hit = timelines.get(track);
  const first = song.tracks[0]?.id === track.id;
  if (hit && (track.mml || (hit.tempo === song.tempo && hit.first === first))) return hit.list;
  const { parsed, notes } = parseTrackText(track.id, trackSource(song, track));
  const out = notes
    .map((n, k) => ({ start: toFloat(n.start), end: toFloat(add(n.start, n.dur)), span: parsed.notes[k]?.span }))
    .filter((x): x is TimedSpan => x.span !== undefined)
    .sort((a, b) => a.start - b.start);
  timelines.set(track, { tempo: song.tempo, first, list: out });
  return out;
}

/** 시각 at(온음표)에 울리는 음의 글 자리. 없으면 undefined */
export function spanAt(timeline: readonly TimedSpan[], at: number): readonly [number, number] | undefined {
  let lo = 0;
  let hi = timeline.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid]!.start <= at + 1e-9) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const n = found >= 0 ? timeline[found] : undefined;
  return n && at < n.end ? n.span : undefined;
}

/** MML 편집기 글 커서가 가리키는 곡 자리 */
export interface TextCursorHit {
  /** 곡 시각 (온음표 단위). 음·쉼표 위면 그 시작, 명령·빈칸이면 다음 음·쉼표 시작, 글 끝이면 마지막 음·쉼표 끝 */
  readonly at: Rat;
  /** 커서가 음 글자 위(또는 바로 뒤)면 롤의 그 음 */
  readonly note?: Note;
}

/** 트랙 글의 음·쉼표를 글 자리 순으로 (글 커서 → 곡 자리를 셀 때) */
export interface TextItems {
  /** 음·쉼표의 글 자리와 곡 시작. k는 음 순번 (쉼표는 -1) */
  readonly items: readonly { readonly span: readonly [number, number]; readonly start: Rat; readonly k: number }[];
  /** 읽은 음 (parseTrackText 순서) */
  readonly notes: readonly Note[];
  /** 글 끝의 곡 시각 */
  readonly end: Rat;
}

// 방향키를 누를 때마다 다시 읽지 않게 마지막 곡·트랙 하나를 담아 둔다. 원문 없는 트랙은 글을 새로 쓰므로(optimizeMml) 음이 많으면 무겁다.
// 곡·트랙은 고치면 새 객체가 되므로 같은 객체면 글도 같다
let lastItems: { song: Song; track: Track; value: TextItems } | undefined;

/** 트랙 글의 음·쉼표 자리. 같은 곡·트랙이면 지난번 것을 그대로 준다 */
export function textItems(song: Song, track: Track): TextItems {
  if (lastItems && lastItems.song === song && lastItems.track === track) return lastItems.value;
  const source = trackSource(song, track);
  const { parsed, notes } = parseTrackText(track.id, source);
  const shift = (r: Rat) => (source.offset ? add(r, source.offset) : r);
  const items = [
    ...parsed.notes.map((n, k) => ({ span: n.span, start: notes[k]!.start, k })),
    ...parsed.rests.map((r) => ({ span: r.span, start: shift(r.start), k: -1 })),
  ].sort((a, b) => a.span[0] - b.span[0]);
  const value: TextItems = { items, notes, end: shift(parsed.end) };
  lastItems = { song, track, value };
  return value;
}

/**
 * 글 커서 자리(pos) → 곡 자리와 그 자리 음. 편집기 커서를 롤·재생 커서·상태줄 마디:박으로 잇는다.
 * 커서가 음 글자 안이면 그 음, 음 바로 뒤("c4|")도 그 음으로 본다. 두 음 사이("c4|d4")는 뒤 음이다
 */
export function textCursorAt(song: Song, track: Track, pos: number): TextCursorHit {
  const { items, notes, end } = textItems(song, track);
  const hit = items.find((x) => x.span[0] <= pos && pos < x.span[1]) ?? items.find((x) => x.span[1] === pos);
  if (!hit) {
    const next = items.find((x) => x.span[0] >= pos);
    return { at: next ? next.start : end };
  }
  if (hit.k < 0) return { at: hit.start };
  const piece = notes[hit.k]!;
  // 원문이 있으면 음 순서가 같다. 출력한 글은 템포 때문에 음이 나뉠 수 있어, 같은 높이로 그 자리에 걸린 음을 찾는다
  const note =
    (track.mml ? track.notes[hit.k] : undefined) ??
    track.notes.find((n) => n.pitch === piece.pitch && cmp(n.start, piece.start) <= 0 && cmp(piece.start, add(n.start, n.dur)) < 0);
  return note ? { at: hit.start, note } : { at: hit.start };
}
