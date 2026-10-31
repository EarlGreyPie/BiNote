import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, rat, type Player, type Song, type Track } from "@mmlce/core";
import { distributeChords, distributeSong, freeRuns, mergeTies, optimizeMml, parseTrackText, settleDistributed } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };
const flute: Player = { id: "p2", name: "플루트", instrument: { canonical: "flute" } };

function track(id: string, text: string, playerId = "p1"): Track {
  return { id, playerId, name: id, color: "#000", role: "free", mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {} };
}

function song(tracks: Track[]): Song {
  return { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [piano, flute], tracks };
}

/** 모든 트랙의 음을 (시작, 높이)로 모은 것. 옮겨도 같아야 한다 */
const sound = (s: Song) =>
  s.tracks
    .flatMap((t) => mergeTies(t.notes).map((n) => `${n.start.n}/${n.start.d}:${n.pitch}:${n.dur.n}/${n.dur.d}:${n.vol}`))
    .sort();

describe("freeRuns", () => {
  it("받는 채널이 쉬는 동안만 묶고, & 묶음은 쪼개지 않는다", () => {
    const from = track("a", "cdef gab>c<").notes;
    const to = track("b", "r2 e4 r4 r1").notes;
    const runs = freeRuns(from, to);
    expect(runs.map((r) => r.length)).toEqual([2, 5]);
    const tied = track("c", "c&c d&d e f").notes;
    const runs2 = freeRuns(tied, track("d", "r4 r8 e8").notes);
    // 첫 & 묶음(c&c)이 받는 채널 e8과 겹쳐서 통째로 빠진다
    expect(runs2.map((r) => r.map((n) => n.pitch))).toEqual([[62, 62, 64, 65]]);
  });
});

describe("distributeChords", () => {
  it("넘치는 채널의 음을 같은 연주자의 빈 채널로 옮겨 한도 안에 넣는다", () => {
    const busy = "l16 " + "cdefgab>c<".repeat(10) + " r1 r1 r1";
    const quiet = "r1 r1 r1 r1 r1 r1 o3 c1 c1";
    const other = "r1 c1";
    const s = song([track("a", busy), track("b", quiet), track("x", other, "p2")]);
    const limit = 60;
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: limit };
    expect(optimizeMml(s.tracks[0]!.notes).text.length).toBeGreaterThan(limit);
    const r = distributeChords(s, profile);
    expect(r.moved).toBeGreaterThan(0);
    expect(r.over).toEqual([]);
    expect(sound(r.song)).toEqual(sound(s));
    // 다른 연주자 트랙은 그대로
    expect(r.song.tracks[2]).toBe(s.tracks[2]);
    expect(r.song.tracks[0]!.mml).toBeUndefined();
  });
});

describe("트랙 악기가 다른 화음 분산", () => {
  it("같은 악보라도 악기가 다른 트랙으로는 음을 옮기지 않는다", async () => {
    const { emptySong, MOBILE_PROFILE } = await import("@mmlce/core");
    const { distributeChords, parseTrackText } = await import("../src/index.js");
    const text = "l16" + "cgdaebf+c+".repeat(275);
    const track = (id: string, t: string, extra = {}) => ({
      id, playerId: "p1", name: id, color: "", role: "free" as const, mute: false, solo: false, spelling: {},
      notes: parseTrackText(id, { text: t }).notes, ...extra,
    });
    const song = {
      ...emptySong({ title: "", author: "", profileId: "mobile" }),
      players: [{ id: "p1", name: "", instrument: { canonical: "piano", program: 21 } }],
      tracks: [track("a", text), track("b", "", { instrument: { canonical: "flute", program: 5 } })],
    };
    const r = distributeChords(song, MOBILE_PROFILE);
    expect(r.moved).toBe(0);
    expect(r.song.tracks[1]!.notes).toHaveLength(0);
  });
});

describe("화음 분산의 소리 묶음과 적용 확인 (점검 S08)", () => {
  const busy = "l16 " + "cdefgab>c<".repeat(10) + " r1 r1 r1";
  const profile = { ...MOBILE_PROFILE, charLimitPerScore: 60 };

  it("끈 트랙이나 채널 볼륨·팬이 다른 트랙으로는 음을 옮기지 않는다 (화음 분산 창과 같은 기준)", () => {
    const quiet = "r1 r1 r1 r1 r1 r1 o3 c1 c1";
    const base = song([track("a", busy), track("b", quiet)]);
    // 같은 소리 묶음이면 옮긴다
    expect(distributeChords(base, profile).moved).toBeGreaterThan(0);
    for (const change of [{ mute: true }, { mix: { volume: 80 } }, { mix: { pan: 20 } }]) {
      const s = { ...base, tracks: [base.tracks[0]!, { ...base.tracks[1]!, ...change }] };
      const r = distributeChords(s, profile);
      expect(r.moved).toBe(0);
      expect(r.song.tracks[1]!.notes).toHaveLength(s.tracks[1]!.notes.length);
    }
  });

  it("같은 연주자라도 다른 악보(오르골 3+3의 둘째 대) 트랙으로는 옮기지 않는다", () => {
    const box: Player = { id: "p1", name: "오르골", instrument: { canonical: "music-box" } };
    // 첫 악보의 b·c는 쉬는 곳이 없고, 둘째 악보의 d만 비어 있다
    const full = "l16 " + "c".repeat(100) + " r1 r1 r1";
    const s = { ...song([track("a", busy), track("b", full), track("c", full), track("d", "")]), players: [box] };
    const r = distributeChords(s, profile);
    expect(r.moved).toBe(0);
    expect(r.song.tracks[3]!.notes).toHaveLength(0);
  });

  it("글자 수 줄이기가 곡을 그대로 두면(kept) 원문이 지워진 옮긴 곡을 넣지 않는다", () => {
    const read = track("u", "t100c4", "p2");
    const { mml: _mml, ...bare } = read;
    // 출력기로 정확히 쓸 수 없는 길이(1/240)라 글자 수 줄이기가 곡을 그대로 둔다
    const u = { ...bare, notes: read.notes.map((n) => ({ ...n, dur: rat(1, 240) })) };
    const s = song([track("a", busy), track("b", "r1 r1 r1 r1 r1 r1 o3 c1 c1"), u]);
    expect(distributeChords(s, profile).moved).toBeGreaterThan(0);
    const settled = settleDistributed(s, distributeChords(s, profile).song, profile);
    expect(settled.kept).toBe("notes");
    expect(settled.song).toBe(s);
    expect(distributeSong(profile).apply(s)).toBe(s);
  });

  it("옮긴 뒤 게임 소리가 달라지면 곡을 그대로 둔다", () => {
    const s = song([track("a", "cdef"), { ...track("b", ""), mute: true }]);
    // 끈 트랙으로 음을 옮긴 곡 (distributeChords는 이렇게 옮기지 않지만, 확인이 막는지 본다)
    const moved = { ...s, tracks: [{ ...s.tracks[0]!, notes: [] }, { ...s.tracks[1]!, notes: s.tracks[0]!.notes }] };
    const settled = settleDistributed(s, moved, MOBILE_PROFILE);
    expect(settled.kept).toBe("sound");
    expect(settled.song).toBe(s);
    // 소리가 같으면 다시 쓴 곡을 넣는다
    const same = song([track("a", "cdef"), track("b", "")]);
    const ok = { ...same, tracks: [{ ...same.tracks[0]!, notes: [] }, { ...same.tracks[1]!, notes: same.tracks[0]!.notes }] };
    expect(settleDistributed(same, ok, MOBILE_PROFILE).kept).toBeUndefined();
  });
});
