import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, rat, type Note, type Song } from "@mmlce/core";
import { buildSchedule, velocityForVolume } from "../src/index.js";

const n = (id: string, start: [number, number], dur: [number, number], pitch: number, extra: Partial<Note> = {}): Note => ({
  id, start: rat(...start), dur: rat(...dur), pitch, vol: 8, tie: "none", ...extra,
});

function song(tracks: { notes: Note[]; mute?: boolean; solo?: boolean; player?: string }[]): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  return {
    ...base,
    tempo: [{ at: rat(0), bpm: 120 }],
    players: [
      { id: "p1", name: "피아노", instrument: { canonical: "piano", program: 21 } },
      { id: "p2", name: "류트", instrument: { canonical: "lute", program: 0 } },
    ],
    tracks: tracks.map((t, i) => ({
      id: `t${i + 1}`, playerId: t.player ?? "p1", name: "", color: "", role: "free",
      mute: t.mute ?? false, solo: t.solo ?? false, notes: t.notes, spelling: {},
    })),
  };
}

describe("buildSchedule", () => {
  it("t120에서 4분음표 = 0.5초", () => {
    const s = buildSchedule(song([{ notes: [n("a", [0, 1], [1, 4], 60), n("b", [1, 4], [1, 4], 62)] }]), MOBILE_PROFILE);
    expect(s.events.map((e) => [e.type, e.time, e.note])).toEqual([
      ["on", 0, 60], ["off", 0.5, 60], ["on", 0.5, 62], ["off", 1, 62],
    ]);
    expect(s.duration).toBe(1);
  });

  it("트랙마다 소리 지점(채널)을 따로 쓴다", () => {
    const s = buildSchedule(
      song([{ notes: [n("a", [0, 1], [1, 4], 60)] }, { notes: [n("b", [0, 1], [1, 4], 64)] }, { notes: [n("c", [0, 1], [1, 4], 48)], player: "p2" }]),
      MOBILE_PROFILE,
    );
    expect(s.slots.map((x) => [x.key, x.instrument])).toEqual([["t1", "piano"], ["t2", "piano"], ["t3", "lute"]]);
  });

  it("트랙에 따로 정한 악기가 있으면 그 악기로 낸다", () => {
    const base = song([{ notes: [n("a", [0, 1], [1, 4], 60)] }, { notes: [n("b", [0, 1], [1, 4], 64)] }]);
    const withFlute = { ...base, tracks: base.tracks.map((t, i) => (i === 1 ? { ...t, instrument: { canonical: "flute", program: 5 } } : t)) };
    expect(buildSchedule(withFlute, MOBILE_PROFILE).slots.map((x) => [x.instrument, x.program])).toEqual([["piano", 21], ["flute", 5]]);
  });

  it("같은 음 &는 한 음으로, 다른 음 &는 다시 치지 않고 높이만 옮긴다 (실측)", () => {
    const s = buildSchedule(
      song([{ notes: [
        n("a", [0, 1], [1, 4], 60, { tie: "next" }), n("b", [1, 4], [1, 4], 60, { tie: "next" }), n("c", [1, 2], [1, 4], 62, { tie: "next" }), n("d", [3, 4], [1, 4], 57),
      ] }]),
      MOBILE_PROFILE,
    );
    expect(s.events.map((e) => [e.type, e.time, e.note, e.bend ?? null])).toEqual([
      ["on", 0, 60, null], ["bend", 1, 60, 2], ["bend", 1.5, 60, -3], ["off", 2, 60, null], ["bend", 2, 60, 0],
    ]);
  });

  it("다른 음 붙임은 샘플 안 위치를 이어 가며 새 음 샘플 끝에서 끝난다 (게임 실측과 비교)", () => {
    // t120 온음표 2초. 게임 녹음(t60 2분음표 둘 = 4초)과 같은 길이: 앞 음 2초 + 뒤 음 2초
    const tie = (a: number, b: number) =>
      buildSchedule(song([{ notes: [n("a", [0, 1], [1, 1], a, { tie: "next" }), n("b", [1, 1], [1, 1], b)] }]), MOBILE_PROFILE).events.find(
        (e) => e.type === "off",
      )!.time;
    expect(tie(60, 62)).toBeCloseTo(3.19, 1); // c&d 게임 3.19
    expect(tie(60, 72)).toBeCloseTo(3.36, 1); // c&>c 게임 3.36
    expect(tie(63, 64)).toBeCloseTo(3.51, 1); // d+&e 게임 3.51
    expect(tie(60, 67)).toBeCloseTo(3.8, 1); // c&g 게임 3.8
  });

  it("너무 멀리 붙인 음(벤드 범위 밖)은 새로 친다", () => {
    const s = buildSchedule(song([{ notes: [n("a", [0, 1], [1, 4], 40, { tie: "next" }), n("b", [1, 4], [1, 4], 70)] }]), MOBILE_PROFILE);
    expect(s.events.map((e) => [e.type, e.note])).toEqual([["on", 40], ["off", 40], ["on", 70], ["off", 70]]);
  });

  it("& 뒤의 v는 무시하고 첫 음 v로 이어 간다 (실측)", () => {
    const s = buildSchedule(song([{ notes: [n("a", [0, 1], [1, 4], 60, { vol: 15, tie: "next" }), n("b", [1, 4], [1, 4], 60, { vol: 5 })] }]), MOBILE_PROFILE);
    expect(s.events.map((e) => [e.type, e.time, e.velocity])).toEqual([["on", 0, 127], ["off", 1, 127]]);
  });

  it("악기 범위 밖 음은 게임처럼 옥타브째 접어 낸다", () => {
    const s = buildSchedule(song([{ notes: [n("a", [0, 1], [1, 4], 24), n("b", [1, 4], [1, 4], 119)] }]), MOBILE_PROFILE);
    expect(s.events.filter((e) => e.type === "on").map((e) => e.note)).toEqual([36, 95]);
  });

  it("샘플 길이보다 긴 음은 샘플이 끝나는 때 끊는다 (피아노 o4c ≈ 3.3초)", () => {
    // t120 온음표 2초 × 3 = 6초짜리 o4c
    const s = buildSchedule(song([{ notes: [n("a", [0, 1], [3, 1], 60)] }]), MOBILE_PROFILE);
    const off = s.events.find((e) => e.type === "off")!.time;
    expect(off).toBeGreaterThan(3.2);
    expect(off).toBeLessThan(3.4);
    // 곡 길이는 소리가 먼저 끊겨도 악보상 끝(6초). 반복 구간·재생 끝이 악보와 맞아야 한다
    expect(s.duration).toBe(6);
    // 다른 음으로 붙여도 첫 음부터 재므로, 샘플이 끝난 뒤의 음은 소리 내지 않는다
    const t = buildSchedule(song([{ notes: [n("a", [0, 1], [1, 1], 60, { tie: "next" }), n("b", [1, 1], [1, 1], 62, { tie: "next" }), n("c", [2, 1], [1, 1], 64)] }]), MOBILE_PROFILE);
    expect(t.events.map((e) => [e.type, e.bend ?? null])).toEqual([["on", null], ["bend", 2], ["off", null], ["bend", 0]]);
    expect(t.events.find((e) => e.type === "off")!.time).toBeLessThan(3.4);
  });

  it("음소거·솔로", () => {
    const tracks = [{ notes: [n("a", [0, 1], [1, 4], 60)] }, { notes: [n("b", [0, 1], [1, 4], 64)], solo: true }];
    expect(buildSchedule(song(tracks), MOBILE_PROFILE).events.map((e) => e.note)).toEqual([64, 64]);
  });

  it("커서 위치부터: 걸친 음은 그 위치에서 시작", () => {
    const s = buildSchedule(song([{ notes: [n("a", [0, 1], [1, 2], 60), n("b", [1, 2], [1, 4], 62)] }]), MOBILE_PROFILE, { from: rat(1, 4) });
    expect(s.events.map((e) => [e.type, e.time, e.note])).toEqual([
      ["on", 0, 60], ["off", 0.5, 60], ["on", 0.5, 62], ["off", 1, 62],
    ]);
  });
});

describe("velocityForVolume", () => {
  it("v 최대 = 127, v0 = 소리 없음, 단조 증가", () => {
    expect(velocityForVolume(MOBILE_PROFILE, 15)).toBe(127);
    expect(velocityForVolume(MOBILE_PROFILE, 0)).toBe(0);
    const vs = Array.from({ length: 15 }, (_, i) => velocityForVolume(MOBILE_PROFILE, i + 1));
    expect(vs.every((v, i) => i === 0 || v >= vs[i - 1]!)).toBe(true);
  });

  it("실측 곡선이면 세기 = v×127/15", () => {
    for (let v = 1; v <= 15; v++) expect(velocityForVolume(MOBILE_PROFILE, v)).toBe(Math.round((v * 127) / 15));
  });

  it("번호로만 아는 악기(#42.3)도 canonicalOf가 알려 준 악기의 음역·샘플 길이로 그린다", () => {
    const base = emptySong({ title: "", author: "", profileId: "mobile" });
    const song: Song = {
      ...base,
      tempo: [{ at: rat(0), bpm: 120 }],
      players: [{ id: "p", name: "", instrument: { canonical: `mabi:${3 * 512 + 42}`, program: 3 * 512 + 42 } }],
      tracks: [{ id: "t", playerId: "p", name: "", color: "", role: "free", mute: false, solo: false, spelling: {},
        notes: [{ id: "n", start: rat(0), dur: rat(1), pitch: 48, vol: 15, tie: "none" }] }],
    };
    const plain = buildSchedule(song, MOBILE_PROFILE);
    expect(plain.events.find((e) => e.type === "on")?.note).toBe(48);
    const known = buildSchedule(song, MOBILE_PROFILE, { canonicalOf: () => "cat-harmonica" });
    const on = known.events.find((e) => e.type === "on")!;
    const off = known.events.find((e) => e.type === "off")!;
    expect(on.note).toBe(72);
    expect(off.time).toBeLessThan(1);
    // 패치는 원래 번호로 찾는다
    expect(known.slots[0]).toMatchObject({ instrument: `mabi:${3 * 512 + 42}`, program: 3 * 512 + 42 });
  });
});
