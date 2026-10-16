import type { SoundPackRegistry } from "./registry.js";
import type { Schedule } from "./schedule.js";

/**
 * 트랙마다 채널 하나. 24화음(예비 30)까지 쓰므로 16을 넘으면 채널을 더 만든다.
 * 16채널마다 10번째(인덱스 9, 25, …)는 드럼으로 취급되므로 피한다
 */
/** 건반 미리듣기 전용 채널. 재생 트랙에는 주지 않는다 */
export const PREVIEW_CHANNEL = 63;
export const CHANNELS = Array.from({ length: 64 }, (_, i) => i).filter((c) => c % 16 !== 9 && c !== PREVIEW_CHANNEL);

export interface SlotPatch {
  readonly slot: number;
  readonly channel: number;
  readonly bank: number;
  readonly program: number;
  readonly packId: string;
}

export interface Unresolved {
  readonly slot: number;
  readonly instrument: string;
}

/** 소리 지점마다 채널과 실제 패치를 정한다. 찾지 못한 악기는 따로 알려 준다 */
export function assignPatches(
  schedule: Schedule,
  registry: SoundPackRegistry,
): { patches: SlotPatch[]; unresolved: Unresolved[] } {
  const patches: SlotPatch[] = [];
  const unresolved: Unresolved[] = [];
  schedule.slots.forEach((slot, index) => {
    const patch = registry.resolve(slot.instrument, slot.program);
    const channel = CHANNELS[index];
    if (!patch || channel === undefined) {
      unresolved.push({ slot: index, instrument: slot.instrument });
      return;
    }
    patches.push({ slot: index, channel, bank: patch.bank, program: patch.program, packId: patch.packId });
  });
  return { patches, unresolved };
}
