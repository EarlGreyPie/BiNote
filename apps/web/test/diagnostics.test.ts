import { describe, expect, it } from "vitest";
import { diagnosticText, enabledLabs, ErrorLog, errorText, harmlessError, quietError, watchUncaught, type RecentError } from "../src/lib/diagnostics";

describe("errorText", () => {
  it("Error는 이름과 내용, 나머지는 글로", () => {
    expect(errorText(new TypeError("x is undefined"))).toBe("TypeError: x is undefined");
    expect(errorText(new Error(""))).toBe("Error");
    expect(errorText("plain")).toBe("plain");
    expect(errorText(42)).toBe("42");
    expect(errorText(Object.create(null))).toBe("unknown error");
  });
});

describe("ErrorLog", () => {
  it("잇달아 난 같은 오류는 횟수만 늘리고, 정해진 개수만 남긴다", () => {
    const log = new ErrorLog(3);
    log.note("window", new Error("a"), 1);
    log.note("window", new Error("a"), 2);
    expect(log.list()).toHaveLength(1);
    expect(log.list()[0]).toMatchObject({ at: 1, where: "window", message: "Error: a", count: 2 });
    log.note("promise", "b", 3);
    log.note("view:roll", "c", 4);
    log.note("wav", "d", 5);
    expect(log.list().map((e) => e.message)).toEqual(["b", "c", "d"]);
    log.clear();
    expect(log.list()).toEqual([]);
  });

  it("호출 위치는 앞 몇 줄만 적는다", () => {
    const e = new Error("deep");
    e.stack = ["Error: deep", ...Array.from({ length: 20 }, (_, i) => `    at f${i} (app.js:${i})`)].join("\n");
    const item = new ErrorLog().note("window", e);
    expect(item.stack!.split("\n")).toHaveLength(6);
  });
});

describe("무시하거나 조용히 적는 오류", () => {
  it("ResizeObserver 알림은 적지 않는다", () => {
    expect(harmlessError("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(harmlessError("TypeError: x")).toBe(false);
  });

  it("멈춘 동작·막힌 재생·내용 모르는 스크립트 오류는 알리지 않는다", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(quietError(abort, "AbortError: aborted")).toBe(true);
    expect(quietError({ name: "NotAllowedError" }, "")).toBe(true);
    expect(quietError(undefined, "Script error.")).toBe(true);
    expect(quietError(new TypeError("x"), "TypeError: x")).toBe(false);
    expect(quietError(null, "x")).toBe(false);
  });
});

describe("diagnosticText", () => {
  const base = { version: "1.0.0-beta.32", build: "20261030", commit: "abc1234", userAgent: "TestBrowser/1", locale: "ko", display: "1280×800@2x", labs: [], errors: [] };

  it("판·빌드·브라우저·실험실을 줄마다 쓰고, 오류가 없으면 없다고 쓴다", () => {
    expect(diagnosticText(base)).toBe(
      ["BiNote 1.0.0-beta.32", "build: 20261030 · commit: abc1234", "browser: TestBrowser/1", "locale: ko", "display: 1280×800@2x", "labs: off", "recent errors: none"].join("\n"),
    );
  });

  it("최근 오류는 때·곳·횟수·호출 위치를 쓴다", () => {
    const text = diagnosticText({
      ...base,
      labs: enabledLabs({ on: true, buttonNames: false, fade: true }, ["staff"]),
      errors: [{ at: Date.UTC(2026, 9, 30, 1, 2, 3), where: "view:roll", message: "TypeError: x", stack: "TypeError: x\n    at draw (roll.js:1)", count: 3 }],
    });
    expect(text).toContain("labs: on, fade, staff");
    expect(text).toContain("recent errors (1):\n- 2026-10-30T01:02:03.000Z [view:roll] ×3 TypeError: x\n    at draw (roll.js:1)");
  });

  it("실험실을 끄면 세부 설정이 켜져 있어도 끔", () => {
    expect(enabledLabs({ on: false, buttonNames: true, fade: true }, ["staff"])).toEqual([]);
  });
});

describe("watchUncaught", () => {
  /** window 대신: 받은 이벤트를 듣는 함수에 그대로 넘긴다 */
  const fire = (target: EventTarget, type: string, fields: Record<string, unknown>) => target.dispatchEvent(Object.assign(new Event(type), fields));

  it("받지 않은 예외와 거부를 적고 알린다. 조용한 오류는 적기만, 무해한 알림은 적지도 않는다", () => {
    const target = new EventTarget();
    const log = new ErrorLog();
    const crashes: RecentError[] = [];
    const stop = watchUncaught(target, (item) => crashes.push(item), log);
    fire(target, "error", { error: new TypeError("x is undefined"), message: "Uncaught TypeError: x is undefined" });
    fire(target, "unhandledrejection", { reason: new Error("lost") });
    fire(target, "error", { error: null, message: "ResizeObserver loop completed with undelivered notifications." });
    const abort = new Error("stopped");
    abort.name = "AbortError";
    fire(target, "unhandledrejection", { reason: abort });
    expect(crashes.map((c) => `${c.where} ${c.message}`)).toEqual(["window TypeError: x is undefined", "promise Error: lost"]);
    expect(log.list().map((e) => e.message)).toEqual(["TypeError: x is undefined", "Error: lost", "AbortError: stopped"]);
    stop();
    fire(target, "error", { error: new Error("after") });
    expect(log.list()).toHaveLength(3);
    expect(crashes).toHaveLength(2);
  });
});
