import { describe, expect, it } from "vitest";
import { commandFor, DEFAULT_SETTINGS, keyName, resolve } from "../src/lib/keymap";
import { arrowGoesToApp } from "../src/lib/tabSelect";

/** 앱이 타브에 주는 판정과 같게: 이 키가 키 설정에서 옥타브 명령인지 */
const octaveKey = (bindings: ReturnType<typeof resolve>, e: { code: string; key: string; shiftKey?: boolean }) => {
  const c = commandFor(bindings, keyName({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...e }) ?? "");
  return c === "note.octaveUp" || c === "note.octaveDown";
};

describe("타브의 Shift+↑/↓ (PR #138 점검 8)", () => {
  const bindings = resolve(DEFAULT_SETTINGS);
  const shiftUp = { code: "ArrowUp", key: "ArrowUp", shiftKey: true };
  const shiftDown = { code: "ArrowDown", key: "ArrowDown", shiftKey: true };

  it("고른 음이 있으면 기본 키 Shift+↑/↓는 앱의 옥타브 명령으로 넘긴다", () => {
    expect(arrowGoesToApp("ArrowUp", true, octaveKey(bindings, shiftUp))).toBe(true);
    expect(arrowGoesToApp("ArrowDown", true, octaveKey(bindings, shiftDown))).toBe(true);
  });
  it("고른 음이 없으면 타브가 처리한다 (줄 방향 커서·고르기, 지금처럼)", () => {
    expect(arrowGoesToApp("ArrowUp", false, octaveKey(bindings, shiftUp))).toBe(false);
  });
  it("Shift 없는 ↑/↓와 Shift+←/→는 타브가 처리한다", () => {
    expect(arrowGoesToApp("ArrowUp", true, octaveKey(bindings, { code: "ArrowUp", key: "ArrowUp" }))).toBe(false);
    expect(arrowGoesToApp("ArrowRight", true, true)).toBe(false);
  });
  it("키 설정에서 옥타브 키를 바꾸면 그것을 따른다", () => {
    const changed = resolve({ preset: "mmlce", overrides: { "note.octaveUp": ["Ctrl+Up"], "note.octaveDown": ["Ctrl+Down"] } });
    expect(arrowGoesToApp("ArrowUp", true, octaveKey(changed, shiftUp))).toBe(false);
  });
});
