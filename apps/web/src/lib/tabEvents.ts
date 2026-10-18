import { cmp, type Rat } from "@mmlce/core";

/** 타브 위쪽 둘째 줄의 변속 글자 하나: 종류, 원래 곡 위치(분수), 글자, 그린 가로 범위(px) */
export interface TabEventSpot {
  readonly kind: "tempo" | "meter";
  readonly at: Rat;
  readonly text: string;
  readonly left: number;
  readonly right: number;
}

/**
 * 템포·박자 글자를 놓을 자리. 바뀌는 자리(xOf) 조금 오른쪽에 쓰고, 같은 자리에 템포와 박자가 함께 바뀌어
 * 앞 글자와 겹치면 옆으로 이어 쓴다. 위치는 원래 분수 그대로 들고 있는다 (누를 때 실수로 되돌려 찾지 않게)
 */
export function layoutTabEvents(
  items: readonly { readonly kind: "tempo" | "meter"; readonly at: Rat; readonly text: string }[],
  xOf: (at: Rat) => number,
  widthOf: (text: string) => number,
): TabEventSpot[] {
  const spots: TabEventSpot[] = [];
  let lastRight = -Infinity;
  for (const e of [...items].sort((a, b) => cmp(a.at, b.at))) {
    const left = Math.max(xOf(e.at) + 3, lastRight + 4);
    const right = left + widthOf(e.text);
    spots.push({ ...e, left, right });
    lastRight = right;
  }
  return spots;
}

/** 가로 x(px)에 그린 글자 (글자 양옆 2px까지). 없으면 undefined */
export function tabEventAt(spots: readonly TabEventSpot[], x: number): TabEventSpot | undefined {
  return spots.find((s) => x >= s.left - 2 && x <= s.right + 2);
}

/**
 * 변속 글자 칸 (캔버스 세로 px). 줄 간격(타브 크기)과 상관없이 늘 이 자리에 그린다:
 * top은 글자 칸 위(창 위치 기준), baseline은 글자 기준선, bottom은 기준선 아래 글자 끝.
 * 누르는 범위는 top보다 조금 위(마디 번호 줄 아래)부터 bottom 앞까지다
 */
export const TAB_EVENT_TEXT = { top: 16, baseline: 27, bottom: 31 } as const;
const BAND_TOP = TAB_EVENT_TEXT.top - 2;

/**
 * 누른 자리(px, py)가 변속 줄 쪽인지 (아니면 지판 쪽). 첫 줄(firstLine) 프렛 숫자는 위로 fontPx 가까이 올라오므로,
 * 타브를 크게 해 그 칸과 겹치는 자리는 글자가 있는 곳만 변속 쪽으로 보내고 빈 곳은 첫 줄을 누르게 남긴다
 */
export function inTabEventBand(spots: readonly TabEventSpot[], px: number, py: number, firstLine: number, fontPx: number): boolean {
  if (py < BAND_TOP || py >= TAB_EVENT_TEXT.bottom) return false;
  if (py < firstLine - fontPx) return true;
  return tabEventAt(spots, px) !== undefined;
}
