import { describe, expect, it } from "vitest";
import { carryViewStart, emptyViewMemory, fromCurrentView, rememberView } from "../src/lib/viewCarry";

describe("보기를 바꿀 때 시작 시간", () => {
  it("기억한 자리가 없으면 곡 처음", () => {
    expect(carryViewStart(undefined, 4, 2)).toBe(0);
  });

  it("재생 위치가 없으면 앞 보기의 왼쪽 끝 그대로", () => {
    expect(carryViewStart({ start: 10, span: 4 }, 2, undefined)).toBe(10);
  });

  it("앞 보기에서 보이던 재생 위치가 새 보기에서도 보이면 그대로", () => {
    expect(carryViewStart({ start: 10, span: 4 }, 4, 12)).toBe(10);
    // 새 보기가 더 넓어도 (덜 확대)
    expect(carryViewStart({ start: 10, span: 4 }, 8, 13)).toBe(10);
  });

  it("새 보기가 더 좁아 재생 위치가 밖으로 나가면 폭의 10% 자리에 둔다", () => {
    // 앞 보기 [10, 18]에서 17이 보였다. 새 폭 2면 [10, 12]라 밖 → 17 − 0.2
    expect(carryViewStart({ start: 10, span: 8 }, 2, 17)).toBeCloseTo(16.8);
    // 끝 10% 안도 밖으로 친다 (재생 따라가기와 같은 기준)
    expect(carryViewStart({ start: 10, span: 8 }, 4, 13.8)).toBeCloseTo(13.4);
  });

  it("앞 보기에서 재생 위치가 화면 밖이었으면 왼쪽 끝만 맞춘다", () => {
    expect(carryViewStart({ start: 10, span: 4 }, 2, 30)).toBe(10);
    expect(carryViewStart({ start: 10, span: 4 }, 2, 3)).toBe(10);
  });

  it("앞으로 당겨도 곡 처음보다 앞으로 가지 않는다", () => {
    expect(carryViewStart({ start: 0, span: 8 }, 0.5, 0.6)).toBeCloseTo(0.55);
    expect(carryViewStart({ start: 0, span: 8 }, 10, 0)).toBe(0);
  });
});

describe("보기 자리 기억 쓰기", () => {
  const place = { start: 12, span: 4 };
  const tab = { pxPerWhole: 300, cursor: { at: { n: 13, d: 1 }, string: 2 } };

  it("그 보기를 만든 보기 세대가 지금 세대면 적는다", () => {
    const memory = emptyViewMemory();
    expect(rememberView(memory, 3, 3, { place, tab })).toBe(true);
    expect(memory).toEqual({ place, roll: undefined, tab });
  });

  it("곡을 새로 연 뒤 옛 보기가 늦게 알리면 버린다 (옛 커서가 새 곡 기억에 되살아나지 않게)", () => {
    const memory = emptyViewMemory();
    expect(rememberView(memory, 2, 3, { place, tab })).toBe(false);
    expect(memory).toEqual(emptyViewMemory());
  });

  it("곡을 모르는 보기(work 없음)의 알림도 버린다", () => {
    const memory = emptyViewMemory();
    expect(rememberView(memory, undefined, 3, { place })).toBe(false);
    expect(memory.place).toBeUndefined();
  });
});

describe("옛 보기가 늦게 보낸 템포·마커 창 열기", () => {
  it("보기 세대가 다르거나 모르면 버린다 (곡을 연 뒤 길게 누르기 타이머가 늦게 터져도)", () => {
    expect(fromCurrentView(3, 3)).toBe(true);
    expect(fromCurrentView(2, 3)).toBe(false);
    expect(fromCurrentView(undefined, 3)).toBe(false);
  });
});
