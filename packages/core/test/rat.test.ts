import { describe, expect, it } from "vitest";
import { add, cmp, div, eq, fromLength, mul, rat, sub, toFloat, ZERO } from "../src/index.js";

describe("rat", () => {
  it("항상 약분하고 분모를 양수로 둔다", () => {
    expect(rat(2, 4)).toEqual({ n: 1, d: 2 });
    expect(rat(3, -6)).toEqual({ n: -1, d: 2 });
    expect(rat(0, 5)).toBe(ZERO);
  });

  it("사칙연산", () => {
    expect(add(rat(1, 4), rat(1, 8))).toEqual(rat(3, 8));
    expect(sub(rat(1, 4), rat(1, 4))).toEqual(ZERO);
    expect(mul(rat(2, 3), rat(3, 4))).toEqual(rat(1, 2));
    expect(div(rat(1, 4), rat(1, 2))).toEqual(rat(1, 2));
    expect(cmp(rat(1, 3), rat(1, 4))).toBe(1);
  });

  it("안전한 정수 범위를 넘으면 조용히 틀리지 않고 멈춘다", () => {
    expect(() => mul(rat(2 ** 30), rat(2 ** 30))).toThrow(RangeError);
  });
});

describe("fromLength", () => {
  it("정규 음길이와 점", () => {
    expect(fromLength(4)).toEqual(rat(1, 4));
    expect(fromLength(4, 1)).toEqual(rat(3, 8));
    expect(fromLength(4, 2)).toEqual(rat(7, 16));
    expect(fromLength(64, 1)).toEqual(rat(3, 128));
    expect(fromLength(48, 1)).toEqual(rat(1, 32));
  });

  it("불규칙 음길이도 오차 없이 더해진다", () => {
    // l7 일곱 개 = 온음표 하나. 정수 tick(960)이면 반올림 때문에 어긋난다.
    let sum = ZERO;
    for (let i = 0; i < 7; i++) sum = add(sum, fromLength(7));
    expect(eq(sum, rat(1))).toBe(true);

    let sum37 = ZERO;
    for (let i = 0; i < 37; i++) sum37 = add(sum37, fromLength(37));
    expect(toFloat(sum37)).toBe(1);
  });

  it("잘못된 값은 거부한다", () => {
    expect(() => fromLength(0)).toThrow();
    expect(() => fromLength(4.5)).toThrow();
  });
});
