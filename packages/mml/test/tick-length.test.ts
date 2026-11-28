import { describe, expect, it } from "vitest";
import { gameLengths, lengthTicks, MOBILE_PROFILE, noteLengthValue, rat, shortestLength, type LengthLimit, type Rat } from "@mmlce/core";
import { canWriteExactly, mabiiccoTicks, optimizeMml, parseMml, printMml, sameSound, type PrintableNote } from "../src/index.js";

/** 시험용 틱 모형 한도 (온음표 384틱, 내림): 마비꼬와 같은 셈 */
const TICKS: LengthLimit = { ...MOBILE_PROFILE.length, ticks: { perWhole: 384, rounding: "floor" } };
const tick = (n: number): Rat => rat(n, 384);

/** 틱 칸 위의 음들 (길이 틱 목록, 사이 쉼 틱 목록) */
function notesOf(durs: readonly number[], gaps: readonly number[] = [], pitch = 60): PrintableNote[] {
  const out: PrintableNote[] = [];
  let at = 0;
  durs.forEach((d, k) => {
    at += gaps[k] ?? 0;
    out.push({ start: tick(at), dur: tick(d), pitch: pitch + (k % 5), vol: 8, tie: "none" });
    at += d;
  });
  return out;
}

describe("길이 숫자의 값 (틱 모형)", () => {
  it("모형이 없으면 지금처럼 정확한 분수", () => {
    expect(noteLengthValue(5, 0, MOBILE_PROFILE.length)).toEqual(rat(1, 5));
    expect(noteLengthValue(7, 1, MOBILE_PROFILE.length)).toEqual(rat(3, 14));
    expect(noteLengthValue(5, 0)).toEqual(rat(1, 5));
  });

  it("틱 모형은 마비꼬가 읽는 틱과 같다 (N 1-64, 점 0-1)", () => {
    for (let n = 1; n <= 64; n++) {
      for (let dots = 0; dots <= 1; dots++) {
        expect(noteLengthValue(n, dots, TICKS)).toEqual(tick(mabiiccoTicks(n, dots)));
      }
    }
    expect([7, 19, 21, 9].map((n) => lengthTicks(n, 0, 384))).toEqual([54, 20, 18, 42]);
    expect(lengthTicks(19, 1, 384)).toBe(30);
    expect(lengthTicks(5, 1, 384)).toBe(114);
  });

  it("가장 짧은 한 토막은 l64 = 6틱, 표는 모형마다 따로 둔다", () => {
    expect(shortestLength(TICKS)).toEqual(tick(6));
    expect(gameLengths(TICKS).find((x) => x.length === 5 && x.dots === 0)!.value).toEqual(tick(76));
    expect(gameLengths(MOBILE_PROFILE.length).find((x) => x.length === 5 && x.dots === 0)!.value).toEqual(rat(1, 5));
  });

  it("6-22틱은 숫자 하나로, 5틱 이하는 쓸 수 없다", () => {
    for (let t = 6; t <= 22; t++) expect(canWriteExactly(tick(t), TICKS)).toBe(true);
    for (let t = 1; t <= 5; t++) expect(canWriteExactly(tick(t), TICKS)).toBe(false);
    // 정확한 분수 모형에서는 1/384 칸 값 대부분을 쓸 수 없다
    expect(canWriteExactly(tick(19), MOBILE_PROFILE.length)).toBe(false);
  });
});

describe("틱 모형으로 쓰고 다시 읽기", () => {
  it("같은 틱을 내는 숫자가 여럿이면 나누어떨어지는 쪽을 쓴다 (16틱 = l24, l23 아님)", () => {
    expect(printMml(notesOf([16]), { lengths: TICKS }).text).toBe("l24c");
    const many = notesOf([16, 16, 16, 32, 16, 16, 8, 16]);
    for (const text of [printMml(many, { lengths: TICKS }).text, optimizeMml(many, { lengths: TICKS }).text]) {
      expect(text).not.toMatch(/23/);
      expect(sameSound(parseMml(text, { lengths: TICKS }).notes, many)).toBe(true);
    }
  });

  it("4분 5잇단 (19·19·20·19·19틱)이 l20·l19로 쓰이고 그대로 읽힌다", () => {
    const notes = notesOf([19, 19, 20, 19, 19]);
    for (const text of [printMml(notes, { lengths: TICKS }).text, optimizeMml(notes, { lengths: TICKS }).text]) {
      expect(text).toMatch(/19/);
      expect(text).toMatch(/20/);
      expect(sameSound(parseMml(text, { lengths: TICKS }).notes, notes)).toBe(true);
    }
  });

  it("틱 칸의 무작위 곡 → 출력 → 다시 읽기 = 같은 틱", () => {
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 20; round++) {
      const durs = Array.from({ length: 40 }, () => 6 + next(200));
      const gaps = Array.from({ length: 40 }, () => (next(3) === 0 ? 6 + next(100) : 0));
      const notes = notesOf(durs, gaps);
      const printed = printMml(notes, { lengths: TICKS });
      expect(printed.diagnostics).toEqual([]);
      expect(sameSound(parseMml(printed.text, { lengths: TICKS }).notes, notes)).toBe(true);
      const optimized = optimizeMml(notes, { lengths: TICKS }).text;
      expect(sameSound(parseMml(optimized, { lengths: TICKS }).notes, notes)).toBe(true);
      expect(optimized.length).toBeLessThanOrEqual(printed.text.length);
    }
  });

  it("같은 글을 두 모형으로 읽으면 자리가 다르다 (l5 다섯 개: 정확하면 온음표, 틱이면 380틱)", () => {
    expect(parseMml("l5ccccc").end).toEqual(rat(1));
    expect(parseMml("l5ccccc", { lengths: TICKS }).end).toEqual(tick(380));
  });
});
