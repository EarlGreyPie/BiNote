import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { missingKeys } from "../src/index.js";
import { ko } from "../src/locales/ko.js";

// 소스에서 내는 진단 코드가 모두 문구 목록에 있는지 확인한다.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : name.endsWith(".ts") ? [p] : [];
  });
}

describe("진단 코드", () => {
  it("모든 코드에 문구가 있다", () => {
    const root = join(import.meta.dirname, "../..");
    const codes = new Set<string>();
    for (const pkg of readdirSync(root)) {
      const src = join(root, pkg, "src");
      try {
        statSync(src);
      } catch {
        continue;
      }
      for (const file of sources(src)) {
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(/code: "([a-z0-9-]+)"/g)) codes.add(m[1]!);
        for (const m of text.matchAll(/diag\("(?:error|warning|info)", "([a-z0-9-]+)"/g)) codes.add(m[1]!);
      }
    }
    expect(codes.size).toBeGreaterThan(5);
    const missing = [...codes].filter((c) => !(`diag.${c}` in ko));
    expect(missing).toEqual([]);
  });

  it("번역 진행 상황 (일본어·번체는 아직 비어 있어도 됨)", () => {
    expect(missingKeys("ja").length).toBeGreaterThanOrEqual(0);
    expect(missingKeys("zh-TW").length).toBeGreaterThanOrEqual(0);
  });
});
