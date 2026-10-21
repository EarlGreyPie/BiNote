import { describe, expect, it } from "vitest";
import { rat, type Note, type Track } from "@mmlce/core";
import { tabArpPick } from "../src/lib/arpeggioOptions";

const n = (id: string, start: number, pitch: number): Note => ({ id, start: rat(start, 4), dur: rat(1, 4), pitch, vol: 8, tie: "none" });
const tr = (id: string, notes: Note[], playerId = "p1", mute = false): Track => ({ id, playerId, name: id, color: "", role: "free", mute, solo: false, notes, spelling: {} });

describe("타브 커서 자리 아르페지오 화음", () => {
  const song = { tracks: [tr("top", [n("t0", 0, 72), n("t1", 1, 74)]), tr("mid", [n("m1", 1, 67)]), tr("low", [n("l0", 0, 48), n("l2", 2, 50)]), tr("other", [n("o0", 0, 30)], "p2")] };

  it("고른 트랙에 그 자리 시작 음이 있으면 고른 트랙, 같은 악보 그 자리 음을 함께 넘긴다", () => {
    expect(tabArpPick(song, "low", rat(0))).toEqual({ trackId: "low", picked: [song.tracks[2]!.notes[0], song.tracks[0]!.notes[0]] });
  });
  it("없으면 그 자리 음이 있는 위쪽 트랙이 고른 트랙", () => {
    expect(tabArpPick(song, "low", rat(1, 4))).toEqual({ trackId: "top", picked: [song.tracks[0]!.notes[1], song.tracks[1]!.notes[0]] });
    expect(tabArpPick(song, "mid", rat(0))?.trackId).toBe("top");
  });
  it("소리 끈 다른 트랙 음은 넘기지 않는다", () => {
    const muted = { tracks: [tr("a", [n("a0", 0, 60)]), tr("b", [n("b0", 0, 64)], "p1", true)] };
    expect(tabArpPick(muted, "a", rat(0))?.picked.map((x) => x.id)).toEqual(["a0"]);
  });
  it("그 자리에서 시작하는 음이 없거나 커서가 없으면 undefined (다른 악보는 보지 않는다)", () => {
    expect(tabArpPick(song, "top", rat(3, 4))).toBeUndefined();
    expect(tabArpPick(song, "top", undefined)).toBeUndefined();
    expect(tabArpPick({ tracks: [tr("a", []), tr("b", [n("b0", 0, 60)], "p2")] }, "a", rat(0))).toBeUndefined();
  });
  it("타브에서 고른 음이 있으면 첫 고른 음의 트랙이 고른 트랙, 같은 악보에서 고른 음 전부 (다른 악보 음은 뺀다)", () => {
    const picked = tabArpPick(song, "top", rat(3, 4), [song.tracks[2]!.notes[1]!, song.tracks[0]!.notes[0]!, song.tracks[3]!.notes[0]!]);
    expect(picked).toEqual({ trackId: "low", picked: [song.tracks[0]!.notes[0], song.tracks[2]!.notes[1]] });
  });
});
