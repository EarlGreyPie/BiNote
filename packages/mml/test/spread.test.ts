import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, rat, type Player, type Song, type Track } from "@mmlce/core";
import {
  autoSpreadSpans,
  barStarts,
  findSpreadSpans,
  gameTimeline,
  mergeTies,
  optimizeMml,
  parseTrackText,
  spreadCandidates,
  spreadResult,
  spreadSong,
  swapSpans,
  trackSource,
} from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };

function track(id: string, text: string, extra: Partial<Track> = {}): Track {
  return { id, playerId: "p1", name: id, color: "#000", role: "free", mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {}, ...extra };
}

function song(tracks: Track[]): Song {
  return { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [piano], tracks };
}

/** 모든 트랙의 음을 (시작, 높이, 길이, v)로 모은 것. 분산해도 같아야 한다 */
const sound = (s: Song) =>
  s.tracks
    .flatMap((t) => mergeTies(t.notes).map((n) => `${n.start.n}/${n.start.d}:${n.pitch}:${n.dur.n}/${n.dur.d}:${n.vol}`))
    .sort();

// 선율: 4마디 내내 8분음표. 반주: 1·2마디만 울리고 3·4마디는 쉰다
const melody = "o5 l8 cdefgab>c< cdefgab>c< cdefgab>c< cdefgab>c<";
const accomp = "o3 c1 g1 r1 r1";

describe("barStarts", () => {
  it("박자가 바뀌면 그 자리에서 새 마디를 센다", () => {
    expect(barStarts([], rat(2))).toEqual([rat(0), rat(1)]);
    expect(barStarts([{ at: rat(0), beats: 3, unit: 4 }, { at: rat(3, 2), beats: 4, unit: 4 }], rat(3))).toEqual([rat(0), rat(3, 4), rat(3, 2), rat(5, 2)]);
  });
});

describe("findSpreadSpans (빈 곳 찾기)", () => {
  it("받는 트랙이 쉬는 마디를 구간으로 내고, 비어 있는 구간이 앞에 온다", () => {
    const s = song([track("a", melody), track("b", accomp)]);
    const spans = findSpreadSpans(s, "a", ["b"]);
    expect(spans.length).toBeGreaterThan(0);
    const empty = spans[0]!;
    expect(empty.take).toBe(0);
    expect(empty.bars).toEqual([3, 4]);
    expect(empty.give).toBe(16);
    // 반주가 한 음씩 있는 1·2마디는 맞바꾸는 구간
    const swap = spans.find((x) => x.take > 0)!;
    expect(swap.bars).toEqual([1, 2]);
    expect(swap.take).toBe(2);
  });

  it("마디선을 걸치는 음이나 &로 이은 묶음이 있으면 그 마디선에서 자르지 않는다", () => {
    // 반주의 2마디 끝 음이 3마디로 이어진다 (& 묶음)
    const s = song([track("a", melody), track("b", "o3 r1 r2 c2& c4 r4 r2 r1")]);
    const spans = findSpreadSpans(s, "a", ["b"]);
    for (const x of spans) expect(x.bars[0] === 3 || x.bars[1] === 2).toBe(false);
    // 선율의 긴 음이 마디선을 걸쳐도 마찬가지
    const s2 = song([track("a", "o5 c2 d1 e2 f1"), track("b", "r1 r1 r1")]);
    expect(findSpreadSpans(s2, "a", ["b"]).every((x) => x.bars[0] !== 2 && x.bars[0] !== 3)).toBe(true);
  });

  it("다른 악기·잠근 트랙은 받을 수 없다", () => {
    const s = song([track("a", melody), track("b", accomp), track("c", accomp, { instrument: { canonical: "flute" } }), track("d", accomp)]);
    expect(spreadCandidates(s, MOBILE_PROFILE, "a", new Set(["d"]))).toEqual([{ trackId: "b" }, { trackId: "c", block: "sound" }, { trackId: "d", block: "locked" }]);
  });
});

describe("spreadResult (구간 맞바꾸기)", () => {
  it("고른 구간의 음을 맞바꾸고 소리·게임 출력은 그대로", () => {
    const s = song([track("a", melody), track("b", accomp)]);
    const spans = findSpreadSpans(s, "a", ["b"]);
    const r = spreadResult(s, MOBILE_PROFILE, "a", [spans[0]!]);
    expect(r.kept).toBeUndefined();
    expect(r.moved).toBe(16);
    expect(sound(r.song)).toEqual(sound(s));
    expect(gameTimeline(r.song, MOBILE_PROFILE)).toBe(gameTimeline(s, MOBILE_PROFILE));
    expect(r.song.tracks[0]!.notes.length).toBe(16);
    expect(r.song.tracks[1]!.notes.length).toBe(18);
    expect(trackSource(r.song, r.song.tracks[0]!).text.length).toBeLessThan(trackSource(s, s.tracks[0]!).text.length);
  });

  it("맞바꾸는 구간은 받는 트랙 음이 보내는 트랙으로 간다", () => {
    const s = song([track("a", melody), track("b", accomp)]);
    const swap = findSpreadSpans(s, "a", ["b"]).find((x) => x.take > 0)!;
    const r = swapSpans(s, "a", [swap]);
    expect(r.moved).toBe(18);
    expect(r.song.tracks[0]!.notes.map((n) => n.pitch).slice(0, 2)).toEqual([48, 55]);
    expect(sound(r.song)).toEqual(sound(s));
  });

  it("시간이 겹치는 구간은 앞 것만 쓴다", () => {
    const s = song([track("a", melody), track("b", accomp), track("c", "r1 r1 r1 r1")]);
    const spans = findSpreadSpans(s, "a", ["b", "c"]);
    const toB = spans.find((x) => x.targetId === "b" && x.take === 0)!;
    const toC = spans.find((x) => x.targetId === "c" && x.bars[0] <= 3 && x.bars[1] >= 3)!;
    const r = swapSpans(s, "a", [toB, toC]);
    expect(r.song.tracks.find((t) => t.id === "c")!.notes.length).toBe(0);
  });

  it("명령은 실행 취소하면 앞 곡으로 돌아간다", () => {
    const s = song([track("a", melody), track("b", accomp)]);
    const spans = findSpreadSpans(s, "a", ["b"]);
    const command = spreadSong(MOBILE_PROFILE, "a", [spans[0]!]);
    const after = command.apply(s);
    expect(after).not.toBe(s);
    expect(command.invert(s).apply(after)).toBe(s);
  });

  it("잠근 트랙은 글을 다시 쓰지 않는다", () => {
    const s = song([track("a", melody), track("b", accomp), track("z", "o4   c1", { mml: { text: "o4   c1" } })]);
    const spans = findSpreadSpans(s, "a", ["b"]);
    const r = spreadResult(s, MOBILE_PROFILE, "a", [spans[0]!], new Set(["z"]));
    expect(r.song.tracks[2]).toBe(s.tracks[2]);
  });
});

describe("autoSpreadSpans (넘친 만큼 자동으로 고르기)", () => {
  it("보내는 트랙이 한도 안에 들 만큼 구간을 고른다", () => {
    const long = Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? "o5 l16 cdefgab>c<bagfedcd" : "o4 l16 cegb>dfa>c<<afdb<gec")).join(" ");
    const s = song([track("a", long), track("b", "o3 c1 r1 r1 r1 c1 r1 r1 r1")]);
    const size = optimizeMml(s.tracks[0]!.notes).text.length;
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: Math.floor(size * 0.6) };
    const spans = findSpreadSpans(s, "a", ["b"]);
    const picked = autoSpreadSpans(s, profile, "a", spans);
    expect(picked.length).toBeGreaterThan(0);
    const r = spreadResult(s, profile, "a", picked);
    expect(sound(r.song)).toEqual(sound(s));
    for (const t of r.song.tracks) expect(trackSource(r.song, t).text.length).toBeLessThanOrEqual(profile.charLimitPerScore);
  });

  it("넘치지 않으면 고르지 않는다", () => {
    const s = song([track("a", melody), track("b", accomp)]);
    expect(autoSpreadSpans(s, MOBILE_PROFILE, "a", findSpreadSpans(s, "a", ["b"]))).toEqual([]);
  });
});

describe("다시 쓰는 편집에서 실험실 표시를 지킨다", () => {
  it("화음 분산으로 옮긴 음과 그대로 둔 음 모두 실험실 표시(고스트·하모닉스)가 남는다", () => {
    const a = track("a", melody);
    const marked = a.notes.map((n, k) =>
      k === 3 ? { ...n, lab: { kind: "ghost" as const, vol: 8 } } : k === 20 ? { ...n, lab: { kind: "harmonic" as const, type: "artificial" as const, pitch: n.pitch - 12, vol: 8 } } : n,
    );
    const s = song([{ ...a, notes: marked }, track("b", accomp)]);
    const span = findSpreadSpans(s, "a", ["b"]).find((x) => x.take === 0)!;
    const r = spreadResult(s, MOBILE_PROFILE, "a", [span]);
    expect(r.moved).toBeGreaterThan(0);
    const labs = r.song.tracks.flatMap((t) => t.notes.filter((n) => n.lab).map((n) => `${t.id}:${n.start.n}/${n.start.d}:${n.lab!.kind}`));
    const want = marked.filter((n) => n.lab).map((n) => `${n.lab!.kind}@${n.start.n}/${n.start.d}`);
    expect(labs.map((x) => x.split(":").slice(2)[0] + "@" + x.split(":")[1]).sort()).toEqual(want.sort());
    // 옮긴 음(3·4마디)은 받는 트랙에서 표시를 가진다
    expect(labs.some((x) => x.startsWith("b:"))).toBe(true);
  });
});
