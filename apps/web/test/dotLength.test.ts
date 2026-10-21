import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, rat, scaleNotesIn, type Note } from "@mmlce/core";
import { dotFactor, toggleDot } from "../src/lib/dotLength";
import { scalePicked } from "../src/lib/tabSelect";

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

  it("점은 정확히 붙이거나 아예 안 붙인다: 뒤 쉼표가 모자라면 다음 음 앞까지 어중간하게 늘리지 않는다", () => {
    const a: Note = { id: "a", start: rat(0), dur: len(4), pitch: 60, vol: 8, tie: "none" };
    // c4 r16 d: 점4분음표는 1/8이 더 필요한데 1/16밖에 없다
    const b: Note = { id: "b", start: rat(5, 16), dur: len(4), pitch: 62, vol: 8, tie: "none" };
    const f = dotFactor([a.dur], P)!;
    expect(scaleNotesIn([a, b], [a], f, undefined, true)).toBeUndefined();
    // 길이 ×2 같은 다른 길이 바꾸기는 지금처럼 다음 음 앞까지 늘린다
    expect(scaleNotesIn([a, b], [a], f)![0]!.dur).toEqual(rat(5, 16));
    // 딱 맞는 자리는 된다 (c4 r8 d)
    const c: Note = { ...b, start: rat(3, 8) };
    expect(scaleNotesIn([a, c], [a], f, undefined, true)![0]!.dur).toEqual(len(4, true));
  });

  it("타브 커서 음: 점을 붙였다가 다시 누르면 뗀다. 다음 음과 겹치면 아무 트랙도 바꾸지 않는다", () => {
    const a: Note = { id: "a", start: rat(0), dur: len(4), pitch: 60, vol: 8, tie: "none" };
    const b: Note = { id: "b", start: rat(1, 2), dur: len(4), pitch: 62, vol: 8, tie: "none" };
    const dotted = scalePicked([{ id: "t", notes: [a, b] }], new Set(["a"]), dotFactor([a.dur], P)!, true)!;
    const a2 = dotted[0]!.notes.find((n) => n.id === "a")!;
    expect(a2.dur).toEqual(len(4, true));
    const back = scalePicked([{ id: "t", notes: dotted[0]!.notes }], new Set(["a"]), dotFactor([a2.dur], P)!, true)!;
    expect(back[0]!.notes.find((n) => n.id === "a")!.dur).toEqual(len(4));
    // 화음: 한 트랙이라도 겹치면 통째로 그만둔다 (뒤 음은 그대로)
    const x: Note = { ...a, id: "x" };
    const y: Note = { ...b, id: "y", start: rat(5, 16) };
    expect(scalePicked([{ id: "t", notes: [a, b] }, { id: "u", notes: [x, y] }], new Set(["a", "x"]), dotFactor([a.dur], P)!, true)).toBeUndefined();
  });
});
