import { describe, expect, it } from "vitest";
import { emptySong, type Song } from "@mmlce/core";
import { chainVolumes, melodyTrackIds, peakPolyphony, scoreGroups, soundingAt, trackColors, visibleTrackIds } from "../src/lib/scores";

function song(counts: number[]): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  const players = counts.map((_, i) => ({ id: `p${i}`, name: `P${i}`, instrument: { canonical: "piano" } }));
  const tracks = counts.flatMap((n, i) =>
    Array.from({ length: n }, (_, k) => ({ id: `p${i}t${k}`, playerId: `p${i}`, name: "", color: "", role: "free" as const, mute: false, solo: false, notes: [], spelling: {} })),
  );
  return { ...base, players, tracks };
}

describe("scoreGroups", () => {
  it("연주자마다 6트랙씩 끊어 악보 번호를 차례로 매긴다", () => {
    const g = scoreGroups(song([8, 3]), 6);
    expect(g.map((x) => [x.number, x.playerId, x.trackIds.length])).toEqual([
      [1, "p0", 6],
      [2, "p0", 2],
      [3, "p1", 3],
    ]);
  });

  it("오르골처럼 화음 수가 적은 악기는 그만큼씩 끊는다 (6트랙 = 3+3)", () => {
    const g = scoreGroups(song([6, 6]), (id) => (id === "p0" ? 3 : 6));
    expect(g.map((x) => [x.playerId, x.trackIds.length])).toEqual([["p0", 3], ["p0", 3], ["p1", 6]]);
  });

  it("보기에 따라 보여 줄 트랙", () => {
    const s = song([8, 3]);
    const g = scoreGroups(s, 6);
    expect(visibleTrackIds(s, g, { kind: "all" }, undefined)).toHaveLength(11);
    expect(visibleTrackIds(s, g, { kind: "score", number: 2 }, undefined)).toEqual(["p0t6", "p0t7"]);
    expect(visibleTrackIds(s, g, { kind: "track" }, "p1t2")).toEqual(["p1t2"]);
    expect(visibleTrackIds(s, g, { kind: "score", number: 9 }, undefined)).toHaveLength(11);
  });
});

describe("멜로디 트랙", () => {
  it("표시가 없으면 악보마다 첫 트랙, 표시하면 그 트랙, 첫 트랙에 다른 역할을 주면 빠진다", () => {
    const s = song([8, 3]);
    const g = scoreGroups(s, 6);
    expect([...melodyTrackIds(s, g)]).toEqual(["p0t0", "p0t6", "p1t0"]);
    const marked: Song = { ...s, tracks: s.tracks.map((t) => (t.id === "p0t2" ? { ...t, role: "melody" } : t.id === "p1t0" ? { ...t, role: "harmony" } : t)) };
    expect([...melodyTrackIds(marked, g)]).toEqual(["p0t2", "p0t6"]);
  });
});

describe("trackColors", () => {
  it("위치 방식은 어느 악보든 같은 자리면 같은 색, 악보 방식은 악보마다 다른 색", () => {
    const s = song([8, 3]);
    const g = scoreGroups(s, 6);
    const pos = trackColors(s, g, "position");
    expect(pos.get("p0t0")).toBe(pos.get("p0t6"));
    expect(pos.get("p0t0")).toBe(pos.get("p1t0"));
    expect(pos.get("p0t0")).not.toBe(pos.get("p0t1"));
    const byScore = trackColors(s, g, "score");
    expect(byScore.get("p0t0")).not.toBe(byScore.get("p0t6"));
    expect(byScore.get("p0t0")!.startsWith("hsl(218")).toBe(true);
    expect(trackColors(s, g, "stored").get("p0t0")).toBe("");
  });

  it("어두운 테마는 따로 고른 색, 악보 방식 6트랙은 색조가 서로 다르다", () => {
    const s = song([6]);
    const g = scoreGroups(s, 6);
    expect(trackColors(s, g, "position", "dark").get("p0t0")).not.toBe(trackColors(s, g, "position", "light").get("p0t0"));
    const hues = [...trackColors(s, g, "score", "dark").values()].map((c) => c.split(" ")[0]);
    expect(new Set(hues).size).toBe(6);
  });
});

describe("동시발음", () => {
  it("지금 울리는 음 수와 곡 전체 최대", () => {
    const s = song([2]);
    const note = (start: number, dur: number) => ({ id: `n${start}`, start: { n: start * 4, d: 4 }, dur: { n: dur * 4, d: 4 }, pitch: 60, vol: 8, tie: "none" as const });
    const tracks = [
      { ...s.tracks[0]!, notes: [note(0, 1), note(1, 1)] },
      { ...s.tracks[1]!, notes: [note(0.5, 1)] },
    ];
    const t = { ...s, tracks };
    expect(soundingAt(t, 0.75)).toBe(2);
    expect(soundingAt(t, 1.6)).toBe(1);
    expect(peakPolyphony(t)).toEqual({ count: 2, at: 0.5 });
  });

  it("&로 이은 뒤 조각의 v0은 소리를 끊지 않는다 (첫 음 볼륨으로 이어 감)", () => {
    const s = song([1]);
    const a = { id: "a", start: { n: 0, d: 1 }, dur: { n: 1, d: 4 }, pitch: 60, vol: 15, tie: "next" as const };
    const b = { id: "b", start: { n: 1, d: 4 }, dur: { n: 1, d: 4 }, pitch: 60, vol: 0, tie: "none" as const };
    const t = { ...s, tracks: [{ ...s.tracks[0]!, notes: [a, b] }] };
    expect(soundingAt(t, 0.3)).toBe(1);
  });

  it("세잇단처럼 나누어떨어지지 않는 경계에서도 이어지는 음을 겹쳐 세지 않는다", () => {
    const s = song([1]);
    const third = (k: number) => ({ id: `n${k}`, start: { n: k, d: 3 }, dur: { n: 1, d: 3 }, pitch: 60, vol: 8, tie: "none" as const });
    const t = { ...s, tracks: [{ ...s.tracks[0]!, notes: [third(0), third(1), third(2)] }] };
    expect(peakPolyphony(t).count).toBe(1);
  });
});

describe("chainVolumes", () => {
  it("&로 이은 사슬은 첫 음 v, 끊기면 그 음 v", () => {
    const n = (id: string, start: number, vol: number, tie: "next" | "none") => ({ id, start: { n: start, d: 4 }, dur: { n: 1, d: 4 }, pitch: 60, vol, tie });
    const v = chainVolumes([n("a", 0, 0, "next"), n("b", 1, 12, "next"), n("c", 2, 9, "none"), n("d", 3, 9, "none")]);
    expect([...["a", "b", "c", "d"].map((id) => v.get(id))]).toEqual([0, 0, 0, 9]);
  });
});
