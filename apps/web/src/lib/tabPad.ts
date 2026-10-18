/** 보기 → 타브 숫자판: 켜 두면 마우스로 지판을 눌러도 프렛 숫자판이 열린다. 이 브라우저에 기억한다 */
export const TAB_PAD_KEY = "mmlce.tabPad";

/** 저장해 둔 값을 읽는다. "1"일 때만 켬 (없거나 모르는 값이면 끔: 터치·펜에서만 열린다) */
export function parseTabPad(raw: string | null): boolean {
  return raw === "1";
}
