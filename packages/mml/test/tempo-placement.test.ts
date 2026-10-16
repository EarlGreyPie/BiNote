import { describe, expect, it } from "vitest";
import { rat } from "@mmlce/core";
import { canWriteExactly, placeTempo, type PrintableNote } from "../src/index.js";

const note = (start: [number, number], dur: [number, number]): PrintableNote => ({
  start: rat(...start), dur: rat(...dur), pitch: 60, vol: 8, tie: "none",
});

describe("placeTempo", () => {
  it("음을 쪼개지 않는 채널에 템포를 넣는다", () => {
    const a = [note([0, 1], [1, 1])];                       // 온음표 하나
    const b = [note([0, 1], [1, 2]), note([1, 2], [1, 2])]; // 2분음표 둘
    const placed = placeTempo([a, b], [{ at: rat(1, 2), bpm: 90 }]);
    expect(placed).toEqual([[], [{ at: rat(1, 2), bpm: 90 }]]);
  });

  it("쓸 수 있는 채널이 없으면 첫 채널", () => {
    const a = [note([0, 1], [1, 1])];
    expect(placeTempo([a], [{ at: rat(1, 3), bpm: 90 }])[0]).toHaveLength(1);
  });
});

describe("canWriteExactly", () => {
  it("1~64와 점 토막 조합으로 쓸 수 있는지", () => {
    expect(canWriteExactly(rat(17, 48))).toBe(true);   // l3 + l48
    expect(canWriteExactly(rat(113, 48))).toBe(true);  // l1 l1 + l3 + l48
    expect(canWriteExactly(rat(1, 240))).toBe(false);  // l64보다 짧음
  });
});
