import { describe, expect, it } from "vitest";
import { assignTab, emptySong, rat, STANDARD_TUNING, type Note, type Song } from "@mmlce/core";
import { fretFromKeys, placeTabNote, removeTabNote } from "../src/lib/tabInput";

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
