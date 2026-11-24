import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, type Player, type Song, type Track } from "@mmlce/core";
import { gameTimeline, mergeTies, mergeTracksResult, mergeTracksSong, parseTrackText, planTrackMerge } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };

function track(id: string, text: string, extra: Partial<Track> = {}): Track {
  return { id, playerId: "p1", name: id, color: "#000", role: "free", mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {}, ...extra };
}

function song(tracks: Track[]): Song {
  return { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [piano], tracks };
}

const sound = (s: Song) =>
  s.tracks
    .flatMap((t) => mergeTies(t.notes).map((n) => `${n.start.n}/${n.start.d}:${n.pitch}:${n.dur.n}/${n.dur.d}:${n.vol}`))
    .sort();

// 위: 2박마다 쉰다. 가운데: 계속 울린다. 조각: 위가 쉬는 자리에만 음
const top = "o5 c4 d4 r2 e4 f4 r2";
const middle = "o4 c2 d2 e2 f2";
const pieces = "r2 o5 e4 r4 r2 g4 r4";

describe("planTrackMerge 1단계 (음을 빼지 않음)", () => {
  it("비울 트랙의 음을 쉬는 트랙으로 옮기고 지운다", () => {
    const s = song([track("a", top), track("b", middle), track("c", pieces)]);
    const r = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 1 });
    expect(r.kept).toBeUndefined();
    expect(r.emptied).toEqual(["c"]);
    expect(r.dropped).toEqual([]);
    expect(r.moved).toBe(2);
    expect(r.song.tracks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(sound(r.song)).toEqual(sound(s));
  });

  it("자리가 모자라면 그 트랙은 그대로 두고 넣지 못한 음 수를 알린다", () => {
    // 조각 첫 음이 위·가운데 모두 울리는 자리에 있다
    const s = song([track("a", top), track("b", middle), track("c", "o5 g4 r4 r2 r2 g4 r4")]);
    const r = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 1 });
    expect(r.emptied).toEqual([]);
    expect(r.stuck).toEqual([{ trackId: "c", left: 1 }]);
    expect(r.song).toBe(s);
  });
});

describe("2단계 (겹친 음만 뺌)", () => {
  // 비울 트랙: 첫 음은 가운데 트랙 o4c와 옥타브 겹침(o5c), 둘째 음은 겹치지 않는 o5g. 둘 다 받을 자리가 없다
  const busy = "o5 c4 c4 d4 d4 e4 e4 f4 f4";
  it("다른 트랙에서 같은 음 이름이 울리는 음만 뺀다", () => {
    const s = song([track("a", busy), track("b", middle), track("c", "o5 c4")]);
    const r = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 2 });
    expect(r.emptied).toEqual(["c"]);
    expect(r.dropped.map((d) => d.note.pitch)).toEqual([72]);
    expect(r.dropped[0]!.trackId).toBe("c");
  });

  it("화음 음이 빠지면 같은 자리에서 함께 치던 같은 손의 남은 음 v를 올려 화음 크기를 맞춘다", () => {
    // 0박: a o5c(v8)·c o5c(v8)가 오른손 두 음, b o4c는 왼손. c를 빼면 오른손이 두 음 → 한 음: v8 → v10 (3 dB)
    const s = song([track("a", busy), track("b", middle), track("c", "o5 c4")]);
    const r = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 2 });
    expect(r.louder?.map((x) => [x.note.pitch, x.note.vol, x.vol])).toEqual([[72, 8, 10]]);
    const a = r.song.tracks.find((t) => t.id === "a")!;
    expect(a.notes.map((n) => n.vol)).toEqual([10, 8, 8, 8, 8, 8, 8, 8]);
    // 왼손(b)은 그대로
    expect(r.song.tracks.find((t) => t.id === "b")!.notes.every((n) => n.vol === 8)).toBe(true);
    // 잠근 트랙 음은 v를 바꾸지 않는다
    const lockedA = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 2 }, new Set(["a"]));
    expect(lockedA.louder ?? []).toEqual([]);
  });

  it("v를 올린 트랙이 원문 끝 쉼표로 길이를 지키고 있어도 거절하지 않는다", () => {
    const s = song([track("a", `${busy} r1r1`, { mml: { text: `${busy} r1r1` } }), track("b", middle), track("c", "o5 c4")]);
    const r = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 2 });
    expect(r.kept).toBeUndefined();
    expect(r.louder?.map((x) => x.vol)).toEqual([10]);
    // 악보 끝(원문 끝 쉼표로 지킨 길이)이 병합 전과 같다
    const end = (x: Song) => gameTimeline(x, MOBILE_PROFILE).split("\n")[0]!.split(" ").pop();
    expect(end(r.song)).toBe(end(s));
  });

  it("겹치지 않는 음은 남길 트랙의 겹친 음을 대신 빼고 넣는다. 그런 음도 없으면 그대로 둔다", () => {
    // o5g는 겹치지 않는다. 그 자리 a의 o5c는 b의 o4c와 옥타브로 겹치니 그 음을 대신 뺀다
    const s = song([track("a", busy), track("b", middle), track("c", "o5 g4")]);
    const r = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 2 });
    expect(r.emptied).toEqual(["c"]);
    expect(r.dropped.map((d) => [d.trackId, d.note.pitch])).toEqual([["a", 72]]);
    // a가 o5d(겹치지 않음)를 내는 자리면 뺄 음이 없다
    const s2 = song([track("a", "o5 d4 c4 d4 d4 e4 e4 f4 f4"), track("b", middle), track("c", "o5 g4")]);
    const r2 = mergeTracksResult(s2, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 2 });
    expect(r2.emptied).toEqual([]);
    expect(r2.stuck).toEqual([{ trackId: "c", left: 1 }]);
    expect(r2.song).toBe(s2);
  });
});

describe("3단계 (자리 없는 음은 뺌, 바깥 음 지킴)", () => {
  it("가운데 음은 빼고, 맨 위 음이면 남길 트랙의 가운데 음을 대신 뺀다", () => {
    // a: o5c(위), b: o3c(아래), c: o4e(가운데) → c는 그냥 뺀다
    const inner = song([track("a", "o5 c1"), track("b", "o3 c1"), track("c", "o4 e1")]);
    const r = mergeTracksResult(inner, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 3 });
    expect(r.emptied).toEqual(["c"]);
    expect(r.dropped.map((d) => d.note.pitch)).toEqual([64]);

    // a: o4e(가운데), b: o3c(아래), c: o5g(맨 위) → a의 가운데 음을 빼고 c를 a에 넣는다
    const outer = song([track("a", "o4 e1"), track("b", "o3 c1"), track("c", "o5 g1")]);
    const r2 = mergeTracksResult(outer, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 3 });
    expect(r2.emptied).toEqual(["c"]);
    expect(r2.dropped.map((d) => [d.trackId, d.note.pitch])).toEqual([["a", 64]]);
    expect(r2.song.tracks.find((t) => t.id === "a")!.notes.map((n) => n.pitch)).toEqual([79]);
  });

  it("우선 트랙 음은 빼지 않는다: 가운데 음이라도 다른 트랙 음을 대신 뺀다", () => {
    const s = song([track("a", "o5 c1"), track("b", "o4 c1"), track("m", "o4 g1"), track("d", "o3 c1")]);
    // m(가운데 o4g)을 비우면서 우선 → 가운데인 b(o4c)를 빼고 들어간다
    const r = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b", "d"], remove: ["m"], level: 3, priority: "m" });
    expect(r.emptied).toEqual(["m"]);
    expect(r.dropped.map((d) => [d.trackId, d.note.pitch])).toEqual([["b", 60]]);
    // 우선 트랙이 남길 트랙이면 그 음은 대신 빼지 않는다
    const r2 = planTrackMerge(s, { keep: ["a", "b", "d"], remove: ["m"], level: 3, priority: "b" });
    expect(r2.dropped.map((d) => d.trackId)).toEqual(["m"]);
  });

  it("게임 출력은 원래 곡에서 뺀 음만 지우고 남은 화음 v를 다시 맞춘 것과 같다", () => {
    const s = song([track("a", "o5 c2 d2 e2 f2"), track("b", "o3 c1 c1"), track("c", "o4 e4 g4 e4 g4 e4 g4 e4 g4")]);
    const r = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 3 });
    expect(r.kept).toBeUndefined();
    expect(r.dropped.length).toBe(8);
    const gone = new Set(r.dropped.map((d) => d.note));
    const louder = new Map((r.louder ?? []).map((x) => [x.note, x.vol]));
    // 0·1 자리(b o3c가 함께 시작)에서 a의 위 음과 c의 가운데 음이 오른손 두 음이었다: c를 빼면 a 음 v8 → v10.
    // 1/2·3/2 자리는 a 음과 c 음이 10반음 넘게 떨어져 다른 손으로 본다
    expect([...louder.values()]).toEqual([10, 10]);
    const expected = {
      ...s,
      tracks: s.tracks.filter((t) => t.id !== "c").map((t) => ({ ...t, notes: t.notes.filter((n) => !gone.has(n)).map((n) => ({ ...n, vol: louder.get(n) ?? n.vol })) })),
    };
    expect(gameTimeline(r.song, MOBILE_PROFILE)).toBe(gameTimeline(expected, MOBILE_PROFILE));
  });
});

describe("mergeTracksSong", () => {
  it("잠근 트랙은 비우지도 받지도 않고, 실행 취소하면 앞 곡", () => {
    const s = song([track("a", top), track("b", middle), track("c", pieces)]);
    const locked = new Set(["c"]);
    expect(mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 3 }, locked).song).toBe(s);
    const command = mergeTracksSong(MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 1 });
    const after = command.apply(s);
    expect(after.tracks).toHaveLength(2);
    expect(command.invert(s).apply(after)).toBe(s);
  });
});

describe("트랙은 남기고 옮길 수 있는 음만 몰기 (partial)", () => {
  // 조각 첫 음(o5g)은 위·가운데 모두 울리는 자리라 못 넣고, 셋째 음(o5g, 6박)은 위가 쉬는 자리라 넣을 수 있다
  const stuckFirst = "o5 g4 r4 r2 r2 g4 r4";

  it("자리가 있는 음은 옮기고 못 넣은 음은 그 트랙에 남긴다. 트랙은 지우지 않고 소리는 그대로", () => {
    const s = song([track("a", top), track("b", middle), track("c", stuckFirst)]);
    const r = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 1, partial: true });
    expect(r.kept).toBeUndefined();
    expect(r.emptied).toEqual([]);
    expect(r.partial).toEqual(["c"]);
    expect(r.stuck).toEqual([{ trackId: "c", left: 1 }]);
    expect(r.moved).toBe(1);
    expect(r.dropped).toEqual([]);
    expect(r.song.tracks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(r.song.tracks.find((t) => t.id === "c")!.notes.map((n) => n.pitch)).toEqual([79]);
    // 음 수 합과 소리(음 자리·높이·길이·v)가 같다
    expect(sound(r.song)).toEqual(sound(s));
    expect(gameTimeline(r.song, MOBILE_PROFILE)).toBe(gameTimeline(s, MOBILE_PROFILE));
  });

  it("끄면 지금과 같다 (그 트랙 몫을 모두 되돌린다)", () => {
    const s = song([track("a", top), track("b", middle), track("c", stuckFirst)]);
    const off = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 1, partial: false });
    expect(off.song).toBe(s);
    expect(off.partial).toEqual([]);
    expect(off.stuck).toEqual([{ trackId: "c", left: 1 }]);
  });

  it("옮길 음이 하나도 없으면 곡은 그대로", () => {
    const s = song([track("a", "o5 c1 c1"), track("b", "o4 c1 c1"), track("c", "o5 g1")]);
    const r = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 1, partial: true });
    expect(r.song).toBe(s);
    expect(r.partial).toEqual([]);
    expect(r.moved).toBe(0);
  });

  it("다 비울 수 있는 트랙은 지금처럼 지운다", () => {
    const s = song([track("a", top), track("b", middle), track("c", pieces)]);
    const r = mergeTracksResult(s, MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 1, partial: true });
    expect(r.emptied).toEqual(["c"]);
    expect(r.partial).toEqual([]);
    expect(r.song.tracks.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("&로 이은 묶음은 통째로 옮기거나 통째로 남긴다", () => {
    // 첫 묶음(o5g4&g4)은 위가 쉬지 않아 못 넣고, 뒤 묶음(6박 o5g8&g8)은 위가 쉬는 자리라 통째로 옮긴다
    const s = song([track("a", top), track("b", middle), track("c", "o5 g4&g4 r2 r2 g8&g8 r4")]);
    const plan = planTrackMerge(s, { keep: ["a", "b"], remove: ["c"], level: 1, partial: true });
    expect(plan.partial).toEqual(["c"]);
    expect(plan.stuck).toEqual([{ trackId: "c", left: 2 }]);
    expect(plan.moved).toBe(2);
    expect(plan.song.tracks.find((t) => t.id === "c")!.notes).toHaveLength(2);
  });

  it("실행 명령으로 적용해도 같은 결과", () => {
    const s = song([track("a", top), track("b", middle), track("c", stuckFirst)]);
    const next = mergeTracksSong(MOBILE_PROFILE, { keep: ["a", "b"], remove: ["c"], level: 1, partial: true }).apply(s);
    expect(next.tracks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(sound(next)).toEqual(sound(s));
  });
});
