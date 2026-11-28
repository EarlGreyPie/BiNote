import { readFileSync } from "node:fs";
import type { Locale } from "@mmlce/i18n";
import { describe, expect, it } from "vitest";
import { CHANGELOG_FILES, changelogUrl } from "../src/lib/links";
import { changelogSection } from "../src/lib/releaseNotes";

// 판 번호를 올리면 CHANGELOG 맨 위 절도 그 판이어야 한다 (새 판 안내가 그 절을 보여 준다)
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const changelog = readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");

describe("판 번호와 CHANGELOG", () => {
  it("CHANGELOG 맨 위 절이 앱 판 번호와 같고 내용이 비어 있지 않다", () => {
    const top = changelog.split(/\r?\n/).find((l) => l.startsWith("## "));
    expect(top?.slice(3).trim().split(/\s/)[0]).toBe(pkg.version);
    expect(changelogSection(changelog, pkg.version)).not.toBe("");
  });
});

// 1.0.0부터 바뀐 내용을 다섯 언어로 쓴다: 판을 올리는 PR이 docs/changelog/언어.md에도 같은 판 절을 쓴다
// (다른 언어 화면의 새 판 안내가 그 절을 보여 준다. 없으면 한국어로 대신하지만, 빠뜨리지 않게 여기서 막는다)
describe("언어별 바뀐 내용", () => {
  for (const locale of Object.keys(CHANGELOG_FILES) as Locale[]) {
    if (locale === "ko") continue;
    it(`${CHANGELOG_FILES[locale]}: 맨 위 절이 앱 판 번호와 같고 내용이 비어 있지 않다`, () => {
      const text = readFileSync(new URL(`../../../${CHANGELOG_FILES[locale]}`, import.meta.url), "utf8");
      const top = text.split(/\r?\n/).find((l) => l.startsWith("## "));
      expect(top?.slice(3).trim().split(/\s/)[0]).toBe(pkg.version);
      expect(changelogSection(text, pkg.version)).not.toBe("");
    });
  }

  it("한국어는 CHANGELOG.md, 다른 언어는 docs/changelog로 링크한다", () => {
    expect(changelogUrl("ko")).toBe("https://github.com/EarlGreyPie/BiNote/blob/main/CHANGELOG.md");
    expect(changelogUrl("zh-TW")).toBe("https://github.com/EarlGreyPie/BiNote/blob/main/docs/changelog/zh-TW.md");
  });
});
