/**
 * 작업 자동 보존: 고치던 곡을 이 브라우저(IndexedDB)에 수시로 적어 두고,
 * 새로고침·탭 닫기·브라우저 종료 뒤 첫 화면에서 되살릴 수 있게 한다.
 * 이 브라우저 안에서만 쓰는 임시 복구용이다. 오래 보관하려면 프로젝트 파일로 저장한다.
 * 사운드팩 저장(packStore)과는 다른 저장소를 쓴다. 저장소를 못 쓰면 조용히 아무것도 하지 않는다.
 */

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
      tx.onerror = () => reject(tx.error);
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

/** 작업을 적는다. 오래된 것은 같이 정리한다. 실패해도 편집에는 지장 없다 */
export async function saveWork(record: WorkRecord): Promise<boolean> {
  try {
    if (!askedPersist) {
      askedPersist = true;
      // 공간이 모자랄 때 브라우저가 먼저 지우지 않도록 요청한다 (거절돼도 저장은 된다)
      void navigator.storage?.persist?.().catch(() => {});
    }
    await run("readwrite", (s) => {
      s.put(record);
      // 같은 트랜잭션에서 남길 것만 남긴다
      const all = s.getAll() as IDBRequest<WorkRecord[]>;
      all.onsuccess = () => {
        const now = Date.now();
        const sorted = all.result.sort((a, b) => b.savedAt - a.savedAt);
        sorted.forEach((w, i) => {
          if (w.id !== record.id && (i >= KEEP_WORKS || now - w.savedAt > KEEP_MS)) s.delete(w.id);
        });
      };
    });
    return true;
  } catch {
    return false;
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
  try {
    await run("readwrite", (s) => s.delete(id));
  } catch {
    // 무시
  }
}
