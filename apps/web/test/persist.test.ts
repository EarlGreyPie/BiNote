import { afterEach, describe, expect, it, vi } from "vitest";
import { loadStored, parseJson, saveStored } from "../src/lib/persist";

describe("화면 설정 기억", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("저장한 값을 읽고, 저장소가 막혀 있으면 기본값으로 시작한다", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    saveStored("k", "full");
    expect(loadStored("k", (raw) => raw ?? "compact")).toBe("full");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("막힘");
      },
      setItem: () => {
        throw new Error("막힘");
      },
    });
    expect(loadStored("k", (raw) => raw ?? "compact")).toBe("compact");
    expect(() => saveStored("k", "x")).not.toThrow();
  });

  it("깨진 JSON은 undefined", () => {
    expect(parseJson("{oops")).toBeUndefined();
    expect(parseJson('{"on":true}')).toEqual({ on: true });
  });
});
