import { describe, expect, it } from "vitest";
import { rat } from "@mmlce/core";
import { rulerTicks, tabCellAt } from "../src/lib/tabGrid";

describe("타브 지판 칸 (누르기와 칸 미리보기가 같이 쓴다)", () => {
  // 첫 줄 y = 100, 줄 간격 20, 6줄, 16분음표 격자
  it("시간은 속한 칸의 왼쪽 끝, 줄은 가장 가까운 줄", () => {
    expect(tabCellAt(0.3, 100, 100, 20, 6, 16)).toEqual({ at: rat(4, 16), string: 1 });
    expect(tabCellAt(0.3, 129, 100, 20, 6, 16)).toEqual({ at: rat(4, 16), string: 2 });
    expect(tabCellAt(0.3, 131, 100, 20, 6, 16)).toEqual({ at: rat(4, 16), string: 3 });
  });

  it("칸 경계에서 떨어지는 실수 오차로 앞 칸이 되지 않는다", () => {
    expect(tabCellAt(0.25 - 1e-11, 100, 100, 20, 6, 4)).toEqual({ at: rat(1, 4), string: 1 });
  });

  it("줄 밖·곡 앞은 끝 줄·0으로", () => {
    expect(tabCellAt(-0.2, 0, 100, 20, 6, 8)).toEqual({ at: rat(0, 8), string: 1 });
    expect(tabCellAt(0, 500, 100, 20, 6, 8)).toEqual({ at: rat(0, 8), string: 6 });
  });
});

describe("마디 번호 줄 박·칸 눈금", () => {
  it("4/4, 8분 격자: 마디선 빼고 박 3개, 박 사이 칸 4개", () => {
    const ticks = rulerTicks([], 8, 0, 1, 400);
    expect(ticks.filter((t) => t.kind === "beat").map((t) => t.at)).toEqual([0.25, 0.5, 0.75]);
    expect(ticks.filter((t) => t.kind === "cell").map((t) => t.at)).toEqual([0.125, 0.375, 0.625, 0.875]);
  });

  it("칸이 너무 좁으면 박만", () => {
    const ticks = rulerTicks([], 16, 0, 1, 64);
    expect(ticks.every((t) => t.kind === "beat")).toBe(true);
  });

  it("6/8은 점4분 박 (두 박), 칸은 8분마다", () => {
    const ticks = rulerTicks([{ at: rat(0), beats: 6, unit: 8 }], 8, 0, 0.75, 400);
    expect(ticks.filter((t) => t.kind === "beat").map((t) => t.at)).toEqual([0.375]);
    expect(ticks.filter((t) => t.kind === "cell").map((t) => t.at)).toEqual([0.125, 0.25, 0.5, 0.625]);
  });

  it("셋잇단 격자(12)도 박과 겹치는 칸은 하나만", () => {
    const ticks = rulerTicks([], 12, 0, 0.5, 600);
    expect(ticks.map((t) => [t.at.toFixed(4), t.kind])).toEqual([
      ["0.0833", "cell"],
      ["0.1667", "cell"],
      ["0.2500", "beat"],
      ["0.3333", "cell"],
      ["0.4167", "cell"],
    ]);
  });
});
