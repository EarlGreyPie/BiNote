/**
 * 프로젝트(.mme) 저장의 길 고르기. 일반 데스크톱 앱의 저장 / 다른 이름으로 저장과 같게,
 * 저장 창으로 저장했거나 열기로 연 프로젝트 파일은 다음 저장에서 창 없이 그 파일에 바로 쓴다.
 * 바로 쓰지 못하면 언제나 저장 창 → 다운로드로 물러난다 (조용히 건너뛰지 않는다).
 */

/**
 * 저장한 결과. written: 고른 폴더·파일에 썼다, shared: 공유 창에서 보냈다 (둘 다 저장을 확인한 것),
 * cancelled: 저장 창·공유 창을 닫았다, downloaded: 다운로드를 시작했다 (끝났는지는 알 수 없다),
 * rescued: 저장 창에서 고른 파일에 쓰지 못해 다운로드로 저장했다 (브라우저가 고른 파일을 먼저 비우므로 그 파일은 비었을 수 있다),
 * retry: 시작할 때 예전 폴더를 아직 읽는 중이라 저장하지 않았다 (잠시 뒤 다시 저장하게 알린다),
 * full: 폴더에 같은 이름(`이름 2` … 상한까지)이 다 있어 저장하지 않았다 (있는 파일을 덮어쓰지 않는다)
 */
export type SaveOutcome = "written" | "shared" | "cancelled" | "downloaded" | "rescued" | "retry" | "full";

/**
 * 저장 결과와, 실제로 쓴 파일 이름을 알면 그 이름 (폴더·파일에 썼을 때만. 다운로드·공유는 알 수 없다).
 * file: 저장 창으로 고르거나 바로 쓴 파일 (다음 저장에서 바로 쓸 수 있다).
 * directFailed: 기억한 파일에 바로 쓰지 못해 다른 길로 물러났다 (그 파일은 버린다)
 */
export interface SavedFile<H = FileSystemFileHandle> {
  outcome: SaveOutcome;
  name?: string;
  file?: H;
  directFailed?: boolean;
}

/** direct: 기억한 파일에 바로 쓴다, dialog: 저장 창을 띄운다, target: 설정한 저장 방식대로 */
export type ProjectRoute = "direct" | "dialog" | "target";

/**
 * 프로젝트 저장의 길.
 * - 다른 이름으로 저장: 저장 창을 띄울 수 있으면 언제나 저장 창
 * - 기억한 파일이 있고 저장 방식이 "저장할 때마다 고르기"면 바로 쓰기 (폴더·다운로드 방식은 그대로 둔다)
 * - 그 밖에는 저장 방식대로
 */
export function projectRoute(o: { hasFile: boolean; saveAs: boolean; asks: boolean; canAsk: boolean }): ProjectRoute {
  if (o.saveAs && o.canAsk) return "dialog";
  if (o.hasFile && o.asks) return "direct";
  return "target";
}

export interface ProjectSaveDeps<H> {
  /** 파일에 바로 쓴다 (쓰기 허락을 먼저 묻는다). 썼으면 true */
  write(file: H, bytes: Uint8Array): Promise<boolean>;
  /** 저장 창을 띄운다. 닫았으면 "cancelled", 띄우지 못했으면 file이 없다 */
  ask(name: string): Promise<{ file: H | undefined } | "cancelled">;
  /** 설정한 저장 방식대로 저장한다 */
  target(bytes: Uint8Array, name: string): Promise<SavedFile<H>>;
  download(bytes: Uint8Array, name: string): void;
  nameOf(file: H): string;
}

/** 저장 창으로 저장한다. 창을 못 띄우거나 고른 파일에 못 쓰면 다운로드로 */
async function viaDialog<H>(bytes: Uint8Array, name: string, deps: ProjectSaveDeps<H>): Promise<SavedFile<H>> {
  const chosen = await deps.ask(name);
  if (chosen === "cancelled") return { outcome: "cancelled" };
  if (!chosen.file) {
    deps.download(bytes, name);
    return { outcome: "downloaded" };
  }
  if (await deps.write(chosen.file, bytes)) return { outcome: "written", name: deps.nameOf(chosen.file), file: chosen.file };
  deps.download(bytes, name);
  return { outcome: "rescued" };
}

/** 프로젝트를 저장한다. file: 지금 곡의 기억한 프로젝트 파일 */
export async function saveProjectFile<H>(
  bytes: Uint8Array,
  name: string,
  o: { file: H | undefined; saveAs: boolean; asks: boolean; canAsk: boolean },
  deps: ProjectSaveDeps<H>,
): Promise<SavedFile<H>> {
  const route = projectRoute({ hasFile: !!o.file, saveAs: o.saveAs, asks: o.asks, canAsk: o.canAsk });
  if (route === "dialog") return viaDialog(bytes, name, deps);
  if (route === "target") return deps.target(bytes, name);
  const file = o.file!;
  if (await deps.write(file, bytes)) return { outcome: "written", name: deps.nameOf(file), file };
  // 옮겨졌거나 지워졌거나 허락하지 않았다: 그 파일은 버리고 저장 창으로 (못 띄우면 다운로드)
  return { ...(await viaDialog(bytes, deps.nameOf(file), deps)), directFailed: true };
}

/**
 * 저장 뒤의 "확인된 프로젝트 저장" 표식. prev: 전에 확인한 저장, now: 이번에 저장한 곡·편집 상태.
 * 폴더·파일에 썼거나 공유 창에서 보냈으면 이번 저장이 확인된 것이다.
 * 다운로드로 물러났거나, 기억한 파일에 바로 쓰지 못했으면(그 파일이 지워졌을 수 있다) 전에 확인한 저장도 믿지 않는다.
 * 저장 창을 닫았거나 다시 저장하라고 했을 때는 그대로 둔다
 */
export function confirmedSave<T>(prev: T | undefined, saved: SavedFile<unknown>, now: T): T | undefined {
  if (saved.outcome === "written" || saved.outcome === "shared") return now;
  if (saved.directFailed || saved.outcome === "downloaded" || saved.outcome === "rescued") return undefined;
  return prev;
}
