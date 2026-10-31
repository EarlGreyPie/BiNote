import { describe, expect, it } from "vitest";
import { applyVolumes, isCleanTrack, trackIndex, voiceRanks, clipLayers, clipNotes, clipOverlaps, rampVolumes, volumeBars, glueNotes, noteAt, noteBefore, pasteClip, placeNote, rat, scaleNotes, scaleNotesIn, removeNotes, splitNote, replaceNotes, toggleTie, transposeNotes, updateNote, type Note, placeLoss } from "../src/index.js";

const note = (id: string, start: number, dur: number, pitch = 60, tie: Note["tie"] = "none"): Note => ({
  id,
  start: rat(start, 8),
  dur: rat(dur, 8),
  pitch,
  vol: 8,
  tie,
});
const shape = (notes: Note[]) => notes.map((n) => `${n.id}:${n.start.n}/${n.start.d}+${n.dur.n}/${n.dur.d}${n.tie === "next" ? "&" : ""}`);

describe("트랙 음 편집", () => {
  const base = [note("a", 0, 2), note("b", 2, 2), note("c", 4, 2)];

  it("빈 자리에 넣으면 시작 순으로 끼운다", () => {
    expect(shape(placeNote([note("a", 0, 1), note("c", 4, 2)], note("x", 2, 1)))).toEqual([
      "a:0/1+1/8",
      "x:1/4+1/8",
      "c:1/2+1/4",
    ]);
  });

  it("겹치면 앞 음은 자르고 안에 든 음은 지운다", () => {
    expect(shape(placeNote(base, note("x", 1, 4)))).toEqual(["a:0/1+1/8", "x:1/8+1/2"]);
    expect(shape(placeNote(base, note("x", 1, 2)))).toEqual(["a:0/1+1/8", "x:1/8+1/4", "c:1/2+1/4"]);
  });

  it("짝을 잃은 &는 푼다", () => {
    const tied = [note("a", 0, 2, 60, "next"), note("b", 2, 2)];
    expect(shape(removeNotes(tied, new Set(["b"])))).toEqual(["a:0/1+1/4"]);
    expect(shape(placeNote(tied, note("x", 1, 1, 62)))).toEqual(["a:0/1+1/8", "x:1/8+1/8", "b:1/4+1/4"]);
  });

  it("옮기기와 길이 바꾸기", () => {
    expect(shape(updateNote(base, "a", { start: rat(6, 8) }))).toEqual(["b:1/4+1/4", "c:1/2+1/4", "a:3/4+1/4"]);
    expect(shape(updateNote(base, "a", { dur: rat(3, 8) }))).toEqual(["a:0/1+3/8", "c:1/2+1/4"]);
  });

  it("위치로 음 찾기", () => {
    expect(noteAt(base, rat(3, 8), 60)?.id).toBe("b");
    expect(noteAt(base, rat(3, 8), 61)).toBeUndefined();
    expect(noteBefore(base, rat(5, 8))?.id).toBe("c");
  });
});

describe("toggleTie", () => {
  it("바로 붙은 다음 음과 잇고, 다시 하면 푼다", () => {
    const notes = [note("a", 0, 2), note("b", 2, 2, 62)];
    const tied = toggleTie(notes, "a")!;
    expect(shape(tied)).toEqual(["a:0/1+1/4&", "b:1/4+1/4"]);
    expect(shape(toggleTie(tied, "a")!)).toEqual(["a:0/1+1/4", "b:1/4+1/4"]);
  });

  it("사이가 떠 있으면 다음 음 시작까지 늘려 잇는다, 다음 음이 없으면 그대로", () => {
    const notes = [note("a", 0, 1), note("b", 4, 2, 64)];
    expect(shape(toggleTie(notes, "a")!)).toEqual(["a:0/1+1/2&", "b:1/2+1/4"]);
    expect(toggleTie(notes, "b")).toBeUndefined();
  });

});

describe("여러 음 한꺼번에 바꾸기", () => {
  const base = [note("a", 0, 2), note("b", 2, 2), note("c", 4, 2)];

  it("여러 음을 함께 옮겨도 서로 잘라 먹지 않는다", () => {
    // a·b·c를 한 칸(2/8)씩 뒤로: 앞 음이 뒤 음 자리로 가도 그대로 남는다
    const moved = new Map(base.map((n) => [n.id, { ...n, start: rat(n.start.n * 8 / n.start.d + 2, 8) }] as const));
    expect(shape(replaceNotes(base, moved))).toEqual(["a:1/4+1/4", "b:1/2+1/4", "c:3/4+1/4"]);
  });

  it("여러 음을 한꺼번에 지우고 바꾼다", () => {
    const changes = new Map<string, Note | null>([["a", null], ["c", { ...base[2]!, pitch: 72 }]]);
    const out = replaceNotes(base, changes);
    expect(shape(out)).toEqual(["b:1/4+1/4", "c:1/2+1/4"]);
    expect(out[1]!.pitch).toBe(72);
  });

  it("함께 옮긴 음이 남은 음과 겹치면 남은 음을 정리한다", () => {
    const changes = new Map<string, Note | null>([["a", { ...base[0]!, start: rat(3, 8) }]]);
    expect(shape(replaceNotes(base, changes))).toEqual(["b:1/4+1/8", "a:3/8+1/4"]);
  });

  it("placeLoss는 replaceNotes가 자르고 지울 다른 음을 미리 알려 준다", () => {
    // a를 3/8로 옮기면(3/8~5/8) b는 1/8만 남고 그 안에서 시작하는 c는 지워진다 (위 시험과 같은 자리)
    const moved = placeLoss(base, new Map([["a", { ...base[0]!, start: rat(3, 8) }]]));
    expect([...moved.cut]).toEqual([["b", rat(1, 8)]]);
    expect([...moved.removed]).toEqual(["c"]);
    // 새 음 x(1/8~5/8)를 넣으면 a는 잘리고, 그 안에서 시작하는 b·c는 지워진다
    const placed = placeLoss(base, new Map([["x", note("x", 1, 4)]]));
    expect([...placed.cut]).toEqual([["a", rat(1, 8)]]);
    expect([...placed.removed].sort()).toEqual(["b", "c"]);
    expect(shape(replaceNotes(base, new Map([["x", note("x", 1, 4)]])))).toEqual(["a:0/1+1/8", "x:1/8+1/2"]);
  });

  it("placeLoss: 함께 옮기는 음끼리, 지우기만 하는 것은 손해로 치지 않는다", () => {
    const together = new Map(base.map((n) => [n.id, { ...n, start: rat(n.start.n * 8 / n.start.d + 2, 8) }] as const));
    const loss = placeLoss(base, together);
    expect(loss.cut.size + loss.removed.size).toBe(0);
    const erase = placeLoss(base, new Map([["a", null]]));
    expect(erase.cut.size + erase.removed.size).toBe(0);
  });
});

describe("많은 음 한꺼번에 넣기·트랙 색인 (점검 S35)", () => {
  it("겹치지 않는 음을 많이 넣으면 뒤에 붙이기만 해도 하나씩 넣은 것과 같다 (&·지운 음 포함)", () => {
    const base = [note("a", 0, 2, 60, "next"), note("b", 2, 2), note("c", 6, 2, 60, "next"), note("d", 10, 2)];
    // b를 나눠 넣고(앞 a의 &는 첫 조각으로 이어진다), c의 & 뒤(8/8)에 새 음을 붙이고, d는 지운다
    const changes = new Map<string, Note | null>([
      ["b", null],
      ["b1", note("b1", 2, 1)],
      ["b2", note("b2", 3, 1)],
      ["e", note("e", 8, 1)],
      ["d", null],
    ]);
    expect(shape(replaceNotes(base, changes))).toEqual(["a:0/1+1/4&", "b1:1/4+1/8", "b2:3/8+1/8", "c:3/4+1/4&", "e:1/1+1/8"]);
  });

  it("넣는 음이 남은 음이나 서로와 겹치면 예전처럼 자르고 지운다", () => {
    const base = [note("a", 0, 4), note("b", 4, 4)];
    const changes = new Map<string, Note | null>([
      ["x", note("x", 2, 1)],
      ["y", note("y", 3, 2)],
    ]);
    // x가 a 꼬리를 자르고, y 안에서 시작하는 b는 지운다
    expect(shape(replaceNotes(base, changes))).toEqual(["a:0/1+1/4", "x:1/4+1/8", "y:3/8+1/4"]);
    // 넣는 음끼리 겹치면 뒤에 넣는 음이 앞 음을 자른다
    const inside = new Map<string, Note | null>([["x", note("x", 1, 4)], ["y", note("y", 2, 1)]]);
    expect(shape(replaceNotes([], inside))).toEqual(["x:1/8+1/8", "y:1/4+1/8"]);
  });

  it("음 수천 개를 한 번에 넣어도 금방 끝난다", () => {
    const base = Array.from({ length: 2000 }, (_, i) => note(`n${i}`, i * 2, 2));
    const changes = new Map<string, Note | null>();
    for (const n of base) {
      changes.set(n.id, null);
      for (let j = 0; j < 8; j++) changes.set(`${n.id}-${j}`, { ...n, id: `${n.id}-${j}`, start: rat(n.start.n * 32 + j * n.start.d, n.start.d * 32), dur: rat(1, 32) });
    }
    const t = performance.now();
    expect(replaceNotes(base, changes)).toHaveLength(16000);
    expect(performance.now() - t).toBeLessThan(2000);
  });

  it("트랙 색인: 시작 순, 앞 음, &로 이어 받는 음, 같은 때 시작하는 음", () => {
    const notes = [note("c", 4, 2), note("a", 0, 2, 60, "next"), note("b", 2, 1), note("d", 6, 2)];
    const index = trackIndex(notes);
    expect(index.sorted.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
    expect(index.indexOf("c")).toBe(2);
    expect(index.indexOf("z")).toBe(-1);
    expect(index.get("d")).toBe(notes[3]);
    expect(index.before(notes[0]!)?.id).toBe("b");
    expect(index.before(notes[1]!)).toBeUndefined();
    expect(index.isHeld(notes[2]!)).toBe(true);
    expect(index.isHeld(notes[0]!)).toBe(false);
    expect(index.startingAt(rat(1, 2)).map((n) => n.id)).toEqual(["c"]);
    expect(index.startingAt(rat(1, 16))).toEqual([]);
  });

  it("깔끔한 트랙: 시작이 다르고 겹치지 않고 id가 하나씩", () => {
    expect(isCleanTrack([note("b", 2, 2), note("a", 0, 2)])).toBe(true);
    expect(isCleanTrack([note("a", 0, 3), note("b", 2, 2)])).toBe(false);
    expect(isCleanTrack([note("a", 0, 2), note("b", 0, 2, 64)])).toBe(false);
    expect(isCleanTrack([note("a", 0, 2), note("a", 2, 2)])).toBe(false);
  });
});

describe("음정 변환", () => {
  it("반음 단위로 옮기고, MIDI 범위를 넘으면 하지 않는다", () => {
    const notes = [note("a", 0, 2, 60), note("b", 2, 2, 120)];
    expect(transposeNotes(notes, -12)!.map((n) => n.pitch)).toEqual([48, 108]);
    expect(transposeNotes(notes, 8)).toBeUndefined();
  });
});

describe("여러 음 바꾸기와 &", () => {
  it("&로 이은 두 음을 함께 바꿔도 &가 남는다 (볼륨 일괄·함께 옮기기)", () => {
    const notes = [note("a", 0, 2, 60, "next"), note("b", 2, 2, 62)];
    const louder = new Map(notes.map((n) => [n.id, { ...n, vol: 9 }] as const));
    expect(replaceNotes(notes, louder)[0]!.tie).toBe("next");
    const later = new Map(notes.map((n) => [n.id, { ...n, start: rat(n.start.n * 8 / n.start.d + 1, 8) }] as const));
    expect(replaceNotes(notes, later)[0]!.tie).toBe("next");
  });
});

describe("길이 ×2·½, 복사·붙여넣기", () => {
  it("길이 ×2: 첫 음 시작을 기준으로 시작도 벌린다", () => {
    // 1/8 지점부터 8분음표 두 개 → 4분음표 두 개, 1/8 지점부터
    expect(shape(scaleNotes([note("a", 1, 1), note("b", 2, 1)], rat(2)))).toEqual(["a:1/8+1/4", "b:3/8+1/4"]);
  });

  it("길이 ½", () => {
    expect(shape(scaleNotes([note("a", 0, 2), note("b", 2, 2)], rat(1, 2)))).toEqual(["a:0/1+1/8", "b:1/8+1/8"]);
  });

  it("복사한 음을 다른 자리에 새 id로 붙인다", () => {
    const clip = clipNotes([note("b", 3, 1), note("a", 2, 1, 62, "next")])!;
    expect(clip.origin).toEqual(rat(1, 4));
    expect(clip.length).toEqual(rat(1, 4));
    let k = 0;
    const pasted = pasteClip(clip, rat(1), () => `p${++k}`);
    expect(shape(pasted)).toEqual(["p1:1/1+1/8&", "p2:9/8+1/8"]);
    expect(pasted[0]!.pitch).toBe(62);
  });

  it("&의 짝을 빼고 복사하면 &를 풀어, 붙인 트랙의 다른 음과 잇지 않는다", () => {
    const clip = clipNotes([note("a", 0, 2, 60, "next")])!;
    expect(clip.notes[0]!.tie).toBe("none");
    // 붙일 트랙에 바로 뒤 e가 있어도 c&e가 되지 않는다
    const target = [note("e", 2, 2, 64)];
    const pasted = pasteClip(clip, rat(0), () => "p1");
    expect(replaceNotes(target, new Map(pasted.map((n) => [n.id, n]))).map((n) => n.tie)).toEqual(["none", "none"]);
  });

  it("음을 자르면 두 음이 되고 &는 뒤 음이 이어받는다", () => {
    const [notes, head, tail] = splitNote([note("a", 0, 4, 60, "next"), note("b", 4, 2, 62)], "a", rat(1, 8), "s1")!;
    expect(shape(notes)).toEqual(["a:0/1+1/8", "s1:1/8+3/8&", "b:1/2+1/4"]);
    expect(head.id).toBe("a");
    expect(tail.vol).toBe(8);
  });

  it("음 끝이나 밖에서는 자르지 않는다", () => {
    expect(splitNote([note("a", 0, 4)], "a", rat(0), "s")).toBeUndefined();
    expect(splitNote([note("a", 0, 4)], "a", rat(1, 2), "s")).toBeUndefined();
  });

  it("& 사슬 가운데 음을 자르면 뒤 음은 실제로 울리던 첫 음 v를 받는다", () => {
    const first = { ...note("a", 0, 2, 60, "next"), vol: 12 };
    const [, , tail] = splitNote([first, { ...note("b", 2, 4), vol: 3 }], "b", rat(1, 2), "s")!;
    expect(tail.vol).toBe(12);
  });

  it("높이가 같고 맞닿은 고른 음을 한 음으로 붙인다", () => {
    const notes = [note("a", 0, 2, 60, "next"), note("b", 2, 1), note("c", 3, 1, 60, "next"), note("d", 4, 2, 64), note("e", 7, 1, 64)];
    const [out, merged] = glueNotes(notes, new Set(["a", "b", "c", "d", "e"]))!;
    expect(shape(out)).toEqual(["a:0/1+1/2&", "d:1/2+1/4", "e:7/8+1/8"]);
    expect(merged.map((n) => n.id)).toEqual(["a", "d", "e"]);
  });

  it("붙일 음이 없으면 undefined", () => {
    expect(glueNotes([note("a", 0, 2), note("b", 2, 2, 62)], new Set(["a", "b"]))).toBeUndefined();
    expect(glueNotes([note("a", 0, 2), note("b", 2, 2)], new Set(["a"]))).toBeUndefined();
  });
});

describe("음량 레인", () => {
  const v = (id: string, start: number, dur: number, vol: number, tie: Note["tie"] = "none"): Note => ({ ...note(id, start, dur, 60, tie), vol });
  const range = { min: 0, max: 15 };

  it("붙은 &만 한 막대로 묶고, 떨어진 &는 따로 둔다", () => {
    const notes = [v("a", 0, 2, 10, "next"), v("b", 2, 2, 3), v("c", 5, 1, 0, "next"), v("d", 7, 1, 9)];
    const bars = volumeBars(notes);
    expect(bars.map((b) => [b.head.id, b.ids.join(""), b.vol, `${b.end.n}/${b.end.d}`])).toEqual([
      ["a", "ab", 10, "1/2"],
      ["c", "c", 0, "3/4"],
      ["d", "d", 9, "1/1"],
    ]);
  });

  it("직선은 끝을 포함해 반올림하고 범위 안으로 자른다", () => {
    const bars = volumeBars([v("a", 0, 1, 8), v("b", 1, 1, 8), v("c", 2, 1, 8), v("d", 3, 1, 8), v("e", 4, 1, 8)]);
    const m = rampVolumes(bars, rat(0), rat(4, 8), 15, 0, range);
    expect([...m]).toEqual([["a", 15], ["b", 11], ["c", 8], ["d", 4], ["e", 0]]);
    // 거꾸로 그어도 같은 선
    expect([...rampVolumes(bars, rat(4, 8), rat(0), 0, 15, range)]).toEqual([...m]);
    // 시작이 구간 밖인 막대는 빠지고, 범위를 넘으면 자른다
    expect([...rampVolumes(bars, rat(1, 8), rat(2, 8), 20, 30, range)]).toEqual([["b", 15], ["c", 15]]);
  });

  it("한 점 직선은 그 자리 막대만 끝값", () => {
    const bars = volumeBars([v("a", 0, 1, 8), v("b", 1, 1, 8)]);
    expect([...rampVolumes(bars, rat(1, 8), rat(1, 8), 3, 12, range)]).toEqual([["b", 12]]);
  });

  it("사슬 전체 또는 첫 음만 바꾸고 순서는 그대로", () => {
    const notes = [v("a", 0, 2, 10, "next"), v("b", 2, 2, 3), v("c", 4, 1, 5)];
    const all = applyVolumes(notes, new Map([["a", 6]]));
    expect(all.map((n) => `${n.id}${n.vol}`)).toEqual(["a6", "b6", "c5"]);
    expect(all[2]).toBe(notes[2]);
    expect(applyVolumes(notes, new Map([["a", 6]]), false).map((n) => `${n.id}${n.vol}`)).toEqual(["a6", "b3", "c5"]);
    // 첫 음이 아닌 id는 무시
    expect(applyVolumes(notes, new Map([["b", 1]])).map((n) => n.vol)).toEqual([10, 3, 5]);
  });
});

describe("여러 트랙 음량 자리", () => {
  const n = (id: string, start: number, dur: number, pitch: number, tie: Note["tie"] = "none"): Note => note(id, start, dur, pitch, tie);

  it("멜로디는 그대로, 반주는 그 순간 높이로 맨 위·가운데·맨 아래", () => {
    const ranks = voiceRanks([
      { id: "m", melody: true, notes: [n("m1", 0, 4, 72), n("m2", 4, 4, 60)] },
      { id: "a", melody: false, notes: [n("a1", 0, 8, 67)] },
      { id: "b", melody: false, notes: [n("b1", 0, 4, 64), n("b2", 4, 4, 65)] },
      { id: "c", melody: false, notes: [n("c1", 0, 8, 48)] },
    ]);
    expect(ranks.get("m")?.get("m1")).toBe("melody");
    expect(ranks.get("a")?.get("a1")).toBe("top");
    expect(ranks.get("b")?.get("b1")).toBe("middle");
    expect(ranks.get("c")?.get("c1")).toBe("bottom");
    // 멜로디가 가운데로 내려와도(팻 메서니 곡처럼) 멜로디 트랙은 멜로디
    expect(ranks.get("m")?.get("m2")).toBe("melody");
  });

  it("반주 음이 혼자면 멜로디보다 낮을 때만 맨 아래, 이음 사슬은 첫 음 자리로", () => {
    const ranks = voiceRanks([
      { id: "m", melody: true, notes: [n("m1", 0, 4, 72)] },
      { id: "b", melody: false, notes: [n("b1", 0, 2, 48, "next"), n("b2", 2, 2, 50), n("b3", 6, 2, 80)] },
    ]);
    expect([...ranks.get("b")!]).toEqual([["b1", "bottom"], ["b3", "top"]]);
  });

  it("멜로디 트랙이 없으면 맨 위 음이 top", () => {
    const ranks = voiceRanks([
      { id: "a", melody: false, notes: [n("a1", 0, 2, 70)] },
      { id: "b", melody: false, notes: [n("b1", 1, 2, 60)] },
    ]);
    expect(ranks.get("a")?.get("a1")).toBe("top");
    // b1이 시작할 때 a1이 아직 울린다
    expect(ranks.get("b")?.get("b1")).toBe("bottom");
  });
});

describe("& 사슬이 끊길 때 뒤 음 v (beta.11, #98 Codex 점검)", () => {
  // v12 e & g & a 에서 g·a에 적힌 v는 2·3이지만 & 때문에 v12로 울린다
  const chain = (): Note[] => [
    { ...note("e", 0, 2, 64, "next"), vol: 12 },
    { ...note("g", 2, 2, 67, "next"), vol: 2 },
    { ...note("a", 4, 2, 69), vol: 3 },
  ];
  const vols = (notes: Note[]) => notes.map((n) => `${n.id}${n.tie === "next" ? "&" : ""}:${n.vol}`);

  it("피아노롤에서 가운데 음을 줄이면(placeNote/updateNote) 손대지 않은 뒤 음은 사슬 첫 음 v로 소리 낸다", () => {
    expect(vols(updateNote(chain(), "g", { dur: rat(1, 8) }))).toEqual(["e&:12", "g:2", "a:12"]);
  });

  it("여러 음을 한꺼번에 줄여도(replaceNotes) 같다", () => {
    const g = chain()[1]!;
    expect(vols(replaceNotes(chain(), new Map([["g", { ...g, dur: rat(1, 8) }]])))).toEqual(["e&:12", "g:2", "a:12"]);
  });

  it("가운데 음을 지우면(removeNotes) 뒤 음이 사슬 첫 음 v를 받는다. 사슬 밖 음은 그대로", () => {
    const outside = { ...note("z", 8, 2, 72), vol: 5 };
    expect(vols(removeNotes([...chain(), outside], new Set(["g"])))).toEqual(["e:12", "a:12", "z:5"]);
  });

  it("앞뒤 음을 함께 지워 &가 풀리며 복사된 음도 사슬 첫 음 v를 받는다 (#100 3차 Codex 점검)", () => {
    expect(vols(removeNotes(chain(), new Set(["e", "a"])))).toEqual(["g:12"]);
    expect(vols(replaceNotes(chain(), new Map([["e", null], ["a", null]])))).toEqual(["g:12"]);
  });

  it("첫 음만 옮겨 잘린 가운데 음도 사슬 첫 음 v를 받는다 (#100 3차 Codex 점검)", () => {
    expect(vols(updateNote(chain(), "e", { start: rat(3, 8) }))).toEqual(["g:12", "e:12"]);
  });

  it("사슬이 그대로 이어지면 적힌 v를 바꾸지 않는다", () => {
    expect(vols(updateNote(chain(), "a", { dur: rat(1, 8) }))).toEqual(["e&:12", "g&:2", "a:3"]);
  });

  it("옮기면서 vol을 함께 주면(updateNote) 사슬 첫 음 v 대신 준 vol이 남는다", () => {
    expect(vols(updateNote(chain(), "g", { start: rat(1), vol: 7 }))).toEqual(["e:12", "a:12", "g:7"]);
  });

  it("vol을 원래와 같은 값으로 줘도 명시한 것으로 보고 사슬 보정을 하지 않는다", () => {
    expect(vols(updateNote(chain(), "g", { start: rat(1), vol: 2 }))).toEqual(["e:12", "a:12", "g:2"]);
  });

  it("vol 없이 start만 바꾸면 사슬 첫 음 v를 받는다", () => {
    expect(vols(updateNote(chain(), "g", { start: rat(1) }))).toEqual(["e:12", "a:12", "g:12"]);
  });

  it("replaceNotes는 명시 목록에 든 음만 준 vol을 지킨다", () => {
    const g = chain()[1]!;
    const changes = new Map([["g", { ...g, start: rat(1), vol: 7 }]]);
    expect(vols(replaceNotes(chain(), changes, new Set(["g"])))).toEqual(["e:12", "a:12", "g:7"]);
    expect(vols(replaceNotes(chain(), changes))).toEqual(["e:12", "a:12", "g:12"]);
  });
});

describe("고른 음만 길이 ×2·½ (고르지 않은 음은 지우거나 줄이지 않는다)", () => {
  const apply = (notes: Note[], ids: string[], factor: ReturnType<typeof rat>) => {
    const out = scaleNotesIn(notes, notes.filter((n) => ids.includes(n.id)), factor);
    return out && shape(replaceNotes(notes, new Map(out.map((n) => [n.id, n]))));
  };

  it("c4d4e4에서 c만 ×2: 바로 뒤에 d가 있어 늘릴 자리가 없다", () => {
    expect(apply([note("c", 0, 2), note("d", 2, 2), note("e", 4, 2)], ["c"], rat(2))).toBeUndefined();
  });

  it("c4r4d4에서 c만 ×2: c2가 되고 d는 남는다", () => {
    expect(apply([note("c", 0, 2), note("d", 4, 2)], ["c"], rat(2))).toEqual(["c:0/1+1/2", "d:1/2+1/4"]);
  });

  it("여러 음을 골라도 리듬 모양을 지키고, 선택 밖 음과 겹치는 음만 그 앞에서 자른다", () => {
    // a(0, 4분) · b(3/8, 8분, 고르지 않음) · c(3/4, 8분) → a는 b 앞까지, c는 3/2로
    expect(apply([note("a", 0, 2), note("b", 3, 1), note("c", 6, 1)], ["a", "c"], rat(2))).toEqual(["a:0/1+3/8", "b:3/8+1/8", "c:3/2+1/4"]);
  });

  it("½은 그대로 줄이고, 옮겨 간 자리가 고르지 않은 음과 겹치면 하지 않는다", () => {
    expect(apply([note("c", 0, 2), note("d", 2, 2)], ["c"], rat(1, 2))).toEqual(["c:0/1+1/8", "d:1/4+1/4"]);
    // a(0)·c(1/2)를 골라 ½ → c가 1/4로 와서 고르지 않은 b(1/4) 자리와 겹친다
    expect(apply([note("a", 0, 2), note("b", 2, 2), note("c", 4, 2)], ["a", "c"], rat(1, 2))).toBeUndefined();
  });
});

describe("여러 트랙 복사 (타브)", () => {
  it("층마다 같은 기준으로 옮기고 트랙 순서를 지킨다", () => {
    const clip = clipLayers([[note("a", 2, 2, 64)], [], [note("b", 4, 2, 60), note("c", 6, 2, 60, "next")]])!;
    expect(clip.origin).toEqual(rat(1, 4));
    expect(clip.length).toEqual(rat(3, 4));
    expect(clip.layers!.map((l) => shape([...l]))).toEqual([["a:0/1+1/4"], ["b:1/4+1/4", "c:1/2+1/4"]]);
    // 짝 없이 남은 &는 푼다 (clipNotes와 같음)
    expect(clip.layers![1]![1]!.tie).toBe("none");
    expect(shape([...clip.notes])).toEqual(["a:0/1+1/4", "b:1/4+1/4", "c:1/2+1/4"]);
  });

  it("층이 하나면 clipNotes와 같고 layers가 없다", () => {
    const one = [note("a", 2, 2), note("b", 4, 2)];
    expect(clipLayers([[], one])).toEqual(clipNotes(one));
    expect(clipLayers([[], []])).toBeUndefined();
  });

  it("층을 한 트랙에 모으면 겹치는지", () => {
    expect(clipOverlaps(clipLayers([[note("a", 0, 2)], [note("b", 0, 2, 64)]])!)).toBe(true);
    // 긴 음이 뒤의 떨어진 음과 겹치는 경우도 찾는다
    expect(clipOverlaps(clipLayers([[note("a", 0, 8)], [note("b", 1, 1, 64), note("c", 4, 1, 64)]])!)).toBe(true);
    expect(clipOverlaps(clipLayers([[note("a", 0, 2)], [note("b", 2, 2, 64)]])!)).toBe(false);
  });

  it("길이 ×2의 기준을 주면 트랙마다 같은 기준으로 벌린다", () => {
    expect(shape(scaleNotes([note("b", 4, 2)], rat(2), rat(0)))).toEqual(["b:1/1+1/2"]);
    expect(shape(scaleNotes([note("b", 4, 2)], rat(2)))).toEqual(["b:1/2+1/2"]);
  });
});
