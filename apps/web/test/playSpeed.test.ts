import { describe, expect, it } from "vitest";
import { parsePlaySpeed, PLAY_SPEEDS } from "../src/lib/playSpeed";

describe("일반 재생 속도 (점검 S24)", () => {
  it("50~100%만 두고, 기억한 값이 목록에 없거나 비었으면 원래 속도", () => {
    expect(Math.max(...PLAY_SPEEDS)).toBe(1);
    expect(Math.min(...PLAY_SPEEDS)).toBe(0.5);
    expect(parsePlaySpeed("0.75")).toBe(0.75);
    expect(parsePlaySpeed(null)).toBe(1);
    expect(parsePlaySpeed("0.3")).toBe(1);
    expect(parsePlaySpeed("abc")).toBe(1);
  });
});
