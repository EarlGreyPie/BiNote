import { describe, expect, it } from "vitest";
import { scoreTuningOf, shiftStrings, stringsLabel, tuningStrings, TUNINGS } from "../src/lib/tunings";

describe("튜닝 직접 입력", () => {
  it("부분 내슈빌 바리톤을 전체 반음 내리면 A♭ D♭ G♭ B E♭ A♭ (3·4번 줄은 한 옥타브 위 그대로)", () => {
    const down = shiftStrings(TUNINGS.nashvilleBaritone.strings, -1)!;
    expect(down).toEqual([56, 51, 59, 54, 37, 32]);
    expect(stringsLabel(down)).toBe("A♭1 D♭2 G♭3 B3 E♭3 A♭3");
  });

  it("한 줄이라도 MIDI 0~127을 넘으면 옮기지 않는다", () => {
    expect(shiftStrings([127, 60], 1)).toBeUndefined();
    expect(shiftStrings([0, 60], -1)).toBeUndefined();
    // o0c(12) 아래는 MML로 쓸 수 없다
    expect(shiftStrings([12, 60], -1)).toBeUndefined();
    expect(shiftStrings([13, 60], -1)).toEqual([12, 59]);
  });

  it("곡의 악보 튜닝을 읽는다: 직접 입력은 줄 높이가 맞을 때만, 모르는 이름은 없다", () => {
    expect(scoreTuningOf({ tuning: "custom", capo: 2, strings: [62, 57, 50] })).toEqual({ tuning: "custom", capo: 2, strings: [62, 57, 50] });
    expect(scoreTuningOf({ tuning: "custom", capo: 0 })).toBeUndefined();
    expect(scoreTuningOf({ tuning: "custom", capo: 0, strings: [200] })).toBeUndefined();
    expect(scoreTuningOf({ tuning: "weird", capo: 0 })).toBeUndefined();
    expect(scoreTuningOf({ tuning: "dropD", capo: 1, strings: [1, 2] })).toEqual({ tuning: "dropD", capo: 1 });
  });

  it("줄 높이: 이름 있는 튜닝은 프리셋, 직접 입력은 적힌 줄", () => {
    expect(tuningStrings({ tuning: "dropD", capo: 0 })).toEqual(TUNINGS.dropD.strings);
    expect(tuningStrings({ tuning: "custom", capo: 0, strings: [50, 45] })).toEqual([50, 45]);
  });
});
