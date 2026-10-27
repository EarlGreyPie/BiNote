import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attenuateChordVolumes, defaultLengthLimit, History, MOBILE_PROFILE, planGhost, planHarmonic, planLabClear, planReverbBatch, planReverbStamp, rat, type Note, type Song } from "@mmlce/core";
import { addPlayer, addTrack, applyPlan, canWriteExactly, deleteTime, duplicateTrack, distributeSong, findOffgrid, findSpreadSpans, fixOffgrid, insertTime, mergeTracksSong, newSong, parseTrackText, planMergeTracks, planMoveNotes, rampTempos, removeTrack, setMeter, setTrackText, setTempoAt, setTempos, setTracksNotes, spreadSong } from "@mmlce/mml";
import { pairBarTempo, tapTempos } from "../src/lib/tempoSync";
import { newOutOfRangeTrack, newUnwritableTrack } from "../src/lib/writable";
import { attenuationOptions, CHORD_ATT_DEFAULTS } from "../src/lib/chordAttPrefs";
import { retuneCommand, retuneKeepingTab } from "../src/lib/retune";
import { shiftStrings, TUNINGS } from "../src/lib/tunings";

const limit = defaultLengthLimit();
const note = (id: string, start: [number, number], dur: [number, number], pitch = 60): Note => ({ id, start: rat(...start), dur: rat(...dur), pitch, vol: 8, tie: "none" });
/** 앱과 같은 검사를 건 실행 취소 기록 */
const guarded = (song: Song) => new History(song, (before, after) => newUnwritableTrack(before, after, limit) === undefined);
/** 트랙 두 개(t1, t2)에 음을 넣은 곡 */
function song(t1: Note[], t2: Note[] = []): Song {
  const s = addTrack("p1", "트랙 2").apply(newSong({ playerName: "피아노", trackName: "트랙 1" }));
  return { ...s, tracks: s.tracks.map((tr) => ({ ...tr, notes: tr.id === "t1" ? t1 : t2 })) };
}

describe("모든 편집은 실행 취소 기록 한 곳에서 쓸 수 없는 길이 검사를 지난다", () => {
  it("마디 빼기: 1/20 음 가운데를 1/28 자리부터 빼서 1/70 음이 남으면 거절", () => {
    const s = song([note("a", [1, 1], [1, 20])]);
    const h = guarded(s);
    expect(h.run(deleteTime(rat(1, 28), rat(1)))).toBe(s);
    expect(h.refused).toBe(true);
    // 칸에 맞는 자리(마디 처음)에서 빼면 된다
    h.run(deleteTime(rat(0), rat(1)));
    expect(h.refused).toBe(false);
  });

  it("마디 넣기: 원래 있던 쓸 수 없는 조각은 밀기만 하면 막지 않는다", () => {
    const s = song([note("a", [0, 1], [1, 70]), note("b", [1, 1], [1, 4])]);
    const h = guarded(s);
    h.run(insertTime(rat(1, 2), rat(1)));
    expect(h.refused).toBe(false);
    expect(h.song.tracks[0]!.notes[1]!.start).toEqual(rat(2));
  });

  it("화음↔트랙 정리 합치기: 1/28 음 사이에 1/70 쉼표가 생기면 거절", () => {
    const s = song([note("a", [0, 1], [1, 28])], [note("b", [1, 20], [1, 28], 64)]);
    const h = guarded(s);
    expect(h.run(applyPlan(planMergeTracks(s, ["t2"], "t1"), "합치기"))).toBe(s);
    expect(h.refused).toBe(true);
    // 같은 격자 음끼리는 합칠 수 있다
    const ok = song([note("a", [0, 1], [1, 28])], [note("b", [1, 28], [1, 28], 64)]);
    const g = guarded(ok);
    g.run(applyPlan(planMergeTracks(ok, ["t2"], "t1"), "합치기"));
    expect(g.refused).toBe(false);
  });

  it("화음↔트랙 정리 음 옮기기: 다른 트랙으로 옮겨 1/70 쉼표가 생기면 거절", () => {
    const s = song([note("b", [1, 20], [1, 20], 64)], [note("c", [0, 1], [1, 28], 67)]);
    const h = guarded(s);
    // b를 t2로 옮기면 t2의 c(끝 1/28)와 b(1/20) 사이가 1/70
    h.run(applyPlan(planMoveNotes(s, "t1", new Set(["b"]), "t2"), "옮기기"));
    expect(h.refused).toBe(true);
    expect(h.song).toBe(s);
  });

  it("원래 있던 쓸 수 없는 음을 다른 트랙으로 옮기는 것(합치기·나누기)은 막지 않는다", () => {
    const s = song([note("a", [0, 1], [1, 4])], [note("b", [1, 1], [1, 128], 64)]);
    const h = guarded(s);
    h.run(applyPlan(planMergeTracks(s, ["t2"], "t1"), "합치기"));
    expect(h.refused).toBe(false);
  });

  it("개수가 같아도 다른 쓸 수 없는 길이로 바꾸면 거절 (지난 writable.ts:30)", () => {
    const s = song([note("a", [0, 1], [1, 70])]);
    const h = guarded(s);
    h.run(setTracksNotes([{ trackId: "t1", notes: [note("a", [0, 1], [1, 168])] }], "길이"));
    expect(h.refused).toBe(true);
  });

  it("음 시간을 바꾸지 않는 템포·박자 편집, 화음 분산은 그대로 된다", () => {
    const s = song([note("a", [0, 1], [1, 20]), note("b", [1, 20], [1, 20], 64), note("c", [1, 20], [1, 20], 67)]);
    const h = guarded(s);
    for (const command of [setTempoAt(rat(1, 20), 90), setMeter(rat(1), 3, 4), distributeSong(MOBILE_PROFILE)]) {
      h.run(command);
      expect(h.refused, command.label).toBe(false);
    }
  });

  it("탭 템포(이어 찍기·파형 맞추기)와 양옆 마디선 끌기는 템포만 바꾸고 음은 그대로 둔다", () => {
    const s = song([note("a", [0, 1], [1, 1]), note("b", [1, 1], [1, 1], 64), note("c", [2, 1], [1, 1], 67)]);
    const h = guarded(s);
    const tap = tapTempos(h.song.tempo, h.song.timeSig, rat(1), [2, 4.4, 6.5])!;
    const pair = pairBarTempo(h.song.tempo, h.song.timeSig, rat(2), 4.3)!;
    for (const plan of [tap, pair]) {
      h.run(setTempos(plan.set, plan.remove));
      expect(h.refused).toBe(false);
      expect(h.song.tracks.map((tr) => tr.notes)).toEqual(s.tracks.map((tr) => tr.notes));
    }
  });

  it("점점 느리게·빠르게는 템포만 바꾸고(음 가운데면 &로 나눠도 소리는 같다) 검사를 지나며, 실행 취소 한 번에 돌아간다", () => {
    const ramp = { startBpm: 120, endBpm: 80, step: rat(1, 4), curve: "linear" as const, restore: true };
    // 원문 없는 트랙: 템포만 바뀐다
    const s = song([note("a", [0, 1], [1, 20]), note("b", [1, 20], [3, 4], 64), note("c", [1, 1], [1, 4], 67)]);
    const h = guarded(s);
    h.run(rampTempos(ramp, rat(0), rat(1)));
    expect(h.refused).toBe(false);
    expect(h.song.tracks.map((tr) => tr.notes)).toEqual(s.tracks.map((tr) => tr.notes));
    expect(h.song.tempo.map((e) => e.bpm)).toEqual([120, 107, 93, 80, 120]);
    // 원문 있는 트랙: 걸친 음을 &로 나눈다
    const g = guarded(s);
    g.run(setTrackText("t1", "t120 c1 d4"));
    const before = g.song;
    g.run(rampTempos(ramp, rat(0), rat(1)));
    expect(g.refused).toBe(false);
    expect(g.song.tracks[0]!.mml!.text).toBe("t120 c4&t107c4&t93c4&t80c4 t120d4");
    g.undo();
    expect(g.song).toBe(before);
  });

  it("어긋난 길이 고치기: 쓸 수 있는 길이로만 바꾸므로 검사를 지나고, 뒤 음이 칸에 맞는다", () => {
    const text = "l64c4r21cdefgg8b+4b19.abcd4";
    const base = song([]);
    const s: Song = { ...base, tracks: base.tracks.map((tr) => (tr.id === "t1" ? { ...tr, notes: parseTrackText("t1", { text }).notes, mml: { text } } : tr)) };
    const h = guarded(s);
    h.run(fixOffgrid(findOffgrid(s)));
    expect(h.refused).toBe(false);
    expect(h.song.tracks[0]!.mml!.text).toBe("l64c4r32.cdefgg8b+4b16&b64abcd4");
    expect(h.song.tracks[0]!.notes.at(-1)!.start).toEqual(rat(7, 8));
  });
});

describe("화음 분산·병합 창의 명령도 같은 검사를 지난다", () => {
  it("구간 맞바꾸기·트랙 비우기는 쓸 수 있는 길이만 만들면 그대로 된다", () => {
    const s = song(
      [note("a", [0, 1], [1, 4]), note("b", [1, 4], [1, 4], 62), note("c", [1, 1], [1, 4], 64), note("d", [5, 4], [1, 4], 65)],
      [note("x", [0, 1], [1, 1], 48)],
    );
    const h = guarded(s);
    const spans = findSpreadSpans(s, "t1", ["t2"]);
    expect(spans.length).toBeGreaterThan(0);
    h.run(spreadSong(MOBILE_PROFILE, "t1", spans));
    expect(h.refused).toBe(false);
    expect(h.song).not.toBe(s);
    const m = song([note("a", [0, 1], [1, 4]), note("b", [1, 2], [1, 4], 62)], [note("x", [1, 4], [1, 4], 48)]);
    const g = guarded(m);
    g.run(mergeTracksSong(MOBILE_PROFILE, { keep: ["t1"], remove: ["t2"], level: 1 }));
    expect(g.refused).toBe(false);
    expect(g.song.tracks).toHaveLength(1);
  });
});

describe("앱의 곡 바꾸기 길 목록 (새 길이 검사를 건너뛰지 않게)", () => {
  const dir = new URL("../src/", import.meta.url);
  const app = readFileSync(new URL("App.svelte", dir), "utf8");

  it("App.svelte는 실행 취소 기록을 newHistory로만 만들고 history.run은 commit 안에서만 부른다", () => {
    expect(app.match(/new History\(/g)).toHaveLength(1);
    expect(app).toContain("return new History(next, guardEdit);");
    expect(app.match(/history\.run\(/g)).toHaveLength(1);
    expect(app).toContain("const next = history.run(command, options);");
  });

  it("검사를 일부러 건너뛰는 길은 MML 글 직접 입력과 MML 글 붙여 더하기 둘뿐", () => {
    const skips = app.split("\n").filter((line) => line.includes("unchecked: true"));
    expect(skips.map((line) => line.trim())).toEqual([
      "commit(setTrackText(trackId, text), { unchecked: true });",
      "const next = commit(appendSong(other), { unchecked: true });",
    ]);
  });

  it("다른 화면 파일은 곡 기록을 직접 바꾸지 않는다", () => {
    const files = readdirSync(new URL("lib/", dir), { recursive: true, encoding: "utf8" }).filter((f) => /\.(svelte|ts)$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(new URL(`lib/${f}`, dir), "utf8");
      expect(/new History\(|\.run\(\s*(set|add|remove|insert|delete|apply|distribute|merge|move)/.test(text), f).toBe(false);
    }
  });

  it("타브 그대로 튜닝 바꾸기는 높이만 바꿔 검사를 지나고, 실행 취소 한 번에 음과 튜닝이 함께 돌아간다", () => {
    const s = song([note("a", [0, 1], [1, 4], 40), note("b", [1, 4], [1, 20], 45)], [note("c", [0, 1], [1, 4], 64)]);
    const h = guarded(s);
    const from = { strings: TUNINGS.standard.strings, capo: 0, maxFret: 24 };
    const to = { strings: TUNINGS.dropD.strings, capo: 1, maxFret: 24 };
    const r = retuneKeepingTab(s.tracks, from, to);
    h.run(retuneCommand("p1", { tuning: "dropD", capo: 1 }, r.changes, "튜닝"));
    expect(h.refused).toBe(false);
    expect(h.song.tracks.flatMap((t) => t.notes.map((n) => n.pitch))).toEqual([39, 46, 65]);
    expect(h.song.players[0]!.tab).toEqual({ tuning: "dropD", capo: 1 });
    expect(h.undo()).toEqual(s);
  });

  it("타브 그대로 직접 입력 튜닝(반음 내린 부분 내슈빌 바리톤)으로 바꾸면 숫자가 그대로고, 실행 취소 한 번에 음과 튜닝이 함께 돌아간다", () => {
    const s = song([note("a", [0, 1], [1, 4], 33), note("b", [1, 4], [1, 4], 62)], [note("c", [0, 1], [1, 4], 57)]);
    const h = guarded(s);
    h.amend({ ...h.song, players: h.song.players.map((p) => ({ ...p, tab: { tuning: "nashvilleBaritone", capo: 0 } })) });
    const before = h.song;
    const strings = shiftStrings(TUNINGS.nashvilleBaritone.strings, -1)!;
    const from = { strings: TUNINGS.nashvilleBaritone.strings, capo: 0, maxFret: 24 };
    const r = retuneKeepingTab(s.tracks, from, { strings, capo: 0, maxFret: 24 });
    h.run(retuneCommand("p1", { tuning: "custom", capo: 0, strings }, r.changes, "튜닝"));
    expect(h.refused).toBe(false);
    expect(h.song.tracks.flatMap((t) => t.notes.map((n) => n.pitch))).toEqual([32, 61, 56]);
    expect(h.song.players[0]!.tab).toEqual({ tuning: "custom", capo: 0, strings: [56, 51, 59, 54, 37, 32] });
    expect(h.undo()).toEqual(before);
  });

  it("타브 그대로 튜닝 바꾸기 뒤 보기 튜닝을 따로 고르면, 실행 취소·다시 실행은 음만 되돌리고 나중에 고른 보기 튜닝을 지킨다", () => {
    const s = song([note("a", [0, 1], [1, 4], 40)], [note("c", [0, 1], [1, 4], 64)]);
    const h = guarded(s);
    const r = retuneKeepingTab(s.tracks, { strings: TUNINGS.standard.strings, capo: 0, maxFret: 24 }, { strings: TUNINGS.dropD.strings, capo: 0, maxFret: 24 });
    h.run(retuneCommand("p1", { tuning: "dropD", capo: 0 }, r.changes, "튜닝"));
    const view = { tuning: "bass4", capo: 3 };
    h.amend({ ...h.song, players: h.song.players.map((p) => ({ ...p, tab: view })) });
    h.undo();
    expect(h.song.tracks.map((t) => t.notes.map((n) => n.pitch))).toEqual(s.tracks.map((t) => t.notes.map((n) => n.pitch)));
    expect(h.song.players[0]!.tab).toEqual(view);
    h.redo();
    expect(h.song.tracks[0]!.notes[0]!.pitch).toBe(38);
    expect(h.song.players[0]!.tab).toEqual(view);
  });

  it("쓸 수 있는 높이(o0c~o9g) 밖의 음을 새로 만드는 편집은 막고, 원래 있던 범위 밖 음은 막지 않는다", () => {
    const octave = MOBILE_PROFILE.octave;
    const s = song([note("a", [0, 1], [1, 4], 127)], [note("b", [0, 1], [1, 4], 12)]);
    const up = setTracksNotes([{ trackId: s.tracks[0]!.id, notes: [{ ...s.tracks[0]!.notes[0]!, pitch: 128 }] }], "높이").apply(s);
    expect(newOutOfRangeTrack(s, up, octave)).toBe(s.tracks[0]!.id);
    const down = setTracksNotes([{ trackId: s.tracks[1]!.id, notes: [{ ...s.tracks[1]!.notes[0]!, pitch: 11 }] }], "높이").apply(s);
    expect(newOutOfRangeTrack(s, down, octave)).toBe(s.tracks[1]!.id);
    // 이미 범위 밖이던 음을 옮기기만 하면 새로 만든 것이 아니다
    const moved = setTracksNotes([{ trackId: s.tracks[1]!.id, notes: [{ ...down.tracks[1]!.notes[0]!, start: rat(1, 4) }] }], "옮기기").apply(down);
    expect(newOutOfRangeTrack(down, moved, octave)).toBeUndefined();
    expect(newOutOfRangeTrack(s, s, octave)).toBeUndefined();
    // 범위 밖 음 수가 같아도 새로 범위 밖이 된 음은 막는다 (MIDI 11·127을 반음 올리면 12·128)
    const odd = song([note("x", [0, 1], [1, 4], 11), note("y", [1, 4], [1, 4], 127)]);
    const raised = setTracksNotes([{ trackId: odd.tracks[0]!.id, notes: odd.tracks[0]!.notes.map((n) => ({ ...n, pitch: n.pitch + 1 })) }], "높이").apply(odd);
    expect(newOutOfRangeTrack(odd, raised, octave)).toBe(odd.tracks[0]!.id);
    // 원래 있던 범위 밖 음을 다른 트랙으로 옮기기는 된다
    const low = odd.tracks[0]!.notes[0]!;
    const across = setTracksNotes(
      [
        { trackId: odd.tracks[0]!.id, notes: [odd.tracks[0]!.notes[1]!] },
        { trackId: odd.tracks[1]!.id, notes: [low] },
      ],
      "옮기기",
    ).apply(odd);
    expect(newOutOfRangeTrack(odd, across, octave)).toBeUndefined();
    // 원래 있던 범위 밖 음이라도 복제해 하나가 둘이 되면 막는다 (옛 파일의 MIDI 11 음이 든 트랙 복제)
    const copied = duplicateTrack(odd.tracks[0]!.id, "복제").apply(odd);
    expect(copied.tracks.length).toBe(odd.tracks.length + 1);
    expect(newOutOfRangeTrack(odd, copied, octave)).toBeDefined();
    // 같은 트랙 안에서 같은 음을 하나 더 만들어도 막는다
    const twice = setTracksNotes([{ trackId: odd.tracks[0]!.id, notes: [...odd.tracks[0]!.notes, { ...low, id: "x2" }] }], "붙여넣기").apply(odd);
    expect(newOutOfRangeTrack(odd, twice, octave)).toBe(odd.tracks[0]!.id);
  });

  it("반음 내림과 카포 1이 상쇄돼 높이가 그대로여도 튜닝은 바뀌고 실행 취소로 돌아간다", () => {
    const s = song([note("a", [0, 1], [1, 4], 40)], [note("c", [0, 1], [1, 4], 64)]);
    const h = guarded(s);
    const strings = shiftStrings(TUNINGS.standard.strings, -1)!;
    const r = retuneKeepingTab(s.tracks, { strings: TUNINGS.standard.strings, capo: 0, maxFret: 24 }, { strings, capo: 1, maxFret: 24 });
    expect(r.moved).toBe(0);
    h.run(retuneCommand("p1", { tuning: "custom", capo: 1, strings }, r.changes, "튜닝"));
    expect(h.refused).toBe(false);
    expect(h.song.tracks.flatMap((t) => t.notes.map((n) => n.pitch))).toEqual([40, 64]);
    expect(h.song.players[0]!.tab).toEqual({ tuning: "custom", capo: 1, strings });
    expect(h.undo()).toEqual(s);
  });

  it("옮기면 o0c(12) 아래로 가는 음은 그대로 둔다", () => {
    const s = song([note("a", [0, 1], [1, 4], 13)]);
    const r = retuneKeepingTab(s.tracks, { strings: [13], capo: 0, maxFret: 24 }, { strings: [12], capo: 0, maxFret: 24 });
    expect(r.moved).toBe(1);
    const t = retuneKeepingTab(s.tracks, { strings: [13], capo: 0, maxFret: 24 }, { strings: [11], capo: 0, maxFret: 24 });
    expect(t.moved).toBe(0);
    expect(t.kept).toBe(1);
  });

  it("보기 튜닝을 원래와 같은 값으로 따로 골라도 나중 선택이다: 실행 취소·다시 실행이 덮지 않는다 (직접 입력 [64] → [63])", () => {
    const s = song([note("a", [0, 1], [1, 4], 64)]);
    const setView = (h: History, tab: { tuning: string; capo: number; strings?: number[] }) =>
      h.amend({ ...h.song, players: h.song.players.map((p) => ({ ...p, tab })) });
    const retune = (h: History, from: number[], to: number[]) => {
      const r = retuneKeepingTab(h.song.tracks, { strings: from, capo: 0, maxFret: 24 }, { strings: to, capo: 0, maxFret: 24 });
      h.run(retuneCommand("p1", { tuning: "custom", capo: 0, strings: to }, r.changes, "튜닝"));
    };
    // 바꾼 뒤 보기만 처음 값 [64]로 → 실행 취소 → 다시 실행: [64]를 지킨다
    const h = guarded(s);
    setView(h, { tuning: "custom", capo: 0, strings: [64] });
    retune(h, [64], [63]);
    setView(h, { tuning: "custom", capo: 0, strings: [64] });
    h.undo();
    expect(h.song.players[0]!.tab).toEqual({ tuning: "custom", capo: 0, strings: [64] });
    h.redo();
    expect(h.song.players[0]!.tab).toEqual({ tuning: "custom", capo: 0, strings: [64] });
    // 바꾼 뒤 보기를 [62] → [63]으로 다시 고름 → 실행 취소: 나중 선택 [63]을 지킨다
    const g = guarded(s);
    setView(g, { tuning: "custom", capo: 0, strings: [64] });
    retune(g, [64], [63]);
    setView(g, { tuning: "custom", capo: 0, strings: [62] });
    setView(g, { tuning: "custom", capo: 0, strings: [63] });
    g.undo();
    expect(g.song.players[0]!.tab).toEqual({ tuning: "custom", capo: 0, strings: [63] });
    // 따로 고르지 않았으면 실행 취소·다시 실행이 음과 튜닝을 함께 되돌린다
    const k = guarded(s);
    setView(k, { tuning: "custom", capo: 0, strings: [64] });
    retune(k, [64], [63]);
    k.undo();
    expect(k.song.players[0]!.tab).toEqual({ tuning: "custom", capo: 0, strings: [64] });
    k.redo();
    expect(k.song.players[0]!.tab).toEqual({ tuning: "custom", capo: 0, strings: [63] });
    k.undo();
    expect(k.song.players[0]!.tab).toEqual({ tuning: "custom", capo: 0, strings: [64] });
  });

  it("타브 그대로 튜닝 바꾸기를 두 번 한 뒤 실행 취소 두 번이면 음과 튜닝이 함께 처음으로, 다시 실행 두 번이면 끝으로 간다", () => {
    const s = song([note("a", [0, 1], [1, 4], 64)]);
    const h = guarded(s);
    const tab = (strings: number[]) => ({ tuning: "custom", capo: 0, strings });
    h.amend({ ...h.song, players: h.song.players.map((p) => ({ ...p, tab: tab([64]) })) });
    const start = h.song;
    for (const [from, to] of [[[64], [63]], [[63], [62]]] as const) {
      const r = retuneKeepingTab(h.song.tracks, { strings: [...from], capo: 0, maxFret: 24 }, { strings: [...to], capo: 0, maxFret: 24 });
      h.run(retuneCommand("p1", tab([...to]), r.changes, "튜닝"));
    }
    expect(h.song.players[0]!.tab).toEqual(tab([62]));
    expect(h.song.tracks[0]!.notes[0]!.pitch).toBe(62);
    h.undo();
    expect(h.song.players[0]!.tab).toEqual(tab([63]));
    expect(h.song.tracks[0]!.notes[0]!.pitch).toBe(63);
    h.undo();
    expect(h.song).toEqual(start);
    h.redo();
    h.redo();
    expect(h.song.players[0]!.tab).toEqual(tab([62]));
    expect(h.song.tracks[0]!.notes[0]!.pitch).toBe(62);
  });

  it("타브 그대로 바꾼 악보를 지우고 같은 id로 새 악보를 만든 뒤 실행 취소를 이어 하면 음과 튜닝이 함께 처음으로 간다", () => {
    const tab = (strings: number[]) => ({ tuning: "custom", capo: 0, strings });
    const h = guarded(song([]));
    h.run(addPlayer("piano", "기타", "트랙 3"));
    const p2 = h.song.players[1]!.id;
    const t3 = h.song.tracks.find((t) => t.playerId === p2)!.id;
    h.run(setTracksNotes([{ trackId: t3, notes: [note("g", [0, 1], [1, 4], 64)] }], "음"));
    h.amend({ ...h.song, players: h.song.players.map((p) => (p.id === p2 ? { ...p, tab: tab([64]) } : p)) });
    const r = retuneKeepingTab(h.song.tracks.filter((t) => t.playerId === p2), { strings: [64], capo: 0, maxFret: 24 }, { strings: [63], capo: 0, maxFret: 24 });
    h.run(retuneCommand(p2, tab([63]), r.changes, "튜닝"));
    h.run(removeTrack(t3));
    h.run(addPlayer("piano", "새 악보", "트랙 3"));
    expect(h.song.players[1]!.id).toBe(p2);
    h.undo();
    h.undo();
    h.undo();
    const back = h.song.players.find((p) => p.id === p2)!;
    expect(back.tab).toEqual(tab([64]));
    expect(h.song.tracks.find((t) => t.id === t3)!.notes[0]!.pitch).toBe(64);
    // 다시 실행도 음과 튜닝이 함께 간다
    h.redo();
    expect(h.song.players.find((p) => p.id === p2)!.tab).toEqual(tab([63]));
    expect(h.song.tracks.find((t) => t.id === t3)!.notes[0]!.pitch).toBe(63);
  });

  it("실험실 고스트 노트·하모닉스·풀기는 v·높이만 바꿔 검사를 지나고, 실행 취소 한 번에 돌아간다", () => {
    const s = song([note("a", [0, 1], [1, 4]), note("b", [1, 4], [1, 4], 64), note("c", [1, 2], [1, 4], 67)]);
    const h = guarded(s);
    const picked = [s.tracks[0]!.notes[1]!];
    for (const r of [planGhost(s, picked, { steps: 3 }, MOBILE_PROFILE), planHarmonic(s, picked, { type: "artificial", quieter: 1 }, MOBILE_PROFILE)]) {
      h.run(setTracksNotes(r.changes.map((c) => ({ trackId: c.trackId, notes: c.notes })), "실험실"));
      expect(h.refused).toBe(false);
      h.undo();
      expect(h.song).toBe(s);
    }
    const ghost = planGhost(s, picked, { steps: 3 }, MOBILE_PROFILE);
    h.run(setTracksNotes(ghost.changes.map((c) => ({ trackId: c.trackId, notes: c.notes })), "고스트"));
    const clear = planLabClear(h.song, [h.song.tracks[0]!.notes[1]!]);
    h.run(setTracksNotes(clear.changes.map((c) => ({ trackId: c.trackId, notes: c.notes })), "풀기"));
    expect(h.refused).toBe(false);
    expect(h.song.tracks[0]!.notes[1]).toEqual(s.tracks[0]!.notes[1]);
  });

  it("실험실 울림 찍기·넣기는 쓸 수 있는 조각만 만들어 검사를 지나고, 실행 취소 한 번에 돌아간다", () => {
    const s = song([note("a", [0, 1], [1, 1]), note("b", [1, 1], [1, 8], 64), note("c", [3, 2], [1, 8], 67)]);
    const h = guarded(s);
    let k = 0;
    const ctx = { canWrite: (d: ReturnType<typeof rat>) => canWriteExactly(d, limit), newId: () => `rv${++k}` };
    const tail = { levels: [6, 3, 2, 1], piece: rat(1, 8), keep: rat(1, 4) };
    const stamp = planReverbStamp(s, "t1", "a", rat(1, 2), tail, MOBILE_PROFILE, ctx);
    const batch = planReverbBatch(s, s.tracks[0]!.notes, { ...tail, minLength: rat(1, 2), beforeRest: false, fillLevel: 4, fillMaxNote: rat(1, 8) }, MOBILE_PROFILE, ctx);
    for (const r of [stamp, batch]) {
      expect(r.changes.length).toBe(1);
      h.run(setTracksNotes(r.changes.map((c) => ({ trackId: c.trackId, notes: c.notes })), "울림"));
      expect(h.refused).toBe(false);
      h.undo();
      expect(h.song).toBe(s);
    }
  });

  it("화음 감쇠는 v만 바꿔 검사를 지나고, 두 트랙이 실행 취소 한 번에 함께 돌아간다 (& 사슬은 첫 음 v로)", () => {
    const tied = { ...note("a", [0, 1], [1, 4]), tie: "next" as const };
    const s = song([tied, note("a2", [1, 4], [1, 4]), note("c", [1, 1], [1, 4])], [note("b", [1, 48], [1, 2], 64)]);
    const h = guarded(s);
    const r = attenuateChordVolumes(s.tracks, new Map(s.tracks.map((tr) => [tr.id, undefined])), attenuationOptions(CHORD_ATT_DEFAULTS), MOBILE_PROFILE);
    expect(r.changed).toBe(2);
    h.run(setTracksNotes([...r.tracks].map(([trackId, notes]) => ({ trackId, notes })), "화음 감쇠"));
    expect(h.refused).toBe(false);
    expect(h.song.tracks[0]!.notes.map((n) => n.vol)).toEqual([7, 7, 8]);
    expect(h.song.tracks[1]!.notes.map((n) => n.vol)).toEqual([7]);
    h.undo();
    expect(h.song).toBe(s);
  });
});
