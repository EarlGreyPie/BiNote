import { describe, expect, it } from "vitest";
import { emptySong, eq, MOBILE_PROFILE, rat, type Player, type Song, type Track } from "@mmlce/core";
import { gameCharCounts, gamePaste, orderPasted, gameScores, parseMml, parseTrackText, pasteTempoChoices, splitSong } from "../src/index.js";

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


describe("gamePaste 여러 악보에서 고른 트랙", () => {
  const box: Player = { id: "pb", name: "오르골", instrument: { canonical: "music-box" } };
  const many = () => ({
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    players: [piano, flute],
    tracks: [
      ...["a", "b", "c", "d", "e", "f"].map((id, k) => track(id, "p1", `c${k + 1}`)),
      ...["u", "v", "w", "x", "y", "z"].map((id, k) => track(id, "p2", `g${k + 1}`)),
    ],
    tempo: [{ at: rat(0), bpm: 150 }, { at: rat(2), bpm: 90 }],
  });
  const channels = (text: string) => text.slice(4, -1).split(",");

  it("두 악보에서 고른 6트랙을 곡 트랙 순서대로 한 글에 쓰고 템포를 넣는다", () => {
    const p = gamePaste(many(), ["w", "a", "u", "b", "c", "z"], 6, 6, { tempo: true });
    expect(p.trackIds).toEqual(["a", "b", "c", "u", "w", "z"]);
    expect(p.pasted).toEqual(p.trackIds);
    expect(channels(p.text)).toHaveLength(6);
    expect(tempoOf(p.texts.map((x) => x.text))).toEqual(["0/1:150"]);
    // 음은 그대로
    for (const { trackId, text } of p.texts) {
      const orig = many().tracks.find((t) => t.id === trackId)!.notes;
      expect(parseTrackText(trackId, { text }).notes.map((n) => [n.start, n.dur, n.pitch])).toEqual(orig.map((n) => [n.start, n.dur, n.pitch]));
    }
  });

  it("템포를 끄면 t를 하나도 쓰지 않는다", () => {
    const p = gamePaste(many(), ["a", "u"], 6, 6, { tempo: false });
    expect(tempoOf(p.texts.map((x) => x.text))).toEqual([]);
  });

  it("처음 자리 t120은 쓰지 않는다 (게임 기본 t120, 붙여넣기마다 따로 읽음)", () => {
    const p = gamePaste({ ...many(), tempo: [] }, ["a"], 6, 6, { tempo: true });
    expect(tempoOf(p.texts.map((x) => x.text))).toEqual([]);
    const q = gamePaste({ ...many(), tempo: [{ at: rat(0), bpm: 120 }, { at: rat(1, 2), bpm: 90 }] }, ["a"], 6, 6, { tempo: true });
    expect(tempoOf(q.texts.map((x) => x.text))).toEqual(["1/2:90"]);
  });

  it("고른 트랙 길이까지의 템포만, 고른 템포 지도를 주면 그것을 쓴다", () => {
    const s = many();
    const longSong = { ...s, tracks: s.tracks.map((t) => (t.id === "z" ? track("z", "p2", "g1g1g1") : t)) };
    expect(tempoOf(gamePaste(longSong, ["a", "b"], 6, 6, { tempo: true }).texts.map((x) => x.text))).toEqual(["0/1:150"]);
    const long = gamePaste(longSong, ["a", "z"], 6, 6, { tempo: true });
    expect(tempoOf(long.texts.map((x) => x.text))).toEqual(["0/1:150", "2/1:90"]);
    const picked = gamePaste(many(), ["f"], 6, 6, { tempo: true, tempoMap: [{ at: rat(0), bpm: 100 }] });
    expect(tempoOf(picked.texts.map((x) => x.text))).toEqual(["0/1:100"]);
  });

  it("원문 끝 쉼표로 늘인 길이를 지킨다 (템포를 꺼도 끝 쉼표 뒤 t는 게임 기본 t120)", () => {
    const s = many();
    const a: Track = { ...s.tracks[0]!, mml: { text: "c1r1t120" } };
    const p = gamePaste({ ...s, tracks: [a, ...s.tracks.slice(1)] }, ["a", "b"], 6, 6, { tempo: false });
    expect(p.texts.some((x) => x.text.endsWith("t120"))).toBe(true);
    const ends = p.texts.map((x) => parseMml(x.text).gameEnd);
    expect(ends.some((e) => eq(e, rat(2)))).toBe(true);
  });

  it("오르골 악보 하나를 통째로 고르면 소리 없는 나머지 트랙을 전처럼 붙인다", () => {
    const s = { ...many(), players: [box, flute], tracks: many().tracks.map((t) => (t.playerId === "p1" ? { ...t, playerId: "pb" } : t)) };
    const chords = (id: string) => (id === "pb" ? 3 : 6);
    const whole = gamePaste(s, ["d", "e", "f"], chords, 6, { tempo: true });
    expect(whole.pasted).toEqual(["d", "e", "f", "a", "b", "c"]);
    expect(whole.texts.map((x) => x.trackId)).toEqual(["d", "e", "f"]);
    const mixed = gamePaste(s, ["d", "u"], chords, 6, { tempo: true });
    expect(mixed.pasted).toEqual(["d", "u"]);
  });

  it("원문 템포가 다른 악보를 섞어 고르면 고를 템포를 돌려주고, 같으면 빈 목록", () => {
    const s = many();
    expect(pasteTempoChoices(s, ["a", "u"], 6)).toEqual([]);
    const own: Track = { ...s.tracks[6]!, mml: { text: "t100g1" } };
    const mixed = { ...s, tracks: s.tracks.map((t) => (t.id === "u" ? own : t)) };
    const choices = pasteTempoChoices(mixed, ["a", "u"], 6);
    expect(choices.map((c) => [c.key, c.scores, c.tempo.map((e) => e.bpm)])).toEqual([
      ["song", [0], [150]],
      ["u", [1], [100]],
    ]);
  });
});

describe("gameCharCounts", () => {
  it("원문의 주석·줄바꿈·겹친 v·l은 세지 않고, 내보낼 때(gameScores) 글 길이를 센다", () => {
    const text = "/* 스윙 느낌 */\nt150\nv8l8 c v8l8 d\n\nv8l8 e v8l8 f\n/* 끝 */\n";
    const a: Track = { ...track("a", "p1", text), mml: { text } };
    const s = song([a, track("x", "p2", "g1")], [{ at: rat(0), bpm: 150 }]);
    const counts = gameCharCounts(s, 6);
    const written = new Map(gameScores(s, 6).flatMap((x) => x.texts.map((y) => [y.trackId, y.text.length] as const)));
    expect(counts).toEqual(written);
    expect(counts.get("a")!).toBeLessThan(text.length);
  });

  it("같은 트랙을 다시 세도 같고, 템포가 바뀌면 그 템포로 다시 쓴다", () => {
    const a = track("a", "p1", "cdefgab>c");
    const one = gameCharCounts(song([a], [{ at: rat(0), bpm: 150 }]), 6);
    expect(gameCharCounts(song([a], [{ at: rat(0), bpm: 150 }]), 6)).toEqual(one);
    const texts = gameScores(song([a], [{ at: rat(0), bpm: 150 }, { at: rat(1, 2), bpm: 90 }]), 6)[0]!.texts;
    expect(tempoOf(texts.map((x) => x.text))).toEqual(["0/1:150", "1/2:90"]);
  });
});

describe("gamePaste 붙여넣는 순서", () => {
  it("order를 주면 붙여넣는 글 안의 고른 트랙 순서만 바뀌고 글은 같다", () => {
    const s = song([track("a", "p1", "c1"), track("b", "p1", "e1"), track("x", "p2", "g1")], [{ at: rat(0), bpm: 150 }]);
    const base = gamePaste(s, ["a", "b", "x"], 6, 6, { tempo: true });
    const moved = gamePaste(s, ["a", "b", "x"], 6, 6, { tempo: true, order: ["x", "a"] });
    expect(base.pasted).toEqual(["a", "b", "x"]);
    expect(moved.pasted).toEqual(["x", "a", "b"]);
    expect(moved.trackIds).toEqual(["a", "b", "x"]);
    // 음은 그대로이고 템포는 어느 채널에 들어가도 악보 전체에 걸린다
    const notesOf = (p: typeof base, id: string) => parseTrackText(id, { text: p.written.get(id)! }).notes.map((n) => [n.start, n.dur, n.pitch]);
    for (const id of ["a", "b", "x"]) expect(notesOf(moved, id)).toEqual(notesOf(base, id));
    expect(tempoOf([...moved.written.values()])).toEqual(["0/1:150"]);
    expect(moved.text).toBe(`MML@${["x", "a", "b"].map((id) => moved.written.get(id)).join(",")};`);
  });

  it("orderPasted: 빈 채널·소리 없는 트랙 자리는 그대로 둔다", () => {
    expect(orderPasted(["a", "b", null, "z"], ["a", "b"], ["b"])).toEqual(["b", "a", null, "z"]);
    expect(orderPasted(["a", "b"], ["a", "b"], undefined)).toEqual(["a", "b"]);
  });
});

describe("gameScores와 gamePaste 글자 수", () => {
  it("악보 하나를 통째로 고르면 gamePaste(템포 넣기)와 같은 글이다 (처음 자리 t120은 둘 다 쓰지 않음)", () => {
    for (const tempo of [[], [{ at: rat(1), bpm: 90 }], [{ at: rat(0), bpm: 120 }, { at: rat(1), bpm: 90 }], [{ at: rat(0), bpm: 150 }, { at: rat(1), bpm: 90 }]]) {
      const s = song([track("a", "p1", "c1c1"), track("b", "p1", "r1e1"), track("x", "p2", "g1g1")], tempo);
      for (const score of gameScores(s, 6, 6)) {
        const p = gamePaste(s, score.trackIds, 6, 6, { tempo: true });
        expect(score.texts.map((x) => x.text)).toEqual(p.texts.map((x) => x.text));
      }
    }
  });
});
