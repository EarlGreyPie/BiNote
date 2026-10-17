import { describe, expect, it } from "vitest";
import { add, emptySong, eq, MOBILE_PROFILE, rat, type Player, type Song, type Track } from "@mmlce/core";
import { cutCount, mergeTies, parseMml, parseTrackText, sameSound, splitSong } from "../src/index.js";

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

// 큰 입력을 여러 번 나눠 보는 사례가 있어 느린 컴퓨터에서는 기본 5초를 넘는다
describe("splitSong", { timeout: 30_000 }, () => {
  it("한도 안이면 한 권", () => {
    const r = splitSong(song(["cdefg", "c1"]), MOBILE_PROFILE);
    expect(r.needed).toBe(false);
    expect(r.parts).toHaveLength(1);
  });

  it("넘치면 모든 채널을 같은 자리에서 자르고, 이어 붙이면 소리가 같다", () => {
    const melody = "t100 " + "cdefgab>c<".repeat(3) + "r4 " + "cegce".repeat(4) + "t90 " + "fedcba".repeat(3);
    const bass = "o3 l2 " + "cgfg".repeat(6);
    const s = song([melody, bass]);
    const r = splitSong(s, small, { gapMs: null });
    expect(r.needed).toBe(true);
    expect(r.parts.length).toBeGreaterThan(1);
    for (const p of r.parts) for (const t of p.texts) expect(t.text.length).toBeLessThanOrEqual(40);
    // 권마다 다시 읽어서 시작 위치만큼 밀어 이으면 원래 음과 같다 (끊긴 음은 & 가 풀린다)
    s.tracks.forEach((tr, k) => {
      const joined = r.parts.flatMap((p) => parseMml(p.texts[k]!.text).notes.map((n) => ({ ...n, start: add(n.start, p.start) })));
      const cutAt = r.parts.slice(0, -1).map((p) => p.end);
      const expected = mergeTies(tr.notes).flatMap((n) => {
        // 자른 자리에 걸친 음은 둘로 나뉜다
        const end = add(n.start, n.dur);
        const cuts = cutAt.filter((c) => c.n / c.d > n.start.n / n.start.d && c.n / c.d < end.n / end.d);
        if (cuts.length === 0) return [n];
        const pieces = [];
        let from = n.start;
        for (const c of [...cuts, end]) {
          pieces.push({ ...n, start: from, dur: rat(c.n * from.d - from.n * c.d, c.d * from.d), tie: "none" as const });
          from = c;
        }
        return pieces;
      });
      expect(sameSound(joined, expected)).toBe(true);
    });
    // 두 번째 권부터 첫머리에 그때 템포를 다시 쓴다
    const second = r.parts[1]!;
    const t = second.texts.map((x) => parseMml(x.text).tempo).flat();
    expect(t.some((e) => eq(e.at, rat(0)))).toBe(true);
  });

  it("권 사이 지연만큼 앞 권을 일찍 끝내고, 그 구간에 음이 가장 적은 자리를 고른다", () => {
    // t120: 1010ms ≈ 온음표 0.505 → 64분 단위 32/64 = 1/2. 마지막 r2 쉼표 자리에서 자르면 잃는 음이 없다
    const s = song(["t120 l4 " + "cdef".repeat(4) + "r2 " + "gab>c<".repeat(4)]);
    const r = splitSong(s, { ...small, charLimitPerScore: 30 }, { window: 1 });
    const first = r.parts[0]!;
    expect(first.trim).toEqual(rat(1, 2));
    expect(first.end).toEqual(rat(9, 2));
    expect(first.cut).toBe(0);
    // 앞 권은 쉼표를 뺀 음 16개로 끝난다
    expect(parseMml(first.texts[0]!.text).notes).toHaveLength(16);
    expect(splitSong(s, { ...small, charLimitPerScore: 30 }, { window: 1, gapMs: null }).parts[0]!.trim).toEqual(rat(0));
  });

  it("앞당겨 끝낸 뒤 글자가 늘어도 한도를 지킨다 (최종 글로 검사)", () => {
    const s = song(["t100 " + "cdef".repeat(620)]);
    const r = splitSong(s, MOBILE_PROFILE);
    for (const p of r.parts) for (const t of p.texts) expect(t.text.length).toBeLessThanOrEqual(MOBILE_PROFILE.charLimitPerScore);
  });

  it("권 끝의 쉼표를 끝 쉼표로 남겨 다음 권이 일찍 시작하지 않는다", () => {
    const s = song(["t120 " + "cdef".repeat(599) + "r1 " + "gabc".repeat(20)]);
    const r = splitSong(s, MOBILE_PROFILE, { window: 0.01 });
    const first = r.parts[0]!;
    expect(r.parts.length).toBeGreaterThan(1);
    // 첫 권을 게임처럼 잰 길이(맨 끝 쉼표 하나는 빠진다) = 자른 자리 − 앞당김
    const read = parseMml(first.texts[0]!.text);
    expect(read.gameEnd).toEqual(add(first.start, { n: first.end.n * first.trim.d - first.trim.n * first.end.d, d: first.end.d * first.trim.d }));
  });

  it("한 권 내내 쉬는 악보도 버려질 쉼표를 붙여 권 길이를 지킨다", () => {
    const melody = "t120 " + "cdefgab>c<".repeat(12);
    const s: Song = {
      ...song([melody, "c4"]),
      players: [piano, { id: "p2", name: "플루트", instrument: { canonical: "flute" } }],
    };
    const two: Song = { ...s, tracks: s.tracks.map((t, k) => (k === 0 ? t : { ...t, playerId: "p2" })) };
    const r = splitSong(two, small, { gapMs: null });
    expect(r.parts.length).toBeGreaterThan(2);
    for (const part of r.parts.slice(0, -1)) {
      const length = (part.end.n / part.end.d) - (part.start.n / part.start.d);
      const end = parseMml(part.texts[1]!.text).gameEnd;
      expect(end.n / end.d).toBeCloseTo(length);
    }
  });

  it("앞당김은 자르는 자리 앞 구간의 템포로 잰다", () => {
    // 자르는 자리(4) 앞은 t120, 뒤는 t240: 1010ms는 앞 템포로 온음표 0.505 ≈ 32/64
    const s = song(["t120 l4 " + "cdef".repeat(4) + "t240 " + "gab>c<".repeat(4)]);
    const r = splitSong(s, { ...small, charLimitPerScore: 30 }, { window: 1 });
    expect(r.parts.map((p) => [p.end, p.trim])).toEqual([
      [rat(4), rat(1, 2)],
      [rat(8), rat(0)],
    ]);
  });

  it("끝 쉼표 때문에 길이가 들쭉날쭉해도 뒤쪽에 들어가는 자리를 놓치지 않는다", () => {
    const r = splitSong(song(["t120 c8d8e8f8g8a8b8>c8"]), { ...small, charLimitPerScore: 8 }, { window: 0 });
    expect(r.parts.length).toBeLessThan(5);
    for (const p of r.parts) for (const t of p.texts) expect(t.text.length).toBeLessThanOrEqual(8);
  });

  it("끝 쉼표를 어느 채널에 붙여도 최종 글이 한도를 넘지 않는다 (재감사 사례)", () => {
    const p = "cdef".repeat(597) + "cde";
    const r = splitSong(song([p + "r1c4c8.b4r1." + "cdef".repeat(20), p + ">c4<r2c8"]), MOBILE_PROFILE);
    for (const part of r.parts) for (const t of part.texts) expect(t.text.length).toBeLessThanOrEqual(MOBILE_PROFILE.charLimitPerScore);
  });

  it("모두 쉬는 자리를 먼저 고른다", () => {
    const tracks = [track("a", "c1 r4 c1"), track("b", "e2.r2 e1")];
    expect(cutCount(tracks.map((t) => t.notes), rat(5, 4))).toBe(0);
    expect(cutCount(tracks.map((t) => t.notes), rat(1, 2))).toBe(2);
  });

  it("악보마다 템포를 넣다 음을 버리지 않는다: 모든 채널에서 음 가운데면 뒤쪽 음 경계로 (공개 전 점검 #2)", () => {
    const base = song(["t150 c48 t90 e48", "c64 d64 e64"]);
    const two: Song = {
      ...base,
      players: [piano, { id: "p2", name: "플루트", instrument: { canonical: "flute" } }],
      tracks: base.tracks.map((t, k) => (k === 0 ? t : { ...t, playerId: "p2" })),
    };
    const r = splitSong(two, MOBILE_PROFILE);
    const part = r.parts[0]!;
    const second = parseMml(part.texts[1]!.text);
    expect(second.notes.map((n) => n.pitch)).toEqual([60, 62, 64]);
    expect(second.tempo.map((e) => [e.bpm, e.at])).toEqual([
      [150, rat(0)],
      [90, rat(1, 32)],
    ]);
    expect(part.moved).toBe(1);
    expect(part.lossy).toEqual([]);
  });

  it("출력기로 정확히 쓸 수 없는 트랙은 lossy로 알린다", () => {
    // 1/240 길이는 쓸 수 없다
    const odd: Track = { ...track("t0", "c4"), notes: [{ id: "n", start: rat(0), dur: rat(1, 240), pitch: 60, vol: 8, tie: "none" }] };
    const s = { ...song(["c4"]), tracks: [odd] };
    expect(splitSong(s, MOBILE_PROFILE).parts[0]!.lossy).toEqual(["t0"]);
  });
});
