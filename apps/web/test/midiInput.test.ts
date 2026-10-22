import { describe, expect, it } from "vitest";
import { cmp, emptySong, MOBILE_PROFILE, rat, type Note, type Song } from "@mmlce/core";
import { setTracksNotesAddingTracks } from "@mmlce/mml";
import { ChordCollector, notesEnd, placeChord, previousVolume, volumeForVelocity } from "../src/lib/midiInput";
import { scoreGroups } from "../src/lib/scores";

function song(n: number): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  return {
    ...base,
    players: [{ id: "p1", name: "", instrument: { canonical: "piano" } }],
    tracks: Array.from({ length: n }, (_, k) => ({ id: `t${k}`, playerId: "p1", name: "", color: "", role: "free" as const, mute: false, solo: false, notes: [], spelling: {} })),
  };
}

describe("MIDI 건반 입력", () => {
  it("세기 → v: 127은 15, 재생 곡선의 역방향", () => {
    expect(volumeForVelocity(MOBILE_PROFILE, 127)).toBe(15);
    expect(volumeForVelocity(MOBILE_PROFILE, Math.round((127 * 8) / 15))).toBe(8);
  });

  const vol = (n: readonly Note[], at: ReturnType<typeof rat>) => previousVolume(n, at);

  it("화음은 높은 음부터 고른 트랙과 같은 악보 다음 트랙에 하나씩, 한도에 걸리면 버린 수를 알린다", () => {
    const s = song(3);
    const g = scoreGroups(s, 3);
    const out = placeChord(s, g, "t1", rat(0), rat(1, 4), { pitches: [60, 67, 64, 72], velocity: 100 }, vol, 3);
    expect(out.changes.map((c) => [c.trackId, c.notes[0]!.pitch])).toEqual([["t1", 72], ["t2", 67]]);
    expect(out.newTracks).toHaveLength(0);
    expect(out.dropped).toBe(2);
  });

  it("트랙 하나인 악보: 모자란 트랙을 한도까지 더해 화음을 다 넣는다 (예전에는 가장 높은 음만 들어갔다)", () => {
    const s = song(1);
    const out = placeChord(s, scoreGroups(s, 3), "t0", rat(0), rat(1, 4), { pitches: [60, 64, 67], velocity: 100 }, vol, 3);
    expect(out.changes.map((c) => [c.trackId, c.notes[0]!.pitch])).toEqual([["t0", 67]]);
    expect(out.newTracks.map((n) => n.map((x) => x.pitch))).toEqual([[64], [60]]);
    expect(out.dropped).toBe(0);
    const next = setTracksNotesAddingTracks("p1", out.changes, out.newTracks, (n) => `트랙 ${n}`, "건반 입력").apply(s);
    expect(next.tracks.map((t) => t.notes.map((n) => n.pitch))).toEqual([[67], [64], [60]]);
    expect(next.tracks.every((t) => t.playerId === "p1")).toBe(true);
  });

  it("잠긴 트랙은 건너뛰고 다음 트랙에 넣는다", () => {
    const s = song(3);
    const out = placeChord(s, scoreGroups(s, 6), "t0", rat(0), rat(1, 4), { pitches: [60, 64], velocity: 100 }, vol, 6, new Set(["t1"]));
    expect(out.changes.map((c) => [c.trackId, c.notes[0]!.pitch])).toEqual([["t0", 64], ["t2", 60]]);
  });

  it("뒤 악보가 있는 연주자의 앞 악보에는 트랙을 더하지 않는다 (더하면 뒤 악보로 넘어가서)", () => {
    const s = song(4);
    const g = scoreGroups(s, 3);
    const out = placeChord(s, g, "t2", rat(0), rat(1, 4), { pitches: [60, 64], velocity: 100 }, vol, 3);
    expect(out.changes.map((c) => c.trackId)).toEqual(["t2"]);
    expect(out.newTracks).toHaveLength(0);
    expect(out.dropped).toBe(1);
    // 마지막 악보(트랙 하나)에는 더한다
    const last = placeChord(s, g, "t3", rat(0), rat(1, 4), { pitches: [60, 64], velocity: 100 }, vol, 3);
    expect(last.newTracks).toHaveLength(1);
  });

  it("새 트랙 음의 기본 v는 고른 트랙 앞 음 v", () => {
    const base = song(1);
    const s: Song = { ...base, tracks: [{ ...base.tracks[0]!, notes: [{ id: "a", start: rat(0), dur: rat(1, 4), pitch: 60, vol: 11, tie: "none" }] }] };
    const out = placeChord(s, scoreGroups(s, 3), "t0", rat(1, 4), rat(1, 4), { pitches: [60, 64], velocity: 100 }, vol, 3);
    expect(out.newTracks[0]![0]!.vol).toBe(11);
  });
});

describe("함께 누른 건반 모으기", () => {
  it("조금씩 어긋나게 눌러도 다 누른 채 하나를 떼면 화음 하나", () => {
    const c = new ChordCollector();
    c.down(60, 80);
    c.down(64, 100);
    c.down(67, 90);
    expect(c.up(64)).toEqual({ pitches: [60, 64, 67], velocity: 100 });
    // 나머지를 떼도 다시 넣지 않는다
    expect(c.up(60)).toBeUndefined();
    expect(c.up(67)).toBeUndefined();
  });

  it("떼고 누르는 단음은 하나씩", () => {
    const c = new ChordCollector();
    c.down(60, 100);
    expect(c.up(60)?.pitches).toEqual([60]);
    c.down(62, 100);
    expect(c.up(62)?.pitches).toEqual([62]);
  });

  it("화음을 넣은 뒤 남은 건반을 누른 채 새 건반을 누르면 새 화음", () => {
    const c = new ChordCollector();
    c.down(60, 100);
    c.down(64, 100);
    expect(c.up(64)?.pitches).toEqual([60, 64]);
    c.down(67, 100);
    expect(c.up(60)).toBeUndefined();
    expect(c.up(67)?.pitches).toEqual([67]);
  });

  it("take는 모으던 화음을 꺼내고 비운다", () => {
    const c = new ChordCollector();
    c.down(60, 100);
    c.down(60, 100);
    expect(c.take()?.pitches).toEqual([60]);
    expect(c.take()).toBeUndefined();
  });
});

describe("커서 없이 넣는 자리: 마지막 음 뒤", () => {
  const note = (id: string, start: [number, number], dur: [number, number]): Note => ({ id, start: rat(...start), dur: rat(...dur), pitch: 60, vol: 8, tie: "none" });

  it("음이 없으면 0", () => {
    expect(cmp(notesEnd([]), rat(0))).toBe(0);
  });

  it("1/7 음 하나의 끝은 정확히 1/7 (137/960로 반올림하지 않는다)", () => {
    const end = notesEnd([note("a", [0, 1], [1, 7])]);
    expect(cmp(end, rat(1, 7))).toBe(0);
    expect(cmp(end, rat(137, 960))).not.toBe(0);
  });

  it("겹치거나 순서가 뒤섞인 음들 가운데 가장 늦은 끝", () => {
    const notes = [note("a", [1, 1], [1, 7]), note("b", [0, 1], [3, 2]), note("c", [1, 2], [1, 4])];
    expect(cmp(notesEnd(notes), rat(3, 2))).toBe(0);
    expect(cmp(notesEnd([note("a", [1, 1], [1, 3]), note("b", [1, 1], [1, 7])]), rat(4, 3))).toBe(0);
  });

  it("1/7 음 뒤에 화음을 넣어도 앞 음 길이는 1/7 그대로", () => {
    const base = song(1);
    const s: Song = { ...base, tracks: [{ ...base.tracks[0]!, notes: [note("a", [0, 1], [1, 7])] }] };
    const at = notesEnd(s.tracks[0]!.notes);
    const out = placeChord(s, scoreGroups(s, 6), "t0", at, rat(1, 8), { pitches: [64], velocity: 100 }, (n, w) => previousVolume(n, w));
    const notes = out.changes[0]!.notes;
    expect(notes).toHaveLength(2);
    expect(cmp(notes[0]!.dur, rat(1, 7))).toBe(0);
    expect(cmp(notes[1]!.start, rat(1, 7))).toBe(0);
  });
});

describe("MIDI 스텝 입력 숫자 키", () => {
  it("1~6은 온음표~32분, 7·8은 셋잇단, 0은 쉼표, 숫자판도 같게", async () => {
    const { midiStepLength } = await import("../src/lib/midiInput");
    expect(["1", "2", "3", "4", "5", "6", "7", "8"].map(midiStepLength)).toEqual(["1", "2", "4", "8", "16", "32", "12", "24"]);
    expect(midiStepLength("0")).toBe("rest");
    expect(midiStepLength("Num3")).toBe("4");
    expect(midiStepLength("9")).toBeUndefined();
    expect(midiStepLength("Ctrl+1")).toBeUndefined();
    expect(midiStepLength("A")).toBeUndefined();
  });
});
