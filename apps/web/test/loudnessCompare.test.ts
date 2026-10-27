import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, rat, toFloat, type Song } from "@mmlce/core";
import { newSong, parseTrackText } from "@mmlce/mml";
import { barStarts, compareLoudness, computePower, correlation, type ReferencePower } from "../src/lib/loudnessCompare";

/** 피아노 한 트랙 곡 (t120이라 4/4 한 마디 = 2초) */
function song(text: string): Song {
  const s = newSong({ playerName: "피아노", trackName: "트랙 1" });
  return { ...s, tracks: s.tracks.map(({ mml: _mml, ...t }) => ({ ...t, notes: parseTrackText(t.id, { text }).notes })) };
}

/** 마디(2초)마다 정한 dB로 채운 원곡 전력 요약. lead초만큼 앞에 조용한 소리를 둔다 */
function reference(barDb: readonly number[], lead = 0): ReferencePower {
  const perSecond = 100;
  const power = new Float32Array(Math.round((lead + barDb.length * 2) * perSecond));
  power.fill(1e-6);
  barDb.forEach((db, i) => power.fill(10 ** (db / 10), Math.round((lead + i * 2) * perSecond), Math.round((lead + (i + 1) * 2) * perSecond)));
  return { perSecond, power };
}

const eight = "o4 l4 v8 " + "cdef ".repeat(8);

describe("원곡 대조 셈여림", () => {
  it("평평한 곡에 원곡이 커졌다 작아지면 큰 마디는 +, 작은 마디는 − 제안", () => {
    const r = compareLoudness(song(eight), reference([-20, -20, -10, -20, -20, -30, -20, -20]), 0, MOBILE_PROFILE);
    expect(r.bars).toHaveLength(8);
    const by = (bar: number) => r.bars.find((b) => b.bar === bar)!;
    expect(by(3).diff).toBeGreaterThan(3);
    expect(by(3).suggest).toBeGreaterThan(0);
    expect(by(6).diff).toBeLessThan(-3);
    expect(by(6).suggest).toBeLessThan(0);
    expect(by(2).suggest).toBeUndefined();
    // 기준 v는 그 마디 멜로디 v
    expect(by(3).baseVol).toBe(8);
  });

  it("원곡 모양을 이미 따라가면 차이가 작고 상관이 높다", () => {
    const text = "o4 l4 " + ["v8", "v8", "v12", "v8", "v6", "v4", "v8", "v10"].map((v) => `${v} cdef `).join("");
    const shape = [0, 0, 7, 0, -5, -12, 0, 4].map((d) => -20 + d);
    const r = compareLoudness(song(text), reference(shape), 0, MOBILE_PROFILE);
    expect(r.corrBar).toBeGreaterThan(0.95);
    for (const b of r.bars) expect(Math.abs(b.diff)).toBeLessThan(3);
  });

  it("원곡이 마디마다 같은 세기면 지금 곡의 큰·작은 마디를 고르게 맞추라고 보인다", () => {
    const r = compareLoudness(song("o4 l1 v4 c v12 c v4 c v12 c"), reference([-20, -20, -20, -20]), 0, MOBILE_PROFILE);
    expect(r.bars).toHaveLength(4);
    const loud = r.bars.filter((b) => b.baseVol === 12);
    const soft = r.bars.filter((b) => b.baseVol === 4);
    for (const b of loud) expect(b.diff).toBeLessThan(-3);
    for (const b of soft) expect(b.diff).toBeGreaterThan(3);
    // 목표는 모두 같다
    expect(new Set(r.bars.map((b) => b.target.toFixed(6))).size).toBe(1);
  });

  it("어긋남만큼 원곡 시각을 옮겨 읽는다", () => {
    const shape = [-20, -20, -10, -20, -20, -30, -20, -20];
    const r = compareLoudness(song(eight), reference(shape, 1.5), 1.5, MOBILE_PROFILE);
    expect(r.bars.find((b) => b.bar === 3)!.diff).toBeGreaterThan(3);
    expect(r.bars[0]!.refSeconds).toBeCloseTo(1.5);
    // 어긋남을 안 주면 같은 원곡이 다른 마디에 걸린다
    const off = compareLoudness(song(eight), reference(shape, 1.5), 0, MOBILE_PROFILE);
    expect(off.bars.find((b) => b.bar === 3)!.diff).toBeLessThan(off.bars.find((b) => b.bar === 4)!.diff + 3);
  });

  it("음이 시작하지 않는 마디와 원곡 밖 마디는 빼고, 구간을 주면 그 안만 센다", () => {
    const text = "o4 l4 v8 cdef r1 cdef cdef cdef";
    const short = compareLoudness(song(text), reference([-20, -20, -20]), 0, MOBILE_PROFILE);
    expect(short.bars.map((b) => b.bar)).toEqual([1, 3]);
    expect(short.skipped).toBe(3);
    const inRange = compareLoudness(song(text), reference([-20, -20, -20, -20, -20]), 0, MOBILE_PROFILE, [2, 4]);
    expect(inRange.bars.map((b) => b.bar)).toEqual([3, 4]);
  });

  it("& 사슬은 한 번 친 소리로 센다 (뒤 조각만 시작하는 마디는 뺀다)", () => {
    const r = compareLoudness(song("o4 v8 c1&c1 l4 cdef"), reference([-20, -20, -20]), 0, MOBILE_PROFILE);
    expect(r.bars.map((b) => b.bar)).toEqual([1, 3]);
  });

  it("곡을 바꾸지 않는다", () => {
    const s = song(eight);
    const before = JSON.stringify(s);
    compareLoudness(s, reference([-20, -10, -20, -30, -20, -20, -20, -20]), 0, MOBILE_PROFILE);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("v15에서 더 키우라면 0 (더 못 바꿈)", () => {
    const r = compareLoudness(song("o4 l4 v15 " + "cdef ".repeat(4)), reference([-20, -5, -20, -20]), 0, MOBILE_PROFILE);
    expect(r.bars.find((b) => b.bar === 2)!.suggest).toBe(0);
  });

  it("마디 시작: 곡 중간에 박자가 바뀌면 그 자리에서 새 마디", () => {
    const starts = barStarts([{ at: rat(0), beats: 4, unit: 4 }, { at: rat(3, 2), beats: 3, unit: 4 }], rat(3));
    expect(starts.map(toFloat)).toEqual([0, 1, 1.5, 2.25]);
  });

  it("전력 요약은 모노로 섞은 평균 제곱", () => {
    const ch = new Float32Array(200).fill(0.5);
    const p = computePower([ch, ch], 200, 100);
    expect(p.power).toHaveLength(100);
    expect(p.power[0]).toBeCloseTo(0.25);
  });

  it("상관: 셋보다 적거나 폭이 없으면 셀 수 없다", () => {
    expect(correlation([1, 2], [1, 2])).toBeUndefined();
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeUndefined();
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });
});
