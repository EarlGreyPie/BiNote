import { describe, expect, it } from "vitest";
import { charLimitAt, emptySong, MOBILE_PROFILE, PC_NO_SONG_PROFILE, PC_PROFILE, rat, type Note, type Player, type Song, type Track } from "@mmlce/core";
import { gameChars, gamePaste, gameScores, padScore } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };

function notes(count: number): Note[] {
  return Array.from({ length: count }, (_, k) => ({ id: `n${k}`, start: rat(k, 4), dur: rat(1, 4), pitch: 60, vol: 8, tie: "none" as const }));
}

function track(id: string, n: number): Track {
  return { id, playerId: "p1", name: id, color: "#000", role: "free", mute: false, solo: false, notes: notes(n), spelling: {} };
}

function song(profileId: string): Song {
  return { ...emptySong({ title: "", author: "", profileId }), players: [piano], tracks: [track("a", 4), track("b", 4), track("c", 4)], tempo: [{ at: rat(0), bpm: 120 }] };
}

describe("붙여넣는 자리마다 글자 수 한도", () => {
  it("프로필: 목록 밖 자리와 목록 없는 게임은 트랙 한도", () => {
    expect([0, 1, 2, 3].map((k) => charLimitAt(PC_PROFILE, k))).toEqual([1200, 800, 500, 1200]);
    expect([0, 5].map((k) => charLimitAt(MOBILE_PROFILE, k))).toEqual([2400, 2400]);
    expect(PC_PROFILE.maxChordsPerPlayer).toBe(3);
    expect(PC_PROFILE.pending.map((p) => p.key)).toContain("trackCharLimits");
    // 노래 파트 제외: 한도만 크고 길이 셈은 PC와 같다
    expect([0, 1, 2].map((k) => charLimitAt(PC_NO_SONG_PROFILE, k))).toEqual([1600, 1200, 900]);
    expect(PC_NO_SONG_PROFILE.length).toEqual(PC_PROFILE.length);
  });

  it("PC 곡은 멜로디·화음1·화음2 자리 한도, 모바일 곡은 모두 같은 한도", () => {
    const pc = song("pc");
    expect(gameScores(pc, 3, 3, 1200)[0]!.texts.map((x) => x.limit)).toEqual([1200, 800, 500]);
    expect([...gameChars(pc, 3, 3, 1200).limits.values()]).toEqual([1200, 800, 500]);
    expect([...gamePaste(pc, ["a", "b", "c"], 3, 3, { tempo: true, order: ["c", "a", "b"] }).limits.entries()]).toEqual([
      ["c", 1200],
      ["a", 800],
      ["b", 500],
    ]);
    expect(gameScores(song("mobile"), 6, 6, 2400)[0]!.texts.map((x) => x.limit)).toEqual([2400, 2400, 2400]);
  });

  it("끝 채움은 글마다 그 자리 한도 안인 글에 붙인다", () => {
    // 첫 글(가장 멀리 가는 글)은 한도 3자라 못 붙이고, 둘째 글(한도 넉넉)에 붙인다
    const out = padScore(["c4", "c8"], rat(1, 2), 120, MOBILE_PROFILE.length, undefined, [3, 100]);
    expect(out[0]).toBe("c4");
    expect(out[1]).not.toBe("c8");
    expect(padScore(["c4", "c8"], rat(1, 2), 120, MOBILE_PROFILE.length, undefined, 100)[0]).not.toBe("c4");
  });
});
