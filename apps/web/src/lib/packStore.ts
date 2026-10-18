/**
 * 사운드팩을 이 브라우저(IndexedDB)에 저장해 두고, 다음에 열 때 자동으로 다시 불러온다.
 * 파일은 사용자 컴퓨터 안에만 남고 어디로도 보내지 않는다. 빼기를 누르면 저장한 것도 지운다.
 * 저장소를 쓸 수 없는 환경(사생활 보호 창 등)에서는 조용히 아무것도 하지 않는다.
 */

const DB_NAME = "mmlce";
const STORE = "packs";

export interface StoredPack {
  /** 파일 이름 (같은 이름을 다시 올리면 덮어쓴다) */
  readonly name: string;
  readonly data: Blob;
  /** 올린 순서 (위에 있는 팩이 우선이므로 순서를 지킨다) */
  readonly order: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "name" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = body(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 쓰기 트랜잭션 하나 안에서 여러 요청을 한다. 트랜잭션이 끝까지 성공해야 끝난다 */
async function runTx(body: (store: IDBObjectStore) => void): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      body(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 저장해 둔 팩 (올린 순서대로) */
export async function loadPacks(): Promise<StoredPack[]> {
  try {
    const all = await run<StoredPack[]>("readonly", (s) => s.getAll() as IDBRequest<StoredPack[]>);
    return all.sort((a, b) => a.order - b.order);
  } catch {
    return [];
  }
}

/** 저장에 성공하면 true. 못 해도 이번 사용에는 지장 없다 */
export async function savePack(file: File): Promise<boolean> {
  try {
    // 브라우저가 공간이 모자랄 때 지우지 않도록 오래 두기를 요청한다 (거절돼도 저장은 된다)
    void navigator.storage?.persist?.().catch(() => {});
    // 읽기와 쓰기를 한 트랜잭션에서 해 다른 저장·삭제와 엇갈리지 않게 한다
    await runTx((s) => {
      const req = s.openCursor();
      let last = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          last = Math.max(last, (cursor.value as StoredPack).order);
          cursor.continue();
          return;
        }
        // 새 팩은 지금 맨 아래 다음. 같은 이름을 다시 올려도 맨 아래로 간다
        // (앱도 옛 팩을 빼고 새 팩을 맨 아래에 끼우므로, 다음에 열 때도 같은 순서가 되게)
        s.put({ name: file.name, data: file, order: last + 1 } satisfies StoredPack);
      };
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 우선순위를 바꾼 순서대로 저장해 다음에 열 때도 같은 순서로 불러온다.
 * 목록에 없는 팩(다른 탭에서 그사이 올린 팩 등)은 원래 순서를 지킨 채 목록 뒤에 서로 다른 순번을 받는다
 */
export async function savePackOrder(names: readonly string[]): Promise<void> {
  try {
    // 읽기와 쓰기를 한 트랜잭션에서 해, 그사이 뺀 팩을 옛 데이터로 되살리거나 다시 올린 팩을 덮지 않는다
    await runTx((s) => {
      const req = s.openCursor();
      const all: StoredPack[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          all.push(cursor.value as StoredPack);
          cursor.continue();
          return;
        }
        const listed = all.filter((p) => names.includes(p.name));
        // 목록에 없는 팩은 원래 순서대로 뒤에 (커서가 이름 순으로 돌므로 같은 순번끼리는 이름 순이 된다)
        const rest = all.filter((p) => !names.includes(p.name)).sort((a, b) => a.order - b.order);
        const next = new Map<StoredPack, number>([
          ...listed.map((p): [StoredPack, number] => [p, names.indexOf(p.name)]),
          ...rest.map((p, i): [StoredPack, number] => [p, names.length + i]),
        ]);
        for (const [pack, order] of next) if (pack.order !== order) s.put({ ...pack, order } satisfies StoredPack);
      };
    });
  } catch {
    // 무시. 이번 사용에는 지장 없다
  }
}

export async function forgetPack(name: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(name));
  } catch {
    // 무시
  }
}
