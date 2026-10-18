import { describe, expect, it } from "vitest";
import { DEFAULT_SLIDE, parseSlideChoice } from "../src/lib/slideOptions";

describe("슬라이드 창 저장값", () => {
  it("없거나 모르는 값이면 기본(두 음 사이·반음씩·아래 2반음·16분·자동 걸음)", () => {
    expect(parseSlideChoice(undefined)).toEqual(DEFAULT_SLIDE);
    expect(parseSlideChoice({ kind: "x", semitones: 13, length: "grid", step: "7" })).toEqual(DEFAULT_SLIDE);
  });
  it("아는 값은 그대로", () => {
    const v = { kind: "out", path: "direct", direction: "up", semitones: 5, length: "32.", step: "64" };
    expect(parseSlideChoice(v)).toEqual(v);
  });
});
