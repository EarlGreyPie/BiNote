import { describe, expect, it } from "vitest";
import { spanAt } from "../src/lib/analysis";

describe("재생 자리 글 찾기", () => {
  const timeline = [
    { start: 0, end: 0.25, span: [0, 1] as const },
    { start: 0.25, end: 0.5, span: [1, 2] as const },
    { start: 1, end: 1.25, span: [5, 6] as const },
  ];
  it("그 시각에 울리는 음의 글 자리, 쉼표 자리면 없음", () => {
    expect(spanAt(timeline, 0)).toEqual([0, 1]);
    expect(spanAt(timeline, 0.3)).toEqual([1, 2]);
    expect(spanAt(timeline, 0.7)).toBeUndefined();
    expect(spanAt(timeline, 1.1)).toEqual([5, 6]);
  });
});
