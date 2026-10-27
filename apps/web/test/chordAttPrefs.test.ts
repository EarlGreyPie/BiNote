import { describe, expect, it } from "vitest";
import { readChordAttPrefs } from "../src/lib/chordAttPrefs";

describe("화음 감쇠 창 설정 읽기", () => {
  it("창이 허용한 v0(가장 작게·기준)은 다시 열어도 v0", () => {
    const p = readChordAttPrefs({ floor: 0, useBase: true, base: 0 }, { min: 0, max: 15 });
    expect(p.floor).toBe(0);
    expect(p.base).toBe(0);
  });

  it("프로필 범위 밖 값은 그 범위로", () => {
    const p = readChordAttPrefs({ floor: -3, base: 40 }, { min: 0, max: 15 });
    expect(p.floor).toBe(0);
    expect(p.base).toBe(15);
  });
});
