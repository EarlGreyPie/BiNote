import { describe, expect, it } from "vitest";
import { LONG_PRESS_SLOP, movedTooFar } from "../src/lib/longPress";

describe("길게 누르기 허용 거리", () => {
  const from = { clientX: 100, clientY: 100 };
  it("손가락이 조금 흔들려도(10px 이하) 길게 누르기를 이어 간다", () => {
    expect(LONG_PRESS_SLOP).toBe(10);
    expect(movedTooFar(from, { clientX: 109, clientY: 100 })).toBe(false);
    expect(movedTooFar(from, { clientX: 106, clientY: 106 })).toBe(false);
    expect(movedTooFar(from, { clientX: 110, clientY: 100 })).toBe(false);
  });
  it("10px 넘게 움직이면 그만둔다", () => {
    expect(movedTooFar(from, { clientX: 111, clientY: 100 })).toBe(true);
    expect(movedTooFar(from, { clientX: 100, clientY: 89 })).toBe(true);
  });
  it("누른 자리가 없으면(마우스 등) 그만두지 않는다", () => {
    expect(movedTooFar(undefined, { clientX: 300, clientY: 300 })).toBe(false);
  });
});
