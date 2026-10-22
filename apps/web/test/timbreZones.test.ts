import { describe, expect, it } from "vitest";
import { crossesTimbre, MOBILE_PROFILE, soundingRangeOf, timbreBoundaries } from "@mmlce/core";
import { zoneIndex, zoneRows } from "../src/lib/timbreZones";

describe("음색 구간 줄", () => {
  const piano = timbreBoundaries(MOBILE_PROFILE, "piano");
  const pianoRange = soundingRangeOf(MOBILE_PROFILE, "piano");

  it("경계 바로 위 음부터 다음 구간", () => {
    expect(zoneIndex(piano, 51, pianoRange)).toBe(0);
    expect(zoneIndex(piano, 52, pianoRange)).toBe(1);
    expect(zoneIndex(piano, 64, pianoRange)).toBe(2);
  });

  it("범위 안 경계 줄은 실선 경계, 그 사이는 경계 아님", () => {
    const rows = zoneRows(piano, pianoRange, 28, 100);
    const edges = [...rows].filter(([, r]) => r.edge && r.inside).map(([p]) => p);
    expect(edges).toEqual(piano);
  });

  it("범위 밖은 접힌 높이의 구간을 따르고 경계는 범위 밖 표시", () => {
    const rows = zoneRows(piano, pianoRange, 12, 119);
    // o7f(101)는 o6f(89)로 접혀 o7e(100)와 같은 구간: 범위 끝에 경계 없음
    expect(rows.get(101)?.edge).toBe(false);
    expect(rows.get(101)?.zone).toBe(rows.get(100)?.zone);
    // 피아노는 범위 위아래가 끝 구간과 같아 범위 밖 경계가 없다
    expect([...rows].some(([, r]) => r.edge && !r.inside)).toBe(false);
    // 고양이 하모니카(o4a~)는 아래로 접히는 줄에서 구간이 되풀이된다: 범위 밖 경계는 옅은 점선
    const cat = timbreBoundaries(MOBILE_PROFILE, "cat-harmonica");
    const catRange = soundingRangeOf(MOBILE_PROFILE, "cat-harmonica");
    const catRows = zoneRows(cat, catRange, 12, 119);
    const outside = [...catRows].filter(([, r]) => r.edge && !r.inside).map(([p]) => p);
    expect(outside).toContain(69);
    expect(outside).toContain(68);
    for (const p of outside) expect(p - 1 < catRange.low || p > catRange.high).toBe(true);
  });

  it("& 경고와 같은 규칙: 구간 번호가 다르면 경계를 넘는다", () => {
    for (const inst of ["piano", "flute", "violin", "cat-harmonica", "chalumeau"]) {
      const b = timbreBoundaries(MOBILE_PROFILE, inst);
      const r = soundingRangeOf(MOBILE_PROFILE, inst);
      for (let a = 20; a <= 110; a += 3) {
        for (let c = 20; c <= 110; c += 5) {
          expect(zoneIndex(b, a, r) !== zoneIndex(b, c, r)).toBe(crossesTimbre(MOBILE_PROFILE, inst, a, c));
        }
      }
    }
  });

  it("오르골 맨 위 경계는 o6f(89)", () => {
    expect(timbreBoundaries(MOBILE_PROFILE, "music-box")).toEqual([52, 66, 80, 89]);
  });

  it("샬루모는 o2f·o2f+가 같은 구간 (맨 아래 경계 o3g+)", () => {
    expect(timbreBoundaries(MOBILE_PROFILE, "chalumeau")).toEqual([56, 70, 82]);
  });

  it("경계가 없는 악기는 그리지 않는다", () => {
    expect(zoneRows([], pianoRange, 28, 100).size).toBe(0);
  });
});
