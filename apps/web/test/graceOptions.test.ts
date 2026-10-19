import { describe, expect, it } from "vitest";
import { DEFAULT_GRACE, formatGraceInput, parseGraceChoice, parseGraceInput } from "../src/lib/graceOptions";

describe("꾸밈음 창 저장값", () => {
  it("없거나 모르는 값이면 기본(2반음 아래 하나·l64·박 위에서·& 끔)", () => {
    expect(parseGraceChoice(undefined)).toEqual(DEFAULT_GRACE);
    expect(parseGraceChoice({ offsets: [1.5], length: "8", timing: "x", tie: "y" })).toEqual(DEFAULT_GRACE);
    expect(parseGraceChoice({ offsets: [] })).toEqual(DEFAULT_GRACE);
  });
  it("아는 값은 그대로", () => {
    const v = { offsets: [0, 2], length: "48", timing: "before", tie: true };
    expect(parseGraceChoice(v)).toEqual(v);
  });
});

describe("꾸밈음 높이 입력", () => {
  it("피아노롤: 반음 수 (+·- 붙여도 됨), 빈칸이나 쉼표로 나눔", () => {
    expect(parseGraceInput("-2 +1, 0")).toEqual([-2, 1, 0]);
    expect(parseGraceInput("")).toBeUndefined();
    expect(parseGraceInput("2a")).toBeUndefined();
    expect(parseGraceInput("49")).toBeUndefined();
  });
  it("타브: 본음 줄 프렛 번호 → 본음 프렛과의 차 (스크린샷: 본음 6프렛, 꾸밈음 6·8)", () => {
    expect(parseGraceInput("6 8", { fret: 6, maxFret: 24 })).toEqual([0, 2]);
    expect(parseGraceInput("-1", { fret: 6, maxFret: 24 })).toBeUndefined();
    expect(parseGraceInput("25", { fret: 6, maxFret: 24 })).toBeUndefined();
  });
  it("되돌려 쓰기: 타브 프렛이 줄 밖이면 undefined", () => {
    expect(formatGraceInput([-2, 1])).toBe("-2 +1");
    expect(formatGraceInput([0, 2], { fret: 6, maxFret: 24 })).toBe("6 8");
    expect(formatGraceInput([-2], { fret: 1, maxFret: 24 })).toBeUndefined();
  });
});
