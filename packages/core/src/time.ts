import { add, cmp, mul, rat, sub, toFloat, ZERO, type Rat } from "./rat.js";
import type { TempoEvent } from "./model.js";

/** 템포 지도가 비었거나 0 위치에 템포가 없을 때 쓰는 값 (MML 기본 t120). */
export const DEFAULT_BPM = 120;

/** 위치 순으로 정렬하고, 같은 위치에 여러 개면 마지막 것만 남긴다. */
export function normalizeTempo(events: readonly TempoEvent[]): TempoEvent[] {
  const sorted = [...events].sort((a, b) => cmp(a.at, b.at));
  const out: TempoEvent[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    if (last && cmp(last.at, e.at) === 0) out[out.length - 1] = e;
    else out.push(e);
  }
  return out;
}

function wholeNoteSeconds(bpm: number): number {
  // bpm은 4분음표 기준이므로 온음표 = 4박.
  return (4 * 60) / bpm;
}

/** 곡 위치(온음표 단위)를 초로 바꾼다. 템포 지도는 곡 전체에 하나. 여러 위치를 바꿀 때는 tempoClock이 빠르다 */
export function positionToSeconds(tempo: readonly TempoEvent[], pos: Rat): number {
  return tempoClock(tempo)(pos);
}

/**
 * 템포 지도를 한 번 정리해 두고 위치 → 초를 바꾸는 함수. 템포마다 그 자리까지의 누적 초를 미리 더해 두고
 * 위치 앞 마지막 템포를 이진 탐색으로 찾는다 (음마다 지도를 다시 정렬하고 처음부터 훑지 않게).
 * 누적 초는 앞에서부터 같은 순서로 더하므로 하나씩 훑어 더한 값과 소수 끝자리까지 같다. 자리 비교는 분수로 한다
 */
export function tempoClock(tempo: readonly TempoEvent[]): (pos: Rat) => number {
  const events = normalizeTempo(tempo);
  // marks[i]: 템포 i개를 지난 자리·그때까지의 초·그 뒤 빠르기 (marks[0]은 곡 처음, 기본 빠르기)
  const marks: { at: Rat; seconds: number; bpm: number }[] = [{ at: ZERO, seconds: 0, bpm: DEFAULT_BPM }];
  for (const e of events) {
    const last = marks[marks.length - 1]!;
    marks.push({ at: e.at, seconds: last.seconds + toFloat(sub(e.at, last.at)) * wholeNoteSeconds(last.bpm), bpm: e.bpm });
  }
  return (pos) => {
    // pos보다 앞에 있는 템포 수 (pos와 같은 자리의 템포는 아직 지나지 않았다)
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(events[mid]!.at, pos) < 0) lo = mid + 1;
      else hi = mid;
    }
    const m = marks[lo]!;
    return m.seconds + toFloat(sub(pos, m.at)) * wholeNoteSeconds(m.bpm);
  };
}

/**
 * 초를 곡 위치(온음표 단위, 소수)로. 재생 위치 표시처럼 화면에만 쓰는 값이라 분수로 만들지 않는다.
 */
export function secondsToWhole(tempo: readonly TempoEvent[], seconds: number): number {
  const events = normalizeTempo(tempo);
  let elapsed = 0;
  let cursor = 0;
  let bpm = DEFAULT_BPM;
  for (const e of events) {
    const at = toFloat(e.at);
    const span = (at - cursor) * wholeNoteSeconds(bpm);
    if (elapsed + span > seconds) break;
    elapsed += span;
    cursor = at;
    bpm = e.bpm;
  }
  return cursor + (seconds - elapsed) / wholeNoteSeconds(bpm);
}

/**
 * origin 기준으로 위치를 factor배 한다. 템포 범위 변환(t288 → t144)은
 * 음길이 숫자를 2배(l4 → l8) 하므로 온음표 단위 위치에는 HALF를 곱한다.
 */
export function scaleFrom(origin: Rat, pos: Rat, factor: Rat): Rat {
  return add(origin, mul(sub(pos, origin), factor));
}

export const HALF = rat(1, 2);
export const DOUBLE = rat(2);
