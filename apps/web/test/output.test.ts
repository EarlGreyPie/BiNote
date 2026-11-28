import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, rat, type Song, type Track } from "@mmlce/core";
import { parseTrackText } from "@mmlce/mml";
import { analyzeSong } from "../src/lib/analysis";
import { isCopied, nextExportPick, outputRows, pasteOrderAdd, pasteOrderOf, pasteOrderRemove, pasteOrderMove, pasteOrderShift, previewRows, songOrdered, tempoAdvice, trackStamp, type PasteOrder } from "../src/lib/output";

function track(id: string, playerId: string, text: string): Track {
  return { id, playerId, name: id, color: "", role: "free", mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {} };
}

function song(tracks: Track[], tempo = [{ at: rat(0), bpm: 120 }]): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  return {
    ...base,
    tempo,
    players: [
      { id: "p1", name: "피아노", instrument: { canonical: "piano" } },
      { id: "p2", name: "오르골", instrument: { canonical: "music-box" } },
    ],
    tracks,
  };
}

describe("outputRows", () => {
  it("악보마다 한 줄: 악기 화음 수로 나누고, 트랙 글자 수와 넘침을 센다", () => {
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 20 };
    const s = song([track("a", "p1", "cdefgab>cdefgab>cdefgab"), track("b", "p1", "c1"), ...["x", "y", "z", "w"].map((id) => track(id, "p2", "c4"))]);
    const rows = outputRows(s, profile, analyzeSong(s, profile));
    const box = profile.instrumentMaxChords["music-box"]!;
    expect(rows[0]).toMatchObject({ number: 1, playerId: "p1", instrument: "piano", over: true });
    expect(rows[0]!.tracks.map((t) => t.over)).toEqual([true, false]);
    expect(rows[0]!.text.startsWith("MML@")).toBe(true);
    // 오르골 4트랙은 화음 수만큼 끊어 악보가 더 생긴다
    expect(box).toBeLessThan(4);
    expect(rows.slice(1).map((r) => r.tracks.length)).toEqual([box, 4 - box]);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(rows.slice(1).every((r) => r.instrument === "music-box" && !r.over)).toBe(true);
  });

  it("소리 없는 자리에 붙인 트랙이 글자 수를 넘으면 그 악보도 넘침으로 알린다 (beta.8 점검)", () => {
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 20 };
    const long = "cdefgab>cdefgab>cdefgab";
    const s = song(["x", "y", "z", "w"].map((id, k) => track(id, "p2", k === 0 ? long : "c4")));
    const rows = outputRows(s, profile, analyzeSong(s, profile));
    expect(rows.map((r) => [r.over, r.silentOver])).toEqual([
      [true, []],
      [true, ["x"]],
    ]);
  });
});

describe("tempoAdvice", () => {
  it("범위 밖 템포만: 빠르면 템포 반에 길이도 반(1/2, 1/4…), 느리면 그 반대", () => {
    const s = song([], [
      { at: rat(0), bpm: 300 },
      { at: rat(1), bpm: 120 },
      { at: rat(2), bpm: 601 },
      { at: rat(3), bpm: 20 },
    ]);
    const out = tempoAdvice(s, { min: 32, max: 255 });
    expect(out.map((a) => [a.bpm, a.high, a.factor, a.to, a.bar])).toEqual([
      [300, true, 2, 150, 1],
      [601, true, 4, 150, 3],
      [20, false, 2, 40, 4],
    ]);
    // 안내대로 바꾼 4분음표가 원래와 같은 초여야 한다 (초 = 길이 × 240 / 템포). 601→150은 반올림만큼만 다르다
    const seconds = (length: number, bpm: number) => (length * 240) / bpm;
    for (const a of out) {
      expect(seconds(0.25 * a.lengthScale, a.to)).toBeCloseTo(seconds(0.25, a.bpm), 2);
    }
    expect(out[0]!.lengthScale).toBe(0.5);
    expect(out[2]!.lengthScale).toBe(2);
  });
});

describe("previewRows", () => {
  it("바뀐 트랙과 한도를 넘는 트랙만 전후 글자 수로", () => {
    const before = song([track("a", "p1", "c4 c4 c4"), track("b", "p1", "d1"), track("c", "p1", "e1e1e1e1e1")]);
    // 첫 트랙 원문에도 템포를 적어 다른 트랙 글은 그대로 (원문에 템포가 없으면 원문 없는 다음 트랙이 템포를 받는다)
    const after: Song = { ...before, tracks: before.tracks.map((t) => (t.id === "a" ? { ...t, mml: { text: "t120ccc" } } : t)) };
    const rows = previewRows(before, after, 3);
    expect(rows.map((r) => [r.trackId, r.after])).toEqual([
      ["a", 7],
      ["c", rows.find((r) => r.trackId === "c")!.before],
    ]);
    expect(rows[0]!.before).toBeGreaterThan(3);
  });

  it("세는 함수를 주면 그 수로 (화음 분산·병합 칸은 게임 글자 수)", () => {
    const before = song([track("a", "p1", "c4 c4 c4"), track("b", "p1", "d1")]);
    const after: Song = { ...before, tracks: before.tracks.map((t) => (t.id === "a" ? { ...t, notes: t.notes.slice(1) } : t)) };
    const count = (s: Song) => (id: string) => (s === before ? 10 : id === "a" ? 6 : 10);
    expect(previewRows(before, after, 100, count).map((r) => [r.trackId, r.before, r.after])).toEqual([["a", 10, 6]]);
  });
});

describe("MML로 내보내기: 다음에 복사할 트랙", () => {
  const scores = [{ trackIds: ["a1", "a2", "a3", "a4", "a5", "a6"] }, { trackIds: ["b1", "b2", "b3", "b4", "b5", "b6"] }];

  it("처음엔 첫 악보만 (손대지 않은 악보는 섞지 않는다)", () => {
    expect(nextExportPick(scores, () => false, 6)).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
    const small = [{ trackIds: ["a1", "a2"] }, { trackIds: ["b1"] }];
    expect(nextExportPick(small, () => false, 6)).toEqual(["a1", "a2"]);
  });

  it("두 악보에서 일부씩 복사했으면 남은 트랙을 함께 고른다", () => {
    const done = new Set(["a1", "a2", "a3", "b1", "b3", "b6"]);
    expect(nextExportPick(scores, (id) => done.has(id), 6)).toEqual(["a4", "a5", "a6", "b2", "b4", "b5"]);
  });

  it("한도를 넘는 악보 나머지는 더하지 않고, 다 복사했으면 빈 목록", () => {
    const done = new Set(["a1", "b1"]);
    expect(nextExportPick(scores, (id) => done.has(id), 6)).toEqual(["a2", "a3", "a4", "a5", "a6"]);
    expect(nextExportPick(scores, () => true, 6)).toEqual([]);
  });

  it("복사 뒤 트랙을 고치면 복사됨이 풀린다", () => {
    const s = song([track("a", "p1", "c4"), track("b", "p1", "d4")]);
    const copied = new Map([["a", trackStamp(s, s.tracks[0]!)]]);
    expect(isCopied(s, copied, "a")).toBe(true);
    expect(isCopied(s, copied, "b")).toBe(false);
    const edited = { ...s, tracks: [track("a", "p1", "c8"), s.tracks[1]!] };
    expect(isCopied(edited, copied, "a")).toBe(false);
    // 같은 음으로 다시 만든 트랙(실행 취소 등)은 복사됨 그대로
    expect(isCopied({ ...s, tracks: [track("a", "p1", "c4"), s.tracks[1]!] }, copied, "a")).toBe(true);
  });

  it("복사 뒤 곡 템포를 바꾸면 복사됨이 풀린다 (템포를 넣어 복사한 글이 달라진다)", () => {
    const s = song([track("a", "p1", "c4")]);
    const copied = new Map([["a", trackStamp(s, s.tracks[0]!)]]);
    expect(isCopied(s, copied, "a")).toBe(true);
    expect(isCopied({ ...s, tempo: [{ at: rat(0), bpm: 90 }] }, copied, "a")).toBe(false);
  });
});

describe("analyzeSong 글자 수 검사", () => {
  it("원문이 있는 트랙은 원문 글자 수로 char-limit을 내지 않는다 (내보낼 때 글자 수로 본다)", () => {
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 20 };
    const text = "/* 주석이 길어서 원문만 한도를 넘는다 */\nc4";
    const a: Track = { ...track("a", "p1", text), mml: { text } };
    const b = track("b", "p1", "cdefgab>cdefgab>cdefgab");
    const result = analyzeSong(song([a, b]), profile);
    expect(result.tracks[0]!.diagnostics.map((d) => d.code)).not.toContain("char-limit");
    // 원문이 없는 트랙(출력기 글)은 그대로 알린다
    expect(result.tracks[1]!.diagnostics.map((d) => d.code)).toContain("char-limit");
  });
});

describe("붙여넣는 순서", () => {
  // 악보1 피아노 1-4, 악보2 류트 1-3
  const songIds = ["p1", "p2", "p3", "p4", "l1", "l2", "l3"];
  const plain = (ids: string[]): PasteOrder => ({ ids, custom: false });

  it("뒤 트랙을 먼저, 앞 트랙을 나중에 체크해도 곡 순서다", () => {
    let o = plain(["p1", "p2", "p3", "p4"]);
    o = pasteOrderAdd(o, ["l3"], songIds);
    o = pasteOrderAdd(o, ["l1"], songIds);
    expect(o).toEqual({ ids: ["p1", "p2", "p3", "p4", "l1", "l3"], custom: false });
  });

  it("껐다가 다시 켜도 같은 칸이다", () => {
    const o = plain(["p1", "p2", "p3", "p4"]);
    const off = pasteOrderRemove(o, ["p2"], songIds);
    expect(off.ids).toEqual(["p1", "p3", "p4"]);
    expect(pasteOrderAdd(off, ["p2"], songIds)).toEqual(o);
  });

  it("옮기면 직접 정한 순서가 되고, 그 뒤 체크한 트랙은 맨 뒤 칸이다", () => {
    let o = pasteOrderShift(plain(["p1", "p2", "l1"]), "p1", 1, songIds);
    expect(o).toEqual({ ids: ["p2", "p1", "l1"], custom: true });
    o = pasteOrderAdd(o, ["p3"], songIds);
    expect(o).toEqual({ ids: ["p2", "p1", "l1", "p3"], custom: true });
    // 악보 체크는 그 악보 트랙 차례대로 맨 뒤에
    o = pasteOrderAdd(o, ["l3", "l2", "l1"], songIds);
    expect(o.ids).toEqual(["p2", "p1", "l1", "p3", "l2", "l3"]);
    // 빼면 뒤 칸이 당겨지고 직접 정한 순서는 그대로
    expect(pasteOrderRemove(o, ["l1"], songIds)).toEqual({ ids: ["p2", "p1", "p3", "l2", "l3"], custom: true });
  });

  it("옮기다가 곡 순서와 같아지면 곡 순서로 돌아간다", () => {
    const moved = pasteOrderShift(plain(["p1", "p2"]), "p2", -1, songIds);
    expect(moved.custom).toBe(true);
    expect(pasteOrderShift(moved, "p2", 1, songIds)).toEqual(plain(["p1", "p2"]));
    // 빼서 곡 순서와 같아져도
    expect(pasteOrderRemove({ ids: ["p1", "p3", "p2"], custom: true }, ["p3"], songIds)).toEqual(plain(["p1", "p2"]));
  });

  it("맨 앞을 앞으로, 맨 뒤를 뒤로, 없는 트랙은 그대로", () => {
    const o = plain(["p1", "p2"]);
    expect(pasteOrderShift(o, "p1", -1, songIds)).toBe(o);
    expect(pasteOrderShift(o, "p2", 1, songIds)).toBe(o);
    expect(pasteOrderShift(o, "l1", 1, songIds)).toBe(o);
  });

  it("곡 순서일 때 곡에서 트랙 차례가 바뀌면 새 곡 순서를 따른다", () => {
    expect(pasteOrderOf(plain(["p1", "p2"]), ["p2", "p1"])).toEqual(plain(["p2", "p1"]));
    expect(pasteOrderOf({ ids: ["p2", "p1"], custom: true }, songIds)).toEqual({ ids: ["p2", "p1"], custom: true });
    expect(songOrdered(["a", "b"], ["x", "b", "a"])).toEqual(["a", "b", "x"]);
  });
});

describe("붙여넣는 순서 끌어 옮기기", () => {
  const songIds = ["a", "b", "c", "d"];
  it("끌어 놓은 칸으로 한 번에 옮기고, 곡 순서가 되면 직접 정한 순서를 푼다", () => {
    const o: PasteOrder = { ids: ["a", "b", "c"], custom: false };
    expect(pasteOrderMove(o, "c", 0, songIds)).toEqual({ ids: ["c", "a", "b"], custom: true });
    expect(pasteOrderMove(o, "a", 9, songIds)).toEqual({ ids: ["b", "c", "a"], custom: true });
    expect(pasteOrderMove(o, "b", 1, songIds)).toBe(o);
    expect(pasteOrderMove({ ids: ["c", "a", "b"], custom: true }, "c", 2, songIds)).toEqual({ ids: ["a", "b", "c"], custom: false });
    expect(pasteOrderMove(o, "x", 0, songIds)).toBe(o);
  });
});
