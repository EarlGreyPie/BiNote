import { describe, expect, it } from "vitest";
import { isFullWidth, isIpad } from "../src/lib/windowControls";

describe("아이패드 창 단추 자리", () => {
  it("iPadOS(Macintosh + 터치)와 옛 iPad를 iPad로 본다", () => {
    expect(isIpad("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isIpad("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)", 5)).toBe(true);
    expect(isIpad("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isIpad("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5)).toBe(false);
  });
  it("가로·세로 전체 화면은 비우지 않고 분할·창 모드만 비운다", () => {
    expect(isFullWidth(1376, 1032, 1376)).toBe(true);
    expect(isFullWidth(1032, 1032, 1376)).toBe(true);
    expect(isFullWidth(678, 1032, 1376)).toBe(false);
    expect(isFullWidth(500, 1032, 1376)).toBe(false);
  });
});
