import { add, cmp, toFloat, type GameProfile, type Note, type Song, type Track } from "@mmlce/core";
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
    diagnostics: [...parsed.diagnostics, ...validateChannel(source.text, parsed, profile)],
    spans: parsed.notes.map((n) => n.span),
  };
  // 원문에서 읽은 트랙만 담아 둔다 (출력한 글은 곡 템포에 따라 달라짐)
  if (track.mml) cache.set(track, result);
  return result;
}

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
    if (entry?.track.mml && span) {
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
