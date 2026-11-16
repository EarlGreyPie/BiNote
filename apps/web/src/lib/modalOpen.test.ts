import { describe, expect, it } from "vitest";
import { modalOpen } from "./modalOpen";

const dialog = (modal: boolean | "old") => ({
  matches: (sel: string) => {
    if (modal === "old") throw new SyntaxError(sel);
    return sel === ":modal" && modal;
  },
});

describe("modalOpen", () => {
  it("모달 아닌 창(셈여림 등)만 열려 있으면 단축키를 막지 않는다", () => {
    expect(modalOpen([])).toBe(false);
    expect(modalOpen([dialog(false), dialog(false)])).toBe(false);
  });
  it("모달 창이 하나라도 열려 있으면 막는다", () => {
    expect(modalOpen([dialog(false), dialog(true)])).toBe(true);
  });
  it(":modal을 모르는 브라우저에서는 예전처럼 막는다", () => {
    expect(modalOpen([dialog("old")])).toBe(true);
  });
});
