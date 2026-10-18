import { describe, expect, it } from "vitest";
import { rat } from "@mmlce/core";
import { inTabEventBand, layoutTabEvents, TAB_EVENT_TEXT, tabEventAt } from "../src/lib/tabEvents";

// 온음표 = 100px, 글자 한 자 = 6px
const xOf = (at: { n: number; d: number }) => (at.n / at.d) * 100;
const widthOf = (text: string) => text.length * 6;

describe("타브 변속 글자 자리", () => {
  const spots = layoutTabEvents(
    [
      { kind: "tempo", at: rat(1), text: "t90" },
      { kind: "tempo", at: rat(0), text: "t120" },
      { kind: "meter", at: rat(0), text: "3/4" },
    ],
    xOf,
    widthOf,
  );

  it("시작 순으로 놓고, 같은 자리 템포·박자는 겹치지 않게 옆으로 이어 쓴다", () => {
    expect(spots.map((s) => [s.text, s.left, s.right])).toEqual([
      ["t120", 3, 27],
      ["3/4", 31, 49],
      ["t90", 103, 121],
    ]);
  });

  it("누른 x의 글자를 찾고, 원래 분수 위치를 돌려준다", () => {
    expect(tabEventAt(spots, 10)).toMatchObject({ kind: "tempo", text: "t120" });
    expect(tabEventAt(spots, 40)).toMatchObject({ kind: "meter", text: "3/4" });
    expect(tabEventAt(spots, 110)!.at).toEqual(rat(1));
    expect(tabEventAt(spots, 70)).toBeUndefined();
  });

  it("분수 위치는 실수로 되돌리지 않는다 (셋잇단 자리)", () => {
    const [s] = layoutTabEvents([{ kind: "tempo", at: rat(1, 3), text: "t80" }], xOf, widthOf);
    expect(s!.at).toEqual(rat(1, 3));
  });
});

describe("타브 변속 줄 누르기 범위", () => {
  // TabView와 같은 값: 첫 줄은 y = 42, 숫자 글자 크기는 줄 간격에 따라 11~20px
  const TOP = 42;
  const fontOf = (gap: number) => Math.round(Math.min(20, Math.max(11, gap * 0.62)));
  const spots = layoutTabEvents([{ kind: "tempo", at: rat(1), text: "t120" }], xOf, widthOf);
  const onText = 105;
  const empty = 300;

  it("타브를 크게 해도 글자 자리(y = 24)를 누르면 템포 쪽이다 (간격 18·36·42·44)", () => {
    for (const gap of [18, 36, 42, 44]) {
      expect(inTabEventBand(spots, onText, 24, TOP, fontOf(gap))).toBe(true);
      // 글자 칸 위아래 끝까지
      expect(inTabEventBand(spots, onText, TAB_EVENT_TEXT.top, TOP, fontOf(gap))).toBe(true);
      expect(inTabEventBand(spots, onText, TAB_EVENT_TEXT.bottom - 1, TOP, fontOf(gap))).toBe(true);
    }
  });

  it("첫 줄 숫자 자리는 지판 쪽이다: 글자 칸 아래와, 숫자 칸과 겹치는 빈 자리", () => {
    for (const gap of [18, 36, 42, 44]) {
      expect(inTabEventBand(spots, onText, TAB_EVENT_TEXT.bottom, TOP, fontOf(gap))).toBe(false);
      expect(inTabEventBand(spots, empty, TOP - fontOf(gap) / 2, TOP, fontOf(gap))).toBe(false);
      expect(inTabEventBand(spots, onText, TOP, TOP, fontOf(gap))).toBe(false);
    }
    // 크게 하면 첫 줄 숫자(위로 fontPx 가까이)와 글자 칸이 겹친다: 빈 자리는 지판, 글자 위는 템포
    expect(inTabEventBand(spots, empty, 24, TOP, fontOf(42))).toBe(false);
    expect(inTabEventBand(spots, onText, 24, TOP, fontOf(42))).toBe(true);
    // 기본 크기는 겹치지 않아 빈 자리도 변속 줄이다 (두 번 누르면 새 템포)
    expect(inTabEventBand(spots, empty, 24, TOP, fontOf(18))).toBe(true);
    // 마디 번호 줄은 변속 줄이 아니다 (전과 같다)
    expect(inTabEventBand(spots, onText, 10, TOP, fontOf(18))).toBe(false);
  });
});
