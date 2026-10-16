import { add, cmp, sub, type Rat } from "@mmlce/core";

/**
 * 채널 배정 (설계 11장). 압축이 끝난 음을 화음 트랙에 나눠 넣는다.
 * 트랙 0이 맨위, 마지막 트랙이 맨아래(서브음). EarlGreyPie 규칙대로 "위치보다 연속성"이다:
 * 새로 시작하는 음은 각 트랙의 앞 음과 높이 차가 가장 작은 쪽으로 이어 가고(손·보표를 넘나들어도 됨),
 * 그 자리에서 가장 낮은 음(서브음)은 맨아래 트랙이 받는다. 파트가 바뀌면 가까운 트랙이 이어받는다.
 */
export interface VoiceNote {
  readonly start: Rat;
  readonly dur: Rat;
  readonly pitch: number;
}

export function assignVoices<T extends VoiceNote>(notes: readonly T[], count: number): T[][] {
  // 입력 칸을 비우거나 0을 넣는 중에도 멈추지 않게 1 이상의 정수로 맞춘다
  count = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start) || b.pitch - a.pitch);
  let width = 0;
  const tracks: T[][] = [];
  const ends: Rat[] = [];
  const last: (number | undefined)[] = [];

  for (let i = 0; i < sorted.length; ) {
    const at = sorted[i]!.start;
    const group: T[] = [];
    while (i < sorted.length && cmp(sorted[i]!.start, at) === 0) group.push(sorted[i++]!);
    // 비어 있는 트랙 (필요하면 한도까지 새로 연다)
    let free = tracks.map((_, k) => k).filter((k) => cmp(ends[k]!, at) <= 0);
    while (free.length < group.length && width < count) {
      tracks.push([]);
      ends.push(at);
      last.push(undefined);
      free.push(width++);
    }
    if (free.length < group.length) {
      // 한도를 넘는 음은 압축 단계에서 걸러져야 한다. 혹시 남으면 가장 먼저 끝나는 트랙을 끊고 넣는다
      const busy = tracks.map((_, k) => k).filter((k) => !free.includes(k)).sort((a, b) => cmp(ends[a]!, ends[b]!));
      free = [...free, ...busy.slice(0, group.length - free.length)].sort((a, b) => a - b);
    }
    free.sort((a, b) => a - b);
    // 그 자리에서 울리는 음 중 가장 낮은 음이 새 음이면 서브음
    const held = tracks.map((_, k) => k).filter((k) => !free.includes(k)).map((k) => last[k]!);
    const lowest = Math.min(...group.map((n) => n.pitch));
    const bass = held.every((p) => p > lowest) ? lowest : undefined;
    const pick = match(group.map((n) => n.pitch), free, last, width, bass);
    group.forEach((n, j) => {
      const k = pick[j]!;
      const prev = tracks[k]!.at(-1);
      if (prev && cmp(add(prev.start, prev.dur), at) > 0) {
        tracks[k]![tracks[k]!.length - 1] = { ...prev, dur: sub(at, prev.start) };
      }
      tracks[k]!.push(n);
      ends[k] = add(n.start, n.dur);
      last[k] = n.pitch;
    });
  }
  return tracks;
}

/**
 * 새 음들을 빈 트랙에 넣는 배정 중 비용이 가장 작은 것 (빈 트랙은 최대 6개라 모두 따져 본다).
 * 비용 = |음 - 그 트랙의 앞 음|. 앞 음이 없는 트랙은 위치에 따른 기준 높이와 비교한다.
 * 서브음은 맨아래 트랙에 넣으면 비용을 깎고, 다른 음이 맨아래 트랙에 들어가면 비용을 더한다(샘플 4곡에서 글자 수가 가장 적었던 값). 같은 비용이면 높은 음이 위 트랙으로 간다.
 */
function match(
  pitches: readonly number[],
  free: readonly number[],
  last: readonly (number | undefined)[],
  width: number,
  bass: number | undefined,
): number[] {
  const bottom = width - 1;
  const cost = (p: number, track: number) => {
    const ref = last[track] ?? 84 - (track * 36) / Math.max(1, width - 1);
    let c = Math.abs(p - ref);
    if (bass !== undefined && track === bottom) c += p === bass ? -12 : 6;
    return c;
  };
  let best: number[] = [];
  let bestCost = Infinity;
  const used = new Array<boolean>(free.length).fill(false);
  const pick: number[] = [];
  const walk = (j: number, sum: number) => {
    if (sum >= bestCost) return;
    if (j === pitches.length) {
      bestCost = sum;
      best = [...pick];
      return;
    }
    for (let k = 0; k < free.length; k++) {
      if (used[k]) continue;
      used[k] = true;
      pick.push(free[k]!);
      // 높은 음일수록 위 트랙을 먼저 시도해 같은 비용이면 순서가 지켜지게 한다
      walk(j + 1, sum + cost(pitches[j]!, free[k]!) + k * 1e-6 * (pitches.length - j));
      pick.pop();
      used[k] = false;
    }
  };
  walk(0, 0);
  return best;
}
