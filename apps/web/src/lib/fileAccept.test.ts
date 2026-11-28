import { describe, expect, it } from "vitest";
import { IOS_ANY_FILE, fileAccept, hasExtension, openPickerTypes } from "./fileAccept";

describe("fileAccept", () => {
  it("PC에서는 확장자 목록으로 거른다", () => {
    expect(fileAccept(".mme,.mid", "other")).toBe(".mme,.mid");
  });

  it("iPad·아이폰에서는 모든 데이터 파일로 받아 사진·카메라 항목이 나오지 않게 한다", () => {
    const accept = fileAccept(".mme,.mml,.mid", "ios");
    expect(accept).toBe(IOS_ANY_FILE);
    expect(accept).not.toMatch(/image|video|audio/);
  });

  it("안드로이드에서는 거르지 않는다(.mid가 회색으로 막히지 않게)", () => {
    expect(fileAccept(".mme,.mid", "android")).toBeUndefined();
  });
});

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
