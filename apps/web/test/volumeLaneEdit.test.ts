import { describe, expect, it } from "vitest";
import { rat, type Note } from "@mmlce/core";
import { brushStroke, laneItems, lineStroke, rankValue } from "../src/lib/volumeLaneEdit";

const n = (id: string, start: number, dur: number, pitch: number, vol = 8): Note => ({ id, start: rat(start, 8), dur: rat(dur, 8), pitch, vol, tie: "none" });
const range = { min: 0, max: 15 };
const offsets = { top: 0, middle: -3, bottom: -1 };
const flat = (c: ReadonlyMap<string, ReadonlyMap<string, number>>) => [...c].flatMap(([t, m]) => [...m].map(([id, v]) => `${t}:${id}=${v}`));

describe("음량 레인 획", () => {
  const melody = { id: "m", notes: [n("x1", 0, 4, 72), n("x2", 4, 4, 74)], melody: true, locked: false };
  const inner = { id: "a", notes: [n("x1", 0, 8, 64)], melody: false, locked: false };
  const bass = { id: "b", notes: [n("x1", 0, 4, 48), n("x2", 4, 4, 50)], melody: false, locked: false };

  it("트랙 하나는 그은 값 그대로", () => {
    const items = laneItems([melody], new Set());
    expect(items.every((it) => it.rank === undefined)).toBe(true);
    expect(flat(lineStroke(items, rat(0), rat(4, 8), 10, 12, offsets, range))).toEqual(["m:x1=10", "m:x2=12"]);
  });

  it("여러 트랙은 멜로디 그대로, 반주는 자리 차이 (id가 겹쳐도 트랙마다)", () => {
    const items = laneItems([melody, inner, bass], new Set());
    const changes = new Map<string, Map<string, number>>();
    brushStroke(items, changes, 0, 12, 0.9, 12, 100, false, offsets, range);
    // 반주 둘뿐이라 inner(64)는 맨 위, bass는 맨 아래
    expect(flat(changes)).toEqual(["m:x1=12", "m:x2=12", "a:x1=12", "b:x1=11", "b:x2=11"]);
    expect(rankValue(1, "middle", offsets, range)).toBe(0);
  });

  it("잠근 트랙과 고른 음 밖은 안 바뀐다", () => {
    const items = laneItems([melody, { ...inner, locked: true }, bass], new Set(["x2"]));
    const changes = lineStroke(items, rat(0), rat(1), 9, 9, offsets, range);
    // 멜로디는 고른 x2만, 베이스는 고른 음 구간(1/2~1)에 걸친 x2만
    expect(flat(changes)).toEqual(["m:x2=9", "b:x2=8"]);
  });
});
