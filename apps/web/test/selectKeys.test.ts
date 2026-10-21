import { describe, expect, it } from "vitest";
import { heldKeys, parseSelectKeys } from "../src/lib/selectKeys";

describe("고른 음 건반 불", () => {
  it("저장값이 없거나 모르는 값이면 기본 = 고른 동안", () => {
    expect(parseSelectKeys("")).toBe("select");
    expect(parseSelectKeys("x")).toBe("select");
    expect(parseSelectKeys("off")).toBe("off");
    expect(parseSelectKeys("press")).toBe("press");
  });

  it("끔이면 아무 건반도 안 켠다", () => {
    expect(heldKeys("off", 60, [62, 64], "#f00").size).toBe(0);
  });

  it("누르는 동안만: 누르고 있는 음만, 고른 음은 안 켠다", () => {
    expect([...heldKeys("press", 60, [62, 64], "#f00")]).toEqual([[60, "#f00"]]);
    expect(heldKeys("press", undefined, [62, 64], "#f00").size).toBe(0);
  });

  it("고른 동안: 고른 음 + 누르고 있는 음", () => {
    const lit = heldKeys("select", 67, [60, 64, 64], "#0af");
    expect([...lit.keys()].sort()).toEqual([60, 64, 67]);
    expect(lit.get(60)).toBe("#0af");
  });
});
