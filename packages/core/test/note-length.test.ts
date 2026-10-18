import { describe, expect, it } from "vitest";
import { gameLengths, isGameLength, MOBILE_PROFILE, noteLengthValue, rat, shortestLength } from "../src/index.js";

const now = MOBILE_PROFILE.length;

describe("음길이 한도 (GameProfile.length)", () => {
  it("지금 한도: 1~64 × 점 0~1 = 128개, 가장 짧은 값 1/64, 점 붙은 가장 짧은 값 64. = 3/128", () => {
    const all = gameLengths(now);
    expect(all).toHaveLength(128);
    expect(shortestLength(now)).toEqual(rat(1, 64));
    expect(all.find((x) => x.length === 64 && x.dots === 1)!.value).toEqual(rat(3, 128));
    expect(noteLengthValue(8, 2)).toEqual(rat(7, 32));
  });

  it("한도 안인지", () => {
    expect(isGameLength(now, 64, 1)).toBe(true);
    expect(isGameLength(now, 48, 1)).toBe(true);
    expect(isGameLength(now, 128, 0)).toBe(false);
    expect(isGameLength(now, 8, 2)).toBe(false);
  });

  it("한도만 바꾸면 따라온다 (가짜 한도 128분음표·점 둘)", () => {
    const wide = { min: 1, max: 128, dots: 2 };
    expect(gameLengths(wide)).toHaveLength(128 * 3);
    expect(shortestLength(wide)).toEqual(rat(1, 128));
  });
});
