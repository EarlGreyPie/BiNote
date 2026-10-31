import { describe, expect, it } from "vitest";
import { INSTRUMENTS } from "@mmlce/core";
import { findMmlAtBlocks, readMmlAt } from "@mmlce/fileio";
import { pasteInstrumentNames, replaceSources } from "../src/lib/pasteOptions";

const CHOICES = INSTRUMENTS.filter((i) => i.program !== undefined && !i.percussion);

describe("MML@ 붙여넣기 창: 머리줄 악기 이름", () => {
  it("5개 언어 이름과 공통 ID로 악기를 알아본다", () => {
    const names = pasteInstrumentNames(CHOICES);
    const text = "류트 1권\nMML@c;\nフルート\nMML@d;\nViolin (1/2)\nMML@e;\nmusic box\nMML@f;";
    expect(findMmlAtBlocks(text, names).map((b) => b.instrument?.canonical)).toEqual(["lute", "flute", "violin", "music-box"]);
  });

  it("악기를 읽은 연주자는 고른 기본 악기 대신 그 악기를 쓴다", () => {
    const { song } = readMmlAt("하프\nMML@c;\nMML@d;", { instrumentNames: pasteInstrumentNames(CHOICES), instrument: { canonical: "flute", program: 4 } });
    expect(song.players.map((p) => p.instrument.canonical)).toEqual(["harp", "flute"]);
  });
});

describe("MML@ 붙여넣기 창: 지금 트랙 덮어쓰기", () => {
  it("글 안 모든 악보의 트랙을 하나씩 고를 수 있게 늘어놓는다", () => {
    expect(replaceSources(findMmlAtBlocks("MML@cde,o3c;\nMML@efg;"))).toEqual([
      { score: 1, track: 1, text: "cde" },
      { score: 1, track: 2, text: "o3c" },
      { score: 2, track: 1, text: "efg" },
    ]);
  });
});
