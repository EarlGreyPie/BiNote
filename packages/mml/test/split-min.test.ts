import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, type Player, type Song, type Track } from "@mmlce/core";
import { parseMml, parseTrackText, splitSong } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };

function song(texts: string[]): Song {
  const tracks: Track[] = texts.map((text, k) => ({
    id: `t${k}`, playerId: "p1", name: `t${k}`, color: "#000", role: "free", mute: false, solo: false,
    notes: parseTrackText(`t${k}`, { text }).notes, spelling: {},
  }));
  return { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [piano], tracks, tempo: texts.flatMap((t) => parseMml(t).tempo) };
}

// 의사 난수 (같은 결과가 나오게)
function rng(seed: number) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

function randomTrack(seed: number, notes: number): string {
  const r = rng(seed);
  const pitches = "cdefgab";
  let out = "";
  for (let i = 0; i < notes; i++) {
    if (r() < 0.12) out += "r" + [4, 8, 16][Math.floor(r() * 3)];
    out += pitches[Math.floor(r() * 7)]! + ([4, 8, 16, 2, ""] as const)[Math.floor(r() * 5)];
    if (r() < 0.1) out += r() < 0.5 ? ">" : "<";
  }
  return out;
}

const small = { ...MOBILE_PROFILE, charLimitPerScore: 60 };

describe("splitSong 권 수", { timeout: 60_000 }, () => {
  it("좋은 자리를 고르느라 권이 늘지 않는다: 늘 가장 멀리 넣는 경우와 권 수가 같다", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = song([randomTrack(seed, 160), randomTrack(seed + 100, 90)]);
      const chosen = splitSong(s, small).parts.length;
      const minimal = splitSong(s, small, { window: 0 }).parts.length;
      expect(chosen, `seed ${seed}`).toBe(minimal);
    }
  });
});

describe("splitSong 정확한 최소 권 수", () => {
  it("가장 멀리 넣기로는 5권이지만 4권에 들어가는 곡은 4권으로 나눈다 (beta.6 점검 4번)", () => {
    const s = song([
      "l8t120r1r1r1r2r<fr2.rf2r2d16r4r16g16<d2r8.>br2.r<fc16rg16f4",
      "l16erd8r4c8r4<d2r4rfb8r8.g4r2v7b8r2rcg4",
    ]);
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 20 };
    const r = splitSong(s, profile);
    expect(r.parts.length).toBe(4);
    for (const p of r.parts) for (const t of p.texts) expect(t.text.length).toBeLessThanOrEqual(20);
    expect(r.parts.every((p) => p.lossy.length === 0)).toBe(true);
  });
});

// 쉼표·옥타브·볼륨이 섞인 곡 (꼼꼼히 나누기 비교용)
function mixedTrack(seed: number, notes: number): string {
  const r = rng(seed);
  const pitches = "cdefgab";
  let out = "";
  for (let i = 0; i < notes; i++) {
    if (r() < 0.25) out += "r" + [1, 2, 4, 8, 16][Math.floor(r() * 5)];
    out += pitches[Math.floor(r() * 7)]! + ([4, 8, 16, 2, "", "4.", "16"] as const)[Math.floor(r() * 7)];
    if (r() < 0.15) out += r() < 0.5 ? ">" : "<";
    if (r() < 0.05) out += "v" + Math.floor(r() * 16);
  }
  return out;
}

describe("splitSong 꼼꼼히 나누기 (큰 곡 방식)", { timeout: 120_000 }, () => {
  it("가장 멀리 넣기보다 권이 적은 길을 찾고, 정확한 최소와 같다", () => {
    // exactBudget 0: 작은 곡이라도 큰 곡처럼 정확한 계산 없이 나눈다
    const s = song(["t120 l8 " + mixedTrack(27, 60), mixedTrack(527, 35)]);
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 50 };
    // 짧게 넘어가는 음 버리기를 끈다: 버리면 글이 짧아져 가장 멀리 넣기도 3권이 되어 이 사례가 성립하지 않는다
    const greedy = splitSong(s, profile, { exactBudget: 0, minCarrySec: 0 }).parts.length;
    const thorough = splitSong(s, profile, { exactBudget: 0, thorough: true, minCarrySec: 0 });
    const exact = splitSong(s, profile, { exactBudget: Infinity, minCarrySec: 0 }).parts.length;
    expect(greedy).toBe(4);
    expect(thorough.parts.length).toBe(exact);
    expect(exact).toBe(3);
    for (const p of thorough.parts) for (const t of p.texts) expect(t.text.length).toBeLessThanOrEqual(50);
    // 권이 빈틈없이 이어진다
    thorough.parts.slice(1).forEach((p, k) => expect(p.start).toEqual(thorough.parts[k]!.end));
  });

  it("진행률은 줄지 않고 1에서 끝난다", () => {
    const s = song(["t120 l8 " + mixedTrack(27, 60), mixedTrack(527, 35)]);
    const seen: number[] = [];
    splitSong(s, { ...MOBILE_PROFILE, charLimitPerScore: 50 }, { exactBudget: 0, thorough: true, onProgress: (f) => seen.push(f) });
    expect(seen.every((f, k) => k === 0 || f >= seen[k - 1]!)).toBe(true);
    expect(seen.at(-1)).toBe(1);
  });
});

describe("planBooks", { timeout: 60_000 }, () => {
  // 앞 트랙은 쉬지 않고, 뒤 트랙은 거의 쉰다 (같은 연주자, 같은 악기)
  const busy = "l8 " + "cdefgab>c<".repeat(16);
  const idle = "l1 " + "r".repeat(16) + "c";

  it("화음 분산으로 모든 채널이 한도 안에 들면 나누지 않는다. 받은 곡은 그대로", async () => {
    const { planBooks } = await import("../src/index.js");
    const s = song([busy, idle]);
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 120 };
    expect(splitSong(s, profile).needed).toBe(true);
    const plan = planBooks(s, profile);
    expect(plan.result.needed).toBe(false);
    expect(plan.spread?.to).toBe(1);
    expect(plan.spread?.from).toBeUndefined();
    expect(plan.spread!.moved).toBeGreaterThan(0);
    expect(plan.song).not.toBe(s);
    expect(s.tracks[1]!.notes).toHaveLength(1);
  });

  it("끄면 악보책 나누기만 한다", async () => {
    const { planBooks } = await import("../src/index.js");
    const s = song([busy, idle]);
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 120 };
    const plan = planBooks(s, profile, { spread: false });
    expect(plan.spread).toBeUndefined();
    expect(plan.song).toBe(s);
    expect(plan.result.parts.length).toBe(splitSong(s, profile).parts.length);
  });

  it("한 권에는 못 넣어도 권이 줄면 옮긴 곡으로 나누고, 단계를 알린다", async () => {
    const { planBooks } = await import("../src/index.js");
    const s = song([busy, idle]);
    const plain = splitSong(s, small).parts.length;
    const stages = new Set<string>();
    const plan = planBooks(s, small, { onProgress: (p) => stages.add(p.stage) });
    expect(plan.spread).toBeDefined();
    expect(plan.spread!.from).toBe(plain);
    expect(plan.result.parts.length).toBeLessThan(plain);
    expect(plan.spread!.to).toBe(plan.result.parts.length);
    expect([...stages]).toEqual(expect.arrayContaining(["spread", "split"]));
  });
});

describe("planBooks 점검 (PR #86)", { timeout: 120_000 }, () => {
  // 권마다 다시 읽은 음 수의 합. 경계에서 음이 빠지면 곡의 음 수보다 작아진다
  const partNotes = (parts: readonly { texts: readonly { text: string }[] }[]) =>
    parts.reduce((n, p) => n + p.texts.reduce((m, t) => m + parseMml(t.text).notes.length, 0), 0);
  const noteCount = (s: Song) => s.tracks.reduce((n, t) => n + t.notes.length, 0);

  it("분산 전 글자 수 합이 한도를 넘어도 실제로 분산해 보고 한 권이면 나누지 않는다 (음이 빠지지 않는다)", async () => {
    const { planBooks } = await import("../src/index.js");
    // 분산 전 4070자 + 745자. 옮기면 옥타브·음량 명령이 줄어 2396자 + 745자가 된다
    const s = song(["l8 " + "o4v15co7v1c".repeat(370), "l8 o7v1" + "cr".repeat(370)]);
    const plan = planBooks(s, MOBILE_PROFILE);
    expect(plan.result.parts).toHaveLength(1);
    expect(plan.result.parts.every((p) => p.cut === 0)).toBe(true);
    expect(plan.spread?.to).toBe(1);
    expect(noteCount(plan.song)).toBe(noteCount(s));
    expect(partNotes(plan.result.parts)).toBe(noteCount(s));
  });

  it("&로 이어진 짧은 음은 한 음으로 세어 미리 거르지 않는다 (PR #88 점검 1번)", async () => {
    const { planBooks } = await import("../src/index.js");
    // 둘째 트랙은 음 조각이 6660개지만 c64&…(16개) 가 c4 한 글자로 합쳐진다
    const s = song(["l4 " + "o4v15co7v1c".repeat(370), "o7v1" + ("c64&".repeat(15) + "c64r4").repeat(370)]);
    const plan = planBooks(s, MOBILE_PROFILE);
    expect(plan.result.parts).toHaveLength(1);
    expect(plan.result.parts[0]!.cut).toBe(0);
    expect(plan.spread?.to).toBe(1);
  });

  it("잠근 트랙은 분산의 출발·도착 어느 쪽에도 쓰지 않는다", async () => {
    const { planBooks, fewerBooks, distributeSong } = await import("../src/index.js");
    const s = song(["l8 " + "cdefgab>c<".repeat(300), "l1 " + "r".repeat(300) + "c"]);
    // 잠그지 않으면 앞 트랙 음을 옮겨 한 권에 넣는다
    expect(planBooks(s, MOBILE_PROFILE).spread?.to).toBe(1);
    const locked = new Set(["t0"]);
    const plan = planBooks(s, MOBILE_PROFILE, { locked });
    expect(plan.spread).toBeUndefined();
    expect(plan.song.tracks[0]).toBe(s.tracks[0]);
    expect(plan.result.parts.length).toBe(splitSong(s, MOBILE_PROFILE).parts.length);
    expect(fewerBooks(s, MOBILE_PROFILE, plan.result.parts.length, locked)).toBeUndefined();
    const after = distributeSong(MOBILE_PROFILE, "x", undefined, locked).apply(s);
    expect(after.tracks[0]!.notes).toEqual(s.tracks[0]!.notes);
    expect(after.tracks[1]!.notes).toEqual(s.tracks[1]!.notes);
  });
});

describe("fewerBooks", { timeout: 60_000 }, () => {
  it("한 트랙만 길면 같은 악기 트랙으로 음을 옮겨 권 수를 줄인다", async () => {
    const { fewerBooks, distributeSong } = await import("../src/index.js");
    // 앞 트랙은 쉬지 않고, 뒤 트랙은 거의 쉰다
    const busy = "l8 " + "cdefgab>c<".repeat(16);
    const idle = "l1 " + "r".repeat(16) + "c";
    const s = song([busy, idle]);
    const books = splitSong(s, small).parts.length;
    expect(books).toBeGreaterThan(1);
    const f = fewerBooks(s, small, books);
    expect(f).toBeDefined();
    expect(f!.to).toBeLessThan(books);
    const after = distributeSong(small, "x", f!.limit).apply(s);
    expect(splitSong(after, small).parts.length).toBe(f!.to);
  });

  it("옮길 곳이 없으면 알려 주지 않는다", async () => {
    const { fewerBooks } = await import("../src/index.js");
    const s = song(["l8 " + "cdefgab>c<".repeat(12)]);
    expect(fewerBooks(s, small, splitSong(s, small).parts.length)).toBeUndefined();
  });
});
