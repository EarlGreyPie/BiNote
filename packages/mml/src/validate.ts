import { add, chainSampleEnd, cmp, eq, foldPitch, isSoloInstrument, positionToSeconds, soundingRangeOf, TIE_BEND_LIMIT, trackInstrument, type GameProfile, type Note, type Rat, type Song, type Track } from "@mmlce/core";
import { type Diagnostic, type ParseResult } from "./parser.js";
import { tempoMismatch } from "./tempo-text.js";

const NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];

/** MIDI 번호를 MML 표기로 (60 → o4c) */
function noteName(midi: number): string {
  return `o${Math.floor(midi / 12) - 1}${NAMES[midi % 12]}`;
}

/**
 * 채널 하나를 프로필 한도로 검사한다. 문법 오류는 파서가 이미 냈으므로 여기서는
 * 게임 한도(글자 수, 값 범위)만 본다. 범위 밖 값은 편집기 안에서는 쓸 수 있으므로 경고다.
 */
export function validateChannel(text: string, parsed: ParseResult, profile: GameProfile): Diagnostic[] {
  const out: Diagnostic[] = [];
  const limit = profile.charLimitPerScore;
  if (text.length > limit) {
    out.push({ level: "error", code: "char-limit", params: { count: text.length, limit }, span: [limit, text.length] });
  }

  for (const v of parsed.values) {
    const range =
      v.kind === "tempo"
        ? profile.tempo
        : v.kind === "length"
          ? profile.length
          : v.kind === "dots"
            ? { min: 0, max: profile.length.dots }
            : profile.volume;
    // 길이 0은 파서가 오류로 냈다
    if (v.kind === "length" && v.value < 1) continue;
    if (v.value < range.min || v.value > range.max) {
      out.push({
        level: "warning",
        code: `${v.kind}-range`,
        params: { value: v.value, min: range.min, max: range.max },
        span: v.span,
      });
    }
  }

  return out;
}

/** 곡 단위 검사 결과. 어느 트랙(또는 연주자)의 어느 음인지 함께 준다 */
export interface SongDiagnostic {
  readonly level: Diagnostic["level"];
  readonly code: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly trackId?: string;
  readonly playerId?: string;
  readonly noteId?: string;
}

function end(n: Note): Rat {
  return add(n.start, n.dur);
}

export interface ValidateSongOptions {
  /**
   * 번호로만 아는 악기(추가 사운드팩의 #42.3 등)의 실제 악기를 알려 준다(재생의 buildSchedule과 같은 모양).
   * pack은 트랙에서 고른 사운드팩(파일 이름, 없으면 자동)이다. 같은 번호도 팩마다 다른 악기일 수 있다.
   * 주면 음역·샘플 길이를 그 악기로 잰다. 모르면 undefined를 돌려주고, 그때는 원래 ID로 잰다
   */
  readonly canonicalOf?: (instrument: string, program: number | undefined, pack?: string) => string | undefined;
}

/**
 * 곡 전체 검사: 연주자별 채널 수, 악기 범위 밖이라 접혀 나는 음, 음색 경계를 넘는 &, 같은 연주자 트랙끼리 같은 음 겹침.
 */
export function validateSong(song: Song, profile: GameProfile, options: ValidateSongOptions = {}): SongDiagnostic[] {
  const out: SongDiagnostic[] = [];

  for (const player of song.players) {
    const tracks = song.tracks.filter((t) => t.playerId === player.id);
    if (tracks.length > profile.maxChordsPerPlayer) {
      out.push({
        level: "error",
        code: "player-channel-limit",
        params: { count: tracks.length, limit: profile.maxChordsPerPlayer },
        playerId: player.id,
      });
    }

    // 오르골·축음기는 장식품이 악보의 모든 트랙을 그 악기 하나로 친다. 다른 트랙 악기는 게임에서 그 소리가 나지 않는다
    for (const track of tracks) {
      const own = track.instrument?.canonical;
      if (own === undefined || own === player.instrument.canonical) continue;
      if (isSoloInstrument(profile, player.instrument.canonical)) {
        out.push({ level: "warning", code: "solo-score-own-instrument", trackId: track.id, playerId: player.id });
      } else if (isSoloInstrument(profile, own)) {
        out.push({ level: "warning", code: "solo-instrument-track", trackId: track.id, playerId: player.id });
      }
    }

    // 범위 밖 음도 게임은 받아 주지만 옥타브째 접어 다른 높이로 낸다 (악기는 트랙마다).
    // 재생과 같이 음역·샘플 길이는 트랙에서 고른 팩의 실제 악기로 정한다
    const instrumentOf = (track: Track) => {
      const ref = trackInstrument(song, track);
      return options.canonicalOf?.(ref.canonical, ref.program, ref.packId) ?? ref.canonical;
    };
    const rangeOf = (track: Track) => soundingRangeOf(profile, instrumentOf(track));
    for (const track of tracks) {
      const range = rangeOf(track);
      for (const n of track.notes) {
        const folded = foldPitch(n.pitch, range);
        if (folded === n.pitch) continue;
        out.push({
          level: "info",
          code: "pitch-fold",
          params: { octaves: (folded - n.pitch) / 12, sounds: noteName(folded), min: noteName(range.low), max: noteName(range.high) },
          trackId: track.id,
          noteId: n.id,
        });
      }
    }

    // 샘플은 반복 없이 끝나므로, 붙임 사슬이 샘플 끝보다 길면 뒷부분이 안 들린다.
    // 다른 음 붙임은 샘플 위치를 이어 가므로 재생과 같은 식(chainSampleEnd)으로 잰다
    for (const track of tracks) {
      const range = rangeOf(track);
      const notes = [...track.notes].sort((a, b) => cmp(a.start, b.start));
      for (let i = 0; i < notes.length; ) {
        let j = i;
        while (
          j + 1 < notes.length &&
          notes[j]!.tie === "next" &&
          eq(end(notes[j]!), notes[j + 1]!.start) &&
          Math.abs(foldPitch(notes[j + 1]!.pitch, range) - foldPitch(notes[i]!.pitch, range)) <= TIE_BEND_LIMIT
        )
          j++;
        const first = notes[i]!;
        const timeOf = (n: Note) => positionToSeconds(song.tempo, n.start);
        const steps: { at: number; pitch: number }[] = [];
        for (let k = i; k <= j; k++) {
          const pitch = foldPitch(notes[k]!.pitch, range);
          // 같은 음 붙임은 한 음이다
          if (steps.at(-1)?.pitch !== pitch) steps.push({ at: timeOf(notes[k]!), pitch });
        }
        const startAt = timeOf(first);
        const soundEnd = chainSampleEnd(profile, instrumentOf(track), steps);
        const length = positionToSeconds(song.tempo, end(notes[j]!)) - startAt;
        const heard = soundEnd - startAt;
        if (Number.isFinite(heard) && length > heard + 0.05) {
          out.push({
            level: "info",
            code: "sample-cut",
            params: { seconds: Math.round(heard * 10) / 10, length: Math.round(length * 10) / 10 },
            trackId: track.id,
            noteId: first.id,
          });
        }
        i = j + 1;
      }
    }

    for (const track of tracks) {
      const boundaries = profile.sampleBoundaries[instrumentOf(track)] ?? [];
      const notes = [...track.notes].sort((a, b) => cmp(a.start, b.start));
      for (let i = 0; i + 1 < notes.length; i++) {
        const a = notes[i]!;
        const b = notes[i + 1]!;
        if (a.tie !== "next" || a.pitch === b.pitch || cmp(end(a), b.start) !== 0) continue;
        const lo = Math.min(a.pitch, b.pitch);
        const hi = Math.max(a.pitch, b.pitch);
        const crossed = boundaries.find((x) => lo < x && x <= hi);
        if (crossed !== undefined) {
          out.push({
            level: "warning",
            code: "tie-across-boundary",
            params: { from: a.pitch, to: b.pitch },
            trackId: track.id,
            noteId: a.id,
          });
        }
      }
    }

    // 같은 음을 두 채널이 동시에 내면 게임에서 한쪽이 묻히거나 끊길 수 있다
    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        const other = tracks[j]!;
        for (const a of sameNoteOverlaps(tracks[i]!.notes, other.notes)) {
          out.push({
            level: "info",
            code: "same-note-overlap",
            params: { track: other.name },
            trackId: tracks[i]!.id,
            noteId: a.id,
          });
        }
      }
    }
  }
  // 원문의 t와 곡 템포가 어긋나면 3MLE 저장 때 원문 대신 다시 쓴 글이 나간다
  if (tempoMismatch(song)) out.push({ level: "warning", code: "tempo-mismatch" });

  return out;
}

/** a의 음 중 b에서 같은 높이 음과 시간이 겹치는 것. 두 트랙 모두 음이 겹치지 않으므로 한 번 훑으면 된다 */
function sameNoteOverlaps(aNotes: readonly Note[], bNotes: readonly Note[]): Note[] {
  const a = [...aNotes].sort((x, y) => cmp(x.start, y.start));
  const b = [...bNotes].sort((x, y) => cmp(x.start, y.start));
  const hits: Note[] = [];
  let j = 0;
  for (const n of a) {
    while (j < b.length && cmp(end(b[j]!), n.start) <= 0) j++;
    for (let k = j; k < b.length && cmp(b[k]!.start, end(n)) < 0; k++) {
      if (b[k]!.pitch === n.pitch) {
        hits.push(n);
        break;
      }
    }
  }
  return hits;
}
