import { describe, expect, it } from "vitest";
import { emptySong, harmonicLabel, MOBILE_PROFILE, planGhost, planHarmonic, planLabClear, rat, type Note, type Song } from "../src/index.js";

const n = (id: string, at: number, pitch: number, vol: number, extra: Partial<Note> = {}): Note => ({ id, start: rat(at, 4), dur: rat(1, 4), pitch, vol, tie: "none", ...extra });

function songOf(notes: Note[]): Song {
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    players: [{ id: "p1", name: "p", instrument: { canonical: "folk-guitar" } }],
    tracks: [{ id: "t1", playerId: "p1", name: "t", color: "", role: "free", mute: false, solo: false, notes, spelling: {} }],
  };
}
const notesOf = (r: { changes: readonly { notes: readonly Note[] }[] }) => r.changes[0]?.notes ?? [];

describe("고스트 노트", () => {
  it("주변 보통 음 v보다 N단계 작게 (가까운 음 기준, 같은 거리면 앞 음)", () => {
    const s = songOf([n("a", 0, 60, 12), n("b", 1, 62, 12), n("c", 2, 64, 8)]);
    const r = planGhost(s, [s.tracks[0]!.notes[1]!], { steps: 4 }, MOBILE_PROFILE);
    expect(r.made).toBe(1);
    const b = notesOf(r).find((x) => x.id === "b")!;
    expect(b.vol).toBe(8);
    expect(b.lab).toEqual({ kind: "ghost", vol: 12 });
  });

  it("곡마다 볼륨이 달라도 주변 기준: 조용한 곡에서는 더 작은 v", () => {
    const s = songOf([n("a", 0, 60, 7), n("b", 1, 62, 7)]);
    expect(notesOf(planGhost(s, [s.tracks[0]!.notes[1]!], { steps: 3 }, MOBILE_PROFILE))[1]!.vol).toBe(4);
  });

  it("고른 음끼리·이미 고스트인 음은 기준에서 빼고, v0 아래로 내려가지 않는다", () => {
    const s = songOf([n("a", 0, 60, 3), n("g", 1, 61, 1, { lab: { kind: "ghost", vol: 3 } }), n("b", 2, 62, 9), n("c", 3, 64, 9)]);
    const picked = s.tracks[0]!.notes.filter((x) => x.id === "b" || x.id === "c");
    const out = notesOf(planGhost(s, picked, { steps: 5 }, MOBILE_PROFILE));
    // b·c 앞의 보통 음은 a(v3) → v0으로 막힌다
    expect(out.find((x) => x.id === "b")!.vol).toBe(0);
    expect(out.find((x) => x.id === "c")!.vol).toBe(0);
  });

  it("&로 이어 받은 음은 고르지 않고, 이어 울리는 뒷음은 함께 바꾼다", () => {
    const s = songOf([n("a", 0, 60, 10), n("b", 1, 62, 10, { tie: "next" }), n("b2", 2, 62, 10)]);
    const tail = s.tracks[0]!.notes[2]!;
    expect(planGhost(s, [tail], { steps: 2 }, MOBILE_PROFILE)).toMatchObject({ made: 0, skipped: { tied: 1 } });
    const out = notesOf(planGhost(s, [s.tracks[0]!.notes[1]!], { steps: 2 }, MOBILE_PROFILE));
    expect(out.map((x) => x.vol)).toEqual([10, 8, 8]);
  });

  it("잠근 트랙은 건너뛴다", () => {
    const s = songOf([n("a", 0, 60, 10), n("b", 1, 62, 10)]);
    expect(planGhost(s, [s.tracks[0]!.notes[1]!], { steps: 2, locked: new Set(["t1"]) }, MOBILE_PROFILE)).toMatchObject({ made: 0, changes: [], skipped: { locked: 1 } });
  });
});

describe("하모닉스", () => {
  // 6번 줄 개방 E2(40)
  const at = (fret: number) => ({ string: 6, fret, open: 40 });

  it("자연: 12프렛 +12, 7프렛 +19, 5프렛 +24 (개방현 기준), 작게", () => {
    const s = songOf([n("a", 0, 52, 10), n("b", 1, 47, 10), n("c", 2, 45, 10)]);
    const frets = new Map([["a", 12], ["b", 7], ["c", 5]]);
    const r = planHarmonic(s, s.tracks[0]!.notes, { type: "natural", quieter: 2, positionOf: (x) => at(frets.get(x.id)!) }, MOBILE_PROFILE);
    expect(notesOf(r).map((x) => [x.pitch, x.vol, x.tabString])).toEqual([
      [52, 8, 6],
      [59, 8, 6],
      [64, 8, 6],
    ]);
    expect(notesOf(r)[1]!.lab).toEqual({ kind: "harmonic", type: "natural", pitch: 47, vol: 10, string: 6, fret: 7 });
  });

  it("자연: 하모닉스가 없는 프렛·줄을 모르는 음은 건너뛴다", () => {
    const s = songOf([n("a", 0, 43, 10), n("b", 1, 60, 10)]);
    const r = planHarmonic(s, s.tracks[0]!.notes, { type: "natural", quieter: 0, positionOf: (x) => (x.id === "a" ? at(3) : undefined) }, MOBILE_PROFILE);
    expect(r).toMatchObject({ made: 0, skipped: { fret: 2 } });
  });

  it("인공: 누른 음 +12, 이미 하모닉스면 두 번 올리지 않는다", () => {
    const s = songOf([n("a", 0, 43, 10)]);
    const r = planHarmonic(s, s.tracks[0]!.notes, { type: "artificial", quieter: 1 }, MOBILE_PROFILE);
    const a = notesOf(r)[0]!;
    expect([a.pitch, a.vol]).toEqual([55, 9]);
    const again = songOf([a]);
    expect(planHarmonic(again, [a], { type: "artificial", quieter: 1 }, MOBILE_PROFILE)).toMatchObject({ made: 0, skipped: { same: 1 } });
  });

  it("타브 글자: 맞는 줄·프렛일 때만 <n>", () => {
    const lab = { kind: "harmonic", type: "natural", pitch: 47, vol: 10, string: 6, fret: 7 } as const;
    const note = n("a", 0, 59, 8, { lab });
    expect(harmonicLabel(note, { string: 6, fret: 19 })).toBe("<7>");
    expect(harmonicLabel(note, { string: 5, fret: 14 })).toBeUndefined();
    const art = n("b", 0, 55, 8, { lab: { kind: "harmonic", type: "artificial", pitch: 43, vol: 10, string: 6, fret: 3 } });
    expect(harmonicLabel(art, { string: 6, fret: 15 })).toBe("3<15>");
  });
});

describe("실험실 표시 풀기", () => {
  it("고스트는 처음 v로, 하모닉스는 처음 높이·v로", () => {
    const s = songOf([
      n("a", 0, 60, 6, { lab: { kind: "ghost", vol: 11 } }),
      n("b", 1, 59, 8, { lab: { kind: "harmonic", type: "natural", pitch: 47, vol: 10, string: 6, fret: 7 } }),
      n("c", 2, 64, 9),
    ]);
    const r = planLabClear(s, s.tracks[0]!.notes);
    expect(r.made).toBe(2);
    expect(notesOf(r).map((x) => [x.pitch, x.vol, x.lab])).toEqual([
      [60, 11, undefined],
      [47, 10, undefined],
      [64, 9, undefined],
    ]);
  });

  it("하모닉스 뒤에 높이를 바꿨으면 높이는 두고 표시만 버린다", () => {
    const s = songOf([n("b", 1, 61, 8, { lab: { kind: "harmonic", type: "natural", pitch: 47, vol: 10, string: 6, fret: 7 } })]);
    const b = notesOf(planLabClear(s, s.tracks[0]!.notes))[0]!;
    expect([b.pitch, b.vol, b.lab]).toEqual([61, 8, undefined]);
  });
});
