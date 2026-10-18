import { describe, expect, it } from "vitest";
import { windowTitle } from "../src/lib/windowTitle";

describe("windowTitle: 창 제목", () => {
  it("곡이 없으면 앱 이름 그대로", () => {
    expect(windowTitle("", false, false)).toBe("BiNote 바이노트");
    expect(windowTitle("song.mme", false, true)).toBe("BiNote 바이노트");
  });
  it("이름 없는 곡은 new project", () => {
    expect(windowTitle("", true, false)).toBe("new project - BiNote");
  });
  it("파일 이름은 확장자까지", () => {
    expect(windowTitle("song.mme", true, false)).toBe("song.mme - BiNote");
  });
  it("저장 안 한 변경이 있으면 앞에 ●", () => {
    expect(windowTitle("song.mme", true, true)).toBe("● song.mme - BiNote");
    expect(windowTitle("", true, true)).toBe("● new project - BiNote");
  });
});
