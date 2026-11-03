import { describe, expect, it } from "vitest";
import { rat } from "@mmlce/core";
import { accidentalFor, typedAccidental } from "../src/lib/keyTyping";

describe("조표 맞춤 글 입력", () => {
  it("조 밖 제자리음만 조표 쪽으로", () => {
    expect(accidentalFor("f", 1)).toBe("+");
    expect(accidentalFor("c", 1)).toBe("");
    expect(accidentalFor("b", -1)).toBe("-");
    expect(accidentalFor("e", -3)).toBe("-");
    expect(accidentalFor("c", 0)).toBe("");
    expect(accidentalFor("c", 7)).toBe(""); // C#장조의 B#
    expect(accidentalFor("d", 7)).toBe("+");
    expect(accidentalFor("r", 1)).toBe("");
  });

  it("커서 자리의 곡 위치로 조표를 고른다 (곡 중간 조바꿈, 트랙 시작 자리)", () => {
    const keys = [{ at: rat(1), fifths: 1 }];
    expect(typedAccidental("l4cde", "f", undefined, keys)).toBe(""); // 3/4 자리: 다장조
    expect(typedAccidental("l4cdef", "f", undefined, keys)).toBe("+"); // 1 자리: G장조
    expect(typedAccidental("l4c", "f", rat(3, 4), keys)).toBe("+"); // 원문이 3/4에서 시작
  });

  it("주석 안에서는 붙이지 않는다", () => {
    expect(typedAccidental("l1c /* 후렴 ", "f", undefined, [{ at: rat(0), fifths: 1 }])).toBe("");
  });
});
