import { describe, expect, it } from "vitest";
import { add, arpCells, arpSequence, arpTimes, CHORD_KINDS, cmp, emptySong, planArpeggio, rat, type ArpOptions, type Note, type Song, type Track } from "../src/index.js";

/** 8분음표 단위로 음을 만든다 */
const n = (id: string, start: number, dur: number, pitch: number, vol = 10): Note => ({ id, start: rat(start, 8), dur: rat(dur, 8), pitch, vol, tie: "none" });

function songOf(tracks: Record<string, Note[]>, player: Record<string, string> = {}): Song {
  const ids = Object.keys(tracks);
  const players = [...new Set(ids.map((id) => player[id] ?? "p1"))].map((id) => ({ id, name: id, instrument: { canonical: "piano" } }));
  const list: Track[] = ids.map((id) => ({
    id, playerId: player[id] ?? "p1", name: id, color: "", role: "free", mute: false, solo: false, notes: tracks[id]!, spelling: {},
  }));
  return { ...emptySong({ title: "", author: "", profileId: "mobile" }), players, tracks: list };
}

const base: ArpOptions = {
  source: "together", chord: "major", style: "spread", order: "up", step: rat(1, 16), octaves: 1, repeat: true,
  clearChordTracks: true, range: { low: 0, high: 127 }, maxTracks: 6,
};
let k = 0;
const newId = () => `x${++k}`;
const shape = (notes: readonly Note[]) => notes.map((x) => `${x.pitch}@${x.start.n}/${x.start.d}+${x.dur.n}/${x.dur.d}`);

// 4분음표 C 화음: t1 c, t2 e, t3 g (모두 0에서 시작). t3 뒤에 칸 밖 음 하나
const chordSong = () =>
  songOf({ t1: [n("c", 0, 2, 60)], t2: [n("e", 0, 2, 64)], t3: [n("g", 0, 2, 67), n("a", 4, 2, 69)] });

describe("화음 음 가져오기", () => {
  it("같은 시간 음: 고른 음 + 같은 악보 다른 트랙에서 같은 자리에 시작하는 음 (같은 높이는 한 번)", () => {
    const s = songOf({ t1: [n("c", 0, 2, 60)], t2: [n("e", 0, 2, 64), n("late", 1, 1, 70)], t3: [n("c2", 0, 2, 60)], o: [n("x", 0, 2, 50)] }, { o: "p2" });
    const { cells } = arpCells(s, "t1", [s.tracks[0]!.notes[0]!], base);
    expect(cells[0]!.pitches).toEqual([60, 64]);
    expect(cells[0]!.taken.map((x) => x.noteId)).toEqual(["e", "c2"]);
  });

  it("고른 음만: 다른 트랙은 보지 않고 고른 음 전체가 칸 하나", () => {
    const s = songOf({ t1: [n("c", 0, 1, 60), n("e", 1, 1, 64), n("g", 2, 2, 67)], t2: [n("z", 0, 4, 48)] });
    const { cells } = arpCells(s, "t1", s.tracks[0]!.notes, { ...base, source: "selected" });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ start: rat(0), end: rat(1, 2), pitches: [60, 64, 67], taken: [] });
  });

  it("코드 이름: 고른 음을 근음으로 종류별 반음 간격", () => {
    const s = songOf({ t1: [n("c", 0, 2, 60)] });
    for (const [kind, steps] of Object.entries(CHORD_KINDS)) {
      const { cells } = arpCells(s, "t1", s.tracks[0]!.notes, { source: "chord", chord: kind as keyof typeof CHORD_KINDS });
      expect(cells[0]!.pitches).toEqual(steps.map((x) => 60 + x));
    }
    expect(CHORD_KINDS.m7).toEqual([0, 3, 7, 10]);
  });

  it("화음 음이 하나뿐인 칸은 건너뛰고 수를 센다", () => {
    const s = songOf({ t1: [n("c", 0, 2, 60), n("d", 2, 2, 62)], t2: [n("e", 0, 2, 64)] });
    const r = arpCells(s, "t1", s.tracks[0]!.notes, base);
    expect([r.cells.length, r.single]).toEqual([1, 1]);
  });
});

describe("순서·옥타브·자리", () => {
  const cell = { pitches: [60, 64, 67], start: rat(0), end: rat(1, 4) };
  it("위로·아래로·위아래(맨 위·맨 아래는 한 번)", () => {
    expect(arpSequence(cell, { ...base, order: "up" }).pitches).toEqual([60, 64, 67]);
    expect(arpSequence(cell, { ...base, order: "down" }).pitches).toEqual([67, 64, 60]);
    expect(arpSequence({ ...cell, pitches: [60, 64, 67, 72] }, { ...base, order: "updown" }).pitches).toEqual([60, 64, 67, 72, 67, 64]);
  });

  it("무작위는 같은 자리면 늘 같은 결과", () => {
    const a = arpSequence({ ...cell, pitches: [60, 62, 64, 65, 67, 69] }, { ...base, order: "random" }).pitches;
    const b = arpSequence({ ...cell, pitches: [60, 62, 64, 65, 67, 69] }, { ...base, order: "random" }).pitches;
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([60, 62, 64, 65, 67, 69]);
  });

  it("옥타브 넓이 2: 한 옥타브 올려 이어 붙이고, 음역 밖은 빼고 센다", () => {
    expect(arpSequence(cell, { ...base, octaves: 2 }).pitches).toEqual([60, 64, 67, 72, 76, 79]);
    expect(arpSequence(cell, { ...base, order: "down", octaves: 2 }).pitches).toEqual([67, 64, 60, 55, 52, 48]);
    expect(arpSequence(cell, { ...base, octaves: 2, range: { low: 0, high: 74 } })).toEqual({ pitches: [60, 64, 67, 72], outOfRange: 2 });
  });

  it("반복: 칸이 찰 때까지, 칸 끝에서 자른다. 끄면 한 번 돌고 마지막 음을 끝까지", () => {
    const at = (xs: ReturnType<typeof arpTimes>) => xs.map((x) => `${x.index}@${x.start.n}/${x.start.d}+${x.dur.n}/${x.dur.d}`);
    expect(at(arpTimes({ start: rat(0), end: rat(5, 32) }, 3, rat(1, 16), true))).toEqual(["0@0/1+1/16", "1@1/16+1/16", "2@1/8+1/32"]);
    expect(at(arpTimes({ start: rat(0), end: rat(1, 2) }, 3, rat(1, 16), false))).toEqual(["0@0/1+1/16", "1@1/16+1/16", "2@1/8+3/8"]);
  });

  it("셋잇단 같은 분수 길이도 반올림하지 않는다", () => {
    const xs = arpTimes({ start: rat(0), end: rat(1, 4) }, 3, rat(1, 12), true);
    expect(xs.map((x) => x.start)).toEqual([rat(0), rat(1, 12), rat(1, 6)]);
    expect(xs.every((x) => x.dur.n === 1 && x.dur.d === 12)).toBe(true);
  });
});

describe("방식 1: 한 트랙에 펼치기", () => {
  it("고른 트랙 칸 자리에 차례로 넣고, 화음 트랙 음을 지운다 (끄면 둔다)", () => {
    const s = chordSong();
    const r = planArpeggio(s, "t1", [s.tracks[0]!.notes[0]!], base, newId);
    const t1 = r.changes.find((c) => c.trackId === "t1")!;
    expect(shape(t1.notes)).toEqual(["60@0/1+1/16", "64@1/16+1/16", "67@1/8+1/16", "60@3/16+1/16"]);
    expect(t1.notes.every((x) => x.vol === 10 && x.tie === "none")).toBe(true);
    expect(r.changes.find((c) => c.trackId === "t2")!.notes).toEqual([]);
    // 칸 밖 음(a)은 그대로
    expect(r.changes.find((c) => c.trackId === "t3")!.notes.map((x) => x.id)).toEqual(["a"]);
    const keep = planArpeggio(s, "t1", [s.tracks[0]!.notes[0]!], { ...base, clearChordTracks: false }, newId);
    expect(keep.changes.map((c) => c.trackId)).toEqual(["t1"]);
  });

  it("잠근 화음 트랙은 지우지 않고 센다", () => {
    const s = chordSong();
    const r = planArpeggio(s, "t1", [s.tracks[0]!.notes[0]!], { ...base, locked: new Set(["t2"]) }, newId);
    expect(r.changes.map((c) => c.trackId)).toEqual(["t1", "t3"]);
    expect(r.lockedSkipped).toBe(1);
  });

  it("고른 음만으로 펼칠 때 칸 안의 고르지 않은 음은 지우지 않고 그 앞까지만", () => {
    const s = songOf({ t1: [n("c", 0, 1, 60), n("keep", 2, 1, 62), n("g", 3, 1, 67)] });
    const picked = s.tracks[0]!.notes.filter((x) => x.id !== "keep");
    const r = planArpeggio(s, "t1", picked, { ...base, source: "selected", step: rat(1, 4) }, newId);
    const t1 = r.changes[0]!.notes;
    expect(t1.some((x) => x.id === "keep")).toBe(true);
    expect(shape(t1)).toEqual(["60@0/1+1/4", "62@1/4+1/8"]);
  });
});

describe("방식 2: 트랙을 깔면서 올라가기", () => {
  it("옥타브 1·반복 끔(굴려 치기): 원래 음을 제자리에 두고 시작만 늦춘다 (바뀌지 않는 음은 그대로)", () => {
    const s = chordSong();
    const r = planArpeggio(s, "t1", [s.tracks[0]!.notes[0]!], { ...base, style: "strum", repeat: false }, newId);
    const of = (id: string) => shape(r.changes.find((c) => c.trackId === id)?.notes ?? s.tracks.find((t) => t.id === id)!.notes);
    expect(of("t1")).toEqual(["60@0/1+1/4"]);
    expect(of("t2")).toEqual(["64@1/16+3/16"]);
    expect(of("t3")).toEqual(["67@1/8+1/8", "69@1/2+1/4"]);
    expect(r.newTracks).toEqual([]);
  });

  it("트랙보다 음이 많으면 다시 첫 트랙부터, 앞 음은 다음 음 앞에서 끊긴다. 모자라면 트랙을 더한다", () => {
    const s = songOf({ t1: [n("c", 0, 4, 60)], t2: [n("e", 0, 4, 64)] });
    // 원래 화음 음보다 길게 울릴 자리가 있으면(칸 1/2, 4음 + 트랙 하나 더해 4줄) 트랙을 더해 돌린다
    const wide = planArpeggio(s, "t1", [s.tracks[0]!.notes[0]!], { ...base, style: "strum", octaves: 2, maxTracks: 4, repeat: false }, newId);
    expect(wide.newTracks).toHaveLength(2);
    expect(shape(wide.changes.find((c) => c.trackId === "t1")!.notes)).toEqual(["60@0/1+1/2"]);
    // 트랙 한도 3이면 넷째 음이 t1을 다시 써서 원래 60(끝 1/2)이 3/16에서 끊긴다 → 원래 화음 음이 짧아지므로 이 칸은 만들지 않는다
    // (전에는 끊어서 만들었다: 지시문 22의 2번)
    const r = planArpeggio(s, "t1", [s.tracks[0]!.notes[0]!], { ...base, style: "strum", octaves: 2, maxTracks: 3 }, newId);
    expect(r.trackLimit).toBe(3);
    expect(r.cutCells).toBe(1);
    expect(r.notes).toBe(0);
  });

  it("한도가 다 찼으면 있는 트랙만으로 돌린다", () => {
    const s = songOf({ t1: [n("c", 0, 2, 60)], t2: [n("e", 0, 2, 64)], t3: [n("g", 0, 2, 67)] });
    const r = planArpeggio(s, "t1", [s.tracks[0]!.notes[0]!], { ...base, style: "strum", octaves: 2, maxTracks: 3 }, newId);
    expect(r.newTracks).toEqual([]);
    expect(r.trackLimit).toBe(3);
  });

  it("굴려 치기: 잠근 트랙 음은 두고 그 순서 자리는 비워 둔다 (다른 음을 당기지 않는다)", () => {
    // 전에는 새 음을 만들어 잠그지 않은 트랙에 돌려 넣었다. 굴려 치기는 원래 음만 옮긴다 (지시문 22의 1번)
    const s = songOf({ t1: [n("c", 0, 4, 60)], t2: [n("e", 0, 4, 64)], t3: [n("g", 0, 4, 67), n("out", 4, 1, 50)] });
    const r = planArpeggio(s, "t1", [s.tracks[0]!.notes[0]!], { ...base, style: "strum", repeat: false, locked: new Set(["t2"]) }, newId);
    expect(r.lockedSkipped).toBe(1);
    expect(r.changes.some((c) => c.trackId === "t2")).toBe(false);
    // g는 셋째 자리(2/16)에서 시작해 원래 끝 1/2까지. 뒤 음은 그대로
    expect(shape(r.changes.find((c) => c.trackId === "t3")!.notes)).toEqual(["67@1/8+3/8", "50@1/2+1/8"]);
  });
});

describe("굴려 치는 화음 (기타 물결선)", () => {
  // 멜로디 m 4분(81, 1번 줄), a 2분(75, 2번 줄), b 2분(71, 3번 줄), bass 점2분(47, 6번 줄). 멜로디를 고른다
  const guitar = () =>
    songOf({
      m: [{ ...n("m1", 0, 2, 81, 12), tabString: 1 }],
      a: [{ ...n("a1", 0, 4, 75, 9), tabString: 2 }],
      b: [{ ...n("b1", 0, 4, 71, 9), tabString: 3 }],
      bass: [{ ...n("e1", 0, 6, 47, 11), tabString: 6 }],
    });
  const roll = { ...base, style: "strum" as const, step: rat(1, 64), octaves: 1, repeat: false };
  const after = (s: Song, r: ReturnType<typeof planArpeggio>, id: string) => (r.changes.find((c) => c.trackId === id)?.notes ?? s.tracks.find((t) => t.id === id)!.notes)[0]!;

  it("위로 = 낮은 음부터: 끝은 각자 원래 끝, 트랙·id·v·줄은 그대로, 트랙을 더하지 않는다", () => {
    const s = guitar();
    const r = planArpeggio(s, "m", s.tracks[0]!.notes, roll, newId);
    expect(r.newTracks).toEqual([]);
    const bass = after(s, r, "bass");
    expect([bass.id, bass.start, add(bass.start, bass.dur), bass.tabString, bass.vol]).toEqual(["e1", rat(0), rat(3, 4), 6, 11]);
    const b = after(s, r, "b");
    expect([b.id, b.start, add(b.start, b.dur), b.tabString, b.vol]).toEqual(["b1", rat(1, 64), rat(1, 2), 3, 9]);
    const a = after(s, r, "a");
    expect([a.id, a.start, add(a.start, a.dur), a.tabString]).toEqual(["a1", rat(2, 64), rat(1, 2), 2]);
    const m = after(s, r, "m");
    expect([m.id, m.start, add(m.start, m.dur), m.tabString, m.vol]).toEqual(["m1", rat(3, 64), rat(1, 4), 1, 12]);
  });

  it("아래로 = 높은 음부터", () => {
    const s = guitar();
    const r = planArpeggio(s, "m", s.tracks[0]!.notes, { ...roll, order: "down" }, newId);
    expect(["m", "a", "b", "bass"].map((id) => after(s, r, id).start)).toEqual([rat(0), rat(1, 64), rat(2, 64), rat(3, 64)]);
    expect(add(after(s, r, "bass").start, after(s, r, "bass").dur)).toEqual(rat(3, 4));
  });

  it("너무 짧은 화음 음은 그대로 두고 센다", () => {
    const s = songOf({ t1: [{ id: "c", start: rat(0), dur: rat(1, 64), pitch: 60, vol: 8, tie: "none" }], t2: [{ id: "e", start: rat(0), dur: rat(1, 64), pitch: 64, vol: 8, tie: "none" }] });
    const r = planArpeggio(s, "t1", s.tracks[0]!.notes, roll, newId);
    expect(r.tooShort).toBe(1);
    expect(r.changes).toEqual([]);
  });

  it("실행 취소 한 번: 결과는 계산만 하고 곡을 바꾸지 않는다 (바뀐 트랙 음 전체를 돌려준다)", () => {
    const s = guitar();
    const before = JSON.stringify(s);
    planArpeggio(s, "m", s.tracks[0]!.notes, roll, newId);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("칸 길이와 새 음 (지시문 22)", () => {
  it("펼치기: 칸 끝은 가장 늦게 끝나는 화음 음 끝", () => {
    const s = songOf({ t1: [n("c", 0, 2, 60)], t2: [n("e", 0, 6, 64)] });
    const { cells } = arpCells(s, "t1", s.tracks[0]!.notes, base);
    expect(cells[0]!.end).toEqual(rat(3, 4));
    const r = planArpeggio(s, "t1", s.tracks[0]!.notes, { ...base, repeat: false }, newId);
    const t1 = r.changes.find((c) => c.trackId === "t1")!.notes;
    expect(add(t1.at(-1)!.start, t1.at(-1)!.dur)).toEqual(rat(3, 4));
  });

  it("옥타브 2 깔기: 원래 화음 음 길이가 줄지 않고, 같은 높이 새 음이 원래 줄·v를 이어받는다", () => {
    const s = songOf({ t1: [{ ...n("c", 0, 4, 60, 12), tabString: 5 }], t2: [{ ...n("e", 0, 6, 64, 7), tabString: 4 }] });
    const r = planArpeggio(s, "t1", s.tracks[0]!.notes, { ...base, style: "strum", octaves: 2, repeat: false, maxTracks: 6 }, newId);
    expect(r.cutCells ?? 0).toBe(0);
    for (const src of s.tracks) {
      const o = src.notes[0]!;
      const out = r.changes.find((c) => c.trackId === src.id)!.notes.find((x) => x.pitch === o.pitch)!;
      // 같은 트랙, 같은 높이, 원래 끝 이후까지 울린다. 줄·v를 이어받는다
      expect(cmp(add(out.start, out.dur), add(o.start, o.dur))).toBeGreaterThanOrEqual(0);
      expect([out.tabString, out.vol]).toEqual([o.tabString, o.vol]);
    }
    // 옥타브를 올려 생긴 음은 줄 없이(자동 배정), 칸 v
    const added = r.newTracks.flat();
    expect(added.every((x) => x.tabString === undefined && x.vol === 12)).toBe(true);
  });
});

/** 온음표 단위 분수로 음을 만든다 */
const w = (id: string, start: [number, number], dur: [number, number], pitch: number): Note => ({ id, start: rat(...start), dur: rat(...dur), pitch, vol: 10, tie: "none" });
const strum: ArpOptions = { ...base, style: "strum", step: rat(1, 16), octaves: 2, repeat: false };

describe("깔기: 최종 배치 기준 원음 보호 (PR #138 점검 4)", () => {
  // 기준 트랙: G4 [0, 1/16), A4 [1/16, 1/4). 다른 두 트랙: C4, E4 [0, 1/2)
  const song = () =>
    songOf({
      base: [w("g", [0, 1], [1, 16], 67), w("a", [1, 16], [3, 16], 69)],
      c: [w("c", [0, 1], [1, 2], 60)],
      e: [w("e", [0, 1], [1, 2], 64)],
    });

  it("새 G4가 칸 밖 A4 안에서 시작해 빠지면 그 칸은 원래 음 지우기까지 취소하고 센다", () => {
    const s = song();
    const r = planArpeggio(s, "base", [s.tracks[0]!.notes[0]!], { ...strum, maxTracks: 8 }, newId);
    expect(r.cutCells).toBe(1);
    expect(r.notes).toBe(0);
    expect(r.newTracks).toEqual([]);
    for (const c of r.changes) expect(c.notes).toEqual(s.tracks.find((t) => t.id === c.trackId)!.notes);
  });

  it("칸 밖 음은 지우거나 줄이지 않고, 새 음은 그 음 앞까지만 (원래 음은 끝까지 울린다)", () => {
    // 기준 트랙 C4, 다른 트랙 E4 (모두 [0, 1/4)). 셋째 트랙에 칸 밖 음 X [3/16, 1/4) (늦게 시작해 화음 음이 아니다)
    const s = songOf({
      t1: [w("c", [0, 1], [1, 4], 60)],
      t2: [w("e", [0, 1], [1, 4], 64)],
      t3: [w("x", [3, 16], [1, 16], 71)],
    });
    const r = planArpeggio(s, "t1", [s.tracks[0]!.notes[0]!], { ...strum, maxTracks: 4 }, newId);
    expect(r.cutCells).toBeUndefined();
    const t3 = r.changes.find((c) => c.trackId === "t3")!.notes;
    // 칸 밖 음 X는 그대로, 그 앞의 새 음(C5, 1/8에 시작)은 X 시작 앞에서 끝난다
    expect(t3.find((x) => x.id === "x")).toEqual(s.tracks[2]!.notes[0]);
    expect(shape(t3.filter((x) => x.id !== "x"))).toEqual(["72@1/8+1/16"]);
    // 원래 화음 음 높이는 원래 트랙에서 원래 끝까지
    expect(shape(r.changes.find((c) => c.trackId === "t1")!.notes)).toEqual(["60@0/1+1/4"]);
    expect(shape(r.changes.find((c) => c.trackId === "t2")!.notes)).toEqual(["64@1/16+3/16"]);
  });
});

describe("깔기: 잠근 기준 트랙 (PR #138 점검 5)", () => {
  it("잠근 트랙의 음을 골라도 그 트랙은 바꾸지 않는다", () => {
    const s = chordSong();
    const r = planArpeggio(s, "t1", [s.tracks[0]!.notes[0]!], { ...base, style: "strum", octaves: 1, repeat: true, locked: new Set(["t1"]) }, newId);
    expect(r.lockedSkipped).toBe(1);
    expect(r.changes.find((c) => c.trackId === "t1")).toBeUndefined();
  });
  it("굴려 치기에서도 잠근 기준 트랙 음은 그대로", () => {
    const s = chordSong();
    const r = planArpeggio(s, "t1", [s.tracks[0]!.notes[0]!], { ...base, style: "strum", octaves: 1, repeat: false, locked: new Set(["t1"]) }, newId);
    expect(r.changes.find((c) => c.trackId === "t1")).toBeUndefined();
  });
});

describe("고른 음만 + 깔기 (PR #138 점검 6)", () => {
  it("한 트랙에 차례로 놓인 c4e4g4는 굴려 치기로 가지 않고, 못 만들면 이유(sequential)를 돌려준다", () => {
    const s = songOf({ t1: [n("c", 0, 2, 60), n("e", 2, 2, 64), n("g", 4, 2, 67)], t2: [] });
    const r = planArpeggio(s, "t1", s.tracks[0]!.notes, { ...base, source: "selected", style: "strum", octaves: 1, repeat: false }, newId);
    // 조용히 0개로 끝나지 않는다: 음을 만들거나, 만들지 못한 이유를 센다
    expect(r.notes > 0 || (r.sequential ?? 0) > 0).toBe(true);
    if (r.notes === 0) {
      expect(r.sequential).toBe(1);
      expect(r.cutCells).toBe(1);
    }
  });
  it("같은 시간에 시작하는 화음은 지금처럼 굴려 친다", () => {
    const s = songOf({ t1: [n("c", 0, 2, 60), n("e", 0, 2, 64), n("g", 0, 2, 67)] });
    const r = planArpeggio(s, "t1", s.tracks[0]!.notes, { ...base, source: "selected", style: "strum", octaves: 1, repeat: false }, newId);
    expect(r.notes).toBe(2);
    expect(r.newTracks).toEqual([]);
    expect(r.sequential).toBeUndefined();
  });
});

/** 결과를 반영한 같은 악보 트랙들 (바뀐 트랙은 바뀐 음, 새 트랙은 덧붙여) */
function applied(s: Song, r: ReturnType<typeof planArpeggio>, player = "p1"): { id: string; notes: readonly Note[] }[] {
  const changed = new Map(r.changes.map((c) => [c.trackId, c.notes]));
  return [
    ...s.tracks.filter((t) => t.playerId === player).map((t) => ({ id: t.id, notes: changed.get(t.id) ?? t.notes })),
    ...r.newTracks.map((notes, i) => ({ id: `new${i}`, notes })),
  ];
}
/** 한 트랙 안에서 겹치는 음 쌍이 있는지 */
const overlaps = (notes: readonly Note[]) => {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
  return sorted.some((x, i) => i > 0 && cmp(sorted[i - 1]!.start, x.start) <= 0 && cmp(x.start, add(sorted[i - 1]!.start, sorted[i - 1]!.dur)) < 0);
};

describe("깔기: 여러 화음 칸을 합친 최종 배치로 원음 보호 (PR #138 점검 24)", () => {
  it("다른 칸의 새 음이 원래 B4를 자르면 그 칸을 빼고, 어느 트랙에도 겹치는 음이 없다", () => {
    const s = songOf({
      base: [w("e", [0, 1], [1, 4], 64), w("fs", [1, 4], [1, 2], 66)],
      t2: [w("e2", [1, 4], [1, 2], 64)],
      t3: [w("b", [0, 1], [1, 2], 71)],
    });
    const r = planArpeggio(s, "base", s.tracks[0]!.notes, { ...strum, maxTracks: 6 }, newId);
    const tracks = applied(s, r);
    for (const t of tracks) expect(overlaps(t.notes), t.id).toBe(false);
    // B4는 [0, 1/2) 그대로 남거나 (그 칸이 빠져 cutCells가 는다), 같은 트랙에서 1/2까지 울린다
    const t3 = tracks.find((t) => t.id === "t3")!.notes;
    expect(t3.some((x) => x.pitch === 71 && cmp(add(x.start, x.dur), rat(1, 2)) >= 0)).toBe(true);
    expect(r.cutCells).toBe(1);
    // 알리는 음 수는 실제로 들어간 새 음 수
    const made = tracks.flatMap((t) => t.notes).filter((x) => x.id.startsWith("x")).length;
    expect(r.notes).toBe(made);
  });
});

describe("깔기 성질: 겹침 없음, 원래 음은 끝까지 남거나 그 칸이 취소된다", () => {
  /** 작은 결정적 난수 */
  const rng = (seed: number) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);

  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
    it(`시드 ${seed}`, () => {
      const r0 = rng(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r0() * xs.length)]!;
      // 트랙 셋, 트랙마다 겹치지 않는 음 몇 개 (16분음표 칸 위에서)
      let id = 0;
      const tracks: Record<string, Note[]> = {};
      for (const t of ["t1", "t2", "t3"]) {
        const notes: Note[] = [];
        let at = 0;
        while (at < 16) {
          at += Math.floor(r0() * 3);
          const len = 1 + Math.floor(r0() * 6);
          if (at + len > 20) break;
          notes.push(w(`${t}n${id++}`, [at, 16], [len, 16], 55 + Math.floor(r0() * 20)));
          at += len;
        }
        tracks[t] = notes;
      }
      const s = songOf(tracks);
      const base = s.tracks[0]!;
      if (base.notes.length === 0) return;
      const picked = base.notes.filter(() => r0() < 0.7);
      if (picked.length === 0) picked.push(base.notes[0]!);
      const options: ArpOptions = {
        ...strum,
        order: pick(["up", "down", "updown"] as const),
        step: pick([rat(1, 16), rat(1, 32), rat(1, 8)]),
        octaves: pick([1, 2, 3]),
        repeat: pick([true, false]),
        maxTracks: pick([3, 4, 6]),
      };
      const r = planArpeggio(s, "t1", picked, options, newId);
      const out = applied(s, r);
      for (const t of out) expect(overlaps(t.notes), `${t.id} ${JSON.stringify(options)}`).toBe(false);
      // 칸을 이루는 원래 음: 같은 트랙에 같은 높이로 원래 끝까지 울리거나 (그대로 남은 것도 포함)
      const { cells } = arpCells(s, "t1", picked, options);
      for (const cell of cells)
        for (const x of cell.sources) {
          const t = out.find((o) => o.id === x.trackId)!.notes;
          const ok = t.some((n) => n.pitch === x.note.pitch && cmp(n.start, x.note.start) <= 0 && cmp(add(n.start, n.dur), add(x.note.start, x.note.dur)) >= 0) ||
            t.some((n) => n.pitch === x.note.pitch && cmp(add(n.start, n.dur), add(x.note.start, x.note.dur)) >= 0 && cmp(n.start, add(x.note.start, x.note.dur)) < 0);
          expect(ok, `${x.trackId}/${x.note.id}`).toBe(true);
        }
      // 칸 밖 음(어느 칸에도 들지 않는 음)은 자리·길이·높이가 그대로
      const inCells = new Set(cells.flatMap((c) => c.sources.map((x) => x.note.id)));
      for (const t of s.tracks)
        for (const n0 of t.notes) {
          if (inCells.has(n0.id)) continue;
          const now = out.find((o) => o.id === t.id)!.notes.find((x) => x.id === n0.id);
          expect(now && [now.start, now.dur, now.pitch], n0.id).toEqual([n0.start, n0.dur, n0.pitch]);
        }
    });
  }
});
