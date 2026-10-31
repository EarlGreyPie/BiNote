import { describe, expect, it } from "vitest";
import { add, eq, MOBILE_PROFILE, type Note } from "@mmlce/core";
import { gameScores, scoreEnd, songChordsPerScore, splitSong } from "@mmlce/mml";
import { findMmlAt, findMmlAtBlocks, looksLikeMmlAt, readMmlAt } from "../src/index.js";

describe("MML@ 글 읽기", () => {
  it("MML@ 뒤 트랙을 콤마로 나누고, 악보가 여럿이면 연주자를 여럿 만든다", () => {
    expect(findMmlAt("MML@cde,,o3c;")).toEqual([["cde", "", "o3c"]]);
    const text = "MML@t120cde,efg;\nMML@c1;";
    const { song, diagnostics } = readMmlAt(text);
    expect(diagnostics).toEqual([]);
    expect(song.players.map((p) => p.name)).toEqual(["연주자 1", "연주자 2"]);
    expect(song.tracks.map((t) => [t.playerId, t.mml?.text])).toEqual([
      ["p1", "t120cde"],
      ["p1", "efg"],
      ["p2", "c1"],
    ]);
    expect(song.tempo.map((t) => t.bpm)).toEqual([120]);
    expect(song.players[0]!.instrument.canonical).toBe("piano");
  });

  it("; 가 빠져도 끝까지 읽고, MML@가 없으면 오류를 낸다", () => {
    expect(findMmlAt("MML@cd,e")).toEqual([["cd", "e"]]);
    expect(readMmlAt("cde").diagnostics.map((d) => d.code)).toEqual(["mmlat-not-found"]);
  });

  it("3MLE·마비꼬 파일과 구분한다", () => {
    expect(looksLikeMmlAt("MML@cde;")).toBe(true);
    expect(looksLikeMmlAt("[mml-score]\nmml-track=MML@cde;")).toBe(false);
    expect(looksLikeMmlAt("[Channel1]\ncde")).toBe(false);
  });
});

describe("MML@ 글 머리줄과 권 잇기", () => {
  const lute = { canonical: "lute", program: 1 };
  const flute = { canonical: "flute", program: 4 };
  const names = [
    { name: "류트", instrument: lute },
    { name: "Lute", instrument: lute },
    { name: "Flute", instrument: flute },
  ];

  it("블록 바로 앞 줄에서 악기 이름과 권 번호를 읽는다", () => {
    const text = "곡 소개 글\n\n류트 1권\nMML@cde;\n플루트 (2/3) MML@efg;\nFlute part\nMML@c;MML@d;";
    const blocks = findMmlAtBlocks(text, names);
    expect(blocks.map((b) => [b.header, b.label, b.volume, b.instrument?.canonical])).toEqual([
      ["류트 1권", "류트", 1, "lute"],
      ["플루트 (2/3)", "플루트", 2, undefined],
      // 'Flute' 안에 'lute'도 들어 있지만 더 긴 이름이 이긴다
      ["Flute part", "Flute part", undefined, "flute"],
      ["", "", undefined, undefined],
    ]);
    expect(["3冊目", "第 4 份", "第5册", "Vol. 6", "Book 7", "악보 8"].map((h) => findMmlAtBlocks(`${h}\nMML@c;`)[0]!.volume)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("연주자로 나누면 머리줄 이름·악기를 연주자에 채운다", () => {
    const { song } = readMmlAt("류트\nMML@cde;\nMML@efg;", { instrumentNames: names });
    expect(song.players.map((p) => [p.name, p.instrument.canonical])).toEqual([
      ["류트", "lute"],
      ["연주자 2", "piano"],
    ]);
  });

  it("권으로 이으면 앞 권 끝 + 권 사이 틈 자리에 다음 권을 놓고, 권 번호 순으로 잇는다", () => {
    // 2권이 먼저 적혀 있어도 1권부터 잇는다. t60이면 1초 = 1/4 온음표
    const text = "2권\nMML@t60c4;\n1권\nMML@t60c2d4,e1r4;";
    const { song, playerBlocks, diagnostics } = readMmlAt(text, { mode: "book", gapMs: 1000 });
    expect(diagnostics).toEqual([]);
    expect(song.players.map((p) => p.name)).toEqual(["연주자 1"]);
    expect(playerBlocks).toEqual({ p1: [1, 0] });
    expect(song.tracks).toHaveLength(2);
    // 1권 길이: 첫 트랙 c2d4 = 3/4, 둘째 트랙 e1 (끝 쉼표 r4는 게임처럼 뺀다) = 1 → 1 + 틈 1/4 = 5/4
    expect(song.tracks[0]!.notes.map((n) => [n.start.n, n.start.d])).toEqual([
      [0, 1],
      [1, 2],
      [5, 4],
    ]);
    expect(song.tracks[0]!.mml).toBeUndefined();
    expect(song.tracks[1]!.notes).toHaveLength(1);
    expect(song.tempo.map((e) => e.bpm)).toEqual([60]);
  });

  it("틈이 없거나(미실측) t가 빠진 권은 기본 빠르기로 잇는다", () => {
    const { song } = readMmlAt("MML@t90c1;\nMML@c1;", { mode: "book", gapMs: null });
    expect(song.tracks[0]!.notes.map((n) => n.start.n / n.start.d)).toEqual([0, 1]);
    expect(song.tempo.map((e) => [e.at.n / e.at.d, e.bpm])).toEqual([
      [0, 90],
      [1, 120],
    ]);
  });

  it("권으로 이으면 마지막 권의 끝 쉼표도 악보 길이에 남는다 (Codex 지적)", () => {
    // 마지막 권 d4r4t120은 끝 쉼표까지 길이가 1/2이다. 이은 트랙은 원문이 없어 쉼표를 잃고 곡이 1/2에서 끝났다
    const { song } = readMmlAt("MML@c4;\nMML@d4r4t120;", { mode: "book", gapMs: null });
    expect(scoreEnd(song.tracks)).toEqual({ n: 3, d: 4 });
    expect(gameScores(song, songChordsPerScore(song))[0]!.text).toBe("MML@cdr4t120;");
  });

  it("틈이 없을 때 앞 권 끝에 붙은 t가 다음 권 빠르기를 덮지 않는다", () => {
    // 1권 둘째 채널 끝 t100(끝 쉼표를 지키려고 붙인 t)은 2권 첫머리 t80과 같은 자리다
    const { song } = readMmlAt("MML@t100c4,r4t100;\nMML@t80c4;\nMML@c4;", { mode: "book", gapMs: null });
    expect(song.tempo.map((e) => [e.at.n / e.at.d, e.bpm])).toEqual([
      [0, 100],
      [0.25, 80],
      [0.5, 120],
    ]);
  });

  it("권으로 이을 때 이름이 다르거나 같은 권 번호가 또 나오면 다른 연주자로 나눈다", () => {
    const text = "멜로디 1권\nMML@c;\n반주 1권\nMML@d;\n멜로디 2권\nMML@e;\n반주 2권\nMML@f;\n1권\nMML@g;\n1권\nMML@a;";
    const { song, playerBlocks } = readMmlAt(text, { mode: "book" });
    expect(song.players.map((p) => p.name)).toEqual(["멜로디", "반주", "연주자 3", "연주자 4"]);
    expect(Object.values(playerBlocks)).toEqual([[0, 2], [1, 3], [4], [5]]);
    // 한 권뿐인 연주자는 원문을 그대로 둔다
    expect(song.tracks.find((t) => t.playerId === "p3")?.mml?.text).toBe("g");
  });

  it("머리줄 없이 바로 붙은 악보는 앞 권에 잇는다", () => {
    const { song } = readMmlAt("곡: 아리랑\nMML@c1;MML@d1;", { mode: "book" });
    expect(song.players).toHaveLength(1);
    expect(song.tracks[0]!.notes).toHaveLength(2);
  });
});

describe("악보책 나누기 글을 권으로 이어 다시 읽기", () => {
  it("나눈 권들을 모아 붙이면 권 사이 틈만큼 띄워 원래 자리에 음이 놓인다", () => {
    const profile = { ...MOBILE_PROFILE, charLimitPerScore: 30 };
    const original = readMmlAt(`MML@t100${"c8d16e.f4g8.a16b4r2".repeat(6)};`).song;
    const { parts } = splitSong(original, profile);
    expect(parts.length).toBeGreaterThan(2);
    const text = parts.map((p, k) => `${k + 1}권\nMML@${p.texts.map((x) => x.text).join(",")};`).join("\n");
    const back = readMmlAt(text, { mode: "book", gapMs: profile.scoreBookGapMs }).song;
    expect(back.players).toHaveLength(1);
    expect(back.tempo.map((e) => e.bpm)).toEqual([100]);
    const key = (n: Note) => `${n.start.n}/${n.start.d}:${n.pitch}`;
    const notes = back.tracks[0]!.notes;
    // 권 끝을 앞당기느라 &로 잘게 이은 조각은 빼고, 나머지 음은 모두 원래 자리에 있어야 한다
    const heads = notes.filter((n) => !notes.some((m) => m.tie === "next" && m.pitch === n.pitch && eq(add(m.start, m.dur), n.start)));
    const known = new Set(original.tracks[0]!.notes.map(key));
    expect(heads.filter((n) => !known.has(key(n)))).toEqual([]);
    const cut = parts.reduce((sum, p) => sum + p.cut, 0);
    expect(heads.length).toBeGreaterThanOrEqual(original.tracks[0]!.notes.length - cut);
  });
});
