import { describe, expect, it } from "vitest";
import { findMmlAt, looksLikeMmlAt, readMmlAt } from "../src/index.js";

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
