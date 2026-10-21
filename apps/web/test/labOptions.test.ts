import { describe, expect, it } from "vitest";
import { DEFAULT_LAB_CHOICE, DEFAULT_REVERB_CHOICE, parseLabChoice, parseLevels, parseReverbChoice } from "../src/lib/labOptions";

describe("실험실 창 기억 값", () => {
  it("저장한 값을 읽고, 모르는 값은 기본으로", () => {
    expect(parseLabChoice({ ghostSteps: 6, harmonic: "artificial", harmonicQuieter: 0 })).toEqual({ ghostSteps: 6, harmonic: "artificial", harmonicQuieter: 0 });
    expect(parseLabChoice({ ghostSteps: 0, harmonic: "x", harmonicQuieter: 99 })).toEqual(DEFAULT_LAB_CHOICE);
    expect(parseLabChoice(undefined)).toEqual(DEFAULT_LAB_CHOICE);
  });
});

describe("울림 설정 기억 값", () => {
  it("v 순서 글은 공백·쉼표·-로 나누고, 1~최대 v·최대 개수만 받는다", () => {
    expect(parseLevels("6 3 2 1", 15, 8)).toEqual([6, 3, 2, 1]);
    expect(parseLevels("6-3-2-1", 15, 8)).toEqual([6, 3, 2, 1]);
    expect(parseLevels("3, 2,1", 15, 8)).toEqual([3, 2, 1]);
    expect(parseLevels("0 3", 15, 8)).toBeUndefined();
    expect(parseLevels("16", 15, 8)).toBeUndefined();
    expect(parseLevels("", 15, 8)).toBeUndefined();
    expect(parseLevels("1 1 1", 15, 2)).toBeUndefined();
  });

  it("저장한 값을 읽고, 모르는 값은 기본으로", () => {
    const saved = { levels: [3, 2, 1], piece: 16, keep: 8, minLength: 4, beforeRest: true, fill: true, fillLevel: 5, fillMaxNote: 16 };
    expect(parseReverbChoice(saved)).toEqual(saved);
    expect(parseReverbChoice({ levels: [0], piece: 3, keep: "4", fillLevel: 99 })).toEqual(DEFAULT_REVERB_CHOICE);
    expect(parseReverbChoice(undefined)).toEqual(DEFAULT_REVERB_CHOICE);
  });
});
