/** 타브 지판 세로 위치: 남는 높이가 있을 때 지판을 칸의 위·가운데·아래 중 어디에 둘지 */
export const TAB_ALIGNS = ["top", "middle", "bottom"] as const;
export type TabAlign = (typeof TAB_ALIGNS)[number];

/** 저장해 둔 값을 읽는다. 없거나 모르는 값이면 가운데 */
export function parseTabAlign(raw: string | null): TabAlign {
  return TAB_ALIGNS.find((a) => a === raw) ?? "middle";
}

/** 단추를 누를 때마다 위 → 가운데 → 아래 → 위 */
export function nextTabAlign(align: TabAlign): TabAlign {
  return TAB_ALIGNS[(TAB_ALIGNS.indexOf(align) + 1) % TAB_ALIGNS.length]!;
}
