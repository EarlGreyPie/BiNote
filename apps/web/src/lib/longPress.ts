/** 손가락은 가만히 대고 있어도 조금씩 흔들린다. 길게 누르기는 누른 자리에서 이만큼(px) 넘게 움직였을 때만 그만둔다 */
export const LONG_PRESS_SLOP = 10;

interface Point {
  readonly clientX: number;
  readonly clientY: number;
}

/** 누른 자리 from에서 지금 자리 e까지 LONG_PRESS_SLOP보다 멀리 움직였는지. from이 없으면 false */
export function movedTooFar(from: Point | undefined, e: Point): boolean {
  return !!from && Math.hypot(e.clientX - from.clientX, e.clientY - from.clientY) > LONG_PRESS_SLOP;
}
