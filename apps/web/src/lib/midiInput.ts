import { add, cmp, noteBefore, placeNote, rat, type GameProfile, type Note, type Rat, type Song } from "@mmlce/core";
import type { ScoreGroup } from "./scores";

/**
 * MIDI 건반으로 음 넣기(스텝 입력). 동시에 누른 건반은 화음 하나로 모아,
 * 높은 음부터 고른 트랙과 같은 악보의 다음 트랙들에 하나씩 넣는다(트랙은 한 번에 한 음, 모자라면 트랙을 더한다).
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

/** 화음을 어디에 넣을지 */
export interface ChordPlan {
  /** 이미 있는 트랙과 바뀐 뒤 음 전체 */
  readonly changes: { trackId: string; notes: Note[] }[];
  /** 고른 트랙의 악보(연주자)에 더할 트랙마다 넣을 음 */
  readonly newTracks: Note[][];
  /** 악보 트랙 한도에 걸려 넣지 못한 음 수 */
  readonly dropped: number;
}

/**
 * 화음을 넣을 트랙을 고른다. 가장 높은 음은 고른 트랙에, 나머지는 높은 음부터 같은 악보의 다음 트랙들에 하나씩 (트랙은 한 번에 한 음).
 * 잠긴 트랙은 건너뛰고, 다음 트랙이 모자라면 악보 트랙이 maxTracks보다 적은 동안 트랙을 더해 넣는다
 * (고른 악보가 그 연주자의 마지막 악보일 때만: 앞 악보에 트랙을 더하면 뒤 악보로 넘어가서).
 * 예전에는 트랙을 더하지 않아, 트랙 하나인 악보에서는 화음의 가장 높은 음만 들어갔다
 */
export function placeChord(
  song: Song,
  groups: readonly ScoreGroup[],
  activeTrackId: string,
  at: Rat,
  dur: Rat,
  chord: ChordInput,
  volumeOf: (track: Note[] | readonly Note[], at: Rat, velocity: number) => number,
  maxTracks = Infinity,
  locked: ReadonlySet<string> = new Set(),
): ChordPlan {
  const active = song.tracks.find((t) => t.id === activeTrackId);
  if (!active) return { changes: [], newTracks: [], dropped: 0 };
  const group = groups.find((g) => g.trackIds.includes(activeTrackId));
  const after = group ? group.trackIds.slice(group.trackIds.indexOf(activeTrackId) + 1) : [];
  const order = [activeTrackId, ...after.filter((id) => !locked.has(id))];
  const lastOfPlayer = !group || groups.filter((g) => g.playerId === group.playerId).at(-1) === group;
  const room = lastOfPlayer ? Math.max(0, maxTracks - (group?.trackIds.length ?? 1)) : 0;
  const pitches = [...new Set(chord.pitches)].sort((a, b) => b - a);
  const stamp = Date.now().toString(36);
  const changes: { trackId: string; notes: Note[] }[] = [];
  const newTracks: Note[][] = [];
  let dropped = 0;
  pitches.forEach((pitch, k) => {
    const track = k < order.length ? song.tracks.find((t) => t.id === order[k]) : undefined;
    const base = track ?? active;
    const note: Note = {
      id: `${track ? track.id : `${active.playerId}.n${newTracks.length}`}.k${stamp}${k}`,
      start: at,
      dur,
      pitch,
      vol: volumeOf(base.notes, at, chord.velocity),
      tie: "none",
    };
    if (track) changes.push({ trackId: track.id, notes: placeNote(track.notes, note) });
    else if (k >= order.length && newTracks.length < room) newTracks.push([note]);
    else dropped++;
  });
  return { changes, newTracks, dropped };
}

/**
 * 동시에 누른 건반을 화음 하나로 모은다. 첫 건반부터 화음을 열고, 화음의 건반 하나를 떼는 순간 닫는다.
 * 그래서 건반을 조금씩 어긋나게 눌러도 다 누른 채로 떼면 화음 하나가 되고, 떼고 누르는 단음은 하나씩 들어간다.
 * 예전에는 첫 건반부터 60ms 안에 누른 건반만 모아, 손으로 누른 화음이 여러 음으로 나뉘어 차례로 들어갔다
 */
export class ChordCollector {
  private pending: { pitches: number[]; velocity: number } | undefined;

  /** 건반을 눌렀다 */
  down(pitch: number, velocity: number): void {
    if (!this.pending) this.pending = { pitches: [pitch], velocity };
    else if (!this.pending.pitches.includes(pitch))
      this.pending = { pitches: [...this.pending.pitches, pitch], velocity: Math.max(this.pending.velocity, velocity) };
  }

  /** 건반을 뗐다. 모으던 화음의 건반이면 그 화음을 돌려준다 */
  up(pitch: number): ChordInput | undefined {
    if (!this.pending?.pitches.includes(pitch)) return undefined;
    return this.take();
  }

  /** 모으던 화음을 지금 꺼낸다 (저장 직전 등) */
  take(): ChordInput | undefined {
    const chord = this.pending;
    this.pending = undefined;
    return chord;
  }
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
