import { describe, expect, it } from "vitest";
import { clipLayers, clipNotes, clipOverlaps, pasteClip, rat, STANDARD_TUNING, type Note } from "@mmlce/core";
import { editPicked, gluePicked, notesInRange, placeLayers, playableOn, pruneSelection, scalePicked, selectionRange, tiePicked } from "../src/lib/tabSelect";

const note = (id: string, start: number, dur: number, pitch = 60, extra: Partial<Note> = {}): Note => ({ id, start: rat(start, 8), dur: rat(dur, 8), pitch, vol: 8, tie: "none", ...extra });
const shape = (notes: readonly Note[]) => notes.map((n) => `${n.id}:${n.start.n}/${n.start.d}+${n.dur.n}/${n.dur.d}${n.tie === "next" ? "&" : ""}`);

// 화음 두 개: 트랙 a(위 음)와 b(아래 음), 8분음표 자리 0과 2
const chords = () => [
  { id: "a", notes: [note("a1", 0, 2, 64), note("a2", 2, 2, 67)] },
  { id: "b", notes: [note("b1", 0, 2, 60), note("b2", 2, 2, 62), note("b3", 6, 2, 60)] },
];

describe("타브 고르기 범위", () => {
  it("시작 자리와 커서 칸을 모두 넣는다 (어느 쪽으로 넓혀도)", () => {
    expect(selectionRange(rat(1, 4), rat(1, 2), rat(1, 8))).toEqual([rat(1, 4), rat(5, 8)]);
    expect(selectionRange(rat(1, 2), rat(1, 4), rat(1, 8))).toEqual([rat(1, 4), rat(5, 8)]);
    expect(selectionRange(rat(0), rat(0), rat(1, 8))).toEqual([rat(0), rat(1, 8)]);
  });

  it("범위 안에서 시작하는 음을 줄·트랙과 상관없이 모두 고른다", () => {
    expect([...notesInRange(chords(), rat(0), rat(1, 4))].sort()).toEqual(["a1", "b1"]);
    expect([...notesInRange(chords(), rat(0), rat(1, 2) )].sort()).toEqual(["a1", "a2", "b1", "b2"]);
    // 범위 앞에서 시작해 걸쳐 있는 음은 고르지 않는다
    expect([...notesInRange(chords(), rat(1, 8), rat(1, 4))]).toEqual([]);
  });

  it("곡에서 사라진 음은 고르기에서 뺀다", () => {
    const keep = new Set(["a1", "b2"]);
    expect(pruneSelection(keep, chords())).toBe(keep);
    expect([...pruneSelection(new Set(["a1", "gone"]), chords())]).toEqual(["a1"]);
  });
});

describe("고른 음 편집 (여러 트랙)", () => {
  it("지우기: 고른 음만 트랙마다 지운다", () => {
    const changes = editPicked(chords(), new Set(["a1", "b1"]), () => null);
    expect(changes.map((c) => [c.trackId, shape(c.notes)])).toEqual([
      ["a", ["a2:1/4+1/4"]],
      ["b", ["b2:1/4+1/4", "b3:3/4+1/4"]],
    ]);
  });

  it("옥타브: 적어 둔 줄에서 못 치게 되면 줄을 지워 다시 고르게 한다 (음은 지우지 않는다)", () => {
    // 1번 줄(E4 = 64)에 적힌 G4(67)를 한 옥타브 내리면 G3(55)는 1번 줄에서 못 친다
    const tracks = [{ id: "a", notes: [note("a1", 0, 2, 67, { tabString: 1 })] }];
    const [down] = editPicked(tracks, new Set(["a1"]), (n) => ({ ...n, pitch: n.pitch - 12 }), STANDARD_TUNING);
    expect(down!.notes[0]!.pitch).toBe(55);
    expect(down!.notes[0]!.tabString).toBeUndefined();
    // 올려도 그 줄에서 칠 수 있으면 줄을 그대로 둔다
    const [up] = editPicked(tracks, new Set(["a1"]), (n) => ({ ...n, pitch: n.pitch + 12 }), STANDARD_TUNING);
    expect(up!.notes[0]!.tabString).toBe(1);
    expect(playableOn(STANDARD_TUNING, 1, 55)).toBe(false);
  });

  it("길이 ×2: 모든 트랙이 같은 기준으로 벌려 화음 리듬이 맞는다", () => {
    const tracks = [
      { id: "a", notes: [note("a1", 0, 1, 64)] },
      { id: "b", notes: [note("b1", 1, 1, 60)] },
    ];
    const changes = scalePicked(tracks, new Set(["a1", "b1"]), rat(2))!;
    expect(changes.map((c) => shape(c.notes))).toEqual([["a1:0/1+1/4"], ["b1:1/4+1/4"]]);
  });

  it("길이 ×2: 어느 트랙이든 자리가 없으면 아무것도 바꾸지 않는다", () => {
    const tracks = [
      { id: "a", notes: [note("a1", 0, 2, 64)] },
      { id: "b", notes: [note("b1", 0, 2, 60), note("b2", 2, 2, 62)] },
    ];
    expect(scalePicked(tracks, new Set(["a1", "b1"]), rat(2))).toBeUndefined();
  });

  it("잇기·붙이기는 트랙마다", () => {
    const tied = tiePicked(chords(), new Set(["a1", "b1"]))!;
    expect(tied.map((c) => shape(c.notes)[0])).toEqual(["a1:0/1+1/4&", "b1:0/1+1/4&"]);
    const tracks = [{ id: "a", notes: [note("x", 0, 2), note("y", 2, 2)] }, { id: "b", notes: [note("z", 0, 2, 64)] }];
    const glued = gluePicked(tracks, new Set(["x", "y", "z"]))!;
    expect(glued.changes.map((c) => [c.trackId, shape(c.notes)])).toEqual([["a", ["x:0/1+1/2"]]]);
    expect([...glued.kept].sort()).toEqual(["x", "z"]);
  });
});

describe("층 붙이기", () => {
  const empty = () => [
    { id: "a", notes: [] as Note[] },
    { id: "b", notes: [] as Note[] },
  ];
  const ids = () => {
    let k = 0;
    return () => `p${k++}`;
  };

  it("타브 클립을 타브에: 층 k를 k번째 트랙에 넣는다", () => {
    const clip = clipLayers(chords().map((t) => t.notes))!;
    const layers = clip.layers!.map((l) => pasteClip({ ...clip, notes: l }, rat(1), ids()));
    const placed = placeLayers(empty(), layers, 0)!;
    expect(placed.added).toEqual([]);
    expect(placed.changes.map((c) => [c.trackId, c.notes.map((n) => n.pitch)])).toEqual([
      ["a", [64, 67]],
      ["b", [60, 62, 60]],
    ]);
  });

  it("같은 트랙에 두 층이 겹치면 다른 빈 트랙, 없으면 한도 안에서 새 트랙에 넣는다", () => {
    const layers = [[note("x", 0, 2, 64)], [note("y", 0, 2, 60)]];
    const one = [{ id: "a", notes: [] as Note[] }];
    const placed = placeLayers(one, layers, 1)!;
    expect(placed.changes.map((c) => shape(c.notes))).toEqual([["x:0/1+1/4"]]);
    expect(placed.added.map((l) => shape(l))).toEqual([["y:0/1+1/4"]]);
  });

  it("한도 때문에 하나라도 못 넣으면 아무것도 붙이지 않는다", () => {
    const layers = [[note("x", 0, 2, 64)], [note("y", 0, 2, 60)], [note("z", 0, 2, 55)]];
    expect(placeLayers([{ id: "a", notes: [] }], layers, 1)).toBeUndefined();
    // 있던 음과 겹쳐도 지우지 않고 다른 자리를 찾는다
    expect(placeLayers([{ id: "a", notes: [note("old", 0, 4)] }], [[note("x", 0, 2)]], 0)).toBeUndefined();
  });

  it("잠근 트랙에는 넣지 않는다", () => {
    const placed = placeLayers(empty(), [[note("x", 0, 2)]], 0, new Set(["a"]))!;
    expect(placed.changes.map((c) => c.trackId)).toEqual(["b"]);
  });

  it("롤 클립(층 없음)을 타브에: 한 층으로 넣는다", () => {
    const clip = clipNotes([note("a", 0, 2), note("b", 2, 2)])!;
    expect(clip.layers).toBeUndefined();
    const placed = placeLayers(empty(), [pasteClip(clip, rat(0), ids())], 0)!;
    expect(placed.changes.map((c) => [c.trackId, c.notes.length])).toEqual([["a", 2]]);
  });

  it("타브 클립을 롤에: 층을 모으면 겹치는 화음이면 붙이지 않는다", () => {
    expect(clipOverlaps(clipLayers(chords().map((t) => t.notes))!)).toBe(true);
    expect(clipOverlaps(clipLayers([[note("a", 0, 2)], [note("b", 2, 2)]])!)).toBe(false);
  });
});
