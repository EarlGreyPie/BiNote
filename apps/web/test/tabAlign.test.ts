import { describe, expect, it } from "vitest";
import { nextTabAlign, parseTabAlign } from "../src/lib/tabAlign";

describe("타브 지판 세로 위치", () => {
  it("저장값을 읽고, 없거나 모르는 값이면 가운데", () => {
    expect(parseTabAlign("top")).toBe("top");
    expect(parseTabAlign("bottom")).toBe("bottom");
    expect(parseTabAlign(null)).toBe("middle");
    expect(parseTabAlign("left")).toBe("middle");
  });

  it("누를 때마다 위 → 가운데 → 아래 → 위", () => {
    expect([nextTabAlign("top"), nextTabAlign("middle"), nextTabAlign("bottom")]).toEqual(["middle", "bottom", "top"]);
  });
});
