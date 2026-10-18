import { rat, type Rat } from "@mmlce/core";

/**
 * 보기 → 커서 따라가기: 키보드·숫자판으로 커서를 옮겨 보이는 범위 밖으로 나가면 화면을 넘긴다.
 * 이 브라우저에 기억한다 (없으면 켬)
 */
export const FOLLOW_CURSOR_KEY = "mmlce.tabFollowCursor";

export function parseFollowCursor(raw: string | null): boolean {
  return raw !== "0";
}

/** 보이는 폭에서 양쪽에 두는 여백 비율 */
const MARGIN = 0.1;
/** 넘길 때 커서를 둘 자리 (보이는 폭에서 왼쪽 또는 오른쪽 끝부터) */
const LAND = 0.25;

/**
 * 커서 자리 [at, end)(그 자리 음이 있으면 음 끝까지, 온음표 단위)가 화면 [start, start + span) 안쪽 여백 안에 들게 할 새 start.
 * 이미 들어 있으면 그대로. 오른쪽 여백을 넘으면 커서가 왼쪽에서 1/4 자리에, 왼쪽 여백보다 앞이면 오른쪽에서 1/4 자리에 오게
 * 한 번에 넉넉히 넘긴다. 화면보다 긴 음이면 음 머리가 보이게 한다. 0 ~ timeMax 안으로 막는다
 */
export function followStart(at: number, end: number, start: number, span: number, timeMax: number): number {
  if (!(span > 0)) return start;
  const left = start + span * MARGIN;
  const right = start + span * (1 - MARGIN);
  let next = start;
  if (at < left) next = at - span * (1 - LAND);
  else if (at > right || end > right) next = at - span * LAND;
  return Math.min(timeMax, Math.max(0, next));
}

/**
 * 지금 화면에 보이는 첫 칸: 보이는 왼쪽 끝 시간 start(온음표 단위)를 격자(1/division)에 맞춰 올림한 자리.
 * 왼쪽 끝이 칸 사이(그 칸이 반쯤 가려짐)면 다음 칸. 다만 보이는 폭(span)이 한 칸보다 좁아 그 칸이 오른쪽 밖이면
 * 왼쪽 끝이 걸친 칸(내림). 커서가 없을 때 키를 누르면 여기에 커서를 만든다
 */
export function firstVisibleCell(start: number, division: number, span = Infinity): Rat {
  const up = Math.max(0, Math.ceil(start * division - 1e-9));
  if (up / division < start + span) return rat(up, division);
  return rat(Math.max(0, Math.floor(start * division + 1e-9)), division);
}

/** 커서 칸의 시작 at이 화면 [start, start + span) 안에 보이는지 (왼쪽 끝은 실수 오차만큼 너그럽게) */
export function cursorVisible(at: number, start: number, span: number): boolean {
  return at >= start - 1e-9 && at < start + span;
}

/**
 * 커서 칸 [at, end)를 편집하기 전에 화면에 보이게 할 새 start. 이미 보이면 그대로.
 * 아니면 커서 따라가기와 같은 자리(followStart)로 넘기고, 그래도 안 보이면(곡 끝 timeMax에 막히는 등)
 * 커서 시작을 왼쪽 끝에 둔다. 보이는 폭이 한 칸보다 좁아도 커서 시작은 늘 화면 안이다
 */
export function revealStart(at: number, end: number, start: number, span: number, timeMax: number): number {
  if (!(span > 0) || cursorVisible(at, start, span)) return start;
  const next = followStart(at, end, start, span, timeMax);
  return cursorVisible(at, next, span) ? next : Math.max(0, at);
}
