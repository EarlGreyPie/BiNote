import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, type Player, type Track } from "@mmlce/core";
import { previewPitch, trackSoundingRange } from "../src/lib/instrumentRange";

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
