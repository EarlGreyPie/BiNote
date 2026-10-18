import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, rat, scaleNotesIn, type Note } from "@mmlce/core";
import { dotFactor, toggleDot } from "../src/lib/dotLength";

const P = MOBILE_PROFILE;
const len = (n: number, dotted = false) => (dotted ? rat(3, 2 * n) : rat(1, n));

describe("점 붙이기·떼기", () => {
  it("점 없는 길이에는 붙이고, 점 하나 붙은 길이에서는 뗀다", () => {
    expect(toggleDot(len(4), P)).toEqual(len(4, true));
    expect(toggleDot(len(4, true), P)).toEqual(len(4));
    expect(toggleDot(len(2, true), P)).toEqual(len(2));
    expect(toggleDot(len(16, true), P)).toEqual(len(16));
  });

  it("프로필 dots 1이면 32.·64.도 된다", () => {
    expect(P.length.dots).toBe(1);
    expect(toggleDot(len(32), P)).toEqual(len(32, true));
    expect(toggleDot(len(64), P)).toEqual(len(64, true));
  });

  it("점을 쓸 수 없는 프로필이면 붙이지 않는다 (숫자는 프로필에서 읽는다)", () => {
    expect(toggleDot(len(4), { ...P, length: { ...P.length, dots: 0 } })).toBeUndefined();
    expect(toggleDot(len(64), { ...P, length: { ...P.length, max: 32 } })).toBeUndefined();
  });

  it("셋잇단·이어 붙인 길이처럼 애매한 길이는 바꾸지 않는다", () => {
    expect(toggleDot(len(12), P)).toBeUndefined();
    expect(toggleDot(rat(5, 16), P)).toBeUndefined();
    expect(toggleDot(rat(5, 4), P)).toBeUndefined();
  });

  it("여러 음: 첫 음으로 붙일지 뗄지 정하고, 모두 같은 쪽으로 바꿀 수 있을 때만", () => {
    expect(dotFactor([len(4), len(8)], P)).toEqual(rat(3, 2));
    expect(dotFactor([len(4, true), len(8, true)], P)).toEqual(rat(2, 3));
    expect(dotFactor([len(4), len(8, true)], P)).toBeUndefined();
    expect(dotFactor([len(4), len(12)], P)).toBeUndefined();
    expect(dotFactor([], P)).toBeUndefined();
  });

  it("다음 음이 붙어 있으면 늘리지 않는다 (길이 ×2와 같은 규칙)", () => {
    const a: Note = { id: "a", start: rat(0), dur: len(4), pitch: 60, vol: 8, tie: "none" };
    const b: Note = { id: "b", start: len(4), dur: len(4), pitch: 62, vol: 8, tie: "none" };
    expect(scaleNotesIn([a, b], [a], dotFactor([a.dur], P)!)).toBeUndefined();
    expect(scaleNotesIn([a], [a], dotFactor([a.dur], P)!)![0]!.dur).toEqual(len(4, true));
  });
});
