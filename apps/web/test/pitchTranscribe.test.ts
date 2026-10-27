import { describe, expect, it } from "vitest";
import { checkPitchInput, decodeForPitch, PITCH_MAX_BYTES, PITCH_MAX_SECONDS, PitchTooLong } from "../src/lib/pitchTranscribe";

describe("브라우저 안 받아 적기 한도", () => {
  it("크기·길이가 한도 안이면 통과한다", () => {
    expect(() => checkPitchInput(5_000_000)).not.toThrow();
    expect(() => checkPitchInput(5_000_000, PITCH_MAX_SECONDS)).not.toThrow();
  });

  it("너무 큰 파일은 풀기 전에, 너무 긴 음원은 풀고 나서 거절한다", () => {
    expect(() => checkPitchInput(PITCH_MAX_BYTES + 1)).toThrow(PitchTooLong);
    expect(() => checkPitchInput(1000, PITCH_MAX_SECONDS + 1)).toThrow(PitchTooLong);
    expect(() => checkPitchInput(1000, Number.NaN)).toThrow(PitchTooLong);
    expect(new PitchTooLong().maxMinutes).toBe(10);
  });

  it("머리 정보로 길이를 알면 풀기 전에 거절한다 (크기는 작아도 몇 시간짜리 압축 음원)", async () => {
    let read = false;
    const file = new Blob(["x"]);
    file.arrayBuffer = async () => {
      read = true;
      return new ArrayBuffer(0);
    };
    await expect(decodeForPitch(file, async () => 3 * 60 * 60)).rejects.toBeInstanceOf(PitchTooLong);
    expect(read).toBe(false);
  });
});

