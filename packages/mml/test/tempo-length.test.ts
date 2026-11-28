import { describe, expect, it } from "vitest";
import { add, cmp, emptySong, eq, History, normalizeTempo, rat, songProfile, tempoClock, toFloat, type Rat, type Song } from "@mmlce/core";
import { gameScores, mergeTies, parseMml, parseTrackText, songChordsPerScore, tempoJumps, tempoToLengths, tempoToLengthsResult } from "../src/index.js";

/** 원문마다 연주자를 따로 둔 곡 (tempo-convert.test.ts와 같은 모양) */
function songOf(texts: string[], extra: Partial<Song> = {}): Song {
  const tracks = texts.map((text, k) => {
    const parsed = parseTrackText(`t${k + 1}`, { text });
    return {
      id: `t${k + 1}`,
      playerId: `p${k + 1}`,
      name: `t${k + 1}`,
      color: "#000",
      role: "free" as const,
      mute: false,
      solo: false,
      notes: parsed.notes,
      spelling: {},
      mml: { text },
      tempo: parsed.tempo,
    };
  });
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: normalizeTempo(tracks.flatMap((t) => t.tempo)),
    players: texts.map((_, k) => ({ id: `p${k + 1}`, name: "피아노", instrument: { canonical: "piano" as const } })),
    tracks: tracks.map(({ tempo: _t, ...t }) => t),
    ...extra,
  };
}

/** 곡 모델의 음 시작 초 (음 id → 초) */
function starts(song: Song): Map<string, number> {
  const clock = tempoClock(song.tempo);
  return new Map(song.tracks.flatMap((t) => t.notes.map((n) => [n.id, clock(n.start)] as const)));
}

/** 게임에 붙여넣는 글을 다시 읽은 음 시작 초 (트랙마다 & 이은 음은 하나로, 위치순) */
function heardStarts(song: Song): number[][] {
  const out: number[][] = [];
  for (const score of gameScores(song, songChordsPerScore(song))) {
    const channels = score.text.replace(/^MML@/, "").replace(/;$/, "").split(",").map((text) => parseMml(text));
    const clock = tempoClock(normalizeTempo(channels.flatMap((c) => c.tempo)));
    for (const c of channels) out.push(mergeTies(c.notes).map((n) => clock(n.start)));
  }
  return out;
}

/** 음 사이 간격(초)을 템포로 맞춘 16분음표 줄: 음마다 t를 바꿔 그 길이가 되게 한다 */
function zigzag(ms: readonly number[], pitch = "c"): string {
  return ms.map((m) => `t${Math.round(15000 / m)}${pitch}16`).join("");
}

const span = (a: Rat, b: Rat | undefined) => [[a, b] as const];

describe("tempoToLengthsResult: 템포로 때운 구간을 음 길이로 바꾸기", () => {
  it("구간 안 템포를 하나로 펴고, 음 시작은 격자의 반 안에서 지금 시각을 지킨다", () => {
    const song = songOf([zigzag([100, 77, 196, 125, 125, 125, 105, 105]) + "t100c4"]);
    const before = starts(song);
    const r = tempoToLengthsResult(song, span(rat(0), rat(1, 2)), { scale: 1 });
    expect(r.failed).toEqual([]);
    const tempo = normalizeTempo(r.song.tempo);
    // 구간 안 템포 하나 + 구간 끝에서 원래 템포(t100)
    expect(tempo.filter((e) => cmp(e.at, rat(1, 2)) < 0)).toHaveLength(1);
    expect(tempo.find((e) => eq(e.at, rat(1, 2)))?.bpm).toBe(100);
    const bpm = tempo[0]!.bpm;
    const half = 120 / (64 * bpm);
    const after = starts(r.song);
    for (const [id, sec] of before) expect(Math.abs(after.get(id)! - sec)).toBeLessThanOrEqual(half + 0.004);
    expect(r.maxError).toBeLessThanOrEqual(half + 0.004);
    // 구간 끝 뒤 음 자리는 그대로 (s = 1)
    expect(r.song.tracks[0]!.notes.at(-1)!.start).toEqual(rat(1, 2));
    // 게임 출력도 같은 시각으로 읽힌다
    const heard = heardStarts(r.song)[0]!;
    r.song.tracks[0]!.notes.forEach((n, i) => expect(heard[i]).toBeCloseTo(after.get(n.id)!, 6));
  });

  it("조표 바뀜도 그 자리 음과 함께 옮긴다", () => {
    const base = songOf([zigzag([100, 77, 196, 125, 125, 125, 105, 105]) + "t100c4"]);
    const song: Song = { ...base, keys: [{ at: rat(0), fifths: 0 }, { at: rat(1, 8), fifths: 2 }] };
    const at = song.tracks[0]!.notes.find((n) => eq(n.start, rat(1, 8)))!;
    const r = tempoToLengthsResult(song, span(rat(0), rat(1, 2)), { scale: 1 });
    expect(r.failed).toEqual([]);
    const moved = r.song.tracks[0]!.notes.find((n) => n.id === at.id)!;
    expect(r.song.keys?.map((k) => k.fifths)).toEqual([0, 2]);
    expect(r.song.keys?.[1]!.at).toEqual(moved.start);
    expect(r.song.keys?.[0]!.at).toEqual(rat(0));
  });

  it("64분 간격이 거칠면 배율 2로 템포와 길이를 두 배로 하고 마디 길이도 함께 바꾼다", () => {
    // 구간 평균 t64 근처: s = 1이면 격자 오차 29ms, s = 2면 15ms
    const ms = [100, 77, 196, 125, 125, 125, 105, 105].map((m) => m * 1.9);
    const song = songOf([zigzag(ms) + "t90c4"]);
    const before = starts(song);
    const r = tempoToLengthsResult(song, span(rat(0), rat(1, 2)));
    expect(r.failed).toEqual([]);
    expect(r.spans[0]).toMatchObject({ scale: 2 });
    expect(r.meters.length).toBeGreaterThan(0);
    // 구간 뒤 음은 구간이 늘어난 만큼(0.5) 밀리고 시각은 그대로
    const last = r.song.tracks[0]!.notes.at(-1)!;
    expect(last.start).toEqual(rat(1));
    const after = starts(r.song);
    // 구간 뒤는 마지막 조각의 정수 템포 반올림 오차만큼만 (t130 근처 온음표 하나에 10ms 안)
    expect(Math.abs(after.get(last.id)! - before.get(last.id)!)).toBeLessThanOrEqual(0.01);
    expect(r.maxError).toBeLessThanOrEqual(0.015 + 0.004);
  });

  it("배율을 1로 묶으면 마디 길이를 바꾸지 않는다", () => {
    const ms = [100, 77, 196, 125, 125, 125, 105, 105].map((m) => m * 2);
    const song = songOf([zigzag(ms) + "t90c4"]);
    const r = tempoToLengthsResult(song, span(rat(0), rat(1, 2)), { scale: 1 });
    expect(r.failed).toEqual([]);
    expect(r.spans[0]).toMatchObject({ scale: 1 });
    expect(r.meters).toEqual([]);
    expect(r.song.tracks[0]!.notes.at(-1)!.start).toEqual(rat(1, 2));
  });

  it("화음은 같은 자리로 가고, 트랙을 건너 가까운 시작은 한 점으로 모여도 실패하지 않는다", () => {
    const a = zigzag([100, 77, 196, 125, 125, 125, 105, 105]);
    // 둘째 트랙: 같은 템포 지도에서 같은 리듬 (화음) + 첫 음만 64분 하나 늦게 (가까운 시작)
    const song = songOf([a + "t100c4", "r64e32." + "e16e16e16e16e16e16e16"]);
    const r = tempoToLengthsResult(song, span(rat(0), rat(1, 2)), { scale: 1, grid: rat(1, 32) });
    expect(r.failed).toEqual([]);
    const [t1, t2] = r.song.tracks;
    // 둘째 음부터 첫 트랙과 같은 자리 (화음)
    for (let i = 1; i < 8; i++) expect(t2!.notes[i]!.start).toEqual(t1!.notes[i]!.start);
    // 첫 음은 64분 하나(약 30ms) 늦은 자리라 같은 점으로 모일 수 있고, 모여도 실패하지 않는다
    expect(cmp(t2!.notes[0]!.start, t1!.notes[0]!.start)).toBeGreaterThanOrEqual(0);
  });

  it("길이 0이 될 음만 끝을 한 칸 민다", () => {
    // 64분음표 하나가 t255로 아주 짧다 → 1/16 격자에서 시작과 끝이 같은 점
    const song = songOf(["t60c8t255d64t60e16.f4"]);
    const r = tempoToLengthsResult(song, span(rat(0), rat(1, 4)), { scale: 1, grid: rat(1, 16) });
    expect(r.failed).toEqual([]);
    expect(r.collapsed).toBe(1);
    const notes = r.song.tracks[0]!.notes;
    for (const n of notes) expect(n.dur.n).toBeGreaterThan(0);
    for (let i = 1; i < notes.length; i++) expect(cmp(notes[i]!.start, add(notes[i - 1]!.start, notes[i - 1]!.dur))).toBeGreaterThanOrEqual(0);
  });

  it("밀 자리가 없으면 곡을 바꾸지 않고 알린다", () => {
    const song = songOf(["t60c16t255d64e64f64g64t60c4"]);
    const r = tempoToLengthsResult(song, span(rat(0), rat(1, 8)), { scale: 1, grid: rat(1, 16) });
    expect(r.failed.map((f) => f.kind)).toContain("crowded");
    expect(r.song).toBe(song);
  });

  it("고른 격자가 구간 길이를 나누지 못하면 적용 전에 알린다", () => {
    const song = songOf(["t100c16d16e16 t80f4"]);
    const r = tempoToLengthsResult(song, span(rat(0), rat(3, 16)), { scale: 1, grid: rat(1, 24) });
    expect(r.failed).toEqual([{ kind: "grid", at: rat(0), grid: rat(1, 24), length: rat(3, 16) }]);
    // 자동 격자는 나누는 격자만 고른다
    const auto = tempoToLengthsResult(song, span(rat(0), rat(3, 16)), { scale: 1, grid: "auto" });
    expect(auto.failed).toEqual([]);
    expect([rat(1, 16), rat(1, 32), rat(1, 64)].some((g) => eq(g, auto.spans[0]!.grid))).toBe(true);
  });

  it("마디 가운데서 시작하는 구간: 구간 앞 음과 구간에 걸친 음의 바깥 끝은 그대로", () => {
    const song = songOf(["t120c4. " + zigzag([90, 140, 110]) + "t120c8 c2"]);
    // 구간 [7/16, 5/8): 첫 음(c4.)은 구간 앞, 그 뒤가 고칠 곳
    const r = tempoToLengthsResult(song, span(rat(7, 16), rat(5, 8)), { scale: 1 });
    expect(r.failed).toEqual([]);
    const notes = r.song.tracks[0]!.notes;
    expect(notes[0]!.start).toEqual(rat(0));
    expect(notes[0]!.dur).toEqual(rat(3, 8));
    // c8은 구간에 걸쳐 끝(11/16)만 바깥이라 그대로, 그 뒤 c2도 그대로
    expect(add(notes.at(-2)!.start, notes.at(-2)!.dur)).toEqual(rat(11, 16));
    expect(notes.at(-1)!.start).toEqual(rat(11, 16));
  });

  it("붙임줄 사슬은 이어진 채로, 만든 기록과 마커도 같은 자리로 옮긴다", () => {
    const base = songOf(["t90c16t150c16&c16t70d16t200e16f16g16a16 t100c4"]);
    const n2 = base.tracks[0]!.notes[2]!;
    const song: Song = {
      ...base,
      markers: [{ id: "mk1", at: n2.start, label: "A" }],
      made: [{ id: "m1", tool: "grace", options: {}, picked: [n2.id], before: [], after: [{ trackId: "t1", notes: [{ ...n2, made: "m1" }] }] }],
    };
    const r = tempoToLengthsResult(song, span(rat(0), rat(1, 2)), { scale: 1 });
    expect(r.failed).toEqual([]);
    const notes = r.song.tracks[0]!.notes;
    const tied = notes[1]!;
    expect(tied.tie).toBe("next");
    expect(add(tied.start, tied.dur)).toEqual(notes[2]!.start);
    expect(r.song.markers[0]!.at).toEqual(notes[2]!.start);
    expect(r.song.made![0]!.after[0]!.notes[0]!.start).toEqual(notes[2]!.start);
  });

  it("5/4 마디에서 마디마다 펴면 마디선마다 템포 하나", () => {
    const song = songOf([zigzag([120, 90, 150, 100, 130, 110, 100, 140, 95, 120, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]) + "t100c4"], {
      timeSig: [{ at: rat(0), beats: 5, unit: 4 }],
    });
    const r = tempoToLengthsResult(song, span(rat(0), rat(15, 8)), { scale: 1, unit: "bar" });
    expect(r.failed).toEqual([]);
    const inside = normalizeTempo(r.song.tempo).filter((e) => cmp(e.at, rat(15, 8)) < 0);
    expect(inside.every((e) => eq(e.at, rat(0)) || eq(e.at, rat(5, 4)))).toBe(true);
  });

  it("박마다 펴서 템포가 게임 범위 밖이면 곡을 바꾸지 않고 그 자리를 알린다", () => {
    // 둘째 박이 t300으로 아주 빠르다
    const song = songOf(["t100c4t300d8d8t100e4f4"]);
    const r = tempoToLengthsResult(song, span(rat(0), rat(1)), { scale: 1, unit: "beat" });
    expect(r.failed).toContainEqual({ kind: "range", at: rat(1, 4), bpm: 300 });
    expect(r.song).toBe(song);
  });

  it("원곡 시작점을 주면 음 시작을 그 시각으로 옮긴다", () => {
    const song = songOf(["t120c8d8e8f8 c4"]);
    const n = song.tracks[0]!.notes;
    // d를 30ms 늦게, e를 20ms 이르게
    const anchors = [
      { at: n[1]!.start, seconds: 0.25 + 0.03 },
      { at: n[2]!.start, seconds: 0.5 - 0.02 },
    ];
    const r = tempoToLengthsResult(song, span(rat(0), rat(1, 2)), { scale: 1, anchors });
    expect(r.failed).toEqual([]);
    const after = starts(r.song);
    const bpm = normalizeTempo(r.song.tempo)[0]?.bpm ?? 120;
    const half = 120 / (64 * bpm) + 0.004;
    expect(Math.abs(after.get(n[1]!.id)! - 0.28)).toBeLessThanOrEqual(half);
    expect(Math.abs(after.get(n[2]!.id)! - 0.48)).toBeLessThanOrEqual(half);
  });

  it("실행 취소 한 번으로 완전히 돌아온다", () => {
    const song = songOf([zigzag([100, 77, 196, 125, 125, 125, 105, 105]) + "t100c4"]);
    const h = new History(song);
    const next = h.run(tempoToLengths(span(rat(0), rat(1, 2)), { scale: 1 }));
    expect(next).not.toBe(song);
    h.undo();
    expect(h.song).toEqual(song);
  });

  it("여러 구간은 뒤에서부터 바꿔 앞 구간 자리가 그대로다", () => {
    const z = zigzag([200, 154, 392, 250, 250, 250, 210, 210]);
    const song = songOf([z + "t90c4" + z + "t90c4"]);
    const r = tempoToLengthsResult(song, [[rat(0), rat(1, 2)], [rat(3, 4), rat(5, 4)]]);
    expect(r.failed).toEqual([]);
    expect(r.spans).toHaveLength(2);
    expect(r.spans.every((s) => s.scale > 1)).toBe(true);
    expect(r.maxError).toBeLessThanOrEqual(0.02);
  });
});

describe("tempoJumps: 템포가 튀는 곳", () => {
  it("한 박 안에 템포가 둘 이상이고 큰 값 ÷ 작은 값 ≥ 1.4인 박만", () => {
    const song = songOf(["t100c8t150c8 t100c8t130c8 t100c4"]);
    const jumps = tempoJumps(song);
    expect(jumps).toEqual([{ from: rat(0), to: rat(1, 4), min: 100, max: 150 }]);
    expect(toFloat(jumps[0]!.to)).toBe(0.25);
  });
});

describe("템포를 음 길이로 바꾸기: 범위 메모", () => {
  it("구간 안 범위 메모는 시작과 끝을 함께 옮겨 끝이 시작보다 앞이 되지 않는다", () => {
    const base = songOf(["t60c8t240d8t120e4"]);
    const song: Song = { ...base, markers: [{ id: "m1", at: rat(1, 8), end: rat(3, 16), label: "다시 확인", kind: "memo" }] };
    const r = tempoToLengthsResult(song, span(rat(0), rat(1, 4)), { scale: 1 });
    const memo = r.song.markers.find((m) => m.id === "m1")!;
    expect(cmp(memo.at, rat(1, 8))).not.toBe(0);
    if (memo.end) expect(cmp(memo.end, memo.at)).toBeGreaterThan(0);
  });
});

describe("템포를 음 길이로 바꾸기: PC 곡 끝", () => {
  it("PC 곡은 원문 끝을 틱 셈으로 읽어 곡 전체 구간을 정한다 (c5&c19 = 96/384)", () => {
    const text = "c5&c19";
    const lengths = songProfile(emptySong({ title: "", author: "", profileId: "pc" })).length;
    const base = songOf(["c4"]);
    const song: Song = { ...base, meta: { ...base.meta, profileId: "pc" }, tracks: [{ ...base.tracks[0]!, notes: parseTrackText("t1", { text }, lengths).notes, mml: { text } }] };
    const r = tempoToLengthsResult(song, span(rat(0), undefined), { scale: 1 });
    expect(r.failed).toEqual([]);
  });
});
