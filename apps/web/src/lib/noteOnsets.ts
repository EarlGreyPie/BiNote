import { add, cmp, tempoClock, type Note, type Rat, type TempoEvent } from "@mmlce/core";

/**
 * 악보 음 시작마다 가까운 원곡 소리 시작점 찾기. 소리만 듣고 박을 짐작하지 않고, 이미 찍은 음 자리를 기준으로
 * 그 곁(±창)에서만 찾는다. 음 시작에 템포 넣기(tempoSnap)가 쓰고, 템포로 때운 구간을 음 길이로 바꾸기도 다시 쓴다.
 * 원곡 시각과 곡 시각 사이 어긋남(원곡 어긋남)은 onset 함수가 맡는다 (곡 초를 받아 찾은 곡 초를 돌려준다)
 */

/** 구간 [from, to) 안에서 소리가 새로 나는 자리 (위치순, 같은 자리는 하나). & 로 같은 음을 이어 받은 음은 뺀다 */
export function attackPositions(tracks: readonly { readonly notes: readonly Note[] }[], from: Rat, to: Rat): Rat[] {
  const out: Rat[] = [];
  for (const t of tracks) {
    let prev: Note | undefined;
    for (const n of t.notes) {
      const held = prev && prev.tie === "next" && prev.pitch === n.pitch && cmp(add(prev.start, prev.dur), n.start) === 0;
      if (!held && cmp(n.start, from) >= 0 && cmp(n.start, to) < 0) out.push(n.start);
      prev = n;
    }
  }
  out.sort(cmp);
  return out.filter((at, i) => i === 0 || cmp(out[i - 1]!, at) !== 0);
}

/** 음 시작 하나의 찾은 결과. found: 원곡 시작점(곡 초), 못 찾았거나 앞뒤 순서를 넘어 버렸으면 undefined */
export interface OnsetMatch {
  readonly at: Rat;
  /** 지금 템포로 잰 곡 초 */
  readonly seconds: number;
  readonly found: number | undefined;
}

/** 이웃 음과 이만큼(초)은 떨어져야 받아들인다 (같은 원곡 시작점을 두 음이 나눠 갖지 않게) */
export const ONSET_MIN_GAP = 0.015;

/**
 * 자리마다 원곡 시작점을 찾는다. 앞뒤 순서를 넘는 결과는 버린다 (앞에서 받아들인 시각과 다음 음의 지금 시각 사이에
 * ONSET_MIN_GAP씩 떨어져 있어야 한다. 탭의 snapTaps와 같은 규칙). lower/upper: 구간 처음·끝처럼 움직이지 않는 이웃 시각
 */
export function matchOnsets(
  tempo: readonly TempoEvent[],
  positions: readonly Rat[],
  onset: (seconds: number) => number | undefined,
  bounds: { readonly lower?: number; readonly upper?: number } = {},
): OnsetMatch[] {
  const clock = tempoClock(tempo);
  const seconds = positions.map((at) => clock(at));
  const out: OnsetMatch[] = [];
  let before = bounds.lower ?? -Infinity;
  positions.forEach((at, i) => {
    const now = seconds[i]!;
    const next = seconds[i + 1] ?? bounds.upper ?? Infinity;
    const to = onset(now);
    const ok = to !== undefined && to > before + ONSET_MIN_GAP && to < next - ONSET_MIN_GAP;
    out.push({ at, seconds: now, found: ok ? to : undefined });
    // 못 찾은 음은 자리를 정하지 않으므로 (앞뒤 템포가 이어서 지나간다) 다음 음을 막지 않는다
    if (ok) before = to;
  });
  return out;
}
