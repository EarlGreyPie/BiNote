import { describe, expect, it } from "vitest";
import { cmp, emptySong, MOBILE_PROFILE, rat, type Player, type Song, type Track } from "@mmlce/core";
import { addTrack, mergeTracksResult, newSong, parseTrackText } from "@mmlce/mml";
import {
  defaultMergeRoles,
  defaultPriority,
  defaultSpreadSource,
  droppedBars,
  droppedListenStart,
  listenBarOf,
  mergeGroups,
  mergeListenSong,
  parseMergeLevel,
  parseMergePartial,
  pitchLabel,
} from "../src/lib/chordTools";

/** 피아노 악보에 트랙 셋 (t1 길게, t2 짧게, t3 중간) */
function song(): Song {
  let s = newSong({ playerName: "피아노", trackName: "트랙 1" });
  s = addTrack("p1", "트랙 2").apply(s);
  s = addTrack("p1", "트랙 3").apply(s);
  const texts: Record<string, string> = { t1: "o5 l16 " + "cdefgab>c<".repeat(20), t2: "o3 c1", t3: "o4 c16 d8 e16 f8. g16 a8 b16 >c8." };
  // 원문 없이 음만 (출력기가 쓴 글로 센다)
  return { ...s, tracks: s.tracks.map(({ mml: _mml, ...t }) => ({ ...t, notes: parseTrackText(t.id, { text: texts[t.id]! }).notes })) };
}

describe("화음 분산·병합 창 처음 값", () => {
  it("보내는 트랙: 준 트랙, 아니면 한도를 넘는 트랙, 없으면 가장 긴 트랙 (잠근 트랙 빼고)", () => {
    const s = song();
    expect(defaultSpreadSource(s, 2400, new Set(), "t3")).toBe("t3");
    expect(defaultSpreadSource(s, 2400, new Set())).toBe("t1");
    expect(defaultSpreadSource(s, 12, new Set(["t1"]))).toBe("t3");
    expect(defaultSpreadSource(s, 2400, new Set(["t1", "t2", "t3"]))).toBeUndefined();
  });

  it("병합 묶음은 같은 악보·같은 악기 잠그지 않은 트랙 둘 이상, 처음엔 음이 가장 적은 트랙을 비운다", () => {
    const s = song();
    expect(mergeGroups(s, MOBILE_PROFILE, new Set())).toEqual([["t1", "t2", "t3"]]);
    expect(mergeGroups(s, MOBILE_PROFILE, new Set(["t1", "t2"]))).toEqual([]);
    expect(defaultMergeRoles(s, ["t1", "t2", "t3"])).toEqual({ t1: "keep", t2: "remove", t3: "keep" });
    expect(defaultPriority(s, ["t1", "t2"])).toBeUndefined();
    const marked = { ...s, tracks: s.tracks.map((t) => (t.id === "t3" ? { ...t, role: "melody" as const } : t)) };
    expect(defaultPriority(marked, ["t1", "t2", "t3"])).toBe("t3");
  });

  it("단계 기억값과 음 이름", () => {
    expect(parseMergeLevel(null)).toBe(1);
    expect(parseMergeLevel("3")).toBe(3);
    expect(parseMergeLevel("9")).toBe(1);
    expect(pitchLabel(60)).toBe("o4c");
    expect(pitchLabel(73)).toBe("o5c+");
  });
});

describe("병합 칸 들어 보기", () => {
  const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };
  const flute: Player = { id: "p2", name: "플루트", instrument: { canonical: "flute" } };
  const tr = (id: string, text: string, extra: Partial<Track> = {}): Track => ({
    id,
    playerId: "p1",
    name: id,
    color: "#000",
    role: "free",
    mute: false,
    solo: false,
    notes: parseTrackText(id, { text }).notes,
    spelling: {},
    ...extra,
  });
  // a·b가 늘 울리고, c 첫 음(o5c)은 a o5c와 겹쳐 2단계에서 빠진다. d는 다른 악기 (묶음 밖)
  const base = (): Song => ({
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: [{ at: rat(0), bpm: 120 }, { at: rat(2), bpm: 90 }],
    players: [piano, flute],
    tracks: [tr("a", "o5 c4 c4 d4 d4 e4 e4 f4 f4", { mute: true }), tr("b", "o4 c2 d2 e2 f2"), tr("c", "o5 c4&c4"), tr("d", "o6 c1", { playerId: "p2", solo: true })],
  });
  const opts = { keep: ["a", "b"], remove: ["c"], level: 2 as const };
  const key = (s: Song) => s.tracks.flatMap((t) => t.notes.map((n) => `${t.id}:${n.start.n}/${n.start.d}:${n.pitch}:${n.dur.n}/${n.dur.d}`)).sort();

  it("빠지는 음만: 원래 트랙에 원래 v·&묶음 그대로, 묶음 밖 트랙은 빼고 끄기·솔로를 푼다. 원래 곡은 바뀌지 않는다", () => {
    const s = base();
    const before = JSON.stringify(s);
    const r = mergeTracksResult(s, MOBILE_PROFILE, opts);
    expect(r.dropped.map((d) => d.trackId)).toEqual(["c", "c"]);
    const only = mergeListenSong(s, r, ["a", "b", "c"], "dropped", false);
    expect(only.tracks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(only.tracks.map((t) => t.notes.length)).toEqual([0, 0, 2]);
    expect(only.tracks.every((t) => !t.mute && !t.solo)).toBe(true);
    expect(only.tracks.find((t) => t.id === "c")!.notes.map((n) => [n.tie, n.vol])).toEqual([["next", 8], ["none", 8]]);
    expect(only.tempo).toBe(s.tempo);
    expect(only.timeSig).toBe(s.timeSig);
    expect(only.players).toBe(s.players);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("병합 전·후: 이 트랙들만이면 묶음 트랙만 끄기·솔로를 풀어서, 끄면 곡 그대로", () => {
    const s = base();
    const r = mergeTracksResult(s, MOBILE_PROFILE, opts);
    expect(mergeListenSong(s, r, ["a", "b", "c"], "before", false)).toBe(s);
    expect(mergeListenSong(s, r, ["a", "b", "c"], "after", false)).toBe(r.song);
    const before = mergeListenSong(s, r, ["a", "b", "c"], "before", true);
    expect(before.tracks.map((t) => [t.id, t.mute, t.solo])).toEqual([["a", false, false], ["b", false, false], ["c", false, false]]);
    const after = mergeListenSong(s, r, ["a", "b", "c"], "after", true);
    expect(after.tracks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(after.tempo).toEqual(s.tempo);
  });

  it("병합 후에 빠지는 음만을 더하면 음 자리가 병합 전과 같다 (v 올림은 빼고 비교)", () => {
    const s = base();
    const r = mergeTracksResult(s, MOBILE_PROFILE, opts);
    const group = ["a", "b", "c"];
    const after = mergeListenSong(s, r, group, "after", true);
    const only = mergeListenSong(s, r, group, "dropped", true);
    const before = mergeListenSong(s, r, group, "before", true);
    const pos = (x: Song[]) => x.flatMap((y) => y.tracks.flatMap((t) => t.notes.map((n) => `${n.start.n}/${n.start.d}:${n.pitch}:${n.dur.n}/${n.dur.d}`))).sort();
    expect(pos([after, only])).toEqual(pos([before]));
    expect(key(only)).toEqual(["c:0/1:72:1/4", "c:1/4:72:1/4"]);
  });

  it("마디 구간: 같은 마디 음은 한 구간, 마디선을 넘는 음은 끝 마디까지, 마디선에서 끝나면 그 마디까지", () => {
    const s: Song = { ...base(), tempo: [{ at: rat(0), bpm: 60 }] };
    const at = (n: number, d = 1) => rat(n, d);
    const note = (start: ReturnType<typeof rat>, dur: ReturnType<typeof rat>) => ({ start, dur, pitch: 60, vol: 8, tie: "none" as const, id: "n" });
    const bars = droppedBars(s, [note(at(0), at(1, 4)), note(at(1, 2), at(1, 4)), note(at(5, 2), at(1)), note(at(4), at(1))]);
    expect(bars.map((b) => [b.bar, b.lastBar])).toEqual([[1, 1], [3, 4], [5, 5]]);
    // 4/4 t60 한 마디 = 4초라 앞 마디를 붙이지 않는다
    expect(cmp(bars[1]!.from, at(2))).toBe(0);
    expect(cmp(bars[1]!.to, at(4))).toBe(0);
    expect(listenBarOf(bars, s, note(at(9, 4), at(1, 8)))).toBe(1);
    expect(listenBarOf(bars, s, note(at(1), at(1, 8)))).toBe(-1);
  });

  it("마디 구간이 2초보다 짧으면 앞 마디 하나를 더 붙인다 (첫 마디는 그대로). 박자가 바뀌는 곡도 마디대로", () => {
    // t240 4/4 한 마디 = 1초. 3마디부터 3/4
    const s: Song = { ...base(), tempo: [{ at: rat(0), bpm: 240 }], timeSig: [{ at: rat(0), beats: 4, unit: 4 }, { at: rat(2), beats: 3, unit: 4 }] };
    const note = (start: ReturnType<typeof rat>) => ({ start, dur: rat(1, 8), pitch: 60, vol: 8, tie: "none" as const, id: "n" });
    const bars = droppedBars(s, [note(rat(0)), note(rat(5, 2))]);
    expect(bars.map((b) => b.bar)).toEqual([1, 3]);
    expect(cmp(bars[0]!.from, rat(0))).toBe(0);
    // 3마디(3/4, 2~2.75)는 0.75초라 2마디 시작(1)부터
    expect(cmp(bars[1]!.from, rat(1))).toBe(0);
    expect(cmp(bars[1]!.to, rat(11, 4))).toBe(0);
  });

  it("빠지는 음만 시작 자리: 커서 뒤 첫 빠지는 음의 마디 첫머리, 없으면 첫 빠지는 음의 마디", () => {
    const s = base();
    const note = (start: ReturnType<typeof rat>) => ({ start, dur: rat(1, 8), pitch: 60, vol: 8, tie: "none" as const, id: "n" });
    const notes = [note(rat(9, 4)), note(rat(1, 4))];
    expect(droppedListenStart(s, notes, undefined)).toEqual(rat(0));
    expect(droppedListenStart(s, notes, rat(1, 2))).toEqual(rat(2));
    expect(droppedListenStart(s, notes, rat(3))).toEqual(rat(0));
    expect(droppedListenStart(s, [], rat(3))).toBeUndefined();
  });

  it("몰기 기억 값은 1일 때만 켬", () => {
    expect(parseMergePartial("1")).toBe(true);
    expect(parseMergePartial("0")).toBe(false);
    expect(parseMergePartial(null)).toBe(false);
  });
});
