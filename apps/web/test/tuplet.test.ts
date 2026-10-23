import { describe, expect, it } from "vitest";
import { defaultLengthLimit, rat } from "@mmlce/core";
import { ARP_LENGTHS } from "../src/lib/arpeggioOptions";
import { exactTime, lengthsFor, noteLengthOf } from "../src/lib/roll";
import { DEFAULT_TUPLET, gridDivisions, isGameLengthName, isGridDivision, parseTuplet, stepGrid, tupletFits, tupletGrid, tupletName, tupletValue, withLengths } from "../src/lib/tuplet";

const limit = defaultLengthLimit();

describe("잇단음", () => {
  it("N개를 바탕 음표 시간에: 길이 숫자는 바탕×N, 점 바탕이면 점이 붙는다", () => {
    expect(tupletName({ count: 5, base: 4, dotted: false })).toBe("20");
    expect(tupletName({ count: 7, base: 4, dotted: false })).toBe("28");
    expect(tupletName({ count: 5, base: 2, dotted: false })).toBe("10");
    expect(tupletName({ count: 2, base: 4, dotted: true })).toBe("8.");
    expect(tupletName({ count: 5, base: 4, dotted: true })).toBe("20.");
  });

  it("N개를 모으면 바탕 음표 길이와 정확히 같다 (분수, 반올림 없음)", () => {
    for (const tp of [{ count: 5, base: 4, dotted: false }, { count: 7, base: 8, dotted: false }, { count: 5, base: 4, dotted: true }]) {
      const v = tupletValue(tp);
      const base = tp.dotted ? rat(3, 2 * tp.base) : rat(1, tp.base);
      expect(v.n * tp.count * base.d).toBe(base.n * v.d);
      expect(noteLengthOf(tupletName(tp), 16)).toEqual(v);
    }
  });

  it("게임 한도(1~64)를 넘는 조합은 쓸 수 없다", () => {
    expect(tupletFits({ count: 5, base: 8, dotted: false }, limit)).toBe(true); // l40
    expect(tupletFits({ count: 5, base: 16, dotted: false }, limit)).toBe(false); // l80
    expect(tupletFits({ count: 15, base: 4, dotted: true }, limit)).toBe(true); // l60.
    expect(tupletFits({ count: 9, base: 8, dotted: true }, limit)).toBe(false); // l72.
  });

  it("격자는 음 하나 길이의 분모: 잇단음 음이 모두 칸에 맞는다", () => {
    expect(tupletGrid({ count: 5, base: 4, dotted: false })).toBe(20);
    expect(tupletGrid({ count: 2, base: 4, dotted: true })).toBe(16);
    expect(tupletGrid({ count: 3, base: 4, dotted: true })).toBe(8);
    expect(tupletGrid({ count: 5, base: 4, dotted: true })).toBe(40);
  });

  it("저장값이 깨졌으면 4분 5잇단", () => {
    expect(parseTuplet(undefined)).toEqual(DEFAULT_TUPLET);
    expect(parseTuplet({ count: 1, base: 4 })).toEqual(DEFAULT_TUPLET);
    expect(parseTuplet({ count: 7, base: 3 })).toEqual(DEFAULT_TUPLET);
    expect(parseTuplet({ count: 7, base: 8, dotted: true })).toEqual({ count: 7, base: 8, dotted: true });
  });

  it("게임이 받는 한 토막 표기만 길이로 본다", () => {
    expect(isGameLengthName("20", limit)).toBe(true);
    expect(isGameLengthName("20.", limit)).toBe(true);
    expect(isGameLengthName("80", limit)).toBe(false);
    expect(isGameLengthName("20..", limit)).toBe(false);
    expect(isGameLengthName("grid", limit)).toBe(false);
  });

  it("길이 목록에 끼우기: 끝에 붙이거나 길이 순 제자리에, 겹치거나 못 쓰는 길이는 빼고", () => {
    expect(withLengths(["grid", "4", "8"], ["20", "4", "80"], limit)).toEqual(["grid", "4", "8", "20"]);
    const arp = withLengths(lengthsFor(limit, ARP_LENGTHS), ["20"], limit, true);
    expect(arp.indexOf("20")).toBe(arp.indexOf("16") + 1);
    expect(arp.indexOf("20")).toBe(arp.indexOf("32.") - 1);
  });

  it("격자 목록에 잇단음 칸을 작은 수부터 끼운다", () => {
    expect(gridDivisions([1, 4, 16, 64], [20, 128, 16, 999, 40], limit)).toEqual([1, 4, 16, 20, 40, 64]);
  });

  it("격자 칸 하나는 게임이 받는 한 토막이어야 한다 (1/128 칸 음은 MML에 쓸 수 없다)", () => {
    expect(isGridDivision(64, limit)).toBe(true);
    expect(isGridDivision(28, limit)).toBe(true);
    expect(isGridDivision(128, limit)).toBe(false);
    expect(isGridDivision(tupletGrid({ count: 5, base: 8, dotted: true }), limit)).toBe(false); // l40. → 1/80
  });

  it("화면 위치를 분수로: 격자 칸 위면 그 칸 그대로, 아니면 1/960 칸", () => {
    expect(exactTime(1 / 28, 28)).toEqual(rat(1, 28));
    expect(exactTime(37 / 28, 28)).toEqual(rat(37, 28));
    expect(exactTime(3 / 20, 20)).toEqual(rat(3, 20));
    expect(exactTime(0.5, 16)).toEqual(rat(1, 2));
    expect(exactTime(1 / 28, 16)).toEqual(rat(34, 960));
    expect(exactTime(-0.001, 16)).toEqual(rat(0));
  });
});

describe("격자 ×2·½", () => {
  it("칸을 두 배·반으로, 셋잇단은 셋잇단끼리", () => {
    expect(stepGrid(16, "double", limit)).toBe(8);
    expect(stepGrid(16, "half", limit)).toBe(32);
    expect(stepGrid(24, "double", limit)).toBe(12);
    expect(stepGrid(24, "half", limit)).toBe(48);
    expect(stepGrid(20, "double", limit)).toBe(10);
  });
  it("1/1보다 크게, 정수 분모가 아니게, 게임 최단 칸보다 잘게는 바꾸지 않는다", () => {
    expect(stepGrid(1, "double", limit)).toBeUndefined();
    expect(stepGrid(3, "double", limit)).toBeUndefined();
    expect(stepGrid(64, "half", limit)).toBeUndefined();
    expect(stepGrid(48, "half", limit)).toBeUndefined();
  });
});
