import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, type Song } from "@mmlce/core";
import { addTrack, newSong, parseTrackText } from "@mmlce/mml";
import { defaultMergeRoles, defaultPriority, defaultSpreadSource, mergeGroups, parseMergeLevel, pitchLabel } from "../src/lib/chordTools";

/** 피아노 악보에 트랙 셋 (t1 길게, t2 짧게, t3 중간) */
function song(): Song {
  let s = newSong({ playerName: "피아노", trackName: "트랙 1" });
  s = addTrack("p1", "트랙 2").apply(s);
  s = addTrack("p1", "트랙 3").apply(s);
  const texts: Record<string, string> = { t1: "o5 l16 " + "cdefgab>c<".repeat(20), t2: "o3 c1", t3: "o4 c16 d8 e16 f8. g16 a8 b16 >c8." };
  // 원문 없이 음만 (출력기가 쓴 글로 센다)
  return { ...s, tracks: s.tracks.map(({ mml: _mml, ...t }) => ({ ...t, notes: parseTrackText(t.id, { text: texts[t.id]! }).notes })) };
}

describe("화음 분산·병합 창 처음 값", () => {
  it("보내는 트랙: 준 트랙, 아니면 한도를 넘는 트랙, 없으면 가장 긴 트랙 (잠근 트랙 빼고)", () => {
    const s = song();
    expect(defaultSpreadSource(s, 2400, new Set(), "t3")).toBe("t3");
    expect(defaultSpreadSource(s, 2400, new Set())).toBe("t1");
    expect(defaultSpreadSource(s, 12, new Set(["t1"]))).toBe("t3");
    expect(defaultSpreadSource(s, 2400, new Set(["t1", "t2", "t3"]))).toBeUndefined();
  });

  it("병합 묶음은 같은 악보·같은 악기 잠그지 않은 트랙 둘 이상, 처음엔 음이 가장 적은 트랙을 비운다", () => {
    const s = song();
    expect(mergeGroups(s, MOBILE_PROFILE, new Set())).toEqual([["t1", "t2", "t3"]]);
    expect(mergeGroups(s, MOBILE_PROFILE, new Set(["t1", "t2"]))).toEqual([]);
    expect(defaultMergeRoles(s, ["t1", "t2", "t3"])).toEqual({ t1: "keep", t2: "remove", t3: "keep" });
    expect(defaultPriority(s, ["t1", "t2"])).toBeUndefined();
    const marked = { ...s, tracks: s.tracks.map((t) => (t.id === "t3" ? { ...t, role: "melody" as const } : t)) };
    expect(defaultPriority(marked, ["t1", "t2", "t3"])).toBe("t3");
  });

  it("단계 기억값과 음 이름", () => {
    expect(parseMergeLevel(null)).toBe(1);
    expect(parseMergeLevel("3")).toBe(3);
    expect(parseMergeLevel("9")).toBe(1);
    expect(pitchLabel(60)).toBe("o4c");
    expect(pitchLabel(73)).toBe("o5c+");
  });
});
