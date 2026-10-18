import { describe, expect, it } from "vitest";
import { clampRollShare, maxRollShare } from "../src/lib/paneSplit";

describe("세로 화면 분할선 한도", () => {
  it("아래 패널이 최소 높이보다 작아지지 않게 롤 몫의 위 한도를 정한다", () => {
    // 칸 높이 710, 분할선 10 → 나눌 높이 700. 패널 최소 280px면 롤은 60%까지
    expect(maxRollShare(710, 280)).toBe(60);
    // 패널 최소가 작으면 기본 위 한도 80%
    expect(maxRollShare(710, 50)).toBe(80);
    // 칸이 너무 낮으면 20%까지만 내린다
    expect(maxRollShare(300, 500)).toBe(20);
    // 잴 수 없으면 기본 범위
    expect(maxRollShare(0, 280)).toBe(80);
    expect(maxRollShare(710, 0)).toBe(80);
  });

  it("끌거나 불러온 몫을 한도 안으로 맞춘다", () => {
    expect(clampRollShare(78, maxRollShare(710, 280))).toBe(60);
    expect(clampRollShare(46, 60)).toBe(46);
    expect(clampRollShare(5)).toBe(20);
    expect(clampRollShare(95)).toBe(80);
  });
});
