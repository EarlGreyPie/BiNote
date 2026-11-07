import { barsOfRange, rat, toFloat, type Rat } from "@mmlce/core";
import { describe, expect, it } from "vitest";
import { exactTime } from "../src/lib/roll";
import { loopEnds } from "../src/lib/loopRange";

describe("loopEnds: 반복 구간 끝점을 잡을 때의 분수로", () => {
  // 1/7에서 4/4로 바뀌는 곡: 마디선이 1/7, 8/7 (1/960에 안 맞음)
  const timeSig = [
    { at: rat(0), beats: 4, unit: 4 },
    { at: rat(1, 7), beats: 4, unit: 4 },
  ];
  const exact: readonly [Rat, Rat] = [rat(1, 7), rat(8, 7)];
  const loop: readonly [number, number] = [toFloat(exact[0]), toFloat(exact[1])];
  const on16 = (time: number) => exactTime(time, 16);

  it("격자를 바꾼 뒤에도 잡은 분수를 써서 고른 마디만 걸린다", () => {
    const ends = loopEnds(loop, exact, on16)!;
    expect(ends).toBe(exact);
    expect(barsOfRange(timeSig, ...ends)).toEqual([2, 2]);
    // 예전처럼 지금 격자(1/16)로 맞추면 1/960로 반올림되어 앞 마디까지 걸린다
    expect(barsOfRange(timeSig, on16(loop[0]), on16(loop[1]))).not.toEqual([2, 2]);
  });

  it("반복 구간이 다른 길로 바뀌었으면 지금 격자로 맞춘다", () => {
    expect(loopEnds([0.25, 0.5], exact, on16)).toEqual([rat(1, 4), rat(1, 2)]);
  });

  it("반복 구간이 없으면 undefined", () => {
    expect(loopEnds(undefined, exact, on16)).toBeUndefined();
  });
});
