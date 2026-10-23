import { describe, expect, it } from "vitest";
import { emptySong, guessArpeggio, History, normalizeTempo, planArpeggio, rat, restoreMade, type ArpOptions, type Song } from "@mmlce/core";
import { adoptMadeCommand, applyMadeRestore, gameScores, keepTextEnd, madeCommand, parseMml, parseTrackText, restoreMadeCommand, setNotesAndAddTracks } from "../src/index.js";

/** 한 연주자 트랙들 (원문 있는 트랙은 원문에서 음을 읽는다) */
function songOf(texts: (string | undefined)[]): Song {
  const tracks = texts.map((text, k) => {
    const id = `t${k + 1}`;
    const parsed = text === undefined ? undefined : parseTrackText(id, { text });
    return {
      track: { id, playerId: "p1", name: id, color: "#000", role: "free" as const, mute: false, solo: false, notes: parsed?.notes ?? [], spelling: {}, ...(text === undefined ? {} : { mml: { text } }) },
      tempo: parsed?.tempo ?? [],
    };
  });
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: normalizeTempo(tracks.flatMap((t) => t.tempo)),
    players: [{ id: "p1", name: "피아노", instrument: { canonical: "piano" as const } }],
    tracks: tracks.map((t) => t.track),
  };
}
/** 정식 게임 출력의 첫 악보 게임 길이 (가장 긴 채널) */
const outEnd = (s: Song) => {
  const score = gameScores(s, 6)[0]!;
  return Math.max(...score.texts.map((x) => { const e = parseMml(x.text).gameEnd; return e.n / e.d; }));
};

describe("만든 것 되돌리기는 원문 끝 쉼표로 지키던 악보 길이를 지킨다 (GPT 재검수 B-J01)", () => {
  it("쉼표만 있던 트랙에 알아본 아르페지오의 원래 화음을 돌려놓아도 악보 길이·끝 템포가 그대로", () => {
    const song = songOf(["l16cegceg", "r1r1t90", undefined]);
    expect(outEnd(song)).toBe(2);
    let k = 0;
    const g = guessArpeggio(song, song.tracks[0]!.notes, () => `g${++k}`);
    if (!g.ok) throw new Error(g.reason);
    const h = new History(song);
    h.run(adoptMadeCommand({ tool: "arpeggio", options: {}, trackId: g.trackId, picked: g.picked }, g.before, g.after, "알아보기"));
    expect(outEnd(h.song)).toBe(2);
    const adopted = h.song;
    const plan = restoreMade(adopted, [adopted.made!.at(-1)!.id]);
    if (!plan.ok) throw new Error(plan.reason);
    // 쉼표만 있던 t2에 화음 음이 들어가는 경우를 본다
    expect(plan.changes.some((c) => c.trackId === "t2" && c.notes.length > 0)).toBe(true);
    h.run(restoreMadeCommand(plan, "원래대로"));
    expect(outEnd(h.song)).toBe(2);
    // 쉼표만 있던 트랙은 원래 음 뒤에 끝 쉼표를 남긴 원문으로 (원문 게임 길이 2)
    expect(parseMml(h.song.tracks.find((t) => t.id === "t2")!.mml!.text).gameEnd).toEqual({ n: 2, d: 1 });
    // 다시 고치기가 먼저 되돌리는 같은 길(applyMadeRestore)도 같다
    expect(outEnd(applyMadeRestore(adopted, plan))).toBe(2);
    h.undo();
    expect(outEnd(h.song)).toBe(2);
    h.undo();
    expect(h.song.tracks.map((t) => t.mml?.text)).toEqual(song.tracks.map((t) => t.mml?.text));
  });
});

describe("끝 쉼표는 원문에 실제로 있던 것만 지킨다 (GPT 3차 B-J02)", () => {
  /** 원문 trackText를 음 notes로 바꾼 뒤 그 트랙 원문 게임 길이 (원문이 없으면 음 끝) */
  const endAfter = (text: string, to: string) => {
    const before = songOf([text]);
    const notes = parseTrackText("t1", { text: to }).notes;
    const { mml: _m, ...rest } = before.tracks[0]!;
    const after = keepTextEnd(before, { ...before, tracks: [{ ...rest, notes }] }, ["t1"], "tail");
    const t = after.tracks[0]!;
    return t.mml ? parseMml(t.mml.text).gameEnd : t.notes.reduce((m, x) => Math.max(m, (x.start.n / x.start.d) + (x.dur.n / x.dur.d)), 0);
  };
  it("끝 쉼표가 없던 원문(c2)을 c4로 되돌리면 없던 쉼표를 만들지 않는다", () => {
    expect(endAfter("c2", "c4")).toBe(0.25);
  });
  it("끝 쉼표가 있던 원문(c2r2t90)은 음이 바뀌어도 그 길이를 지킨다", () => {
    expect(endAfter("c2r2t90", "c4")).toEqual(rat(1));
    expect(endAfter("r1r1t90", "c4")).toEqual(rat(2));
  });
});

describe("트랙 접기로 베이스를 옮겨 비운 트랙의 끝 쉼표를 지킨다 (GPT 3차 B-K01)", () => {
  const base: ArpOptions = {
    source: "together", chord: "major", style: "roll", order: "up", step: rat(1, 16), octaves: 1, repeat: false,
    clearChordTracks: true, range: { low: 0, high: 127 }, maxTracks: 6, fold: 4,
  };
  it("o2b-2r2t90 트랙의 베이스를 접어도 악보 길이 1, 원래대로 뒤에도 1", () => {
    const song = songOf(["o4a2", "o4f2", "o3d2", "o4c2", "o3g2", "o2b-2r2t90"]);
    expect(outEnd(song)).toBe(1);
    let k = 0;
    const r = planArpeggio(song, "t1", song.tracks[0]!.notes, base, () => `n${++k}`);
    expect(r.folded).toBe(1);
    const h = new History(song);
    h.run(madeCommand(setNotesAndAddTracks("p1", r.changes, r.newTracks, (n) => `t${n}`, "아르페지오"), { tool: "arpeggio", options: {}, trackId: "t1", picked: song.tracks[0]!.notes.map((x) => x.id) }));
    expect(h.song).not.toBe(song);
    expect(outEnd(h.song)).toBe(1);
    const plan = restoreMade(h.song, [h.song.made!.at(-1)!.id]);
    if (!plan.ok) throw new Error(plan.reason);
    h.run(restoreMadeCommand(plan, "원래대로"));
    expect(outEnd(h.song)).toBe(1);
    expect(h.song.tracks.map((t) => t.notes.map((x) => x.pitch))).toEqual(song.tracks.map((t) => t.notes.map((x) => x.pitch)));
  });
});
