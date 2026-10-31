import { describe, expect, it } from "vitest";
import { chainFadeEnd, chainSampleEnd, decayDbAt, heldMeanDb, foldPitch, getProfile, INSTRUMENTS, instrumentByName, isPending, LAB_STEP_MAX, maxChordsOf, MOBILE_PROFILE, pendingIn, pendingItem, sampleSecondsAt, soundingRangeOf, TRILL_VOLUME_DEPTH_LIMIT, volumeStepMax, type GameProfile } from "../src/index.js";

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

describe("소리 줄어듦 (기타, 팩 샘플로 잼)", () => {
  const P = MOBILE_PROFILE;
  const G = "folk-guitar";

  it("구간 첫 음은 잰 점 그대로, 점 사이는 dB를 곧게 잇는다", () => {
    expect(decayDbAt(P, G, 40, 0)).toBe(0);
    expect(decayDbAt(P, G, 40, 3.84)).toBeCloseTo(-20, 6);
    expect(decayDbAt(P, G, 40, (1.74 + 3.84) / 2)).toBeCloseTo(-16, 6);
    expect(decayDbAt(P, G, 77, 0.95)).toBeCloseTo(-20, 6);
  });

  it("한 옥타브 위면 두 배 빨리 줄고, 샘플이 끝나면 소리 없음", () => {
    expect(decayDbAt(P, G, 52 + 11, 3.92 * 2 ** (-11 / 12))).toBeCloseTo(-20, 6);
    expect(decayDbAt(P, G, 40, 5.3)).toBe(-Infinity);
  });

  it("o5e → o5f에서 20dB 줄어드는 시각이 네 배쯤 짧아진다", () => {
    const t20 = (pitch: number) => chainFadeEnd(P, G, [{ at: 0, pitch }], 20);
    expect(t20(76)).toBeGreaterThan(1.8);
    expect(t20(77)).toBeLessThan(1);
  });

  it("다른 음 붙임은 샘플 위치를 이어 간다 (샘플 끝과 같은 식)", () => {
    const steps = [{ at: 0, pitch: 64 }, { at: 1, pitch: 66 }];
    const t20 = chainFadeEnd(P, G, steps, 20);
    // 1초 동안 o4e로 1초 나아가고, o4f+에서는 2^(2/12)배로 나아간다
    expect(t20).toBeCloseTo(1 + (3.68 - 1) / 2 ** (2 / 12), 6);
    expect(chainFadeEnd(P, G, steps, 99)).toBe(chainSampleEnd(P, G, steps));
  });

  it("잰 마지막 점보다 깊은 줄어듦도 끝 dB와 같은 기울기로 셈한다 (피아노 o2e 4초: 끝 -31dB쯤이면 30dB 시각이 그 앞)", () => {
    const end = decayDbAt(P, "piano", 40, 4);
    expect(end).toBeLessThan(-30);
    expect(chainFadeEnd(P, "piano", [{ at: 0, pitch: 40 }], 30)).toBeLessThan(4);
    expect(decayDbAt(P, "piano", 40, chainFadeEnd(P, "piano", [{ at: 0, pitch: 40 }], 30))).toBeCloseTo(-30, 6);
  });

  it("두 점이 같은 시각이어도 샘플이 끝나기 전에는 소리 있음 (플루트 o7e)", () => {
    expect(decayDbAt(P, "flute", 88, 5.365)).toBeGreaterThan(-Infinity);
  });

  it("울리는 동안 평균 크기: 짧으면 거의 0, 길수록 작고, 끝 크기보다는 크다", () => {
    expect(heldMeanDb(P, G, 64, 0.05)).toBeGreaterThan(-1);
    expect(heldMeanDb(P, G, 64, 3)).toBeLessThan(heldMeanDb(P, G, 64, 1));
    expect(heldMeanDb(P, G, 64, 3)).toBeGreaterThan(decayDbAt(P, G, 64, 3));
    expect(heldMeanDb({ ...P, sampleDecay: {} }, G, 64, 3)).toBe(0);
  });

  it("감쇠를 모르는 악기는 샘플 끝까지 줄지 않는다고 본다", () => {
    const none = { ...P, sampleDecay: {} };
    expect(decayDbAt(none, G, 60, 1)).toBe(0);
    expect(chainFadeEnd(none, G, [{ at: 0, pitch: 60 }], 20)).toBe(chainSampleEnd(none, G, [{ at: 0, pitch: 60 }]));
  });

  it("지속음(플루트)은 샘플 끝 가까이까지 줄지 않고, 늦게 커지는 하모니카는 처음이 작다", () => {
    expect(decayDbAt(P, "flute", 52, 3)).toBeGreaterThan(-6);
    expect(chainFadeEnd(P, "flute", [{ at: 0, pitch: 52 }], 20)).toBeGreaterThan(5);
    expect(decayDbAt(P, "harmonica", 40, 0.01)).toBeLessThan(-8);
    expect(decayDbAt(P, "harmonica", 40, 1.91)).toBeCloseTo(0, 6);
  });

  it("40dB까지 재지 못한 깊이는 샘플 끝으로 본다 (샬루모 o5a+는 13dB만 줄고 끊긴다)", () => {
    const steps = [{ at: 0, pitch: 70 }];
    expect(chainFadeEnd(P, "chalumeau", steps, 20)).toBe(chainSampleEnd(P, "chalumeau", steps));
  });
});

describe("실측 전 항목 (pending)", () => {
  const keys = MOBILE_PROFILE.pending.map((p) => p.key);

  it("항목마다 이름이 하나씩이고 설명과 적은 날이 있다", () => {
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of MOBILE_PROFILE.pending) {
      expect(p.note.length).toBeGreaterThan(0);
      expect(p.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("이미 실측한 볼륨 곡선·악기별 음역·트레몰로 빠르기는 실측 전이 아니다", () => {
    for (const measured of ["volumeCurve", "soundingRangeInstruments", "ornamentFastRate"]) expect(keys).not.toContain(measured);
  });

  it("주석에만 있던 실측 전 항목이 목록에 있다", () => {
    for (const key of ["fourthTrackSound", "mobileInstrumentPrograms", "trillVolumePattern", "tieBendLimit", "lengthAfterTie", "octaveCrossingAccidental"] as const)
      expect(isPending(MOBILE_PROFILE, key)).toBe(true);
  });

  it("악기를 주면 그 악기에 걸린 항목만 실측 전으로 본다", () => {
    expect(isPending(MOBILE_PROFILE, "sampleDecay", "cat-harmonica")).toBe(true);
    expect(isPending(MOBILE_PROFILE, "sampleDecay", "piano")).toBe(false);
    // 악기 목록이 없는 항목은 어느 악기든 실측 전
    expect(isPending(MOBILE_PROFILE, "tieBendLimit", "piano")).toBe(true);
    expect(pendingItem(MOBILE_PROFILE, "sampleDecay", "cymbal")?.scope).toBe("sound");
    // 목록에서 지우면(실측하면) 더는 실측 전이 아니다
    const measured: GameProfile = { ...MOBILE_PROFILE, pending: MOBILE_PROFILE.pending.filter((p) => p.key !== "tieBendLimit") };
    expect(isPending(measured, "tieBendLimit")).toBe(false);
  });

  it("곳(scope)마다 고를 수 있다", () => {
    const syntax = pendingIn(MOBILE_PROFILE, "syntax").map((p) => p.key);
    expect(syntax).toContain("lengthAfterTie");
    expect(syntax).not.toContain("sampleDecay");
  });

  it("감쇠가 실측 전인 악기는 감쇠 값이 없고, 감쇠 값이 있는 악기는 실측 전이 아니다", () => {
    for (const id of pendingItem(MOBILE_PROFILE, "sampleDecay")!.instruments!) expect(MOBILE_PROFILE.sampleDecay[id]).toBeUndefined();
    for (const id of Object.keys(MOBILE_PROFILE.sampleDecay)) expect(isPending(MOBILE_PROFILE, "sampleDecay", id)).toBe(false);
    // 새 악기를 더하면 감쇠를 재서 넣거나 실측 전으로 적어야 한다 (둘 다 없으면 검사기가 아는 것으로 읽는다)
    for (const { id } of INSTRUMENTS) expect(MOBILE_PROFILE.sampleDecay[id] !== undefined || isPending(MOBILE_PROFILE, "sampleDecay", id), id).toBe(true);
  });

  it("악기 번호가 실측 전인 악기는 악기 목록에도 번호가 없다", () => {
    const unknown = INSTRUMENTS.filter((i) => i.program === undefined).map((i) => i.id);
    expect([...pendingItem(MOBILE_PROFILE, "mobileInstrumentPrograms")!.instruments!].sort()).toEqual([...unknown].sort());
  });
});

describe("프로필에서 계산하는 한도", () => {
  it("v 단계 상한은 v 범위 전체", () => {
    expect(volumeStepMax(MOBILE_PROFILE)).toBe(15);
    expect(volumeStepMax({ ...MOBILE_PROFILE, volume: { min: 1, max: 20 } })).toBe(19);
    // 프로필이 닿지 않는 설정 읽기용 상수도 모바일 프로필에서 계산한다
    expect(LAB_STEP_MAX).toBe(volumeStepMax(MOBILE_PROFILE));
    expect(TRILL_VOLUME_DEPTH_LIMIT).toBe(volumeStepMax(MOBILE_PROFILE));
  });

  it("붙인 음을 다시 치지 않는 높이 차는 프로필 값", () => {
    expect(MOBILE_PROFILE.tieBendLimit).toBe(24);
  });
});
