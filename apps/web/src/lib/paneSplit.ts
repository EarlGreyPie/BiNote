/**
 * 세로 화면(롤 위, 트랙 패널 아래)의 분할선 한도. 아래 패널이 트랙 띠 + 편집기 머리 + 글 두세 줄보다
 * 작아지지 않게 롤 몫(%)의 위 한도를 실제 높이로 정한다.
 */

/** 편집기 칸 하나의 최소 높이(em): 머리 줄 + 글 세 줄쯤. 편집기 여러 개의 칸 최소 높이와 같다 */
export const EDITOR_SLOT_MIN_EM = 8.5;
/** 롤 몫(%)의 기본 범위 */
export const ROLL_SHARE_MIN = 20;
export const ROLL_SHARE_MAX = 80;

/**
 * 롤 몫(%)의 위 한도. boxHeight는 롤·분할선·패널을 담은 칸의 높이, minPane은 아래 패널의 최소 높이(px),
 * divider는 분할선 높이. 롤과 패널은 분할선을 뺀 높이를 몫대로 나눈다. 칸이 너무 낮으면 ROLL_SHARE_MIN까지만 내린다
 */
export function maxRollShare(boxHeight: number, minPane: number, divider = 10): number {
  const room = boxHeight - divider;
  if (!(room > 0) || !(minPane > 0)) return ROLL_SHARE_MAX;
  return Math.max(ROLL_SHARE_MIN, Math.min(ROLL_SHARE_MAX, Math.floor(100 * (1 - minPane / room))));
}

/** 끌거나 불러온 롤 몫을 범위 안으로 (위 한도는 maxRollShare) */
export function clampRollShare(share: number, max = ROLL_SHARE_MAX): number {
  return Math.round(Math.min(max, Math.max(ROLL_SHARE_MIN, share)));
}

/** 편집기 칸이 없을 때(구조 보기 등) 머리 줄 + 트랙 띠 높이 어림(em). MML 보기로 바꿔도 편집기가 보이게 */
const CHROME_GUESS_EM = 5;

/**
 * 아래 패널(트랙 패널)의 최소 높이(px): 편집기 칸(.editors) 바깥에 쌓인 것(머리 줄, 트랙 띠 등)의 높이 +
 * 편집기 칸 최소 높이. 편집기 칸이 없으면(구조 보기 등) 머리 줄·트랙 띠를 어림해 더한다
 */
export function paneMinHeight(pane: HTMLElement): number {
  const editors = pane.querySelector<HTMLElement>(".editors");
  if (!editors) return (CHROME_GUESS_EM + EDITOR_SLOT_MIN_EM) * (parseFloat(getComputedStyle(pane).fontSize) || 16);
  let around = 0;
  for (let el: HTMLElement = editors; el !== pane && el.parentElement; el = el.parentElement) {
    for (const sibling of el.parentElement.children) if (sibling !== el) around += (sibling as HTMLElement).offsetHeight;
  }
  const slot = editors.querySelector<HTMLElement>(".slot") ?? editors;
  const em = parseFloat(getComputedStyle(slot).fontSize) || 16;
  return around + EDITOR_SLOT_MIN_EM * em;
}
