import { describe, expect, it } from "vitest";
import { add, emptySong, eq, MOBILE_PROFILE, rat, type Player, type Rat, type Song, type TempoEvent, type Track } from "@mmlce/core";
import { fastRunMoments, parseTrackText, planFastRunFix, setTracksNotes, validateSong } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };

function track(id: string, text: string, playerId = "p1"): Track {
  return { id, playerId, name: id, color: "#000", role: "free", mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {} };
}

function song(texts: readonly string[], options: { players?: Player[]; tempo?: TempoEvent[] } = {}): Song {
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    players: options.players ?? [piano],
    tempo: options.tempo ?? [{ at: rat(0), bpm: 120 }],
    tracks: texts.map((text, k) => track(`t${k + 1}`, text, options.players?.[0]?.id ?? "p1")),
  };
}

/** 걸린 순간마다 착지 음이 있는 트랙 id */
const hits = (s: Song) => fastRunMoments(s, MOBILE_PROFILE).map((m) => m.landings.map((l) => l.trackId));

// t120: 24분음표 83ms, 2분음표 1초. 꾸밈음 c·d와 착지 음 d+는 모두 피아노 o3e~o4d+ 구간
const RUN = "l24cdd+2";

describe("연주 누락음 검사 찾기", () => {
  it("빠른 음과 그 순간 음을 트랙 순으로 세어 5개를 넘는 음이 걸린다 (빠른 음 6 → 셋 다, 빠른 음 4 → 두 번째 트랙부터)", () => {
    expect(hits(song([RUN, RUN, RUN]))).toEqual([["t1", "t2", "t3"]]);
    expect(hits(song([RUN, RUN, "c1"]))).toEqual([["t2"]]);
    // 빠른 음이 한 트랙뿐이면 걸리지 않는다
    expect(hits(song([RUN, "l24rrd+2", "l24rrd+2"]))).toEqual([]);
  });

  it("착지 시각 차가 40ms 안이면 같은 순간이다 (t120 1/64 = 31ms는 같고 1/32 = 63ms는 다르다)", () => {
    expect(hits(song([RUN, RUN, `r64${RUN}`]))).toEqual([["t1", "t2", "t3"]]);
    expect(hits(song([RUN, RUN, `r32${RUN}`]))).toEqual([["t2"]]);
  });

  it("&로 이어 다시 치지 않는 음은 한 음으로 센다", () => {
    // 같은 높이 c48&c48은 24분음표 한 음 → 빠른 음 넷 + 착지 둘 = 트랙 2만 걸림 (둘로 세면 빠른 음 다섯이라 둘 다)
    expect(hits(song(["c48&c48l24dd+2", RUN]))).toEqual([["t2"]]);
    // 높이만 옮기는 c24&d24는 167ms 한 음 → 빠른 음이 아니다 (빠른 음 셋 + 착지 둘)
    expect(hits(song(["l24c&dd+2", "l24rcdd+2"]))).toEqual([]);
  });

  it("v0 음은 소리가 없어 빠른 음으로 치지 않는다", () => {
    // 빠른 음 셋 가운데 첫 음이 v0이면 둘만 세어 빠른 음 4 → 트랙 2만 걸림. 소리가 나면 빠른 음 5 → 둘 다
    expect(hits(song(["l24v0cv8cdd+2", "l24rcdd+2"]))).toEqual([["t2"]]);
    expect(hits(song(["l24ccdd+2", "l24rcdd+2"]))).toEqual([["t1", "t2"]]);
  });

  it("끈 트랙도 게임은 치므로 센다", () => {
    const s = song([RUN, RUN, RUN]);
    expect(hits({ ...s, tracks: s.tracks.map((t, k) => (k === 0 ? { ...t, mute: true } : t)) })).toHaveLength(1);
  });

  it("다른 게임 악보의 트랙끼리는 묶지 않는다 (7트랙 = 6 + 1, 오르골 6트랙 = 3 + 3)", () => {
    expect(hits(song(["c1", "c1", "c1", "c1", RUN, RUN, RUN]))).toEqual([["t6"]]);
    expect(hits(song([RUN, RUN, RUN, "c1", "c1", "c1", "c1"]))).toEqual([["t1", "t2", "t3"]]);
    const box: Player = { id: "p1", name: "오르골", instrument: { canonical: "music-box" } };
    expect(hits(song(["c1", RUN, RUN, RUN, "c1", "c1"], { players: [box] }))).toEqual([["t3"]]);
    expect(hits(song([RUN, RUN, RUN, "c1", "c1", "c1"], { players: [box] }))).toEqual([["t1", "t2", "t3"]]);
  });

  it("빠르기는 곡 템포 지도로 센다: 같은 24분음표도 t60 구간에서는 167ms라 빠르지 않다", () => {
    const slow = [{ at: rat(0), bpm: 60 }];
    expect(hits(song([RUN, RUN, RUN], { tempo: slow }))).toEqual([]);
    // 빠른 음은 t120, 착지 음 자리에서 t60으로 바뀌어도 걸린다
    expect(hits(song([RUN, RUN, RUN], { tempo: [{ at: rat(0), bpm: 120 }, { at: rat(1, 12), bpm: 60 }] }))).toHaveLength(1);
  });

  it("착지 음이 빠르면 연속의 일부로 보고 다음 음을 본다", () => {
    expect(hits(song(["l24cdefg2", RUN, "l24cr24dd+2"]))).toEqual([]);
    const m = fastRunMoments(song(["l24cdefg2", "l24cdefg2", "l24cdefg2"]), MOBILE_PROFILE);
    expect(m.map((x) => x.at)).toEqual([rat(1, 6)]);
  });
});

/** 그 트랙 세 번째 음(RUN의 착지 음) 길이를 바꾼다 */
const withLanding = (s: Song, trackId: string, dur: Rat): Song => ({
  ...s,
  tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, notes: t.notes.map((n, k) => (k === 2 ? { ...n, dur } : n)) } : t)),
});

describe("연주 누락음 검사: 샘플 구간", () => {
  it("빠른 음 연속과 다른 구간의 착지 음은 빠지지 않는다 (트랙 수는 구간마다 센다)", () => {
    // 꾸밈음은 o3e~o4d+, 착지 음 e(64)는 o4e~ 구간
    expect(hits(song(["l24cde2", "l24cde2", "l24cde2"]))).toEqual([]);
    // 트랙 3 꾸밈음은 다른 구간이라 o3e~ 구간 빠른 음은 넷. 그 구간에서 시작하는 음 셋 가운데 두 번째부터 걸린다
    expect(hits(song([RUN, RUN, "l24>cd<d+2"]))).toEqual([["t2", "t3"]]);
    // 세 트랙이 같은 구간에서 연속을 치면, 착지 음이 같은 구간인 트랙만 걸린다
    expect(hits(song([RUN, RUN, "l24cde2"]))).toEqual([["t1", "t2"]]);
  });

  it("악기가 다르면 다른 구간이다", () => {
    const s = song([RUN, RUN, RUN]);
    const lute = { canonical: "lute", program: 1 };
    expect(hits({ ...s, tracks: s.tracks.map((t, k) => (k === 2 ? { ...t, instrument: lute } : t)) })).toEqual([["t2"]]);
  });

  it("범위 밖 음은 접은 뒤 높이로 구간을 본다 (o1c → o2c)", () => {
    // 피아노 범위 o1e~: o1c·o1d는 o2c·o2d로 접혀 o2c~o3d+ 구간, 착지 o2d+도 같은 구간
    expect(hits(song(["o1l24cdo2d+2", "o2l24cdd+2", "o2l24cdd+2"]))).toHaveLength(1);
  });

  it("구간 경계를 모르는 악기는 전체를 한 구간으로 본다", () => {
    const unknown: Player = { id: "p1", name: "모르는 악기", instrument: { canonical: "unknown-instrument" } };
    expect(hits(song(["l24cde2", "l24cde2", "l24>cd<<<e2"], { players: [unknown] }))).toHaveLength(1);
  });

  it("타악기는 세지 않는다 (큰북 실측: 빠른 음 6개 뒤 착지도 났다)", () => {
    for (const canonical of ["bass-drum", "cymbal"]) {
      const drum: Player = { id: "p1", name: "북", instrument: { canonical } };
      expect(hits(song([RUN, RUN, RUN], { players: [drum] }))).toEqual([]);
    }
  });
});

describe("연주 누락음 고치기", () => {
  it("템포가 바뀐 자리에서는 착지 음 자리 템포로 늦출 길이를 고른다 (t200 착지 → 3/64)", () => {
    const s = song([RUN, RUN, RUN], { tempo: [{ at: rat(0), bpm: 120 }, { at: rat(1, 12), bpm: 200 }] });
    const plan = planFastRunFix(s, MOBILE_PROFILE);
    expect(plan.delays.map((d) => d.by)).toEqual([rat(3, 64), rat(3, 64), rat(3, 64)]);
    expect(plan.delays.map((d) => d.ms)).toEqual([56, 56, 56]);
    expect(plan.left).toBe(0);
  });

  it("t120에서는 1/64(31ms)가 40ms보다 짧아 64.(47ms)로 늦춘다", () => {
    const plan = planFastRunFix(song([RUN, RUN, RUN]), MOBILE_PROFILE);
    expect(plan.delays.map((d) => [d.by, d.ms])).toEqual([[rat(3, 128), 47], [rat(3, 128), 47], [rat(3, 128), 47]]);
  });

  it("2의 거듭제곱 칸으로 늦춰 남은 길이를 쓸 수 없으면 셋잇단 칸(1/48)으로 늦춘다", () => {
    // 착지 음 길이 1 + 1/24: 64.를 빼면 쓸 수 없고 1/48을 빼면 쓸 수 있다
    const plan = planFastRunFix(withLanding(song([RUN, RUN, RUN]), "t1", rat(25, 24)), MOBILE_PROFILE);
    expect(plan.delays.map((d) => d.by)).toEqual([rat(1, 48), rat(3, 128), rat(3, 128)]);
  });

  it("남은 길이가 0 이하이거나 정확히 쓸 수 없으면 그 음은 건너뛰고 까닭을 센다", () => {
    // 트랙 2 착지 음은 게임 길이로 쓸 수 없는 길이 (1/2 + 1/1000)
    const odd = withLanding(song(["l24cdc64&c2", RUN, RUN]), "t2", rat(501, 1000));
    expect(hits(odd)).toHaveLength(1);
    const plan = planFastRunFix(odd, MOBILE_PROFILE);
    expect(plan.skipped).toEqual({ locked: 0, short: 1, unwritable: 1, noLength: 0 });
    expect(plan.delays.map((d) => [d.trackId, d.by])).toEqual([["t3", rat(3, 128)]]);
    // 트랙 3만 늦추면 빠른 음이 넷으로 줄어 트랙 1은 풀리고, 트랙 2는 여전히 걸린다
    expect(plan.left).toBe(1);
  });

  it("벤드 한도 밖으로 & 이어 다시 치던 앞 음은 틈이 생기므로 &를 끊는다", () => {
    // o7c(96)에서 o4d+(63)로 33반음: 다시 친다. 빠른 음 셋 가운데 c·d가 착지 음과 같은 구간
    const s = song(["l24cd>>>c&<<<d+2", "l24cdcd+2", "l24cdcd+2"]);
    expect(hits(s)).toHaveLength(1);
    const plan = planFastRunFix(s, MOBILE_PROFILE);
    const after = setTracksNotes(plan.changes).apply(s);
    const notes = after.tracks[0]!.notes;
    expect(notes[2]!.tie).toBe("none");
    expect(eq(add(notes[3]!.start, notes[3]!.dur), rat(5, 8))).toBe(true);
    expect(hits(after)).toEqual([]);
  });

  it("&로 이은 착지 음은 첫 음만 늦추고 &와 사슬 끝은 그대로 둔다", () => {
    const s = song(["l24cdd+4&d+4", RUN, RUN]);
    const after = setTracksNotes(planFastRunFix(s, MOBILE_PROFILE).changes).apply(s);
    const [, , first, second] = after.tracks[0]!.notes;
    expect(first!.start).toEqual(add(rat(1, 12), rat(3, 128)));
    expect(first!.tie).toBe("next");
    expect(eq(add(first!.start, first!.dur), second!.start)).toBe(true);
    expect(second).toEqual(s.tracks[0]!.notes[3]);
    expect(hits(after)).toEqual([]);
  });

  it("템포가 바뀌는 자리의 착지 음을 늦춰도 곡 템포 지도는 그대로다", () => {
    const tempo = [{ at: rat(0), bpm: 120 }, { at: rat(1, 12), bpm: 90 }];
    const s = song([RUN, RUN, RUN], { tempo });
    const after = setTracksNotes(planFastRunFix(s, MOBILE_PROFILE).changes).apply(s);
    expect(after.tempo).toEqual(s.tempo);
    expect(hits(after)).toEqual([]);
  });

  it("실행 취소 한 번으로 되돌아간다", () => {
    const s = song([RUN, RUN, RUN]);
    const command = setTracksNotes(planFastRunFix(s, MOBILE_PROFILE).changes);
    const after = command.apply(s);
    expect(command.invert(s).apply(after).tracks.map((t) => t.notes)).toEqual(s.tracks.map((t) => t.notes));
  });

  it("검사는 순간마다 하나, 가장 이른 착지 음을 짚는다", () => {
    const d = validateSong(song([RUN, RUN, RUN]), MOBILE_PROFILE, { fastRunDrop: true }).filter((x) => x.code === "fast-run-drop");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ trackId: "t1", playerId: "p1" });
  });
});

describe("연주 누락음 고치기: 틈 비교의 소수 오차 (Codex P2)", () => {
  it("t125에서 셋잇단 칸 1/48(정확히 40ms)로 늦추면 곡 중간에서도 남는 자리가 없다", () => {
    let s = song(["r1r1l24cdd+2", "r1r1l24cdd+2", "r1r1l24cdd+2"], { tempo: [{ at: rat(0), bpm: 125 }] });
    for (const id of ["t1", "t2", "t3"]) s = withLanding(s, id, rat(25, 24));
    const plan = planFastRunFix(s, MOBILE_PROFILE);
    expect(plan.delays.map((d) => d.by)).toEqual([rat(1, 48), rat(1, 48), rat(1, 48)]);
    expect(plan.left).toBe(0);
  });
});

describe("연주 누락음 검사: 빠른 음 기준의 소수 오차 (Codex P2)", () => {
  it("t100의 16분음표(정확히 150ms)는 곡 중간에서도 빠른 음이 아니다", () => {
    const at = { tempo: [{ at: rat(0), bpm: 100 }] };
    expect(hits(song(["l16cdd+2", "l16cdd+2", "l16cdd+2"], at))).toEqual([]);
    expect(hits(song(["r1l16cdd+2", "r1l16cdd+2", "r1l16cdd+2"], at))).toEqual([]);
  });
});
