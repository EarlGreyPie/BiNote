import { loadStored, saveStored } from "./persist";

/**
 * 저장 위치. 기본은 브라우저 다운로드(다운로드 폴더)이고,
 * - PC 크롬·엣지처럼 폴더를 고를 수 있는 브라우저는 고른 폴더를 이 브라우저(IndexedDB)에 기억해 두고 그 폴더에 바로 쓴다.
 *   같은 이름 파일이 있으면 덮어쓴다. 쓸 수 없으면(허락 안 함, 폴더가 사라짐 등) 다운로드로 저장한다.
 * - 아이패드·아이폰처럼 폴더는 못 고르고 파일 공유는 되는 브라우저는 공유 창으로 저장한다(기본 켬, 설정에서 끈다).
 *   공유 창에서 "파일에 저장"으로 폴더를 고르거나 구글 드라이브 같은 앱으로 바로 보낸다.
 *   공유 창을 띄울 수 없으면(오래 걸린 WAV 등) 다운로드로 저장한다.
 */

/** 표준 DOM 타입에 아직 없는 폴더 고르기·권한 묻기 */
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission?(desc: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(desc: { mode: "readwrite" }): Promise<PermissionState>;
}
type DirPicker = (options?: { id?: string; mode?: "readwrite" }) => Promise<DirHandle>;

const picker = (): DirPicker | undefined => (globalThis as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;

/** 폴더를 고를 수 있는 브라우저인지 (iPad·Safari·Firefox는 아니다) */
export const canPickFolder = typeof window !== "undefined" && window.isSecureContext && typeof picker() === "function";

/** 파일을 공유 창으로 넘길 수 있는지 (iPad·iPhone의 "파일에 저장") */
export const canShareFiles = (() => {
  try {
    return typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File(["x"], "x.txt", { type: "text/plain" })] });
  } catch {
    return false;
  }
})();

const SHARE_KEY = "mmlce.saveShare";

export const saveTarget = $state<{ folder: string | undefined; share: boolean }>({
  folder: undefined,
  share: loadStored(SHARE_KEY, (raw) => (raw === null ? !canPickFolder : raw === "1")),
});

let handle: DirHandle | undefined;

const DB_NAME = "mmlce-save";
const STORE = "folder";
const KEY = "dir";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(value: DirHandle | undefined): Promise<DirHandle | undefined> {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, value === undefined ? "readonly" : "readwrite");
      const s = tx.objectStore(STORE);
      const req = value === undefined ? s.get(KEY) : s.put(value, KEY);
      tx.oncomplete = () => resolve(value ?? (req.result as DirHandle | undefined));
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    d.close();
  }
}

async function forget(): Promise<void> {
  const d = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    d.close();
  }
}

/** 시작할 때 기억해 둔 폴더를 읽어 둔다 (저장 때 바로 권한을 물을 수 있게) */
export async function loadSaveTarget(): Promise<void> {
  if (!canPickFolder) return;
  try {
    handle = await store(undefined);
    saveTarget.folder = handle?.name;
  } catch {
    // 저장소를 못 쓰면 다운로드로 저장한다
  }
}

/** 저장 폴더 고르기. 고르지 않고 닫으면 그대로 둔다 */
export async function pickSaveFolder(): Promise<void> {
  const pick = picker();
  if (!pick) return;
  let dir: DirHandle;
  try {
    dir = await pick({ id: "binote-save", mode: "readwrite" });
  } catch {
    return;
  }
  handle = dir;
  saveTarget.folder = dir.name;
  try {
    await store(dir);
  } catch {
    // 기억 못 해도 이번 창에서는 그 폴더에 저장한다
  }
}

/** 다운로드 폴더로 되돌린다 */
export async function clearSaveFolder(): Promise<void> {
  handle = undefined;
  saveTarget.folder = undefined;
  try {
    await forget();
  } catch {
    // 지우지 못해도 이번 창에서는 다운로드로 저장한다
  }
}

export function setSaveShare(on: boolean): void {
  saveTarget.share = on;
  saveStored(SHARE_KEY, on ? "1" : "0");
}

/** 브라우저 다운로드로 저장한다 */
export function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function writeToFolder(dir: DirHandle, bytes: Uint8Array, name: string): Promise<boolean> {
  try {
    const mode = { mode: "readwrite" } as const;
    if ((await dir.queryPermission?.(mode)) !== "granted" && (await dir.requestPermission?.(mode)) !== "granted") return false;
    const file = await dir.getFileHandle(name, { create: true });
    const out = await file.createWritable();
    await out.write(bytes as BlobPart);
    await out.close();
    return true;
  } catch {
    return false;
  }
}

/** 공유 창으로 넘긴다. 보냈으면 shared, 사용자가 닫았으면 cancelled(다시 내려받지 않는다), 띄우지 못했으면 undefined */
async function shareFile(bytes: Uint8Array, name: string): Promise<"shared" | "cancelled" | undefined> {
  try {
    const file = new File([bytes as BlobPart], name, { type: "application/octet-stream" });
    if (!navigator.canShare({ files: [file] })) return undefined;
    await navigator.share({ files: [file] });
    return "shared";
  } catch (e) {
    return e instanceof DOMException && e.name === "AbortError" ? "cancelled" : undefined;
  }
}

/**
 * 저장한 결과. written: 고른 폴더에 썼다, shared: 공유 창에서 보냈다 (둘 다 저장을 확인한 것),
 * cancelled: 공유 창을 닫았다, downloaded: 다운로드를 시작했다 (끝났는지는 알 수 없다)
 */
export type SaveOutcome = "written" | "shared" | "cancelled" | "downloaded";

/** 고른 저장 위치에 파일을 저장한다. 안 되면 다운로드로 저장한다 */
export async function saveFile(bytes: Uint8Array, name: string): Promise<SaveOutcome> {
  if (canPickFolder && handle) {
    if (await writeToFolder(handle, bytes, name)) return "written";
  } else if (canShareFiles && saveTarget.share) {
    const shared = await shareFile(bytes, name);
    if (shared) return shared;
  }
  download(bytes, name);
  return "downloaded";
}
