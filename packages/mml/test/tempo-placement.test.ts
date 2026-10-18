import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, rat } from "@mmlce/core";
import { canWriteExactly, lengthPieces, placeTempo, printMml, type PrintableNote } from "../src/index.js";

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
    expect(canWriteExactly(rat(17, 48), MOBILE_PROFILE.length)).toBe(true);   // l3 + l48
    expect(canWriteExactly(rat(113, 48), MOBILE_PROFILE.length)).toBe(true);  // l1 l1 + l3 + l48
    expect(canWriteExactly(rat(1, 240), MOBILE_PROFILE.length)).toBe(false);  // l64보다 짧음
  });
});

describe("음길이 한도를 받아 쓴다 (lengthPieces·printMml)", () => {
  it("지금 한도: 3/128은 64., 1/32는 32", () => {
    expect(lengthPieces(rat(3, 128), MOBILE_PROFILE.length)).toEqual(["64."]);
    expect(lengthPieces(rat(1, 32), MOBILE_PROFILE.length)).toEqual(["32"]);
  });

  it("가짜 한도(128, 점 둘)에서는 1/128과 7/512(128..)를 쓰고, 지금 한도로는 못 쓰며 진단이 나온다", () => {
    const wide = { min: 1, max: 128, dots: 2 };
    expect(lengthPieces(rat(1, 128), wide)).toEqual(["128"]);
    expect(lengthPieces(rat(7, 512), wide)).toEqual(["128.."]);
    expect(lengthPieces(rat(1, 128), MOBILE_PROFILE.length)).toBeUndefined();
    expect(lengthPieces(rat(7, 512), MOBILE_PROFILE.length)).toBeUndefined();
    const note = { start: rat(0), dur: rat(1, 128), pitch: 60, vol: 8, tie: "none" as const };
    expect(printMml([note]).diagnostics.map((d) => [d.code, d.params])).toEqual([["unrepresentable-length", { min: 1, max: 64 }]]);
    expect(printMml([note], { lengths: wide }).diagnostics).toEqual([]);
  });
});
