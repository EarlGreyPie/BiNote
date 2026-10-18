import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, rat, type Player, type Song, type Track } from "@mmlce/core";
import {
  compactSong,
  gameScores,
  mergeChords,
  gameTimeline,
  gameTimelineOf,
  timelineCovers,
  mergeResult,
  mergeSong,
  mergeTies,
  mergeVoices,
  optimizeMml,
  parseMml,
  parseTrackText,
  planVoiceByPitch,
  setTrackText,
} from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };
const flute: Player = { id: "p2", name: "플루트", instrument: { canonical: "flute" } };

function track(id: string, text: string, extra: Partial<Track> = {}): Track {
  return { id, playerId: "p1", name: id, color: "#000", role: "free", mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {}, ...extra };
}

function song(tracks: Track[]): Song {
  return { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [piano, flute], tracks };
}

/** 모든 트랙의 음을 (시작, 높이, 길이, v)로 모은 것. 병합해도 같아야 한다 */
const sound = (s: Song) =>
  s.tracks
    .flatMap((t) => mergeTies(t.notes).map((n) => `${n.start.n}/${n.start.d}:${n.pitch}:${n.dur.n}/${n.dur.d}:${n.vol}`))
    .sort();

// 위 선율: 2박마다 쉰다. 가운데 트랙: 계속 울린다. 조각: 위 선율이 쉬는 자리에만 음이 있다
const top = "o5 c4 d4 r2 e4 f4 r2 g4 a4 r2 b4 >c4< r2";
const middle = "o4 c2 d2 e2 f2 g2 a2 b2 >c2<";
const pieces = "r2 o5 e4 r4 r2 g4 r4 r1 r1";

describe("mergeChords", () => {
  it("드문 트랙의 음을 쉬는 같은 악기 트랙으로 옮기고 비게 된 트랙은 지운다", () => {
    const s = song([track("a", top), track("b", middle), track("c", pieces), track("x", "o5 e1", { playerId: "p2" })]);
    const r = mergeChords(s, MOBILE_PROFILE);
    expect(r.moved).toBe(2);
    expect(r.removed).toEqual(["c"]);
    expect(r.song.tracks.map((t) => t.id)).toEqual(["a", "b", "x"]);
    expect(sound(r.song)).toEqual(sound(s));
    // 위 선율 쉼에 들어갔다 (가운데 트랙은 내내 울린다)
    expect(r.song.tracks[0]!.notes.length).toBe(s.tracks[0]!.notes.length + 2);
    expect(r.song.tracks[0]!.mml).toBeUndefined();
    // 다른 악보는 그대로
    expect(r.song.tracks[2]).toBe(s.tracks[3]);
  });

  it("다른 트랙과 겹치는 음은 그대로 둔다", () => {
    // 두 번째 조각(o5 d4 at 1/4)은 위 선율 d4와 겹친다
    const s = song([track("a", top), track("b", middle), track("c", "r4 o5 c4 e4 r4 r1 r1 r1")]);
    const r = mergeChords(s, MOBILE_PROFILE);
    expect(r.moved).toBe(1);
    expect(r.removed).toEqual([]);
    expect(r.song.tracks[2]!.notes.map((n) => n.pitch)).toEqual([72]);
    expect(sound(r.song)).toEqual(sound(s));
  });

  it("앞뒤 음과 완전5도보다 먼 트랙에는 넣지 않는다", () => {
    // 조각이 o3로 멀리 떨어져 있다
    const s = song([track("a", top), track("b", middle), track("c", "r2 o3 e4 r4 r1 r1 r1")]);
    const r = mergeChords(s, MOBILE_PROFILE);
    expect(r.moved).toBe(0);
    expect(r.song).toBe(s);
  });

  it("받는 트랙의 앞 음과 &로 이어지게 되면 넣지 않는다", () => {
    const tied = "o5 c4 d4& r2 e4 f4 r2 g4 a4 r2 b4 >c4< r2";
    const s = song([track("a", tied), track("c", "r2 o5 e4 r4 r1 r1 r1")]);
    expect(s.tracks[0]!.notes[1]!.tie).toBe("next");
    const r = mergeChords(s, MOBILE_PROFILE);
    expect(r.moved).toBe(0);
  });

  it("잠근 트랙과 끄기·채널 볼륨이 다른 트랙은 보내지도 받지도 않는다", () => {
    const base = [track("a", top), track("c", pieces)];
    expect(mergeChords(song(base), MOBILE_PROFILE, { locked: new Set(["a"]) }).moved).toBe(0);
    expect(mergeChords(song(base), MOBILE_PROFILE, { locked: new Set(["c"]) }).moved).toBe(0);
    expect(mergeChords(song([base[0]!, { ...base[1]!, mute: true }]), MOBILE_PROFILE).moved).toBe(0);
    expect(mergeChords(song([base[0]!, { ...base[1]!, mix: { volume: 90 } }]), MOBILE_PROFILE).moved).toBe(0);
    expect(mergeChords(song(base), MOBILE_PROFILE).moved).toBe(2);
  });

  it("받는 트랙이 글자 수 한도를 새로 넘으면 옮기지 않는다", () => {
    // 짧고 여린 조각이라 받는 트랙에 v·길이 명령이 붙는다
    const s = song([track("a", top), track("c", "r2 o5 v9 e16 r8. r4 r2 g16 r8. r4 r1 r1")]);
    expect(mergeChords(s, MOBILE_PROFILE).moved).toBe(2);
    // 위 선율이 한도에 꽉 찬다
    const tight = { ...MOBILE_PROFILE, charLimitPerScore: optimizeMml(s.tracks[0]!.notes).text.length };
    expect(mergeChords(s, tight).moved).toBe(0);
  });

  it("실행 취소하면 원래 곡으로 돌아간다", () => {
    const s = song([track("a", top), track("b", middle), track("c", pieces)]);
    const cmd = mergeSong(MOBILE_PROFILE);
    const after = cmd.apply(s);
    expect(after.tracks.length).toBe(2);
    expect(sound(after)).toEqual(sound(s));
    expect(cmd.invert(s).apply(after)).toBe(s);
  });
});

describe("mergeVoices", () => {
  it("음 수가 같은 트랙끼리는 주고받지 않는다", () => {
    const a = parseTrackText("a", { text: "c4 r4 e4 r4" }).notes;
    const b = parseTrackText("b", { text: "r4 d4 r4 f4" }).notes;
    expect(mergeVoices([a, b], { limit: 2400 }).moved).toBe(0);
  });

  it("일부만 옮길 때 글자 수 합이 늘면 옮기지 않고, 트랙을 통째로 비울 때는 옮긴다", () => {
    const a = parseTrackText("a", { text: "o5 c4 d4 r2 e4 f4 r2 g4 a4" }).notes;
    // 두 번째 음(f)은 a와 겹쳐 남는다
    const b = parseTrackText("b", { text: "r2 o5 e4 r4 f4" }).notes;
    const c = parseTrackText("c", { text: "r2 o5 e4" }).notes;
    // 받는 트랙만 길게 세는 길이: 옮기면 합이 는다
    const length = (notes: readonly unknown[]) => (notes.length >= 7 ? 100 : notes.length);
    expect(mergeVoices([a, b], { limit: 2400, length }).moved).toBe(0);
    expect(mergeVoices([a, c], { limit: 2400, length }).moved).toBe(1);
    expect(mergeVoices([a, b], { limit: 2400 }).moved).toBe(1);
  });
});

describe("화음 병합 점검에서 찾은 문제", () => {
  it("음 하나를 받고 하나를 보낸 가운데 트랙도 바뀐 트랙으로 보고 음을 잃지 않는다", () => {
    const s = song([track("a", "r4 e4"), track("b", "c4 r4 c4"), track("c", "r4 d4 d4 d4 d4")]);
    const r = mergeChords(s, MOBILE_PROFILE);
    expect(sound(r.song)).toEqual(sound(s));
    const after = mergeSong(MOBILE_PROFILE).apply(s);
    expect(sound(after)).toEqual(sound(s));
  });

  it("옮기면 출력기가 쓸 수 없는 쉼이 생기는 자리에는 옮기지 않는다", () => {
    const s = song([track("a", "c32 r4 c32"), track("b", "r24 d24")]);
    const after = mergeSong(MOBILE_PROFILE).apply(s);
    expect(sound(after)).toEqual(sound(s));
    // 게임 출력 글을 다시 읽어도 음 시작이 그대로다
    for (const t of after.tracks) {
      const text = optimizeMml(t.notes).text;
      expect(parseTrackText(t.id, { text }).notes.map((n) => `${n.start.n}/${n.start.d}`)).toEqual(t.notes.map((n) => `${n.start.n}/${n.start.d}`));
    }
  });
});

describe("화음 병합 재점검에서 찾은 문제", () => {
  const ids = (s: Song) => s.tracks.flatMap((t) => t.notes.map((n) => n.id));

  it("다른 편집이 만든 같은 id 두 음 중 하나만 옮기고 다른 하나는 지우지 않는다", () => {
    // 높이 순 나누기 + MML 고치기로 생기는 상태: t1의 e와 t2의 첫 c가 같은 id
    let s = song([track("t1", "r4 c4"), track("t2", "r4 e4"), track("t3", "r4 d4 d4 d4 d4")]);
    s = planVoiceByPitch(s, ["t1", "t2"]).song;
    const dup = s.tracks[0]!.notes.find((n) => n.pitch === 64)!.id;
    s = { ...s, tracks: s.tracks.map((t) => (t.id === "t2" ? { ...t, notes: parseTrackText("t2", { text: "c4 r4 c4" }).notes, mml: undefined } : t)) } as Song;
    expect(s.tracks[1]!.notes[0]!.id).toBe(dup);
    expect(sound(mergeChords(s, MOBILE_PROFILE).song)).toEqual(sound(s));
    expect(sound(mergeSong(MOBILE_PROFILE).apply(s))).toEqual(sound(s));
  });

  it("한 트랙 안에서 id가 겹친 음도 하나만 옮긴다", () => {
    const a = track("a", top);
    const c = track("c", pieces);
    const same = { ...c, notes: c.notes.map((n) => ({ ...n, id: "same" })) };
    const s = song([a, track("b", middle), same]);
    expect(sound(mergeChords(s, MOBILE_PROFILE).song)).toEqual(sound(s));
  });

  it("MML을 고치면 다른 트랙으로 옮겨 간 음과 id가 겹치지 않게 새 id를 준다", () => {
    let s = song([track("t1", "r4 c4"), track("t2", "r4 e4")]);
    s = planVoiceByPitch(s, ["t1", "t2"]).song;
    s = setTrackText("t2", "c4 r4 c4").apply(s);
    expect(new Set(ids(s)).size).toBe(ids(s).length);
    s = compactSong(MOBILE_PROFILE).apply(s);
    expect(new Set(ids(s)).size).toBe(ids(s).length);
  });

  /** 게임 출력 글에 적힌 템포 (자리:빠르기) */
  const writtenTempo = (s: Song) =>
    [...new Set(gameScores(s, 3).flatMap((g) => g.texts.flatMap((x) => parseMml(x.text).tempo.map((e) => `${e.at.n}/${e.at.d}:${e.bpm}`))))].sort();

  for (const [name, receiver] of [
    ["받는 트랙 c32r4dddd", "c32 r4 d4 d4 d4"],
    ["받는 트랙 r32c8r8dddd", "r32 c8 r8 d4 d4 d4"],
  ] as const) {
    it(`정확히 쓰던 템포를 뒤로 미루게 되면 병합하지 않는다 (${name})`, () => {
      const s = { ...song([track("A", "r4 e32"), track("B", receiver)]), tempo: [{ at: rat(0), bpm: 120 }, { at: rat(1, 24), bpm: 180 }] };
      expect(writtenTempo(s)).toContain("1/24:180");
      const after = mergeSong(MOBILE_PROFILE).apply(s);
      expect(sound(after)).toEqual(sound(s));
      expect(writtenTempo(after)).toContain("1/24:180");
      expect(gameTimeline(after, MOBILE_PROFILE)).toBe(gameTimeline(s, MOBILE_PROFILE));
      // 템포를 모르고 병합하면 미뤄지는 것을 최종 검사가 잡는다
      const blind = { ...mergeChords({ ...s, tempo: [] }, MOBILE_PROFILE).song, tempo: s.tempo };
      expect(blind.tracks.length).toBe(1);
      expect(gameTimeline(blind, MOBILE_PROFILE)).not.toBe(gameTimeline(s, MOBILE_PROFILE));
    });
  }

  it("템포 자리를 지키는 다른 트랙이 있으면 그대로 병합한다", () => {
    // 가운데 트랙이 1/2에서 음이 바뀌어 템포를 쓸 수 있다
    const s = { ...song([track("a", top), track("b", middle), track("c", pieces)]), tempo: [{ at: rat(0), bpm: 120 }, { at: rat(1, 2), bpm: 90 }] };
    const r = mergeResult(s, MOBILE_PROFILE);
    expect(r.moved).toBe(2);
    expect(writtenTempo(r.song)).toContain("1/2:90");
  });

  it("보내는 트랙만 템포를 정확히 쓸 수 있으면 그 음은 옮기지 않는다", () => {
    // A의 쉼(0~1/4)은 1/24에 템포를 쓸 수 있지만, B는 c32 뒤 1/96 쉼이 필요해 못 쓴다
    const a = parseTrackText("A", { text: "r4 e32" }).notes;
    const b = parseTrackText("B", { text: "c32 r4 d4 d4 d4 d4" }).notes;
    expect(mergeVoices([a, b], { limit: 2400 }).moved).toBe(1);
    expect(mergeVoices([a, b], { limit: 2400, tempo: [rat(1, 24)] }).moved).toBe(0);
  });
});

describe("화음 병합 3차 점검: 악보가 여럿인 곡", () => {
  const tempo = [{ at: rat(0), bpm: 120 }, { at: rat(1, 24), bpm: 180 }];
  const many = (canonical: string, texts: readonly string[]): Song => ({
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo,
    players: [{ id: "p1", name: "", instrument: { canonical } }],
    tracks: texts.map((text, k) => track(`t${k + 1}`, text)),
  });
  const cases: [string, Song][] = [
    // 3트랙씩 악보 셋. 둘째 악보는 t4만 1/24에 템포를 쓸 수 있고, 셋째 악보는 전부터 템포를 뒤로 미룬다
    ...(["music-box", "gramophone"] as const).map((c): [string, Song] => [
      `${c} 8트랙`,
      many(c, ["c32r4dddd", "c32r4dddd", "r4dddd", "r4e32", "c32r4dddd", "c32r4dddd", "c32r8.r32dddd", "c32r4dddd"]),
    ]),
    // 6트랙씩 악보 셋 (6+6+1). 둘째 악보는 t7만 템포 자리, 셋째 악보(t13)는 전부터 미룬다
    [
      "일반 악기 13트랙",
      many("piano", [
        ...Array.from({ length: 5 }, () => "c32r4dddd"),
        "r4dddd",
        "r4e32",
        ...Array.from({ length: 5 }, () => "c32r4dddd"),
        "c32r8.r32dddd",
      ]),
    ],
  ];
  for (const [name, s] of cases) {
    it(`다른 악보에 같은 템포 미룸이 있어도 새로 미루게 되는 병합은 하지 않는다 (${name})`, () => {
      // 아무 검사 없이 옮기면 최종 출력의 연주 시간이 달라지는 입력이다
      const blind = { ...mergeChords({ ...s, tempo: [] }, MOBILE_PROFILE).song, tempo };
      expect(blind.tracks.length).toBeLessThan(s.tracks.length);
      expect(gameTimeline(blind, MOBILE_PROFILE)).not.toBe(gameTimeline(s, MOBILE_PROFILE));
      const r = mergeResult(s, MOBILE_PROFILE);
      expect(gameTimeline(r.song, MOBILE_PROFILE)).toBe(gameTimeline(s, MOBILE_PROFILE));
      expect(sound(r.song)).toEqual(sound(s));
      expect(sound(mergeSong(MOBILE_PROFILE).apply(s))).toEqual(sound(s));
    });
  }

  it("템포가 없는 여러 악보 곡은 그대로 병합한다", () => {
    const s = { ...many("music-box", ["c32r4dddd", "c32r4dddd", "r4dddd", "r4e32", "c32r4dddd", "c32r4dddd", "c32r8.r32dddd", "c32r4dddd"]), tempo: [] };
    const r = mergeResult(s, MOBILE_PROFILE);
    expect(r.moved).toBe(1);
    // t4를 지우면 뒤 트랙이 앞 악보로 당겨지므로 빈 트랙으로 남는다
    expect(r.removed).toEqual([]);
    expect(r.song.tracks.map((t) => t.notes.length)).toEqual([5, 5, 4, 0, 5, 6, 5, 5]);
    expect(gameTimeline(r.song, MOBILE_PROFILE)).toBe(gameTimeline(s, MOBILE_PROFILE));
  });

  it("최종 출력 시간표는 음이 다른 트랙으로 옮겨 가도 같고, 연주 시간이 바뀌면 다르다", () => {
    const a = song([track("a", "c4 r4"), track("b", "r4 d4 e4")]);
    const moved = song([track("a", "c4 d4"), track("b", "r2 e4")]);
    expect(gameTimeline(moved, MOBILE_PROFILE)).toBe(gameTimeline(a, MOBILE_PROFILE));
    expect(gameTimeline({ ...a, tempo: [{ at: rat(1, 4), bpm: 90 }] }, MOBILE_PROFILE)).not.toBe(gameTimeline(a, MOBILE_PROFILE));
  });
});

describe("화음 병합 4차 점검: 악보 나뉨과 악보마다의 끝", () => {
  // 한 연주자 피아노 7트랙 = 악보 둘 (t1~t6, t7). t1을 지우면 t7이 첫 악보로 당겨져 둘째 악보가 사라진다
  const s: Song = {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    players: [{ id: "p1", name: "", instrument: { canonical: "piano" } }],
    tracks: ["r4e", "cr4c", "r4dddd", "r4dddd", "r4dddd", "r4dddd", "o5c"].map((text, k) => track(`t${k + 1}`, text)),
  };

  it("악보 나뉨이 바뀌는 병합은 최종 출력 시간표가 다르다", () => {
    const blind = mergeChords(s, MOBILE_PROFILE).song;
    expect(blind.tracks.length).toBe(6);
    expect(gameTimeline(blind, MOBILE_PROFILE)).not.toBe(gameTimeline(s, MOBILE_PROFILE));
  });

  it("비운 트랙을 남겨 악보 나뉨과 악보마다의 끝을 지킨다", () => {
    const r = mergeResult(s, MOBILE_PROFILE);
    expect(r.moved).toBe(2);
    expect(r.removed).toEqual([]);
    expect(r.song.tracks.map((t) => t.notes.length)).toEqual([0, 2, 4, 4, 4, 5, 1]);
    expect(gameTimeline(r.song, MOBILE_PROFILE)).toBe(gameTimeline(s, MOBILE_PROFILE));
    expect(gameScores(r.song, 6).map((g) => g.trackIds)).toEqual(gameScores(s, 6).map((g) => g.trackIds));
  });

  it("음은 다른 악보의 트랙으로 옮기지 않는다", () => {
    // t7(둘째 악보)이 쉬는 자리라도 첫 악보 음을 받지 않는다
    const wide = { ...s, tracks: s.tracks.map((t) => (t.id === "t7" ? track("t7", "o5c r1") : t)) };
    const r = mergeResult(wide, MOBILE_PROFILE);
    expect(r.song.tracks.find((t) => t.id === "t7")!.notes.length).toBe(1);
    expect(gameTimeline(r.song, MOBILE_PROFILE)).toBe(gameTimeline(wide, MOBILE_PROFILE));
  });

  it("시간표는 반올림하지 않은 분수로 비교한다", () => {
    const a = song([track("a", "l7 c")]);
    const b = song([track("a", "c7")]);
    expect(gameTimeline(a, MOBILE_PROFILE)).toBe(gameTimeline(b, MOBILE_PROFILE));
    expect(gameTimeline(a, MOBILE_PROFILE)).toContain("0/1|1/7|");
  });
});

describe("timelineCovers", () => {
  it("음만 더한 시간표는 덮고, 음이 바뀌면 덮지 않는다", () => {
    const before = gameTimelineOf(song([track("a", "c4 r4 e4")]), MOBILE_PROFILE);
    expect(timelineCovers(gameTimelineOf(song([track("a", "c4 d4 e4")]), MOBILE_PROFILE), before)).toBe(true);
    expect(timelineCovers(gameTimelineOf(song([track("a", "c8 r8 r4 e4")]), MOBILE_PROFILE), before)).toBe(false);
    expect(timelineCovers(gameTimelineOf({ ...song([track("a", "c4 d4 e4")]), tempo: [{ at: rat(1, 4), bpm: 90 }] }, MOBILE_PROFILE), before)).toBe(false);
  });
});
