import { describe, expect, it } from "vitest";
import { DEFAULT_ARP, parseArpChoice } from "../src/lib/arpeggioOptions";

describe("아르페지오 창 저장값", () => {
  it("없거나 깨졌으면 기본(같은 시간 음·펼치기·위로·16분·1옥타브·반복·지우기)", () => {
    expect(parseArpChoice(undefined)).toEqual(DEFAULT_ARP);
    expect(parseArpChoice({ source: "x", octaves: 9, length: "7" })).toEqual(DEFAULT_ARP);
  });
  it("아는 값은 그대로", () => {
    const v = { source: "chord", chord: "m7", style: "strum", order: "random", length: "12", octaves: 2, repeat: false, clear: false };
    expect(parseArpChoice(v)).toEqual(v);
  });
});
