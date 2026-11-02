import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, rat, type Note, type Song } from "@mmlce/core";
import { addTrack, newSong, printMml, setTrackNotes, setTracksNotes, setTrackText } from "@mmlce/mml";
import { newlyReprintedOutOfRange } from "../src/lib/writable";

const octave = MOBILE_PROFILE.octave;
const note = (id: string, start: [number, number], dur: [number, number], pitch: number): Note => ({ id, start: rat(...start), dur: rat(...dur), pitch, vol: 8, tie: "none" });
/** 트랙 두 개: t1은 원문 그대로(text), t2는 원문 없이 출력기가 쓰는 트랙 */
function song(text: string, t2: Note[] = []): Song {
  const s = addTrack("p1", "트랙 2").apply(newSong({ playerName: "피아노", trackName: "트랙 1" }));
  const withText = setTrackText("t1", text).apply(s);
  return { ...withText, tracks: withText.tracks.map((tr) => (tr.id === "t2" ? { ...tr, notes: t2 } : tr)) };
}
const track = (s: Song, id: string) => s.tracks.find((tr) => tr.id === id)!;

describe("원문을 잃어 다시 써지며 옥타브째 옮겨지는 음 알림 (newlyReprintedOutOfRange)", () => {
  it("원문에 o0보다 낮은 음이 있는 트랙을 고쳐 원문이 지워지면 그 트랙을 알린다", () => {
    const s = song("o0<c4d4o4c4");
    expect(track(s, "t1").mml).toBeDefined();
    expect(track(s, "t1").notes.map((n) => n.pitch)).toEqual([0, 2, 60]);
    // 마지막 음만 옮겨도 원문이 지워지고 출력기가 다시 쓴다
    const notes = track(s, "t1").notes;
    const edited = setTrackNotes("t1", [...notes.slice(0, 2), { ...notes[2]!, pitch: 62 }]).apply(s);
    expect(track(edited, "t1").mml).toBeUndefined();
    expect(newlyReprintedOutOfRange(s, edited, octave)).toEqual(["t1"]);
    // 출력기도 그 음을 옥타브째 옮겨 쓴다고 알린다 (같은 범위를 본다)
    expect(printMml(track(edited, "t1").notes, { octaves: octave }).diagnostics.some((d) => d.code === "pitch-unwritable")).toBe(true);
  });

  it("이미 다시 쓰는 트랙을 또 고치면 범위 밖 음이 그대로인 한 다시 알리지 않는다", () => {
    const s = song("o0<c4d4o4c4");
    const notes = track(s, "t1").notes;
    const once = setTrackNotes("t1", [...notes.slice(0, 2), { ...notes[2]!, pitch: 62 }]).apply(s);
    const twice = setTrackNotes("t1", track(once, "t1").notes.map((n) => (n.pitch === 62 ? { ...n, pitch: 64 } : n))).apply(once);
    expect(newlyReprintedOutOfRange(once, twice, octave)).toEqual([]);
    // 범위 밖 음의 길이를 바꿔도(같은 id·높이) 다시 알리지 않는다
    const moved = setTrackNotes("t1", track(once, "t1").notes.map((n) => (n.pitch === 0 ? { ...n, dur: rat(1, 8) } : n))).apply(once);
    expect(moved).not.toBe(once);
    expect(newlyReprintedOutOfRange(once, moved, octave)).toEqual([]);
    // id가 바뀌어도 높이·시작·길이가 같으면 전에 다시 쓰던 음이다
    const renamed = setTrackNotes("t1", track(once, "t1").notes.map((n) => ({ ...n, id: `${n.id}-new` }))).apply(once);
    expect(newlyReprintedOutOfRange(once, renamed, octave)).toEqual([]);
  });

  it("다른 트랙만 고치거나, 원문을 잃은 트랙에 범위 밖 음이 없으면 알리지 않는다", () => {
    const s = song("o0<c4d4", [note("x", [0, 1], [1, 4], 60)]);
    const other = setTrackNotes("t2", [note("x", [0, 1], [1, 4], 62)]).apply(s);
    expect(track(other, "t1").mml).toBeDefined();
    expect(newlyReprintedOutOfRange(s, other, octave)).toEqual([]);
    const plain = song("o4c4d4");
    const edited = setTrackNotes("t1", track(plain, "t1").notes.slice(0, 1)).apply(plain);
    expect(track(edited, "t1").mml).toBeUndefined();
    expect(newlyReprintedOutOfRange(plain, edited, octave)).toEqual([]);
    expect(newlyReprintedOutOfRange(s, s, octave)).toEqual([]);
  });

  it("o0c-(MIDI 11)는 출력기가 그대로 쓰므로 알리지 않는다", () => {
    const s = song("o0c-4o4c4");
    expect(track(s, "t1").notes[0]!.pitch).toBe(11);
    const edited = setTrackNotes("t1", track(s, "t1").notes.slice(0, 1)).apply(s);
    expect(newlyReprintedOutOfRange(s, edited, octave)).toEqual([]);
  });

  it("원문 트랙의 범위 밖 음을 원문 없는 트랙으로 옮기면 받은 트랙을 알린다", () => {
    const s = song("o0<c4", [note("x", [1, 4], [1, 4], 60)]);
    const low = track(s, "t1").notes[0]!;
    const across = setTracksNotes(
      [
        { trackId: "t1", notes: [] },
        { trackId: "t2", notes: [low, ...track(s, "t2").notes] },
      ],
      "옮기기",
    ).apply(s);
    expect(newlyReprintedOutOfRange(s, across, octave)).toEqual(["t2"]);
  });

  it("쓸 수 있는 옥타브는 게임 프로필에서 읽는다", () => {
    // o1~o8만 쓸 수 있는 프로필이면 o0g(MIDI 19)는 출력기가 옮겨 쓴다
    const s = song("o0g4o4c4");
    const edited = setTrackNotes("t1", track(s, "t1").notes.slice(0, 1)).apply(s);
    expect(newlyReprintedOutOfRange(s, edited, octave)).toEqual([]);
    expect(newlyReprintedOutOfRange(s, edited, { min: 1, max: 8 })).toEqual(["t1"]);
  });
});
