import { describe, expect, it } from "vitest";
import { WorkLocks, type WorkLockManager } from "../src/lib/workLock";

/** 한 사이트의 모든 탭이 함께 쓰는 가짜 Web Locks (ifAvailable 요청만) */
function fakeLocks(): WorkLockManager {
  const held = new Set<string>();
  const manager = {
    request(name: string, _options: { ifAvailable?: boolean }, callback: (lock: { name: string } | null) => unknown) {
      if (held.has(name)) return Promise.resolve(callback(null));
      held.add(name);
      return Promise.resolve(callback({ name })).finally(() => held.delete(name));
    },
    query: () => Promise.resolve({ held: [...held].map((name) => ({ name })), pending: [] }),
  };
  return manager as unknown as WorkLockManager;
}

/** 진짜 브라우저처럼 잠금 답이 한 박자 늦게 오는 가짜 */
function slowLocks(): WorkLockManager {
  const held = new Set<string>();
  const manager = {
    request(name: string, _options: { ifAvailable?: boolean }, callback: (lock: { name: string } | null) => unknown) {
      return new Promise((r) => setTimeout(r, 0)).then(() => {
        if (held.has(name)) return callback(null);
        held.add(name);
        return Promise.resolve(callback({ name })).finally(() => held.delete(name));
      });
    },
    query: () => Promise.resolve({ held: [...held].map((name) => ({ name })), pending: [] }),
  };
  return manager as unknown as WorkLockManager;
}

describe("WorkLocks (탭 사이 작업 잠금)", () => {
  it("다른 탭이 맡은 작업은 맡지 못하고, 목록에 다른 탭 작업으로 보인다", async () => {
    const locks = fakeLocks();
    const a = new WorkLocks(locks);
    const b = new WorkLocks(locks);
    expect(await a.claim("w1")).toBe(true);
    expect(await b.claim("w1")).toBe(false);
    expect([...(await b.heldElsewhere())]).toEqual(["w1"]);
    // 자기가 맡은 작업은 다른 탭 작업이 아니다
    expect([...(await a.heldElsewhere())]).toEqual([]);
  });

  it("새 작업을 맡으면 앞 작업을 놓아 다른 탭이 이어 쓸 수 있다", async () => {
    const locks = fakeLocks();
    const a = new WorkLocks(locks);
    const b = new WorkLocks(locks);
    await a.claim("w1");
    expect(await a.claim("w2")).toBe(true);
    expect(await b.claim("w1")).toBe(true);
    expect([...(await a.heldElsewhere())]).toEqual(["w1"]);
  });

  it("맡지 못해도 전에 맡던 작업은 그대로 쥔다. 같은 작업을 다시 맡으면 바로 된다", async () => {
    const locks = fakeLocks();
    const a = new WorkLocks(locks);
    const b = new WorkLocks(locks);
    await a.claim("mine");
    await b.claim("theirs");
    expect(await a.claim("theirs")).toBe(false);
    expect(await b.claim("mine")).toBe(false);
    expect(await a.claim("mine")).toBe(true);
  });

  it("잠금이 없는 브라우저에서는 막지 않는다", async () => {
    const a = new WorkLocks(undefined);
    expect(await a.claim("w1")).toBe(true);
    expect(await new WorkLocks(undefined).claim("w1")).toBe(true);
    expect((await a.heldElsewhere()).size).toBe(0);
  });

  it("같은 작업을 잇달아 맡아도(되살리기를 두 번 누름) 이 탭의 잠금을 다른 탭 것으로 보지 않는다", async () => {
    const locks = slowLocks();
    const a = new WorkLocks(locks);
    expect(await Promise.all([a.claim("w1"), a.claim("w1")])).toEqual([true, true]);
    expect((await a.heldElsewhere()).size).toBe(0);
    // 다른 탭은 여전히 맡지 못한다
    expect(await new WorkLocks(locks).claim("w1")).toBe(false);
  });
});
