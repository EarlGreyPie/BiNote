import { describe, expect, it } from "vitest";
import { cmp, emptySong, eq, MOBILE_PROFILE, rat, type Player, type Song, type Track } from "@mmlce/core";
import { parseMml, parseTrackText, splitSong } from "../src/index.js";

/** 악보책 나누기: 고정 자리와 다른 자리 고르기 (글자 수 맞추기 창) */
const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };

function track(id: string, text: string): Track {
  return { id, playerId: "p1", name: id, color: "#000", role: "free", mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {} };
}

function song(texts: string[]): Song {
  const tracks = texts.map((t, k) => track(`t${k}`, t));
  const tempo = texts.flatMap((t) => parseMml(t).tempo);
  return { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [piano], tracks, tempo };
}

const small = { ...MOBILE_PROFILE, charLimitPerScore: 40 };
const melody = "t100 " + "cdefgab>c<".repeat(3) + "r2 " + "cegce".repeat(4) + "r2 " + "fedcba".repeat(3);
const bass = "o3 l2 " + "cgfg".repeat(6);

describe("splitSong 고정 자리·다른 자리", { timeout: 30_000 }, () => {
  it("고정한 자리에서 꼭 자르고, 모든 권이 한도 안이다", () => {
    const s = song([melody, bass]);
    const free = splitSong(s, small);
    const at = rat(2);
    expect(free.parts.slice(0, -1).some((p) => eq(p.end, at))).toBe(false);
    const r = splitSong(s, small, { fixed: [at] });
    const cut = r.parts.find((p) => eq(p.end, at));
    expect(cut).toBeDefined();
    expect(cut!.fixed).toBe(true);
    expect(r.parts.filter((p) => p.fixed)).toHaveLength(1);
    expect(r.ignored).toHaveLength(0);
    for (const p of r.parts) for (const t of p.texts) expect(t.text.length).toBeLessThanOrEqual(40);
    // 권은 빈틈없이 이어진다
    r.parts.forEach((p, k) => {
      if (k > 0) expect(eq(p.start, r.parts[k - 1]!.end)).toBe(true);
    });
  });

  it("첫 음 앞이나 마지막 음 뒤 고정 자리는 쓰지 않고 알린다", () => {
    const s = song([melody, bass]);
    const r = splitSong(s, small, { fixed: [rat(0), rat(100)] });
    expect(r.ignored.map((x) => x.n / x.d)).toEqual([0, 100]);
    expect(r.parts.some((p) => p.fixed)).toBe(false);
  });

  it("다른 자리는 권 수를 늘리지 않고, 고르면(고정하면) 그 자리에서 자른다", () => {
    const s = song([melody, bass]);
    const r = splitSong(s, small, { choices: true });
    const first = r.parts[0]!;
    expect(first.choices.length).toBeGreaterThan(0);
    // 위치 순, 지금 자리는 빠진다
    for (let k = 1; k < first.choices.length; k++) expect(cmp(first.choices[k - 1]!.at, first.choices[k]!.at)).toBeLessThan(0);
    expect(first.choices.some((c) => eq(c.at, first.end))).toBe(false);
    const pick = first.choices[0]!;
    const again = splitSong(s, small, { fixed: [pick.at] });
    expect(eq(again.parts[0]!.end, pick.at)).toBe(true);
    expect(again.parts.length).toBeLessThanOrEqual(r.parts.length);
    // 마지막 권은 다른 자리가 없고 쉬는 자리로 본다
    const last = r.parts[r.parts.length - 1]!;
    expect(last.choices).toHaveLength(0);
    expect(last.clean).toBe(true);
    expect(last.lost).toBe(0);
  });

  it("권 끝마다 지연 구간에서 잘리는 소리 길이를 알려 준다", () => {
    const r = splitSong(song([melody, bass]), small);
    for (const p of r.parts.slice(0, -1)) {
      if (p.clean) expect(p.lost).toBe(0);
      else expect(p.lost).toBeGreaterThan(0);
    }
  });
  it("어느 권의 다른 자리를 골라 고정해도 권 수가 늘지 않는다 (같은 정확한 계산으로 다시 나눈다)", () => {
    // 고정 없이 4권, 다른 자리는 정확한 최소 권 수로 확인한다. 전에는 고정하면 가장 멀리 넣기로만 다시 나눠
    // 27/16·7/4·15/8·17/8 자리를 고르면 5권이 됐다 (자리마다 글자 수가 들쭉날쭉한 곡)
    const s = song(["o4 l8 e-8.<<2f2r16&>2c2a16e-8.c+16g8e-8.g8&a8.b8.f4>16ec4.&g8r8.gc+4.c8.c+2e-16><8a16b2f>8r2&g16&g4.c8>c+e-16d2", "o3 l4 <2c8.r2c+8.c+4.e-2g4.c+16fg8e>4<2g8e4.<16d4.b2d4.d2&a4.f<4.e-4r8>16c4r4g2db8.e-4f4c>e2f8rb2b2"]);
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 24 };
    const r = splitSong(s, profile, { choices: true });
    const picks = r.parts.flatMap((p) => p.choices.map((c) => c.at));
    expect(picks.length).toBeGreaterThan(0);
    for (const at of picks) {
      const again = splitSong(s, profile, { fixed: [at] });
      expect(again.parts.some((x) => eq(x.end, at))).toBe(true);
      expect(again.parts.length, `${at.n}/${at.d}`).toBeLessThanOrEqual(r.parts.length);
    }
  });
});
