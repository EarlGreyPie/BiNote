import { loadStored, saveStored } from "./persist";
import { TAB_EVENT_FONT, TAB_EVENT_FONTS } from "./tabEvents";

/** 타브 위쪽 변속 줄(템포·박자·마커) 글자 크기 (설정 → 화면, 이 브라우저에 기억) */
const FONT_KEY = "mmlce.tabEventFont";

/** 저장된 값이 고를 수 있는 크기가 아니면 기본 크기 */
export function parseTabEventFont(raw: string | null): number {
  const v = Number(raw);
  return (TAB_EVENT_FONTS as readonly number[]).includes(v) ? v : TAB_EVENT_FONT;
}

export const tabEventPrefs = $state({
  font: loadStored(FONT_KEY, parseTabEventFont),
});

export function setTabEventFont(px: number): void {
  tabEventPrefs.font = parseTabEventFont(String(px));
  saveStored(FONT_KEY, String(tabEventPrefs.font));
}
