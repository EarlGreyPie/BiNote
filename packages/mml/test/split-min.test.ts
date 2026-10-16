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
