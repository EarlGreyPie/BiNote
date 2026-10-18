import { describe, expect, it } from "vitest";
import { emptySong, History, MOBILE_PROFILE, normalizeTempo, rat, type Player, type Rat, type Song, type Track } from "@mmlce/core";
import { changeTempos, compactSong, distributeSong, gameScores, padScore, parseMml, parseTrackText, planBooks, splitSong, trackSource } from "../src/index.js";

/** 악보 길이 지키기: 다시 쓰는 출력도 원문의 게임 길이(끝 쉼표 포함)를 지킨다 */

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };
const flute: Player = { id: "p2", name: "플루트", instrument: { canonical: "flute" } };

/** 원문 트랙. player를 다르게 주면 다른 악보 */
function track(id: string, playerId: string, text: string): Track {
  return { id, playerId, name: id, color: "#000", role: "free", mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {}, mml: { text } };
}

function song(tracks: Track[]): Song {
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    players: [piano, flute],
    tracks,
    tempo: normalizeTempo(tracks.flatMap((t) => (t.mml ? parseTrackText(t.id, t.mml).tempo : []))),
  };
}

const end = (text: string): Rat => parseMml(text.replace(/^MML@/, "").replace(/;$/, "").split(",")[0]!).gameEnd;
/** 게임 붙여넣기 글들 가운데 가장 긴 게임 길이 */
const pasteEnd = (s: Song, k = 0) => gameScores(s, 6)[k]!.texts.map((t) => parseMml(t.text).gameEnd).reduce((a, b) => (a.n * b.d >= b.n * a.d ? a : b));

describe("padScore", () => {
  it("모자라면 가장 멀리 가는 글 끝에 쉼표와 템포를 붙이고, 이미 길이가 되면 그대로 둔다", () => {
    expect(padScore(["t120a"], rat(5, 4), 120)).toEqual(["t120ar1t120"]);
    expect(padScore(["a", "c2"], rat(1), 100)).toEqual(["a", "c2r2t100"]);
    expect(padScore(["a1"], rat(1), 100)).toEqual(["a1"]);
    // 잠근 글은 고치지 않는다
    expect(padScore(["a", "c2"], rat(1), 100, [true, false])).toEqual(["ar2.t100", "c2"]);
  });
});

describe("다시 쓰는 출력의 악보 길이 (Codex 4차 재현 A)", () => {
  it("t120a4r1t120: 게임 붙여넣기·글자 수 줄이기·화음 분산이 게임 길이 5/4를 지킨다", () => {
    const s = song([track("a", "p1", "t120a4r1t120")]);
    expect(pasteEnd(s)).toEqual(rat(5, 4));
    const compact = compactSong(MOBILE_PROFILE).apply(s);
    expect(end(trackSource(compact, compact.tracks[0]!).text)).toEqual(rat(5, 4));
    const spread = distributeSong(MOBILE_PROFILE).apply(s);
    expect(end(trackSource(spread, spread.tracks[0]!).text)).toEqual(rat(5, 4));
  });

  it("쉼표뿐인 t100r1t100도 길이 1을 지킨다", () => {
    const s = song([track("a", "p1", "t100r1t100")]);
    expect(pasteEnd(s)).toEqual(rat(1));
    const compact = compactSong(MOBILE_PROFILE).apply(s);
    expect(end(trackSource(compact, compact.tracks[0]!).text)).toEqual(rat(1));
  });

  it("짧은 악보는 다른 악보 템포 때문에 늘어나지 않는다 (Codex 4차 1번)", () => {
    // 악보 A는 1/4에서 끝난다. [1/2, 끝)을 60으로 바꿔도 A 붙여넣기에 쉼표와 t60을 붙이지 않는다
    const s = song([track("a", "p1", "t100c4r1"), track("b", "p2", "t100e1f1")]);
    const next = new History(s).run(changeTempos({ mode: "set", value: 60 }, rat(1, 2)));
    const a = gameScores(next, 6)[0]!;
    expect(a.trackIds).toEqual(["a"]);
    expect(parseMml(a.texts[0]!.text).gameEnd).toEqual(rat(1, 4));
    expect(parseMml(a.texts[0]!.text).tempo.map((e) => e.bpm)).toEqual([100]);
  });
});

describe("악보책 나누기의 곡 끝 (Codex 4차 재현 B, 닫힌 #116)", () => {
  it("a4r1t120은 나누지 않아도 길이 5/4를 지킨다", () => {
    const r = splitSong(song([track("a", "p1", "a4r1t120")]), MOBILE_PROFILE, { gapMs: null });
    expect(r.parts).toHaveLength(1);
    expect(parseMml(r.parts[0]!.texts[0]!.text).gameEnd).toEqual(rat(5, 4));
    expect(r.parts[0]!.end).toEqual(rat(5, 4));
  });

  it("나눠도 마지막 권이 원래 곡 끝까지 가고, 손실 검사가 길이까지 본다", () => {
    const text = "cdefgab>c<".repeat(8) + "r1t90";
    const s = song([track("a", "p1", text)]);
    const whole = parseMml(text).gameEnd;
    const r = splitSong(s, { ...MOBILE_PROFILE, charLimitPerScore: 24 }, { gapMs: null });
    expect(r.parts.length).toBeGreaterThan(1);
    const last = r.parts.at(-1)!;
    expect(last.end).toEqual(whole);
    const length = rat(whole.n * last.start.d - last.start.n * whole.d, whole.d * last.start.d);
    expect(parseMml(last.texts[0]!.text).gameEnd).toEqual(length);
    for (const part of r.parts) expect(part.lossy).toEqual([]);
  });

  it("끝 쉼표만 남은 빈 마지막 권을 만들지 않는다 (마지막 권에 음이 있다)", () => {
    const text = "cdefgab>c<".repeat(8) + "r1r1t120";
    const r = splitSong(song([track("a", "p1", text)]), { ...MOBILE_PROFILE, charLimitPerScore: 24 }, { gapMs: null });
    expect(r.parts.length).toBeGreaterThan(1);
    for (const part of r.parts) expect(parseMml(part.texts[0]!.text).notes.length).toBeGreaterThan(0);
    // 뒤에 템포가 있는 끝 쉼표(r1r1 t120)는 게임이 지우지 않으므로 마지막 권에 남긴다
    const last = r.parts.at(-1)!;
    expect(parseMml(last.texts[0]!.text).gameEnd.n).toBeGreaterThan(0);
    expect(last.end).toEqual(parseMml(text).gameEnd);
  });

  it("음만 있는 트랙 뒤 곡 템포가 있어도 템포만 든 마지막 권을 만들지 않는다", () => {
    const { mml: _mml, ...a } = track("a", "p1", "cdefgab>c<".repeat(8));
    const s = song([a]);
    const notesEnd = parseMml("cdefgab>c<".repeat(8)).end;
    const r = splitSong({ ...s, tempo: [{ at: rat(0), bpm: 120 }, { at: rat(notesEnd.n + notesEnd.d, notesEnd.d), bpm: 90 }] }, { ...MOBILE_PROFILE, charLimitPerScore: 24 }, { gapMs: null });
    for (const part of r.parts) expect(parseMml(part.texts[0]!.text).notes.length).toBeGreaterThan(0);
    expect(r.parts.at(-1)!.end).toEqual(notesEnd);
  });
});

describe("PR #122 점검", { timeout: 60_000 }, () => {
  it("악보책 나누기의 자동 화음 분산도 옮기기 전 악보 길이를 지킨다 (1번)", () => {
    const a = track("a", "p1", "t100l8" + "cdefgab>c<".repeat(300) + "r1r1r1t100");
    const b = track("b", "p1", "l1" + "r".repeat(300) + "c");
    const s = song([a, b]);
    const plan = planBooks(s, MOBILE_PROFILE);
    expect(plan.spread?.moved).toBeGreaterThan(0);
    const last = plan.result.parts.at(-1)!;
    expect(last.end).toEqual(rat(303));
    const ends = last.texts.map((t) => parseMml(t.text).gameEnd);
    const length = rat(303 * last.start.d - last.start.n, last.start.d);
    expect(ends.some((e) => e.n * length.d === length.n * e.d)).toBe(true);
    expect(last.lossy).toEqual([]);
  });

  it("이미 끝난 악보의 마지막 권(템포 하나뿐)을 손실로 보지 않는다 (3번)", () => {
    const s = song([track("a", "p1", "t100c4"), track("b", "p2", "t100" + "cdefgab>c<".repeat(8) + "r1t100")]);
    const r = splitSong(s, { ...MOBILE_PROFILE, charLimitPerScore: 24 }, { gapMs: null });
    expect(r.parts.length).toBeGreaterThan(1);
    for (const part of r.parts) expect(part.lossy).toEqual([]);
  });
});
