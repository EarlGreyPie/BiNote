import { describe, expect, it } from "vitest";
import { parseTabPad } from "../src/lib/tabPad";

describe("보기 → 타브 숫자판 저장값", () => {
  it('"1"이면 켬, 없거나 모르는 값이면 끔', () => {
    expect(parseTabPad("1")).toBe(true);
    expect(parseTabPad("0")).toBe(false);
    expect(parseTabPad(null)).toBe(false);
    expect(parseTabPad("true")).toBe(false);
  });
});
