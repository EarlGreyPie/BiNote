import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_INSTALLED_NAME, APP_TITLE, hasNoTitleBar, songLabel, windowTitle } from "../src/lib/windowTitle";

describe("창 제목", () => {
  it("곡이 없으면 앱 이름만", () => {
    expect(windowTitle("", false, false)).toBe(APP_TITLE);
    expect(windowTitle("", false, false, true)).toBe(APP_TITLE);
  });
  it("브라우저 탭은 파일 이름을 앞에", () => {
    expect(windowTitle("곡.mme", true, false)).toBe("곡.mme - BiNote");
    expect(windowTitle("곡.mme", true, true)).toBe("● 곡.mme - BiNote");
    expect(windowTitle("", true, false)).toBe("new project - BiNote");
  });
  it("설치한 앱은 설치한 앱 이름 전체로 시작한다 (크롬·엣지가 그 이름으로 시작하지 않는 제목은 제목줄에서 뺀다)", () => {
    for (const title of [windowTitle("곡.mme", true, false, true), windowTitle("곡.mme", true, true, true), windowTitle("", true, false, true)]) {
      expect(title.startsWith(`${APP_INSTALLED_NAME} - `)).toBe(true);
    }
    expect(windowTitle("곡.mme", true, true, true)).toBe(`${APP_INSTALLED_NAME} - ● 곡.mme`);
  });
  it("설치한 앱 이름은 manifest의 name과 같다 (크롬은 short_name이 아니라 name과 견준다)", () => {
    const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8")) as { name: string };
    expect(manifest.name).toBe(APP_INSTALLED_NAME);
  });
  it("위 띠에 쓰는 곡 이름", () => {
    expect(songLabel("곡.mme", false)).toBe("곡.mme");
    expect(songLabel("", true)).toBe("● new project");
  });
  it("제목줄이 없는 기기", () => {
    expect(hasNoTitleBar("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(hasNoTitleBar("Mozilla/5.0 (Linux; Android 14)", 5)).toBe(true);
    expect(hasNoTitleBar("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 10)).toBe(false);
    expect(hasNoTitleBar("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
  });
});
