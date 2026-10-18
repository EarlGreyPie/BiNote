import { describe, expect, it } from "vitest";
import { cmp, emptySong, MOBILE_PROFILE, rat, type Note, type Song } from "@mmlce/core";
import { notesEnd, placeChord, previousVolume, volumeForVelocity } from "../src/lib/midiInput";
import { scoreGroups } from "../src/lib/scores";

function song(n: number): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  return {
    ...base,
    players: [{ id: "p1", name: "", instrument: { canonical: "piano" } }],
    tracks: Array.from({ length: n }, (_, k) => ({ id: `t${k}`, playerId: "p1", name: "", color: "", role: "free" as const, mute: false, solo: false, notes: [], spelling: {} })),
  };
}

describe("MIDI 건반 입력", () => {
  it("세기 → v: 127은 15, 재생 곡선의 역방향", () => {
    expect(volumeForVelocity(MOBILE_PROFILE, 127)).toBe(15);
    expect(volumeForVelocity(MOBILE_PROFILE, Math.round((127 * 8) / 15))).toBe(8);
  });

  it("화음은 높은 음부터 고른 트랙과 같은 악보 다음 트랙에 하나씩, 트랙이 모자라면 버린다", () => {
    const s = song(3);
    const g = scoreGroups(s, 6);
    const out = placeChord(s, g, "t1", rat(0), rat(1, 4), { pitches: [60, 67, 64, 72], velocity: 100 }, (n, at) => previousVolume(n, at));
    expect(out.map((c) => [c.trackId, c.notes[0]!.pitch])).toEqual([["t1", 72], ["t2", 67]]);
  });
});

describe("커서 없이 넣는 자리: 마지막 음 뒤", () => {
  const note = (id: string, start: [number, number], dur: [number, number]): Note => ({ id, start: rat(...start), dur: rat(...dur), pitch: 60, vol: 8, tie: "none" });

  it("음이 없으면 0", () => {
    expect(cmp(notesEnd([]), rat(0))).toBe(0);
  });

  it("1/7 음 하나의 끝은 정확히 1/7 (137/960로 반올림하지 않는다)", () => {
    const end = notesEnd([note("a", [0, 1], [1, 7])]);
    expect(cmp(end, rat(1, 7))).toBe(0);
    expect(cmp(end, rat(137, 960))).not.toBe(0);
  });

  it("겹치거나 순서가 뒤섞인 음들 가운데 가장 늦은 끝", () => {
    const notes = [note("a", [1, 1], [1, 7]), note("b", [0, 1], [3, 2]), note("c", [1, 2], [1, 4])];
    expect(cmp(notesEnd(notes), rat(3, 2))).toBe(0);
    expect(cmp(notesEnd([note("a", [1, 1], [1, 3]), note("b", [1, 1], [1, 7])]), rat(4, 3))).toBe(0);
  });

  it("1/7 음 뒤에 화음을 넣어도 앞 음 길이는 1/7 그대로", () => {
    const base = song(1);
    const s: Song = { ...base, tracks: [{ ...base.tracks[0]!, notes: [note("a", [0, 1], [1, 7])] }] };
    const at = notesEnd(s.tracks[0]!.notes);
    const out = placeChord(s, scoreGroups(s, 6), "t0", at, rat(1, 8), { pitches: [64], velocity: 100 }, (n, w) => previousVolume(n, w));
    const notes = out[0]!.notes;
    expect(notes).toHaveLength(2);
    expect(cmp(notes[0]!.dur, rat(1, 7))).toBe(0);
    expect(cmp(notes[1]!.start, rat(1, 7))).toBe(0);
  });
});
