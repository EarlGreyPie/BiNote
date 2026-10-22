import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, rat, type Song, type Track } from "@mmlce/core";
import { parseTrackText } from "@mmlce/mml";
import { analyzeSong } from "../src/lib/analysis";
import { isCopied, nextExportPick, outputRows, previewRows, tempoAdvice, trackStamp } from "../src/lib/output";

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

describe("MML로 내보내기: 다음에 복사할 트랙", () => {
  const scores = [{ trackIds: ["a1", "a2", "a3", "a4", "a5", "a6"] }, { trackIds: ["b1", "b2", "b3", "b4", "b5", "b6"] }];

  it("처음엔 첫 악보만 (손대지 않은 악보는 섞지 않는다)", () => {
    expect(nextExportPick(scores, () => false, 6)).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
    const small = [{ trackIds: ["a1", "a2"] }, { trackIds: ["b1"] }];
    expect(nextExportPick(small, () => false, 6)).toEqual(["a1", "a2"]);
  });

  it("두 악보에서 일부씩 복사했으면 남은 트랙을 함께 고른다", () => {
    const done = new Set(["a1", "a2", "a3", "b1", "b3", "b6"]);
    expect(nextExportPick(scores, (id) => done.has(id), 6)).toEqual(["a4", "a5", "a6", "b2", "b4", "b5"]);
  });

  it("한도를 넘는 악보 나머지는 더하지 않고, 다 복사했으면 빈 목록", () => {
    const done = new Set(["a1", "b1"]);
    expect(nextExportPick(scores, (id) => done.has(id), 6)).toEqual(["a2", "a3", "a4", "a5", "a6"]);
    expect(nextExportPick(scores, () => true, 6)).toEqual([]);
  });

  it("복사 뒤 트랙을 고치면 복사됨이 풀린다", () => {
    const s = song([track("a", "p1", "c4"), track("b", "p1", "d4")]);
    const copied = new Map([["a", trackStamp(s, s.tracks[0]!)]]);
    expect(isCopied(s, copied, "a")).toBe(true);
    expect(isCopied(s, copied, "b")).toBe(false);
    const edited = { ...s, tracks: [track("a", "p1", "c8"), s.tracks[1]!] };
    expect(isCopied(edited, copied, "a")).toBe(false);
    // 같은 음으로 다시 만든 트랙(실행 취소 등)은 복사됨 그대로
    expect(isCopied({ ...s, tracks: [track("a", "p1", "c4"), s.tracks[1]!] }, copied, "a")).toBe(true);
  });

  it("복사 뒤 곡 템포를 바꾸면 복사됨이 풀린다 (템포를 넣어 복사한 글이 달라진다)", () => {
    const s = song([track("a", "p1", "c4")]);
    const copied = new Map([["a", trackStamp(s, s.tracks[0]!)]]);
    expect(isCopied(s, copied, "a")).toBe(true);
    expect(isCopied({ ...s, tempo: [{ at: rat(0), bpm: 90 }] }, copied, "a")).toBe(false);
  });
});
