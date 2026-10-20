import { describe, expect, it } from "vitest";
import { rat } from "@mmlce/core";
import { fretBoxLeft, fretCenter, inTabEventBand, layoutTabEvents, rulerRelease, TAB_EVENT_BOTTOM, TAB_EVENT_FONT, TAB_EVENT_FONTS, TAB_EVENT_ROW_H, TAB_MARKER_CHARS, TAB_RULER, TAB_TOP, TAB_WAVE_TOP, tabEventAction, tabEventAt, tabEventBottom, tabEventRow, tabEventRowH, tabEventText, tabMarkerText, tabTop, tabWaveTop, tabZone } from "../src/lib/tabEvents";
import { WAVE_SIZE } from "../src/lib/waveDraw";

// 온음표 = 100px, 글자 한 자 = 6px
const xOf = (at: { n: number; d: number }) => (at.n / at.d) * 100;
const widthOf = (text: string) => text.length * 6;

describe("타브 변속 글자 자리 (위 칸 템포, 아래 칸 박자·마커)", () => {
  const spots = layoutTabEvents(
    [
      { kind: "tempo", at: rat(1), text: "t90" },
      { kind: "tempo", at: rat(0), text: "t120" },
      { kind: "meter", at: rat(0), text: "3/4" },
    ],
    xOf,
    widthOf,
  );

  it("시작 순으로 놓고, 같은 자리 템포·박자는 옆으로 밀지 않고 위아래 칸에 놓는다", () => {
    expect(spots.map((s) => [s.text, s.row, s.left, s.right])).toEqual([
      ["t120", 0, 3, 27],
      ["3/4", 1, 3, 21],
      ["t90", 0, 103, 121],
    ]);
  });

  it("누른 칸·x의 글자를 찾고, 원래 분수 위치를 돌려준다", () => {
    expect(tabEventAt(spots, 10, 0)).toMatchObject({ kind: "tempo", text: "t120" });
    expect(tabEventAt(spots, 10, 1)).toMatchObject({ kind: "meter", text: "3/4" });
    expect(tabEventAt(spots, 110, 0)!.at).toEqual(rat(1));
    expect(tabEventAt(spots, 110, 1)).toBeUndefined();
    expect(tabEventAt(spots, 70, 0)).toBeUndefined();
  });

  it("분수 위치는 실수로 되돌리지 않는다 (셋잇단 자리)", () => {
    const [s] = layoutTabEvents([{ kind: "tempo", at: rat(1, 3), text: "t80" }], xOf, widthOf);
    expect(s!.at).toEqual(rat(1, 3));
  });

  it("같은 칸에서 겹치면 옆으로 이어 쓴다", () => {
    const row = layoutTabEvents(
      [
        { kind: "meter", at: rat(0), text: "4/4" },
        { kind: "marker", at: rat(0), text: "A", id: "m" },
      ],
      xOf,
      widthOf,
    );
    expect(row.map((s) => [s.row, s.left, s.right])).toEqual([
      [1, 3, 21],
      [1, 25, 31],
    ]);
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

  it("마커는 아래 칸에 놓고 마커 id를 지킨다", () => {
    expect(spots.map((s) => [s.kind, s.text, s.row, s.left, s.right, s.id])).toEqual([
      ["tempo", "t120", 0, 3, 27, undefined],
      ["marker", "후렴", 1, 3, 15, "m1"],
      ["marker", "끝", 1, 203, 209, "m2"],
    ]);
  });

  it("마커 글자를 누르면 그 마커를 찾는다", () => {
    expect(tabEventAt(spots, 10, 1)).toMatchObject({ kind: "marker", id: "m1" });
    expect(tabEventAt(spots, 205, 1)).toMatchObject({ kind: "marker", id: "m2" });
    expect(tabEventAt(spots, 10, 0)).toMatchObject({ kind: "tempo" });
    expect(tabEventAt(spots, 120, 1)).toBeUndefined();
  });

  it("긴 마커 이름은 줄이고 …을 붙인다", () => {
    expect(tabMarkerText("후렴")).toBe("후렴");
    const exact = "가".repeat(TAB_MARKER_CHARS);
    expect(tabMarkerText(exact)).toBe(exact);
    expect(tabMarkerText(`${exact}나다`)).toBe(`${exact}…`);
  });
});

describe("타브 변속 줄 두 칸 자리", () => {
  it("위 칸 아래에 아래 칸, 한 칸 높이는 같고 첫 줄은 변속 줄 아래", () => {
    const up = tabEventText(0);
    const down = tabEventText(1);
    expect(up.top).toBeGreaterThanOrEqual(TAB_RULER);
    expect(down.top).toBe(up.top + TAB_EVENT_ROW_H);
    expect(down.bottom - down.top).toBe(up.bottom - up.top);
    expect(TAB_EVENT_BOTTOM).toBe(down.bottom);
    expect(TAB_TOP).toBeGreaterThan(TAB_EVENT_BOTTOM);
  });

  it("글자 크기를 고르면 칸 높이·파형 띠·첫 줄 자리가 함께 바뀌고, 누르는 칸도 그 자리를 따른다", () => {
    for (const font of TAB_EVENT_FONTS) {
      const up = tabEventText(0, font);
      const down = tabEventText(1, font);
      // 글자(기준선 위 font px)가 칸 안에 들어간다
      expect(up.baseline - font).toBeGreaterThanOrEqual(up.top - 1);
      expect(down.top).toBe(up.top + tabEventRowH(font));
      expect(tabEventBottom(font)).toBe(down.bottom);
      expect(tabWaveTop(font)).toBe(down.bottom);
      expect(tabTop(false, font)).toBe(down.bottom + 11);
      expect(tabTop(true, font)).toBe(down.bottom + 11 + WAVE_SIZE);
      const first = tabTop(false, font);
      expect(tabEventRow([], 300, up.baseline - 2, first, 11, font)).toBe(0);
      expect(tabEventRow([], 300, down.baseline - 2, first, 11, font)).toBe(1);
      expect(tabEventRow([], 300, down.bottom, first, 11, font)).toBeUndefined();
      expect(tabZone([], 300, tabWaveTop(font) + 5, tabTop(true, font), 11, true, font)).toBe("wave");
    }
    // 기본값은 인자를 뺀 것과 같다
    expect(tabTop(false, TAB_EVENT_FONT)).toBe(TAB_TOP);
    expect(tabEventBottom(10)).toBeLessThan(TAB_EVENT_BOTTOM);
    expect(tabEventBottom(20)).toBeGreaterThan(TAB_EVENT_BOTTOM);
  });
});

describe("타브 변속 줄 누르기 범위", () => {
  // TabView와 같은 값: 첫 줄은 y = TAB_TOP (마디 번호 줄 + 변속 줄 두 칸), 숫자 글자 크기는 줄 간격에 따라 11~20px
  const TOP = TAB_TOP;
  const fontOf = (gap: number) => Math.round(Math.min(20, Math.max(11, gap * 0.62)));
  const spots = layoutTabEvents(
    [
      { kind: "tempo", at: rat(1), text: "t120" },
      { kind: "meter", at: rat(1), text: "3/4" },
    ],
    xOf,
    widthOf,
  );
  const onText = 105;
  const empty = 300;
  const upY = tabEventText(0).baseline - 4;
  const downY = tabEventText(1).baseline - 4;

  it("위 칸 글자 자리는 늘 템포 칸이다 (간격 18·36·42·44)", () => {
    for (const gap of [18, 36, 42, 44]) {
      expect(tabEventRow(spots, onText, upY, TOP, fontOf(gap))).toBe(0);
      expect(tabEventRow(spots, empty, upY, TOP, fontOf(gap))).toBe(0);
      expect(tabEventRow(spots, onText, tabEventText(0).top, TOP, fontOf(gap))).toBe(0);
      expect(tabEventRow(spots, onText, TAB_RULER, TOP, fontOf(gap))).toBe(0);
    }
  });

  it("아래 칸 글자 자리는 박자·마커 칸이다 (칸 위아래 끝까지)", () => {
    for (const gap of [18, 36, 42, 44]) {
      expect(tabEventRow(spots, onText, downY, TOP, fontOf(gap))).toBe(1);
      expect(tabEventRow(spots, onText, tabEventText(1).top, TOP, fontOf(gap))).toBe(1);
      expect(tabEventRow(spots, onText, TAB_EVENT_BOTTOM - 1, TOP, fontOf(gap))).toBe(1);
      expect(inTabEventBand(spots, onText, downY, TOP, fontOf(gap))).toBe(true);
    }
  });

  it("첫 줄 숫자 자리는 지판 쪽이다: 변속 줄 아래와, 크게 해 숫자 칸과 겹치는 아래 칸 빈 자리", () => {
    for (const gap of [18, 36, 42, 44]) {
      expect(tabEventRow(spots, onText, TAB_EVENT_BOTTOM, TOP, fontOf(gap))).toBeUndefined();
      expect(tabEventRow(spots, empty, TOP - fontOf(gap) / 2, TOP, fontOf(gap))).toBeUndefined();
      expect(tabEventRow(spots, onText, TOP, TOP, fontOf(gap))).toBeUndefined();
    }
    // 크게 하면 첫 줄 숫자(위로 fontPx 가까이)와 아래 칸이 겹친다: 빈 자리는 지판, 글자 위는 박자
    expect(tabEventRow(spots, empty, downY, TOP, fontOf(44))).toBeUndefined();
    expect(tabEventRow(spots, onText, downY, TOP, fontOf(44))).toBe(1);
    // 기본 크기는 겹치지 않아 아래 칸 빈 자리도 변속 줄이다 (두 번 누르면 새 마커)
    expect(tabEventRow(spots, empty, downY, TOP, fontOf(18))).toBe(1);
    // 마디 번호 줄은 변속 줄이 아니다
    expect(tabEventRow(spots, onText, 10, TOP, fontOf(18))).toBeUndefined();
  });
});

describe("두 번 누르기 (터치는 길게)", () => {
  // 새 곡: 템포 없음, 0 자리에 4/4
  const spots = layoutTabEvents([{ kind: "meter", at: rat(0), text: "4/4" }], xOf, widthOf);
  it("0 자리에 박자만 있을 때 위 칸 빈 곳은 새 템포", () => {
    expect(tabEventAction(spots, 5, 0)).toEqual({ add: "tempo" });
  });
  it("아래 칸 4/4 글자는 그 박자를 고친다", () => {
    expect(tabEventAction(spots, 5, 1)).toMatchObject({ edit: { kind: "meter", text: "4/4" } });
  });
  it("아래 칸 빈 곳은 새 마커", () => {
    expect(tabEventAction(spots, 200, 1)).toEqual({ add: "marker" });
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

describe("타브 위쪽 칸 고르기 (마디 번호 줄 / 위 칸 / 아래 칸 / 지판)", () => {
  const TOP = TAB_TOP;
  const spots = layoutTabEvents(
    [
      { kind: "tempo", at: rat(1), text: "t120" },
      { kind: "meter", at: rat(1), text: "3/4" },
    ],
    xOf,
    widthOf,
  );
  const upY = tabEventText(0).baseline - 4;
  const downY = tabEventText(1).baseline - 4;
  it("마디 번호 줄", () => {
    expect(tabZone(spots, 300, 5, TOP, 11)).toBe("ruler");
    expect(tabZone(spots, 105, TAB_RULER - 1, TOP, 11)).toBe("ruler");
  });
  it("위 칸(템포)과 아래 칸(박자·마커): 글자 위와 빈 곳", () => {
    expect(tabZone(spots, 105, upY, TOP, 11)).toBe("tempo");
    expect(tabZone(spots, 300, upY, TOP, 11)).toBe("tempo");
    // 마디 번호 줄 바로 아래부터 위 칸
    expect(tabZone(spots, 300, TAB_RULER, TOP, 11)).toBe("tempo");
    expect(tabZone(spots, 105, downY, TOP, 11)).toBe("meter");
    expect(tabZone(spots, 300, downY, TOP, 11)).toBe("meter");
  });
  it("타브를 크게 해 첫 줄 프렛 숫자와 겹치는 아래 칸 빈 자리는 지판, 글자 위는 변속", () => {
    expect(tabZone(spots, 300, downY + 2, TOP, 20)).toBe("fret");
    expect(tabZone(spots, 105, downY + 2, TOP, 20)).toBe("meter");
    expect(tabZone(spots, 300, upY, TOP, 20)).toBe("tempo");
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

describe("타브 원곡 파형 띠 칸 (지시서 27)", () => {
  const spots = layoutTabEvents([{ kind: "tempo", at: rat(1), text: "t120" }], xOf, widthOf);
  const top = tabTop(true);
  it("띠가 있으면 첫 줄이 띠 높이만큼 내려가고, 없으면 그대로", () => {
    expect(tabTop(false)).toBe(TAB_TOP);
    expect(top).toBe(TAB_TOP + WAVE_SIZE);
    // 띠는 변속 글자 칸 아래, 첫 줄 위
    expect(TAB_WAVE_TOP).toBeGreaterThanOrEqual(TAB_EVENT_BOTTOM);
    expect(TAB_WAVE_TOP + WAVE_SIZE).toBeLessThan(top);
  });
  it("띠 있음: 띠 안은 wave, 위·아래 경계", () => {
    expect(tabZone(spots, 300, TAB_WAVE_TOP + 10, top, 11, true)).toBe("wave");
    expect(tabZone(spots, 300, TAB_WAVE_TOP, top, 11, true)).toBe("wave");
    expect(tabZone(spots, 300, TAB_WAVE_TOP + WAVE_SIZE - 1, top, 11, true)).toBe("wave");
    // 띠 바로 아래는 지판, 띠 바로 위(변속 아래 칸 끝)는 변속 줄 아래 칸
    expect(tabZone(spots, 300, TAB_WAVE_TOP + WAVE_SIZE, top, 11, true)).toBe("fret");
    expect(tabZone(spots, 300, TAB_EVENT_BOTTOM - 1, top, 11, true)).toBe("meter");
    // 마디 번호 줄은 그대로
    expect(tabZone(spots, 300, 5, top, 11, true)).toBe("ruler");
  });
  it("띠 없음: 같은 자리가 wave가 아니다 (지금과 같다)", () => {
    expect(tabZone(spots, 300, TAB_WAVE_TOP + 10, TAB_TOP, 11, false)).not.toBe("wave");
    expect(tabZone(spots, 300, TAB_WAVE_TOP + 10, TAB_TOP, 11)).toBe("fret");
  });
  it("타브를 크게 해 첫 줄 숫자가 띠까지 올라오면 그 자리는 첫 줄(지판)", () => {
    // 글자 20px: 첫 줄 숫자는 top - 20부터
    expect(tabZone(spots, 300, top - 15, top, 20, true)).toBe("fret");
    expect(tabZone(spots, 300, top - 21, top, 20, true)).toBe("wave");
  });
});
