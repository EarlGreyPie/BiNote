import { describe, expect, it } from "vitest";
import { emptySong, History, MOBILE_PROFILE, normalizeTempo, rat, type Player, type Rat, type Song, type Track } from "@mmlce/core";
import { changeTempos, compactSong, distributeSong, fewerBooks, gameScores, padScore, parseMml, parseTrackText, planBooks, setTrackNotes, setTracksNotes, splitSong, trackSource } from "../src/index.js";

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

const L = MOBILE_PROFILE.length;

describe("padScore", () => {
  it("모자라면 가장 멀리 가는 글 끝에 쉼표와 템포를 붙이고, 이미 길이가 되면 그대로 둔다", () => {
    expect(padScore(["t120a"], rat(5, 4), 120, L)).toEqual(["t120ar1t120"]);
    expect(padScore(["a", "c2"], rat(1), 100, L)).toEqual(["a", "c2r2t100"]);
    expect(padScore(["a1"], rat(1), 100, L)).toEqual(["a1"]);
    // 잠근 글은 고치지 않는다
    expect(padScore(["a", "c2"], rat(1), 100, L, [true, false])).toEqual(["ar2.t100", "c2"]);
  });
});

describe("끝 채움이 글자 수 한도를 넘기지 않는다 (PR121 점검)", () => {
  const limit = MOBILE_PROFILE.charLimitPerScore;
  // A는 정확히 한도 글자. 다시 쓰면 끝 r2r2가 사라져 A에 채우면 한도를 넘는다
  const a = "cd".repeat((limit - 4) / 2) + "r2r2";
  const full = () => song([track("a", "p1", a), track("b", "p1", "e")]);

  it("padScore: 채운 뒤 한도 안인 글을 고르고, 없으면 전처럼 가장 멀리 가는 글에 붙인다", () => {
    expect(padScore(["a", "c2"], rat(1), 100, L, undefined, 6)).toEqual(["a", "c2r2t100"]);
    // c2에 채우면 7자로 한도 6을 넘으므로 a에 채운다
    expect(padScore(["a", "c2r64"], rat(1), 100, L, undefined, 8)).toEqual(["ar2.t100", "c2r64"]);
    // 어디에 채워도 넘으면 가장 멀리 가는 글에 (길이를 잃는 것보다 경고가 낫다)
    expect(padScore(["a", "c2"], rat(1), 100, L, undefined, 3)).toEqual(["a", "c2r2t100"]);
  });

  it("쉼표만 있는 짧은 채널에 채워도 그 채널의 게임 끝이 목표 길이와 같다", () => {
    const [x, y] = padScore(["cd".repeat(10), "e"], rat(6), 120, L, undefined, 24);
    expect(x).toBe("cd".repeat(10));
    expect(parseMml(y!).gameEnd).toEqual(rat(6));
  });

  it("2400자 곡: 글자 수 줄이기·게임 출력·악보책 나누기가 한도를 지키고 1권이다", () => {
    expect(a.length).toBe(limit);
    const s = full();
    const target = end(a);
    const compact = compactSong(MOBILE_PROFILE).apply(s);
    const texts = compact.tracks.map((t) => trackSource(compact, t).text);
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(limit);
    expect(texts.map((t) => parseMml(t).gameEnd).reduce((p, q) => (p.n * q.d >= q.n * p.d ? p : q))).toEqual(target);
    const pasted = gameScores(s, 6, undefined, limit)[0]!.texts.map((t) => t.text);
    for (const t of pasted) expect(t.length).toBeLessThanOrEqual(limit);
    expect(pasteEnd(s)).toEqual(target);
    expect(splitSong(s, MOBILE_PROFILE, { gapMs: null }).parts).toHaveLength(1);
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

  it("음을 옮긴 뒤 글자 수 줄이기가 곡을 그대로 두면(kept) 그 옮기기를 쓰지 않는다 (재점검 1번)", () => {
    const a = track("a", "p1", "t100l8" + "cdefgab>c<".repeat(300) + "r1r1r1t100");
    const b = track("b", "p1", "l1" + "r".repeat(300) + "c");
    // 다른 악보 U: 출력기로 정확히 쓸 수 없는 길이(1/240)의 음이라 글자 수 줄이기가 곡을 그대로 둔다
    const read = track("u", "p2", "t100c4");
    const { mml: _mml, ...bare } = read;
    const u = { ...bare, notes: read.notes.map((n) => ({ ...n, dur: rat(1, 240) })) };
    const s = song([a, b, u]);
    const plan = planBooks(s, MOBILE_PROFILE);
    // 옮긴 곡은 원문이 지워져 끝 길이(303)를 잃으므로 쓰지 않는다
    expect(plan.spread).toBeUndefined();
    expect(plan.song).toBe(s);
    expect(plan.result.parts.at(-1)!.end).toEqual(rat(303));
    // 권 수 줄이기 안내도 그런 옮기기는 내지 않는다
    expect(fewerBooks(s, MOBILE_PROFILE, plan.result.parts.length)).toBeUndefined();
  });

  it("이미 끝난 악보의 마지막 권(템포 하나뿐)을 손실로 보지 않는다 (3번)", () => {
    const s = song([track("a", "p1", "t100c4"), track("b", "p2", "t100" + "cdefgab>c<".repeat(8) + "r1t100")]);
    const r = splitSong(s, { ...MOBILE_PROFILE, charLimitPerScore: 24 }, { gapMs: null });
    expect(r.parts.length).toBeGreaterThan(1);
    for (const part of r.parts) expect(part.lossy).toEqual([]);
  });
});

describe("음을 직접 고쳐 원문을 지워도 원문 끝 쉼표 길이를 지킨다", () => {
  it("볼륨만 바꾸면(음 끝 그대로) 원문 끝 쉼표까지의 악보 길이가 남는다", () => {
    const s = song([track("a", "p1", "v8c4r4r4")]);
    expect(pasteEnd(s)).toEqual(rat(1, 2));
    const louder = s.tracks[0]!.notes.map((n) => ({ ...n, vol: 9 }));
    const next = setTracksNotes([{ trackId: "a", notes: louder }]).apply(s);
    expect(pasteEnd(next)).toEqual(rat(1, 2));
    expect(next.tracks[0]!.notes).toEqual(louder);
    expect(parseTrackText("a", next.tracks[0]!.mml!).notes.map((n) => n.vol)).toEqual([9]);
    // 한 트랙 명령도 같다
    expect(pasteEnd(setTrackNotes("a", louder).apply(s))).toEqual(rat(1, 2));
  });

  it("끝 음을 지우거나 늘리면(음 끝이 바뀜) 전처럼 음 끝이 길이다", () => {
    const s = song([track("a", "p1", "c4d4r4r4")]);
    const cut = setTrackNotes("a", s.tracks[0]!.notes.slice(0, 1)).apply(s);
    expect(cut.tracks[0]!.mml).toBeUndefined();
    expect(pasteEnd(cut)).toEqual(rat(1, 4));
  });

  it("템포가 있는 원문도 다시 쓴 글에 템포를 지키고 소리는 그대로다", () => {
    const s = song([track("a", "p1", "t90v8c4t100d4r2r4")]);
    const louder = s.tracks[0]!.notes.map((n) => ({ ...n, vol: 10 }));
    const next = setTracksNotes([{ trackId: "a", notes: louder }]).apply(s);
    expect(pasteEnd(next)).toEqual(rat(1));
    const back = parseTrackText("a", next.tracks[0]!.mml!);
    expect(normalizeTempo(back.tempo).map((e) => e.bpm).slice(0, 2)).toEqual([90, 100]);
  });

  it("끝에 붙이는 템포는 같은 악보 다른 트랙이 그 자리에 적은 템포를 따른다 (덮어쓰지 않는다)", () => {
    const s = song([track("a", "p1", "t60a1"), track("b", "p2", "t120e2t90g2"), track("c", "p2", "v8c4r4r4")]);
    const c = s.tracks.find((t) => t.id === "c")!;
    const next = setTracksNotes([{ trackId: "c", notes: c.notes.map((n) => ({ ...n, vol: 9 })) }]).apply(s);
    const text = next.tracks.find((t) => t.id === "c")!.mml!;
    expect(parseMml(text.text).gameEnd).toEqual(rat(1, 2));
    // 이 글이 1/2 자리에 적는 템포는 다른 트랙의 t90과 같아야 한다
    const atEnd = parseTrackText("c", text).tempo.filter((e) => e.at.n * 2 === e.at.d);
    expect(atEnd.map((e) => e.bpm)).toEqual([90]);
  });

  it("원문 없는 트랙이 같은 악보에 있으면 그 트랙에 출력기가 쓸 템포를 따른다", () => {
    const free = track("a", "p1", "t120e2t90g2");
    const { mml: _m, ...noText } = free;
    const s = song([free, track("c", "p1", "v8c4r4r4")]);
    const s2 = { ...s, tracks: [noText, s.tracks[1]!] };
    const c = s2.tracks[1]!;
    const next = setTracksNotes([{ trackId: "c", notes: c.notes.map((n) => ({ ...n, vol: 9 })) }]).apply(s2);
    const text = next.tracks.find((t) => t.id === "c")!.mml!;
    expect(parseMml(text.text).gameEnd).toEqual(rat(1, 2));
    expect(parseTrackText("c", text).tempo.filter((e) => e.at.n * 2 === e.at.d).map((e) => e.bpm)).toEqual([90]);
    // 고치기 전에는 그 t90을 원문 없는 트랙 a가 쓴다
    expect(trackSource(s2, noText).text).toContain("t90");
  });

  it("마지막 음과 지킨 끝 사이에 이 트랙이 적은 템포도 같은 자리에 다시 적는다 (끝 쉼표 시간이 그대로)", () => {
    for (const [text, want] of [
      ["t60c4t80r4r4", [[0, 60], [1 / 4, 80]]],
      ["t60c4r8t80r8t70r4r4", [[0, 60], [3 / 8, 80], [1 / 2, 70]]],
    ] as const) {
      const s = song([track("a", "p1", text)]);
      const next = setTracksNotes([{ trackId: "a", notes: s.tracks[0]!.notes.map((n) => ({ ...n, vol: 9 })) }]).apply(s);
      const mml = next.tracks[0]!.mml!;
      expect(parseMml(mml.text).gameEnd, text).toEqual(end(text));
      const tempo = normalizeTempo(parseTrackText("a", mml).tempo).map((e) => [e.at.n / e.at.d, e.bpm]);
      expect(tempo.slice(0, want.length), text).toEqual(want);
      // 끝에 붙인 템포는 그 자리 빠르기 그대로라 들리는 템포 지도는 원문과 같다
      expect(normalizeTempo(parseTrackText("a", mml).tempo).filter((e) => e.at.n / e.at.d < end(text).n / end(text).d)).toEqual(normalizeTempo(parseTrackText("a", { text }).tempo));
    }
  });

  it("마지막 음 뒤 같은 자리에 템포가 둘 적힌 원문은 마지막 것이 그 자리 빠르기로 남는다", () => {
    const text = "t60c4t90t80r4r4";
    const s = song([track("a", "p1", text), track("b", "p1", "g1")]);
    const next = setTracksNotes([{ trackId: "a", notes: s.tracks[0]!.notes.map((n) => ({ ...n, vol: 9 })) }]).apply(s);
    const mml = next.tracks[0]!.mml!;
    expect(parseMml(mml.text).gameEnd).toEqual(end(text));
    const at = (t: string) => normalizeTempo(parseTrackText("a", { text: t }).tempo).filter((e) => e.at.n / e.at.d < 1 / 2);
    expect(at(mml.text)).toEqual(at(text));
  });

  it("같은 자리에 두 트랙이 다른 템포를 적은 악보에서도 끝에 붙이는 템포는 곡 템포 지도가 쓰는 템포를 따른다", () => {
    const s = song([track("a", "p1", "t120e4t80f2g4"), track("b", "p1", "v8c4t90r4r4")]);
    const b = s.tracks.find((t) => t.id === "b")!;
    const next = setTracksNotes([{ trackId: "b", notes: b.notes.map((n) => ({ ...n, vol: 9 })) }]).apply(s);
    const text = next.tracks.find((t) => t.id === "b")!.mml!;
    expect(parseMml(text.text).gameEnd).toEqual(rat(1, 2));
    const playing = normalizeTempo(next.tempo).filter((e) => e.at.n * 4 <= e.at.d).at(-1)!.bpm;
    const atEnd = parseTrackText("b", text).tempo.filter((e) => e.at.n * 2 === e.at.d);
    expect(atEnd.map((e) => e.bpm)).toEqual([playing]);
    expect(playing).toBe(90);
  });
});
