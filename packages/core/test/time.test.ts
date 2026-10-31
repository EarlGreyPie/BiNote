import { describe, expect, it } from "vitest";
import { cmp, DEFAULT_BPM, HALF, normalizeTempo, positionToSeconds, rat, scaleFrom, secondsToWhole, sub, tempoClock, toFloat, ZERO, type Rat, type TempoEvent } from "../src/index.js";

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

describe("tempoClock (점검 S35: 템포 누적 초 미리 계산)", () => {
  /** 예전 계산: 부를 때마다 지도를 정리하고 처음부터 훑어 더한다 (같은 값이 나와야 하는 기준) */
  const stepwise = (tempo: readonly TempoEvent[], pos: Rat) => {
    let seconds = 0;
    let cursor: Rat = ZERO;
    let bpm = DEFAULT_BPM;
    for (const e of normalizeTempo(tempo)) {
      if (cmp(e.at, pos) >= 0) break;
      seconds += toFloat(sub(e.at, cursor)) * (240 / bpm);
      cursor = e.at;
      bpm = e.bpm;
    }
    return seconds + toFloat(sub(pos, cursor)) * (240 / bpm);
  };

  it("하나씩 훑어 더한 값과 소수 끝자리까지 같다 (정렬 안 된 지도, 같은 자리 템포, 템포 자리 바로 그 위치)", () => {
    let x = 3;
    const next = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let round = 0; round < 50; round++) {
      const tempo = Array.from({ length: Math.floor(next() * 12) }, () => ({ at: rat(Math.floor(next() * 40), 6), bpm: 30 + Math.floor(next() * 300) }));
      const clock = tempoClock(tempo);
      const spots = [...tempo.map((e) => e.at), rat(0), rat(-1, 4), rat(25, 3)];
      for (let i = 0; i < 30; i++) spots.push(rat(Math.floor(next() * 300), [1, 7, 12, 64][i % 4]!));
      for (const pos of spots) {
        expect(clock(pos)).toBe(stepwise(tempo, pos));
        expect(positionToSeconds(tempo, pos)).toBe(stepwise(tempo, pos));
      }
    }
  });

  it("템포 자리에서는 아직 앞 템포로 센 초다 (그 자리부터 새 템포)", () => {
    const clock = tempoClock([{ at: rat(1), bpm: 60 }, { at: rat(0), bpm: 240 }]);
    expect(clock(rat(1))).toBe(1);
    expect(clock(rat(3, 2))).toBe(3);
    expect(tempoClock([])(rat(1))).toBe(2);
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
