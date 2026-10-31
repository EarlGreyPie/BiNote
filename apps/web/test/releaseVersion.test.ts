import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
