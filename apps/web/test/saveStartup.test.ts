import { describe, expect, it } from "vitest";
import { SaveStartup, type SaveMode } from "../src/lib/saveStartup";

/** 손으로 끝내는 늦은 읽기 */
function slowRead(found: boolean) {
  let finish!: () => void;
  const read = () => new Promise<boolean>((resolve) => (finish = () => resolve(found)));
  return { read, finish: () => finish() };
}

describe("SaveStartup: 시작할 때 예전 폴더 읽기와 저장 순서", () => {
  it("읽기 전에 저장하면 읽기를 기다린 뒤 folder로 저장한다 (기본값 ask로 저장 창을 띄우지 않는다)", async () => {
    const target: { mode: SaveMode } = { mode: "ask" };
    const s = new SaveStartup(target, undefined);
    const { read, finish } = slowRead(true);
    void s.load(read);
    const ready = s.ready(1000);
    expect(target.mode).toBe("ask");
    finish();
    expect(await ready).toBe(true);
    expect(target.mode).toBe("folder");
  });

  it("읽기가 너무 늦으면 저장하지 말라고(false) 알린다. 기억해 둔 방식이 있으면 기다리지 않아도 된다", async () => {
    const fresh = new SaveStartup({ mode: "ask" }, undefined);
    void fresh.load(slowRead(true).read);
    expect(await fresh.ready(10)).toBe(false);
    const known = new SaveStartup({ mode: "ask" }, "ask");
    void known.load(slowRead(true).read);
    expect(await known.ready(10)).toBe(true);
  });

  it("읽는 중에 사용자가 방식을 고르면 읽기가 끝나도 덮지 않는다", async () => {
    const target: { mode: SaveMode } = { mode: "ask" };
    const s = new SaveStartup(target, undefined);
    const { read, finish } = slowRead(true);
    const loading = s.load(read);
    s.choose("download");
    expect(await s.ready(10)).toBe(true);
    finish();
    await loading;
    expect(target.mode).toBe("download");
  });

  it("읽지 못하거나 폴더가 없으면 방식을 그대로 두고, 읽기를 시작하지 않았으면 바로 저장한다", async () => {
    const target: { mode: SaveMode } = { mode: "ask" };
    const s = new SaveStartup(target, undefined);
    expect(await s.ready(10)).toBe(true);
    await s.load(() => Promise.reject(new Error("no db")));
    expect(target.mode).toBe("ask");
    const none = new SaveStartup(target, undefined);
    await none.load(async () => false);
    expect(target.mode).toBe("ask");
  });
});
