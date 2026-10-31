import { describe, expect, it } from "vitest";
import { breakTimbreTies, crossesTimbre, emptySong, MOBILE_PROFILE, planSlide, planSlides, rat, timbreBoundaries, type GameProfile, type Note, type Rat, type SlideOptions, type Song } from "../src/index.js";

const n = (id: string, start: Rat, dur: Rat, pitch: number, extra: Partial<Note> = {}): Note => ({ id, start, dur, pitch, vol: 10, tie: "none", ...extra });

function songOf(notes: Note[]): Song {
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: [{ at: rat(0), bpm: 120 }],
    players: [{ id: "p1", name: "p", instrument: { canonical: "folk-guitar" } }],
    tracks: [{ id: "t1", playerId: "p1", name: "t", color: "", role: "free", mute: false, solo: false, notes, spelling: {} }],
  };
}

const base: SlideOptions = { kind: "between", path: "chromatic", direction: "down", semitones: 2, length: rat(1, 16), instrument: "folk-guitar" };
let k = 0;
const newId = () => `s${++k}`;
const run = (notes: Note[], picked: string[], options: Partial<SlideOptions> = {}, profile: GameProfile = MOBILE_PROFILE) => {
  const s = songOf(notes);
  return planSlide(s, "t1", notes.filter((x) => picked.includes(x.id)), { ...base, ...options }, profile, newId);
};
const shape = (notes: readonly Note[] | undefined) => (notes ?? []).map((x) => `${x.pitch}@${x.start.n}/${x.start.d}+${x.dur.n}/${x.dur.d}${x.tie === "next" ? "&" : ""}`);

// 4분음표 두 개 (0과 1/4)
const pair = (p: number, q: number, extra: Partial<Note> = {}) => [n("a", rat(0), rat(1, 4), p, extra), n("b", rat(1, 4), rat(1, 4), q)];

describe("두 음 사이", () => {
  it("c4d4 → c8.&c+16&d4 (사이 음 하나)", () => {
    const r = run(pair(60, 62), ["a", "b"]);
    expect(shape(r.notes)).toEqual(["60@0/1+3/16&", "61@3/16+1/16&", "62@1/4+1/4"]);
    expect(r.made).toBe(1);
    expect(r.chain).toHaveLength(3);
  });

  it("c4e4: 사이 음 셋(c+·d·d+)이 1/48씩 (d−1부터 줄여 가며 처음 써지는 걸음)", () => {
    const r = run(pair(60, 64), ["a", "b"]);
    expect(shape(r.notes)).toEqual(["60@0/1+3/16&", "61@3/16+1/48&", "62@5/24+1/48&", "63@11/48+1/48&", "64@1/4+1/4"]);
    expect(r.skippedSemitones).toBe(0);
  });

  it("한 걸음을 직접 고르면 그 길이로 나누고 남는 것은 출발 음에, 걸음이 모자라면 반음을 건너뛴다", () => {
    // c4e4, 걸음 1/32: 1/16에 둘 → 사이 음 둘(c+·d+ 근처: 60 + round(4i/3) = 61, 63)
    const r = run(pair(60, 64), ["a", "b"], { step: rat(1, 32) });
    expect(shape(r.notes)).toEqual(["60@0/1+3/16&", "61@3/16+1/32&", "63@7/32+1/32&", "64@1/4+1/4"]);
    expect(r.skippedSemitones).toBe(1);
  });

  it("c4g4: 1/96·1/80은 게임 길이가 아니라 1/64씩 넷으로, 반음을 건너뛴다", () => {
    const r = run(pair(60, 67), ["a", "b"]);
    expect(shape(r.notes).slice(1, 5)).toEqual(["61@3/16+1/64&", "63@13/64+1/64&", "64@7/32+1/64&", "66@15/64+1/64&"]);
    expect(r.skippedSemitones).toBe(1);
  });

  it("가짜 한도(128분음표까지)에서는 같은 입력이 반음 건너뛰기 없이 나뉜다", () => {
    const wide = { ...MOBILE_PROFILE, length: { min: 1, max: 128, dots: 1 } };
    const r = run(pair(60, 67), ["a", "b"], {}, wide);
    expect(r.skippedSemitones).toBe(0);
    expect(shape(r.notes)).toHaveLength(8);
  });

  it("셋잇단: c12d12는 분수 그대로, 미끄러지는 길이가 음보다 길면 줄이고 나눌 수 없으면 건너뛴다", () => {
    const t = [n("a", rat(0), rat(1, 12), 60), n("b", rat(1, 12), rat(1, 12), 62)];
    expect(shape(run(t, ["a", "b"]).notes)).toEqual(["60@0/1+1/48&", "61@1/48+1/16&", "62@1/12+1/12"]);
    const long = run(t, ["a", "b"], { length: rat(1, 8) });
    expect(long.shortened).toBe(1);
    expect(long.skipped.unsplittable).toBe(1);
    expect(long.notes).toBeUndefined();
  });

  it("바로: 사이 음 없이 &만", () => {
    expect(shape(run(pair(60, 62), ["a", "b"], { path: "direct" }).notes)).toEqual(["60@0/1+1/4&", "62@1/4+1/4"]);
  });

  it("이어지지 않은 쌍·같은 높이·너무 짧은 음은 건너뛴다", () => {
    const gap = run([n("a", rat(0), rat(1, 4), 60), n("b", rat(1, 2), rat(1, 4), 62)], ["a", "b"]);
    expect([gap.skipped.gap, gap.made]).toEqual([1, 0]);
    expect(run(pair(60, 60), ["a", "b"]).skipped.same).toBe(1);
    expect(run([n("a", rat(0), rat(1, 64), 60), n("b", rat(1, 64), rat(1, 4), 62)], ["a", "b"]).skipped.short).toBe(1);
  });

  it("같은 사슬에 두 번 적용해도 결과가 같다", () => {
    const once = run(pair(60, 64), ["a", "b"]).notes!;
    const twice = run([...once], once.map((x) => x.id));
    expect(shape(twice.notes ?? once)).toEqual(shape(once));
  });

  it("사이 음 v는 사슬 첫 음 v, 출발 음 타브 줄을 이어받는다", () => {
    const r = run([n("a", rat(0), rat(1, 4), 60, { vol: 13, tabString: 2 }), n("b", rat(1, 4), rat(1, 4), 64, { vol: 5 })], ["a", "b"]);
    expect(r.notes!.map((x) => [x.vol, x.tabString])).toEqual([[13, 2], [13, 2], [13, 2], [13, 2], [5, 2]]);
  });
});

describe("들어가기·나가기", () => {
  it("들어가기 아래 2반음: 앞부분이 a+·b로 시작해 c로, 원래 v는 첫 사이 음으로", () => {
    const r = run([n("c", rat(0), rat(1, 4), 60, { vol: 12 })], ["c"], { kind: "in" });
    expect(shape(r.notes)).toEqual(["58@0/1+1/32&", "59@1/32+1/32&", "60@1/16+3/16"]);
    expect(r.notes![0]!.vol).toBe(12);
  });

  it("나가기 위 3반음: 끝부분에서 올라가고 마지막 사이 음은 &가 없다", () => {
    const r = run([n("c", rat(0), rat(1, 4), 60)], ["c"], { kind: "out", direction: "up", semitones: 3 });
    expect(shape(r.notes)).toEqual(["60@0/1+3/16&", "61@3/16+1/48&", "62@5/24+1/48&", "63@11/48+1/48"]);
  });

  it("이미 이어진 음은 건너뛰고, 고르지 않은 다음 음은 그대로", () => {
    const tied = [n("a", rat(0), rat(1, 4), 55, { tie: "next" }), n("c", rat(1, 4), rat(1, 4), 60), n("z", rat(1, 2), rat(1, 4), 70)];
    expect(run(tied, ["c"], { kind: "in" }).skipped.tied).toBe(1);
    const out = run(tied, ["c"], { kind: "out" });
    expect(out.notes!.find((x) => x.id === "z")).toEqual(tied[2]);
  });
});

describe("게임 제약", () => {
  it("높이 차 한도: 사슬 첫 음에서 24반음을 넘으면 만들지 않는다 (앞에서 이어 온 사슬, 뒤에 이어진 음 포함)", () => {
    expect(run(pair(48, 73), ["a", "b"], { path: "direct" }).skipped.bend).toBe(1);
    const before = [n("x", rat(0), rat(1, 4), 48, { tie: "next" }), n("a", rat(1, 4), rat(1, 4), 60), n("b", rat(1, 2), rat(1, 4), 73)];
    expect(run(before, ["a", "b"]).skipped.bend).toBe(1);
    const after = [n("a", rat(0), rat(1, 4), 60), n("b", rat(1, 4), rat(1, 4), 62, { tie: "next" }), n("y", rat(1, 2), rat(1, 4), 86)];
    expect(run(after, ["a", "b"]).skipped.bend).toBe(1);
  });

  it("높이 차 한도는 프로필(tieBendLimit)에서 읽는다", () => {
    // 모바일(24반음)에서는 만드는 10반음 미끄러짐도 한도를 4로 줄인 프로필에서는 건너뛴다
    expect(run(pair(60, 70), ["a", "b"], { path: "direct" }).skipped.bend).toBe(0);
    expect(run(pair(60, 70), ["a", "b"], { path: "direct" }, { ...MOBILE_PROFILE, tieBendLimit: 4 }).skipped.bend).toBe(1);
  });

  it("샘플 끝에 닿는 사슬을 센다", () => {
    const tiny = { ...MOBILE_PROFILE, sampleSeconds: { "folk-guitar": [{ from: 0, seconds: 0.3 }] } };
    expect(run(pair(60, 62), ["a", "b"], {}, tiny).sampleCut).toBe(1);
    expect(run(pair(60, 62), ["a", "b"]).sampleCut).toBe(0);
  });

  it("잠긴 트랙은 바꾸지 않는다", () => {
    const r = run(pair(60, 62), ["a", "b"], { locked: new Set(["t1"]) });
    expect([r.locked, r.notes]).toEqual([true, undefined]);
  });
});

describe("직접 정한 걸음의 남은 길이 (PR #138 점검 7)", () => {
  // c4 하나, 반음씩·아래 2반음·슬라이드 길이 8·한 걸음 32
  const one = () => [n("c", rat(0), rat(1, 4), 60)];
  const custom = { path: "chromatic" as const, direction: "down" as const, semitones: 2, length: rat(1, 8), step: rat(1, 32) };

  it("들어가기: 사이 음 바로 뒤에 원래 음이 &로 빈틈 없이 이어진다", () => {
    const r = run(one(), ["c"], { ...custom, kind: "in" });
    expect(shape(r.notes)).toEqual(["58@0/1+1/32&", "59@1/32+1/32&", "60@1/16+3/16"]);
  });
  it("나가기: 전체 소리가 원래 끝 1/4에서 끝난다", () => {
    const r = run(one(), ["c"], { ...custom, kind: "out" });
    expect(shape(r.notes)).toEqual(["60@0/1+3/16&", "59@3/16+1/32&", "58@7/32+1/32"]);
  });
  it("자동 걸음은 지금 결과 그대로 (들어가기·나가기)", () => {
    const { step: _step, ...auto } = custom;
    expect(shape(run(one(), ["c"], { ...auto, kind: "in" }).notes)).toEqual(["58@0/1+1/16&", "59@1/16+1/16&", "60@1/8+1/8"]);
    expect(shape(run(one(), ["c"], { ...auto, kind: "out" }).notes)).toEqual(["60@0/1+1/8&", "59@1/8+1/16&", "58@3/16+1/16"]);
  });
});

describe("박 앞 들어가기 (꾸밈음과 같은 자리 계산)", () => {
  const before = { kind: "in" as const, timing: "before" as const };
  it("앞 음 꼬리에서 가져와 도착 음은 제 박에 그대로, 앞 음 &는 푼다", () => {
    const r = run([n("p", rat(0), rat(1, 4), 55, { tie: "next" }), n("c", rat(1, 4), rat(1, 4), 60)], ["c"], before);
    // p가 c에 &로 이어져 있으면 이미 이어진 음
    expect(r.skipped.tied).toBe(1);
    const ok = run([n("p", rat(0), rat(1, 4), 55), n("c", rat(1, 4), rat(1, 4), 60)], ["c"], before);
    expect(shape(ok.notes)).toEqual(["55@0/1+3/16", "58@3/16+1/32&", "59@7/32+1/32&", "60@1/4+1/4"]);
  });
  it("앞이 쉼표면 쉼표가 줄고, 곡 처음보다 앞이면 건너뛴다", () => {
    expect(shape(run([n("c", rat(1, 4), rat(1, 4), 60)], ["c"], before).notes)).toEqual(["58@3/16+1/32&", "59@7/32+1/32&", "60@1/4+1/4"]);
    expect(run([n("c", rat(0), rat(1, 4), 60)], ["c"], before).skipped.short).toBe(1);
  });
  it("앞 음이 최단보다 짧게 남으면 건너뛴다", () => {
    const r = run([n("p", rat(0), rat(1, 16), 55), n("c", rat(1, 16), rat(1, 4), 60)], ["c"], before);
    expect([r.made, r.skipped.short]).toEqual([0, 1]);
  });
});

describe("들어가고 나가기 (한 음에 / \\ 둘 다)", () => {
  it("/14\\: 아래에서 들어와 아래로 나간다. 원래 시작·끝은 그대로", () => {
    const r = run([n("c", rat(0), rat(1, 4), 60)], ["c"], { kind: "both", out: { direction: "down", semitones: 2, length: rat(1, 16) } });
    expect(shape(r.notes)).toEqual(["58@0/1+1/32&", "59@1/32+1/32&", "60@1/16+1/8&", "59@3/16+1/32&", "58@7/32+1/32"]);
    expect(r.chain).toHaveLength(5);
  });
  it("\\14/: 위에서 들어와 위로, 나가는 쪽 거리·길이는 따로", () => {
    const r = run([n("c", rat(0), rat(1, 4), 60)], ["c"], { kind: "both", direction: "up", semitones: 1, out: { direction: "up", semitones: 3, length: rat(1, 16) } });
    expect(shape(r.notes)).toEqual(["61@0/1+1/16&", "60@1/16+1/8&", "61@3/16+1/48&", "62@5/24+1/48&", "63@11/48+1/48"]);
  });
  it("박 앞 들어가기 + 나가기: 들어가는 쪽은 앞 쉼표에서", () => {
    const r = run([n("c", rat(1, 4), rat(1, 4), 60)], ["c"], { kind: "both", timing: "before", semitones: 1, out: { direction: "down", semitones: 1, length: rat(1, 16) } });
    expect(shape(r.notes)).toEqual(["59@3/16+1/16&", "60@1/4+3/16&", "59@7/16+1/16"]);
  });
  it("두 쪽 합이 음보다 길면 둘 다 줄인다 (원래 길이는 그대로)", () => {
    const r = run([n("c", rat(0), rat(1, 8), 60)], ["c"], { kind: "both", semitones: 1, out: { direction: "down", semitones: 1, length: rat(1, 16) } });
    expect(r.shortened).toBe(1);
    expect(r.made).toBe(1);
    const total = r.notes!.reduce((m, x) => m + x.dur.n / x.dur.d, 0);
    expect(total).toBeCloseTo(1 / 8);
  });
});

describe("음색 경계에서 끊기", () => {
  it("포크 기타 경계는 실측 샘플 구간 시작 (o3e·o4e·o5f·o6f)", () => {
    expect(timbreBoundaries(MOBILE_PROFILE, "folk-guitar")).toEqual([52, 64, 77, 89]);
    expect(timbreBoundaries(MOBILE_PROFILE, "piano")).toEqual([52, 64, 77, 89]);
    expect(crossesTimbre(MOBILE_PROFILE, "folk-guitar", 63, 64)).toBe(true);
    expect(crossesTimbre(MOBILE_PROFILE, "folk-guitar", 64, 66)).toBe(false);
  });
  it("켜면 경계를 넘는 사이 음 앞에서 &를 빼고, 끄면 세기만 한다", () => {
    const on = run(pair(62, 66), ["a", "b"], { breakAtZones: true });
    expect(shape(on.notes)).toEqual(["62@0/1+3/16&", "63@3/16+1/48", "64@5/24+1/48&", "65@11/48+1/48&", "66@1/4+1/4"]);
    expect([on.zoneBreaks, on.zoneCrossings, on.zoneAt.length]).toEqual([1, 0, 1]);
    const off = run(pair(62, 66), ["a", "b"]);
    expect([off.zoneBreaks, off.zoneCrossings]).toEqual([0, 1]);
    expect(shape(off.notes)[1]).toBe("63@3/16+1/48&");
  });
  it("바로 잇는 두 음이 경계를 넘으면 끊기를 켠 때 건너뛴다 (원래 &는 그대로)", () => {
    const r = run(pair(63, 64), ["a", "b"], { breakAtZones: true });
    expect([r.made, r.skipped.zone]).toEqual([0, 1]);
    const tied = run(pair(63, 64, { tie: "next" }), ["a", "b"], { breakAtZones: true });
    expect(tied.notes).toBeUndefined();
  });
  it("들어가기가 경계를 넘으면 도착 음을 다시 친다", () => {
    const r = run([n("c", rat(0), rat(1, 4), 64)], ["c"], { kind: "in", semitones: 2, breakAtZones: true });
    expect(shape(r.notes)).toEqual(["62@0/1+1/32&", "63@1/32+1/32", "64@1/16+3/16"]);
  });
  it("모두 끊기: 경계를 넘는 &만 빼고, 잠근 트랙은 그대로", () => {
    const s = songOf([n("a", rat(0), rat(1, 8), 63, { tie: "next" }), n("b", rat(1, 8), rat(1, 8), 64, { tie: "next" }), n("c", rat(1, 4), rat(1, 8), 66)]);
    const fixed = breakTimbreTies(s, MOBILE_PROFILE, () => "folk-guitar");
    expect(fixed.count).toBe(1);
    expect(fixed.changes[0]!.notes.map((x) => x.tie)).toEqual(["none", "next", "none"]);
    expect(breakTimbreTies(s, MOBILE_PROFILE, () => "folk-guitar", new Set(["t1"])).count).toBe(0);
  });
});

describe("여러 줄 (화음)", () => {
  function chordSong(t1: Note[], t2: Note[]): Song {
    const s = songOf(t1);
    return { ...s, tracks: [...s.tracks, { ...s.tracks[0]!, id: "t2", notes: t2 }] };
  }
  const opts = { ...base, instrumentOf: () => "folk-guitar" };
  it("빈 자리에서 화음 전체로 들어가기: 줄마다 자기 트랙에서, 트랙은 늘지 않는다", () => {
    const s = chordSong([n("a", rat(0), rat(1, 4), 59)], [n("b", rat(0), rat(1, 4), 55)]);
    const r = planSlides(s, [...s.tracks[0]!.notes, ...s.tracks[1]!.notes], { ...opts, kind: "in", semitones: 1 }, MOBILE_PROFILE, (id) => `${id}.n${++k}`);
    expect(r.changes.map((c) => [c.trackId, shape(c.notes)])).toEqual([
      ["t1", ["58@0/1+1/16&", "59@1/16+3/16"]],
      ["t2", ["54@0/1+1/16&", "55@1/16+3/16"]],
    ]);
    expect(r.made).toBe(2);
    expect(r.chain.filter((id) => id.startsWith("t2."))).toHaveLength(1);
  });
  it("두 화음을 함께 고르면 줄마다 두 음 사이 (모양 → 모양), 잠근 줄은 센다", () => {
    const s = chordSong([n("a", rat(0), rat(1, 4), 62), n("a2", rat(1, 4), rat(1, 4), 61)], [n("b", rat(0), rat(1, 4), 57), n("b2", rat(1, 4), rat(1, 4), 57)]);
    const all = s.tracks.flatMap((t) => t.notes);
    const r = planSlides(s, all, { ...opts, path: "direct" }, MOBILE_PROFILE, (id) => `${id}.n${++k}`);
    expect([r.made, r.skipped.same, r.changes.length]).toEqual([1, 1, 1]);
    const locked = planSlides(s, all, { ...opts, path: "direct", locked: new Set(["t1"]) }, MOBILE_PROFILE, (id) => `${id}.n${++k}`);
    expect([locked.locked, locked.made]).toEqual([1, 0]);
  });
  it("타브 줄: 보이는 줄(stringOf)을 사이 음에 넣는다", () => {
    const r = run([n("c", rat(0), rat(1, 4), 60)], ["c"], { kind: "in", semitones: 1, stringOf: () => 3 });
    expect(r.notes!.map((x) => x.tabString)).toEqual([3, undefined]);
  });
});
