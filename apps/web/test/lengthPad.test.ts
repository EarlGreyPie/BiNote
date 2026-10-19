import { describe, expect, it } from "vitest";
import { padLengths, padPressed, parseAdvanceDir } from "../src/lib/lengthPad";
import { NOTE_LENGTHS } from "../src/lib/roll";

describe("음표 입력판", () => {
  it("셋잇단은 켰을 때만, 게임이 받는 길이만 둔다", () => {
    expect(padLengths(NOTE_LENGTHS, false)).toEqual(["grid", "1", "2", "4", "8", "16", "32", "64"]);
    expect(padLengths(NOTE_LENGTHS, true)).toEqual(["grid", "1", "2", "4", "8", "16", "32", "64", "12", "24", "48"]);
    expect(padLengths(["grid", "4", "8", "24"], true)).toEqual(["grid", "4", "8", "24"]);
  });
  it("점 붙은 새 음 길이는 점 없는 단추가 눌린 것으로 본다", () => {
    expect(padPressed("4", "4")).toBe(true);
    expect(padPressed("4", "4.")).toBe(true);
    expect(padPressed("4", "8")).toBe(false);
    expect(padPressed("grid", "grid")).toBe(true);
  });
  it("숫자 누른 뒤 방향은 저장값이 down일 때만 아래 줄", () => {
    expect(parseAdvanceDir("down")).toBe("down");
    expect(parseAdvanceDir("right")).toBe("right");
    expect(parseAdvanceDir(null)).toBe("right");
    expect(parseAdvanceDir("x")).toBe("right");
  });
});
