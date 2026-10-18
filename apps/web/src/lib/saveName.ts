/** 저장 파일 이름 규칙 (화면 언어와 상관없이 같다) */

/** 불러온 파일이 없는 새 악보의 저장 이름. 번역하지 않는다 */
export const DEFAULT_BASE_NAME = "new project";

/** 새 이름을 고를 때 붙여 볼 번호의 상한. 다 있으면 저장하지 않는다 */
export const FREE_NAME_LIMIT = 999;

/** 저장할 파일의 확장자 앞 이름. 불러온 파일 이름에서 확장자만 떼고, 없으면 기본 이름 */
export function saveBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || DEFAULT_BASE_NAME;
}

/**
 * 폴더에 없는 첫 이름을 고른다: `base.ext`, `base 2.ext`, `base 3.ext` …
 * 상한까지 모두 있으면 undefined (있는 파일에 덮어쓰지 않게 저장을 멈춘다).
 */
export async function freeName(base: string, ext: string, exists: (name: string) => Promise<boolean>): Promise<string | undefined> {
  for (let n = 1; n <= FREE_NAME_LIMIT; n++) {
    const name = n === 1 ? `${base}${ext}` : `${base} ${n}${ext}`;
    if (!(await exists(name))) return name;
  }
  return undefined;
}
