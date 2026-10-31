import { describe, expect, it } from "vitest";
import { rat, toFloat, type Note, type Rat, type TimeSigEvent } from "@mmlce/core";
import { edgeScroll, EDGE_ZONE, freeDivision, nextBarStart, notesBeside, prevBarStart, songEnd } from "../src/lib/editNav";

const note = (id: string, start: [number, number], dur: [number, number]): Note => ({
  id,
  start: rat(...start),
  dur: rat(...dur),
  pitch: 60,
  vol: 8,
  tie: "none",
});

describe("마디 앞뒤로 가기", () => {
  it("박자표가 없으면 4/4로 한 마디(온음표)씩", () => {
    expect(nextBarStart([], rat(0))).toEqual(rat(1));
    expect(nextBarStart([], rat(3, 2))).toEqual(rat(2));
    expect(prevBarStart([], rat(3, 2))).toEqual(rat(1));
    expect(prevBarStart([], rat(1))).toEqual(rat(0));
    expect(prevBarStart([], rat(0))).toEqual(rat(0));
  });

  it("마디 가운데서 박자가 바뀌면 그 자리가 다음 마디 시작 (덜 찬 마디도 한 마디)", () => {
    // 3/4로 시작해 5/4(마디 가운데)에서 4/4로: 마디 시작은 0, 3/4, 5/4, 9/4
    const sig: TimeSigEvent[] = [
      { at: rat(0), beats: 3, unit: 4 },
      { at: rat(5, 4), beats: 4, unit: 4 },
    ];
    expect(nextBarStart(sig, rat(0))).toEqual(rat(3, 4));
    expect(nextBarStart(sig, rat(3, 4))).toEqual(rat(5, 4));
    expect(nextBarStart(sig, rat(1))).toEqual(rat(5, 4));
    expect(nextBarStart(sig, rat(5, 4))).toEqual(rat(9, 4));
    expect(prevBarStart(sig, rat(9, 4))).toEqual(rat(5, 4));
    expect(prevBarStart(sig, rat(5, 4))).toEqual(rat(3, 4));
    expect(prevBarStart(sig, rat(1))).toEqual(rat(3, 4));
    expect(prevBarStart(sig, rat(3, 4))).toEqual(rat(0));
  });

  it("셋잇단 자리도 분수 그대로 센다", () => {
    expect(nextBarStart([], rat(1, 3))).toEqual(rat(1));
    expect(prevBarStart([], rat(4, 3))).toEqual(rat(1));
  });

  it("재생 중에 마디 첫머리를 막 지났으면 한 마디 더 앞으로 (거듭 눌러도 같은 마디에 걸리지 않게)", () => {
    // 재생선이 2마디째 첫머리(1)를 1/8 지난 자리: 막 지났다고 보면 0으로, 아니면 1로
    const near = (at: Rat) => (bar: Rat) => toFloat(at) - toFloat(bar) < 1 / 4;
    expect(prevBarStart([], rat(9, 8), near(rat(9, 8)))).toEqual(rat(0));
    expect(prevBarStart([], rat(7, 4), near(rat(7, 4)))).toEqual(rat(1));
    // 첫 마디 안에서는 곡 처음보다 앞으로 가지 않는다
    expect(prevBarStart([], rat(1, 8), near(rat(1, 8)))).toEqual(rat(0));
    // 마디선 바로 위는 그대로 앞 마디 (한 번만 물러난다)
    expect(prevBarStart([], rat(2), () => true)).toEqual(rat(1));
  });
});

describe("곡 끝", () => {
  it("모든 트랙에서 가장 늦게 끝나는 음의 끝, 음이 없으면 0", () => {
    expect(songEnd([])).toEqual(rat(0));
    expect(songEnd([{ notes: [note("a", [0, 1], [1, 4])] }, { notes: [note("b", [5, 6], [1, 12])] }])).toEqual(rat(11, 12));
  });
});

describe("커서 앞·뒤 음 고르기", () => {
  const notes = [note("a", [0, 1], [1, 4]), note("b", [1, 4], [1, 4]), note("c", [1, 2], [1, 4])];
  it("앞은 시작이 커서보다 앞, 뒤는 시작이 커서 자리이거나 그 뒤", () => {
    expect(notesBeside(notes, rat(1, 4), "before")).toEqual(["a"]);
    expect(notesBeside(notes, rat(1, 4), "after")).toEqual(["b", "c"]);
    // 커서가 음 가운데면 그 음은 앞쪽
    expect(notesBeside(notes, rat(3, 8), "before")).toEqual(["a", "b"]);
  });
});

describe("끄는 동안 격자 끄기", () => {
  it("게임 최단 길이 칸으로, 지금 격자가 더 잘면 그대로", () => {
    expect(freeDivision(8, 64)).toBe(64);
    expect(freeDivision(16, 32)).toBe(32);
    expect(freeDivision(64, 32)).toBe(64);
  });
});

describe("가장자리 자동 넘김", () => {
  it("끝 띠 안쪽 깊을수록·화면 밖일수록 빠르고, 가운데는 넘기지 않는다", () => {
    expect(edgeScroll(300, 600)).toBe(0);
    expect(edgeScroll(600 - EDGE_ZONE / 2, 600)).toBeCloseTo(0.5);
    expect(edgeScroll(700, 600)).toBe(1);
    expect(edgeScroll(EDGE_ZONE / 2, 600)).toBeCloseTo(-0.5);
    expect(edgeScroll(-50, 600)).toBe(-1);
  });
  it("화면이 띠 두 개보다 좁으면 넘기지 않는다", () => {
    expect(edgeScroll(5, EDGE_ZONE * 2)).toBe(0);
  });
});
