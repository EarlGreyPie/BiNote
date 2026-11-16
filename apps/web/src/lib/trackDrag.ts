import type { ScoreGroup } from "./scores";

/**
 * 트랙 끌어 옮기기에서 구조 목록과 트랙 띠가 같이 쓰는 계산.
 * 끄는 동안에는 곡을 바꾸지 않고 놓을 자리만 정한다. 놓을 때 moveTrack 명령 하나로 옮긴다 (실행 취소 한 칸)
 */

/** 마우스로 줄·단추를 누른 채 이만큼(px) 넘게 움직이면 끌기로 본다 (그 전에는 그냥 누르기) */
export const DRAG_START_PX = 5;

interface Point {
  readonly clientX: number;
  readonly clientY: number;
}

/** 누른 자리 from에서 지금 자리 e까지 끌기로 볼 만큼 움직였는지 */
export function dragStarted(from: Point, e: Point): boolean {
  return Math.hypot(e.clientX - from.clientX, e.clientY - from.clientY) > DRAG_START_PX;
}

/** 포인터 아래의 놓을 곳: 악보 줄(그 악보 끝으로), 트랙 줄(그 앞이나 뒤) */
export type DropTarget =
  | { readonly kind: "score"; readonly playerId: string; readonly score: number }
  | { readonly kind: "track"; readonly playerId: string; readonly trackId: string; readonly after: boolean };

/** 놓을 자리: 연주자 playerId의 index번째 (끄는 트랙을 뺀 순서, moveTrack에 그대로 넘긴다). rowId·after는 화면 표시용 */
export interface DropSpot {
  readonly playerId: string;
  readonly index: number;
  readonly rowId: string;
  readonly after: boolean;
}

/** 악보 줄의 표시용 id */
export const scoreRowId = (score: number) => `score-${score}`;

/**
 * 끄는 트랙 dragId를 target에 놓으면 갈 자리.
 * - 악보 줄: 그 게임 악보(묶음)의 마지막 트랙 뒤
 * - 트랙 줄: after면 그 트랙 뒤, 아니면 앞. 끄는 트랙 자신 위면 제자리
 */
export function dropSpot(
  tracks: readonly { readonly id: string; readonly playerId: string }[],
  groups: readonly ScoreGroup[],
  dragId: string,
  target: DropTarget,
): DropSpot {
  const { playerId } = target;
  const others = tracks.filter((tr) => tr.playerId === playerId && tr.id !== dragId).map((tr) => tr.id);
  if (target.kind === "score") {
    const group = groups.find((g) => g.number === target.score);
    const tail = group ? [...group.trackIds].reverse().find((id) => id !== dragId) : undefined;
    return { playerId, index: tail ? others.indexOf(tail) + 1 : others.length, rowId: scoreRowId(target.score), after: true };
  }
  const { trackId, after } = target;
  if (trackId === dragId) {
    const index = tracks.filter((tr) => tr.playerId === playerId).findIndex((tr) => tr.id === trackId);
    return { playerId, index, rowId: trackId, after };
  }
  return { playerId, index: others.indexOf(trackId) + (after ? 1 : 0), rowId: trackId, after };
}

/**
 * 화면 자리 e 아래에서 놓을 곳을 찾는다 (root 안의 data-drop 요소).
 * axis "y"는 위아래로 쌓인 목록(위쪽 반 = 앞), "x"는 옆으로 늘어선 띠(왼쪽 반 = 앞)
 */
export function dropTargetAt(root: HTMLElement, e: Point, axis: "x" | "y"): DropTarget | undefined {
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop]");
  if (!el || !root.contains(el)) return undefined;
  const playerId = el.dataset.player;
  if (playerId === undefined) return undefined;
  if (el.dataset.drop === "score") return { kind: "score", playerId, score: Number(el.dataset.score) };
  const trackId = el.dataset.track;
  if (trackId === undefined) return undefined;
  const r = el.getBoundingClientRect();
  const after = axis === "y" ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
  return { kind: "track", playerId, trackId, after };
}

/** 줄 안에서 누르면 끌기를 시작하지 않는 것: 단추·고르기 칸·이름 고치는 글 칸·손잡이(손잡이는 따로 바로 끈다) */
export function isDragExempt(target: EventTarget | null, row: Element): boolean {
  const el = target instanceof Element ? target.closest("button, select, input, textarea, [contenteditable], .grip") : null;
  return !!el && el !== row && row.contains(el);
}
