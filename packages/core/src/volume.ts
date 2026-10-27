import type { Note, TimeSigEvent } from "./model.js";
import { barAt, inBars, type BarRange } from "./meter.js";
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
  | { readonly kind: "db"; readonly db: number }
  /**
   * 실험실 긴 음 맞추기: 소리마다 울리는 동안 평균 크기가 짧은 음보다 lossDb(사슬)만큼 작으면 그만큼 v를 올린다
   * (올리기만, maxUp단계까지). lossDb는 템포·악기를 아는 쪽이 준다. 없으면 바꾸지 않는다
   */
  | { readonly kind: "held"; readonly maxUp: number; readonly lossDb?: (chain: readonly Note[]) => number };

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
  /** 긴 음 맞추기에서 정한 만큼(maxUp)만 올리고 멈춘 소리 수 (게임 한도에 닿은 소리는 clamped로 센다) */
  readonly limited: number;
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
  let limited = 0;
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
    else if (change.kind === "held") {
      const loss = Math.max(0, change.lossDb?.(chain) ?? 0);
      const target = dbOfVolume(profile, head.vol) + loss;
      // volumeForDb는 v최대에서 멈추므로, 게임 한도에 닿았는지는 줄인 dB가 v최대 소리보다 큰지로 본다
      const atMax = loss > 0 && target > dbOfVolume(profile, max) + 1e-9;
      const wanted = Math.max(head.vol, volumeForDb(profile, target));
      vol = Math.min(wanted, head.vol + change.maxUp);
      if (wanted > vol) limited++;
      else if (atMax) clamped++;
    } else {
      vol = head.vol + change.by;
      if (vol < min || vol > max) clamped++;
    }
    vol = Math.min(max, Math.max(min, Math.round(vol)));
    if (vol !== head.vol) changed++;
    byHead.set(head.id, vol);
  }
  return { notes: applyVolumes(notes, byHead), changed, count, clamped, limited, viaTie };
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

/**
 * 마디 범위 안에서 시작하는 소리(& 사슬은 첫 음)의 id. changeVolumes·volumeSpan의 picked로 쓴다.
 * 게임은 사슬 첫 음 v만 읽으므로, 범위 앞에서 시작해 범위로 이어지는 사슬은 넣지 않고
 * 범위 안에서 시작해 밖으로 이어지는 사슬은 넣는다
 */
export function headsInBars(notes: readonly Note[], timeSig: readonly TimeSigEvent[], ranges: readonly BarRange[]): Set<string> {
  const out = new Set<string>();
  for (const chain of tieChains(notes)) {
    const head = chain[0]!;
    if (inBars(ranges, barAt(timeSig, head.start))) out.add(head.id);
  }
  return out;
}
