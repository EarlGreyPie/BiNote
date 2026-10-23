import { describe, expect, it } from "vitest";
import postcss from "postcss";
import { parseAppearance } from "../src/lib/appearance";
import { pxToRem, pxToRemPlugin } from "../src/lib/uiScale";

describe("화면 배율: px → rem", () => {
  it("3px 이상만 rem으로, 2px 이하·Px·%는 그대로", () => {
    expect(pxToRem("44px")).toBe("2.75rem");
    expect(pxToRem("0 2px 8px rgba(0, 0, 0, 0.25)")).toBe("0 2px 0.5rem rgba(0, 0, 0, 0.25)");
    expect(pxToRem("1px solid var(--line)")).toBe("1px solid var(--line)");
    expect(pxToRem("calc(100% + 4px)")).toBe("calc(100% + 0.25rem)");
    expect(pxToRem("-12px")).toBe("-0.75rem");
    expect(pxToRem("-0.5px")).toBe("-0.5px");
    expect(pxToRem("calc(16Px * var(--ui-scale, 1))")).toBe("calc(16Px * var(--ui-scale, 1))");
    expect(pxToRem("minmax(320px, var(--pane-w, 440px))")).toBe("minmax(20rem, var(--pane-w, 27.5rem))");
    expect(pxToRem("14px/1.5 var(--ui-font)")).toBe("0.875rem/1.5 var(--ui-font)");
  });

  it("선언과 @container는 바꾸고 @media 조건과 고정 파일은 그대로", () => {
    const run = (css: string) => postcss([pxToRemPlugin()]).process(css, { from: undefined }).css;
    expect(run("@media (max-width: 900px) { .a { padding: 8px } }")).toBe("@media (max-width: 900px) { .a { padding: 0.5rem } }");
    expect(run("@container (max-width: 480px) { .a { gap: 4px } }")).toBe("@container (max-width: 30rem) { .a { gap: 0.25rem } }");
    expect(run("/* ui-scale: fixed */ .a { left: 60px }")).toBe("/* ui-scale: fixed */ .a { left: 60px }");
  });

  it("저장된 배율은 고를 수 있는 값만 받고 나머지는 100%", () => {
    expect(parseAppearance(JSON.stringify({ uiScale: 125 })).uiScale).toBe(125);
    expect(parseAppearance(JSON.stringify({ uiScale: 133 })).uiScale).toBe(100);
    expect(parseAppearance(null).uiScale).toBe(100);
  });
});
