import { add, cmp, placeNote, removeNotes, type InstrumentRef, type Note, type Rat, type Song } from "@mmlce/core";
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
