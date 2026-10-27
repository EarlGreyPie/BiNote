import { describe, expect, it } from "vitest";
import { rat, staffBars, staffTrack, type Note } from "@mmlce/core";
import { barIndexAt, barOffsets, barWidths, timeToX, visibleBars, xToTime } from "../src/lib/staffLayout";

const note = (s: number, d: number, pitch = 60): Note => ({ id: `n${s}`, start: rat(s * 16, 16), dur: rat(d * 16, 16), pitch, vol: 8, tie: "none" });

describe("오선보 자리 잡기", () => {
  const notes = [note(0, 0.25), note(0.25, 0.25), note(1, 1), note(2.5, 0.5)];
  const bars = staffBars({ tracks: [{ notes } as never], timeSig: [], tempo: [] });
  const tracks = [staffTrack(notes, bars, { min: 0, max: 15 })];

  it("음이 많은 마디가 넓고, 배율을 키우면 넓어진다. 자리는 폭을 이어 붙인 것", () => {
    const w = barWidths(bars, tracks, 1);
    expect(w).toHaveLength(3);
    // 첫 마디는 박자표·템포 자리가 더 든다
    expect(w[0]).toBeGreaterThan(w[1]!);
    expect(barWidths(bars, tracks, 2)[2]).toBeGreaterThanOrEqual(w[2]!);
    expect(barOffsets([10, 20, 30])).toEqual([0, 10, 30, 60]);
  });

  it("보이는 마디만 고른다 (앞뒤 여유 마디 포함)", () => {
    const offsets = barOffsets([100, 100, 100, 100, 100]);
    expect(visibleBars(offsets, 150, 100, 0)).toEqual([1, 2]);
    expect(visibleBars(offsets, 150, 100)).toEqual([0, 3]);
    expect(visibleBars(offsets, 0, 1000, 0)).toEqual([0, 4]);
    expect(visibleBars([0], 0, 100)).toBeUndefined();
  });

  it("시간 ↔ x: 그린 음 자리 사이를 잇고, 안 그린 마디는 고르게. 서로 거꾸로", () => {
    const offsets = barOffsets([100, 100, 100]);
    const anchors = new Map([[0, [{ at: 0, x: 30 }, { at: 0.5, x: 60 }]]]);
    expect(barIndexAt(bars, 1.2)).toBe(1);
    expect(timeToX(bars, offsets, anchors, 0)).toBe(30);
    expect(timeToX(bars, offsets, anchors, 0.25)).toBe(45);
    expect(timeToX(bars, offsets, anchors, 1.5)).toBe(150);
    for (const at of [0.1, 0.4, 0.75, 1.3, 2.9]) expect(xToTime(bars, offsets, anchors, timeToX(bars, offsets, anchors, at))).toBeCloseTo(at, 9);
  });
});
