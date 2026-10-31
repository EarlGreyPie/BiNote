import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { LOCALES, translate } from "@mmlce/i18n";
import { SEARCH_PHRASES, searchPhrases } from "../src/lib/mmlSearch";

/** 들인 @codemirror/search가 화면에 쓰는 영어 문구들 (판을 올려 문구가 늘면 이 검사가 알린다) */
function libraryPhrases(): string[] {
  const file = createRequire(import.meta.url).resolve("@codemirror/search");
  const src = readFileSync(file, "utf8");
  const found = [...src.matchAll(/phrase\((?:view|state), "([^"]+)"|\.phrase\("([^"]+)"/g)].map((m) => m[1] ?? m[2]!);
  return [...new Set(found)];
}

describe("MML 편집기 찾기 칸 문구", () => {
  it("라이브러리 문구를 모두 번역한다 (줄 번호로 가기는 쓰지 않아 뺀다)", () => {
    const unused = new Set(["Go to line", "go"]);
    const used = libraryPhrases();
    expect(used).toContain("replace all");
    const missing = used.filter((p) => !unused.has(p) && !(p in SEARCH_PHRASES));
    expect(missing).toEqual([]);
  });

  it("모든 키가 한국어 원본에 있고, 언어마다 문구가 나온다", () => {
    for (const key of Object.values(SEARCH_PHRASES)) expect(translate("ko", key), key).not.toBe(key);
    for (const l of LOCALES) {
      const map = searchPhrases((k) => translate(l, k));
      expect(Object.keys(map).sort()).toEqual(Object.keys(SEARCH_PHRASES).sort());
      for (const v of Object.values(map)) expect(v.startsWith("ui.")).toBe(false);
    }
  });

  it("개수·줄 번호 자리($)를 지킨다", () => {
    for (const l of LOCALES) {
      expect(translate(l, "ui.searchReplacedAll")).toContain("$");
      expect(translate(l, "ui.searchReplacedOne")).toContain("$");
    }
  });
});
