import { describe, expect, it } from "vitest";
import { changeVolumes, dbOfVolume, MOBILE_PROFILE, rat, volumeForDb, volumeSpan, type Note } from "../src/index.js";

const note = (id: string, start: number, vol: number, tie: Note["tie"] = "none"): Note => ({ id, start: rat(start, 4), dur: rat(1, 4), pitch: 60, vol, tie });
const vols = (notes: readonly Note[]) => notes.map((n) => `${n.id}${n.vol}`).join(" ");

describe("볼륨 일괄 조정", () => {
  const base = [note("a", 0, 9), note("b", 1, 12), note("c", 2, 15)];

  it("한 값으로: 모든 음을 같은 v로, 같던 음은 바뀐 수에 넣지 않는다", () => {
    const r = changeVolumes(base, { kind: "set", vol: 12 }, MOBILE_PROFILE);
    expect(vols(r.notes)).toBe("a12 b12 c12");
    expect([r.count, r.changed, r.clamped]).toEqual([3, 2, 0]);
  });

  it("±N: v0~v15에서 멈추고 멈춘 수를 센다", () => {
    const up = changeVolumes(base, { kind: "shift", by: 2 }, MOBILE_PROFILE);
    expect(vols(up.notes)).toBe("a11 b14 c15");
    expect(up.clamped).toBe(1);
    const down = changeVolumes([note("a", 0, 1), note("b", 1, 5)], { kind: "shift", by: -3 }, MOBILE_PROFILE);
    expect(vols(down.notes)).toBe("a0 b2");
    expect(down.clamped).toBe(1);
  });

  it("긴 음 맞추기: 잃은 dB만큼 올리기만 하고, maxUp·v최대에서 멈춘 수를 따로 센다", () => {
    // a는 6dB 잃음(v9 −8.9dB → −2.9dB ≈ v13), b는 1dB만, c는 줄지 않음
    const loss = new Map([["a", 6], ["b", 1], ["c", -3]]);
    const lossDb = (chain: readonly Note[]) => loss.get(chain[0]!.id)!;
    const r = changeVolumes(base, { kind: "held", maxUp: 6, lossDb }, MOBILE_PROFILE);
    expect(vols(r.notes)).toBe("a13 b13 c15");
    expect([r.clamped, r.limited]).toEqual([0, 0]);
    const capped = changeVolumes(base, { kind: "held", maxUp: 2, lossDb }, MOBILE_PROFILE);
    expect(vols(capped.notes)).toBe("a11 b13 c15");
    // maxUp에서 멈춘 것은 게임 한도(clamped)가 아니라 limited로 센다
    expect([capped.clamped, capped.limited]).toEqual([0, 1]);
    // v15가 소리를 잃으면 더 올릴 수 없다: 게임 한도에 닿은 것으로 센다 (maxUp은 남아 있어도)
    const top = changeVolumes([note("t", 0, 15)], { kind: "held", maxUp: 6, lossDb: () => 3 }, MOBILE_PROFILE);
    expect([top.changed, top.clamped, top.limited]).toEqual([0, 1, 0]);
    // 잃은 dB를 모르면 그대로
    expect(changeVolumes(base, { kind: "held", maxUp: 3 }, MOBILE_PROFILE).changed).toBe(0);
  });

  it("목표 dB: dB = 40·log10(V/15)에 가장 가까운 v", () => {
    expect(dbOfVolume(MOBILE_PROFILE, 15)).toBe(0);
    expect(dbOfVolume(MOBILE_PROFILE, 0)).toBe(-Infinity);
    // 40·log10(V/15) = −6 → v11 (−5.39 dB)이 v10(−7.04 dB)보다 가깝다. −12 dB는 v8(−10.92)이 v7(−13.24)보다 가깝다
    expect(volumeForDb(MOBILE_PROFILE, -6)).toBe(11);
    expect(volumeForDb(MOBILE_PROFILE, -12)).toBe(8);
    expect(volumeForDb(MOBILE_PROFILE, 3)).toBe(15);
    // 아주 작은 dB여도 소리 나는 가장 작은 v1 (무음 v0은 -Infinity일 때만)
    expect(volumeForDb(MOBILE_PROFILE, -80)).toBe(1);
    expect(volumeForDb(MOBILE_PROFILE, -Infinity)).toBe(0);
    for (let v = 1; v <= 15; v++) expect(volumeForDb(MOBILE_PROFILE, dbOfVolume(MOBILE_PROFILE, v))).toBe(v);
    expect(vols(changeVolumes(base, { kind: "db", db: -6 }, MOBILE_PROFILE).notes)).toBe("a11 b11 c11");
  });

  it("고른 음만 바꾸고 나머지·자리·길이·높이는 그대로", () => {
    const r = changeVolumes(base, { kind: "shift", by: -1 }, MOBILE_PROFILE, new Set(["b"]));
    expect(vols(r.notes)).toBe("a9 b11 c15");
    expect(r.notes[0]).toBe(base[0]);
    expect(r.notes[1]).toMatchObject({ start: base[1]!.start, dur: base[1]!.dur, pitch: 60, tie: "none" });
  });

  it("& 사슬은 첫 음 v로 함께 바꾸고, 사슬 가운데 음만 골라도 사슬 전체를 바꾼다 (게임은 & 뒤 v를 읽지 않음)", () => {
    const tied = [note("a", 0, 9, "next"), note("b", 1, 9, "next"), note("c", 2, 9), note("d", 3, 9)];
    const whole = changeVolumes(tied, { kind: "shift", by: 3 }, MOBILE_PROFILE, new Set(["a"]));
    expect(vols(whole.notes)).toBe("a12 b12 c12 d9");
    expect([whole.count, whole.changed]).toEqual([1, 1]);
    const tail = changeVolumes(tied, { kind: "set", vol: 4 }, MOBILE_PROFILE, new Set(["b", "d"]));
    expect(vols(tail.notes)).toBe("a4 b4 c4 d4");
    expect([tail.count, tail.viaTie, tail.changed]).toEqual([2, 1, 2]);
    const shifted = changeVolumes(tied, { kind: "shift", by: -2 }, MOBILE_PROFILE, new Set(["c"]));
    expect(vols(shifted.notes)).toBe("a7 b7 c7 d9");
    expect(volumeSpan([note("a", 0, 9, "next"), note("b", 1, 3)], new Set(["b"]))).toEqual([9, 9]);
  });

  it("v 범위: 사슬 첫 음만 센다", () => {
    expect(volumeSpan([note("a", 0, 9, "next"), { ...note("b", 1, 3) }, note("c", 2, 13)])).toEqual([9, 13]);
    expect(volumeSpan(base, new Set())).toBeUndefined();
  });
});
