import { cmp, type Rat } from "@mmlce/core";
import { WAVE_SIZE } from "./waveDraw";

/** 타브 변속 줄 글자 종류 (피아노롤 이벤트 줄과 같다) */
export type TabEventKind = "tempo" | "meter" | "marker";

/** 변속 줄에 놓을 글자 하나. 마커는 id로 찾는다 (템포·박자는 위치로) */
export interface TabEventItem {
  readonly kind: TabEventKind;
  readonly at: Rat;
  readonly text: string;
  readonly id?: string;
  /** 곡 처음에 적은 템포가 없어 기본값(t120)을 보이는 글자 (피아노롤 EventLabel.implicit과 같다) */
  readonly implicit?: boolean;
}

/** 변속 줄의 칸: 0 = 위 칸(템포), 1 = 아래 칸(박자·마커). 피아노롤 이벤트 줄과 같은 순서 */
export type TabEventRow = 0 | 1;

/** 글자 종류가 놓이는 칸 */
export function tabEventRowOf(kind: TabEventKind): TabEventRow {
  return kind === "tempo" ? 0 : 1;
}

/** 타브 위쪽 변속 줄의 글자 하나: 종류, 원래 곡 위치(분수), 글자, 칸, 그린 가로 범위(px), 마커 id */
export interface TabEventSpot extends TabEventItem {
  readonly row: TabEventRow;
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
 * 템포·박자·마커 글자를 놓을 자리. 템포는 위 칸, 박자·마커는 아래 칸에 바뀌는 자리(xOf) 조금 오른쪽에 쓰고,
 * 같은 칸에서 앞 글자와 겹치면 옆으로 이어 쓴다 (칸이 다르면 같은 자리라도 위아래로 놓여 밀지 않는다).
 * 위치는 원래 분수 그대로 들고 있는다 (누를 때 실수로 되돌려 찾지 않게)
 */
export function layoutTabEvents(
  items: readonly TabEventItem[],
  xOf: (at: Rat) => number,
  widthOf: (text: string) => number,
): TabEventSpot[] {
  const spots: TabEventSpot[] = [];
  const lastRight = [-Infinity, -Infinity];
  for (const e of [...items].sort((a, b) => cmp(a.at, b.at))) {
    const row = tabEventRowOf(e.kind);
    const left = Math.max(xOf(e.at) + 3, lastRight[row]! + 4);
    const right = left + widthOf(e.text);
    spots.push({ ...e, row, left, right });
    lastRight[row] = right;
  }
  return spots;
}

/** row 칸의 가로 x(px)에 그린 글자 (글자 양옆 2px까지). 없으면 undefined */
export function tabEventAt(spots: readonly TabEventSpot[], x: number, row: TabEventRow): TabEventSpot | undefined {
  return spots.find((s) => s.row === row && x >= s.left - 2 && x <= s.right + 2);
}

/**
 * 맨 위 마디 번호 줄(눈금자) 높이(px). 피아노롤 눈금자처럼 누르면 재생 위치, 끌면 반복 구간.
 * 변속 줄은 이 아래부터다
 */
export const TAB_RULER = 20;
/** 마디 번호 글자 기준선 (줄 두께 20에 14) */
export const TAB_RULER_BASELINE = 14;
/** 마디 번호 글자 크기 (줄 두께 20에 10px) */
export const TAB_RULER_FONT = 10;
/** 변속 줄 글자 크기 고르기 (설정 → 화면). 칸 높이도 글자에 맞춰 바뀐다 */
export const TAB_EVENT_FONTS = [10, 13, 16, 20] as const;
/**
 * 변속 줄 글자 크기 기본값(px). 마디 번호(10px)보다 크게, 기본 타브 숫자(11px)보다 조금 크게 써 잘 읽히게 한다.
 * 아래 함수들의 eventFont를 빼면 이 크기다
 */
export const TAB_EVENT_FONT = 13;

/** 변속 줄 한 칸 높이(px). 위 칸 템포, 아래 칸 박자·마커. 글자 크기 + 5 */
export function tabEventRowH(eventFont = TAB_EVENT_FONT): number {
  return eventFont + 5;
}
/** 기본 글자 크기의 변속 줄 한 칸 높이 */
export const TAB_EVENT_ROW_H = tabEventRowH();

/**
 * row 칸의 글자 자리 (캔버스 세로 px). 줄 간격(타브 크기)과 상관없이 늘 이 자리에 그린다:
 * top은 글자 칸 위(창 위치 기준), baseline은 글자 기준선, bottom은 기준선 아래 글자 끝.
 * 위 칸을 누르는 범위는 top보다 조금 위(마디 번호 줄 아래)부터 아래 칸 top 앞까지, 아래 칸은 그다음부터 bottom 앞까지다
 */
export function tabEventText(row: TabEventRow, eventFont = TAB_EVENT_FONT, ruler = TAB_RULER): { readonly top: number; readonly baseline: number; readonly bottom: number } {
  const top = ruler + 2 + row * tabEventRowH(eventFont);
  return { top, baseline: top + eventFont + 1, bottom: top + eventFont + 5 };
}

/** 변속 줄 아래 끝 (아래 칸 글자 끝) */
export function tabEventBottom(eventFont = TAB_EVENT_FONT, ruler = TAB_RULER): number {
  return tabEventText(1, eventFont, ruler).bottom;
}
/** 기본 글자 크기의 변속 줄 아래 끝 */
export const TAB_EVENT_BOTTOM = tabEventBottom();
/** 첫 줄(1번 줄) 선의 세로 자리(기본 글자 크기, 파형 띠 없음): 변속 줄 아래에 첫 줄 숫자(위로 올라오는 글자)가 들어갈 틈을 둔다 */
export const TAB_TOP = TAB_EVENT_BOTTOM + 11;

/**
 * 누른 자리(px, py)가 변속 줄의 몇째 칸인지 (undefined = 마디 번호 줄이나 지판 쪽). 첫 줄(firstLine) 프렛 숫자는
 * 위로 fontPx 가까이 올라오므로, 타브를 크게 해 그 숫자와 겹치는 자리는 그 칸에 글자가 있는 곳만 변속 쪽으로 보내고
 * 빈 곳은 첫 줄을 누르게 남긴다
 */
export function tabEventRow(spots: readonly TabEventSpot[], px: number, py: number, firstLine: number, fontPx: number, eventFont = TAB_EVENT_FONT, ruler = TAB_RULER): TabEventRow | undefined {
  if (py < ruler || py >= tabEventBottom(eventFont, ruler)) return undefined;
  const row: TabEventRow = py < tabEventText(1, eventFont, ruler).top ? 0 : 1;
  if (py < firstLine - fontPx) return row;
  return tabEventAt(spots, px, row) !== undefined ? row : undefined;
}

/** 누른 자리(px, py)가 변속 줄 쪽인지 (아니면 지판 쪽). 규칙은 tabEventRow */
export function inTabEventBand(spots: readonly TabEventSpot[], px: number, py: number, firstLine: number, fontPx: number, eventFont = TAB_EVENT_FONT, ruler = TAB_RULER): boolean {
  return tabEventRow(spots, px, py, firstLine, fontPx, eventFont, ruler) !== undefined;
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

/** 원곡 파형 띠 위쪽 끝 (변속 줄 두 칸 바로 아래). 띠 높이는 피아노롤과 같은 WAVE_SIZE */
export function tabWaveTop(eventFont = TAB_EVENT_FONT, ruler = TAB_RULER): number {
  return tabEventBottom(eventFont, ruler);
}
/** 기본 글자 크기의 파형 띠 위쪽 끝 */
export const TAB_WAVE_TOP = tabWaveTop();

/** 첫 줄 자리. 변속 줄 아래 틈 11px, 파형 띠를 보이면 띠 높이만큼 더 아래 */
export function tabTop(wave: boolean, eventFont = TAB_EVENT_FONT, ruler = TAB_RULER): number {
  return tabEventBottom(eventFont, ruler) + 11 + (wave ? WAVE_SIZE : 0);
}

/** 누른 칸: 마디 번호 줄(재생 위치·반복 구간) / 변속 위 칸(템포) / 변속 아래 칸(박자·마커) / 원곡 파형 띠 / 지판 */
export type TabZone = "ruler" | "tempo" | "meter" | "wave" | "fret";

/**
 * 누른 자리(px, py)가 어느 칸인지. 변속 줄과 첫 줄 프렛 숫자가 겹치는 자리는 tabEventRow 규칙(글자 위만 변속 쪽).
 * 파형 띠(wave일 때만)는 변속 줄 아래 [TAB_WAVE_TOP, + WAVE_SIZE). 타브를 크게 해 첫 줄 숫자가 띠까지 올라오면 그 자리는 첫 줄을 누르게 남긴다
 */
export function tabZone(spots: readonly TabEventSpot[], px: number, py: number, firstLine: number, fontPx: number, wave = false, eventFont = TAB_EVENT_FONT, ruler = TAB_RULER): TabZone {
  if (py < ruler) return "ruler";
  const row = tabEventRow(spots, px, py, firstLine, fontPx, eventFont, ruler);
  if (row !== undefined) return row === 0 ? "tempo" : "meter";
  const waveTop = tabWaveTop(eventFont, ruler);
  if (wave && py >= waveTop && py < waveTop + WAVE_SIZE && py < firstLine - fontPx) return "wave";
  return "fret";
}

/**
 * 변속 줄 row 칸의 x를 두 번 눌렀을 때(터치는 길게) 할 일: 그 칸의 글자 위면 그것을 고치고,
 * 빈 곳이면 위 칸은 새 템포, 아래 칸은 새 마커 (피아노롤 이벤트 줄과 같다. 박자는 박자 글자나 도구줄 박자 칸으로 바꾼다)
 */
export function tabEventAction(spots: readonly TabEventSpot[], px: number, row: TabEventRow): { readonly edit: TabEventSpot } | { readonly add: "tempo" | "marker" } {
  const spot = tabEventAt(spots, px, row);
  return spot ? { edit: spot } : { add: row === 0 ? "tempo" : "marker" };
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
