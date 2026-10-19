import { describe, expect, it } from "vitest";
import { ARP_LENGTHS, DEFAULT_ARP, parseArpChoice, storeArpChoice } from "../src/lib/arpeggioOptions";
import { lengthsFor, noteLengthOf } from "../src/lib/roll";
import { defaultLengthLimit, rat } from "@mmlce/core";

describe("아르페지오 창 저장값", () => {
  it("없거나 깨졌으면 기본(같은 시간 음·펼치기·위로·16분·1옥타브·반복·지우기)", () => {
    expect(parseArpChoice(undefined)).toEqual(DEFAULT_ARP);
    expect(parseArpChoice({ source: "x", octaves: 9, length: "96" })).toEqual(DEFAULT_ARP);
  });
  it("아는 값은 그대로", () => {
    const v = { source: "chord", chord: "m7", style: "strum", order: "random", length: "12", octaves: 2, repeat: false, clear: false };
    expect(parseArpChoice(v)).toEqual(v);
  });
  it("예전 값의 깔기 + 옥타브 1 + 반복 끔은 굴려 치기로 읽는다 (판 2로 저장한 값은 그대로)", () => {
    expect(parseArpChoice({ style: "strum", octaves: 1, repeat: false }).style).toBe("roll");
    expect(parseArpChoice({ style: "strum", octaves: 2, repeat: false }).style).toBe("strum");
    expect(parseArpChoice({ style: "roll" }).style).toBe("roll");
    const strum = { ...DEFAULT_ARP, style: "strum" as const, octaves: 1 as const, repeat: false };
    expect(parseArpChoice(JSON.parse(storeArpChoice(strum)))).toEqual(strum);
  });
});

describe("아르페지오 음 길이", () => {
  it("셋잇단 l3·l6을 받고 길이 순이다", () => {
    expect(parseArpChoice({ length: "6" }).length).toBe("6");
    expect(noteLengthOf("6", 4)).toEqual(rat(1, 6));
    expect(noteLengthOf("3", 4)).toEqual(rat(1, 3));
    const lens = ARP_LENGTHS.filter((l) => l !== "grid").map((l) => noteLengthOf(l, 1));
    for (let i = 1; i < lens.length; i++) expect(lens[i]!.n / lens[i]!.d).toBeLessThan(lens[i - 1]!.n / lens[i - 1]!.d);
    // 게임 한도로 거른다 (모바일 한도 안이라 모두 남는다)
    expect(lengthsFor(defaultLengthLimit(), ARP_LENGTHS)).toEqual([...ARP_LENGTHS]);
  });
});
