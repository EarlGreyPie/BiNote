import { describe, expect, it } from "vitest";
import { ARP_LENGTHS, arpMadeOfGuess, DEFAULT_ARP, parseArpChoice, parseArpMade, storeArpChoice } from "../src/lib/arpeggioOptions";
import { lengthsFor, noteLengthOf } from "../src/lib/roll";
import { defaultLengthLimit, rat } from "@mmlce/core";

describe("아르페지오 창 저장값", () => {
  it("없거나 깨졌으면 기본(같은 시간 음·펼치기·위로·16분·1옥타브·반복·지우기)", () => {
    expect(parseArpChoice(undefined)).toEqual(DEFAULT_ARP);
    expect(parseArpChoice({ source: "x", octaves: 9, length: "96" })).toEqual(DEFAULT_ARP);
  });
  it("아는 값은 그대로", () => {
    const v = { source: "chord", chord: "m7", style: "strum", order: "random", length: "12", accent: "low", accentLength: "6", octaves: 2, repeat: false, clear: false, fold: 4 };
    expect(parseArpChoice(v)).toEqual(v);
    // 트랙 접기는 0~5만 (모르면 접지 않음)
    expect(parseArpChoice({ ...v, fold: 9 }).fold).toBe(0);
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

describe("아르페지오로 알아보기 설정", () => {
  const guess = (step: ReturnType<typeof rat>) =>
    ({ ok: true, style: "spread", order: "down", step, octaves: 2, repeat: false, clearChordTracks: false, trackId: "t1", cells: [], before: [], after: [], picked: [], dropped: 0, skipped: 0 }) as const;
  it("한 음 길이를 길이 이름으로 (점음표·잇단음), 안 되면 격자", () => {
    expect(arpMadeOfGuess(guess(rat(1, 16)))).toEqual({
      choice: { source: "together", chord: "major", style: "spread", order: "down", length: "16", accent: "none", accentLength: "8", octaves: 2, repeat: false, clear: false, fold: 0 },
      excluded: [],
    });
    expect(arpMadeOfGuess(guess(rat(3, 32))).choice.length).toBe("16.");
    expect(arpMadeOfGuess(guess(rat(1, 12))).choice.length).toBe("12");
    expect(arpMadeOfGuess(guess(rat(5, 16))).choice.length).toBe("grid");
  });
});

describe("따로 길이 저장값", () => {
  it("예전 값·만든 기록에는 없으니 모든 음 같은 길이로 읽는다", () => {
    expect(parseArpChoice({ v: 2, length: "16" })).toMatchObject({ accent: "none", accentLength: "8" });
    expect(parseArpMade({ choice: { style: "roll", length: "48" }, excluded: [] }).choice).toMatchObject({ accent: "none", accentLength: "8", length: "48" });
  });
  it("고른 음과 길이를 기억하고, 모르는 값은 기본으로", () => {
    const back = parseArpChoice(JSON.parse(storeArpChoice({ ...DEFAULT_ARP, accent: "both", accentLength: "4." })));
    expect([back.accent, back.accentLength]).toEqual(["both", "4."]);
    expect(parseArpChoice({ accent: "middle", accentLength: "96" })).toMatchObject({ accent: "none", accentLength: "8" });
  });
});
