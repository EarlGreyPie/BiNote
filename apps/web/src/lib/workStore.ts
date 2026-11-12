/**
 * 작업 자동 보존: 고치던 곡을 이 브라우저(IndexedDB)에 수시로 적어 두고,
 * 새로고침·탭 닫기·브라우저 종료 뒤 첫 화면에서 되살릴 수 있게 한다.
 * 이 브라우저 안에서만 쓰는 임시 복구용이다. 오래 보관하려면 프로젝트 파일로 저장한다.
 * 사운드팩 저장(packStore)과는 다른 저장소를 쓴다. 저장소를 못 쓰면 편집은 그대로 하고, 저장 결과로 까닭만 알린다.
 * 기록 형식과 저장소 구조는 beta.32 그대로다 (이미 남아 있는 작업을 옮기지 않고 그대로 읽는다).
 */

import { isQuotaError } from "./storageSpace";

const DB_NAME = "mmlce-work";
const STORE = "works";
/** 남겨 두는 작업 수와 기간 */
export const KEEP_WORKS = 10;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export interface WorkSummary {
  /** 곡을 열거나 새로 만들 때마다 새로 붙는 id. 같은 작업을 이어 고치면 같은 기록을 덮어쓴다 */
  readonly id: string;
  /** 저장한 시각 (ms) */
  readonly savedAt: number;
  readonly fileName: string;
  readonly title: string;
  readonly trackCount: number;
  readonly noteCount: number;
}

export interface WorkRecord extends WorkSummary {
  /** 프로젝트 글 그대로 */
  readonly project: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = body(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      // 요청 하나가 실패하면 tx.error는 아직 비어 있을 수 있다. 그 요청의 오류로 까닭을 알린다
      tx.onerror = (e) => reject((e.target as IDBRequest | null)?.error ?? tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function newWorkId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

let askedPersist = false;
/** 이 탭에서 기간 지난 작업까지 한 번 훑었는지. 처음 저장할 때 한 번만 본문까지 읽어 정리한다 */
let sweptOnce = false;

/** 작업 저장 결과. quota: 저장 공간이 꽉 참, failed: 그 밖의 까닭(사생활 보호 창, 저장소 막힘 등) */
export type WorkSaveResult = "saved" | "quota" | "failed";

/**
 * 정리할 작업 id: 지금 적은 작업은 남기고, 최근 KEEP_WORKS개 밖이거나 KEEP_MS보다 오래된 것.
 * works는 순서 상관없음
 */
export function staleWorks(works: readonly Pick<WorkSummary, "id" | "savedAt">[], keep: string, now: number): string[] {
  return [...works]
    .sort((a, b) => b.savedAt - a.savedAt)
    .filter((w, i) => w.id !== keep && (i >= KEEP_WORKS || now - w.savedAt > KEEP_MS))
    .map((w) => w.id);
}

/**
 * 정리하려고 본문까지 다 읽어야 하나. 평소에는 id만 세어 보고(본문을 읽지 않는다),
 * 남길 수보다 많아졌거나 이 탭에서 아직 기간 지난 것을 훑지 않았을 때만 읽는다
 */
export function needsSweep(keyCount: number, swept: boolean): boolean {
  return !swept || keyCount > KEEP_WORKS;
}

/** 작업을 적는다. 오래된 것은 같이 정리한다. 실패해도 편집에는 지장 없고, 까닭을 돌려준다 */
export async function saveWork(record: WorkRecord): Promise<WorkSaveResult> {
  try {
    if (!askedPersist) {
      askedPersist = true;
      // 공간이 모자랄 때 브라우저가 먼저 지우지 않도록 요청한다 (거절돼도 저장은 된다)
      void navigator.storage?.persist?.().catch(() => {});
    }
    let swept = false;
    await run("readwrite", (s) => {
      s.put(record);
      // 같은 트랜잭션에서 남길 것만 남긴다. 먼저 id만 세고, 넘칠 때만 본문까지 읽는다
      const keys = s.getAllKeys();
      keys.onsuccess = () => {
        if (!needsSweep(keys.result.length, sweptOnce)) return;
        const all = s.getAll() as IDBRequest<WorkRecord[]>;
        all.onsuccess = () => {
          for (const id of staleWorks(all.result, record.id, Date.now())) s.delete(id);
          swept = true;
        };
      };
    });
    if (swept) sweptOnce = true;
    dropStash(record.id, record.savedAt);
    return "saved";
  } catch (e) {
    return isQuotaError(e) ? "quota" : "failed";
  }
}

/** 남아 있는 작업 (최근 것부터, 곡 내용 없이) */
export async function listWorks(): Promise<WorkSummary[]> {
  try {
    const all = (await run<WorkRecord[]>("readonly", (s) => s.getAll() as IDBRequest<WorkRecord[]>)) ?? [];
    return all
      .sort((a, b) => b.savedAt - a.savedAt)
      .map(({ id, savedAt, fileName, title, trackCount, noteCount }) => ({ id, savedAt, fileName, title, trackCount, noteCount }));
  } catch {
    return [];
  }
}

export async function loadWork(id: string): Promise<WorkRecord | undefined> {
  try {
    return await run<WorkRecord>("readonly", (s) => s.get(id) as IDBRequest<WorkRecord>);
  } catch {
    return undefined;
  }
}

export async function forgetWork(id: string): Promise<void> {
  dropStash(id);
  try {
    await run("readwrite", (s) => s.delete(id));
  } catch {
    // 무시
  }
}

/**
 * 급히 적어 두는 자리. 새로고침·탭 닫기로 문서가 내려갈 때는 IndexedDB를 여는 동안 문서가 사라져
 * 방금 고친 것(자동 보존이 쉬는 1.5초 안의 편집)이 적히지 못한다. 그때는 곧바로 끝나는 localStorage에 적어 두고,
 * 다음에 앱을 열 때 자동 보존 저장소로 옮긴다(adoptStashedWorks). 작업마다 하나씩, 저장소로 옮겨지거나
 * 더 새 기록이 적히면 지운다
 */
const STASH_PREFIX = "mmlce-work-stash:";

function defaultStash(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    // 저장소가 막힌 브라우저 (사생활 보호 설정 등)
    return undefined;
  }
}

/** 작업을 급히 적어 둔다 (기다리지 않는다). 적었으면 true. 공간이 모자라거나 막혀 있으면 false */
export function stashWork(record: WorkRecord, stash: Pick<Storage, "setItem"> | undefined = defaultStash()): boolean {
  try {
    if (!stash) return false;
    stash.setItem(STASH_PREFIX + record.id, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** 급히 적어 둔 것을 지운다. upTo를 주면 그 시각까지의 것만 (더 나중에 급히 적은 것은 아직 저장소에 없다) */
function dropStash(id: string, upTo?: number, stash: Pick<Storage, "getItem" | "removeItem"> | undefined = defaultStash()): void {
  try {
    if (!stash) return;
    const key = STASH_PREFIX + id;
    if (upTo !== undefined) {
      const text = stash.getItem(key);
      if (text === null) return;
      const at = stashedRecord(text)?.savedAt;
      if (at !== undefined && at > upTo) return;
    }
    stash.removeItem(key);
  } catch {
    // 무시
  }
}

function stashedRecord(text: string): WorkRecord | undefined {
  try {
    const r = JSON.parse(text) as Partial<WorkRecord> | null;
    if (!r || typeof r.id !== "string" || typeof r.project !== "string" || typeof r.savedAt !== "number" || !Number.isFinite(r.savedAt)) return undefined;
    return {
      id: r.id,
      savedAt: r.savedAt,
      fileName: typeof r.fileName === "string" ? r.fileName : "",
      title: typeof r.title === "string" ? r.title : "",
      trackCount: typeof r.trackCount === "number" ? r.trackCount : 0,
      noteCount: typeof r.noteCount === "number" ? r.noteCount : 0,
      project: r.project,
    };
  } catch {
    return undefined;
  }
}

/**
 * 급히 적어 둔 작업을 자동 보존 저장소로 옮긴다. 저장소에 같은 작업의 더 새 기록이 있으면 버린다
 * (문서가 내려가기 전에 저장이 끝났거나, 그 탭이 살아남아 더 고친 경우). 옮긴 수를 돌려준다.
 * 저장소에 적지 못한 것과, 옮기는 사이 다른 탭이 더 새로 적은 것은 남겨 두어 다음에 다시 옮긴다
 */
export async function adoptStashedWorks(stash: Pick<Storage, "length" | "key" | "getItem" | "removeItem"> | undefined = defaultStash()): Promise<number> {
  if (!stash) return 0;
  const keys: string[] = [];
  try {
    for (let i = 0; i < stash.length; i++) {
      const key = stash.key(i);
      if (key?.startsWith(STASH_PREFIX)) keys.push(key);
    }
  } catch {
    return 0;
  }
  let adopted = 0;
  for (const key of keys) {
    let record: WorkRecord | undefined;
    let text: string | null;
    try {
      text = stash.getItem(key);
      record = text === null ? undefined : stashedRecord(text);
    } catch {
      continue;
    }
    if (record && key === STASH_PREFIX + record.id) {
      const rec = record;
      let wrote = false;
      try {
        // 견주기와 적기를 한 트랜잭션에서 한다 (그사이 다른 탭이 더 새 기록을 적어도 덮지 않게)
        await run("readwrite", (s) => {
          const had = s.get(rec.id) as IDBRequest<WorkRecord | undefined>;
          had.onsuccess = () => {
            if (had.result && had.result.savedAt >= rec.savedAt) return;
            s.put(rec);
            wrote = true;
          };
        });
      } catch {
        continue;
      }
      if (wrote) adopted++;
    }
    try {
      // 방금 읽은 그 글일 때만 지운다. 저장소에 적는 것을 기다리는 사이, 그 작업을 고치고 있는 다른 탭이
      // 더 새것을 급히 적었을 수 있다. 그것까지 지우면 그 탭이 저장을 끝내기 전에 닫힐 때 고친 것이 사라진다
      if (stash.getItem(key) === text) stash.removeItem(key);
    } catch {
      // 무시
    }
  }
  return adopted;
}
