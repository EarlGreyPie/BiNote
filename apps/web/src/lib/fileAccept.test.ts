import { describe, expect, it } from "vitest";
import { hasExtension, openPickerTypes } from "./fileAccept";

describe("openPickerTypes", () => {
  it("PC처럼 거르는 기기에서는 확장자 목록으로 거른다", () => {
    expect(openPickerTypes("BiNote", [".mme", ".mid"], false)).toEqual([
      { description: "BiNote", accept: { "application/octet-stream": [".mme", ".mid"] } },
    ]);
  });

  it("안드로이드·iPad처럼 거르지 않는 기기에서는 형식을 넘기지 않는다(.mid가 회색으로 막히지 않게)", () => {
    expect(openPickerTypes("BiNote", [".mme", ".mid"], true)).toBeUndefined();
  });
});

describe("hasExtension", () => {
  it("대소문자 없이 확장자를 본다", () => {
    expect(hasExtension("SONG.MID", ".mid,.midi")).toBe(true);
    expect(hasExtension("song.mp3", ".mid,.midi")).toBe(false);
  });
});
