import { rat } from "@mmlce/core";
import { describe, expect, it } from "vitest";
import { computePeaks, peakRange, wholeToSecondsFn } from "../src/lib/waveform";

describe("원곡 파형 요약", () => {
  // 1초에 10칸, 표본 100개/초: 앞 0.5초 조용, 뒤 0.5초 ±0.8
  const left = new Float32Array(100).map((_, i) => (i < 50 ? 0 : i % 2 ? 0.8 : -0.8));
  const right = new Float32Array(100).map((_, i) => (i < 50 ? 0 : i % 2 ? 0.4 : -0.4));

  it("칸마다 채널을 섞은 가장 낮은·높은 값", () => {
    const p = computePeaks([left, right], 100, 10);
    expect(p.min.length).toBe(10);
    expect(p.max[0]).toBe(0);
    expect(p.max[9]).toBeCloseTo(0.6);
    expect(p.min[9]).toBeCloseTo(-0.6);
    expect(p.peak).toBeCloseTo(0.6);
  });

  it("시간 구간의 범위, 원곡 밖이면 없음", () => {
    const p = computePeaks([left], 100, 10);
    expect(peakRange(p, 0, 0.4)).toEqual([0, 0]);
    expect(peakRange(p, 0.45, 0.55)![1]).toBeCloseTo(0.8);
    expect(peakRange(p, -1, -0.5)).toBeUndefined();
    expect(peakRange(p, 2, 3)).toBeUndefined();
  });
});

describe("곡 위치 → 초 (화면용)", () => {
  it("템포가 바뀌는 곡: t120 온음표 2초, 2마디부터 t60이면 온음표 4초", () => {
    const sec = wholeToSecondsFn([
      { at: rat(0, 1), bpm: 120 },
      { at: rat(2, 1), bpm: 60 },
    ]);
    expect(sec(1)).toBe(2);
    expect(sec(2)).toBe(4);
    expect(sec(2.5)).toBe(6);
  });

  it("템포가 없으면 t120", () => {
    expect(wholeToSecondsFn([])(1.5)).toBe(3);
  });
});
