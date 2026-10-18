import { describe, expect, it } from "vitest";
import { rat } from "@mmlce/core";
import { fretBoxLeft, fretCenter, inTabEventBand, layoutTabEvents, rulerRelease, TAB_EVENT_TEXT, TAB_MARKER_CHARS, TAB_RULER, tabEventAt, tabMarkerText, tabZone } from "../src/lib/tabEvents";

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

describe("타브 변속 줄의 마커", () => {
  const spots = layoutTabEvents(
    [
      { kind: "tempo", at: rat(0), text: "t120" },
      { kind: "marker", at: rat(0), text: "후렴", id: "m1" },
      { kind: "marker", at: rat(2), text: "끝", id: "m2" },
    ],
    xOf,
    widthOf,
  );

  it("같은 자리 템포 뒤에 옆으로 이어 쓰고 마커 id를 지킨다", () => {
    expect(spots.map((s) => [s.kind, s.text, s.left, s.right, s.id])).toEqual([
      ["tempo", "t120", 3, 27, undefined],
      ["marker", "후렴", 31, 43, "m1"],
      ["marker", "끝", 203, 209, "m2"],
    ]);
  });

  it("마커 글자를 누르면 그 마커를 찾는다", () => {
    expect(tabEventAt(spots, 35)).toMatchObject({ kind: "marker", id: "m1" });
    expect(tabEventAt(spots, 205)).toMatchObject({ kind: "marker", id: "m2" });
    expect(tabEventAt(spots, 10)).toMatchObject({ kind: "tempo" });
    expect(tabEventAt(spots, 120)).toBeUndefined();
  });

  it("긴 마커 이름은 줄이고 …을 붙인다", () => {
    expect(tabMarkerText("후렴")).toBe("후렴");
    const exact = "가".repeat(TAB_MARKER_CHARS);
    expect(tabMarkerText(exact)).toBe(exact);
    expect(tabMarkerText(`${exact}나다`)).toBe(`${exact}…`);
  });
});

describe("타브 변속 줄 누르기 범위", () => {
  // TabView와 같은 값: 첫 줄은 y = 48 (마디 번호 줄 20px + 변속 줄), 숫자 글자 크기는 줄 간격에 따라 11~20px
  const TOP = 48;
  const fontOf = (gap: number) => Math.round(Math.min(20, Math.max(11, gap * 0.62)));
  const spots = layoutTabEvents([{ kind: "tempo", at: rat(1), text: "t120" }], xOf, widthOf);
  const onText = 105;
  const empty = 300;

  it("타브를 크게 해도 글자 자리(y = 28)를 누르면 템포 쪽이다 (간격 18·36·42·44)", () => {
    for (const gap of [18, 36, 42, 44]) {
      expect(inTabEventBand(spots, onText, 28, TOP, fontOf(gap))).toBe(true);
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
    expect(inTabEventBand(spots, empty, 28, TOP, fontOf(42))).toBe(false);
    expect(inTabEventBand(spots, onText, 28, TOP, fontOf(42))).toBe(true);
    // 기본 크기는 겹치지 않아 빈 자리도 변속 줄이다 (두 번 누르면 새 템포)
    expect(inTabEventBand(spots, empty, 28, TOP, fontOf(18))).toBe(true);
    // 마디 번호 줄은 변속 줄이 아니다 (전과 같다)
    expect(inTabEventBand(spots, onText, 10, TOP, fontOf(18))).toBe(false);
  });
});

describe("프렛 숫자 칸 자리", () => {
  it("음이 시작하는 자리에서 오른쪽으로 쓴다: 마디 첫 음 숫자 왼쪽이 마디선(1px)을 덮지 않는다", () => {
    for (const bar of [28, 100.5, 333]) {
      expect(fretBoxLeft(bar)).toBeGreaterThanOrEqual(bar + 1);
    }
  });
  it("글자 가운데는 칸 왼쪽 + 여백 + 글자 폭 절반 (커서 네모·이음 표시가 같은 기준)", () => {
    expect(fretCenter(100, 8)).toBe(fretBoxLeft(100) + 2 + 4);
    // 가로축은 그대로: 숫자 칸은 시작 자리보다 왼쪽으로 나가지 않는다
    expect(fretCenter(100, 8) - 8 / 2 - 2).toBeGreaterThan(100);
  });
});

describe("타브 위쪽 칸 고르기 (마디 번호 줄 / 변속 줄 / 지판)", () => {
  const TOP = 48;
  const spots = layoutTabEvents([{ kind: "tempo", at: rat(1), text: "t120" }], xOf, widthOf);
  it("마디 번호 줄", () => {
    expect(tabZone(spots, 300, 5, TOP, 11)).toBe("ruler");
    expect(tabZone(spots, 105, TAB_RULER - 1, TOP, 11)).toBe("ruler");
  });
  it("변속 글자와 변속 줄의 빈 곳", () => {
    expect(tabZone(spots, 105, 28, TOP, 11)).toBe("event");
    expect(tabZone(spots, 300, 28, TOP, 11)).toBe("event");
    // 마디 번호 줄 바로 아래부터 변속 줄
    expect(tabZone(spots, 300, TAB_RULER, TOP, 11)).toBe("event");
  });
  it("타브를 크게 해 첫 줄 프렛 숫자와 겹치는 빈 자리는 지판, 글자 위는 변속", () => {
    expect(tabZone(spots, 300, 30, TOP, 20)).toBe("fret");
    expect(tabZone(spots, 105, 30, TOP, 20)).toBe("event");
    expect(tabZone(spots, 300, TOP, TOP, 11)).toBe("fret");
  });
});

describe("마디 번호 줄 누르기·끌기", () => {
  it("같은 자리 = 재생 위치, 재생 위치 위를 다시 = 지우기", () => {
    expect(rulerRelease(1.5, 1.5, undefined)).toEqual({ kind: "seek", at: 1.5 });
    expect(rulerRelease(1.5, 1.5, 2)).toEqual({ kind: "seek", at: 1.5 });
    expect(rulerRelease(1.5, 1.5, 1.5)).toEqual({ kind: "clear" });
  });
  it("다른 자리 = 반복 구간 (앞뒤 정렬)", () => {
    expect(rulerRelease(1, 3, undefined)).toEqual({ kind: "loop", range: [1, 3] });
    expect(rulerRelease(3, 1, 0)).toEqual({ kind: "loop", range: [1, 3] });
  });
});
