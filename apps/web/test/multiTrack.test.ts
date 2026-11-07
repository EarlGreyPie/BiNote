import { describe, expect, it } from "vitest";
import { rat, type Note } from "@mmlce/core";
import { clipTracks, idsInRange, pasteTracks, removeFromTracks, spanOf } from "../src/lib/multiTrack";

const note = (id: string, start: number, dur: number, pitch = 60): Note => ({ id, start: rat(start, 8), dur: rat(dur, 8), pitch, vol: 8, tie: "none" });
const at = (n: Note) => `${n.id}@${n.start.n}/${n.start.d}`;

// 두 트랙: 멜로디 a(8분음표 넷)와 베이스 b(4분음표 둘), 둘째 마디에 멜로디 하나 더
const tracks = [
  { id: "a", notes: [note("a1", 0, 1), note("a2", 1, 1), note("a3", 2, 1), note("a4", 3, 1), note("a5", 8, 1)] },
  { id: "b", notes: [note("b1", 0, 2, 48), note("b2", 2, 2, 48)] },
];

describe("여러 트랙 고르기", () => {
  it("구간 안에서 시작하는 모든 트랙 음을 높이와 상관없이 고른다", () => {
    expect([...idsInRange(tracks, 0.25, 0.5)].sort()).toEqual(["a3", "a4", "b2"]);
    expect([...idsInRange(tracks, 0, 1)].sort()).toEqual(["a1", "a2", "a3", "a4", "b1", "b2"]);
  });

  it("고른 음이 걸친 시간", () => {
    expect(spanOf([note("x", 1, 1), note("y", 3, 2)])).toEqual([0.125, 0.625]);
    expect(spanOf([])).toBeUndefined();
  });

  it("복사하면 층마다 트랙 id를 달고, 붙이면 층이 제 트랙에 들어간다", () => {
    const clip = clipTracks(tracks, idsInRange(tracks, 0, 0.5))!;
    expect(clip.trackIds).toEqual(["a", "b"]);
    expect(clip.layers?.map((l) => l.length)).toEqual([4, 2]);
    let k = 0;
    const done = pasteTracks(tracks, clip, rat(1, 1), () => `p${++k}`)!;
    expect(done.changes.map((c) => c.trackId)).toEqual(["a", "b"]);
    // a: 원래 다섯 + 둘째 마디 첫 자리 a5와 겹친 붙인 음(p1)이 a5를 밀어낸다
    expect(done.changes[0]!.notes.map(at)).toEqual(["a1@0/1", "a2@1/8", "a3@1/4", "a4@3/8", "p1@1/1", "p2@9/8", "p3@5/4", "p4@11/8"]);
    expect(done.changes[1]!.notes.map(at)).toEqual(["b1@0/1", "b2@1/4", "p5@1/1", "p6@5/4"]);
    expect([...done.loss.removed]).toEqual(["a5"]);
    expect(done.pasted.size).toBe(6);
    expect(done.end).toEqual(rat(3, 2));
  });

  it("한 트랙만 골라도 트랙 id를 달아 제 트랙에 붙는다", () => {
    const clip = clipTracks(tracks, new Set(["b2"]))!;
    expect(clip.trackIds).toEqual(["b"]);
    const done = pasteTracks(tracks, clip, rat(2, 1), () => "q")!;
    expect(done.changes.map((c) => c.trackId)).toEqual(["b"]);
  });

  it("복사해 온 트랙이 없으면 붙이지 않는다", () => {
    const clip = clipTracks(tracks, new Set(["a1", "b1"]))!;
    expect(pasteTracks([tracks[0]!], clip, rat(0), () => "z")).toBeUndefined();
  });

  it("& 사슬 첫 음을 지우면 남은 음이 원래 들리던 볼륨을 지키고, 뒤 음을 지우면 &를 푼다", () => {
    const chain = [{ id: "c", notes: [{ ...note("h", 0, 1), vol: 8, tie: "next" as const }, { ...note("t", 1, 1), vol: 2 }] }];
    expect(removeFromTracks(chain, new Set(["h"]))[0]!.notes.map((n) => n.vol)).toEqual([8]);
    expect(removeFromTracks(chain, new Set(["t"]))[0]!.notes.map((n) => n.tie)).toEqual(["none"]);
  });

  it("고른 음을 트랙마다 지운다 (고른 음이 없는 트랙은 그대로)", () => {
    const out = removeFromTracks(tracks, new Set(["a1", "a2"]));
    expect(out.map((c) => c.trackId)).toEqual(["a"]);
    expect(out[0]!.notes.map((n) => n.id)).toEqual(["a3", "a4", "a5"]);
  });
});
