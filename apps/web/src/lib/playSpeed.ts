/** 일반 재생 속도 (1 = 원래). 빠른 대목을 채보하거나 원곡과 박을 맞출 때 느리게 튼다. 50%보다 느리게는 두지 않는다 */
export const PLAY_SPEEDS = [1, 0.9, 0.75, 0.6, 0.5] as const;

/** 기억해 둔 재생 속도를 읽는다. 목록에 없는 값이거나 비었으면 원래 속도 */
export function parsePlaySpeed(raw: string | null): number {
  const v = raw === null ? NaN : Number(raw);
  return (PLAY_SPEEDS as readonly number[]).includes(v) ? v : 1;
}

