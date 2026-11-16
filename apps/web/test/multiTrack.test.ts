import { describe, expect, it } from "vitest";
import { add, emptySong, History, rat, type Note, type Song } from "@mmlce/core";
import { setTracksNotes } from "@mmlce/mml";
import { clipTracks, idsInRange, moveInTracks, pasteTracks, removeFromTracks, spanOf } from "../src/lib/multiTrack";

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

describe("여러 트랙 음 함께 옮기기", () => {
  /** 고른 음(ids)을 시간 dt(8분음표 수)·높이 dp만큼 옮긴 자리 */
  const shifted = (ids: ReadonlySet<string>, dt: number, dp = 0) =>
    new Map(tracks.flatMap((t) => t.notes.filter((n) => ids.has(n.id))).map((n): [string, Note] => [n.id, { ...n, start: add(n.start, rat(dt, 8)), pitch: n.pitch + dp }]));

  it("고른 음을 트랙마다 제 트랙에서 같은 만큼 옮긴다 (id·길이·볼륨 그대로)", () => {
    const ids = idsInRange(tracks, 0, 0.5);
    const done = moveInTracks(tracks, shifted(ids, 4, 2));
    expect(done.changes.map((c) => c.trackId)).toEqual(["a", "b"]);
    expect(done.changes[0]!.notes.map(at)).toEqual(["a1@1/2", "a2@5/8", "a3@3/4", "a4@7/8", "a5@1/1"]);
    expect(done.changes[1]!.notes.map(at)).toEqual(["b1@1/2", "b2@3/4"]);
    expect(done.changes[0]!.notes.slice(0, 4).map((n) => n.pitch)).toEqual([62, 62, 62, 62]);
    expect(done.changes[1]!.notes.map((n) => n.pitch)).toEqual([50, 50]);
    expect(done.changes[1]!.notes.map((n) => [n.dur, n.vol])).toEqual(tracks[1]!.notes.map((n) => [n.dur, n.vol]));
    expect(done.loss.cut.size + done.loss.removed.size).toBe(0);
  });

  it("함께 옮기는 음끼리는 먹지 않고, 옮긴 자리에 있던 고르지 않은 음은 그 트랙에서만 잘리거나 지워진다", () => {
    // a1-a4와 b1·b2를 한 마디 뒤로: a5(둘째 마디 첫 자리)만 a1에 먹힌다. b 트랙에는 먹힐 음이 없다
    const done = moveInTracks(tracks, shifted(idsInRange(tracks, 0, 0.5), 8));
    expect(done.changes[0]!.notes.map(at)).toEqual(["a1@1/1", "a2@9/8", "a3@5/4", "a4@11/8"]);
    expect(done.changes[1]!.notes.map(at)).toEqual(["b1@1/1", "b2@5/4"]);
    expect([...done.loss.removed]).toEqual(["a5"]);
    // 한 칸만 옮기면 서로 자리가 겹치지만 함께 옮기는 음이라 그대로다
    const one = moveInTracks(tracks, shifted(idsInRange(tracks, 0, 0.5), 1));
    expect(one.changes[0]!.notes.map(at)).toEqual(["a1@1/8", "a2@1/4", "a3@3/8", "a4@1/2", "a5@1/1"]);
    expect(one.loss.cut.size + one.loss.removed.size).toBe(0);
  });

  it("옮긴 음이 없는 트랙은 건드리지 않는다", () => {
    const done = moveInTracks(tracks, shifted(new Set(["b2"]), 2));
    expect(done.changes.map((c) => c.trackId)).toEqual(["b"]);
    expect(done.changes[0]!.notes.map(at)).toEqual(["b1@0/1", "b2@1/2"]);
    expect(moveInTracks(tracks, new Map()).changes).toEqual([]);
  });

  it("격자에 안 맞는 분수 자리도 반올림 없이 그대로 옮긴다", () => {
    const odd = [{ id: "a", notes: [{ ...note("x", 0, 1), start: rat(1, 12), dur: rat(1, 12) }] }, { id: "b", notes: [{ ...note("y", 0, 1), start: rat(1, 20), dur: rat(1, 20) }] }];
    const moved = new Map(odd.flatMap((t) => t.notes).map((n): [string, Note] => [n.id, { ...n, start: add(n.start, rat(1, 16)) }]));
    const done = moveInTracks(odd, moved);
    expect(done.changes[0]!.notes[0]!.start).toEqual(add(rat(1, 12), rat(1, 16)));
    expect(done.changes[1]!.notes[0]!.start).toEqual(add(rat(1, 20), rat(1, 16)));
  });

  it("곡에 넣으면 실행 취소 한 번으로 모든 트랙이 함께 돌아온다", () => {
    const song: Song = {
      ...emptySong({ title: "", author: "", profileId: "mabinogi-mobile" }),
      players: [{ id: "p1", name: "", instrument: { canonical: "piano" } }],
      tracks: tracks.map((t) => ({ id: t.id, playerId: "p1", name: t.id, color: "#000000", role: "free" as const, mute: false, solo: false, notes: t.notes, spelling: {} })),
    };
    const history = new History(song);
    const done = moveInTracks(song.tracks, shifted(idsInRange(tracks, 0, 0.5), 4));
    const after = history.run(setTracksNotes(done.changes, "음 옮기기"));
    expect(after.tracks.map((t) => t.notes.map(at))).toEqual([
      ["a1@1/2", "a2@5/8", "a3@3/4", "a4@7/8", "a5@1/1"],
      ["b1@1/2", "b2@3/4"],
    ]);
    expect(history.undo().tracks.map((t) => t.notes)).toEqual(tracks.map((t) => t.notes));
    expect(history.canUndo).toBe(false);
  });
});
