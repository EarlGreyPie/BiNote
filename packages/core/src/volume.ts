import type { Note } from "./model.js";
import type { GameProfile } from "./profile.js";
import { applyVolumes, tieChains } from "./note-edit.js";

/**
 * 볼륨 일괄 조정 방식.
 * - set: 모두 한 v로
 * - shift: 지금 v에서 ±by (프로필 범위에서 멈춘다)
 * - db: 목표 음량(dB, v 최대가 0 dB)에 가장 가까운 v로 (프로필 volumeCurve를 쓴다)
 */
export type VolumeChange =
  | { readonly kind: "set"; readonly vol: number }
  | { readonly kind: "shift"; readonly by: number }
  | { readonly kind: "db"; readonly db: number };

/** v의 음량(dB). 범위 밖이면 가까운 끝 값 */
export function dbOfVolume(profile: Pick<GameProfile, "volume" | "volumeCurve">, vol: number): number {
  const { min, max } = profile.volume;
  const v = Math.min(max, Math.max(min, Math.round(vol)));
  return profile.volumeCurve[v - min] ?? -Infinity;
}

/** 목표 dB에 가장 가까운 v. 같은 거리면 작은 v. 소리 나는 가장 작은 v보다도 작은 dB여도 소리 나는 v를 고른다 (-Infinity만 무음 v) */
export function volumeForDb(profile: Pick<GameProfile, "volume" | "volumeCurve">, db: number): number {
  const { min } = profile.volume;
  let best = min;
  let bestGap = Infinity;
  profile.volumeCurve.forEach((d, i) => {
    const gap = d === db ? 0 : Math.abs(d - db);
    if (gap < bestGap) {
      best = i + min;
      bestGap = gap;
    }
  });
  return best;
}

export interface VolumeResult {
  /** 바꾼 트랙 음 (순서·자리 그대로, vol만 바뀐다) */
  readonly notes: Note[];
  /** 고른 음 가운데 v가 바뀌는 소리(& 사슬 하나를 한 음으로 센다) */
  readonly changed: number;
  /** 고른 소리 수 */
  readonly count: number;
  /** ±로 옮기다 범위 끝(v최소·v최대)에서 멈춘 소리 수 */
  readonly clamped: number;
  /** & 뒤에 이어진 음만 골라 사슬 첫 음부터 함께 바꾼 소리 수 (게임은 & 뒤 v를 읽지 않는다) */
  readonly viaTie: number;
}

/**
 * 트랙 음(notes) 가운데 picked(없으면 모두)의 v를 바꾼다. 게임은 & 뒤 v를 무시하므로 & 사슬은 첫 음 v로 함께 바꾼다:
 * 사슬의 어느 음을 골라도 사슬 전체가 첫 음 v를 바꾼 값이 된다 (가운데·끝 음만 고른 사슬은 viaTie로 센다).
 * 음 자리·길이·높이는 건드리지 않는다
 */
export function changeVolumes(
  notes: readonly Note[],
  change: VolumeChange,
  profile: Pick<GameProfile, "volume" | "volumeCurve">,
  picked?: ReadonlySet<string>,
): VolumeResult {
  const { min, max } = profile.volume;
  const byHead = new Map<string, number>();
  let changed = 0;
  let count = 0;
  let clamped = 0;
  let viaTie = 0;
  for (const chain of tieChains(notes)) {
    const head = chain[0]!;
    if (picked && !picked.has(head.id)) {
      if (!chain.some((n) => picked.has(n.id))) continue;
      viaTie++;
    }
    count++;
    let vol: number;
    if (change.kind === "set") vol = change.vol;
    else if (change.kind === "db") vol = volumeForDb(profile, change.db);
    else {
      vol = head.vol + change.by;
      if (vol < min || vol > max) clamped++;
    }
    vol = Math.min(max, Math.max(min, Math.round(vol)));
    if (vol !== head.vol) changed++;
    byHead.set(head.id, vol);
  }
  return { notes: applyVolumes(notes, byHead), changed, count, clamped, viaTie };
}

/** 소리마다(& 사슬은 첫 음) v의 [가장 작은 값, 가장 큰 값]. 사슬의 어느 음을 골라도 그 사슬을 센다. 고른 소리가 없으면 undefined */
export function volumeSpan(notes: readonly Note[], picked?: ReadonlySet<string>): readonly [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const chain of tieChains(notes)) {
    const head = chain[0]!;
    if (picked && !chain.some((n) => picked.has(n.id))) continue;
    lo = Math.min(lo, head.vol);
    hi = Math.max(hi, head.vol);
  }
  return lo === Infinity ? undefined : [lo, hi];
}
