import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const web = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", web), "utf8")) as { dependencies: Record<string, string> };
const thirdParty = readFileSync(new URL("public/licenses/third-party.txt", web), "utf8");
const fonts = readFileSync(new URL("public/licenses/fonts.txt", web), "utf8");

/** 글꼴 꾸러미는 fonts.txt에 따로 적는다 */
const FONT_PACKAGES = new Set(["d2coding", "pretendard-gov"]);

describe("배포 파일에 담는 라이브러리 라이선스 목록", () => {
  // 의존성을 더하고 third-party.txt에 적지 않으면 MIT·Apache 고지 없이 배포하게 된다
  it("웹 앱이 쓰는 라이브러리는 모두 이름·판으로 third-party.txt에 있다", () => {
    const missing = Object.entries(pkg.dependencies)
      .filter(([name, version]) => !version.startsWith("workspace:") && !FONT_PACKAGES.has(name))
      .filter(([name, version]) => !thirdParty.includes(`\n${name} ${version.replace(/^[\^~]/, "")} (`))
      .map(([name, version]) => `${name} ${version}`);
    expect(missing).toEqual([]);
  });

  it("글꼴은 fonts.txt에 있다", () => {
    for (const name of FONT_PACKAGES) expect(Object.keys(pkg.dependencies)).toContain(name);
    expect(fonts).toContain(`D2Coding ${pkg.dependencies["d2coding"]}`);
    expect(fonts).toContain(`Pretendard GOV ${pkg.dependencies["pretendard-gov"]}`);
  });
});
