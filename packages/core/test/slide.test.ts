import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, planSlide, rat, type GameProfile, type Note, type Rat, type SlideOptions, type Song } from "../src/index.js";

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
