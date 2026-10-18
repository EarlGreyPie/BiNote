import { add, cmp, placeNote, removeNotes, sub, toggleTie, type InstrumentRef, type Note, type Rat, type Song } from "@mmlce/core";
import { previousVolume } from "./midiInput";

/** 타브에서 넣은 음이 들어갈 트랙과 바뀐 음 목록 */
export interface TabEdit {
  readonly changes: { trackId: string; notes: Note[] }[];
  /** 새로 넣었거나 바꾼 음 id (타브에서 고른 줄을 기억할 때 쓴다) */
  readonly noteId: string | undefined;
  /**
   * 그 자리에 빈 트랙이 없어 이 악보에 트랙을 더해 넣을 음 (화음이 트랙 수보다 많을 때).
   * instrument는 고른 트랙에 따로 정한 악기 (없으면 새 트랙도 악보 악기를 따른다)
   */
  readonly newTrack?: { readonly playerId: string; readonly notes: readonly Note[]; readonly instrument?: InstrumentRef };
  /** 빈 트랙도 없고 트랙을 더할 자리도 없어 넣지 않았다 (악보 트랙 수 한도) */
  readonly full?: true;
}

/**
 * 타브 커서 자리(at, 길이 dur)에 높이 pitch인 음을 넣는다.
 * - replace가 있으면 그 음의 높이만 바꾼다 (같은 줄에 프렛을 다시 친 경우)
 * - 없으면 고른 트랙부터 같은 악보의 트랙 가운데 그 자리가 빈 트랙에 넣는다 (화음은 트랙을 나눠 쓴다)
 * - 빈 트랙이 없으면 악보 트랙이 maxTracks보다 적을 때 트랙을 더해 넣고(newTrack), 다 찼으면 넣지 않는다(full).
 *   예전에는 고른 트랙에 덮어써서, 트랙보다 음이 많은 화음의 앞 음이 말없이 지워졌다
 */
export function placeTabNote(
  song: Song,
  trackIds: readonly string[],
  activeTrackId: string,
  at: Rat,
  dur: Rat,
  pitch: number,
  replace?: Note,
  volume?: number,
  maxTracks = Infinity,
): TabEdit {
  if (replace) {
    const track = song.tracks.find((t) => t.notes.some((n) => n.id === replace.id));
    if (!track) return { changes: [], noteId: undefined };
    return { changes: [{ trackId: track.id, notes: placeNote(track.notes, { ...replace, pitch }) }], noteId: replace.id };
  }
  const end = add(at, dur);
  const order = [activeTrackId, ...trackIds.filter((id) => id !== activeTrackId)];
  const free = (id: string) =>
    !song.tracks.find((t) => t.id === id)?.notes.some((n) => cmp(n.start, end) < 0 && cmp(at, add(n.start, n.dur)) < 0);
  const trackId = order.find(free);
  const active = song.tracks.find((t) => t.id === activeTrackId);
  if (trackId === undefined) {
    if (!active) return { changes: [], noteId: undefined };
    if (trackIds.length >= maxTracks) return { changes: [], noteId: undefined, full: true };
    const note: Note = {
      id: `${active.playerId}.tab${Date.now().toString(36)}`,
      start: at,
      dur,
      pitch,
      vol: volume ?? previousVolume(active.notes, at),
      tie: "none",
    };
    return { changes: [], noteId: note.id, newTrack: { playerId: active.playerId, notes: [note], ...(active.instrument ? { instrument: active.instrument } : {}) } };
  }
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track) return { changes: [], noteId: undefined };
  const note: Note = {
    id: `${track.id}.tab${Date.now().toString(36)}`,
    start: at,
    dur,
    pitch,
    vol: volume ?? previousVolume(track.notes, at),
    tie: "none",
  };
  return { changes: [{ trackId: track.id, notes: placeNote(track.notes, note) }], noteId: note.id };
}

/** 같은 트랙에서 note 뒤에 처음 오는 음 */
function nextInTrack(notes: readonly Note[], note: Note): Note | undefined {
  return [...notes].sort((a, b) => cmp(a.start, b.start)).find((n) => n.id !== note.id && cmp(n.start, note.start) > 0);
}

/**
 * 타브에서 음 길이를 바꾼다 (기타 프로처럼 커서 음의 길이를 고른 길이로).
 * 늘릴 때는 같은 트랙의 다음 음 앞까지만 늘려, 뒤 음을 지우지 않는다
 */
export function setTabNoteLength(song: Song, note: Note, dur: Rat): TabEdit {
  const track = song.tracks.find((t) => t.notes.some((n) => n.id === note.id));
  if (!track) return { changes: [], noteId: undefined };
  const next = nextInTrack(track.notes, note);
  const room = next ? sub(next.start, note.start) : undefined;
  const len = room && cmp(dur, room) > 0 ? room : dur;
  if (cmp(len, note.dur) === 0) return { changes: [], noteId: note.id };
  return { changes: [{ trackId: track.id, notes: placeNote(track.notes, { ...note, dur: len }) }], noteId: note.id };
}

/**
 * 타브의 & 잇기. 바로 뒤에 음이 붙어 있으면 그 음과 잇거나 풀고(다른 높이면 슬라이드),
 * 뒤가 비어 있으면(쉼표) 같은 높이 음을 dur만큼 더해 이어 울린다 — 기타 프로의 붙임줄(Tie)·
 * MuseScore 입력 중 +와 같다. 빈자리보다 길면 다음 음 앞까지만 넣는다.
 * noteId는 더한 음(커서를 그 뒤로 옮길 때 쓴다)
 */
export function tieTabNote(song: Song, note: Note, dur: Rat): TabEdit {
  const track = song.tracks.find((t) => t.notes.some((n) => n.id === note.id));
  if (!track) return { changes: [], noteId: undefined };
  const end = add(note.start, note.dur);
  const next = nextInTrack(track.notes, note);
  if (note.tie === "next" || (next && cmp(next.start, end) <= 0)) {
    const notes = toggleTie(track.notes, note.id);
    return notes ? { changes: [{ trackId: track.id, notes }], noteId: undefined } : { changes: [], noteId: undefined };
  }
  const room = next ? sub(next.start, end) : undefined;
  const added: Note = {
    id: `${track.id}.tab${Date.now().toString(36)}`,
    start: end,
    dur: room && cmp(dur, room) > 0 ? room : dur,
    pitch: note.pitch,
    vol: note.vol,
    tie: "none",
  };
  const notes = placeNote(
    track.notes.map((n) => (n.id === note.id ? { ...n, tie: "next" as const } : n)),
    added,
  );
  return { changes: [{ trackId: track.id, notes }], noteId: added.id };
}

/** 타브에서 고른 음을 지운다 */
export function removeTabNote(song: Song, note: Note): TabEdit {
  const track = song.tracks.find((t) => t.notes.some((n) => n.id === note.id));
  if (!track) return { changes: [], noteId: undefined };
  return { changes: [{ trackId: track.id, notes: removeNotes(track.notes, new Set([note.id])) }], noteId: undefined };
}

/**
 * 숫자 키로 프렛 입력: 바로 앞 숫자와 이어 두 자리가 되면(최대 프렛 이하) 두 자리로 본다.
 * 돌려주는 값은 이번에 칠 프렛과, 다음 숫자와 이어 볼 버퍼
 */
export function fretFromKeys(buffer: string, digit: string, maxFret: number): { fret: number; buffer: string } {
  const joined = buffer + digit;
  if (buffer && Number(joined) <= maxFret) return { fret: Number(joined), buffer: "" };
  // 한 자리로 치고, 두 자리가 될 수 있는 숫자(1, 2)만 다음 숫자를 기다린다
  const fret = Number(digit);
  return { fret, buffer: fret * 10 <= maxFret ? digit : "" };
}

/** 두 자리 프렛을 치는 중 첫 숫자로 만든(또는 바꾼) 음: 그 음 id와 친 자리·줄 */
export interface DigitNote {
  readonly id: string;
  readonly at: Rat;
  readonly string: number;
}

/**
 * 숫자 키 하나(fretFromKeys와 같은 규칙)와, 두 자리가 되면 바꿀 음 id. 두 자리는 첫 숫자로 만든 그 음(memo)을 바꾼다:
 * 커서 줄에서 다시 찾으면, 첫 숫자 음이 화음 배정으로 다른 줄에 그려졌을 때 못 찾아 음이 하나 더 생긴다.
 * 커서 자리·줄이 첫 숫자 때와 같을 때만 쓰고, 아니면(커서를 옮겼으면) 그 기억은 쓰지 않는다
 */
export function typeFretDigit(
  buffer: string,
  memo: DigitNote | undefined,
  digit: string,
  cursor: { readonly at: Rat; readonly string: number },
  maxFret: number,
): { fret: number; buffer: string; replaceId: string | undefined } {
  const same = !!memo && cmp(memo.at, cursor.at) === 0 && memo.string === cursor.string;
  // 첫 숫자 뒤 커서를 옮겼으면 앞 숫자와 잇지 않는다 (새 자리의 한 자리 숫자)
  const kept = memo && !same ? "" : buffer;
  const next = fretFromKeys(kept, digit, maxFret);
  const joined = kept !== "" && next.fret === Number(kept + digit);
  return { ...next, replaceId: joined && same ? memo!.id : undefined };
}
