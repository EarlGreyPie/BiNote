import { describe, expect, it } from "vitest";
import { barAt, barBeatAt, barBounds, gridLines, measureStart, meterGrid, rat } from "../src/index.js";

const kinds = (lines: ReturnType<typeof gridLines>) => lines.map((l) => (l.kind === "measure" ? `|${l.bar}` : l.kind === "beat" ? "b" : "."));

describe("박자 격자 (MMLCS 규칙)", () => {
  it("3/4는 4분음표 박 셋, 6/8은 8분 셋이 한 박인 겹박자", () => {
    expect(meterGrid({ beats: 3, unit: 4 })).toEqual({ unit: rat(1, 4), beat: rat(1, 4), measure: rat(3, 4) });
    expect(meterGrid({ beats: 6, unit: 8 })).toEqual({ unit: rat(1, 8), beat: rat(3, 8), measure: rat(3, 4) });
    // 3/8은 겹박자가 아니다
    expect(meterGrid({ beats: 3, unit: 8 }).beat).toEqual(rat(1, 8));
  });

  it("마디선·박선·칸선과 마디 번호", () => {
    expect(kinds(gridLines([{ at: rat(0), beats: 6, unit: 8 }], 0, 1.5))).toEqual(["|1", ".", ".", "b", ".", ".", "|2", ".", ".", "b", ".", "."]);
  });

  it("곡 중간에 박자가 바뀌면 그 자리에서 새 마디를 센다", () => {
    const sigs = [{ at: rat(0), beats: 4, unit: 4 }, { at: rat(2), beats: 3, unit: 4 }];
    const bars = gridLines(sigs, 0, 3.5).filter((l) => l.kind === "measure").map((l) => [l.at, l.bar]);
    expect(bars).toEqual([[0, 1], [1, 2], [2, 3], [2.75, 4]]);
    // 보이는 범위가 중간부터여도 번호는 이어진다
    expect(gridLines(sigs, 2.5, 3.5).filter((l) => l.kind === "measure").map((l) => l.bar)).toEqual([4]);
    expect(measureStart(sigs, rat(3))).toEqual(rat(11, 4));
  });
});

describe("마디·박 위치", () => {
  it("박자 바뀜을 따라 마디를 세고 박은 1부터", () => {
    const sigs = [{ at: rat(0), beats: 4, unit: 4 }, { at: rat(2), beats: 6, unit: 8 }];
    expect(barBeatAt(sigs, rat(0))).toEqual({ bar: 1, beat: 1 });
    expect(barBeatAt(sigs, rat(5, 4))).toEqual({ bar: 2, beat: 2 });
    // 6/8: 박 하나 = 8분 셋
    expect(barBeatAt(sigs, rat(2 * 8 + 3, 8))).toEqual({ bar: 3, beat: 2 });
    expect(barBeatAt(sigs, rat(11, 4))).toEqual({ bar: 4, beat: 1 });
  });
});

describe("barBounds: 마디 번호의 [시작, 끝)", () => {
  it("박자표가 없으면 4/4, 박자가 바뀌면 덜 찬 마디도 한 마디 (barAt과 같은 규칙)", () => {
    expect(barBounds([], 1)).toEqual([rat(0), rat(1)]);
    expect(barBounds([], 3)).toEqual([rat(2), rat(3)]);
    // 4/4 → 3/4이 3/2(1마디 반)에서: 1마디 [0,1), 2마디 [1,3/2) 덜 찬 마디, 3마디부터 3/4
    const sig = [
      { at: rat(0), beats: 4, unit: 4 },
      { at: rat(3, 2), beats: 3, unit: 4 },
    ];
    expect(barBounds(sig, 2)).toEqual([rat(1), rat(3, 2)]);
    expect(barBounds(sig, 3)).toEqual([rat(3, 2), rat(9, 4)]);
    expect(barBounds(sig, 4)).toEqual([rat(9, 4), rat(3)]);
    for (const k of [1, 2, 3, 4, 7]) expect(barAt(sig, barBounds(sig, k)[0])).toBe(k);
  });
});
