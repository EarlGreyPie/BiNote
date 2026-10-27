import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, rat, type Note, type Player, type Track } from "@mmlce/core";
import { heldLossDb, noteEndFadeDb, previewPitch, trackSoundingRange } from "../src/lib/instrumentRange";

// 추가 사운드팩의 #42.3(mabi:1578)이 올린 팩에서 냥모니카로 알아봐지는 경우
const canonicalOf = (instrument: string) => (instrument === "mabi:1578" ? "cat-harmonica" : undefined);
const player = (canonical: string): Player => ({ id: "p1", name: "", instrument: { canonical } });
const track: Pick<Track, "playerId" | "instrument"> = { playerId: "p1" };

describe("trackSoundingRange", () => {
  it("번호로만 아는 악기는 알아본 실제 악기의 음역", () => {
    const song = { players: [player("mabi:1578")] };
    expect(trackSoundingRange(MOBILE_PROFILE, song, track, canonicalOf)).toEqual(MOBILE_PROFILE.instrumentRanges["cat-harmonica"]);
  });

  it("알아보지 못하거나 해석 함수가 없으면 전과 같다", () => {
    const song = { players: [player("mabi:1578")] };
    expect(trackSoundingRange(MOBILE_PROFILE, song, track, () => undefined)).toEqual(MOBILE_PROFILE.soundingRange);
    expect(trackSoundingRange(MOBILE_PROFILE, song, track)).toEqual(MOBILE_PROFILE.soundingRange);
  });

  it("이름을 아는 악기는 그 악기 음역 그대로", () => {
    const song = { players: [player("cat-harmonica")] };
    expect(trackSoundingRange(MOBILE_PROFILE, song, track, canonicalOf)).toEqual(MOBILE_PROFILE.instrumentRanges["cat-harmonica"]);
    const guitar = { players: [player("folk-guitar")] };
    expect(trackSoundingRange(MOBILE_PROFILE, guitar, track, canonicalOf)).toEqual(trackSoundingRange(MOBILE_PROFILE, guitar, track));
  });
});

describe("previewPitch", () => {
  it("냥모니카 음역으로 옥타브째 접는다 (재생과 같은 높이)", () => {
    expect(previewPitch(MOBILE_PROFILE, "cat-harmonica", 48)).toBe(72);
  });

  it("음역 안의 높이는 그대로", () => {
    expect(previewPitch(MOBILE_PROFILE, "folk-guitar", 48)).toBe(48);
    expect(previewPitch(MOBILE_PROFILE, "piano", 60)).toBe(60);
  });
});

describe("noteEndFadeDb (실험실 소리 줄어듦)", () => {
  // t60: 4분음 = 1초
  const song = { players: [player("folk-guitar")], tempo: [{ at: rat(0), bpm: 60 }] };
  const note = (id: string, start: number, beats: number, pitch: number, tie: Note["tie"] = "none"): Note => ({
    id,
    start: rat(start, 4),
    dur: rat(beats, 4),
    pitch,
    vol: 15,
    tie,
  });

  it("기타 o5f 1초는 o4e 1초보다 훨씬 작아져 끝난다", () => {
    const high = note("a", 0, 1, 77);
    const low = note("b", 0, 1, 64);
    const f = (n: Note) => noteEndFadeDb(MOBILE_PROFILE, song, { ...track, notes: [n] }, n)!;
    expect(f(high)).toBeLessThan(-19);
    expect(f(low)).toBeGreaterThan(-13);
  });

  it("&로 이어 받은 음은 새로 치지 않아 알 수 없다", () => {
    const a = note("a", 0, 1, 64, "next");
    const b = note("b", 1, 1, 64);
    expect(noteEndFadeDb(MOBILE_PROFILE, song, { ...track, notes: [a, b] }, b)).toBeUndefined();
  });

  it("긴 음 맞추기: 길수록 잃은 dB가 크고, 0.5초보다 짧으면 0", () => {
    const loss = (beats: number) => heldLossDb(MOBILE_PROFILE, song, track, [note("a", 0, beats, 64)]);
    expect(loss(4)).toBeGreaterThan(loss(2));
    expect(loss(2)).toBeGreaterThan(0);
    expect(heldLossDb(MOBILE_PROFILE, { ...song, tempo: [{ at: rat(0), bpm: 240 }] }, track, [note("a", 0, 1, 64)])).toBe(0);
    // &로 이은 사슬은 첫 음부터 끝 음까지 한 소리
    expect(heldLossDb(MOBILE_PROFILE, song, track, [note("a", 0, 2, 64, "next"), note("b", 2, 2, 64)])).toBeCloseTo(loss(4), 6);
  });

  it("샘플이 먼저 끝나면 소리 없음", () => {
    const n = note("a", 0, 6, 77);
    expect(noteEndFadeDb(MOBILE_PROFILE, song, { ...track, notes: [n] }, n)).toBe(-Infinity);
  });
});
