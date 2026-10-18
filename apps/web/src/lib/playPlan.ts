import type { SlotPatch, Unresolved } from "@mmlce/audio/browser";

/** 재생 한 번의 계획: 일정과 소리 지점마다 정한 패치 */
export interface PlayPlan<S> {
  readonly schedule: S;
  readonly patches: readonly SlotPatch[];
  readonly unresolved: Unresolved[];
}

/**
 * 재생 직전 준비. 패치를 정하고 음을 미리 준비(예열)하는데, 기다리는 사이 팩 구성(더하기·빼기·순서)이 바뀌면
 * 옛 패치(지운 팩 포함)로 시작하지 않게 다시 정하고 다시 준비한다. 시작 직전에는 최신 악기별 음량을 패치에 싣는다.
 * 기다리는 사이 이 재생이 취소되면(정지·새 재생) undefined
 */
export async function preparePlay<S>(options: {
  /** 지금 팩 구성으로 일정과 패치를 정한다 */
  readonly plan: () => PlayPlan<S>;
  /** 음을 미리 준비한다 (오래 걸릴 수 있다) */
  readonly prepare: (plan: PlayPlan<S>) => Promise<void>;
  /** 팩 구성 세대 번호. 더하기·빼기·순서 바꾸기마다 늘어난다 */
  readonly packVersion: () => number;
  /** 이 재생이 취소됐는지 */
  readonly cancelled: () => boolean;
  /** 지금 악기별 음량 배율 */
  readonly gainOf: (packId: string, program: number) => number;
}): Promise<PlayPlan<S> | undefined> {
  for (;;) {
    const version = options.packVersion();
    const plan = options.plan();
    await options.prepare(plan);
    if (options.cancelled()) return undefined;
    if (version !== options.packVersion()) continue;
    const patches = plan.patches.map((p): SlotPatch => {
      const { gain: _old, ...rest } = p;
      const gain = options.gainOf(p.packId, p.program);
      return gain !== 1 ? { ...rest, gain } : rest;
    });
    return { ...plan, patches };
  }
}
