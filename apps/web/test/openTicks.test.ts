import { describe, expect, it } from "vitest";
import { add, emptySong, PC_PROFILE, rat, type Note, type Song } from "@mmlce/core";
import { gameScores, parseMml, parseTrackText } from "@mmlce/mml";
import { songOnTicks } from "@mmlce/mml";

const note = (k: number): Note => ({ id: `q${k}`, start: rat(k, 20), dur: rat(1, 20), pitch: 60 + k, vol: 8, tie: "none" });

function song(profileId: string): Song {
  return {
    ...emptySong({ title: "", author: "", profileId }),
    players: [{ id: "p1", name: "피아노", instrument: { canonical: "piano" } }],
    tracks: [{ id: "t1", playerId: "p1", name: "t1", color: "#000", role: "free", mute: false, solo: false, notes: Array.from({ length: 5 }, (_, k) => note(k)), spelling: {} }],
    tempo: [{ at: rat(0), bpm: 120 }],
  };
}

describe("곡을 열 때 틱 칸에 맞추기", () => {
  it("PC 곡의 정확한 분수 잇단음(가져온 MIDI 등)은 열 때 틱 칸에 맞춰, 내보낸 글도 박에서 끝난다", () => {
    const out = songOnTicks(song("pc"));
    expect(out.tracks[0]!.notes.map((n) => n.dur.n * (384 / n.dur.d))).toEqual([19, 19, 20, 19, 19]);
    const last = out.tracks[0]!.notes.at(-1)!;
    expect(add(last.start, last.dur)).toEqual(rat(1, 4));
    const text = gameScores(out, 6)[0]!.texts[0]!.text;
    expect(parseMml(text, { lengths: PC_PROFILE.length }).end).toEqual(rat(1, 4));
  });

  it("원문이 칸 밖 자리라 지워져도 끝 쉼표로 지키던 악보 길이를 남긴다", () => {
    const mml = { text: "c4r1t120", offset: rat(1, 5) };
    const base = song("pc");
    const s: Song = { ...base, tracks: [{ ...base.tracks[0]!, notes: parseTrackText("t1", mml, PC_PROFILE.length).notes, mml }] };
    const out = songOnTicks(s);
    const text = gameScores(out, 6)[0]!.texts[0]!.text;
    expect(parseMml(text, { lengths: PC_PROFILE.length }).end).toEqual(rat(557, 384));
  });

  it("모바일 곡은 그대로", () => {
    const s = song("mobile");
    expect(songOnTicks(s)).toBe(s);
  });
});
