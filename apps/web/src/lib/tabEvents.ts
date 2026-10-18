import { cmp, type Rat } from "@mmlce/core";

/** 타브 변속 줄 글자 종류 (피아노롤 이벤트 줄과 같다) */
export type TabEventKind = "tempo" | "meter" | "marker";

/** 변속 줄에 놓을 글자 하나. 마커는 id로 찾는다 (템포·박자는 위치로) */
export interface TabEventItem {
  readonly kind: TabEventKind;
  readonly at: Rat;
  readonly text: string;
  readonly id?: string;
}

/** 타브 위쪽 둘째 줄의 변속 글자 하나: 종류, 원래 곡 위치(분수), 글자, 그린 가로 범위(px), 마커 id */
export interface TabEventSpot extends TabEventItem {
  readonly left: number;
  readonly right: number;
}

/** 변속 줄에 쓰는 마커 이름의 최대 글자 수. 더 길면 줄이고 …을 붙인다 (뒤 글자를 너무 밀지 않게) */
export const TAB_MARKER_CHARS = 12;

/** 변속 줄에 쓸 마커 이름. 길면 앞 TAB_MARKER_CHARS자 + … (누르면 창에 전체 이름이 나온다) */
export function tabMarkerText(label: string): string {
  const chars = [...label];
  return chars.length > TAB_MARKER_CHARS ? `${chars.slice(0, TAB_MARKER_CHARS).join("")}…` : label;
}

/**
 * 템포·박자·마커 글자를 놓을 자리. 바뀌는 자리(xOf) 조금 오른쪽에 쓰고, 같은 자리에 여럿이 함께 있어
 * 앞 글자와 겹치면 옆으로 이어 쓴다. 위치는 원래 분수 그대로 들고 있는다 (누를 때 실수로 되돌려 찾지 않게)
 */
export function layoutTabEvents(
  items: readonly TabEventItem[],
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
export const TAB_EVENT_TEXT = { top: 22, baseline: 33, bottom: 37 } as const;
/**
 * 맨 위 마디 번호 줄(눈금자) 높이(px). 피아노롤 눈금자처럼 누르면 재생 위치, 끌면 반복 구간.
 * 변속 줄은 이 아래부터다
 */
export const TAB_RULER = 20;
/** 마디 번호 글자 기준선 */
export const TAB_RULER_BASELINE = 14;
const BAND_TOP = TAB_RULER;

/**
 * 누른 자리(px, py)가 변속 줄 쪽인지 (아니면 지판 쪽). 첫 줄(firstLine) 프렛 숫자는 위로 fontPx 가까이 올라오므로,
 * 타브를 크게 해 그 칸과 겹치는 자리는 글자가 있는 곳만 변속 쪽으로 보내고 빈 곳은 첫 줄을 누르게 남긴다
 */
export function inTabEventBand(spots: readonly TabEventSpot[], px: number, py: number, firstLine: number, fontPx: number): boolean {
  if (py < BAND_TOP || py >= TAB_EVENT_TEXT.bottom) return false;
  if (py < firstLine - fontPx) return true;
  return tabEventAt(spots, px) !== undefined;
}

/**
 * 프렛 숫자 칸의 가로 자리. 가로축(x)은 시간 그대로이고, 숫자는 인쇄 타브처럼 음이 시작하는 자리 x에서 오른쪽으로 쓴다
 * (피아노롤 음 막대처럼). 마디 첫 박 음도 마디선(1px)과 박자 글자를 덮지 않게 FRET_GAP만큼 띄운다.
 * 숫자 칸 = 배경 네모(글자 폭 + 양옆 2px) + 글자. 커서 네모·이음 표시·슬라이드 선·× 표시도 이 기준을 쓴다
 */
export const FRET_GAP = 2;

/** 시작 자리 x(px)에 쓰는 숫자 칸의 왼쪽 끝 */
export function fretBoxLeft(x: number): number {
  return x + FRET_GAP;
}

/** 시작 자리 x(px)에 쓰는 글자(폭 width)의 가운데 */
export function fretCenter(x: number, width: number): number {
  return fretBoxLeft(x) + 2 + width / 2;
}

/** 누른 칸: 마디 번호 줄(재생 위치·반복 구간) / 변속 줄(템포·박자·마커) / 지판 */
export type TabZone = "ruler" | "event" | "fret";

/** 누른 자리(px, py)가 어느 칸인지. 변속 줄과 첫 줄 프렛 숫자가 겹치는 자리는 inTabEventBand 규칙(글자 위만 변속 쪽) */
export function tabZone(spots: readonly TabEventSpot[], px: number, py: number, firstLine: number, fontPx: number): TabZone {
  if (py < TAB_RULER) return "ruler";
  return inTabEventBand(spots, px, py, firstLine, fontPx) ? "event" : "fret";
}

/** 마디 번호 줄에서 누른 자리 a부터 뗀 자리 b까지 (둘 다 격자에 맞춘 시간): 재생 위치·지우기·반복 구간 */
export type RulerResult = { readonly kind: "seek"; readonly at: number } | { readonly kind: "clear" } | { readonly kind: "loop"; readonly range: readonly [number, number] };

/**
 * 피아노롤 눈금자와 같은 규칙: 같은 자리에서 떼면 그 자리가 재생 위치(재생 중이면 거기서 이어 재생),
 * 재생 위치 위를 다시 누르면 지운다. 끌었으면 반복 구간(앞뒤를 정렬)이고 재생 위치는 구간 앞
 */
export function rulerRelease(a: number, b: number, cursor: number | undefined): RulerResult {
  if (a === b) return cursor === a ? { kind: "clear" } : { kind: "seek", at: a };
  return { kind: "loop", range: a < b ? [a, b] : [b, a] };
}
