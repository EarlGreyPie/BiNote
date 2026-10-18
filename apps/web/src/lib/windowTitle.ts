import { DEFAULT_BASE_NAME } from "./saveName";

/** 곡이 없을 때(시작 화면)의 창 제목. index.html의 <title>과 같다 */
export const APP_TITLE = "BiNote 바이노트";

/** 저장 안 한 변경 표시 (이름 앞에 붙인다) */
export const UNSAVED_MARK = "● ";

/**
 * 창 제목(브라우저 탭·설치한 앱 제목줄). 번역하지 않는다.
 * 곡이 있으면 `파일 이름 - BiNote` (이름 없는 곡은 new project), 저장 안 한 변경이 있으면 앞에 ●
 */
export function windowTitle(fileName: string, hasSong: boolean, unsaved: boolean): string {
  if (!hasSong) return APP_TITLE;
  return `${unsaved ? UNSAVED_MARK : ""}${fileName || DEFAULT_BASE_NAME} - BiNote`;
}
