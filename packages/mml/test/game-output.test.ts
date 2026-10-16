import { describe, expect, it } from "vitest";
import { emptySong, eq, MOBILE_PROFILE, rat, type Player, type Song, type Track } from "@mmlce/core";
import { gameScores, parseMml, parseTrackText, splitSong } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };
const flute: Player = { id: "p2", name: "플루트", instrument: { canonical: "flute" } };

function track(id: string, playerId: string, text: string): Track {
  return { id, playerId, name: id, color: "#000", role: "free", mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {} };
}

function song(tracks: Track[], tempo = [{ at: rat(0), bpm: 150 }, { at: rat(2), bpm: 90 }]): Song {
  return { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [piano, flute], tracks, tempo };
}

const tempoOf = (texts: readonly string[]) => texts.flatMap((t) => parseMml(t).tempo).map((e) => `${e.at.n}/${e.at.d}:${e.bpm}`).sort();

describe("gameScores", () => {
  it("악보마다 곡 템포를 모두 넣는다 (곡 첫 채널에만 넣지 않는다)", () => {
    const s = song([track("a", "p1", "c1c1c1"), track("b", "p1", "e1e1e1"), track("x", "p2", "g1g1g1")]);
    const scores = gameScores(s, 6);
    expect(scores.map((x) => x.trackIds)).toEqual([["a", "b"], ["x"]]);
    for (const score of scores) {
      expect(tempoOf(score.texts.map((x) => x.text))).toEqual(["0/1:150", "2/1:90"]);
      expect(score.text.startsWith("MML@")).toBe(true);
      expect(score.asIs).toEqual([]);
    }
    // 음은 그대로
    const back = parseTrackText("x", { text: scores[1]!.texts[0]!.text }).notes;
    expect(back.map((n) => [n.start, n.pitch])).toEqual(s.tracks[2]!.notes.map((n) => [n.start, n.pitch]));
  });

  it("화음 수가 적은 악기는 악보를 나누고 나뉜 악보에도 템포를 넣는다", () => {
    const s = song([track("a", "p1", "c1"), track("b", "p1", "d1"), track("c", "p1", "e1")], [{ at: rat(0), bpm: 140 }]);
    const scores = gameScores(s, 2);
    expect(scores.map((x) => x.trackIds)).toEqual([["a", "b"], ["c"]]);
    for (const score of scores) expect(tempoOf(score.texts.map((x) => x.text))).toEqual(["0/1:140"]);
  });
});

describe("splitSong 악보마다", { timeout: 30_000 }, () => {
  it("권마다 모든 악보에 그때 템포를 넣고, 권 길이를 악보마다 지킨다", () => {
    const melody = "cdefgab>c<".repeat(6);
    // 두 번째 악보는 앞쪽에만 음이 있다: 권 끝 쉼표가 없으면 그 연주자만 다음 권을 일찍 시작한다
    const s = song([track("a", "p1", melody), track("x", "p2", "c4")], [{ at: rat(0), bpm: 150 }]);
    const r = splitSong(s, { ...MOBILE_PROFILE, charLimitPerScore: 40 }, { gapMs: null });
    expect(r.parts.length).toBeGreaterThan(1);
    for (const part of r.parts) {
      for (const text of part.texts) expect(parseMml(text.text).tempo.some((e) => eq(e.at, rat(0)) && e.bpm === 150)).toBe(true);
      if (part === r.parts.at(-1)) continue;
      const length = { n: part.end.n * part.start.d - part.start.n * part.end.d, d: part.end.d * part.start.d };
      for (const text of part.texts) {
        // 악보 x는 채널이 하나라 그 채널(끝 쉼표 포함)이 권 끝까지 가야 한다
        const end = parseMml(text.text).end;
        if (text.trackId === "x") expect(end.n / end.d).toBeCloseTo(length.n / length.d);
      }
    }
  });
});

describe("gameScores 시작을 미룬 원문", () => {
  it("시작을 미룬 원문(offset)은 그대로 쓰지 않는다", () => {
    const a: Track = { ...track("a", "p1", "c"), mml: { text: "c", offset: rat(1) } };
    const s = song([{ ...a, notes: a.notes.map((n) => ({ ...n, start: rat(1) })) }], []);
    const text = gameScores(s, 6)[0]!.texts[0]!.text;
    expect(parseTrackText("a", { text }).notes[0]!.start).toEqual(rat(1));
  });
});
