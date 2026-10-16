import { rat, type Rat } from "@mmlce/core";
import { describe, expect, it } from "vitest";
import { mergeTies, optimizeMml, parseMml, printMml, sameSound, type PrintableNote } from "../src/index.js";

const n = (start: Rat, dur: Rat, pitch: number, vol = 8, tie: "none" | "next" = "none"): PrintableNote => ({
  start,
  dur,
  pitch,
  vol,
  tie,
});

function roundTrip(notes: PrintableNote[], tempo: { at: Rat; bpm: number }[] = []) {
  const out = optimizeMml(notes, { tempo });
  const back = parseMml(out.text);
  expect(sameSound(back.notes, mergeTies(notes))).toBe(true);
  expect(back.tempo).toEqual(tempo);
  return out.text;
}

describe("optimizeMml", () => {
  it("자주 쓰는 길이를 l로 바꾸고 소리는 그대로", () => {
    const notes = Array.from({ length: 8 }, (_, k) => n(rat(k, 8), rat(1, 8), 60 + (k % 3)));
    const text = roundTrip(notes);
    expect(text).toBe("l8cc+dcc+dcc+");
  });

  it("구간마다 다른 기본 길이를 고른다", () => {
    const a = Array.from({ length: 6 }, (_, k) => n(rat(k, 16), rat(1, 16), 60));
    const b = Array.from({ length: 6 }, (_, k) => n(rat(6 * 1 + 4 * k, 16), rat(1, 4), 62));
    const text = roundTrip([...a, ...b]);
    expect(text).toBe("l16ccccccl4dddddd");
  });

  it("점음표·&로 나눠야 하는 길이도 소리가 같다", () => {
    const notes = [n(rat(0), rat(3, 8), 60), n(rat(3, 8), rat(5, 16), 64), n(rat(11, 16), rat(9, 4), 67, 10)];
    roundTrip(notes);
  });

  it("음 중간 템포와 끝 뒤 템포를 지킨다", () => {
    const notes = [n(rat(0), rat(1, 2), 60), n(rat(1, 2), rat(1, 4), 62, 8, "next"), n(rat(3, 4), rat(1, 4), 65)];
    roundTrip(notes, [
      { at: rat(0), bpm: 120 },
      { at: rat(1, 4), bpm: 90 },
      { at: rat(3, 2), bpm: 60 },
    ]);
  });

  it("다른 음 &는 남기고 & 바로 뒤에는 l을 끼우지 않는다", () => {
    const notes = [n(rat(0), rat(1, 4), 60, 8, "next"), ...Array.from({ length: 6 }, (_, k) => n(add4(k), rat(1, 16), 62))];
    const text = roundTrip(notes);
    expect(text).not.toMatch(/&l/);
    expect(text).toContain("&");
  });

  it("& 뒤에는 v를 쓰지 않는다 (게임이 무시, 실측). 다음 음에 필요하면 그때 쓴다", () => {
    // c(v8)&c(v5) d(v5) / c(v8)&e(v3) f(v8)
    const same = [n(rat(0), rat(1, 4), 60, 8, "next"), n(rat(1, 4), rat(1, 4), 60, 5), n(rat(1, 2), rat(1, 4), 62, 5)];
    const slide = [n(rat(0), rat(1, 4), 60, 8, "next"), n(rat(1, 4), rat(1, 4), 64, 3), n(rat(1, 2), rat(1, 4), 65, 8)];
    for (const notes of [same, slide]) {
      for (const text of [optimizeMml(notes).text, printMml(notes).text]) {
        expect(text).not.toMatch(/&v/);
        const back = parseMml(text).notes;
        expect(sameSound(back, notes)).toBe(true);
        // 사슬 뒤 음은 앞서 정한 v로 나야 한다
        expect(back[back.length - 1]!.vol).toBe(notes[notes.length - 1]!.vol);
      }
    }
    expect(optimizeMml(same).text).toBe("c2v5d");
    expect(optimizeMml(slide).text).toBe("c&ef");
  });

  it("& 뒤 음의 v만 다른 두 곡은 소리가 같다", () => {
    expect(sameSound([n(rat(0), rat(1, 4), 60, 8, "next"), n(rat(1, 4), rat(1, 4), 64, 3)], [n(rat(0), rat(1, 4), 60, 8, "next"), n(rat(1, 4), rat(1, 4), 64, 8)])).toBe(true);
    expect(sameSound([n(rat(0), rat(1, 4), 60, 8, "next"), n(rat(1, 4), rat(1, 4), 64, 3)], [n(rat(0), rat(1, 4), 60, 7, "next"), n(rat(1, 4), rat(1, 4), 64, 3)])).toBe(false);
  });

  it("무작위 음열: 다시 읽으면 같고 단순 출력보다 길지 않다", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const lengths = [rat(1, 4), rat(1, 8), rat(1, 16), rat(3, 8), rat(3, 16), rat(1, 2), rat(1, 12), rat(1, 6), rat(5, 16)];
    for (let trial = 0; trial < 40; trial++) {
      const notes: PrintableNote[] = [];
      let t = rat(0);
      for (let k = 0; k < 60; k++) {
        if (rand() < 0.2) t = addRat(t, lengths[Math.floor(rand() * lengths.length)]!);
        const dur = lengths[Math.floor(rand() * lengths.length)]!;
        const tie = rand() < 0.1 ? "next" : "none";
        notes.push(n(t, dur, 40 + Math.floor(rand() * 40), 5 + Math.floor(rand() * 10), tie));
        t = addRat(t, dur);
      }
      const opt = optimizeMml(notes);
      expect(sameSound(parseMml(opt.text).notes, mergeTies(notes))).toBe(true);
      expect(opt.text.length).toBeLessThanOrEqual(printMml(notes).text.length);
    }
  });
});

function addRat(a: Rat, b: Rat): Rat {
  return rat(a.n * b.d + b.n * a.d, a.d * b.d);
}
function add4(k: number): Rat {
  return addRat(rat(1, 4), rat(k, 16));
}
