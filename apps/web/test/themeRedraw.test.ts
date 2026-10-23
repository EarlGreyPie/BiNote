import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, themeKeyOf } from "../src/lib/appearance";

describe("테마가 바뀌면 캔버스를 다시 그린다", () => {
  it("테마·강조색·시스템 밝기 모드 중 하나만 바뀌어도 열쇠가 달라진다", () => {
    const base = themeKeyOf(DEFAULT_APPEARANCE, false);
    expect(themeKeyOf({ ...DEFAULT_APPEARANCE, theme: "dark" }, false)).not.toBe(base);
    expect(themeKeyOf({ ...DEFAULT_APPEARANCE, theme: "light" }, false)).not.toBe(base);
    expect(themeKeyOf({ ...DEFAULT_APPEARANCE, accent: "green" }, false)).not.toBe(base);
    // 시스템 테마에서 아이패드·PC 밝기 모드가 바뀌는 경우
    expect(themeKeyOf(DEFAULT_APPEARANCE, true)).not.toBe(base);
    expect(themeKeyOf(DEFAULT_APPEARANCE, false)).toBe(base);
  });

  it("CSS 색으로 캔버스를 그리는 효과는 모두 themeKey를 읽는다 (타브 지판·볼륨 레인·피아노롤)", () => {
    const dir = new URL("../src/lib/", import.meta.url);
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".svelte"));
    let draws = 0;
    for (const f of files) {
      const text = readFileSync(new URL(f, dir), "utf8");
      // $effect 하나씩 (다음 $effect나 함수 선언 앞까지)
      for (const block of text.split("$effect(").slice(1)) {
        const body = block.split(/\n  (?:function |\$effect|export )/)[0] ?? "";
        const usesCss = /\bcss(Var)?\b/.test(body);
        const draws2d = body.includes('getContext("2d")') || body.includes("drawRoll(");
        if (!usesCss || !draws2d) continue;
        draws++;
        expect(body, f).toContain("void themeKey;");
      }
    }
    // 타브 지판 + 타브 볼륨 레인 + 피아노롤
    expect(draws).toBeGreaterThanOrEqual(3);
  });

  it("앱은 피아노롤과 타브 둘 다에 themeKey를 넘긴다", () => {
    const app = readFileSync(new URL("../src/App.svelte", import.meta.url), "utf8");
    for (const tag of ["<PianoRoll", "<TabView"]) {
      const i = app.indexOf(tag);
      expect(i, tag).toBeGreaterThan(0);
      const props = app.slice(i, app.indexOf("/>", i));
      expect(props, tag).toContain("{themeKey}");
    }
  });
});
