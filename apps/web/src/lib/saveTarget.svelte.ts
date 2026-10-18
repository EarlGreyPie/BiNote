import { loadStored, saveStored } from "./persist";

/**
 * 저장 위치. 기본은 브라우저 다운로드(다운로드 폴더)이고,
 * - PC 크롬·엣지처럼 저장 창을 띄울 수 있는 브라우저는 저장할 때마다 저장 창에서 폴더와 파일 이름을 고른다(기본).
 *   설정에서 "정해 둔 폴더"를 고르면 그 폴더를 이 브라우저(IndexedDB)에 기억해 두고 묻지 않고 바로 쓴다.
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

type FilePicker = (options?: {
  id?: string;
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

const picker = (): DirPicker | undefined => (globalThis as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
const filePicker = (): FilePicker | undefined => (globalThis as { showSaveFilePicker?: FilePicker }).showSaveFilePicker;

const secure = typeof window !== "undefined" && window.isSecureContext;

/** 폴더를 고를 수 있는 브라우저인지 (iPad·Safari·Firefox는 아니다) */
export const canPickFolder = secure && typeof picker() === "function";

/** 저장 창(폴더와 파일 이름 고르기)을 띄울 수 있는 브라우저인지 (PC 크롬·엣지) */
export const canAskSave = secure && typeof filePicker() === "function";

/** ask: 저장할 때마다 저장 창에서 고른다, folder: 정해 둔 폴더에 바로 쓴다, download: 다운로드 폴더 */
export type SaveMode = "ask" | "folder" | "download";

/** 파일을 공유 창으로 넘길 수 있는지 (iPad·iPhone의 "파일에 저장") */
export const canShareFiles = (() => {
  try {
    return typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File(["x"], "x.txt", { type: "text/plain" })] });
  } catch {
    return false;
  }
})();

const SHARE_KEY = "mmlce.saveShare";
const MODE_KEY = "mmlce.saveMode";

/** 기억해 둔 저장 방식. 처음이면 undefined (정해 둔 폴더가 있으면 folder, 없으면 ask로 시작한다) */
const storedMode = loadStored<SaveMode | undefined>(MODE_KEY, (raw) => (raw === "ask" || raw === "folder" || raw === "download" ? raw : undefined));

export const saveTarget = $state<{ folder: string | undefined; share: boolean; mode: SaveMode }>({
  folder: undefined,
  share: loadStored(SHARE_KEY, (raw) => (raw === null ? !canPickFolder : raw === "1")),
  mode: storedMode ?? (canAskSave ? "ask" : "download"),
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

/** 시작할 때 기억해 둔 폴더를 읽어 둔다 (저장 때 바로 권한을 물을 수 있게) */
export async function loadSaveTarget(): Promise<void> {
  if (!canPickFolder) return;
  try {
    handle = await store(undefined);
    saveTarget.folder = handle?.name;
    // 저장 창이 생기기 전에 폴더를 정해 둔 사람은 그대로 그 폴더에 저장한다.
    // 읽는 사이 설정에서 방식을 바꿨으면 그 선택을 따른다
    if (storedMode === undefined && !modeChosen && handle) saveTarget.mode = "folder";
  } catch {
    // 저장소를 못 쓰면 다운로드로 저장한다
  }
}

/** 이번 창에서 사용자가 저장 방식을 골랐는지 (시작할 때 예전 폴더 설정으로 덮지 않게) */
let modeChosen = false;

/** 저장 방식을 바꾼다 */
export function setSaveMode(mode: SaveMode): void {
  modeChosen = true;
  saveTarget.mode = mode;
  saveStored(MODE_KEY, mode);
}

/** 저장 폴더를 고르고 그 폴더에 바로 저장하게 한다. 고르지 않고 닫으면 그대로 둔다 */
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
  setSaveMode("folder");
  try {
    await store(dir);
  } catch {
    // 기억 못 해도 이번 창에서는 그 폴더에 저장한다
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

async function writeFile(file: FileSystemFileHandle, bytes: Uint8Array): Promise<boolean> {
  try {
    const out = await file.createWritable();
    await out.write(bytes as BlobPart);
    await out.close();
    return true;
  } catch {
    return false;
  }
}

async function writeToFolder(dir: DirHandle, bytes: Uint8Array, name: string): Promise<boolean> {
  try {
    const mode = { mode: "readwrite" } as const;
    if ((await dir.queryPermission?.(mode)) !== "granted" && (await dir.requestPermission?.(mode)) !== "granted") return false;
    return await writeFile(await dir.getFileHandle(name, { create: true }), bytes);
  } catch {
    return false;
  }
}

/** 저장할 때 저장 창을 띄우는 설정인지 */
export function asksSaveDialog(): boolean {
  return canAskSave && saveTarget.mode === "ask";
}

/**
 * "저장할 때마다 고르기"이면 저장 창을 띄워 폴더와 파일 이름을 고르게 한다.
 * 묻지 않는 설정이면 undefined, 저장 창을 닫았으면 "cancelled", 띄우지 못했으면 file이 없다.
 * 저장 창에서 있는 파일을 고르면 브라우저가 그 파일을 먼저 비운다. 그래서 저장할 내용을 다 만든 뒤에 불러 곧바로 쓴다
 * (오래 걸리는 WAV는 다 만든 뒤 저장 단추로 부른다. 저장 창은 누른 직후에만 뜬다).
 */
async function askSaveFile(name: string): Promise<{ file: FileSystemFileHandle | undefined } | "cancelled" | undefined> {
  const pick = filePicker();
  if (!pick || !asksSaveDialog()) return undefined;
  const ext = /\.[A-Za-z0-9]+$/.exec(name)?.[0];
  try {
    const file = await pick({
      id: "binote-save-as",
      suggestedName: name,
      ...(ext ? { types: [{ description: ext.slice(1).toUpperCase(), accept: { "application/octet-stream": [ext] } }] } : {}),
    });
    return { file };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    // 띄우지 못했다(누른 지 오래됨 등): 다운로드로 저장한다
    return { file: undefined };
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
 * cancelled: 저장 창·공유 창을 닫았다, downloaded: 다운로드를 시작했다 (끝났는지는 알 수 없다),
 * rescued: 저장 창에서 고른 파일에 쓰지 못해 다운로드로 저장했다 (브라우저가 고른 파일을 먼저 비우므로 그 파일은 비었을 수 있다)
 */
export type SaveOutcome = "written" | "shared" | "cancelled" | "downloaded" | "rescued";

/**
 * 고른 저장 위치에 파일을 저장한다. 안 되면 다운로드로 저장한다.
 * 저장 창을 띄울 수 있으므로 단추나 단축키를 누른 직후에 부른다.
 */
export async function saveFile(bytes: Uint8Array, name: string): Promise<SaveOutcome> {
  const chosen = await askSaveFile(name);
  if (chosen === "cancelled") return "cancelled";
  if (chosen) {
    if (chosen.file) {
      if (await writeFile(chosen.file, bytes)) return "written";
      download(bytes, name);
      return "rescued";
    }
  } else if (saveTarget.mode === "folder" && canPickFolder && handle) {
    if (await writeToFolder(handle, bytes, name)) return "written";
  } else if (canShareFiles && saveTarget.share) {
    const shared = await shareFile(bytes, name);
    if (shared) return shared;
  }
  download(bytes, name);
  return "downloaded";
}
