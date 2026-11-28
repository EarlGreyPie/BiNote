import { describe, expect, it } from "vitest";
import { add, emptySong, History, nearestTick, PC_PROFILE, rat, settleToTicks, snapSongToTicks, songProfile, type Note, type Player, type Rat, type Song, type Track } from "@mmlce/core";
import { findOffgrid, gameScores, parseMml, parseTrackText, sameSound, setSongProfile, setTrackNotes, songProfileChange } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };
const tick = (n: number): Rat => rat(n, 384);

function note(id: string, start: Rat, dur: Rat, pitch = 60): Note {
  return { id, start, dur, pitch, vol: 8, tie: "none" };
}

function track(id: string, notes: Note[], text?: string): Track {
  return { id, playerId: "p1", name: id, color: "#000", role: "free", mute: false, solo: false, notes, spelling: {}, ...(text ? { mml: { text } } : {}) };
}

function song(tracks: Track[], profileId = "pc"): Song {
  return { ...emptySong({ title: "", author: "", profileId }), players: [piano], tracks, tempo: [{ at: rat(0), bpm: 120 }] };
}

/** 4분 5잇단을 정확한 분수로 (1/20씩) */
const quintuplet = (from: Rat = rat(0)) => Array.from({ length: 5 }, (_, k) => note(`q${k}`, add(from, rat(k, 20)), rat(1, 20), 60 + k));

const ticksOf = (notes: readonly Note[]) => notes.map((n) => [n.start.n * (384 / n.start.d), n.dur.n * (384 / n.dur.d)]);

describe("PC 프로필", () => {
  it("길이 셈만 다르고(384틱 내림), 재지 않은 값은 실측 전으로 적혀 있다", () => {
    expect(PC_PROFILE.length.ticks).toEqual({ perWhole: 384, rounding: "floor" });
    expect(PC_PROFILE.pending.map((p) => p.key)).toEqual(expect.arrayContaining(["lengthTicks", "borrowedMeasurements"]));
    expect(songProfile(song([]))).toBe(PC_PROFILE);
  });
});

describe("틱에 맞추기", () => {
  it("자리를 반올림한다: 4분 5잇단 = 19·19·20·19·19틱, 묶음은 박에서 끝난다", () => {
    const { song: out, report } = snapSongToTicks(song([track("a", quintuplet())]));
    expect(ticksOf(out.tracks[0]!.notes)).toEqual([
      [0, 19],
      [19, 19],
      [38, 20],
      [58, 19],
      [77, 19],
    ]);
    expect(report.moved).toBe(5);
    expect(report.short).toBe(0);
    expect(nearestTick(rat(1, 768), 384)).toEqual(tick(1));
  });

  it("7·9잇단도 묶음 합이 박이다", () => {
    for (const n of [7, 9]) {
      const notes = Array.from({ length: n }, (_, k) => note(`n${k}`, rat(k, 4 * n), rat(1, 4 * n)));
      const out = snapSongToTicks(song([track("a", notes)])).song.tracks[0]!.notes;
      const last = out.at(-1)!;
      expect(add(last.start, last.dur)).toEqual(rat(1, 4));
    }
  });

  it("반 틱보다 짧은 음 바로 뒤에 음이 오면, 한 틱으로 늘린 만큼 뒤 음을 밀어 겹치지 않게 한다 (음은 빼지 않는다)", () => {
    const notes = [note("a", rat(0), rat(1, 1000)), note("b", rat(1, 1000), rat(1, 1000)), note("c", rat(2, 1000), rat(1, 4))];
    const out = snapSongToTicks(song([track("a", notes)])).song.tracks[0]!.notes;
    expect(out).toHaveLength(3);
    expect(ticksOf(out)).toEqual([
      [0, 1],
      [1, 1],
      [2, 95],
    ]);
    for (let k = 1; k < out.length; k++) expect(add(out[k - 1]!.start, out[k - 1]!.dur).n * (384 / add(out[k - 1]!.start, out[k - 1]!.dur).d)).toBeLessThanOrEqual(out[k]!.start.n * (384 / out[k]!.start.d));
    // 게임 바꾸기로 PC가 되어도 같다
    const changed = songProfileChange(song([track("a", notes)], "mobile"), "pc").song.tracks[0]!.notes;
    expect(ticksOf(changed)).toEqual(ticksOf(out));
  });

  it("처음부터 겹친 음(같은 자리 화음)은 밀지 않는다", () => {
    const notes = [note("a", rat(0), rat(1, 1000)), note("b", rat(0), rat(1, 4), 64)];
    const out = snapSongToTicks(song([track("a", notes)])).song.tracks[0]!.notes;
    expect(ticksOf(out)).toEqual([
      [0, 1],
      [0, 96],
    ]);
  });

  it("틱 칸을 쓰지 않는 곡(모바일)은 그대로", () => {
    const s = song([track("a", quintuplet())], "mobile");
    expect(snapSongToTicks(s).song).toBe(s);
    expect(settleToTicks(s, { ...s, tracks: [track("a", quintuplet(rat(1)))] }).tracks[0]!.notes[1]!.start).toEqual(add(rat(1), rat(1, 20)));
  });

  it("편집이 바꾼 트랙만 맞추고 원문은 지운다", () => {
    const before = song([track("a", []), track("b", [note("x", rat(1, 3), rat(1, 3))], "r3c3")]);
    const after = { ...before, tracks: [track("a", quintuplet()), before.tracks[1]!] };
    const out = settleToTicks(before, after);
    expect(ticksOf(out.tracks[0]!.notes)[2]).toEqual([38, 20]);
    expect(out.tracks[1]).toBe(before.tracks[1]);
  });
});

describe("실행 취소 기록이 틱 칸으로 맞춘다 (History settle)", () => {
  it("음을 넣으면 칸에 맞추고, 실행 취소·다시 실행도 같다", () => {
    const start = song([track("a", [])]);
    const h = new History(start, undefined, settleToTicks);
    const done = h.run(setTrackNotes("a", quintuplet()));
    expect(ticksOf(done.tracks[0]!.notes).map(([, d]) => d)).toEqual([19, 19, 20, 19, 19]);
    expect(h.undo()).toEqual(start);
    const again = h.redo();
    expect(ticksOf(again.tracks[0]!.notes).map(([, d]) => d)).toEqual([19, 19, 20, 19, 19]);
  });

  it("모바일 곡은 맞추지 않는다 (정확한 분수 그대로)", () => {
    const h = new History(song([track("a", [])], "mobile"), undefined, settleToTicks);
    expect(h.run(setTrackNotes("a", quintuplet())).tracks[0]!.notes[1]!.dur).toEqual(rat(1, 20));
  });
});

describe("게임 바꾸기", () => {
  it("모바일 → PC: 셈이 달라지는 원문은 지우고 음을 칸에 맞춘다. 셈이 같은 원문은 둔다", () => {
    const fiveText = "l20ccccc";
    const five = track("a", parseTrackText("a", { text: fiveText }).notes, fiveText);
    const plain = track("b", parseTrackText("b", { text: "l4cdef" }).notes, "l4cdef");
    const s = song([five, plain], "mobile");
    const r = songProfileChange(s, "pc");
    expect(r.song.meta.profileId).toBe("pc");
    expect(r.rewritten).toEqual(["a"]);
    expect(ticksOf(r.song.tracks[0]!.notes).map(([, d]) => d)).toEqual([19, 19, 20, 19, 19]);
    expect(r.song.tracks[1]!.mml?.text).toBe("l4cdef");
    // 게임에 넣을 글은 틱 셈으로 다시 읽어 곡과 같다
    const text = gameScores(r.song, 6)[0]!.texts[0]!.text;
    expect(text).toMatch(/19/);
    expect(sameSound(parseMml(text, { lengths: PC_PROFILE.length }).notes, r.song.tracks[0]!.notes)).toBe(true);
  });

  it("명령은 실행 취소 한 칸이고, 같은 게임이면 곡을 그대로 둔다", () => {
    const s = song([track("a", quintuplet())], "mobile");
    const h = new History(s, undefined, settleToTicks);
    h.run(setSongProfile("pc"));
    expect(h.song.meta.profileId).toBe("pc");
    expect(h.undo()).toBe(s);
    expect(songProfileChange(s, "mobile").song).toBe(s);
    expect(songProfileChange(s, "nope").song).toBe(s);
  });

  it("PC ↔ 노래 파트 제외는 셈이 같아 원문과 음을 그대로 둔다", () => {
    const text = "l20ccc19cc";
    const s = song([track("a", parseTrackText("a", { text }, PC_PROFILE.length).notes, text)]);
    const r = songProfileChange(s, "pc-nosong");
    expect(r.song.meta.profileId).toBe("pc-nosong");
    expect(r.rewritten).toEqual([]);
    expect(r.snap.moved).toBe(0);
    expect(r.song.tracks[0]).toBe(s.tracks[0]);
  });

  it("칸보다 짧아지는 음은 세어 알린다 (l64보다 짧은 1/128 음 = 3틱)", () => {
    const s = song([track("a", [note("x", rat(0), rat(1, 128))])], "mobile");
    expect(songProfileChange(s, "pc").snap.short).toBe(1);
  });

  it("PC 곡에서는 어긋난 길이 찾기를 하지 않는다 (잇단음을 일부러 틱으로 나눈 글)", () => {
    const text = "l20ccc19cc";
    const s = song([track("a", parseTrackText("a", { text }, PC_PROFILE.length).notes, text)]);
    expect(findOffgrid(s)).toEqual([]);
  });
});

describe("게임 바꾸기: 원문 끝 쉼표", () => {
  it("원문을 다시 쓰는 트랙도 끝 쉼표로 지키던 악보 길이를 틱에 맞춰 남긴다", () => {
    // 게임은 맨 끝 명령인 쉼표만 길이에서 빼므로(c5r1 = c5) 뒤에 t를 둔 쉼표가 악보 길이를 지킨다
    const text = "c5r1t120";
    const s = song([track("a", parseTrackText("a", { text }).notes, text)], "mobile");
    const r = songProfileChange(s, "pc");
    expect(r.rewritten).toEqual(["a"]);
    const out = gameScores(r.song, 6)[0]!.texts[0]!.text;
    const end = parseMml(out, { lengths: PC_PROFILE.length }).end;
    expect(end).toEqual(nearestTick(rat(6, 5), 384));
  });

  it("셈이 같아 둔 원문이 틱에 맞추면서 지워져도(칸 밖 시작 자리) 끝 쉼표로 지키던 길이를 남긴다", () => {
    const text = "c4r1t120";
    const mml = { text, offset: rat(1, 5) };
    const s = song([track("a", parseTrackText("a", mml).notes)], "mobile");
    const withText: Song = { ...s, tracks: [{ ...s.tracks[0]!, mml }] };
    const r = songProfileChange(withText, "pc");
    expect(r.rewritten).toEqual([]);
    const out = gameScores(r.song, 6)[0]!.texts[0]!.text;
    const end = parseMml(out, { lengths: PC_PROFILE.length }).end;
    expect(end).toEqual(rat(557, 384));
  });
});
