import { add, cmp, mul, rat, toFloat, ZERO, type Rat } from "./rat.js";
import type { TimeSigEvent } from "./model.js";

/** 박자표 분모로 쓸 수 있는 값 (2의 거듭제곱) */
export const METER_UNITS = [1, 2, 4, 8, 16, 32] as const;

/**
 * 박자표 하나의 격자 (온음표 단위).
 * - unit: 분모 한 칸 (3/4면 4분음표, 6/8이면 8분음표)
 * - beat: 센박 간격. 6/8·9/8·12/8 같은 겹박자는 분모 세 칸이 한 박
 * - measure: 한 마디
 * MMLCS 피아노롤(meter_grid_ticks)과 같은 규칙이다.
 */
export function meterGrid(sig: Pick<TimeSigEvent, "beats" | "unit">): { unit: Rat; beat: Rat; measure: Rat } {
  const unit = rat(1, Math.max(1, sig.unit));
  const compound = sig.unit === 8 && sig.beats > 3 && sig.beats % 3 === 0;
  return { unit, beat: compound ? mul(unit, rat(3)) : unit, measure: mul(unit, rat(Math.max(1, sig.beats))) };
}

export interface GridLine {
  /** 곡 위치 (온음표 단위, 실수) */
  readonly at: number;
  readonly kind: "measure" | "beat" | "unit";
  /** 마디선이면 마디 번호 (1부터) */
  readonly bar?: number;
}

/**
 * [from, to) 안의 마디선·박선·분모 칸선. 곡 중간에 박자가 바뀌면 그 자리에서 새 마디를 시작한다.
 * 박자표가 없으면 4/4로 본다.
 */
export function gridLines(timeSig: readonly TimeSigEvent[], from: number, to: number): GridLine[] {
  const sigs = [...timeSig].sort((a, b) => cmp(a.at, b.at));
  const segments = sigs.length === 0 || cmp(sigs[0]!.at, ZERO) > 0 ? [{ at: ZERO, beats: 4, unit: 4 }, ...sigs] : sigs;
  const out: GridLine[] = [];
  let bar = 1;
  segments.forEach((sig, i) => {
    const next = segments[i + 1]?.at;
    const { unit, beat, measure } = meterGrid(sig);
    const end = next ? toFloat(next) : Infinity;
    const start = toFloat(sig.at);
    const measureLen = toFloat(measure);
    const unitLen = toFloat(unit);
    // 이 구간에서 보이는 첫 칸까지 건너뛰되, 마디 번호는 건너뛴 마디만큼 센다
    const firstUnit = Math.max(0, Math.floor((Math.max(from, start) - start) / unitLen - 1e-9));
    const unitsPerMeasure = Math.round(measureLen / unitLen);
    const unitsPerBeat = Math.round(toFloat(beat) / unitLen);
    for (let k = firstUnit; ; k++) {
      const at = start + k * unitLen;
      if (at >= end - 1e-9 || at >= to) break;
      if (at < from - 1e-9) continue;
      if (k % unitsPerMeasure === 0) out.push({ at, kind: "measure", bar: bar + k / unitsPerMeasure });
      else out.push({ at, kind: k % unitsPerBeat === 0 ? "beat" : "unit" });
    }
    if (next) bar += Math.ceil((toFloat(next) - start) / measureLen - 1e-9);
  });
  return out;
}

/** 이 위치에 걸린 박자표 (없으면 4/4) */
export function meterAt(timeSig: readonly TimeSigEvent[], at: Rat): TimeSigEvent {
  let found: TimeSigEvent = { at: ZERO, beats: 4, unit: 4 };
  for (const s of [...timeSig].sort((a, b) => cmp(a.at, b.at))) if (cmp(s.at, at) <= 0) found = s;
  return found;
}

/** 위치가 속한 마디의 시작 (박자 바뀜을 따라 센다) */
export function measureStart(timeSig: readonly TimeSigEvent[], at: Rat): Rat {
  const sig = meterAt(timeSig, at);
  const { measure } = meterGrid(sig);
  let pos = sig.at;
  while (cmp(add(pos, measure), at) <= 0) pos = add(pos, measure);
  return pos;
}

/** 위치의 마디 번호(1부터)와 그 마디 안 박(1부터, 박 사이면 소수). 경고 위치 표시용 */
export function barBeatAt(timeSig: readonly TimeSigEvent[], at: Rat): { bar: number; beat: number } {
  const sigs = [...timeSig].sort((a, b) => cmp(a.at, b.at));
  const segments = sigs.length === 0 || cmp(sigs[0]!.at, ZERO) > 0 ? [{ at: ZERO, beats: 4, unit: 4 }, ...sigs] : sigs;
  let bar = 1;
  for (let i = 0; i < segments.length; i++) {
    const sig = segments[i]!;
    const next = segments[i + 1];
    const { beat, measure } = meterGrid(sig);
    const measureLen = toFloat(measure);
    if (!next || cmp(at, next.at) < 0) {
      const offset = toFloat(at) - toFloat(sig.at);
      const k = Math.floor(offset / measureLen + 1e-9);
      const inBar = offset - k * measureLen;
      return { bar: bar + k, beat: Math.round((inBar / toFloat(beat) + 1) * 100) / 100 };
    }
    bar += Math.ceil((toFloat(next.at) - toFloat(sig.at)) / measureLen - 1e-9);
  }
  return { bar, beat: 1 };
}
