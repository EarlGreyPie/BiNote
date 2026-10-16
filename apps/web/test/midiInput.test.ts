import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, rat, type Song } from "@mmlce/core";
import { placeChord, previousVolume, volumeForVelocity } from "../src/lib/midiInput";
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
