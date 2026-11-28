import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, rat, staffBars, type Note, type Song, type Track } from "@mmlce/core";
import { staffRows } from "../src/lib/staffRows";

const VOL = { min: 0, max: 15 };
const note = (id: string, start: number, pitch: number): Note => ({ id, start: rat(start * 4, 4), dur: rat(1, 4), pitch, vol: 10, tie: "none" });
const track = (id: string, playerId: string, notes: Note[]): Track => ({ id, playerId, name: id, color: "#000", role: "melody", mute: false, solo: false, notes }) as unknown as Track;

function songWith(instrument: string, notes: Note[]): Song {
  const base = emptySong({ title: "", author: "" } as never);
  return { ...base, players: [{ id: "p", name: "악보", instrument: { canonical: instrument } }], tracks: [track("t", "p", notes)] } as Song;
}

/** 단마다 그릴 음 높이 (첫 성부, 쉼표 빼고) */
function writtenPitches(rows: ReturnType<typeof staffRows>): number[][] {
  return rows.map((r) => r.voices[0]!.measures.flatMap((m) => m.items.filter((i) => i.pitch !== undefined).map((i) => i.pitch!)));
}

describe("오선보 단의 옥타브 표시", () => {
  const notes = [note("a", 0, 40), note("b", 0.25, 52)];
  const bars = staffBars(songWith("piano", notes));

  it("기타: 한 옥타브 높여 8vb 높은음자리표에 (낮은 음이라도 낮은음자리표로 가지 않는다)", () => {
    const rows = staffRows(songWith("folk-guitar", notes), ["t"], bars, new Map(), VOL, MOBILE_PROFILE.soundingOctave);
    expect(rows.map((r) => [r.clef, r.octave])).toEqual([["treble", "8vb"]]);
    expect(writtenPitches(rows)).toEqual([[52, 64]]);
  });

  it("실로폰: MML 높이 그대로, 8va", () => {
    const rows = staffRows(songWith("xylophone", notes), ["t"], bars, new Map(), VOL, MOBILE_PROFILE.soundingOctave);
    expect(rows.map((r) => [r.clef, r.octave])).toEqual([["bass", "8va"]]);
    expect(writtenPitches(rows)).toEqual([[40, 52]]);
  });

  it("오르골: 큰보표 두 단 모두 8va", () => {
    const rows = staffRows(songWith("music-box", [note("a", 0, 72), note("b", 0.25, 48)]), ["t"], bars, new Map(), VOL, MOBILE_PROFILE.soundingOctave);
    expect(rows.map((r) => [r.clef, r.octave])).toEqual([
      ["treble", "8va"],
      ["bass", "8va"],
    ]);
  });

  it("다른 악기는 표시 없이 그대로", () => {
    const rows = staffRows(songWith("lute", notes), ["t"], bars, new Map(), VOL, MOBILE_PROFILE.soundingOctave);
    expect(rows.map((r) => r.octave)).toEqual([undefined]);
    expect(writtenPitches(rows)).toEqual([[40, 52]]);
  });
});
