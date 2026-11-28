import { describe, expect, it } from "vitest";
import { emptySong, History, MOBILE_PROFILE, rat, structureMarkers, type Marker, type Song } from "@mmlce/core";
import { checkDeleteBars, convertTempoResult, deleteTime, lostOpenMemos, insertTime, moveMarker, parseTrackText, removeMarker, setMarker, setMarkerMemo, setMemo, setMemoDone, splitSong } from "../src/index.js";

/** 마커 둘(구조 A, 메모 하나)과 범위 메모 하나를 둔 빈 곡 */
function song(markers: Marker[]): Song {
  return { ...emptySong({ title: "", author: "", profileId: "mobile" }), markers };
}
const A: Marker = { id: "m1", at: rat(0), label: "A" };
const memo: Marker = { id: "m2", at: rat(1), label: "볼륨 +1", kind: "memo" };
const range: Marker = { id: "m3", at: rat(2), end: rat(4), label: "다시 확인", kind: "memo" };

describe("작업 메모 명령 (실행 취소 한 칸)", () => {
  it("넣기: 커서 자리 메모와 반복 구간 범위 메모, 빈 글은 무시", () => {
    const h = new History(song([A]));
    h.run(setMemo(undefined, { at: rat(1, 2), text: "  노트수정 " }));
    h.run(setMemo(undefined, { at: rat(1), end: rat(3), text: "여기부터" }));
    h.run(setMemo(undefined, { at: rat(1), text: "   " }));
    expect(h.song.markers).toEqual([A, { id: "m2", at: rat(1, 2), label: "노트수정", kind: "memo" }, { id: "m3", at: rat(1), end: rat(3), label: "여기부터", kind: "memo" }]);
    h.undo();
    expect(h.song.markers).toHaveLength(2);
  });

  it("끝이 시작보다 뒤가 아니면 한 자리 메모로 둔다", () => {
    const s = setMemo(undefined, { at: rat(2), end: rat(2), text: "x" }).apply(song([]));
    expect(s.markers[0]!.end).toBeUndefined();
  });

  it("고치기: 글과 끝냄을 바꾸고 id·범위는 지킨다. 끝냄을 끄면 done 칸을 뗀다. 같으면 곡을 바꾸지 않는다", () => {
    const s = song([A, range]);
    const done = setMemo("m3", { at: rat(2), end: rat(4), text: "다시 확인 끝", done: true }).apply(s);
    expect(done.markers[1]).toEqual({ ...range, label: "다시 확인 끝", done: true });
    const open = setMemo("m3", { at: rat(2), end: rat(4), text: "다시 확인 끝", done: false }).apply(done);
    expect(open.markers[1]).toEqual({ ...range, label: "다시 확인 끝" });
    expect("done" in open.markers[1]!).toBe(false);
    expect(setMemo("m3", { at: rat(2), end: rat(4), text: "다시 확인" }).apply(s)).toBe(s);
  });

  it("끝냄 켜고 끄기, 메모가 아니면 그대로", () => {
    const s = song([A, memo]);
    const done = setMemoDone("m2", true).apply(s);
    expect(done.markers[1]!.done).toBe(true);
    expect(setMemoDone("m2", true).apply(done)).toBe(done);
    expect(setMemoDone("m2", false).apply(done).markers[1]).toEqual(memo);
    expect(setMemoDone("m1", true).apply(s)).toBe(s);
  });

  it("마커 ↔ 메모 바꾸기: 마커로 되돌리면 끝냄·범위 끝을 뗀다", () => {
    const s = song([A, { ...range, done: true }]);
    const back = setMarkerMemo("m3", false).apply(s);
    expect(back.markers[1]).toEqual({ id: "m3", at: rat(2), label: "다시 확인" });
    expect(setMarkerMemo("m1", true).apply(s).markers[0]).toEqual({ ...A, kind: "memo" });
    expect(setMarkerMemo("m1", false).apply(s)).toBe(s);
  });

  it("마커 창으로 메모 이름을 고쳐도 메모 표시는 남는다", () => {
    const s = setMarker("m3", rat(2), "새 이름").apply(song([range]));
    expect(s.markers[0]).toEqual({ ...range, label: "새 이름" });
  });

  it("끌어 옮기면 범위 메모의 끝도 같은 만큼 옮긴다, 지우기는 마커와 같다", () => {
    const s = moveMarker("m3", rat(5, 2)).apply(song([A, range]));
    expect(s.markers[1]).toMatchObject({ at: rat(5, 2), end: rat(9, 2) });
    expect(removeMarker("m3").apply(s).markers).toEqual([A]);
  });

  it("구조를 읽는 곳은 메모를 세지 않는다", () => {
    expect(structureMarkers([A, memo, range])).toEqual([A]);
  });
});

describe("마디 넣기·빼기·템포 변환 때 메모 자리와 끝도 옮긴다", () => {
  it("마디 넣기: 뒤의 자리와 끝을 민다. 범위 안에 넣으면 범위가 늘고, 끝 자리에 넣으면 늘지 않는다", () => {
    const s = insertTime(rat(3), rat(1)).apply(song([A, memo, range]));
    expect(s.markers.map((m) => [m.at, m.end])).toEqual([[rat(0), undefined], [rat(1), undefined], [rat(2), rat(5)]]);
    const atEnd = insertTime(rat(4), rat(1)).apply(song([range]));
    expect(atEnd.markers[0]).toMatchObject({ at: rat(2), end: rat(4) });
    const before = insertTime(rat(1), rat(1)).apply(song([range]));
    expect(before.markers[0]).toMatchObject({ at: rat(3), end: rat(5) });
  });

  it("마디 빼기: 구간 안 한 자리 메모는 지우고, 범위 메모는 남는 부분만 남긴다", () => {
    // [1, 3) 빼기: 메모(1)는 지워지고, 범위 [2, 4)는 [1, 2)가 된다
    const s = deleteTime(rat(1), rat(2)).apply(song([A, memo, range]));
    expect(s.markers).toEqual([A, { ...range, at: rat(1), end: rat(2) }]);
    // 범위 전체를 빼면 범위 메모도 지운다
    expect(deleteTime(rat(2), rat(2)).apply(song([range])).markers).toEqual([]);
    // 범위 가운데를 빼면 범위가 준다
    expect(deleteTime(rat(5, 2), rat(1)).apply(song([range])).markers[0]).toMatchObject({ at: rat(2), end: rat(3) });
  });

  it("마디 지우기 확인 창은 지워지는 안 끝낸 메모 수를 센다 (끝낸 메모·남는 범위 메모는 세지 않는다)", () => {
    const notes = parseTrackText("t1", { text: "c1c1c1c1c1c1" }).notes;
    const s: Song = {
      ...song([A, memo, { ...memo, id: "m4", done: true }, range]),
      players: [{ id: "p1", name: "피아노", instrument: { canonical: "piano" } }],
      tracks: [{ id: "t1", playerId: "p1", name: "t1", color: "#000", role: "free", mute: false, solo: false, notes, spelling: {} }],
    };
    // 2마디(온음표 1-2)를 지우면 메모(1)와 끝낸 메모는 지워지고, 범위 메모 [2, 4)는 남는다
    expect(checkDeleteBars(s, [[2, 2]]).memos).toBe(1);
    // 3-4마디(온음표 2-4)를 지우면 범위 메모 [2, 4)가 통째로 사라진다
    expect(checkDeleteBars(s, [[3, 4]]).memos).toBe(1);
    expect(checkDeleteBars(s, [[6, 6]]).memos).toBe(0);
    expect(lostOpenMemos(s, deleteTime(rat(1), rat(1)).apply(s))).toBe(1);
  });

  it("실제 시간 유지 템포 변환: 메모 자리와 끝을 음과 같이 옮긴다", () => {
    const parsed = parseTrackText("t1", { text: "t120 c4d4e4f4 g4a4b4>c4" });
    const base: Song = {
      ...song([{ id: "m1", at: rat(1, 2), end: rat(3, 2), label: "x", kind: "memo" }]),
      tempo: [{ at: rat(0), bpm: 120 }],
      players: [{ id: "p1", name: "피아노", instrument: { canonical: "piano" } }],
      tracks: [{ id: "t1", playerId: "p1", name: "t1", color: "#000", role: "free", mute: false, solo: false, notes: parsed.notes, spelling: {}, mml: { text: "t120 c4d4e4f4 g4a4b4>c4" } }],
    };
    const r = convertTempoResult(base, rat(2));
    expect(r.failed).toEqual([]);
    expect(r.song.markers[0]).toMatchObject({ at: rat(1), end: rat(3) });
  });
});

describe("악보책 나누기는 메모 자리를 마커 자리로 먼저 고르지 않는다", { timeout: 30_000 }, () => {
  it("구조 마커는 자르는 자리를 끌어오지만, 같은 자리의 메모는 결과를 바꾸지 않는다", () => {
    const melody = "t100 " + "cdefgab>c<".repeat(3) + "r4 " + "cegce".repeat(4) + "t90 " + "fedcba".repeat(3);
    const text = (s: Song) => s.tracks.map((t) => t.notes);
    const tracks = [melody, "o3 l2 " + "cgfg".repeat(6)].map((m, k) => ({ id: `t${k}`, playerId: "p1", name: `t${k}`, color: "#000", role: "free" as const, mute: false, solo: false, notes: parseTrackText(`t${k}`, { text: m }).notes, spelling: {} }));
    const base: Song = { ...song([]), players: [{ id: "p1", name: "피아노", instrument: { canonical: "piano" } }], tracks, tempo: [{ at: rat(0), bpm: 100 }] };
    expect(text(base)).toHaveLength(2);
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 40 };
    const ends = (s: Song) => splitSong(s, profile, { gapMs: null }).parts.map((p) => p.end);
    const plain = ends(base);
    // 마커가 자르는 자리를 바꾸는 자리를 찾는다 (4분음표 칸마다 시험)
    const spot = Array.from({ length: 40 }, (_, i) => rat(i + 1, 4)).find((at) => JSON.stringify(ends({ ...base, markers: [{ id: "m1", at, label: "B" }] })) !== JSON.stringify(plain));
    expect(spot).toBeDefined();
    expect(ends({ ...base, markers: [{ id: "m1", at: spot!, label: "다시 확인", kind: "memo" }] })).toEqual(plain);
  });
});
