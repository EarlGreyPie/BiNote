import { describe, expect, it } from "vitest";
import { add, rat } from "@mmlce/core";
import { read3mle, readMmi, readMmlAt } from "../src/index.js";

const tick = (n: number) => rat(n, 384);
const endOf = (notes: readonly { start: { n: number; d: number }; dur: { n: number; d: number } }[]) => {
  const last = notes.at(-1)!;
  return add(last.start, last.dur);
};

const MMI = ["[mml-score]", "version=1", "title=", "author=", "time=4/4", "tempo=0T120", "mml-track=MML@l5ccccc,,,;", "name=피아노", "program=0", "songProgram=-1"].join("\n");
const THREEMLE = ["[Settings]", "Title=", "[Channel1]", "l5ccccc"].join("\n");

describe("파일을 어느 게임의 글로 읽을지 고르기", () => {
  it("기본(모바일)은 정확한 분수: l5 다섯 개 = 온음표", () => {
    for (const song of [readMmlAt("MML@l5ccccc;").song, read3mle(THREEMLE).song, readMmi(MMI).song]) {
      expect(song.meta.profileId).toBe("mobile");
      expect(endOf(song.tracks[0]!.notes)).toEqual(rat(1));
    }
  });

  it("PC로 읽으면 틱 셈: l5 다섯 개 = 380틱, 곡의 게임도 PC", () => {
    const opts = { profileId: "pc" };
    for (const song of [readMmlAt("MML@l5ccccc;", opts).song, read3mle(THREEMLE, opts).song, readMmi(MMI, undefined, opts).song]) {
      expect(song.meta.profileId).toBe("pc");
      expect(endOf(song.tracks[0]!.notes)).toEqual(tick(380));
      expect(song.tracks[0]!.mml?.text).toBe("l5ccccc");
    }
  });

  it("모르는 게임이면 기본 게임으로 읽는다", () => {
    expect(readMmlAt("MML@c;", { profileId: "nope" }).song.meta.profileId).toBe("mobile");
  });
});
