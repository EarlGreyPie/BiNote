import { add, cmp, noteBefore, placeNote, rat, type GameProfile, type Note, type Rat, type Song } from "@mmlce/core";
import type { ScoreGroup } from "./scores";

/**
 * MIDI 건반으로 음 넣기(스텝 입력). 동시에 누른 건반은 화음 하나로 모아,
 * 높은 음부터 고른 트랙과 같은 악보의 다음 트랙들에 하나씩 넣는다(트랙은 한 번에 한 음).
 */

/** 건반 세기(1~127) → v. 재생에 쓰는 v→세기 곡선의 역방향으로 가장 가까운 v */
export function volumeForVelocity(profile: GameProfile, velocity: number): number {
  let best = profile.volume.max;
  let bestDiff = Infinity;
  for (let v = Math.max(1, profile.volume.min); v <= profile.volume.max; v++) {
    const db = profile.volumeCurve[v - profile.volume.min] ?? 0;
    const vel = 127 * 10 ** (db / 40);
    const diff = Math.abs(vel - velocity);
    if (diff < bestDiff) {
      best = v;
      bestDiff = diff;
    }
  }
  return best;
}

export interface ChordInput {
  readonly pitches: readonly number[];
  /** 가장 센 건반 세기 */
  readonly velocity: number;
}

/** 화음을 넣을 트랙들과 바뀐 음 목록. 트랙이 모자라면 남는 음은 버린다 */
export function placeChord(
  song: Song,
  groups: readonly ScoreGroup[],
  activeTrackId: string,
  at: Rat,
  dur: Rat,
  chord: ChordInput,
  volumeOf: (track: Note[] | readonly Note[], at: Rat, velocity: number) => number,
): { trackId: string; notes: Note[] }[] {
  const group = groups.find((g) => g.trackIds.includes(activeTrackId));
  const order = group ? group.trackIds.slice(group.trackIds.indexOf(activeTrackId)) : [activeTrackId];
  const pitches = [...new Set(chord.pitches)].sort((a, b) => b - a);
  const out: { trackId: string; notes: Note[] }[] = [];
  pitches.forEach((pitch, k) => {
    const trackId = order[k];
    const track = trackId ? song.tracks.find((t) => t.id === trackId) : undefined;
    if (!track) return;
    const note: Note = {
      id: `${track.id}.k${Date.now().toString(36)}${k}`,
      start: at,
      dur,
      pitch,
      vol: volumeOf(track.notes, at, chord.velocity),
      tie: "none",
    };
    out.push({ trackId: track.id, notes: placeNote(track.notes, note) });
  });
  return out;
}

/** 이 트랙에서 넣을 자리의 기본 v (세기를 쓰지 않을 때): 앞 음 v, 없으면 8 */
export function previousVolume(notes: readonly Note[], at: Rat): number {
  return noteBefore(notes, at)?.vol ?? 8;
}

/**
 * 음들 가운데 가장 늦게 끝나는 자리 (음이 없으면 0). 분수 그대로 더하고 견주어, 1/7 같은 길이도 반올림하지 않는다.
 * 커서 없이 MIDI 건반으로 넣을 때 "고른 트랙의 마지막 음 뒤" 자리로 쓴다 (MML 글 끝의 쉼표는 보지 않는다)
 */
export function notesEnd(notes: readonly Note[]): Rat {
  let end: Rat = rat(0);
  for (const n of notes) {
    const e = add(n.start, n.dur);
    if (cmp(e, end) > 0) end = e;
  }
  return end;
}

/** 다음 입력 자리 */
export function advance(at: Rat, dur: Rat): Rat {
  return add(at, dur);
}

/** Web MIDI 연결. 건반 이벤트를 넘기고, 끊을 함수를 돌려준다 */
export async function connectMidi(handlers: {
  onNoteOn: (pitch: number, velocity: number) => void;
  onNoteOff: (pitch: number) => void;
  onDevices: (names: string[]) => void;
}): Promise<() => void> {
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
  if (!nav.requestMIDIAccess) throw new Error("no-web-midi");
  const access = await nav.requestMIDIAccess();
  const listen = (e: MIDIMessageEvent) => {
    const data = e.data;
    if (!data || data.length < 3) return;
    const kind = data[0]! & 0xf0;
    if (kind === 0x90 && data[2]! > 0) handlers.onNoteOn(data[1]!, data[2]!);
    else if (kind === 0x80 || (kind === 0x90 && data[2] === 0)) handlers.onNoteOff(data[1]!);
  };
  const attach = () => {
    const names: string[] = [];
    access.inputs.forEach((input) => {
      input.onmidimessage = listen;
      names.push(input.name ?? "MIDI");
    });
    handlers.onDevices(names);
  };
  attach();
  access.onstatechange = attach;
  return () => {
    access.inputs.forEach((input) => (input.onmidimessage = null));
    access.onstatechange = null;
  };
}
