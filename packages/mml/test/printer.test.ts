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

describe("쉼표 앞의 &", () => {
  it("게임이 무시하므로 쓰지 않는다 (쉼표 앞, 트랙 끝). 음과 음 사이 &는 그대로", () => {
    expect(printMml(parseMml("a4&r4a4&").notes).text).toBe(printMml(parseMml("a4r4a4").notes).text);
    expect(printMml(parseMml("a4&b4").notes).text).toContain("&");
  });

  it("최적화 출력도 쓰지 않고, 쓴 글은 원래 음과 소리가 같다고 본다", async () => {
    const { optimizeMml, sameSound } = await import("../src/index.js");
    const notes = parseMml("a16&r16a16&r16a16&r16a16&r16").notes;
    const text = optimizeMml(notes).text;
    expect(text).not.toContain("&");
    expect(sameSound(parseMml(text).notes, notes)).toBe(true);
  });
});

describe("옥타브 범위 끝 음 (o-1을 쓰지 않는다)", () => {
  const pitches = (text: string) => parseMml(text).notes.map((x) => x.pitch);

  it("pitch 11은 o0c-, 132는 o9b+로 쓰고 다시 읽으면 같은 음", () => {
    for (const text of ["o0c-4", "o0<b4", "o9b+4", "o9>c4", "o4c o0c- o4c", "o0c<b", "o0c-o9b+"]) {
      const before = pitches(text);
      const printed = printMml(parseMml(text).notes);
      expect(printed.text).not.toMatch(/o-|o1\d/);
      expect(printed.diagnostics).toEqual([]);
      const back = parseMml(printed.text);
      expect(back.diagnostics).toEqual([]);
      expect(back.notes.map((x) => x.pitch)).toEqual(before);
    }
    expect(printMml(parseMml("o0c-").notes).text).toBe("o0c-");
    expect(printMml(parseMml("o9b+").notes).text).toBe("o9b+");
  });

  it("상대 표기 o0c<b도 그대로 pitch 12·11로 읽고, 다시 써도 같다", () => {
    expect(pitches("o0c<b")).toEqual([12, 11]);
    expect(pitches(roundTrip("o0c<b"))).toEqual([12, 11]);
  });

  it("그래도 쓸 수 없는 높이(0~10, 133 이상)는 옥타브를 옮겨 쓰고 알린다", () => {
    const notes: PrintableNote[] = [
      { start: rat(0), dur: rat(1, 4), pitch: 0, vol: 8, tie: "none" },
      { start: rat(1, 4), dur: rat(1, 4), pitch: 133, vol: 8, tie: "none" },
    ];
    const printed = printMml(notes);
    expect(printed.text).not.toMatch(/o-|o1\d/);
    expect(parseMml(printed.text).diagnostics).toEqual([]);
    expect(parseMml(printed.text).notes.map((x) => x.pitch)).toEqual([12, 121]);
    expect(printed.diagnostics.map((d) => [d.code, d.params])).toEqual([
      ["pitch-unwritable", { min: 0, max: 9 }],
      ["pitch-unwritable", { min: 0, max: 9 }],
    ]);
  });

  it("옥타브 범위는 프로필 값을 따른다", () => {
    const notes: PrintableNote[] = [{ start: rat(0), dur: rat(1, 4), pitch: 23, vol: 8, tie: "none" }];
    expect(printMml(notes, { octaves: { min: 1, max: 9 } }).text).toBe("o1c-");
  });
});
