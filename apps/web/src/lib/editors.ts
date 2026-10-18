/**
 * 트랙 패널의 편집기 여러 개(위 편집기 하나 + 아래 편집기들). 위 편집기는 고른 트랙이고,
 * 아래 칸마다 사용자가 고른 트랙(chosen)이 있다. 같은 트랙은 두 칸에 열지 않는다 (같은 글을 두 곳에서 고치지 않게).
 */

/**
 * 아래 칸들에 실제로 여는 트랙 (칸 순서대로, 길이 = 편집기 수 − 1, 단 곡 트랙 수보다 많이는 열지 않는다).
 * 칸마다 고른 트랙이 없거나 지워졌거나 위·앞 칸과 겹치면, 곡 트랙 순서에서 고른 트랙 다음부터 아직 안 연 트랙으로 채운다
 */
export function fillEditorTracks(trackIds: readonly string[], activeId: string | undefined, chosen: readonly (string | undefined)[], count: number): string[] {
  const used = new Set<string>(activeId !== undefined && trackIds.includes(activeId) ? [activeId] : []);
  const slots = Math.max(0, Math.min(count - 1, trackIds.length - used.size));
  const out: (string | undefined)[] = [];
  for (let i = 0; i < slots; i++) {
    const c = chosen[i];
    if (c !== undefined && trackIds.includes(c) && !used.has(c)) {
      out.push(c);
      used.add(c);
    } else out.push(undefined);
  }
  const from = activeId === undefined ? -1 : trackIds.indexOf(activeId);
  const order = [...trackIds.slice(from + 1), ...trackIds.slice(0, from + 1)];
  let k = 0;
  return out.map((id) => {
    if (id !== undefined) return id;
    while (used.has(order[k]!)) k++;
    const next = order[k]!;
    used.add(next);
    return next;
  });
}

/**
 * 위 편집기에서 아래 칸에 열려 있던 트랙을 고르면 그 칸에 원래 위에 있던 트랙을 넣는다 (맞바꾸기).
 * 새 chosen (지금 열린 칸을 그대로 고정), 맞바꿀 것이 없으면 undefined
 */
export function swapIntoEditors(shown: readonly string[], prevActive: string | undefined, nowActive: string | undefined): string[] | undefined {
  if (prevActive === undefined || nowActive === undefined || prevActive === nowActive) return undefined;
  const i = shown.indexOf(nowActive);
  if (i < 0) return undefined;
  return shown.map((id, k) => (k === i ? prevActive : id));
}

/** 아래 칸 트랙을 바꿀 칸: 가장 오래전에 바뀐 칸 (바뀐 적 없는 칸이 먼저, 같으면 앞 칸) */
export function oldestEditor(stamps: readonly (number | undefined)[], slots: number): number {
  let best = 0;
  for (let i = 1; i < slots; i++) if ((stamps[i] ?? -1) < (stamps[best] ?? -1)) best = i;
  return best;
}

/** 저장해 둔 편집기 수. 없으면 예전 "편집기 둘 나란히"(mmlce.dualEditor = "1")를 2로 옮기고, 그것도 없으면 1. 1 ~ max */
export function parseEditorCount(raw: string | null, legacyDual: string | null, max: number): number {
  const n = Number(raw);
  if (raw !== null && Number.isInteger(n) && n >= 1) return Math.min(n, max);
  return legacyDual === "1" ? Math.min(2, max) : 1;
}

/** 저장해 둔 편집기 최대치. 2 ~ limit(한 악보 트랙 수), 없거나 모르는 값이면 4 (limit보다 크면 limit) */
export function parseEditorMax(raw: string | null, limit: number): number {
  const n = Number(raw);
  if (raw !== null && Number.isInteger(n) && n >= 2 && n <= limit) return n;
  return Math.min(4, limit);
}
