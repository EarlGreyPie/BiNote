import { describe, expect, it } from "vitest";
import { HALF, positionToSeconds, rat, scaleFrom, secondsToWhole } from "../src/index.js";

describe("positionToSeconds", () => {
  it("템포가 없으면 t120", () => {
    // t120에서 4분음표 = 0.5초, 온음표 = 2초
    expect(positionToSeconds([], rat(1))).toBeCloseTo(2);
  });

  it("중간 템포 변화를 반영한다", () => {
    const tempo = [
      { at: rat(0), bpm: 120 },
      { at: rat(1), bpm: 60 },
    ];
    expect(positionToSeconds(tempo, rat(1))).toBeCloseTo(2);
    expect(positionToSeconds(tempo, rat(3, 2))).toBeCloseTo(4);
  });

  it("음 경계가 아닌 곳의 템포도 받아들인다", () => {
    const tempo = [{ at: rat(1, 3), bpm: 240 }];
    expect(positionToSeconds(tempo, rat(1))).toBeCloseTo((1 / 3) * 2 + (2 / 3) * 1);
  });

  it("템포 범위 변환: 템포 ½ + 음길이 숫자 ×2(l4→l8)는 같은 시간", () => {
    const fast = [{ at: rat(0), bpm: 288 }];
    const slow = [{ at: rat(0), bpm: 144 }];
    const end = rat(3, 4);
    expect(positionToSeconds(slow, scaleFrom(rat(0), end, HALF))).toBeCloseTo(
      positionToSeconds(fast, end),
    );
  });
});

describe("secondsToWhole", () => {
  it("positionToSeconds의 반대", () => {
    const tempo = [
      { at: rat(0), bpm: 120 },
      { at: rat(1), bpm: 60 },
    ];
    for (const pos of [rat(0), rat(1, 2), rat(1), rat(3, 2), rat(5, 2)]) {
      expect(secondsToWhole(tempo, positionToSeconds(tempo, pos))).toBeCloseTo(pos.n / pos.d);
    }
  });
});
