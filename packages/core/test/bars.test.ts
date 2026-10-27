import { describe, expect, it } from "vitest";
import { barAt, barBeatAt, barsOfRange, changeVolumes, headsInBars, inBars, MOBILE_PROFILE, parseBarList, rat, volumeSpan, type Note } from "../src/index.js";

describe("마디 번호 (분수로 정확히)", () => {
  it("박자표가 없으면 4/4, 마디선 위는 그 마디", () => {
    expect(barAt([], rat(0))).toBe(1);
    expect(barAt([], rat(1))).toBe(2);
    expect(barAt([], rat(5, 4))).toBe(2);
    expect(barAt([], rat(1999, 1000))).toBe(2);
    // l7 같은 칸에 안 맞는 자리도 반올림하지 않는다
    expect(barAt([], rat(6, 7))).toBe(1);
    expect(barAt([], rat(8, 7))).toBe(2);
  });

  it("박자가 바뀌면 거기서 새 마디, 덜 찬 마디도 한 마디 (barBeatAt과 같은 번호)", () => {
    // 4/4 한 마디 반 뒤 3/4: 1.5에서 3마디가 시작한다
    const sigs = [{ at: rat(0), beats: 4, unit: 4 }, { at: rat(3, 2), beats: 3, unit: 4 }];
    expect(barAt(sigs, rat(1))).toBe(2);
    expect(barAt(sigs, rat(3, 2))).toBe(3);
    expect(barAt(sigs, rat(9, 4))).toBe(4);
    for (let k = 0; k < 40; k++) expect(barAt(sigs, rat(k, 8))).toBe(barBeatAt(sigs, rat(k, 8)).bar);
  });

  it("반복 구간이 걸친 마디. 끝이 마디선이면 그 마디는 넣지 않는다", () => {
    expect(barsOfRange([], rat(1), rat(3))).toEqual([2, 3]);
    expect(barsOfRange([], rat(5, 4), rat(9, 4))).toEqual([2, 3]);
    expect(barsOfRange([], rat(1, 2), rat(1, 2))).toEqual([1, 1]);
    const sigs = [{ at: rat(0), beats: 4, unit: 4 }, { at: rat(3, 2), beats: 3, unit: 4 }];
    expect(barsOfRange(sigs, rat(1), rat(3, 2))).toEqual([2, 2]);
  });
});

describe("마디 적기 읽기", () => {
  it("범위·낱개·끝까지", () => {
    expect(parseBarList("12-16, 20")).toEqual([[12, 16], [20, 20]]);
    expect(parseBarList(" 3 5  7 ")).toEqual([[3, 3], [5, 5], [7, 7]]);
    expect(parseBarList("20-")).toEqual([[20, Infinity]]);
    expect(parseBarList("12 - 16")).toEqual([[12, 16]]);
  });
  it("~·– 도 -로, 거꾸로 적어도 바로잡는다", () => {
    expect(parseBarList("12~16，20–22")).toEqual([[12, 16], [20, 22]]);
    expect(parseBarList("16-12")).toEqual([[12, 16]]);
  });
  it("읽을 수 없으면 undefined", () => {
    for (const bad of ["", "  ", "0", "a", "3-x", "-5", "1.5", "1--3", "5,,a"]) expect(parseBarList(bad)).toBeUndefined();
  });
  it("범위 안", () => {
    const r = parseBarList("2-3, 6-")!;
    expect([1, 2, 3, 4, 6, 99].map((b) => inBars(r, b))).toEqual([false, true, true, false, true, true]);
  });
});

describe("마디만 볼륨 바꾸기", () => {
  // 4/4, 4분음표 하나 = 1/4. 1마디: a b c d(&), 2마디: e f g(&), 3마디: h i. d&e는 마디를 넘어 이어지고 g&h도 그렇다
  const n = (id: string, q: number, vol: number, tie: Note["tie"] = "none"): Note => ({ id, start: rat(q, 4), dur: rat(1, 4), pitch: 60, vol, tie });
  const notes = [n("a", 0, 9), n("b", 1, 9), n("c", 2, 9), n("d", 3, 9, "next"), n("e", 4, 9), n("f", 5, 9), n("g", 7, 9, "next"), n("h", 8, 9), n("i", 9, 9)];
  const vols = (ns: readonly Note[]) => ns.map((x) => `${x.id}${x.vol}`).join(" ");

  it("범위 안에서 시작하는 소리만. 앞에서 &로 들어온 사슬은 그대로, 밖으로 이어 나가는 사슬은 함께", () => {
    // d&e는 1마디에서 시작하므로 2마디만 고르면 빠진다. g&h는 2마디에서 시작해 3마디로 이어진다
    const picked = headsInBars(notes, [], [[2, 2]]);
    expect([...picked].sort()).toEqual(["f", "g"]);
    const r = changeVolumes(notes, { kind: "set", vol: 13 }, MOBILE_PROFILE, picked);
    expect(vols(r.notes)).toBe("a9 b9 c9 d9 e9 f13 g13 h13 i9");
    expect([r.count, r.changed, r.viaTie]).toEqual([2, 2, 0]);
    expect(volumeSpan(r.notes, picked)).toEqual([13, 13]);
    // 음 자리·길이는 그대로 (끝 길이가 바뀌지 않는다)
    expect(r.notes.map((x) => [x.start, x.dur])).toEqual(notes.map((x) => [x.start, x.dur]));
  });

  it("범위에 소리가 없으면 아무것도 바뀌지 않는다", () => {
    const picked = headsInBars(notes, [], [[9, 12]]);
    expect(picked.size).toBe(0);
    const r = changeVolumes(notes, { kind: "shift", by: 2 }, MOBILE_PROFILE, picked);
    expect([r.count, r.changed]).toEqual([0, 0]);
    expect(r.notes.every((x, i) => x === notes[i])).toBe(true);
  });

  it("여러 범위와 끝까지", () => {
    const picked = headsInBars(notes, [], parseBarList("1, 3-")!);
    expect([...picked].sort()).toEqual(["a", "b", "c", "d", "i"]);
  });
});
