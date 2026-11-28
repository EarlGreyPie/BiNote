import { describe, expect, it } from "vitest";
import { rat, staffBars, staffTrack, type Note } from "@mmlce/core";
import { barIndexAt, barOffsets, barWidths, followSystem, keyLead, keyWidth, linePlace, timeToX, visibleBars, wrapBars, xToTime } from "../src/lib/staffLayout";

const note = (s: number, d: number, pitch = 60): Note => ({ id: `n${s}`, start: rat(s * 16, 16), dur: rat(d * 16, 16), pitch, vol: 8, tie: "none" });

describe("오선보 자리 잡기", () => {
  const notes = [note(0, 0.25), note(0.25, 0.25), note(1, 1), note(2.5, 0.5)];
  const bars = staffBars({ tracks: [{ notes } as never], timeSig: [], tempo: [] });
  const tracks = [staffTrack(notes, bars, { min: 0, max: 15 })];

  it("음이 많은 마디가 넓고, 배율을 키우면 넓어진다. 자리는 폭을 이어 붙인 것", () => {
    const w = barWidths(bars, tracks, 1);
    expect(w).toHaveLength(3);
    // 첫 마디는 박자표·템포 자리가 더 든다
    expect(w[0]).toBeGreaterThan(w[1]!);
    expect(barWidths(bars, tracks, 2)[2]).toBeGreaterThanOrEqual(w[2]!);
    expect(barOffsets([10, 20, 30])).toEqual([0, 10, 30, 60]);
  });

  it("보이는 마디만 고른다 (앞뒤 여유 마디 포함)", () => {
    const offsets = barOffsets([100, 100, 100, 100, 100]);
    expect(visibleBars(offsets, 150, 100, 0)).toEqual([1, 2]);
    expect(visibleBars(offsets, 150, 100)).toEqual([0, 3]);
    expect(visibleBars(offsets, 0, 1000, 0)).toEqual([0, 4]);
    expect(visibleBars([0], 0, 100)).toBeUndefined();
  });

  it("시간 ↔ x: 그린 음 자리 사이를 잇고, 안 그린 마디는 고르게. 서로 거꾸로", () => {
    const offsets = linePlace([100, 100, 100]);
    const anchors = new Map([[0, [{ at: 0, x: 30 }, { at: 0.5, x: 60 }]]]);
    expect(barIndexAt(bars, 1.2)).toBe(1);
    expect(timeToX(bars, offsets, anchors, 0)).toBe(30);
    expect(timeToX(bars, offsets, anchors, 0.25)).toBe(45);
    expect(timeToX(bars, offsets, anchors, 1.5)).toBe(150);
    for (const at of [0.1, 0.4, 0.75, 1.3, 2.9]) expect(xToTime(bars, offsets, anchors, timeToX(bars, offsets, anchors, at))).toBeCloseTo(at, 9);
  });

  it("줄바꿈: 줄 폭에 들어가는 만큼 한 줄에, 마지막 줄 말고는 줄 끝을 맞춘다", () => {
    const w = wrapBars([100, 120, 90, 200, 80], 300);
    expect(w.systems).toEqual([{ first: 0, last: 1 }, { first: 2, last: 3 }, { first: 4, last: 4 }]);
    expect(w.systemOf).toEqual([0, 0, 1, 1, 2]);
    // 첫 줄 220px → 300px로 늘린다 (줄 안 자리는 0부터)
    expect(w.left[0]).toBe(0);
    expect(w.left[1]).toBe(w.width[0]);
    expect(w.left[1]! + w.width[1]!).toBe(300);
    expect(w.width[0]! / w.width[1]!).toBeCloseTo(100 / 120, 1);
    // 둘째 줄 290 → 300, 마지막 줄은 그대로
    expect(w.left[3]! + w.width[3]!).toBe(300);
    expect(w.left[4]).toBe(0);
    expect(w.width[4]).toBe(80);
    expect(w.lineWidth).toBe(300);
  });

  it("줄바꿈: 줄 폭보다 넓은 마디는 혼자 한 줄, 너무 많이 늘려야 하는 줄은 늘리지 않는다", () => {
    const w = wrapBars([100, 500, 100], 300);
    expect(w.systems).toEqual([{ first: 0, last: 0 }, { first: 1, last: 1 }, { first: 2, last: 2 }]);
    // 100 → 300은 3배라 늘리지 않는다
    expect(w.width[0]).toBe(100);
    expect(w.width[1]).toBe(500);
    expect(w.lineWidth).toBe(500);
    expect(wrapBars([], 300).systems).toEqual([]);
  });

  it("줄바꿈 배치의 시간 ↔ x: 줄 안 자리로, 누른 줄의 마디에서만 찾는다", () => {
    const w = wrapBars([100, 100, 100], 200);
    const anchors = new Map();
    // 둘째 마디(1~2)는 첫 줄 오른쪽 반, 셋째 마디(2~3)는 둘째 줄 왼쪽
    expect(timeToX(bars, w, anchors, 1.5)).toBe(150);
    expect(timeToX(bars, w, anchors, 2.5)).toBe(50);
    expect(xToTime(bars, w, anchors, 50, [2, 2])).toBeCloseTo(2.5, 9);
    expect(xToTime(bars, w, anchors, 150, [0, 1])).toBeCloseTo(1.5, 9);
  });

  it("재생선 따라 넘기기: 다른 줄로 넘어갈 때만 줄을 맞추고, 칸보다 높은 줄에서 아래로 내린 스크롤은 두며, 줄이 사라지면 다시 찾는다", () => {
    // 줄 높이 600, 칸 높이 400 (줄이 칸보다 높다)
    expect(followSystem({ system: 1, top: 600 }, 600, 0, 400, 0)).toBe(596);
    // 같은 줄에서 아래 단을 보려고 내렸다 (줄 위 끝이 화면 위로 나감): 그대로 둔다
    expect(followSystem({ system: 1, top: 600 }, 600, 900, 400, 1)).toBeUndefined();
    expect(followSystem({ system: 1, top: 600 }, 600, 596, 400, 1)).toBeUndefined();
    // 같은 줄이지만 화면에서 완전히 사라졌다: 다시 찾는다
    expect(followSystem({ system: 1, top: 600 }, 600, 1300, 400, 1)).toBe(596);
    // 줄이 칸에 들어가면: 다 보이면 그대로, 다른 줄로 넘어가며 아래가 잘리면 넘긴다
    expect(followSystem({ system: 2, top: 400 }, 200, 300, 400, 1)).toBeUndefined();
    expect(followSystem({ system: 3, top: 600 }, 200, 300, 400, 2)).toBe(596);
  });
});

describe("조표 자리", () => {
  it("조표가 그려지는 마디만 자리를 더하고, 바뀐 마디는 지우는 제자리표 자리도", () => {
    expect(keyWidth({ fifths: 3 }, false)).toBe(0);
    expect(keyWidth({ fifths: 3 }, true)).toBe(38);
    // D장조(2) → B♭장조(-2): 올림표 둘을 지우고 내림표 둘
    expect(keyWidth({ fifths: -2, cancelKey: 2 }, true)).toBe(48);
    // A장조(3) → D장조(2): 지울 것은 하나
    expect(keyWidth({ fifths: 2, cancelKey: 3 }, true)).toBe(38);
    // 다장조로: 제자리표만
    expect(keyWidth({ fifths: 0, cancelKey: -4 }, true)).toBe(48);
  });

  it("줄바꿈 배치는 줄 첫 마디에 조표 자리를 더한다 (조표가 바뀐 마디와 다장조는 더하지 않는다)", () => {
    const bars = [
      { fifths: 2, showKey: true },
      { fifths: 2, showKey: false },
      { fifths: 2, showKey: false },
      { fifths: 0, showKey: true, cancelKey: 2 },
    ];
    const lead = keyLead(bars);
    expect([0, 1, 2, 3].map(lead)).toEqual([0, 28, 28, 0]);
    const w = wrapBars([150, 150, 150, 150], 300, lead);
    expect(w.systems).toEqual([
      { first: 0, last: 1 },
      { first: 2, last: 2 },
      { first: 3, last: 3 },
    ]);
    // 2번 마디는 줄 첫 마디라 자리가 더해졌다
    expect(w.width[2]).toBeGreaterThanOrEqual(178);
  });
});
