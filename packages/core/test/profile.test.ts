import { describe, expect, it } from "vitest";
import { foldPitch, getProfile, instrumentByName, maxChordsOf, MOBILE_PROFILE, sampleSecondsAt, soundingRangeOf } from "../src/index.js";

describe("MOBILE_PROFILE", () => {
  it("확인된 인게임 한도", () => {
    expect(MOBILE_PROFILE.charLimitPerScore).toBe(2400);
    expect(MOBILE_PROFILE.maxChordsPerPlayer).toBe(6);
    expect(MOBILE_PROFILE.tempo).toEqual({ min: 32, max: 255 });
    expect(MOBILE_PROFILE.length).toEqual({ min: 1, max: 64, dots: 1 });
  });

  it("볼륨 곡선 길이가 볼륨 범위와 맞는다", () => {
    const { min, max } = MOBILE_PROFILE.volume;
    expect(MOBILE_PROFILE.volumeCurve).toHaveLength(max - min + 1);
    expect(MOBILE_PROFILE.volumeCurve.at(-1)).toBe(0);
  });

  it("모르는 프로필은 오류", () => {
    expect(() => getProfile("nope")).toThrow();
  });
});

describe("v 음량 곡선 (실측)", () => {
  it("dB = 40·log10(v/15): v1 -47.04, v8 -10.92, v14 -1.20", () => {
    const curve = MOBILE_PROFILE.volumeCurve;
    expect(curve[1]).toBeCloseTo(-47.04, 2);
    expect(curve[8]).toBeCloseTo(-10.92, 2);
    expect(curve[14]).toBeCloseTo(-1.2, 2);
    expect(curve[0]).toBe(-Infinity);
  });
});

describe("축음기 (2026-10-16 실측)", () => {
  it("프리셋 이름 Gramophone을 알아보고 악보 하나에 3트랙", () => {
    expect(instrumentByName("Gramophone")?.id).toBe("gramophone");
    expect(maxChordsOf(MOBILE_PROFILE, "gramophone")).toBe(3);
  });

  it("o1e~o7e 밖은 옥타브째 접힌다", () => {
    const range = soundingRangeOf(MOBILE_PROFILE, "gramophone");
    expect(range).toEqual({ low: 28, high: 100 });
    expect(foldPitch(24, range)).toBe(36);
    expect(foldPitch(113, range)).toBe(89);
  });

  it("6초 녹음 음 길이와 0.05초 안에서 맞는다", () => {
    const measured: [number, number][] = [[50, 2.99], [52, 5.32], [64, 2.67], [66, 4.74], [78, 2.37], [80, 4.22], [88, 2.66], [90, 4.74], [100, 2.66]];
    for (const [pitch, seconds] of measured) expect(Math.abs(sampleSecondsAt(MOBILE_PROFILE, "gramophone", pitch)! - seconds)).toBeLessThan(0.05);
  });
});
