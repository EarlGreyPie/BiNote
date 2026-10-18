/**
 * 작업(자동 보존 기록)과 그 곡을 저장한 파일 이름·파일을 맞춘다.
 * 자동 보존 기록의 이름은 늦게 적힐 수 있어서, 저장할 때마다 따로 적어 둔 "저장한 이름"과 견주어
 * 어긋나면 어느 파일에도 덮어쓰지 않게 한다 (새 이름이나 저장 창으로).
 */

/** 저장할 때마다 작업 id로 적어 두는 것: 저장한 파일 이름과, 다시 쓸 수 있으면 그 파일 */
export interface WorkFile<H> {
  name: string;
  file?: H;
}

/** 되살린 곡의 이름과 파일. unsure: 이름을 믿을 수 없다 (다음 저장은 이름 없는 곡처럼 덮어쓰지 않는다) */
export interface RestoredFile<H> {
  fileName: string;
  file: H | undefined;
  unsure: boolean;
}

/**
 * 되살릴 때의 이름과 파일. recordName: 자동 보존 기록의 이름, stored: 저장할 때 적어 둔 것.
 * 둘이 같은 저장을 가리킬 때만 그 파일을 이어 쓴다. 어긋나면 파일을 버리고 이름을 믿지 않는다
 */
export function restoreWorkFile<H>(recordName: string, stored: WorkFile<H> | undefined, nameOf: (file: H) => string): RestoredFile<H> {
  if (!stored) return { fileName: recordName, file: undefined, unsure: false };
  const fileMatches = stored.file === undefined || nameOf(stored.file) === stored.name;
  if (stored.name === recordName && fileMatches) return { fileName: recordName, file: stored.file, unsure: false };
  return { fileName: recordName, file: undefined, unsure: true };
}

/** 자동 보존이 비교하는 상태: 곡, 타브 튜닝(곡 밖 편집 상태), 파일 이름 (이름만 바뀌어도 다시 적는다) */
export interface AutosaveState<S> {
  readonly song: S;
  readonly tabs: string;
  readonly name: string;
}

export function sameAutosave<S>(a: AutosaveState<S>, b: AutosaveState<S>): boolean {
  return a.song === b.song && a.tabs === b.tabs && a.name === b.name;
}
