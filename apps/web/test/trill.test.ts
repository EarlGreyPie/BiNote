import { describe, expect, it } from "vitest";
import { defaultLengthLimit, MOBILE_PROFILE, planTrill, rat, type Note, type Rat, type Song, type TrillOptions } from "@mmlce/core";
import { addPlayer, addTrack, canWriteExactly, newSong } from "@mmlce/mml";
import { parseTrillChoice, parseTrillInput, formatTrillInput } from "../src/lib/trillOptions";

const limit = defaultLengthLimit();
const canWrite = (r: Rat) => canWriteExactly(r, limit);
const n = (id: string, start: Rat, dur: Rat, pitch = 60, extra: Partial<Note> = {}): Note => ({ id, start, dur, pitch, vol: 10, tie: "none", ...extra });
/** 연주자 p1(트랙 t1·t2)과 p2(트랙 하나) */
function songOf(t1: Note[], t2: Note[] = [], t3: Note[] = []): Song {
  let s = addTrack("p1", "트랙 2").apply(newSong({ playerName: "기타", trackName: "트랙 1" }));
  s = addPlayer("piano", "피아노", "트랙 3").apply(s);
  const other = s.tracks.find((tr) => tr.playerId !== "p1")!.id;
  return { ...s, tracks: s.tracks.map((tr) => ({ ...tr, notes: tr.id === "t1" ? t1 : tr.id === "t2" ? t2 : tr.id === other ? t3 : tr.notes })) };
}
const base: TrillOptions = { kind: "trill", offset: 2, length: rat(1, 32), startOther: false, endOnMain: false, tie: false, canWrite };
let k = 0;
const newId = () => `r${++k}`;
const run = (s: Song, picked: string[], options: Partial<TrillOptions> = {}) => {
  const all = s.tracks.flatMap((tr) => tr.notes);
  return planTrill(s, all.filter((x) => picked.includes(x.id)), { ...base, ...options }, MOBILE_PROFILE, newId);
};
const shape = (notes: readonly Note[] | undefined) => (notes ?? []).map((x) => `${x.pitch}@${x.start.n}/${x.start.d}+${x.dur.n}/${x.dur.d}${x.tie === "next" ? "&" : ""}`);
const pitches = (notes: readonly Note[] | undefined) => (notes ?? []).map((x) => x.pitch);
const notesOf = (r: ReturnType<typeof run>, trackId: string) => r.changes.find((c) => c.trackId === trackId)?.notes;

describe("트릴", () => {
  it("4분음표 c를 l32 온음 위 트릴로: 8개를 번갈아, 원래 음은 없어진다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 4))]), ["a"]);
    expect(pitches(notesOf(r, "t1"))).toEqual([60, 62, 60, 62, 60, 62, 60, 62]);
    expect(notesOf(r, "t1")!.every((x) => x.dur.n === 1 && x.dur.d === 32 && x.id !== "a")).toBe(true);
    expect(r.made).toBe(1);
    expect(r.pieces).toBe(8);
    expect(r.ids).toHaveLength(8);
  });

  it("상대 음부터 치기, 아래 음 트릴", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 8))]), ["a"], { startOther: true, offset: -1 });
    expect(pitches(notesOf(r, "t1"))).toEqual([59, 60, 59, 60]);
  });

  it("본음으로 끝내기: 마지막 상대 음을 앞 본음에 합친다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 4))]), ["a"], { endOnMain: true });
    expect(shape(notesOf(r, "t1")).at(-1)).toBe("60@3/16+1/16");
    expect(pitches(notesOf(r, "t1"))).toEqual([60, 62, 60, 62, 60, 62, 60]);
    // 이미 본음으로 끝나면 그대로
    const r2 = run(songOf([n("a", rat(0), rat(1, 4))]), ["a"], { endOnMain: true, startOther: true });
    expect(pitches(notesOf(r2, "t1"))).toHaveLength(8);
  });

  it("나누어떨어지지 않으면 남는 길이를 마지막 음에 붙인다 (셋잇단 4분 = 1/6 → l32 넷 + l24)", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 6))]), ["a"]);
    expect(shape(notesOf(r, "t1"))).toEqual(["60@0/1+1/32", "62@1/32+1/32", "60@1/16+1/32", "62@3/32+1/32", "60@1/8+1/24"]);
  });

  it("마지막 음 길이를 정확히 쓸 수 없으면 건너뛴다 (반올림하지 않음)", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 6))]), ["a"], { canWrite: (x) => x.d === 32 });
    expect(r.changes).toEqual([]);
    expect(r.skipped.unwritable).toBe(1);
  });

  it("음 하나 길이의 두 배보다 짧으면 건너뛴다", () => {
    const r = run(songOf([n("a", rat(0), rat(3, 64))]), ["a"]);
    expect(r.made).toBe(0);
    expect(r.skipped.short).toBe(1);
  });

  it("&로 잇기: 마지막 음 앞까지 모두 &, 마지막 음은 본음의 &를 따른다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 8))]), ["a"], { tie: true });
    expect(shape(notesOf(r, "t1"))).toEqual(["60@0/1+1/32&", "62@1/32+1/32&", "60@1/16+1/32&", "62@3/32+1/32"]);
    const r2 = run(songOf([n("a", rat(0), rat(1, 8), 60, { tie: "next" }), n("b", rat(1, 8), rat(1, 4))]), ["a"]);
    expect(shape(notesOf(r2, "t1"))).toEqual(["60@0/1+1/32", "62@1/32+1/32", "60@1/16+1/32", "62@3/32+1/32&", "60@1/8+1/4"]);
  });

  it("&로 이어 받은 음(새로 치지 않는 음)은 건너뛴다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 4), 60, { tie: "next" }), n("b", rat(1, 4), rat(1, 4))]), ["b"]);
    expect(r.made).toBe(0);
    expect(r.skipped.tied).toBe(1);
  });

  it("뒤로 이어지는 & 사슬 높이 차가 너무 크면 건너뛴다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 4), 40, { tie: "next" }), n("b", rat(1, 4), rat(1, 4), 70)]), ["a"]);
    expect(r.skipped.bend).toBe(1);
  });

  it("상대 음이 악기 음역 밖이라 접히면 간격이 달라지므로 건너뛴다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 4), 70)]), ["a"], { offset: -2, instrumentOf: () => "cat-harmonica" });
    expect(r.skipped.range).toBe(1);
    expect(run(songOf([n("a", rat(0), rat(1, 4), 70)]), ["a"], { offset: 2, instrumentOf: () => "cat-harmonica" }).made).toBe(1);
  });

  it("화음을 함께 고르면 같은 연주자 가운데 가장 높은 음에만 건다 (다른 연주자는 따로)", () => {
    const s = songOf([n("a", rat(0), rat(1, 4), 60)], [n("b", rat(0), rat(1, 4), 64)], [n("c", rat(0), rat(1, 4), 48)]);
    const r = run(s, ["a", "b", "c"]);
    expect(notesOf(r, "t1")).toBeUndefined();
    expect(pitches(notesOf(r, "t2"))).toEqual([64, 66, 64, 66, 64, 66, 64, 66]);
    expect(r.made).toBe(2);
  });

  it("잠근 트랙은 건너뛴다", () => {
    const r = run(songOf([n("a", rat(0), rat(1, 4))]), ["a"], { locked: new Set(["t1"]) });
    expect(r.changes).toEqual([]);
    expect(r.skipped.locked).toBe(1);
  });

  it("타브 줄과 v를 지키고, 실험실 표시는 본음 높이 음에만 남긴다", () => {
    const lab = { kind: "ghost", vol: 12 } as const;
    const r = run(songOf([n("a", rat(0), rat(1, 8), 60, { vol: 7, lab, made: "mk9" })]), ["a"], { stringOf: () => 3 });
    const out = notesOf(r, "t1")!;
    expect(out.every((x) => x.tabString === 3 && x.vol === 7 && x.made === undefined)).toBe(true);
    expect(out.map((x) => x.lab !== undefined)).toEqual([true, false, true, false]);
  });
});

describe("트레몰로", () => {
  it("같은 음 되풀이, 고른 화음 음은 트랙마다 모두", () => {
    const s = songOf([n("a", rat(0), rat(1, 8), 60)], [n("b", rat(0), rat(1, 8), 64)]);
    const r = run(s, ["a", "b"], { kind: "tremolo", length: rat(1, 64), tie: true });
    expect(pitches(notesOf(r, "t1"))).toEqual(Array(8).fill(60));
    expect(pitches(notesOf(r, "t2"))).toEqual(Array(8).fill(64));
    // 트레몰로는 &로 잇지 않는다 (이으면 긴 음 하나가 된다)
    expect(notesOf(r, "t1")!.every((x) => x.tie === "none")).toBe(true);
    expect(r.made).toBe(2);
  });

  it("뒤 음과 떨어진 음 사이 쉼표·다른 음은 그대로", () => {
    const s = songOf([n("x", rat(0), rat(1, 8), 55), n("a", rat(1, 4), rat(1, 8)), n("y", rat(1, 2), rat(1, 8), 67)]);
    const r = run(s, ["a"], { kind: "tremolo" });
    expect(shape(notesOf(r, "t1"))).toEqual(["55@0/1+1/8", "60@1/4+1/32", "60@9/32+1/32", "60@5/16+1/32", "60@11/32+1/32", "67@1/2+1/8"]);
  });
});

describe("창 설정", () => {
  it("저장 값 읽기: 모르는 값은 기본", () => {
    expect(parseTrillChoice({ kind: "tremolo", offset: 0, length: "7", tie: 1 })).toEqual({ kind: "tremolo", offset: 2, length: "32", startOther: false, endOnMain: false, tie: false });
  });

  it("상대 음 입력: 피아노롤은 0 아닌 반음 수, 타브는 본음과 다른 프렛", () => {
    expect(parseTrillInput("+1")).toBe(1);
    expect(parseTrillInput("-2")).toBe(-2);
    expect(parseTrillInput("0")).toBeUndefined();
    expect(parseTrillInput("13")).toBeUndefined();
    expect(parseTrillInput("1 2")).toBeUndefined();
    const tab = { fret: 5, maxFret: 22 };
    expect(parseTrillInput("7", tab)).toBe(2);
    expect(parseTrillInput("5", tab)).toBeUndefined();
    expect(parseTrillInput("23", tab)).toBeUndefined();
    expect(formatTrillInput(2, tab)).toBe("7");
    expect(formatTrillInput(-6, tab)).toBeUndefined();
    expect(formatTrillInput(1)).toBe("+1");
  });
});
