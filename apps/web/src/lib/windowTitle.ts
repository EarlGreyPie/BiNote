import { DEFAULT_BASE_NAME } from "./saveName";
import { isIpad } from "./windowControls";

/** 곡이 없을 때(시작 화면)의 창 제목. index.html의 <title>과 같다 */
export const APP_TITLE = "BiNote 바이노트";

/** 브라우저 탭 제목 뒤에 붙이는 짧은 앱 이름 */
export const APP_SHORT_NAME = "BiNote";

/**
 * 설치한 앱의 이름: manifest의 name과 글자 하나까지 같아야 한다 (short_name이 아니다).
 * 크롬·엣지는 설치한 앱의 이름으로 manifest의 name을 쓰고, 창 제목이 그 이름으로 시작하는지 본다
 */
export const APP_INSTALLED_NAME = "BiNote 바이노트";

/** 저장 안 한 변경 표시 (이름 앞에 붙인다) */
export const UNSAVED_MARK = "● ";

/** 창 제목·위 띠에 쓰는 곡 이름. 이름 없는 곡은 new project, 저장 안 한 변경이 있으면 앞에 ● */
export function songLabel(fileName: string, unsaved: boolean): string {
  return `${unsaved ? UNSAVED_MARK : ""}${fileName || DEFAULT_BASE_NAME}`;
}

/**
 * 창 제목(브라우저 탭·설치한 앱 제목줄). 번역하지 않는다.
 * 브라우저 탭은 `파일 이름 - BiNote`(좁은 탭에서도 이름이 보이게), 설치한 앱은 `설치한 앱 이름 - 파일 이름`.
 * 크롬·엣지는 설치한 앱의 창이 하나뿐이면 페이지 제목을 버리고 앱 이름만 제목줄에 쓴다.
 * 페이지 제목이 설치한 앱 이름(manifest의 name 전체)으로 시작할 때만 제목을 그대로 보여 주므로 그 이름을 통째로 앞에 둔다
 */
export function windowTitle(fileName: string, hasSong: boolean, unsaved: boolean, installed = false): string {
  if (!hasSong) return APP_TITLE;
  const name = songLabel(fileName, unsaved);
  return installed ? `${APP_INSTALLED_NAME} - ${name}` : `${name} - ${APP_SHORT_NAME}`;
}

/**
 * 설치한 앱에 제목줄이 없는 기기인지 (아이패드·아이폰·안드로이드 홈 화면 앱).
 * 이런 곳은 창 제목이 어디에도 보이지 않아 위 띠에 곡 이름을 따로 적는다
 */
export function hasNoTitleBar(ua: string, maxTouchPoints: number): boolean {
  return isIpad(ua, maxTouchPoints) || /iPhone|Android/.test(ua);
}
