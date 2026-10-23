import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * GitHub 마크다운은 ~ 두 개 사이를 취소선으로 그린다. 그래서 "1~3"처럼 범위를 ~로 쓰면
 * 가이드북·바뀐 내용 글이 줄줄이 그어져 보인다. 범위는 -로 쓰고, ~는 `코드` 안에서만 허용한다.
 */
const root = new URL("../../../", import.meta.url);
const files = [
  "README.md",
  "CHANGELOG.md",
  "docs/가이드북.md",
  ...readdirSync(new URL("docs/guide/", root))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/guide/${f}`),
];

/** 코드 블록(```)과 `코드` 칸을 뺀 줄에서 ~가 있는 곳을 찾는다 */
function tildesOutsideCode(text: string): number[] {
  const lines: number[] = [];
  let fence = false;
  text.split("\n").forEach((line, i) => {
    if (line.trimStart().startsWith("```")) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const plain = line.replace(/\\`/g, "").replace(/(`+)[^`]*?\1/g, "");
    if (plain.includes("~")) lines.push(i + 1);
  });
  return lines;
}

describe("문서의 ~ (취소선으로 보임)", () => {
  for (const file of files) {
    it(`${file}: 코드 밖에 ~가 없다`, () => {
      const text = readFileSync(new URL(file, root), "utf8");
      expect(tildesOutsideCode(text)).toEqual([]);
    });
  }

  it("`코드` 안의 ~와 코드 블록은 넘어간다", () => {
    expect(tildesOutsideCode("a `c~d` b\n```\nx~y\n```\n")).toEqual([]);
    expect(tildesOutsideCode("1~3\nok\nAlt+\\` → v0~5")).toEqual([1, 3]);
  });
});
