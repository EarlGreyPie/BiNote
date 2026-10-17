import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, rat, type Song, type Track } from "@mmlce/core";
import { parseTrackText } from "@mmlce/mml";
import { analyzeSong } from "../src/lib/analysis";
import { outputRows, previewRows, tempoAdvice } from "../src/lib/output";

function track(id: string, playerId: string, text: string): Track {
  return { id, playerId, name: id, color: "", role: "free", mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {} };
}

function song(tracks: Track[], tempo = [{ at: rat(0), bpm: 120 }]): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  return {
    ...base,
    tempo,
    players: [
      { id: "p1", name: "피아노", instrument: { canonical: "piano" } },
      { id: "p2", name: "오르골", instrument: { canonical: "music-box" } },
    ],
    tracks,
  };
}

describe("outputRows", () => {
  it("악보마다 한 줄: 악기 화음 수로 나누고, 트랙 글자 수와 넘침을 센다", () => {
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 20 };
    const s = song([track("a", "p1", "cdefgab>cdefgab>cdefgab"), track("b", "p1", "c1"), ...["x", "y", "z", "w"].map((id) => track(id, "p2", "c4"))]);
    const rows = outputRows(s, profile, analyzeSong(s, profile));
    const box = profile.instrumentMaxChords["music-box"]!;
    expect(rows[0]).toMatchObject({ number: 1, playerId: "p1", instrument: "piano", over: true });
    expect(rows[0]!.tracks.map((t) => t.over)).toEqual([true, false]);
    expect(rows[0]!.text.startsWith("MML@")).toBe(true);
    // 오르골 4트랙은 화음 수만큼 끊어 악보가 더 생긴다
    expect(box).toBeLessThan(4);
    expect(rows.slice(1).map((r) => r.tracks.length)).toEqual([box, 4 - box]);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(rows.slice(1).every((r) => r.instrument === "music-box" && !r.over)).toBe(true);
  });

  it("소리 없는 자리에 붙인 트랙이 글자 수를 넘으면 그 악보도 넘침으로 알린다 (beta.8 점검)", () => {
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 20 };
    const long = "cdefgab>cdefgab>cdefgab";
    const s = song(["x", "y", "z", "w"].map((id, k) => track(id, "p2", k === 0 ? long : "c4")));
    const rows = outputRows(s, profile, analyzeSong(s, profile));
    expect(rows.map((r) => [r.over, r.silentOver])).toEqual([
      [true, []],
      [true, ["x"]],
    ]);
  });
});

describe("tempoAdvice", () => {
  it("범위 밖 템포만: 빠르면 템포 반에 길이도 반(1/2, 1/4…), 느리면 그 반대", () => {
    const s = song([], [
      { at: rat(0), bpm: 300 },
      { at: rat(1), bpm: 120 },
      { at: rat(2), bpm: 601 },
      { at: rat(3), bpm: 20 },
    ]);
    const out = tempoAdvice(s, { min: 32, max: 255 });
    expect(out.map((a) => [a.bpm, a.high, a.factor, a.to, a.bar])).toEqual([
      [300, true, 2, 150, 1],
      [601, true, 4, 150, 3],
      [20, false, 2, 40, 4],
    ]);
    // 안내대로 바꾼 4분음표가 원래와 같은 초여야 한다 (초 = 길이 × 240 / 템포). 601→150은 반올림만큼만 다르다
    const seconds = (length: number, bpm: number) => (length * 240) / bpm;
    for (const a of out) {
      expect(seconds(0.25 * a.lengthScale, a.to)).toBeCloseTo(seconds(0.25, a.bpm), 2);
    }
    expect(out[0]!.lengthScale).toBe(0.5);
    expect(out[2]!.lengthScale).toBe(2);
  });
});

describe("previewRows", () => {
  it("바뀐 트랙과 한도를 넘는 트랙만 전후 글자 수로", () => {
    const before = song([track("a", "p1", "c4 c4 c4"), track("b", "p1", "d1"), track("c", "p1", "e1e1e1e1e1")]);
    // 첫 트랙 원문에도 템포를 적어 다른 트랙 글은 그대로 (원문에 템포가 없으면 원문 없는 다음 트랙이 템포를 받는다)
    const after: Song = { ...before, tracks: before.tracks.map((t) => (t.id === "a" ? { ...t, mml: { text: "t120ccc" } } : t)) };
    const rows = previewRows(before, after, 3);
    expect(rows.map((r) => [r.trackId, r.after])).toEqual([
      ["a", 7],
      ["c", rows.find((r) => r.trackId === "c")!.before],
    ]);
    expect(rows[0]!.before).toBeGreaterThan(3);
  });
});
