import { describe, expect, it } from "vitest";
import { breakTimbreTies, defaultLengthLimit, History, MOBILE_PROFILE, planSlides, rat, type Note, type Song } from "@mmlce/core";
import { addTrack, newSong, setTracksNotes } from "@mmlce/mml";
import { DEFAULT_SLIDE, parseSlideChoice, parseSlideMade, tabSlidePick } from "../src/lib/slideOptions";
import { pickedTracks as slideTracks, pickedWithout as slidePicked } from "../src/lib/pickLines";
import { madeCommand } from "@mmlce/mml";
import { newUnwritableTrack } from "../src/lib/writable";

describe("슬라이드 창 저장값", () => {
  it("없거나 모르는 값이면 기본(두 음 사이·반음씩·아래 2반음·16분·박 위·음색 경계에서 끊기·자동 걸음)", () => {
    expect(parseSlideChoice(undefined)).toEqual(DEFAULT_SLIDE);
    expect(DEFAULT_SLIDE.breakAtZones).toBe(true);
    expect(parseSlideChoice({ kind: "x", semitones: 13, length: "grid", step: "7", timing: "late", breakAtZones: "no", outSemitones: 0 })).toEqual(DEFAULT_SLIDE);
  });
  it("아는 값은 그대로", () => {
    const v = { kind: "both", path: "direct", direction: "up", semitones: 5, length: "32.", outDirection: "up", outSemitones: 3, outLength: "64", timing: "before", breakAtZones: false, step: "64" };
    expect(parseSlideChoice(v)).toEqual(v);
  });
  it("예전 저장값(나가는 쪽·박 앞·끊기 없음)은 기본으로 채운다", () => {
    const old = parseSlideChoice({ kind: "out", path: "direct", direction: "up", semitones: 5, length: "32.", step: "64" });
    expect([old.kind, old.semitones, old.timing, old.breakAtZones, old.outSemitones]).toEqual(["out", 5, "on", true, 2]);
  });
});

describe("타브에서 고른 음 없이 열 때 (커서 자리 화음 전체)", () => {
  const n = (id: string, at: number, pitch: number): Note => ({ id, start: rat(at, 4), dur: rat(1, 4), pitch, vol: 10, tie: "none" });
  const tr = (id: string, playerId: string, notes: Note[], mute = false) => ({ id, playerId, notes, mute });
  const song = { tracks: [tr("t1", "p1", [n("a", 0, 60), n("b", 1, 62)]), tr("t2", "p1", [n("c", 0, 55)]), tr("t3", "p1", [n("d", 0, 50)], true), tr("t4", "p2", [n("e", 0, 40)])] } as unknown as Pick<Song, "tracks">;
  it("같은 악보의 소리 나는 트랙에서 커서 자리에 시작하는 음 모두", () => {
    expect(tabSlidePick(song, "t2", rat(0)).map((x) => x.id)).toEqual(["a", "c"]);
    expect(tabSlidePick(song, "t1", rat(1, 4)).map((x) => x.id)).toEqual(["b"]);
    expect(tabSlidePick(song, "t1", undefined)).toEqual([]);
  });
});

describe("슬라이드·음색 경계 끊기는 실행 취소 기록 한 곳을 지나 한 번에 되돌린다", () => {
  const note = (id: string, start: [number, number], dur: [number, number], pitch: number, tie: Note["tie"] = "none"): Note => ({ id, start: rat(...start), dur: rat(...dur), pitch, vol: 8, tie });
  function twoTracks(t1: Note[], t2: Note[]): Song {
    const s = addTrack("p1", "트랙 2").apply(newSong({ playerName: "기타", trackName: "트랙 1" }));
    return { ...s, tracks: s.tracks.map((x) => ({ ...x, notes: x.id === "t1" ? t1 : t2 })) };
  }
  let seq = 0;
  const guarded = (s: Song) => new History(s, (before, after) => newUnwritableTrack(before, after, defaultLengthLimit()) === undefined);
  it("화음으로 들어가기: 두 트랙이 한 칸으로 바뀌고 실행 취소 한 번에 원래 곡", () => {
    const s = twoTracks([note("a", [0, 1], [1, 4], 60)], [note("b", [0, 1], [1, 4], 55)]);
    const h = guarded(s);
    const r = planSlides(s, s.tracks.flatMap((x) => x.notes), { kind: "in", path: "chromatic", direction: "down", semitones: 2, length: rat(1, 16), instrumentOf: () => "folk-guitar", breakAtZones: true }, MOBILE_PROFILE, (id) => `${id}.x${++seq}`);
    h.run(setTracksNotes(r.changes, "슬라이드"));
    expect(h.refused).toBe(false);
    expect(h.song.tracks.map((x) => x.notes.length)).toEqual([3, 3]);
    h.undo();
    expect(h.song).toBe(s);
  });
  it("모두 끊기: 경계를 넘는 &만 빠지고 실행 취소로 돌아온다", () => {
    const s = twoTracks([note("a", [0, 1], [1, 8], 63, "next"), note("b", [1, 8], [1, 8], 64)], []);
    const h = guarded(s);
    const fixed = breakTimbreTies(s, MOBILE_PROFILE, () => "folk-guitar");
    h.run(setTracksNotes(fixed.changes, "끊기"));
    expect(h.song.tracks[0]!.notes.map((x) => x.tie)).toEqual(["none", "none"]);
    h.undo();
    expect(h.song).toBe(s);
  });
});

describe("슬라이드 미끄러질 줄(트랙) 고르기", () => {
  const note = (id: string, start: [number, number], dur: [number, number], pitch: number): Note => ({ id, start: rat(...start), dur: rat(...dur), pitch, vol: 8, tie: "none" });
  function chord(): Song {
    const s = addTrack("p1", "트랙 2").apply(addTrack("p1", "트랙 3").apply(newSong({ playerName: "기타", trackName: "트랙 1" })));
    const by: Record<string, Note[]> = {
      t1: [note("a", [0, 1], [1, 4], 64)],
      t2: [note("b", [0, 1], [1, 4], 60)],
    };
    return { ...s, tracks: s.tracks.map((x, i) => ({ ...x, notes: by[x.id] ?? [note(`c${i}`, [0, 1], [1, 4], 55)] })) };
  }
  const opts = { kind: "in" as const, path: "chromatic" as const, direction: "down" as const, semitones: 2, length: rat(1, 16), instrumentOf: () => "folk-guitar", breakAtZones: true };
  it("고른 음이 든 트랙만 곡 순서로", () => {
    const s = chord();
    const all = s.tracks.flatMap((x) => x.notes);
    expect(slideTracks(s, all).map((x) => x.id)).toEqual(s.tracks.map((x) => x.id));
    expect(slideTracks(s, [all[1]!]).map((x) => x.id)).toEqual([s.tracks[1]!.id]);
  });
  it("뺀 트랙의 음은 고른 음에서 빠지고, 빼지 않으면 그대로", () => {
    const s = chord();
    const all = s.tracks.flatMap((x) => x.notes);
    expect(slidePicked(s, all, new Set())).toEqual(all);
    expect(slidePicked(s, all, new Set([s.tracks[1]!.id])).map((x) => x.id)).toEqual(all.filter((n) => n.id !== "b").map((x) => x.id));
  });
  it("뺀 줄은 그대로 두고 고른 줄만 미끄러진다 (실행 취소 한 번에 원래 곡, 만든 기록에 뺀 트랙이 남는다)", () => {
    const s = chord();
    const all = s.tracks.flatMap((x) => x.notes);
    const off = s.tracks[1]!.id;
    const h = new History(s, (before, after) => newUnwritableTrack(before, after, defaultLengthLimit()) === undefined);
    let k = 0;
    const r = planSlides(s, slidePicked(s, all, new Set([off])), opts, MOBILE_PROFILE, (id) => `${id}.x${++k}`);
    expect(r.changes.map((c) => c.trackId)).not.toContain(off);
    expect(r.made).toBe(s.tracks.length - 1);
    const options = { choice: DEFAULT_SLIDE, strings: [], excluded: [off] };
    h.run(madeCommand(setTracksNotes(r.changes, "슬라이드"), { tool: "slide", options, picked: all.map((n) => n.id) }));
    expect(h.refused).toBe(false);
    expect(h.song.tracks.find((x) => x.id === off)!.notes).toBe(s.tracks[1]!.notes);
    expect(h.song.tracks.filter((x) => x.id !== off).every((x) => x.notes.length === 3)).toBe(true);
    const record = h.song.made!.at(-1)!;
    expect(record.picked).toEqual(all.map((n) => n.id));
    expect(parseSlideMade(record.options).excluded).toEqual([off]);
    h.undo();
    expect(h.song).toBe(s);
  });
  it("옛 기록(뺀 트랙 없음)은 모두 미끄러지게 읽는다", () => {
    expect(parseSlideMade({ choice: {}, strings: [] }).excluded).toEqual([]);
    expect(parseSlideMade({ excluded: ["t2", 3, null] }).excluded).toEqual(["t2"]);
  });
});
