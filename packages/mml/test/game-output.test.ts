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
        const end = parseMml(text.text).gameEnd;
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

describe("gameScores 오르골·축음기 붙여넣기", () => {
  const box: Player = { id: "p1", name: "오르골", instrument: { canonical: "music-box" } };
  const six = () => ({
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    players: [box, flute],
    tracks: ["a", "b", "c", "d", "e", "f"].map((id, k) => track(id, "p1", `c${k + 1}`)).concat(track("x", "p2", "g1")),
    tempo: [{ at: rat(0), bpm: 140 }],
  });
  const chords = (id: string) => (id === "p1" ? 3 : 6);

  it("6트랙 오르골은 두 장 모두 6트랙을 넣고, 2장은 4·5·6·1·2·3 순서 (소리는 앞 3트랙)", () => {
    const scores = gameScores(six(), chords, 6);
    expect(scores.map((x) => [x.trackIds, x.pasted])).toEqual([
      [["a", "b", "c"], ["a", "b", "c", "d", "e", "f"]],
      [["d", "e", "f"], ["d", "e", "f", "a", "b", "c"]],
      [["x"], ["x"]],
    ]);
    const channels = (text: string) => text.slice(4, -1).split(",");
    const [one, two] = scores.map((x) => channels(x.text));
    // 같은 트랙은 두 장에서 같은 글
    expect(two).toEqual([...one!.slice(3), ...one!.slice(0, 3)]);
    // 소리 내는 트랙 글(texts)은 그 악보 트랙만
    expect(scores[1]!.texts.map((x) => x.trackId)).toEqual(["d", "e", "f"]);
  });

  it("4·5트랙 오르골은 2장의 빈 소리 칸을 빈 채널로 두어 앞 트랙이 두 번 나지 않는다", () => {
    const keep = (ids: string[]) => ({ ...six(), tracks: six().tracks.filter((t) => ids.includes(t.id)) });
    const four = gameScores(keep(["a", "b", "c", "d", "x"]), chords, 6);
    expect(four.map((x) => x.pasted)).toEqual([["a", "b", "c", "d"], ["d", null, null, "a", "b", "c"], ["x"]]);
    expect(four[1]!.text.split(",").slice(1, 3)).toEqual(["", ""]);
    const five = gameScores(keep(["a", "b", "c", "d", "e", "x"]), chords, 6);
    expect(five.map((x) => x.pasted)).toEqual([["a", "b", "c", "d", "e"], ["d", "e", null, "a", "b", "c"], ["x"]]);
    // 소리 칸(앞 3)에 든 트랙은 곡 전체에서 한 번씩
    const sounding = [...four, ...five].flatMap((x) => x.pasted.slice(0, 3).filter((id) => id !== null));
    expect(sounding.filter((id) => id !== "x").sort()).toEqual(["a", "a", "b", "b", "c", "c", "d", "d", "e"]);
  });

  it("pasteLimit를 주지 않으면 전처럼 그 악보 트랙만, 3트랙 이하 오르골도 그대로", () => {
    expect(gameScores(six(), chords).map((x) => x.pasted)).toEqual([["a", "b", "c"], ["d", "e", "f"], ["x"]]);
    const small = { ...six(), tracks: six().tracks.filter((t) => ["a", "b", "x"].includes(t.id)) };
    expect(gameScores(small, chords, 6).map((x) => x.pasted)).toEqual([["a", "b"], ["x"]]);
  });

  it("보통 악기가 6트랙을 넘겨 나뉜 악보에는 붙이지 않는다", () => {
    const s = { ...six(), players: [piano, flute], tracks: [...six().tracks.slice(0, 6), track("g", "p1", "c1"), track("x", "p2", "g1")] };
    expect(gameScores(s, 6, 6).map((x) => x.pasted.length)).toEqual([6, 1, 1]);
  });
});

