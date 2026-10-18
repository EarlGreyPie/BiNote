import { describe, expect, it } from "vitest";
import { rat, toFloat } from "@mmlce/core";
import { cursorVisible, firstVisibleCell, followPlayhead, followStart, parseFollowCursor, PLAYHEAD_FOLLOW_HOLD_MS, revealRowScroll, revealStart } from "../src/lib/tabFollow";

// 보이는 폭 4 (온음표), 화면 [10, 14)
describe("커서 따라가기", () => {
  it("여백 안쪽이면 그대로", () => {
    expect(followStart(11, 11.25, 10, 4, 100)).toBe(10);
  });
  it("오른쪽 여백을 넘으면 커서가 왼쪽 1/4 자리에 오게 한 번에 넘긴다", () => {
    expect(followStart(13.75, 14, 10, 4, 100)).toBe(12.75);
    // 음 끝이 오른쪽 여백을 넘어도
    expect(followStart(13, 14, 10, 4, 100)).toBe(12);
  });
  it("왼쪽 여백보다 앞이면 커서가 오른쪽 1/4 자리에 오게", () => {
    expect(followStart(10, 10.25, 10, 4, 100)).toBe(7);
    expect(followStart(5, 5.25, 10, 4, 100)).toBe(2);
  });
  it("0 아래로, timeMax 너머로 가지 않는다", () => {
    expect(followStart(1, 1.25, 3, 4, 100)).toBe(0);
    expect(followStart(30, 30.25, 10, 4, 20)).toBe(20);
  });
  it("화면보다 긴 음이면 음 머리가 보이게", () => {
    const start = followStart(20, 30, 10, 4, 100);
    expect(start).toBeLessThanOrEqual(20);
    expect(20).toBeLessThan(start + 4);
  });
  it("설정: 없으면 켬, 0이면 끔", () => {
    expect(parseFollowCursor(null)).toBe(true);
    expect(parseFollowCursor("1")).toBe(true);
    expect(parseFollowCursor("0")).toBe(false);
  });
});

describe("커서가 없을 때 키를 누르면 만들 자리 (화면에 보이는 첫 칸)", () => {
  it("왼쪽 끝이 정확히 격자 위면 그 칸", () => {
    expect(firstVisibleCell(2, 16)).toEqual(rat(2));
    expect(firstVisibleCell(2.25, 16)).toEqual(rat(9, 4));
  });
  it("격자 사이면 (그 칸이 반쯤 가려져) 다음 칸", () => {
    expect(firstVisibleCell(2.01, 16)).toEqual(rat(33, 16));
    expect(firstVisibleCell(0.3, 4)).toEqual(rat(2, 4));
  });
  it("0", () => {
    expect(firstVisibleCell(0, 16)).toEqual(rat(0));
  });
});

describe("편집 전에 커서 칸을 화면에 보이게 하기", () => {
  it("첫 키 ←: start 0.25, 격자 1/4에서 커서 0은 안 보이고, 옮긴 start에서는 보인다", () => {
    const span = 1;
    expect(cursorVisible(0, 0.25, span)).toBe(false);
    const next = revealStart(0, 0.25, 0.25, span, 10);
    expect(cursorVisible(0, next, span)).toBe(true);
    expect(next).toBe(0);
  });

  it("좁은 화면·큰 확대: 폭 320px, 2000px/온음표, start 2.01, 격자 1/4", () => {
    const span = 320 / 2000;
    const cell = firstVisibleCell(2.01, 4, span);
    // 올림한 9/4는 보이는 범위 [2.01, 2.17) 밖이라 왼쪽 끝이 걸친 2를 고른다
    expect(cell).toEqual(rat(2, 1));
    const at = toFloat(cell);
    const next = revealStart(at, at + 0.25, 2.01, span, 100);
    expect(cursorVisible(at, next, span)).toBe(true);
    // 고른 칸이 오른쪽 밖이었어도(9/4) 옮기면 보인다
    expect(cursorVisible(2.25, revealStart(2.25, 2.5, 2.01, span, 100), span)).toBe(true);
  });

  it("넓은 화면에서는 전처럼 올림한 칸", () => {
    expect(firstVisibleCell(2.01, 4, 8)).toEqual(rat(9, 4));
    expect(firstVisibleCell(2, 4, 8)).toEqual(rat(2, 1));
    expect(firstVisibleCell(0, 4, 8)).toEqual(rat(0, 1));
  });

  it("커서가 이미 보이면 start를 바꾸지 않는다", () => {
    expect(revealStart(3, 3.25, 2, 4, 20)).toBe(2);
    expect(revealStart(2, 2.25, 2, 4, 20)).toBe(2);
  });

  it("곡 끝(timeMax)·0 근처에서 범위를 넘지 않는다", () => {
    // 오른쪽 밖, timeMax 안에서 넘긴다
    const a = revealStart(19, 19.25, 0, 4, 18);
    expect(a).toBeLessThanOrEqual(18);
    expect(cursorVisible(19, a, 4)).toBe(true);
    // 0 앞으로 가지 않는다
    expect(revealStart(0.1, 0.35, 5, 4, 20)).toBe(0);
    // timeMax에 막혀도 안 보이면 커서 시작을 왼쪽 끝에 (보이는 것이 먼저)
    const far = revealStart(40, 40.25, 0, 4, 18);
    expect(cursorVisible(40, far, 4)).toBe(true);
  });
});

describe("커서 줄 세로 보이기 (지시서 27)", () => {
  // 줄 간격 30, 글자 20, 첫 줄 81: n번째 줄 영역은 [81 + (n-1)*30 - 20, + 40)
  const row = (n: number) => 81 + (n - 1) * 30 - 20;
  it("보이면 그대로", () => {
    expect(revealRowScroll(row(1), row(1) + 40, 0, 200)).toBe(0);
  });
  it("아래로 벗어나면 그 줄 아래가 맨 아래에", () => {
    // 6번째 줄 [211, 251)이 높이 200인 칸 아래로 나감
    expect(revealRowScroll(row(6), row(6) + 40, 0, 200)).toBe(51);
  });
  it("위로 벗어나면 그 줄 위가 맨 위에 (0 아래로는 안 간다)", () => {
    expect(revealRowScroll(row(2), row(2) + 40, 150, 200)).toBe(91);
    expect(revealRowScroll(-5, 15, 50, 200)).toBe(0);
  });
  it("칸 높이를 모르면 그대로", () => {
    expect(revealRowScroll(row(6), row(6) + 40, 7, 0)).toBe(7);
  });
});

describe("재생선 따라가기와 편집 직후 쉬기 (지시서 27)", () => {
  it("재생선이 화면 밖이면 왼쪽 10%에 오게 넘긴다", () => {
    expect(followPlayhead(5, 0, 4, 1000, 0)).toBeCloseTo(4.6);
    expect(followPlayhead(1, 0, 4, 1000, 0)).toBeUndefined();
  });
  it("편집으로 커서 쪽으로 옮긴 직후(쉬는 시간 안)에는 넘기지 않는다", () => {
    const hold = 1000 + PLAYHEAD_FOLLOW_HOLD_MS;
    expect(followPlayhead(5, 10, 4, 1200, hold)).toBeUndefined();
    // 쉬는 시간이 지나면 다시 따라간다
    expect(followPlayhead(5, 10, 4, hold, hold)).toBeCloseTo(4.6);
  });
});
