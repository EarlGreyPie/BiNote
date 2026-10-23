import { describe, expect, it } from "vitest";
import {
  allowedWhileTyping,
  bind,
  commandFor,
  conflicts,
  DEFAULT_SETTINGS,
  keyName,
  keysOf,
  parseSettings,
  PRESET_BINDINGS,
  PRESETS,
  resolve,
  unbind,
  volumeForDigit,
} from "../src/lib/keymap";

const press = (code: string, mods: Partial<{ ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }> = {}) => ({
  code,
  key: "",
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe("keyName", () => {
  it("물리 키와 수식 키를 정해진 순서로 적는다", () => {
    expect(keyName(press("KeyS", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+S");
    expect(keyName(press("KeyS", { meta: true }))).toBe("Ctrl+S");
    expect(keyName(press("Digit3"))).toBe("3");
    expect(keyName(press("Numpad3"))).toBe("Num3");
    expect(keyName(press("ArrowUp", { alt: true }))).toBe("Alt+Up");
    expect(keyName(press("Slash", { ctrl: true }))).toBe("Ctrl+/");
    expect(keyName(press("ShiftLeft", { shift: true }))).toBeUndefined();
  });
});

describe("키 설정", () => {
  it("기본 키 설정마다 겹치는 키가 없다", () => {
    for (const p of PRESETS) expect(conflicts(PRESET_BINDINGS[p])).toEqual([]);
  });

  it("마비꼬 호환은 숫자 키로 음 길이 격자를 고른다", () => {
    const b = resolve({ preset: "mabiicco", overrides: {} });
    expect(commandFor(b, "3")).toBe("grid.4");
    expect(commandFor(b, "Num8")).toBe("grid.12");
    expect(commandFor(b, "0")).toBe("grid.48");
    expect(commandFor(b, "F5")).toBe("play.start");
  });

  it("격자 ×2·½은 두 키 설정 모두 Shift+] / Shift+[ (숫자·길이 키와 따로)", () => {
    for (const p of PRESETS) {
      const b = resolve({ preset: p, overrides: {} });
      expect(commandFor(b, "Shift+]")).toBe("grid.double");
      expect(commandFor(b, "Shift+[")).toBe("grid.half");
    }
    const keyed = bind(DEFAULT_SETTINGS, "grid.double", "F2");
    expect(keysOf(resolve(keyed), "grid.double")).toEqual(["Shift+]", "F2"]);
  });

  it("다른 명령이 쓰던 키를 가져오면 그쪽에서 뺀다", () => {
    const s = bind(DEFAULT_SETTINGS, "play.start", "Space");
    const b = resolve(s);
    expect(keysOf(b, "play.start")).toEqual(["F5", "Space"]);
    expect(keysOf(b, "play.toggle")).toEqual([]);
    expect(conflicts(b)).toEqual([]);
  });

  it("기본값으로 되돌린 명령은 덮어쓰기에서 지운다", () => {
    const s = unbind(bind(DEFAULT_SETTINGS, "file.open", "F2"), "file.open", "F2");
    expect(s.overrides).toEqual({});
  });

  it("저장된 값에서 모르는 명령은 버린다", () => {
    const s = parseSettings({ preset: "mabiicco", overrides: { "file.open": ["F2"], nope: ["X"], "play.stop": 3 } });
    expect(s).toEqual({ preset: "mabiicco", overrides: { "file.open": ["F2"] } });
    expect(parseSettings("junk")).toEqual(DEFAULT_SETTINGS);
  });

  it("글자 치는 곳에서는 조합 키와 F 키만 받는다", () => {
    expect(allowedWhileTyping("Ctrl+S")).toBe(true);
    expect(allowedWhileTyping("F5")).toBe(true);
    expect(allowedWhileTyping("Escape")).toBe(true);
    expect(allowedWhileTyping("Space")).toBe(false);
    expect(allowedWhileTyping("3")).toBe(false);
    expect(allowedWhileTyping("Shift+Up")).toBe(false);
  });
});

describe("Alt+숫자 볼륨", () => {
  const range = { min: 0, max: 15 };
  it("6~9는 그대로, 0은 10, 1~5는 11~15, Shift면 숫자 그대로", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => volumeForDigit(d, false, range))).toEqual([11, 12, 13, 14, 15, 6, 7, 8, 9, 10]);
    expect([0, 3, 5].map((d) => volumeForDigit(d, true, range))).toEqual([0, 3, 5]);
  });
  it("게임 v 범위 밖이면 넣지 않는다", () => {
    expect(volumeForDigit(5, false, { min: 0, max: 12 })).toBeUndefined();
  });
});

describe("피아노롤 +/− 길이 키 (MMLCE 기본)", () => {
  const mmlce = PRESET_BINDINGS.mmlce;
  it("=·Shift+=·Num+는 길이 ×2, -·Num-는 ½. Ctrl+]·Ctrl+[는 그대로 첫 키", () => {
    for (const key of ["=", "Shift+=", "Num+", "Ctrl+]"]) expect(commandFor(mmlce, key)).toBe("edit.lengthDouble");
    for (const key of ["-", "Num-", "Ctrl+["]) expect(commandFor(mmlce, key)).toBe("edit.lengthHalf");
    expect(keysOf(mmlce, "edit.lengthDouble")[0]).toBe("Ctrl+]");
    expect(keysOf(mmlce, "edit.lengthHalf")[0]).toBe("Ctrl+[");
    expect(keyName(press("Equal"))).toBe("=");
    expect(keyName(press("Equal", { shift: true }))).toBe("Shift+=");
    expect(keyName(press("NumpadAdd"))).toBe("Num+");
    expect(keyName(press("Minus"))).toBe("-");
    expect(keyName(press("NumpadSubtract"))).toBe("Num-");
  });

  it("마비꼬 호환은 바뀌지 않고, 새 키는 충돌이 없다", () => {
    for (const key of ["=", "Shift+=", "Num+", "-", "Num-"]) expect(commandFor(PRESET_BINDINGS.mabiicco, key)).toBeUndefined();
    expect(conflicts(mmlce)).toEqual([]);
    // 예전에 이 명령 키를 바꿔 둔 사람의 덮어쓰기는 그대로 따른다
    const custom = resolve({ preset: "mmlce", overrides: { "edit.lengthDouble": ["Ctrl+D"] } });
    expect(keysOf(custom, "edit.lengthDouble")).toEqual(["Ctrl+D"]);
    expect(conflicts(custom)).toEqual([]);
  });

  it("글 입력 칸에서는 앱 단축키로 가지 않는다", () => {
    for (const key of ["=", "Shift+=", "Num+", "-", "Num-"]) expect(allowedWhileTyping(key)).toBe(false);
  });
});
