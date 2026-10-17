import { describe, expect, it } from "vitest";
import { assignTab, emptySong, rat, STANDARD_TUNING, type Note, type Song } from "@mmlce/core";
import { fretFromKeys, placeTabNote, removeTabNote, setTabNoteLength, tieTabNote } from "../src/lib/tabInput";

function song(): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  const track = (id: string) => ({ id, playerId: "p", name: id, color: "", role: "free" as const, mute: false, solo: false, notes: [] as Note[], spelling: {} });
  return { ...base, players: [{ id: "p", name: "", instrument: { canonical: "folk-guitar" } }], tracks: [track("a"), track("b")] };
}

describe("타브 입력", () => {
  it("빈 트랙부터 채워 같은 자리 화음은 트랙을 나눠 쓴다", () => {
    let s = song();
    const put = (pitch: number) => {
      const edit = placeTabNote(s, ["a", "b"], "a", rat(0), rat(1, 8), pitch);
      s = { ...s, tracks: s.tracks.map((t) => ({ ...t, notes: edit.changes.find((c) => c.trackId === t.id)?.notes ?? t.notes })) };
    };
    put(64);
    put(59);
    expect(s.tracks.map((t) => t.notes.map((n) => n.pitch))).toEqual([[64], [59]]);
  });

  it("같은 줄에 다시 치면 그 음 높이만 바꾸고, 지우면 빠진다", () => {
    const s0 = song();
    const first = placeTabNote(s0, ["a", "b"], "a", rat(0), rat(1, 8), 64);
    const s1 = { ...s0, tracks: s0.tracks.map((t) => (t.id === "a" ? { ...t, notes: first.changes[0]!.notes } : t)) };
    const note = s1.tracks[0]!.notes[0]!;
    const again = placeTabNote(s1, ["a", "b"], "a", rat(0), rat(1, 8), 65, note);
    expect(again.changes[0]!.notes.map((n) => [n.id, n.pitch])).toEqual([[note.id, 65]]);
    expect(removeTabNote(s1, note).changes[0]!.notes).toEqual([]);
  });

  it("빈 트랙이 없으면 덮어쓰지 않고 트랙을 더해 넣고, 한도면 넣지 않는다", () => {
    let s = song();
    const put = (pitch: number) => {
      const edit = placeTabNote(s, ["a", "b"], "a", rat(0), rat(1, 8), pitch, undefined, undefined, 3);
      s = { ...s, tracks: s.tracks.map((t) => ({ ...t, notes: edit.changes.find((c) => c.trackId === t.id)?.notes ?? t.notes })) };
      return edit;
    };
    put(64);
    put(59);
    const third = put(55);
    // 앞 두 음은 그대로 남는다 (예전에는 고른 트랙의 64가 지워졌다)
    expect(s.tracks.map((t) => t.notes.map((n) => n.pitch))).toEqual([[64], [59]]);
    expect(third.newTrack?.playerId).toBe("p");
    expect(third.newTrack?.notes.map((n) => n.pitch)).toEqual([55]);
    expect(third.noteId).toBe(third.newTrack?.notes[0]?.id);
    expect(third.newTrack?.instrument).toBeUndefined();
    // 고른 트랙에 악기를 따로 정했으면 새 트랙도 그 악기 (악보 기본 악기로 바뀌지 않게)
    const guitar = { canonical: "guitar" };
    const own = { ...s, tracks: s.tracks.map((t) => (t.id === "a" ? { ...t, instrument: guitar } : t)) };
    expect(placeTabNote(own, ["a", "b"], "a", rat(0), rat(1, 8), 55, undefined, undefined, 3).newTrack?.instrument).toEqual(guitar);
    // 트랙이 이미 한도(2)면 넣지 않는다
    const full = placeTabNote(s, ["a", "b"], "a", rat(0), rat(1, 8), 55, undefined, undefined, 2);
    expect(full).toEqual({ changes: [], noteId: undefined, full: true });
  });

  it("음 길이를 바꾸되 뒤 음 앞까지만 늘린다", () => {
    const n = (id: string, start: number, dur: number, pitch = 64): Note => ({ id, start: rat(start, 16), dur: rat(dur, 16), pitch, vol: 8, tie: "none" });
    const base = song();
    const s = { ...base, tracks: base.tracks.map((t) => (t.id === "a" ? { ...t, notes: [n("x", 0, 1), n("y", 8, 2)] } : t)) };
    const x = s.tracks[0]!.notes[0]!;
    const len = (d: { changes: { notes: Note[] }[] }) => d.changes[0]!.notes.map((m) => [m.id, m.dur.n, m.dur.d]);
    // 4분음표로: 다음 음(8/16)까지 자리가 있어 그대로
    expect(len(setTabNoteLength(s, x, rat(1, 4)))).toEqual([["x", 1, 4], ["y", 1, 8]]);
    // 온음표로: 다음 음 앞(반음표)까지만 늘리고 다음 음은 남는다
    expect(len(setTabNoteLength(s, x, rat(1)))).toEqual([["x", 1, 2], ["y", 1, 8]]);
  });

  it("& 잇기: 뒤가 비면 같은 음을 새 음 길이만큼 더해 잇고, 붙어 있으면 그 음과 잇는다", () => {
    const n = (id: string, start: number, dur: number, pitch = 64): Note => ({ id, start: rat(start, 16), dur: rat(dur, 16), pitch, vol: 8, tie: "none" });
    const base = song();
    const withNotes = (notes: Note[]) => ({ ...base, tracks: base.tracks.map((t) => (t.id === "a" ? { ...t, notes } : t)) });
    // 뒤가 비었다: 64를 8분음표 더해 잇는다
    const s1 = withNotes([n("x", 0, 2)]);
    const e1 = tieTabNote(s1, s1.tracks[0]!.notes[0]!, rat(1, 8));
    const out1 = e1.changes[0]!.notes;
    expect(out1.map((m) => [m.pitch, m.start.n, m.start.d, m.dur.n, m.dur.d, m.tie])).toEqual([
      [64, 0, 1, 1, 8, "next"],
      [64, 1, 8, 1, 8, "none"],
    ]);
    expect(e1.noteId).toBe(out1[1]!.id);
    // 빈자리(1/16)보다 길면 다음 음 앞까지만
    const s2 = withNotes([n("x", 0, 2), n("y", 3, 1, 67)]);
    const out2 = tieTabNote(s2, s2.tracks[0]!.notes[0]!, rat(1, 4)).changes[0]!.notes;
    expect(out2.map((m) => [m.pitch, m.dur.n, m.dur.d])).toEqual([[64, 1, 8], [64, 1, 16], [67, 1, 16]]);
    // 바로 붙은 다른 음이면 슬라이드로 잇고, 다시 누르면 푼다
    const s3 = withNotes([n("x", 0, 2), n("y", 2, 2, 67)]);
    const tied = tieTabNote(s3, s3.tracks[0]!.notes[0]!, rat(1, 8));
    expect(tied.changes[0]!.notes.map((m) => m.tie)).toEqual(["next", "none"]);
    expect(tied.noteId).toBeUndefined();
    const s4 = withNotes(tied.changes[0]!.notes);
    expect(tieTabNote(s4, s4.tracks[0]!.notes[0]!, rat(1, 8)).changes[0]!.notes.map((m) => m.tie)).toEqual(["none", "none"]);
  });

  it("숫자 두 개를 이어 치면 두 자리 프렛", () => {
    expect(fretFromKeys("", "1", 20)).toEqual({ fret: 1, buffer: "1" });
    expect(fretFromKeys("1", "2", 20)).toEqual({ fret: 12, buffer: "" });
    expect(fretFromKeys("", "5", 20)).toEqual({ fret: 5, buffer: "" });
    expect(fretFromKeys("2", "5", 20)).toEqual({ fret: 5, buffer: "" });
  });

  it("타브에서 고른 줄을 자동 배정이 지킨다", () => {
    // E4(64)는 보통 1번 줄 개방현이지만, 2번 줄 5프렛으로 골랐으면 그대로
    const n: Note = { id: "x", start: rat(0), dur: rat(1, 4), pitch: 64, vol: 8, tie: "none" };
    expect(assignTab([n], STANDARD_TUNING)[0]!.notes[0]!.at).toEqual({ string: 1, fret: 0 });
    expect(assignTab([n], STANDARD_TUNING, new Map([["x", 2]]))[0]!.notes[0]!.at).toEqual({ string: 2, fret: 5 });
  });
});
