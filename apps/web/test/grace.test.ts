import { describe, expect, it } from "vitest";
import { add, cmp, defaultLengthLimit, gameLengths, graceMax, History, MOBILE_PROFILE, planGrace, rat, type GraceOptions, type Note, type Rat, type Song } from "@mmlce/core";
import { addTrack, addPlayer, canWriteExactly, newSong, setTracksNotes } from "@mmlce/mml";
import { newUnwritableTrack, unwritableLengths } from "../src/lib/writable";

const limit = defaultLengthLimit();
const canWrite = (r: Rat) => canWriteExactly(r, limit);
const n = (id: string, start: Rat, dur: Rat, pitch = 60, extra: Partial<Note> = {}): Note => ({ id, start, dur, pitch, vol: 10, tie: "none", ...extra });
/** 연주자 p1(트랙 t1·t2)과 p2(트랙 t3) */
function songOf(t1: Note[], t2: Note[] = [], t3: Note[] = []): Song {
  let s = addTrack("p1", "트랙 2").apply(newSong({ playerName: "기타", trackName: "트랙 1" }));
  s = addPlayer("piano", "피아노", "트랙 3").apply(s);
  const other = s.tracks.find((tr) => tr.playerId !== "p1")!.id;
  return { ...s, tracks: s.tracks.map((tr) => ({ ...tr, notes: tr.id === "t1" ? t1 : tr.id === "t2" ? t2 : tr.id === other ? t3 : tr.notes })) };
}
const third = (s: Song) => s.tracks.find((tr) => tr.playerId !== "p1")!.id;
const base: GraceOptions = { offsets: [-2], length: rat(1, 64), timing: "on", tie: false, canWrite };
let k = 0;
const newId = () => `g${++k}`;
const run = (s: Song, picked: string[], options: Partial<GraceOptions> = {}) => {
  const all = s.tracks.flatMap((tr) => tr.notes);
  return planGrace(s, all.filter((x) => picked.includes(x.id)), { ...base, ...options }, MOBILE_PROFILE, newId);
};
const shape = (notes: readonly Note[] | undefined) => (notes ?? []).map((x) => `${x.pitch}@${x.start.n}/${x.start.d}+${x.dur.n}/${x.dur.d}${x.tie === "next" ? "&" : ""}`);
const notesOf = (r: ReturnType<typeof run>, trackId: string) => r.changes.find((c) => c.trackId === trackId)?.notes;

describe("박 위에서 (본음이 늦게 시작)", () => {
  it("c8에 꾸밈음 하나(l64, 2반음 아래): 꾸밈음이 박에, 본음은 1/64 늦게", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 8))]), ["a"]);
    expect(shape(notesOf(r, "t1"))).toEqual(["58@0/1+1/64", "60@1/64+7/64"]);
    expect(r.made).toBe(1);
    expect(r.ids).toContain("a");
  });

  it("최대 개수: 8분음표 l64는 7개, 4분음표는 15개, l32면 4분음표에 7개 (본음은 l64 이상 남김)", () => {
    const s8 = songOf([n("a", rat(0), rat(1, 8))]);
    expect(run(s8, ["a"]).max).toBe(7);
    const s4 = songOf([n("a", rat(0), rat(1, 4))]);
    expect(run(s4, ["a"]).max).toBe(15);
    expect(run(s4, ["a"], { length: rat(1, 32) }).max).toBe(7);
  });

  it("최대보다 많으면 아무것도 바꾸지 않는다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 8))]), ["a"], { offsets: [1, 2, 3, 4, 5, 6, 7, 8] });
    expect(r.tooMany).toBe(true);
    expect(r.changes).toEqual([]);
  });

  it("최대 개수만큼은 된다: 8분음표에 7개면 본음이 l64", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 8))]), ["a"], { offsets: [1, 2, 3, 4, 5, 6, 7] });
    expect(notesOf(r, "t1")!.at(-1)!.dur).toEqual(rat(1, 64));
    expect(notesOf(r, "t1")).toHaveLength(8);
  });

  it("&로 잇기: 꾸밈음이 모두 &로 본음까지 이어진다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 4))]), ["a"], { offsets: [0, 2], length: rat(1, 32), tie: true });
    expect(shape(notesOf(r, "t1"))).toEqual(["60@0/1+1/32&", "62@1/32+1/32&", "60@1/16+3/16"]);
  });

  it("&로 이을 때 높이 차가 너무 크면 건너뛴다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 4))]), ["a"], { offsets: [-25], tie: true });
    expect(r.skipped.bend).toBe(1);
    expect(r.changes).toEqual([]);
    // &를 끄면 다시 치므로 괜찮다
    expect(run(songOf([n("a", rat(0), rat(1, 4))]), ["a"], { offsets: [-25] }).made).toBe(1);
  });

  it("높이가 MIDI 범위 밖이면 건너뛴다", () => {
    expect(run(songOf([n("a", rat(0), rat(1, 4), 127)]), ["a"], { offsets: [2] }).skipped.range).toBe(1);
  });

  it("&로 이어 받은 음(새로 치지 않는 음)에는 붙이지 않는다", () => {
    const s = songOf([n("a", rat(0), rat(1, 8), 60, { tie: "next" }), n("b", rat(1, 8), rat(1, 8))]);
    const r = run(s, ["b"]);
    expect(r.skipped.tied).toBe(1);
    expect(r.changes).toEqual([]);
  });

  it("뒤로 &가 이어진 본음(마디를 넘는 음 등)은 &를 지킨다", () => {
    const s = songOf([n("a", rat(3, 4), rat(1, 4), 60, { tie: "next" }), n("b", rat(1), rat(1, 2))]);
    const r = run(s, ["a"]);
    expect(shape(notesOf(r, "t1"))).toEqual(["58@3/4+1/64", "60@49/64+15/64&", "60@1/1+1/2"]);
  });

  it("잇단음 칸: 셋잇단 8분(1/12)에서도 남는 길이가 정확히 써지는 개수만", () => {
    const s = songOf([n("a", rat(0), rat(1, 12))]);
    const r = run(s, ["a"], { length: rat(1, 48) });
    expect(r.max).toBe(3);
    const done = run(s, ["a"], { length: rat(1, 48), offsets: [1, 2, 3] });
    expect(shape(notesOf(done, "t1"))).toEqual(["61@0/1+1/48", "62@1/48+1/48", "63@1/24+1/48", "60@1/16+1/48"]);
    // l64 꾸밈음은 남는 길이마다 써지는지 따로 본다 (써지지 않는 개수는 건너뛰고 가장 큰 것)
    const m = run(s, ["a"]).max;
    for (let i = 1; i <= m; i++) expect(canWrite(rat(1 * 64 - 12 * i, 12 * 64)) || i !== m).toBe(true);
  });

  it("다섯잇단처럼 남는 길이를 쓸 수 없는 개수는 고를 수 없다", () => {
    // 1/20 − 1/64 = 11/320: 정확히 써지지 않는다
    expect(canWrite(rat(11, 320))).toBe(false);
    const s = songOf([n("a", rat(0), rat(1, 20))]);
    const r = run(s, ["a"], { offsets: [1] });
    expect(r.changes).toEqual([]);
  });

  it("화음: 같은 연주자의 다른 트랙에서 같은 때 치는 음도 함께 늦게, 다른 연주자는 그대로", () => {
    const s = songOf([n("a", rat(0), rat(1, 4), 64)], [n("b", rat(0), rat(1, 4), 60)], [n("c", rat(0), rat(1, 4), 48)]);
    const r = run(s, ["a"], { offsets: [2] });
    expect(shape(notesOf(r, "t1"))).toEqual(["66@0/1+1/64", "64@1/64+15/64"]);
    expect(shape(notesOf(r, "t2"))).toEqual(["60@1/64+15/64"]);
    expect(notesOf(r, third(s))).toBeUndefined();
    expect(r.ids).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("화음 음 하나가 너무 짧으면 그 화음은 통째로 건너뛴다", () => {
    const s = songOf([n("a", rat(0), rat(1, 4), 64)], [n("b", rat(0), rat(1, 64), 60)]);
    const r = run(s, ["a"], { offsets: [2] });
    expect(r.max).toBe(0);
    expect(r.tooMany).toBe(true);
    expect(r.changes).toEqual([]);
  });

  it("화음 음이 &로 이어 받은 음이면 늦추지 않는다 (계속 울린다)", () => {
    const s = songOf([n("a", rat(1, 8), rat(1, 4), 64)], [n("x", rat(0), rat(1, 8), 60, { tie: "next" }), n("b", rat(1, 8), rat(1, 4), 60)]);
    const r = run(s, ["a"]);
    expect(r.made).toBe(1);
    expect(notesOf(r, "t2")).toBeUndefined();
  });

  it("화음을 여러 트랙에서 함께 고르면 가장 높은 음에 한 번만 붙인다", () => {
    const s = songOf([n("a", rat(0), rat(1, 4), 60)], [n("b", rat(0), rat(1, 4), 64)]);
    const r = run(s, ["a", "b"], { offsets: [2] });
    expect(r.made).toBe(1);
    expect(shape(notesOf(r, "t2"))).toEqual(["66@0/1+1/64", "64@1/64+15/64"]);
    expect(shape(notesOf(r, "t1"))).toEqual(["60@1/64+15/64"]);
  });

  it("여러 본음을 함께 고르면 먼저 늦춘 음을 뒤 본음의 화음으로 다시 늦추지 않는다 (GPT 재현: c4,r16e4)", () => {
    const s = songOf([n("a", rat(0), rat(1, 4), 60)], [n("b", rat(1, 16), rat(1, 4), 64)]);
    const r = run(s, ["a", "b"], { offsets: [2], length: rat(1, 16) });
    expect(r.made).toBe(2);
    expect(shape(notesOf(r, "t1"))).toEqual(["62@0/1+1/16", "60@1/16+3/16"]);
    expect(shape(notesOf(r, "t2"))).toEqual(["66@1/16+1/16", "64@1/8+3/16"]);
  });

  it("앞 본음을 늦춘 자리가 뒤 본음과 겹쳐도 뒤 본음의 자리 판정이 바뀌지 않는다 (짧은 앞 본음)", () => {
    const s = songOf([n("a", rat(0), rat(1, 8), 60)], [n("b", rat(1, 64), rat(1, 4), 64)]);
    const r = run(s, ["a", "b"], { offsets: [2] });
    expect(r.made).toBe(2);
    expect(shape(notesOf(r, "t1"))).toEqual(["62@0/1+1/64", "60@1/64+7/64"]);
  });

  it("화음 음을 늦춰 그 앞 쉼표가 쓸 수 없는 길이가 되면 막는다", () => {
    // t2: 1/20 음 뒤 쉼표 1/80(원래 못 쓰는 쉼표) 다음 화음 음. 1/64 늦추면 9/320이라는 새 못 쓰는 길이가 된다 (실행 취소 기록 검사가 거절할 편집)
    const s = songOf([n("a", rat(1, 16), rat(1, 4), 64)], [n("x", rat(0), rat(1, 20), 50), n("b", rat(1, 16), rat(1, 4), 60)]);
    expect(canWrite(rat(9, 320))).toBe(false);
    const r = run(s, ["a"]);
    expect(r.changes).toEqual([]);
  });

  it("화음 음이 잠근 트랙이면 건너뛴다", () => {
    const s = songOf([n("a", rat(0), rat(1, 4), 64)], [n("b", rat(0), rat(1, 4), 60)]);
    const r = run(s, ["a"], { locked: new Set(["t2"]) });
    expect(r.skipped.locked).toBe(1);
    expect(r.changes).toEqual([]);
  });

  it("타브 줄: stringOf가 준 줄에 꾸밈음을 놓는다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 4))]), ["a"], { stringOf: () => 3 });
    expect(notesOf(r, "t1")![0]!.tabString).toBe(3);
  });
});

describe("박 앞에서 (앞 음을 줄임)", () => {
  it("c4 d4의 d에 꾸밈음 둘(l32): c 꼬리가 줄고 d는 제자리", () => {
    const s = songOf([n("a", rat(0), rat(1, 4)), n("b", rat(1, 4), rat(1, 4), 62)]);
    const r = run(s, ["b"], { timing: "before", offsets: [0, 4], length: rat(1, 32) });
    expect(shape(notesOf(r, "t1"))).toEqual(["60@0/1+3/16", "62@3/16+1/32", "66@7/32+1/32", "62@1/4+1/4"]);
  });

  it("앞이 쉼표면 쉼표가 줄어든다 (남는 쉼표도 정확히 써져야)", () => {
    const s = songOf([n("a", rat(0), rat(1, 4)), n("b", rat(3, 8), rat(1, 4), 62)]);
    const r = run(s, ["b"], { timing: "before" });
    expect(shape(notesOf(r, "t1"))).toEqual(["60@0/1+1/4", "60@23/64+1/64", "62@3/8+1/4"]);
  });

  it("쉼표와 앞 음을 함께 먹을 수 있다", () => {
    const s = songOf([n("a", rat(0), rat(1, 4)), n("b", rat(17, 64), rat(1, 4), 62)]);
    const r = run(s, ["b"], { timing: "before", offsets: [1, 2] });
    expect(shape(notesOf(r, "t1"))).toEqual(["60@0/1+15/64", "63@15/64+1/64", "64@1/4+1/64", "62@17/64+1/4"]);
  });

  it("곡 처음 음에는 자리가 없다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 4))]), ["a"], { timing: "before" });
    expect(r.max).toBe(0);
    expect(r.changes).toEqual([]);
  });

  it("앞 음이 너무 짧으면 막는다 (앞 음은 l64 이상 남김)", () => {
    const s = songOf([n("a", rat(0), rat(1, 64)), n("b", rat(1, 64), rat(1, 4), 62)]);
    expect(run(s, ["b"], { timing: "before" }).max).toBe(0);
    const s2 = songOf([n("a", rat(0), rat(1, 16)), n("b", rat(1, 16), rat(1, 4), 62)]);
    expect(run(s2, ["b"], { timing: "before" }).max).toBe(3);
  });

  it("앞 음이 &로 이어 주는 음이면 본음은 새로 치지 않으므로 건너뛴다", () => {
    const s = songOf([n("a", rat(0), rat(1, 4), 60, { tie: "next" }), n("b", rat(1, 4), rat(1, 4), 62)]);
    expect(run(s, ["b"], { timing: "before" }).skipped.tied).toBe(1);
  });

  it("화음은 제자리, 다른 화음 음도 그대로 (꾸밈음 트랙만 바뀜)", () => {
    const s = songOf([n("p", rat(0), rat(1, 4)), n("a", rat(1, 4), rat(1, 4), 64)], [n("q", rat(0), rat(1, 4)), n("b", rat(1, 4), rat(1, 4), 60)]);
    const r = run(s, ["a"], { timing: "before" });
    expect(notesOf(r, "t2")).toBeUndefined();
    expect(shape(notesOf(r, "t1"))).toEqual(["60@0/1+15/64", "62@15/64+1/64", "64@1/4+1/4"]);
  });

  it("붙은 음 여럿을 고르면 각자 앞 음에서 깎는다 (첫 음은 곡 처음이라 최대 0 → 막음)", () => {
    const s = songOf([n("a", rat(1, 8), rat(1, 8)), n("b", rat(1, 4), rat(1, 8), 62), n("c", rat(3, 8), rat(1, 8), 64)]);
    const r = run(s, ["a", "b", "c"], { timing: "before" });
    expect(r.made).toBe(3);
    expect(shape(notesOf(r, "t1"))).toEqual(["58@7/64+1/64", "60@1/8+7/64", "60@15/64+1/64", "62@1/4+7/64", "62@23/64+1/64", "64@3/8+1/8"]);
  });

  it("다른 연주자 트랙 고른 음은 각자 트랙에서", () => {
    const s = songOf([n("p", rat(0), rat(1, 4)), n("a", rat(1, 4), rat(1, 4), 64)], [], [n("q", rat(0), rat(1, 4)), n("c", rat(1, 4), rat(1, 4), 48)]);
    const r = run(s, ["a", "c"], { timing: "before" });
    expect(r.made).toBe(2);
    expect(notesOf(r, third(s))).toHaveLength(3);
  });
});

describe("성질: 어떤 길이·잇단음·방식이든 쓸 수 없는 길이를 새로 만들지 않고, 실행 취소 기록 검사를 지난다", () => {
  const lengths = gameLengths(limit).map((g) => g.value);
  // 결정적 난수
  let seed = 12345;
  const rand = (m: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % m);
  it("무작위 곡 400개", () => {
    let applied = 0;
    for (let round = 0; round < 400; round++) {
      // t1: 음 6개 (가끔 l64 쉼표, 가끔 &), t2: 같은 연주자 화음 트랙 (t1 음과 같은 때 시작하는 음)
      const notes: Note[] = [];
      const other: Note[] = [];
      let at: Rat = rat(0);
      let otherEnd: Rat = rat(0);
      for (let i = 0; i < 6; i++) {
        if (rand(4) === 0) at = add(at, rat(1, 64));
        const dur = lengths[rand(lengths.length)]!;
        notes.push(n(`a${i}`, at, dur, 50 + rand(20), { tie: rand(5) === 0 ? "next" : "none" }));
        const od = lengths[rand(lengths.length)]!;
        // 화음 트랙 음은 같은 때 시작하거나, 조금(꾸밈음 길이쯤) 늦게 시작한다
        const oat = rand(3) === 0 ? add(at, [rat(1, 64), rat(1, 48), rat(1, 32), rat(1, 16)][rand(4)]!) : at;
        if (rand(2) === 0 && cmp(otherEnd, oat) <= 0) {
          other.push(n(`b${i}`, oat, od, 40 + rand(10)));
          otherEnd = add(oat, od);
        }
        at = add(at, dur);
      }
      const s = songOf(notes, other);
      const pool = [...notes, ...other];
      const picked = [notes[rand(6)]!.id, ...Array.from({ length: rand(3) }, () => pool[rand(pool.length)]!.id)];
      const timing = rand(2) ? "on" : "before";
      const length = [rat(1, 64), rat(1, 48), rat(1, 32), rat(1, 24), rat(1, 16)][rand(5)]!;
      const max = graceMax(s, s.tracks.flatMap((tr) => tr.notes).filter((x) => picked.includes(x.id)), { length, timing, canWrite }, MOBILE_PROFILE);
      const count = 1 + rand((max ?? 0) + 2);
      const r = run(s, picked, { timing, length, offsets: Array.from({ length: count }, (_, i) => i - 1), tie: rand(2) === 0 });
      if (max !== undefined && count > max) expect(r.tooMany).toBe(true);
      if (r.changes.length === 0) continue;
      applied++;
      const h = new History(s, (before, after) => newUnwritableTrack(before, after, limit) === undefined);
      h.run(setTracksNotes(r.changes.map((c) => ({ trackId: c.trackId, notes: c.notes })), "꾸밈음"));
      expect(h.refused).toBe(false);
      for (const c of r.changes) {
        const was = s.tracks.find((t) => t.id === c.trackId)!.notes;
        // 편집 전에 없던 쓸 수 없는 길이가 생기지 않는다 (무작위 화음 트랙에는 원래 있을 수 있다)
        const old = unwritableLengths(was, limit);
        for (const u of unwritableLengths(c.notes, limit)) expect(old).toContain(u);
        // 음 길이는 모두 최단 이상, 원래 음은 하나도 사라지지 않는다
        for (const x of c.notes) expect(cmp(x.dur, rat(1, 64))).toBeGreaterThanOrEqual(0);
        for (const x of was) expect(c.notes.some((y) => y.id === x.id)).toBe(true);
        // 박 위에서는 원래 음이 그대로이거나 꾸밈음 길이만큼 한 번만 늦고, 박 앞에서는 원래 음 시작이 그대로다
        const total = rat(length.n * count, length.d);
        for (const x of was) {
          const now = c.notes.find((y) => y.id === x.id)!;
          const ok = cmp(now.start, x.start) === 0 || (timing === "on" && cmp(now.start, add(x.start, total)) === 0);
          expect(ok, `${x.id} ${x.start.n}/${x.start.d} → ${now.start.n}/${now.start.d}`).toBe(true);
        }
        // 곡 끝은 그대로
        const endOf = (ns: readonly Note[]) => ns.reduce<Rat>((m, x) => (cmp(add(x.start, x.dur), m) > 0 ? add(x.start, x.dur) : m), rat(0));
        expect(endOf(c.notes)).toEqual(endOf(was));
      }
    }
    expect(applied).toBeGreaterThan(100);
  });
});
