import { loadStored, saveStored } from "./persist";
import { SaveStartup, type SaveMode } from "./saveStartup";
import { freeName } from "./saveName";
import { saveProjectFile, type SavedFile, type SaveOutcome } from "./projectSave";
import type { WorkFile } from "./workFile";

export type { SavedFile, SaveOutcome };

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

/** 파일 핸들의 권한 묻기 (표준 DOM 타입에 아직 없다) */
interface FileHandle extends FileSystemFileHandle {
  queryPermission?(desc: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(desc: { mode: "readwrite" }): Promise<PermissionState>;
}

type OpenPicker = (options?: {
  id?: string;
  multiple?: false;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle[]>;

type FilePicker = (options?: {
  id?: string;
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

const picker = (): DirPicker | undefined => (globalThis as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
const filePicker = (): FilePicker | undefined => (globalThis as { showSaveFilePicker?: FilePicker }).showSaveFilePicker;
const openPicker = (): OpenPicker | undefined => (globalThis as { showOpenFilePicker?: OpenPicker }).showOpenFilePicker;

const secure = typeof window !== "undefined" && window.isSecureContext;

/** 폴더를 고를 수 있는 브라우저인지 (iPad·Safari·Firefox는 아니다) */
export const canPickFolder = secure && typeof picker() === "function";

/** 저장 창(폴더와 파일 이름 고르기)을 띄울 수 있는 브라우저인지 (PC 크롬·엣지) */
export const canAskSave = secure && typeof filePicker() === "function";

/** 연 파일을 기억해 다시 쓸 수 있게 여는 창을 띄울 수 있는지 (PC 크롬·엣지) */
export const canOpenFile = secure && typeof openPicker() === "function";

export type { SaveMode };

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

/** 시작할 때 예전 폴더 읽기와 저장 방식 고르기·저장의 순서 */
const startup = new SaveStartup(saveTarget, storedMode);
/** 저장 전에 예전 폴더 읽기를 기다리는 최대 시간. 저장 창은 누른 직후 몇 초 안에만 뜬다 */
const LOAD_WAIT_MS = 1000;

const DB_NAME = "mmlce-save";
const STORE = "folder";
const KEY = "dir";
/** 작업(자동 보존 기록) id별로 기억한 프로젝트 파일 */
const PROJECT_STORE = "project";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      if (!req.result.objectStoreNames.contains(PROJECT_STORE)) req.result.createObjectStore(PROJECT_STORE);
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

/** 이 브라우저가 저장한 파일 이름을 알 수 있는지 (폴더·저장 창·열기 창) */
const knowsSavedName = canPickFolder || canAskSave || canOpenFile;

/**
 * 작업에 저장한 파일 이름과 (다시 쓸 수 있으면) 그 파일을 적어 둔다 (undefined면 잊는다).
 * 새로고침 뒤 복구한 곡도 그 파일에 바로 쓰고, 자동 보존 기록의 이름이 늦었는지 견줄 수 있게
 */
export async function rememberProjectFile(workId: string, entry: WorkFile<FileSystemFileHandle> | undefined): Promise<void> {
  if (!knowsSavedName) return;
  const d = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(PROJECT_STORE, "readwrite");
      const s = tx.objectStore(PROJECT_STORE);
      if (entry) s.put(entry.file ? { name: entry.name, file: entry.file } : { name: entry.name }, workId);
      else s.delete(workId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    d.close();
  }
}

/** 작업에 적어 둔 저장 이름과 파일. 없으면 undefined, 읽지 못하면 "unknown" (믿을 수 없다) */
export async function recallProjectFile(workId: string): Promise<WorkFile<FileSystemFileHandle> | "unknown" | undefined> {
  if (!knowsSavedName) return undefined;
  try {
    const d = await db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = d.transaction(PROJECT_STORE, "readonly");
        const req = tx.objectStore(PROJECT_STORE).get(workId);
        tx.oncomplete = () => resolve(readWorkFile(req.result));
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      d.close();
    }
  } catch {
    return "unknown";
  }
}

function readWorkFile(raw: unknown): WorkFile<FileSystemFileHandle> | "unknown" | undefined {
  if (raw === undefined) return undefined;
  // 이름 없이 파일만 적던 판(beta.20 개발 중)
  if (raw instanceof FileSystemFileHandle) return { name: raw.name, file: raw };
  const r = raw as { name?: unknown; file?: unknown };
  if (typeof r.name !== "string") return "unknown";
  return r.file instanceof FileSystemFileHandle ? { name: r.name, file: r.file } : { name: r.name };
}

/**
 * 시작할 때 기억해 둔 폴더를 읽어 둔다 (저장 때 바로 권한을 물을 수 있게).
 * 저장 창이 생기기 전에 폴더를 정해 둔 사람은 그대로 그 폴더에 저장한다. 읽는 사이 설정에서 방식을 바꿨으면 그 선택을 따른다
 */
export function loadSaveTarget(): Promise<void> {
  if (!canPickFolder) return Promise.resolve();
  return startup.load(async () => {
    handle = await store(undefined);
    saveTarget.folder = handle?.name;
    return !!handle;
  });
}

/** 저장 방식을 바꾼다 (시작할 때 예전 폴더 설정으로 덮지 않는다) */
export function setSaveMode(mode: SaveMode): void {
  startup.choose(mode);
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

/** 기억한 파일에 쓴다. 쓰기 허락이 없으면 먼저 묻는다 (연 파일은 처음 저장할 때 한 번 묻는다) */
async function writeFileAsked(file: FileHandle, bytes: Uint8Array): Promise<boolean> {
  try {
    const mode = { mode: "readwrite" } as const;
    if (file.queryPermission && (await file.queryPermission(mode)) !== "granted" && (await file.requestPermission?.(mode)) !== "granted") return false;
  } catch {
    return false;
  }
  return writeFile(file, bytes);
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

/** 폴더에 그 이름의 항목이 있는지. 없다고 확인될 때(NotFoundError)만 false (다른 오류는 있다고 보고 피한다) */
async function inFolder(dir: DirHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (e) {
    return !(e instanceof DOMException && e.name === "NotFoundError");
  }
}

/**
 * 폴더에 쓴다. fresh(이름 없는 새 악보)이면 같은 이름을 피해 `이름 2.확장자`처럼 새 이름을 고른다.
 * 쓴 이름, 비어 있는 이름이 없으면 "full", 못 썼으면 undefined
 */
async function writeToFolder(dir: DirHandle, bytes: Uint8Array, name: string, fresh: boolean): Promise<string | "full" | undefined> {
  try {
    const mode = { mode: "readwrite" } as const;
    if ((await dir.queryPermission?.(mode)) !== "granted" && (await dir.requestPermission?.(mode)) !== "granted") return undefined;
    const ext = /\.[^.]+$/.exec(name)?.[0] ?? "";
    const target = fresh ? await freeName(name.slice(0, name.length - ext.length), ext, (n) => inFolder(dir, n)) : name;
    if (target === undefined) return "full";
    return (await writeFile(await dir.getFileHandle(target, { create: true }), bytes)) ? target : undefined;
  } catch {
    return undefined;
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
async function askSaveFile(name: string, always = false): Promise<{ file: FileSystemFileHandle | undefined } | "cancelled" | undefined> {
  const pick = filePicker();
  if (!pick || !(always ? canAskSave : asksSaveDialog())) return undefined;
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
 * 고른 저장 위치에 파일을 저장한다. 안 되면 다운로드로 저장한다.
 * 저장 창을 띄울 수 있으므로 단추나 단축키를 누른 직후에 부른다.
 * fresh: 이름 없는 새 악보. 폴더에 저장할 때 같은 이름 파일을 덮어쓰지 않고 새 이름을 고른다.
 */
export async function saveFile(bytes: Uint8Array, name: string, options: { fresh?: boolean } = {}): Promise<SavedFile> {
  // 시작 직후면 예전 폴더 읽기가 끝나기를 기다린 뒤 방식을 고른다 (읽기 전 기본값 ask로 저장 창이 뜨지 않게)
  if (!(await startup.ready(LOAD_WAIT_MS))) return { outcome: "retry" };
  const chosen = await askSaveFile(name);
  if (chosen === "cancelled") return { outcome: "cancelled" };
  if (chosen) {
    if (chosen.file) {
      if (await writeFile(chosen.file, bytes)) return { outcome: "written", name: chosen.file.name, file: chosen.file };
      download(bytes, name);
      return { outcome: "rescued" };
    }
  } else if (saveTarget.mode === "folder" && canPickFolder && handle) {
    const written = await writeToFolder(handle, bytes, name, options.fresh ?? false);
    // 같은 이름이 상한까지 다 있으면 덮어쓰지도, 다운로드로 돌리지도 않고 멈춰 알린다
    if (written === "full") return { outcome: "full" };
    if (written) return { outcome: "written", name: written };
  } else if (canShareFiles && saveTarget.share) {
    const shared = await shareFile(bytes, name);
    if (shared) return { outcome: shared };
  }
  download(bytes, name);
  return { outcome: "downloaded" };
}

/**
 * 프로젝트(.mme)를 저장한다. file: 지금 곡의 기억한 프로젝트 파일, saveAs: 다른 이름으로 저장 (언제나 저장 창).
 * 기억한 파일이 있고 저장 방식이 "저장할 때마다 고르기"면 창 없이 그 파일에 바로 쓴다.
 * 바로 쓰지 못하면 저장 창, 그것도 못 띄우면 다운로드로 저장한다 (directFailed로 알린다)
 */
export async function saveProject(
  bytes: Uint8Array,
  name: string,
  o: { file: FileSystemFileHandle | undefined; saveAs: boolean; fresh: boolean },
): Promise<SavedFile> {
  if (!(await startup.ready(LOAD_WAIT_MS))) return { outcome: "retry" };
  return saveProjectFile(bytes, name, { file: o.file, saveAs: o.saveAs, asks: asksSaveDialog(), canAsk: canAskSave }, {
    write: writeFileAsked,
    ask: async (n) => (await askSaveFile(n, true)) ?? { file: undefined },
    target: (b, n) => saveFile(b, n, { fresh: o.fresh }),
    download,
    nameOf: (f) => f.name,
  });
}

/**
 * 열기 창으로 악보를 고른다. 고른 파일과 그 핸들, 닫았으면 "cancelled", 띄우지 못했으면 undefined
 * (그때는 <input type="file">로 연다)
 */
export async function pickOpenFile(extensions: readonly string[]): Promise<{ file: File; handle: FileSystemFileHandle } | "cancelled" | undefined> {
  const pick = openPicker();
  if (!pick || !canOpenFile) return undefined;
  try {
    const [handle] = await pick({ id: "binote-open", types: [{ description: "BiNote", accept: { "application/octet-stream": [...extensions] } }] });
    if (!handle) return "cancelled";
    return { file: await handle.getFile(), handle };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    return undefined;
  }
}
