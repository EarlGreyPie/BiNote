import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, PC_PROFILE, rat, type Note, type Player, type Song, type Track } from "@mmlce/core";
import { cutText, distributeSong, fewerScrolls, gameScores, gameTimeline, mmlTokens, splitParts } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };
function busy(n: number, from = 0): Note[] {
  return Array.from({ length: n }, (_, k) => ({ id: `n${from + k}`, start: rat(from + k, 8), dur: rat(1, 8), pitch: 60 + ((k * 5) % 12), vol: 8, tie: "none" as const }));
}
const track = (id: string, notes: Note[]): Track => ({ id, playerId: "p1", name: id, color: "#000", role: "free", mute: false, solo: false, notes, spelling: {} });
const song = (tracks: Track[]): Song => ({ ...emptySong({ title: "", author: "", profileId: "pc" }), players: [piano], tracks, tempo: [{ at: rat(0), bpm: 120 }] });

describe("파트마다 이어 읽는 악보책 (PC 자브키엘)", () => {
  it("명령 하나씩 나눈다", () => {
    expect(mmlTokens("t120l8o4c+4.&c16r>v10n60")).toEqual(["t120", "l8", "o4", "c+4.", "&", "c16", "r", ">", "v10", "n60"]);
  });

  it("조각을 이으면 원래 글이고, 조각마다 한도 안, & 바로 앞뒤에서 끊지 않는다", () => {
    const text = "t120l8o4" + "cde&fg>a<b".repeat(40);
    const { pieces, stuck } = cutText(text, 37);
    expect(stuck).toBe(false);
    expect(pieces.join("")).toBe(text);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(37);
      expect(p.endsWith("&")).toBe(false);
      expect(p.startsWith("&")).toBe(false);
    }
  });

  it("& 사슬이 한도보다 길면 명령 경계에서 끊고 알린다", () => {
    const r = cutText("c&c&c&c&c&c", 4);
    expect(r.stuck).toBe(true);
    expect(r.pieces.join("")).toBe("c&c&c&c&c&c");
  });

  it("파트마다 자리 한도에서 끊고, k번째 조각끼리 k번째 장 (장 머리에 다시 적지 않음)", () => {
    const s = song([track("a", busy(1500)), track("b", busy(300)), track("c", busy(100))]);
    const r = splitParts(s, PC_PROFILE);
    const written = gameScores(s, 3, 3, 1200)[0]!.texts;
    const book = r.books[0]!;
    expect(book.limits).toEqual([1200, 800, 500]);
    expect(r.scrolls).toBe(book.scrolls.length);
    expect(r.scrolls).toBeGreaterThan(1);
    book.trackIds.forEach((id, k) => {
      const whole = book.scrolls.map((sc) => sc.parts[k]).join("");
      expect(whole).toBe(written.find((x) => x.trackId === id)!.text);
      for (const sc of book.scrolls) expect(sc.parts[k]!.length).toBeLessThanOrEqual(book.limits[k]!);
    });
    expect(book.scrolls[1]!.text).toBe(`MML@${book.scrolls[1]!.parts.join(",")};`);
    // 두 번째 장 화음 파트는 비어 있다 (조각이 하나뿐)
    expect(book.scrolls[1]!.parts[2]).toBe("");
  });

  it("고르게 옮기면 장이 줄어드는지 찾고, 적용 명령도 같은 장 수", () => {
    // 멜로디만 길고 화음 파트는 앞부분만 친다: 뒤쪽 멜로디 음을 화음 파트로 옮기면 한 장에 들어간다
    const s = song([track("a", busy(900)), track("b", busy(40)), track("c", [])]);
    expect(splitParts(s, PC_PROFILE).scrolls).toBe(2);
    const f = fewerScrolls(s, PC_PROFILE);
    expect(f?.from).toBe(2);
    expect(f?.to).toBe(1);
    const after = distributeSong(PC_PROFILE, "분산", f!.fit).apply(s);
    expect(splitParts(after, PC_PROFILE).scrolls).toBe(1);
    expect(gameTimeline(after, PC_PROFILE)).toBe(gameTimeline(s, PC_PROFILE));
  });

  it("프로필: 모바일은 시간으로 나누는 악보책(20권), PC는 파트마다·지연 0", () => {
    expect(MOBILE_PROFILE.scoreBook).toEqual({ perPart: false, maxScores: 20 });
    expect(PC_PROFILE.scoreBook.perPart).toBe(true);
    expect(PC_PROFILE.scoreBookGapMs).toBe(0);
  });
});
