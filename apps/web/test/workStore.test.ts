import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEEP_WORKS, needsSweep, staleWorks, type WorkRecord } from "../src/lib/workStore";

const DAY = 24 * 60 * 60 * 1000;

/** 저장할 때마다 모듈 상태(이 탭에서 한 번 훑었는지)가 새로 시작하게 다시 불러온다 */
async function freshStore() {
  vi.resetModules();
  return import("../src/lib/workStore");
}

function work(id: string, savedAt: number, project = `{"song":"${id}"}`): WorkRecord {
  return { id, savedAt, fileName: `${id}.mme`, title: id, trackCount: 1, noteCount: 2, project };
}

/** beta.32가 만든 그대로의 저장소에 기록을 넣는다 (판 1, keyPath id, 색인 없음) */
async function seedBeta32(records: readonly WorkRecord[]): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("mmlce-work", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("works", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("works", "readwrite");
    for (const r of records) tx.objectStore("works").put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("mmlce-work");
    req.onsuccess = req.onerror = () => resolve();
  });
});

afterEach(() => vi.restoreAllMocks());

describe("정리할 작업 고르기", () => {
  it("최근 KEEP_WORKS개 밖과 30일 지난 것을 고르고, 지금 적은 작업은 남긴다", () => {
    const now = 100 * DAY;
    const works = Array.from({ length: KEEP_WORKS + 2 }, (_, i) => ({ id: `w${i}`, savedAt: now - i * 1000 }));
    expect(staleWorks(works, "w0", now)).toEqual([`w${KEEP_WORKS}`, `w${KEEP_WORKS + 1}`]);
    // 가장 오래된 것이 지금 적은 작업이면 남긴다
    expect(staleWorks(works, `w${KEEP_WORKS + 1}`, now)).toEqual([`w${KEEP_WORKS}`]);
    expect(staleWorks([{ id: "old", savedAt: now - 31 * DAY }, { id: "new", savedAt: now }], "new", now)).toEqual(["old"]);
  });

  it("본문은 넘칠 때와 이 탭에서 처음 저장할 때만 읽는다", () => {
    expect(needsSweep(1, false)).toBe(true);
    expect(needsSweep(KEEP_WORKS, true)).toBe(false);
    expect(needsSweep(KEEP_WORKS + 1, true)).toBe(true);
  });
});

describe("workStore (자동 보존 저장소)", () => {
  it("beta.32가 남긴 작업을 그대로 보이고 되살린다", async () => {
    const now = Date.now();
    await seedBeta32([work("old-a", now - 2000), work("old-b", now - 1000)]);
    const store = await freshStore();
    expect((await store.listWorks()).map((w) => w.id)).toEqual(["old-b", "old-a"]);
    expect((await store.loadWork("old-a"))?.project).toBe('{"song":"old-a"}');
    // 새 판에서 적어도 옛 작업은 남는다
    expect(await store.saveWork(work("new", now))).toBe("saved");
    expect((await store.listWorks()).map((w) => w.id)).toEqual(["new", "old-b", "old-a"]);
    const list = await store.listWorks();
    // 목록에는 본문이 없다
    expect(list.every((w) => !("project" in w))).toBe(true);
  });

  it("남길 수를 넘으면 가장 오래된 것부터 지우고, 30일 지난 것은 처음 저장할 때 지운다", async () => {
    const now = Date.now();
    await seedBeta32([work("stale", now - 31 * DAY), ...Array.from({ length: KEEP_WORKS - 1 }, (_, i) => work(`w${i}`, now - (i + 1) * 1000))]);
    const store = await freshStore();
    await store.saveWork(work("first", now));
    const ids = (await store.listWorks()).map((w) => w.id);
    expect(ids).not.toContain("stale");
    expect(ids).toHaveLength(KEEP_WORKS);
    // 하나 더 적으면 넘쳐서 가장 오래된 것이 빠진다
    await store.saveWork(work("second", now + 1));
    const after = (await store.listWorks()).map((w) => w.id);
    expect(after).toHaveLength(KEEP_WORKS);
    expect(after[0]).toBe("second");
    expect(after).not.toContain(`w${KEEP_WORKS - 2}`);
  });

  it("넘치지 않으면 저장할 때 다른 작업 본문을 읽지 않는다", async () => {
    const store = await freshStore();
    await store.saveWork(work("a", 1));
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
    for (let i = 0; i < 5; i++) expect(await store.saveWork(work("a", 2 + i))).toBe("saved");
    expect(getAll).not.toHaveBeenCalled();
  });

  it("공간이 꽉 차 실패한 것과 다른 실패를 가려 알린다", async () => {
    const store = await freshStore();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(await store.saveWork(work("a", 1))).toBe("quota");
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("nope", "InvalidStateError");
    });
    expect(await store.saveWork(work("a", 2))).toBe("failed");
    expect(await store.saveWork(work("a", 3))).toBe("saved");
  });
});

/** localStorage 흉내 (시험 환경에는 없다) */
function fakeStash(limit = Infinity) {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new DOMException("full", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("급히 적어 둔 작업 (문서가 내려갈 때)", () => {
  it("급히 적어 둔 작업을 다음에 열 때 저장소로 옮기고 자리를 비운다", async () => {
    const store = await freshStore();
    const stash = fakeStash();
    expect(store.stashWork(work("a", 1000, '{"song":"고친 것"}'), stash)).toBe(true);
    expect(await store.listWorks()).toEqual([]);
    expect(await store.adoptStashedWorks(stash)).toBe(1);
    expect((await store.loadWork("a"))?.project).toBe('{"song":"고친 것"}');
    expect(stash.map.size).toBe(0);
    // 다시 불러도 할 일이 없다
    expect(await store.adoptStashedWorks(stash)).toBe(0);
  });

  it("저장소의 기록이 더 오래됐으면 덮어쓰고, 같거나 더 새것이면 급히 적은 것을 버린다", async () => {
    const store = await freshStore();
    const stash = fakeStash();
    await store.saveWork(work("a", 1000, "old"));
    store.stashWork(work("a", 2000, "new"), stash);
    expect(await store.adoptStashedWorks(stash)).toBe(1);
    expect((await store.loadWork("a"))?.project).toBe("new");

    await store.saveWork(work("b", 3000, "saved"));
    store.stashWork(work("b", 2500, "stale"), stash);
    expect(await store.adoptStashedWorks(stash)).toBe(0);
    expect((await store.loadWork("b"))?.project).toBe("saved");
    expect(stash.map.size).toBe(0);
  });

  it("작업마다 하나씩 남고, 알 수 없는 글은 버린다. 다른 열쇠는 건드리지 않는다", async () => {
    const store = await freshStore();
    const stash = fakeStash();
    store.stashWork(work("a", 1000, "a1"), stash);
    store.stashWork(work("a", 2000, "a2"), stash);
    store.stashWork(work("b", 1500, "b1"), stash);
    stash.map.set("mmlce-work-stash:broken", "{not json");
    stash.map.set("mmlce-work-stash:other", JSON.stringify(work("mismatch", 1, "x")));
    stash.map.set("mmlce.settings", "keep");
    expect(await store.adoptStashedWorks(stash)).toBe(2);
    expect((await store.listWorks()).map((w) => w.id)).toEqual(["a", "b"]);
    expect((await store.loadWork("a"))?.project).toBe("a2");
    expect([...stash.map.keys()]).toEqual(["mmlce.settings"]);
  });

  it("옮기는 사이 다른 탭이 더 새것을 급히 적으면 그것은 지우지 않고, 다음에 옮긴다", async () => {
    const store = await freshStore();
    const stash = fakeStash();
    store.stashWork(work("a", 1000, "old"), stash);
    // 옮기기는 급히 적은 글을 읽은 뒤 저장소 트랜잭션을 기다린다. 그사이 고치던 탭이 다시 급히 적는다
    const adopting = store.adoptStashedWorks(stash);
    store.stashWork(work("a", 2000, "new"), stash);
    expect(await adopting).toBe(1);
    expect((await store.loadWork("a"))?.project).toBe("old");
    expect(stash.map.get("mmlce-work-stash:a")).toContain('"new"');
    // 다음에 열 때 새것이 옮겨진다
    expect(await store.adoptStashedWorks(stash)).toBe(1);
    expect((await store.loadWork("a"))?.project).toBe("new");
    expect(stash.map.size).toBe(0);
  });

  it("공간이 모자라 적지 못하면 false를 돌려주고 예외를 내지 않는다", async () => {
    const store = await freshStore();
    expect(store.stashWork(work("a", 1000, "x".repeat(100)), fakeStash(10))).toBe(false);
    expect(store.stashWork(work("a", 1000), undefined)).toBe(false);
    expect(await store.adoptStashedWorks(undefined)).toBe(0);
  });
});
