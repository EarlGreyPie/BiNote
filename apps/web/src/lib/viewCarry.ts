import type { Rat } from "@mmlce/core";
import type { Orientation } from "./roll";

/**
 * 타브 ↔ 피아노롤을 바꿀 때 이어 보는 자리. 보기를 바꾸면 컴포넌트를 새로 만들므로 앱이 들고 있다가 넘긴다.
 * 곡을 새로 열면 지운다 (다른 곡의 자리를 이어 쓰지 않게). 프로젝트 파일에는 적지 않는다
 */
export interface ViewMemory {
  /** 두 보기가 같이 쓰는 보던 시간 자리 */
  place: ViewPlace | undefined;
  /** 피아노롤 확대·음 높이 자리 */
  roll: RollZoom | undefined;
  /** 타브 확대와 타브 커서 */
  tab: TabMemory | undefined;
}

/** 보던 시간 자리: 보이는 시작 시간(왼쪽 끝, 세로 롤은 아래 끝)과 보이는 폭 (둘 다 온음표 단위) */
export interface ViewPlace {
  readonly start: number;
  readonly span: number;
}

export interface RollZoom {
  readonly pxPerWhole: number;
  readonly pxPerKey: number;
  readonly edgePitch: number;
  /** 이 값을 잴 때의 롤 방향 (방향이 바뀌었으면 음 축 자리를 새 방향에 맞게 다시 정한다) */
  readonly orientation: Orientation;
}

export interface TabMemory {
  readonly pxPerWhole: number;
  /** 타브 커서 (시간·줄). 없으면 커서 없이 연다 */
  readonly cursor: { readonly at: Rat; readonly string: number } | undefined;
}

export function emptyViewMemory(): ViewMemory {
  return { place: undefined, roll: undefined, tab: undefined };
}

/**
 * 보기가 알린 자리·확대·커서를 기억에 적는다. 그 보기를 만든 보기 세대(from)가 지금 세대(current)가 아니면
 * 곡을 새로 연 뒤 옛 보기가 늦게 알린 것이므로 버린다 (옛 곡의 커서·자리가 새 곡 기억에 다시 들어가지 않게). 적었으면 true.
 * 세대 번호는 곡을 열 때마다 늘어난다(같은 작업을 다시 되살려도). 자동 보존용 작업 id와는 따로다 (songView.ts)
 */
export function rememberView(memory: ViewMemory, from: number | undefined, current: number, change: Partial<ViewMemory>): boolean {
  if (!fromCurrentView(from, current)) return false;
  Object.assign(memory, change);
  return true;
}

/**
 * 새 보기의 시작 시간. 앞 보기의 시작 시간을 그대로 쓰되, 재생 위치(cursor)가 앞 보기 화면 안에 있었으면
 * 새 보기(보이는 폭 span)에서도 화면 안에 들게 한다. 새 화면 밖(끝 10% 포함)이면 롤의 재생 따라가기처럼 폭의 10% 자리에 둔다
 */
export function carryViewStart(prev: ViewPlace | undefined, span: number, cursor: number | undefined): number {
  if (!prev) return 0;
  const start = prev.start;
  if (cursor === undefined || cursor < prev.start || cursor > prev.start + prev.span) return start;
  if (cursor >= start && cursor <= start + span * 0.9) return start;
  return Math.max(0, cursor - span * 0.1);
}

/**
 * 보기가 보낸 알림(자리·커서, 템포·마커 창 열기)이 지금 보기에서 온 것인지. 보낸 보기의 세대 번호(from)가 지금 번호와 다르면
 * 곡을 새로 연 뒤 옛 보기가 늦게 보낸 것이다 (길게 누르기 타이머 등). 번호를 모르는 알림도 옛 것으로 본다
 */
export function fromCurrentView(from: number | undefined, current: number): boolean {
  return from === current;
}
