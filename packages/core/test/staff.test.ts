import { describe, expect, it } from "vitest";
import { add, rat, staffBars, staffDynamic, staffPitch, staffTrack, toFloat, type Note, type Rat, type StaffItem, type TimeSigEvent } from "../src/index.js";

const VOL = { min: 0, max: 15 };
let id = 0;
function note(start: Rat, dur: Rat, pitch = 60, o: Partial<Note> = {}): Note {
  return { id: `n${id++}`, start, dur, pitch, vol: 10, tie: "none", ...o };
}
/** 음을 차례로 붙여 놓는다 ([길이, 높이(없으면 쉼)]) */
function line(parts: readonly (readonly [Rat, number?])[], from: Rat = rat(0)): Note[] {
  const out: Note[] = [];
  let at = from;
  for (const [dur, pitch] of parts) {
    if (pitch !== undefined) out.push(note(at, dur, pitch));
    at = add(at, dur);
  }
  return out;
}
function view(notes: Note[], timeSig: TimeSigEvent[] = [], tempo: { at: Rat; bpm: number }[] = []) {
  const bars = staffBars({ tracks: [{ notes } as never], timeSig, tempo });
  return { bars, track: staffTrack(notes, bars, VOL) };
}
/** 조각을 짧게 적는다: 4 = 4분, 8. = 점8분, r = 쉼, ~ = 붙임줄, [3] = 셋잇단, ? = 맞춤 */
const short = (i: StaffItem) => `${i.rest ? "r" : ""}${i.base}${".".repeat(i.dots)}${i.tuplet ? `[${i.tuplet.num}]` : ""}${i.tie ? "~" : ""}${i.approx ? "?" : ""}`;
const bar = (items: readonly StaffItem[]) => items.map(short).join(" ");

describe("오선보 마디", () => {
  it("박자표를 따라 곡 끝까지 마디를 나누고, 박자가 바뀌기 전 덜 찬 마디도 한 마디", () => {
    const sigs = [{ at: rat(0), beats: 4, unit: 4 }, { at: rat(3, 2), beats: 3, unit: 4 }];
    const { bars } = view([note(rat(0), rat(9, 4))], sigs);
    expect(bars.map((b) => [toFloat(b.start), toFloat(b.end), b.number, b.showSig])).toEqual([
      [0, 1, 1, true],
      [1, 1.5, 2, false],
      [1.5, 2.25, 3, true],
    ]);
  });

  it("곡 끝보다 먼 박자 바뀜이 있어도 곡 끝에서 마디를 멈춘다", () => {
    const { bars } = view([note(rat(0), rat(1, 4))], [{ at: rat(0), beats: 4, unit: 4 }, { at: rat(1000), beats: 3, unit: 4 }]);
    expect(bars).toHaveLength(1);
  });

  it("음이 없으면 한 마디, 첫 마디에는 처음 템포를 늘 적고 같은 템포는 다시 적지 않는다", () => {
    expect(view([]).bars).toHaveLength(1);
    const { bars } = view([note(rat(0), rat(3))], [], [{ at: rat(1), bpm: 120 }, { at: rat(9, 4), bpm: 90 }]);
    expect(bars.map((b) => b.tempo.map((t) => [toFloat(t.at), t.bpm]))).toEqual([[[0, 120]], [], [[2.25, 90]]]);
  });
});

describe("음표 모양 나누기", () => {
  it("2분할 음은 그대로, 빈 마디는 온쉼표 하나", () => {
    const { track } = view(line([[rat(1, 4), 60], [rat(1, 8), 62], [rat(1, 8), 64], [rat(1, 2), 65], [rat(1)], [rat(1), 60]]));
    expect(bar(track.measures[0]!.items)).toBe("4 8 8 2");
    expect(track.measures[1]).toEqual({ items: [], fullRest: true });
  });

  it("마디선을 넘는 음은 붙임줄로 나누고, 점음표·당김음, 쉼표는 박 단위", () => {
    const { track } = view(line([[rat(3, 4), 60], [rat(1, 2), 62], [rat(3, 4)]]));
    expect(bar(track.measures[0]!.items)).toBe("2. 4~");
    expect(bar(track.measures[1]!.items)).toBe("4 r4 r2");
    // 당김음: 둘째 박에서 세 박 → 4분 + 2분 (점4분으로 박 가운데서 끊지 않는다)
    expect(bar(view(line([[rat(1, 4)], [rat(3, 4), 60]])).track.measures[0]!.items)).toBe("r4 4~ 2");
  });

  it("셋잇단·다섯잇단·여섯잇단은 분모에서 알아본다", () => {
    const t3 = rat(1, 12);
    const { track } = view(line([[t3, 60], [t3, 62], [t3, 64], [rat(1, 4), 65], [rat(1, 6), 67], [rat(1, 6), 69], [rat(1, 6), 71]]));
    expect(bar(track.measures[0]!.items)).toBe("8[3] 8[3] 8[3] 4 4[3] 4[3] 4[3]");
    const g = track.measures[0]!.items.map((i) => i.tuplet?.group);
    expect(g[0]).toBe(g[2]);
    expect(g[4]).not.toBe(g[0]);
    const q = rat(1, 20);
    expect(bar(view(line([[q, 60], [q, 62], [q, 64], [q, 65], [q, 67], [rat(3, 4)]])).track.measures[0]!.items)).toBe("16[5] 16[5] 16[5] 16[5] 16[5] r4 r2");
    const s = rat(1, 24);
    expect(bar(view(line([...Array.from({ length: 6 }, (_, i) => [s, 60 + i] as const), [rat(3, 4)] as const])).track.measures[0]!.items)).toBe(
      "16[6] 16[6] 16[6] 16[6] 16[6] 16[6] r4 r2",
    );
  });

  it("셋잇단 4분+8분 (앞 둘을 이은 셋잇단)", () => {
    const { track } = view(line([[rat(1, 6), 60], [rat(1, 12), 62], [rat(3, 4)]]));
    expect(bar(track.measures[0]!.items)).toBe("4[3] 8[3] r4 r2");
  });

  it("l7 같은 음은 마디 전체 일곱잇단으로", () => {
    const { track } = view(line(Array.from({ length: 7 }, (_, i) => [rat(1, 7), 60 + i] as const)));
    expect(bar(track.measures[0]!.items)).toBe(Array(7).fill("4[7]").join(" "));
  });

  it("박자 밖 음은 그리기용으로만 가까운 칸에 맞추고 맞춘 표시를 단다 (곡 값은 그대로)", () => {
    const notes = [note(rat(1, 4 * 37), rat(1, 4) ), note(rat(1, 2), rat(1, 2))];
    const before = JSON.stringify(notes);
    const { track } = view(notes);
    expect(bar(track.measures[0]!.items)).toBe("4? r4 2");
    expect(JSON.stringify(notes)).toBe(before);
    expect(track.hidden).toBe(0);
  });

  it("&로 같은 높이를 이은 음은 붙임줄, 다른 높이(슬라이드)는 붙임줄 없이 새로 치지 않는 음", () => {
    const a = note(rat(0), rat(1, 4), 60, { tie: "next" });
    const b = note(rat(1, 4), rat(1, 4), 60, { tie: "next" });
    const c = note(rat(1, 2), rat(1, 2), 62);
    const items = view([a, b, c]).track.measures[0]!.items;
    expect(bar(items)).toBe("4~ 4 2");
    expect(items.map((i) => i.attack)).toEqual([true, false, false]);
  });

  it("6/8은 점4분이 한 박", () => {
    const { track } = view(line([[rat(3, 8), 60], [rat(1, 8), 62], [rat(1, 8), 64], [rat(1, 8), 65]]), [{ at: rat(0), beats: 6, unit: 8 }]);
    expect(bar(track.measures[0]!.items)).toBe("4. 8 8 8");
  });
});

describe("임시표·셈여림·음자리표", () => {
  it("조표 없이 올림표, 같은 마디에서 제자리로 돌아오면 제자리표, 붙임줄로 받은 조각에는 안 쓴다", () => {
    expect(staffPitch(61)).toEqual({ letter: "c", sharp: true, octave: 4 });
    expect(staffPitch(59)).toEqual({ letter: "b", sharp: false, octave: 3 });
    const notes = line([[rat(1, 4), 61], [rat(1, 4), 61], [rat(1, 4), 60], [rat(1, 4), 61]]);
    const tiedOver = note(rat(3, 4), rat(1, 2), 66);
    const items = view(notes).track.measures[0]!.items;
    expect(items.map((i) => i.accidental ?? "")).toEqual(["#", "", "n", "#"]);
    const t = view([tiedOver]).track;
    expect(t.measures[0]!.items.find((i) => !i.rest)!.accidental).toBe("#");
    expect(t.measures[1]!.items[0]!.accidental).toBeUndefined();
  });

  it("v를 pp~ff로 어림하고 달라진 곳에만", () => {
    expect([0, 3, 6, 8, 11, 15].map((v) => staffDynamic(v, VOL))).toEqual(["pp", "p", "mp", "mf", "f", "ff"]);
    const notes = line([[rat(1, 4), 60], [rat(1, 4), 62], [rat(1, 4), 64]]).map((n, i) => ({ ...n, vol: [10, 10, 14][i]! }));
    expect(view(notes).track.measures[0]!.items.map((i) => i.dynamic ?? "")).toEqual(["f", "", "ff", ""]);
  });

  it("음 높이 가운데값이 가온 도보다 낮으면 낮은음자리표", () => {
    expect(view(line([[rat(1, 4), 40], [rat(1, 4), 45]])).track.clef).toBe("bass");
    expect(view(line([[rat(1, 4), 60]])).track.clef).toBe("treble");
  });
});

describe("어떤 곡이든 마디를 빈틈없이 채운다", () => {
  it("여러 격자·박자 밖 음·박자 바뀜을 섞은 곡: 조각이 마디를 이어서 꼭 채우고, 숨긴 음 말고는 다 보인다", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const lens = [rat(1, 4), rat(1, 8), rat(1, 16), rat(1, 12), rat(1, 6), rat(1, 20), rat(1, 7), rat(1, 37), rat(3, 8), rat(1, 48), rat(5, 16)];
    for (let round = 0; round < 40; round++) {
      const notes: Note[] = [];
      let at = rat(0);
      for (let i = 0; i < 60; i++) {
        const dur = lens[Math.floor(rand() * lens.length)]!;
        if (rand() < 0.8) notes.push(note(at, dur, 40 + Math.floor(rand() * 40), { tie: rand() < 0.2 ? "next" : "none", vol: Math.floor(rand() * 16) }));
        at = add(at, dur);
      }
      const sigs: TimeSigEvent[] = round % 3 === 0 ? [{ at: rat(0), beats: 3, unit: 4 }, { at: rat(5, 3), beats: 6, unit: 8 }] : round % 3 === 1 ? [{ at: rat(0), beats: 7, unit: 8 }] : [];
      const { bars, track } = view(notes, sigs);
      bars.forEach((b, i) => {
        const m = track.measures[i]!;
        if (m.fullRest) return;
        let pos = b.start;
        for (const it of m.items) {
          expect(toFloat(it.start)).toBeCloseTo(toFloat(pos), 9);
          expect(it.dur.n).toBeGreaterThan(0);
          pos = add(it.start, it.dur);
        }
        expect(toFloat(pos)).toBeCloseTo(toFloat(b.end), 9);
      });
      const shown = new Set(track.measures.flatMap((m) => m.items.map((i) => i.noteId)));
      expect(notes.filter((n) => !shown.has(n.id)).length).toBe(track.hidden);
    }
  });
});
