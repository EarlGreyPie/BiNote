import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, PC_PROFILE, rat, type Note, type Player, type Song, type Track } from "@mmlce/core";
import { distributeChords, distributeSong, fitSlots, mergeResult, gameCharCounts, gameTimeline, mergeVoices, placeTempo, placeTempoByScore, trackLimits } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };

/** 음 n개 (k번째 음은 k/8 자리 8분음표, 높이가 조금씩 달라 글자 수가 음 수에 비례) */
function busy(n: number, from = 0, step = 1): Note[] {
  return Array.from({ length: n }, (_, k) => ({ id: `n${from + k}`, start: rat(from + k * step, 8), dur: rat(1, 8), pitch: 60 + ((k * 5) % 12), vol: 8, tie: "none" as const }));
}

function track(id: string, notes: Note[]): Track {
  return { id, playerId: "p1", name: id, color: "#000", role: "free", mute: false, solo: false, notes, spelling: {} };
}

function song(tracks: Track[]): Song {
  return { ...emptySong({ title: "", author: "", profileId: "pc" }), players: [piano], tracks, tempo: [{ at: rat(0), bpm: 120 }] };
}

describe("자리별 글자 수 한도 (PC)", () => {
  it("한도 표: 악보 안 곡 트랙 순서가 자리", () => {
    const s = song([track("a", []), track("b", []), track("c", [])]);
    expect([...trackLimits(s, PC_PROFILE)]).toEqual([
      ["a", 1200],
      ["b", 800],
      ["c", 500],
    ]);
  });

  it("화음 분산은 화음2 자리(500)를 넘친 트랙의 음을 여유 있는 자리로 보낸다", () => {
    // 멜로디는 앞 절반만, 화음2는 곡 전체를 친다 → 화음2 뒤 절반을 멜로디로 옮길 수 있다
    const s = song([track("a", busy(225)), track("b", []), track("c", busy(450))]);
    const before = gameCharCounts(s, 3, 3);
    expect(before.get("c")!).toBeGreaterThan(500);
    const r = distributeChords(s, PC_PROFILE);
    expect(r.moved).toBeGreaterThan(0);
    const after = gameCharCounts(r.song, 3, 3);
    const limits = trackLimits(r.song, PC_PROFILE);
    for (const [id, n] of after) expect(n, id).toBeLessThanOrEqual(limits.get(id)!);
  });

  it("병합은 받는 트랙마다 그 자리 한도를 지킨다", () => {
    // 받는 자리 한도가 아주 작으면 옮기지 않는다
    const sparse = busy(2, 400);
    const r = mergeVoices([busy(40), sparse], { limit: [10, 1200] });
    expect(r.moved).toBe(0);
  });
});

describe("자리 맞추기 (PC)", () => {
  const sizes = (s: Song) => gameCharCounts(s, 3, 3);
  it("작은 트랙이 큰 자리를 차지하면 글자 수 큰 순으로 자리를 맞바꿔 한도 안에 든다", () => {
    // 대략 400/700/1150자: 그대로면 화음1·화음2가 넘치고, 자리만 바꾸면 모두 들어간다
    const s = song([track("a", busy(280)), track("b", busy(490)), track("c", busy(800))]);
    const before = sizes(s);
    expect(before.get("c")!).toBeGreaterThan(800);
    expect(before.get("c")!).toBeLessThanOrEqual(1200);
    const r = fitSlots(s, PC_PROFILE);
    expect(r.song.tracks.map((t) => t.id)).toEqual(["c", "b", "a"]);
    expect(r.swaps).toEqual([{ playerId: "p1", index: 0, before: ["a", "b", "c"], after: ["c", "b", "a"] }]);
    const after = sizes(r.song);
    const limits = trackLimits(r.song, PC_PROFILE);
    for (const [id, n] of after) expect(n, id).toBeLessThanOrEqual(limits.get(id)!);
    expect(gameTimeline(r.song, PC_PROFILE)).toBe(gameTimeline(s, PC_PROFILE));
  });

  it("잠근 트랙은 큰 자리에 있어도 제자리, 나머지끼리만 바꾼다", () => {
    const s = song([track("a", busy(280)), track("b", busy(200)), track("c", busy(490))]);
    const r = fitSlots(s, PC_PROFILE, new Set(["a"]));
    expect(r.song.tracks.map((t) => t.id)).toEqual(["a", "c", "b"]);
  });

  it("넘침이 줄지 않으면 바꾸지 않는다", () => {
    const s = song([track("a", busy(20)), track("b", busy(40)), track("c", busy(60))]);
    const r = fitSlots(s, PC_PROFILE);
    expect(r.song).toBe(s);
    expect(r.swaps).toEqual([]);
  });

  it("1100/900/300: 화음 분산 명령(자리 맞추기 + 분산) 뒤 모든 트랙이 자리 한도 안", () => {
    const s = song([track("a", busy(770)), track("b", busy(630)), track("c", busy(210))]);
    expect(sizes(s).get("b")!).toBeGreaterThan(800);
    const after = distributeSong(PC_PROFILE).apply(s);
    expect(after).not.toBe(s);
    const limits = trackLimits(after, PC_PROFILE);
    for (const [id, n] of sizes(after)) expect(n, id).toBeLessThanOrEqual(limits.get(id)!);
    expect(gameTimeline(after, PC_PROFILE)).toBe(gameTimeline(s, PC_PROFILE));
  });

  it("작은 트랙이 앞에 있어도 분산 명령이 먼저 자리를 맞춘다", () => {
    const s = song([track("a", busy(280)), track("b", busy(490)), track("c", busy(800))]);
    const after = distributeSong(PC_PROFILE).apply(s);
    const limits = trackLimits(after, PC_PROFILE);
    for (const [id, n] of sizes(after)) expect(n, id).toBeLessThanOrEqual(limits.get(id)!);
    expect(gameTimeline(after, PC_PROFILE)).toBe(gameTimeline(s, PC_PROFILE));
  });

  it("병합으로 트랙이 빠지면 병합 뒤 자리를 맞춘다 (긴 트랙이 멜로디 자리로)", () => {
    // a는 앞에서 조금, b는 a가 쉬는 뒤쪽에서 더 조금: b가 a로 합쳐진다. c는 약 1000자라 화음 자리(800·500)에는 못 든다
    const s = song([track("a", busy(30)), track("b", busy(20, 40)), track("c", busy(700))]);
    const r = mergeResult(s, PC_PROFILE);
    expect(r.removed).toEqual(["b"]);
    expect(r.song.tracks.map((t) => t.id)).toEqual(["c", "a"]);
    const limits = trackLimits(r.song, PC_PROFILE);
    for (const [id, n] of sizes(r.song)) expect(n, id).toBeLessThanOrEqual(limits.get(id)!);
    expect(gameTimeline(r.song, PC_PROFILE)).toBe(gameTimeline(s, PC_PROFILE));
    // 자리 맞추기를 끄면 병합만 한다
    expect(mergeResult(s, PC_PROFILE, undefined, false).song.tracks.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("모바일은 아무것도 하지 않는다", () => {
    const s = { ...song([track("a", busy(20)), track("b", busy(900))]), profileId: "mobile" };
    expect(fitSlots(s, MOBILE_PROFILE).song).toBe(s);
  });
});

describe("템포 자리 (찬 비율)", () => {
  it("같은 순위면 찬 비율(어림 ÷ 자리 한도)이 낮은 채널에 쓴다", () => {
    // 멜로디 100음(어림 300 ÷ 1200 = 0.25), 화음2 60음(180 ÷ 500 = 0.36): 글자 수로는 화음2, 비율로는 멜로디
    const s = { ...song([track("a", busy(100)), track("b", busy(90)), track("c", busy(60))]), tempo: [{ at: rat(0), bpm: 120 }, { at: rat(1), bpm: 90 }] };
    const placed = placeTempoByScore(s, 3);
    expect(placed.get("a")!.map((e) => e.bpm)).toContain(90);
    expect(placed.get("c")!.map((e) => e.bpm)).not.toContain(90);
  });

  it("한도가 모두 같으면 전처럼 글자가 덜 찬 채널", () => {
    const channels = [busy(100), busy(60)];
    const tempo = [{ at: rat(1), bpm: 90 }];
    expect(placeTempo(channels, tempo, undefined, undefined, undefined, undefined, [2400, 2400])).toEqual(placeTempo(channels, tempo));
    expect(placeTempo(channels, tempo)[1]!.length).toBe(1);
  });
});

describe("지킴이: 가장 큰 자리 한도를 직접 읽는 곳", () => {
  it("charLimitPerScore는 프로필 파일과 한도 표 파일에서만 읽는다 (남아 있으면 PC 화음 자리를 넉넉하게 틀린다)", () => {
    const root = join(__dirname, "../../..");
    const dirs = ["packages/core/src", "packages/mml/src", "packages/fileio/src", "packages/midi/src", "packages/audio/src", "apps/web/src"].map((d) => join(root, d));
    const allowed = new Set([join(root, "packages/core/src/profile.ts"), join(root, "packages/mml/src/track-limits.ts")]);
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|svelte)$/.test(name) && !allowed.has(path) && readFileSync(path, "utf8").includes("charLimitPerScore")) found.push(path.slice(root.length + 1));
      }
    };
    dirs.forEach(walk);
    expect(found).toEqual([]);
  });
});
