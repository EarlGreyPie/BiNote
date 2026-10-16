import { describe, expect, it } from "vitest";
import { fromLength, rat } from "@mmlce/core";
import { parseMml, printMml, type PrintableNote } from "../src/index.js";

const strip = (n: { start: unknown; dur: unknown; pitch: number; vol: number; tie: string }) => ({
  start: n.start, dur: n.dur, pitch: n.pitch, vol: n.vol, tie: n.tie,
});

function roundTrip(text: string) {
  const a = parseMml(text);
  const printed = printMml(a.notes, { tempo: a.tempo });
  const b = parseMml(printed.text);
  expect(b.diagnostics).toEqual([]);
  expect(b.notes.map(strip)).toEqual(a.notes.map(strip));
  expect(b.tempo).toEqual(a.tempo);
  return printed.text;
}

describe("printMml", () => {
  it("다시 읽으면 같은 음", () => {
    roundTrip("t120 o4 l8 cdef g4a4 b2 >c1");
    roundTrip("v10 c4&c8 c4&d4 v12 r16 e-8. f+32");
    roundTrip("c7c37 r6 d12d12d12 e64.e48.");
    roundTrip("o2c o6c o3c+ < b");
  });

  it("음 중간의 템포는 &로 음을 나눠 쓴다", () => {
    const text = roundTrip("c2t90 r2");
    const notes = [{ start: rat(0), dur: rat(1, 2), pitch: 60, vol: 8, tie: "none" as const }];
    const mid = printMml(notes, { tempo: [{ at: rat(1, 4), bpm: 90 }] });
    expect(mid.text).toBe("ct90&c");
    expect(text).toContain("t90");
  });

  it("한 토막으로 안 되는 길이는 &로 이어 쓴다", () => {
    const notes: PrintableNote[] = [
      { start: rat(0), dur: rat(2, 7), pitch: 60, vol: 8, tie: "none" },
    ];
    const { text } = printMml(notes);
    const back = parseMml(text).notes;
    expect(back.map((n) => n.tie).slice(0, -1).every((t) => t === "next")).toBe(true);
    expect(back.reduce((s, n) => s + n.dur.n / n.dur.d, 0)).toBeCloseTo(2 / 7, 12);
  });

  it("가장 많이 쓴 길이를 l로 둔다", () => {
    const notes: PrintableNote[] = [0, 1, 2].map((k) => ({
      start: rat(k, 8), dur: fromLength(8), pitch: 60, vol: 8, tie: "none",
    }));
    expect(printMml(notes).text).toBe("l8ccc");
  });
});
