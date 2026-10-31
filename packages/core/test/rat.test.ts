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

  it("비교는 분모가 아주 커도 예외 없이 맞게 한다", () => {
    // 서로 다른 홀수 음길이 13개(l3 l5 … l43)를 이은 마지막 음의 시작. 격자 1/448과 비교하면 예전에는 RangeError가 났다
    const start = rat(169941130770676, 152125131763605);
    expect(cmp(start, rat(1, 448))).toBe(1);
    expect(cmp(rat(1, 448), start)).toBe(-1);
    expect(cmp(start, start)).toBe(0);
    // 교차곱이 2^53을 넘어도 1만큼 차이를 가린다
    const big = 2 ** 52 + 1;
    expect(cmp(rat(big, big - 2), rat(big + 2, big))).toBe(1);
    expect(cmp(rat(-big, big - 2), rat(-(big + 2), big))).toBe(-1);
  });

  it("덧셈은 중간 곱만 넘치고 약분하면 들어오는 값이면 맞게 센다", () => {
    // 1/(2A) + 1/(2B) = (A+B)/(2AB). 2AB는 2^53을 넘지만 A+B가 짝수라 2로 약분되면 안전 범위 안이다
    const A = 2 ** 26 - 1;
    const B = 2 ** 27 - 1;
    const sum = add(rat(1, 2 * A), rat(1, 2 * B));
    expect(BigInt(sum.n) * 2n * BigInt(A) * BigInt(B)).toBe(BigInt(A + B) * BigInt(sum.d));
    expect(sub(sum, rat(1, 2 * B))).toEqual(rat(1, 2 * A));
    // 약분해도 넘치면 조용히 틀리지 않고 그대로 멈춘다
    expect(() => add(rat(1, 2 ** 52 - 1), rat(1, 2 ** 52 - 3))).toThrow(RangeError);
  });

  it("곡 뒤쪽의 비슷한 두 위치를 빼도 곱의 반올림으로 틀리지 않는다", () => {
    // 176마디쯤의 두 위치. 분모는 안전 범위 안이지만 교차곱은 2^53을 넘고, 빼면 작은 값만 남는다
    const a = rat(1585, 9);
    const b = rat(3098981894998222, 17596742621441);
    // 정확한 값은 -13/158370683592969 (예전에는 곱이 반올림돼 -16/158370683592969가 조용히 나왔다)
    expect(sub(a, b)).toEqual(rat(-13, 158370683592969));
    expect(sub(b, a)).toEqual(rat(13, 158370683592969));
    expect(add(sub(a, b), b)).toEqual(a);
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
