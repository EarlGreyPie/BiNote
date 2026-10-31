import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isShareLaunch, SHARE_CACHE, SHARE_QUERY, takeShared, withoutShareQuery } from "../src/lib/shareInbox";

const SCOPE = "https://binote.test/app/";

/** 한 사이트의 Cache Storage를 흉내 낸 것 (쓰는 것만) */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (k: RequestInfo | URL) => (typeof k === "string" ? k : k instanceof URL ? k.href : k.url);
  /** ignoreSearch면 ?뒤를 떼고 견준다 (Cache Storage와 같게) */
  const find = (map: Map<string, Response>, k: RequestInfo | URL, options?: CacheQueryOptions) => {
    const bare = (u: string) => (options?.ignoreSearch ? u.replace(/\?[^#]*/, "") : u);
    const want = bare(keyOf(k));
    for (const [u, r] of map) if (bare(u) === want) return r.clone();
    return undefined;
  };
  const cacheOf = (map: Map<string, Response>) => ({
    put: (k: RequestInfo | URL, r: Response) => {
      map.set(keyOf(k), r);
      return Promise.resolve();
    },
    match: (k: RequestInfo | URL, options?: CacheQueryOptions) => Promise.resolve(find(map, k, options)),
    keys: () => Promise.resolve([...map.keys()].map((u) => new Request(u))),
  });
  const storage = {
    has: (name: string) => Promise.resolve(stores.has(name)),
    open: (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return Promise.resolve(cacheOf(stores.get(name)!));
    },
    delete: (name: string) => Promise.resolve(stores.delete(name)),
    keys: () => Promise.resolve([...stores.keys()]),
    match: (k: RequestInfo | URL, options?: CacheQueryOptions) => {
      for (const map of stores.values()) {
        const hit = find(map, k, options);
        if (hit) return Promise.resolve(hit);
      }
      return Promise.resolve(undefined);
    },
  };
  return { storage: storage as unknown as CacheStorage, stores };
}

/** public/sw.js를 가짜 서비스 워커 자리에서 돌려 이벤트 처리기를 꺼낸다 */
function loadServiceWorker(storage: CacheStorage, windows = 1) {
  const handlers = new Map<string, (event: unknown) => void>();
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
    registration: { scope: SCOPE },
    location: new URL(SCOPE),
    clients: { matchAll: () => Promise.resolve(Array.from({ length: windows })), claim: () => Promise.resolve() },
    skipWaiting: () => {},
  };
  const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  new Function("self", "caches", "fetch", source)(self, storage, () => Promise.reject(new Error("offline")));
  return handlers;
}

/** fetch 이벤트를 보내고 respondWith로 받은 답을 돌려준다. 서비스 워커가 맡지 않으면 undefined */
async function dispatchFetch(handlers: Map<string, (event: unknown) => void>, request: Request): Promise<Response | undefined> {
  let answer: Promise<Response> | undefined;
  handlers.get("fetch")!({ request, respondWith: (p: Promise<Response>) => (answer = p) });
  return answer;
}

function shareRequest(form: FormData): Request {
  return new Request(new URL(SHARE_QUERY, SCOPE), { method: "POST", body: form });
}

describe("공유 받기 (share_target)", () => {
  it("서비스 워커가 받은 글·파일을 담고 앱을 ?share-target으로 열면, 앱이 그대로 꺼낸다", async () => {
    const { storage, stores } = fakeCaches();
    const sw = loadServiceWorker(storage);
    const form = new FormData();
    form.set("title", "내 곡");
    form.set("text", "MML@cde,,;");
    form.append("files", new File(["{}"], "노래 1.mme", { type: "application/octet-stream" }));
    form.append("files", new File([new Uint8Array([0x4d, 0x54, 0x68, 0x64])], "b.mid", { type: "audio/midi" }));
    const response = await dispatchFetch(sw, shareRequest(form));
    expect(response?.status).toBe(303);
    const location = response!.headers.get("Location")!;
    expect(location).toBe(`${SCOPE}?${SHARE_QUERY}`);
    expect(isShareLaunch(new URL(location).search)).toBe(true);
    expect(stores.has(SHARE_CACHE)).toBe(true);

    const shared = await takeShared(storage);
    expect(shared.texts).toEqual(["MML@cde,,;", "내 곡"]);
    expect(shared.files.map((x) => x.name)).toEqual(["노래 1.mme", "b.mid"]);
    expect(await shared.files[0]!.text()).toBe("{}");
    expect(new Uint8Array(await shared.files[1]!.arrayBuffer())).toEqual(new Uint8Array([0x4d, 0x54, 0x68, 0x64]));
    // 꺼낸 뒤에는 지워, 새로고침해도 다시 열지 않는다
    expect(stores.has(SHARE_CACHE)).toBe(false);
    expect(await takeShared(storage)).toEqual({ files: [], texts: [] });
  });

  it("새로 공유하면 앞서 꺼내지 않은 것은 버린다", async () => {
    const { storage } = fakeCaches();
    const sw = loadServiceWorker(storage);
    const first = new FormData();
    first.set("text", "앞 글");
    await dispatchFetch(sw, shareRequest(first));
    const second = new FormData();
    second.set("text", "뒷 글");
    await dispatchFetch(sw, shareRequest(second));
    expect((await takeShared(storage)).texts).toEqual(["뒷 글"]);
  });

  it("받은 것을 못 읽어도 앱은 연다", async () => {
    const { storage } = fakeCaches();
    const sw = loadServiceWorker(storage);
    const broken = new Request(new URL(SHARE_QUERY, SCOPE), { method: "POST", body: "x", headers: { "Content-Type": "multipart/form-data; boundary=zz" } });
    const response = await dispatchFetch(sw, broken);
    expect(response?.status).toBe(303);
  });

  it("연결이 없어도 공유받은 뒤 ./?share-target으로 앱이 열린다 (담아 둔 시작 페이지로 찾는다)", async () => {
    const { storage } = fakeCaches();
    const sw = loadServiceWorker(storage);
    await (await storage.open("mmlce-dev")).put(SCOPE, new Response("<!doctype html>앱"));
    const form = new FormData();
    form.set("text", "MML@cde,,;");
    const location = (await dispatchFetch(sw, shareRequest(form)))!.headers.get("Location")!;
    // 브라우저가 넘겨 간 화면 열기. Node의 Request는 mode navigate를 만들 수 없어 쓰는 것만 흉내 낸다
    const navigate = { method: "GET", url: location, mode: "navigate" } as unknown as Request;
    const page = await dispatchFetch(sw, navigate);
    expect(page?.type).not.toBe("error");
    expect(await page!.text()).toBe("<!doctype html>앱");
    // 화면이 아닌 파일은 주소(?뒤 포함)가 같은 것만 쓴다
    const asset = { method: "GET", url: `${SCOPE}?x=1`, mode: "cors" } as unknown as Request;
    expect((await dispatchFetch(sw, asset))?.type).toBe("error");
  });

  it("다른 주소로 보낸 POST는 맡지 않는다", async () => {
    const { storage } = fakeCaches();
    const sw = loadServiceWorker(storage);
    expect(await dispatchFetch(sw, new Request(new URL("other", SCOPE), { method: "POST", body: "x" }))).toBeUndefined();
  });

  it("새 판으로 바꿀 때 옛 앱 캐시는 지워도 공유받은 것은 남긴다", async () => {
    const { storage, stores } = fakeCaches();
    const sw = loadServiceWorker(storage);
    await storage.open("mmlce-old");
    await storage.open(SHARE_CACHE);
    let done: Promise<unknown> | undefined;
    sw.get("activate")!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(stores.has("mmlce-old")).toBe(false);
    expect(stores.has(SHARE_CACHE)).toBe(true);
  });

  it("캐시를 못 쓰는 브라우저는 빈 것", async () => {
    expect(await takeShared(undefined)).toEqual({ files: [], texts: [] });
  });

  it("주소의 공유 표시만 뗀다", () => {
    expect(withoutShareQuery(`${SCOPE}?${SHARE_QUERY}`)).toBe(SCOPE);
    expect(withoutShareQuery(`${SCOPE}?lang=ja&${SHARE_QUERY}#x`)).toBe(`${SCOPE}?lang=ja#x`);
    expect(isShareLaunch("?lang=ja")).toBe(false);
  });
});

describe("manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8")) as {
    file_handlers: { action: string; accept: Record<string, string[]> }[];
    share_target: { action: string; method: string; enctype: string; params: { files: { name: string }[] } };
  };

  it("공유 주소·방식이 서비스 워커가 받는 것과 같다", () => {
    expect(new URL(manifest.share_target.action, SCOPE).href).toBe(new URL(SHARE_QUERY, SCOPE).href);
    expect(manifest.share_target.method).toBe("POST");
    expect(manifest.share_target.enctype).toBe("multipart/form-data");
    expect(manifest.share_target.params.files[0]!.name).toBe("files");
  });

  it("설치한 앱으로 여는 파일은 프로젝트·3MLE·마비꼬·MIDI다", () => {
    const exts = manifest.file_handlers.flatMap((h) => Object.values(h.accept).flat());
    expect(exts.sort()).toEqual([".mid", ".midi", ".mme", ".mmi", ".mml", ".mmlce"]);
    expect(manifest.file_handlers.every((h) => new URL(h.action, SCOPE).href === SCOPE)).toBe(true);
  });
});
