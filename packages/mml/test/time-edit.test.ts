import { describe, expect, it } from "vitest";
import { emptySong, normalizeTempo, positionToSeconds, rat, type Rat, type Song, type TrackText } from "@mmlce/core";
import { barSpans, checkDeleteBars, deleteBars, deleteTime, insertTime, parseTrackText, referenceShiftForDelete, referenceShiftForInsert, tempoMismatch, trackEnd } from "../src/index.js";

function song(text: string): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  const notes = parseTrackText("t1", { text }).notes;
  return {
    ...base,
    tempo: [{ at: rat(0), bpm: 120 }, { at: rat(2), bpm: 90 }],
    players: [{ id: "p1", name: "", instrument: { canonical: "piano" } }],
    tracks: [{ id: "t1", playerId: "p1", name: "", color: "", role: "free", mute: false, solo: false, notes, spelling: {}, mml: { text } }],
  };
}
const starts = (s: Song) => s.tracks[0]!.notes.map((n) => [n.start.n / n.start.d, n.dur.n / n.dur.d, n.pitch]);

describe("마디 넣기·빼기", () => {
  it("넣기: 그 자리부터 음·템포를 한 마디 민다", () => {
    const s = insertTime(rat(1), rat(1)).apply(song("c1 d1 e1"));
    expect(starts(s)).toEqual([[0, 1, 60], [2, 1, 62], [3, 1, 64]]);
    expect(s.tempo.map((t) => t.at.n / t.at.d)).toEqual([0, 3]);
    expect(s.tracks[0]!.mml).toBeUndefined();
  });

  it("넣기: 곡 처음(0)에 넣어도 첫 템포는 0에 남는다", () => {
    // t120이 아닌 곡: 첫 템포를 밀면 넣은 마디가 기본값 t120으로 연주된다
    const base = { ...song("c1 d1"), tempo: [{ at: rat(0), bpm: 90 }, { at: rat(1), bpm: 150 }] };
    const s = insertTime(rat(0), rat(1)).apply(base);
    expect(s.tempo.map((t) => [t.at.n / t.at.d, t.bpm])).toEqual([[0, 90], [2, 150]]);
    expect(starts(s)).toEqual([[1, 1, 60], [2, 1, 62]]);
    // 템포가 0 하나뿐인 곡도 같다
    const one = insertTime(rat(0), rat(2)).apply({ ...base, tempo: [{ at: rat(0), bpm: 90 }] });
    expect(one.tempo).toEqual([{ at: rat(0), bpm: 90 }]);
  });

  it("빼기: 구간 음은 지우고, 걸친 음은 밖 부분만 남기고, 뒤를 당긴다", () => {
    // c2(0~0.5) d1(0.5~1.5) e1(1.5~2.5) f1(2.5~3.5) 에서 [1, 2) 빼기
    const s = deleteTime(rat(1), rat(1)).apply(song("c2 d1 e1 f1"));
    expect(starts(s)).toEqual([[0, 0.5, 60], [0.5, 0.5, 62], [1, 0.5, 64], [1.5, 1, 65]]);
    // 2에 있던 t90은 1로 당겨진다
    expect(s.tempo.map((t) => [t.at.n / t.at.d, t.bpm])).toEqual([[0, 120], [1, 90]]);
  });

  it("빼기: 구간 안 템포는 마지막 값을 구간 시작에 남긴다", () => {
    const s = deleteTime(rat(1), rat(2)).apply(song("c1 d1 e1 f1"));
    expect(s.tempo.map((t) => [t.at.n / t.at.d, t.bpm])).toEqual([[0, 120], [1, 90]]);
    expect(starts(s)).toEqual([[0, 1, 60], [1, 1, 65]]);
  });

  it("빼기: &로 이어 주던 음이 지워지면 &를 푼다", () => {
    // c1&d1 e1 에서 [1, 2) 빼기: d가 지워지므로 c는 e와 이어지지 않는다
    const s = deleteTime(rat(1), rat(1)).apply(song("c1&d1 e1"));
    expect(s.tracks[0]!.notes.map((n) => [n.pitch, n.tie])).toEqual([[60, "none"], [64, "none"]]);
    // 걸친 음은 남은 부분끼리 이어지면 &도 남는다: c1&d1 에서 [1/2, 3/2) 빼기
    const t = deleteTime(rat(1, 2), rat(1)).apply(song("c1&d1"));
    expect(t.tracks[0]!.notes.map((n) => [n.pitch, n.tie])).toEqual([[60, "next"], [62, "none"]]);
  });

  it("넣기: &로 잇던 음 사이에 마디를 넣으면 &를 푼다", () => {
    const s = insertTime(rat(1), rat(1)).apply(song("c1&d1 e1"));
    expect(s.tracks[0]!.notes.map((n) => [n.pitch, n.tie])).toEqual([[60, "none"], [62, "none"], [64, "none"]]);
    // 넣는 자리 뒤끼리 이은 &는 그대로
    const t = insertTime(rat(0), rat(1)).apply(song("c1&d1"));
    expect(t.tracks[0]!.notes.map((n) => [n.pitch, n.tie])).toEqual([[60, "next"], [62, "none"]]);
  });

  it("박자 변화도 함께 밀고 당긴다", () => {
    const base = { ...song("c1 d1 e1"), timeSig: [{ at: rat(0), beats: 4, unit: 4 }, { at: rat(2), beats: 3, unit: 4 }] };
    expect(insertTime(rat(1), rat(1)).apply(base).timeSig.map((x) => x.at)).toEqual([rat(0), rat(3)]);
    expect(deleteTime(rat(1), rat(1)).apply(base).timeSig.map((x) => x.at)).toEqual([rat(0), rat(1)]);
    expect(deleteTime(rat(2), rat(3, 4)).apply(base).timeSig).toEqual([{ at: rat(0), beats: 4, unit: 4 }, { at: rat(2), beats: 3, unit: 4 }]);
  });
});

/** 원문들로 곡을 만든다 (템포 지도는 원문의 t를 모은 것) */
function songOf(...texts: (string | TrackText)[]): Song {
  const tracks = texts.map((src, k) => {
    const mml = typeof src === "string" ? { text: src } : src;
    const parsed = parseTrackText(`t${k + 1}`, mml);
    return { id: `t${k + 1}`, playerId: "p1", name: "", color: "", role: "free" as const, mute: false, solo: false, notes: parsed.notes, spelling: {}, mml, tempo: parsed.tempo };
  });
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: normalizeTempo(tracks.flatMap((t) => t.tempo)),
    players: [{ id: "p1", name: "", instrument: { canonical: "piano" } }],
    tracks: tracks.map(({ tempo: _t, ...t }) => t),
  };
}
const texts = (s: Song) => s.tracks.map((t) => t.mml?.text);
const tempoOf = (s: Song) => s.tempo.map((t) => [t.at.n / t.at.d, t.bpm]);
const endOf = (s: Song, k: number) => {
  const e = trackEnd(s.tracks[k]!);
  return e.n / e.d;
};

describe("마디 넣기·빼기: 음이 안 바뀐 트랙의 원문", () => {
  it("빼기: at 뒤에 쉼표·t만 있는 원문도 구간만큼 당겨 지도와 맞춘다", () => {
    const base = songOf("c4r1r1t60r1");
    const s = deleteTime(rat(2), rat(1, 8)).apply(base);
    expect(tempoOf(s)).toEqual([[17 / 8, 60]]);
    expect(texts(s)).toEqual(["c4r1r2.r8t60r1"]);
    expect(tempoMismatch(s)).toBe(false);
    // 끝 쉼표로 지키던 길이도 함께 준다
    expect(endOf(base, 0)).toBe(9 / 4);
    expect(endOf(s, 0)).toBe(17 / 8);
  });

  it("넣기: 음이 바뀐 트랙과 함께 있어도 원문의 t·끝 쉼표를 민다", () => {
    const s = insertTime(rat(2), rat(1)).apply(songOf("c4r1r1t60r1", "c1c1c1c1"));
    expect(tempoOf(s)).toEqual([[13 / 4, 60]]);
    expect(texts(s)).toEqual(["c4r1r1r1t60r1", undefined]);
    expect(tempoMismatch(s)).toBe(false);
  });

  it("넣기: 템포 트랙만 있는 곡도 맞고, 곡 처음의 t는 제자리에 둔다", () => {
    const s = insertTime(rat(0), rat(1)).apply(songOf("t90r1t60r1v8"));
    expect(texts(s)).toEqual(["t90r1r1t60r1v8"]);
    expect(tempoOf(s)).toEqual([[0, 90], [2, 60]]);
    expect(tempoMismatch(s)).toBe(false);
  });

  it("넣기: at에 걸친 음·쉼표 뒤를 민다. 게임이 빼는 맨 끝 쉼표만 남으면 그대로 둔다", () => {
    // c1이 1/2에 걸쳐 있다: 음은 그대로, 뒤 쉼표와 t를 민다
    const a = insertTime(rat(1, 2), rat(1)).apply(songOf("c1r1t60"));
    expect(texts(a)).toEqual(["c1r1r1t60"]);
    expect(a.tracks[0]!.notes.map((n) => [n.start.n / n.start.d, n.dur.n / n.dur.d])).toEqual([[0, 1]]);
    expect(tempoMismatch(a)).toBe(false);
    // 길이를 지키는 쉼표가 at에 걸쳐 있으면 그 쉼표를 늘린다
    const b = insertTime(rat(3, 2), rat(1)).apply(songOf("r1r1v8"));
    expect(texts(b)).toEqual(["r1r1r1v8"]);
    expect(endOf(b, 0)).toBe(3);
    // c1 뒤 r4는 게임이 길이에서 뺀다 (길이 1): 늘릴 것이 없다
    const c = songOf("c1r4");
    expect(insertTime(rat(1, 2), rat(1)).apply(c).tracks[0]).toBe(c.tracks[0]);
  });

  it("빼기: 구간 안 t는 지도처럼 마지막 하나만 at에 남긴다", () => {
    const s = deleteTime(rat(1, 2), rat(1)).apply(songOf("r1t90r1t60r1", "c4"));
    expect(texts(s)).toEqual(["r2t90r2t60r1", "c4"]);
    expect(tempoOf(s)).toEqual([[1 / 2, 90], [1, 60]]);
    expect(tempoMismatch(s)).toBe(false);
    // 구간 끝(2)의 t60이 at(1)으로 당겨지면 구간 안 t90은 지운다
    const t = deleteTime(rat(1), rat(1)).apply(songOf("r1t90r1t60r1", "c4"));
    expect(texts(t)).toEqual(["r1t60r1", "c4"]);
    expect(tempoOf(t)).toEqual([[1, 60]]);
    expect(tempoMismatch(t)).toBe(false);
  });

  it("빼기: 게임이 빼는 맨 끝 쉼표는 줄이지 않는다 (앞 쉼표가 맨 끝이 돼 길이가 줄지 않게)", () => {
    // 'c4r1r1'의 맨 끝 r1은 길이에 들지 않는다 (길이 5/4). 그 뒤 구간을 빼도 길이는 그대로
    const base = songOf("c4r1r1");
    expect(endOf(base, 0)).toBe(5 / 4);
    const a = deleteTime(rat(5, 4), rat(1)).apply(base);
    expect(a.tracks[0]).toBe(base.tracks[0]);
    // 길이 안 쉼표와 맨 끝 쉼표에 걸쳐 빼면 길이 안 쉼표만 줄어 길이는 구간 시작(1)
    const b = deleteTime(rat(1), rat(5, 4)).apply(base);
    expect(texts(b)).toEqual(["c4r2.r1"]);
    expect(endOf(b, 0)).toBe(1);
  });

  it("빼기: 구간 끝 템포가 당겨져도 맨 끝 쉼표 뒤의 t는 그 자리 빠르기로 남겨 길이를 지킨다", () => {
    // 'c4r1t60'은 t60 덕에 r1이 길이에 든다 (길이 5/4). t60을 지우면 r1이 맨 끝이 돼 길이가 1/4로 준다
    const s = deleteTime(rat(1), rat(1, 2)).apply(songOf("c4r1t60", "r1r2t90r1"));
    expect(tempoOf(s)).toEqual([[1, 90]]);
    expect(texts(s)).toEqual(["c4r2.t90", "r1t90r1"]);
    expect(endOf(s, 0)).toBe(1);
    expect(tempoMismatch(s)).toBe(false);
  });

  it("음을 옮겨 다시 쓴 트랙도 끝 쉼표로 지키던 길이를 밀고 당긴다", () => {
    // 't90c4r1t90'은 끝 t90 덕에 r1이 길이에 든다 (길이 5/4). 처음에 한 마디 넣으면 길이는 9/4
    const ins = insertTime(rat(0), rat(1)).apply(songOf("t90c4r1t90"));
    expect(ins.tracks[0]!.notes.map((n) => n.start.n / n.start.d)).toEqual([1]);
    expect(endOf(ins, 0)).toBe(9 / 4);
    expect(tempoMismatch(ins)).toBe(false);
    // 빼기: c1을 반으로 줄이면 길이도 반 마디 준다 (2 → 3/2)
    const del = deleteTime(rat(1, 2), rat(1, 2)).apply(songOf("c1r1v8"));
    expect(del.tracks[0]!.notes.map((n) => n.dur.n / n.dur.d)).toEqual([1 / 2]);
    expect(endOf(del, 0)).toBe(3 / 2);
    // 끝 쉼표가 없던 원문(음이 끝까지 찬 원문)은 전처럼 음 끝이 길이다
    const full = insertTime(rat(0), rat(1)).apply(songOf("c1"));
    expect(full.tracks[0]!.mml).toBeUndefined();
    expect(endOf(full, 0)).toBe(2);
  });

  it("시작 위치(offset)가 있는 원문은 offset을 민다·당긴다", () => {
    const base = songOf({ text: "r1t60r1", offset: rat(2) }, "c4");
    const ins = insertTime(rat(1), rat(1)).apply(base);
    expect(ins.tracks[0]!.mml).toEqual({ text: "r1t60r1", offset: rat(3) });
    expect(tempoMismatch(ins)).toBe(false);
    const del = deleteTime(rat(1), rat(1, 2)).apply(base);
    expect(del.tracks[0]!.mml).toEqual({ text: "r1t60r1", offset: rat(3, 2) });
    expect(tempoMismatch(del)).toBe(false);
    // 구간이 시작 위치에 걸치면 시작 위치를 at으로 하고 걸친 만큼 쉼표를 줄인다
    const cut = deleteTime(rat(1), rat(3, 2)).apply(base);
    expect(cut.tracks[0]!.mml).toEqual({ text: "r2t60r1", offset: rat(1) });
    expect(tempoMismatch(cut)).toBe(false);
  });
});

describe("고른 마디 지우기 (deleteBars)", () => {
  // 4/4, 한 마디 = 1. c1 d1 e1 f1 g1 = 1~5마디
  it("여러 범위를 실행 한 번에 지우고 뒤를 당긴다 (뒤 범위부터)", () => {
    const s = deleteBars([[2, 2], [4, 4]]).apply(song("c1 d1 e1 f1 g1"));
    expect(starts(s)).toEqual([[0, 1, 60], [1, 1, 64], [2, 1, 67]]);
    // 2에 있던 t90은 2마디가 지워지며 구간 끝(=2, 3마디 처음)이 1로 당겨진다
    expect(s.tempo.map((t) => [t.at.n / t.at.d, t.bpm])).toEqual([[0, 120], [1, 90]]);
  });

  it("붙은 범위는 한 구간으로, \"3-\"는 곡 끝 마디까지, 곡 끝 뒤 마디는 무시", () => {
    expect(starts(deleteBars([[2, 2], [3, 3]]).apply(song("c1 d1 e1 f1")))).toEqual([[0, 1, 60], [1, 1, 65]]);
    expect(starts(deleteBars([[3, Infinity]]).apply(song("c1 d1 e1 f1")))).toEqual([[0, 1, 60], [1, 1, 62]]);
    const base = song("c1 d1");
    expect(deleteBars([[5, 9]]).apply(base)).toBe(base);
  });

  it("마디에 걸친 음은 밖 부분만 남고, 미리 보기가 지울 음·잘릴 음을 센다", () => {
    // c2. (0~3/4) d4 (3/4~1) e1 (1~2) f2 (2~5/2): 2마디(e1)를 지우면 c·d는 그대로
    const base = song("c2.d4e1f2");
    expect(checkDeleteBars(base, [[2, 2]])).toEqual({ bars: 1, removed: 1, cut: 0, made: 0 });
    // c1. (0~3/2)은 2마디에 걸쳐 잘린다
    const cross = song("c1.d2e1");
    expect(checkDeleteBars(cross, [[2, 2]])).toEqual({ bars: 1, removed: 1, cut: 1, made: 0 });
    expect(starts(deleteBars([[2, 2]]).apply(cross))).toEqual([[0, 1, 60], [1, 1, 64]]);
  });

  it("지운 마디에 걸친 만든 기록은 끊고(표시·기록 버림), 통째로 뒤에 있던 기록은 함께 당겨 되돌릴 수 있게 둔다", () => {
    const base = song("c1 d2e2 f1 g2a2");
    const tr = base.tracks[0]!;
    // mk1: 2마디의 d·e (지워짐), mk2: 4마디의 g·a (당겨짐)
    const marked = tr.notes.map((n) => (n.pitch === 62 || n.pitch === 64 ? { ...n, made: "mk1" } : n.pitch === 67 || n.pitch === 69 ? { ...n, made: "mk2" } : n));
    const rec = (id: string) => ({ id, tool: "arpeggio" as const, options: {}, picked: [], before: [], after: [] });
    const s0: Song = { ...base, made: [rec("mk1"), rec("mk2")], tracks: [{ ...tr, notes: marked }] };
    expect(checkDeleteBars(s0, [[2, 2]]).made).toBe(1);
    const s = deleteBars([[2, 2]]).apply(s0);
    expect(s.made?.map((r) => r.id)).toEqual(["mk2"]);
    expect(s.tracks[0]!.notes.filter((n) => n.made === "mk2").map((n) => n.start)).toEqual([rat(2), rat(5, 2)]);
    // 걸쳐 잘린 기록 음도 끊는다: mk3이 1~2마디에 걸친 c1. 에서 2마디 지우기
    const c = song("c1.d2");
    const s1: Song = { ...c, made: [rec("mk3")], tracks: [{ ...c.tracks[0]!, notes: c.tracks[0]!.notes.map((n) => ({ ...n, made: "mk3" })) }] };
    const out = deleteBars([[2, 2]]).apply(s1);
    expect(out.made).toBeUndefined();
    expect(out.tracks[0]!.notes.every((n) => n.made === undefined)).toBe(true);
  });
});

describe("마디 지우기와 원곡 대조 위치 (referenceShiftForDelete)", () => {
  // song(): t120(한 마디 2초) 뒤 2(3마디 처음)부터 t90(한 마디 8/3초)
  const sec = (s: Song, pos: Rat) => positionToSeconds(s.tempo, pos);
  /** 지운 뒤 newPos 자리의 음이, 지우기 전 oldPos 자리에서 울리던 원곡 시각에 그대로 울리는지 (원곡 시각 = 곡 시각 + 어긋남) */
  function expectAligned(before: Song, after: Song, offset: number, shift: number, oldPos: Rat, newPos: Rat) {
    expect(sec(after, newPos) + offset + shift).toBeCloseTo(sec(before, oldPos) + offset, 9);
  }

  it("원곡이 울리기 전 구간을 지우면 그 실제 길이(지우기 전 템포)만큼 어긋남을 옮기고, 남은 곡이 원곡과 맞는다", () => {
    const base = song("c1 d1 e1 f1 g1 a1");
    // 원곡은 5마디 처음(4)부터 울린다: 4초 + 2마디 × 8/3초
    const offset = -(4 + 16 / 3);
    const plan = referenceShiftForDelete(base, barSpans(base, [[2, 2]]), offset);
    expect(plan).toEqual({ shiftSec: 2 });
    expectAligned(base, deleteBars([[2, 2]]).apply(base), offset, plan.shiftSec, rat(4), rat(3));
    // 처음에 템포가 바뀌는 마디(3마디 t90)를 지우면 t90 길이(8/3초)만큼
    const t90 = referenceShiftForDelete(base, barSpans(base, [[3, 3]]), offset);
    expect(t90.shiftSec).toBeCloseTo(8 / 3, 12);
    expect(t90.brokenBar).toBeUndefined();
    expectAligned(base, deleteBars([[3, 3]]).apply(base), offset, t90.shiftSec, rat(5), rat(4));
  });

  it("지운 구간 안에서 템포가 바뀌어도 그 구간의 실제 초를 옮긴다 (구간 앞 템포 변화도 반영)", () => {
    // 2마디 가운데(3/2)에서 t60: 1~3/2는 1초, 3/2~2는 2초 → 3초
    const inside = { ...song("c1 d1 e1 f1 g1 a1"), tempo: [{ at: rat(0), bpm: 120 }, { at: rat(3, 2), bpm: 60 }] };
    const plan = referenceShiftForDelete(inside, barSpans(inside, [[2, 2]]), -20);
    expect(plan.shiftSec).toBeCloseTo(3, 12);
    expectAligned(inside, deleteBars([[2, 2]]).apply(inside), -20, plan.shiftSec, rat(5), rat(4));
    // 지우는 구간 앞에서 템포가 바뀌면 그 템포로 잰다: t60(4초) 뒤 2마디부터 t120 → 3마디는 2초
    const before = { ...inside, tempo: [{ at: rat(0), bpm: 60 }, { at: rat(1), bpm: 120 }] };
    const b = referenceShiftForDelete(before, barSpans(before, [[3, 3]]), -20);
    expect(b.shiftSec).toBeCloseTo(2, 12);
    expectAligned(before, deleteBars([[3, 3]]).apply(before), -20, b.shiftSec, rat(5), rat(4));
  });

  it("곡 처음부터 지우면 원곡이 울리던 부분이어도 어긋남 하나로 맞는다", () => {
    const base = song("c1 d1 e1 f1 g1 a1");
    const plan = referenceShiftForDelete(base, barSpans(base, [[1, 1]]), 1.5);
    expect(plan).toEqual({ shiftSec: 2 });
    expectAligned(base, deleteBars([[1, 1]]).apply(base), 1.5, plan.shiftSec, rat(3), rat(2));
    // 붙은 1~2마디는 한 구간 (t120 두 마디 = 4초)
    expect(referenceShiftForDelete(base, barSpans(base, [[1, 2]]), 0)).toEqual({ shiftSec: 4 });
  });

  it("원곡이 울리는 가운데를 지우면 옮기지 않고 그 마디부터 어긋난다고 알린다", () => {
    const base = song("c1 d1 e1 f1 g1 a1");
    expect(referenceShiftForDelete(base, barSpans(base, [[3, 3]]), 0)).toEqual({ shiftSec: 0, brokenBar: 3 });
    // 원곡 시작(3초 = 2마디 가운데)에 걸친 구간도 맞출 수 없다
    expect(referenceShiftForDelete(base, barSpans(base, [[2, 2]]), -3)).toEqual({ shiftSec: 0, brokenBar: 2 });
    // 앞 구간(원곡 전)은 당겨 맞추고, 원곡 가운데의 구간부터 어긋난다
    expect(referenceShiftForDelete(base, barSpans(base, [[2, 2], [4, 4]]), -4)).toEqual({ shiftSec: 2, brokenBar: 4 });
  });

  it("원곡이 끝난 뒤를 지우면 원곡과 상관없다", () => {
    const base = song("c1 d1 e1 f1 g1 a1");
    expect(referenceShiftForDelete(base, barSpans(base, [[4, 4]]), 0, 3)).toEqual({ shiftSec: 0 });
    expect(referenceShiftForDelete(base, barSpans(base, [[4, 4]]), 0)).toEqual({ shiftSec: 0, brokenBar: 4 });
  });
});

describe("마디 넣기와 원곡·배경 영상 위치 (referenceShiftForInsert)", () => {
  // song(): t120(한 마디 2초) 뒤 2(3마디 처음)부터 t90(한 마디 8/3초)
  const sec = (s: Song, pos: Rat) => positionToSeconds(s.tempo, pos);
  /** 넣은 뒤 newPos 자리의 음이, 넣기 전 oldPos 자리에서 울리던 원곡 시각에 그대로 울리는지 */
  function expectAligned(before: Song, after: Song, offset: number, shift: number, oldPos: Rat, newPos: Rat) {
    expect(sec(after, newPos) + offset + shift).toBeCloseTo(sec(before, oldPos) + offset, 9);
  }

  it("원곡이 울리기 전에 넣으면 넣은 마디의 실제 길이만큼 어긋남을 빼고, 넣은 뒤 곡이 원곡과 맞는다", () => {
    const base = song("c1 d1 e1 f1 g1 a1");
    // 원곡은 5마디 처음(4)부터 울린다
    const offset = -(4 + 16 / 3);
    const plan = referenceShiftForInsert(base, rat(1), rat(1), offset);
    expect(plan).toEqual({ shiftSec: -2 });
    expectAligned(base, insertTime(rat(1), rat(1)).apply(base), offset, plan.shiftSec, rat(4), rat(5));
  });

  it("템포가 바뀌는 자리에 넣으면 넣은 마디는 그 앞 템포로 울린다 (마디 넣기가 템포를 뒤로 미는 것과 같게)", () => {
    const base = song("c1 d1 e1 f1 g1 a1");
    const offset = -(4 + 16 / 3);
    // 3마디 처음(2)의 t90은 넣은 마디 뒤로 밀리므로 넣은 마디는 t120 = 2초
    const plan = referenceShiftForInsert(base, rat(2), rat(1), offset);
    expect(plan.shiftSec).toBeCloseTo(-2, 12);
    expectAligned(base, insertTime(rat(2), rat(1)).apply(base), offset, plan.shiftSec, rat(4), rat(5));
    // 원곡이 시작하는 바로 그 자리(4초 = 3마디 처음)에 넣어도 맞출 수 있다
    expect(referenceShiftForInsert(base, rat(2), rat(1), -4).shiftSec).toBeCloseTo(-2, 12);
  });

  it("곡 처음에 넣으면 원곡이 이미 울리고 있어도 어긋남 하나로 맞는다 (처음 템포로 잰 길이)", () => {
    const base = song("c1 d1 e1 f1 g1 a1");
    const plan = referenceShiftForInsert(base, rat(0), rat(1), 1.5);
    expect(plan).toEqual({ shiftSec: -2 });
    expectAligned(base, insertTime(rat(0), rat(1)).apply(base), 1.5, plan.shiftSec, rat(3), rat(4));
  });

  it("원곡이 울리는 가운데에 넣으면 옮기지 않고 넣은 마디부터 어긋난다고 알린다. 원곡이 끝난 뒤면 상관없다", () => {
    const base = song("c1 d1 e1 f1 g1 a1");
    expect(referenceShiftForInsert(base, rat(2), rat(1), 0)).toEqual({ shiftSec: 0, brokenBar: 3 });
    expect(referenceShiftForInsert(base, rat(3), rat(1), 0, 3)).toEqual({ shiftSec: 0 });
    expect(referenceShiftForInsert(base, rat(3), rat(1), 0)).toEqual({ shiftSec: 0, brokenBar: 4 });
  });
});

describe("마디 넣기·빼기와 조표", () => {
  it("곡 처음 조표는 두고 뒤 조표를 밀고 당긴다", async () => {
    const { newSong, insertTime, deleteTime } = await import("../src/index.js");
    const { rat } = await import("@mmlce/core");
    const song = { ...newSong({ playerName: "p", trackName: "t" }), keys: [{ at: rat(0), fifths: 1 }, { at: rat(2), fifths: -2 }] };
    const ins = insertTime(rat(1), rat(1)).apply(song);
    expect(ins.keys?.map((k) => k.at.n)).toEqual([0, 3]);
    const del = deleteTime(rat(1), rat(2)).apply(song);
    // 지운 구간 안의 조표는 구간 처음에 남는다 (템포·박자와 같다)
    expect(del.keys?.map((k) => [k.at.n, k.fifths])).toEqual([[0, 1], [1, -2]]);
  });
});
