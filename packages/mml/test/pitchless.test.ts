import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, type Player, type Song, type Track } from "@mmlce/core";
import { gamePaste, gameScores, parseMml, parseTrackText, pitchlessForOutput, splitSong } from "../src/index.js";

/** 높이와 상관없는 타악기(큰북·심벌즈)는 게임에 넣을 글에서 한 높이(o4c)로 쓴다 */
const drum: Player = { id: "d", name: "큰북", instrument: { canonical: "bass-drum" } };
const cymbal: Player = { id: "c", name: "심벌즈", instrument: { canonical: "cymbal" } };
const piano: Player = { id: "p", name: "피아노", instrument: { canonical: "piano" } };

function track(id: string, playerId: string, text: string): Track {
  return { id, playerId, name: id, color: "#000", role: "free", mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {} };
}

function song(): Song {
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    players: [drum, cymbal, piano],
    tracks: [track("dr", "d", "o2c8c+8>d+8<f+8 o5g4&a4 o3b-8"), track("cy", "c", "o5c+8d8"), track("pn", "p", "o5c+8d8")],
  };
}

describe("타악기 한 높이 출력", () => {
  it("큰북 트랙 글은 옥타브 명령과 #·♭ 없이 o4c만 쓰고, 시작·길이는 그대로", () => {
    const s = song();
    const score = gameScores(s, 6).find((x) => x.trackIds.includes("dr"))!;
    const text = score.texts.find((x) => x.trackId === "dr")!.text;
    expect(text).not.toMatch(/[o<>+\-#]/);
    const notes = parseMml(text).notes;
    expect(notes.every((n) => n.pitch === MOBILE_PROFILE.percussionPitch)).toBe(true);
    // c8 c+8 d+8 f+8 g4&a4 b-8 → 여섯 번 친다 (g4&a4는 이어져 한 음 c2): l8ccccc2c
    expect(text).toBe("l8ccccc2c");
  });

  it("편집 중인 곡과 다른 악기(피아노)는 그대로, 심벌즈도 한 높이", () => {
    const s = song();
    const before = s.tracks.map((t) => t.notes.map((n) => n.pitch));
    const out = pitchlessForOutput(s, MOBILE_PROFILE);
    expect(s.tracks.map((t) => t.notes.map((n) => n.pitch))).toEqual(before);
    expect(out.tracks[1]!.notes.map((n) => n.pitch)).toEqual([60, 60]);
    expect(out.tracks[2]).toBe(s.tracks[2]);
    // 같은 트랙은 같은 바꾼 트랙 (게임 글 캐시)
    expect(pitchlessForOutput(s, MOBILE_PROFILE).tracks[0]).toBe(out.tracks[0]);
    const cy = gameScores(s, 6).find((x) => x.trackIds.includes("cy"))!.texts.find((x) => x.trackId === "cy")!.text;
    expect(cy).toBe("l8cc");
    const pn = gameScores(s, 6).find((x) => x.trackIds.includes("pn"))!.texts.find((x) => x.trackId === "pn")!.text;
    expect(parseMml(pn).notes.map((n) => n.pitch)).toEqual([73, 74]);
  });

  it("고른 트랙 붙여넣기와 악보책 나누기도 같은 글", () => {
    const s = song();
    const paste = gamePaste(s, ["dr"], 6, 6, { tempo: true });
    expect(paste.texts[0]!.text).not.toMatch(/[o<>+\-]/);
    const split = splitSong(s, MOBILE_PROFILE);
    expect(split.parts[0]!.texts.find((x) => x.trackId === "dr")!.text).not.toMatch(/[o<>+\-]/);
  });

  it("목록이 비면 곡을 그대로 돌려준다", () => {
    const s = song();
    expect(pitchlessForOutput(s, { ...MOBILE_PROFILE, pitchlessInstruments: [] })).toBe(s);
  });
});
