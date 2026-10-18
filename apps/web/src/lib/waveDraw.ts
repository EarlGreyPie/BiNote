import { toFloat, type Note, type TempoEvent } from "@mmlce/core";
import { peakRange, wholeToSecondsFn, type Peaks } from "./waveform";

/** 원곡 파형 띠 높이(px). 피아노롤·타브가 같이 쓴다 */
export const WAVE_SIZE = 32;

/**
 * 원곡 파형 띠 하나 그리기 (피아노롤·타브가 같이 쓴다).
 * 시간 축은 axisStart부터 length px. 가로(horizontal)면 시간이 오른쪽으로, 세로면 위로 흐른다(세로 롤).
 * 띠는 시간 축과 수직인 방향 [at, at + size) 자리
 */
export interface WaveStrip {
  readonly peaks: Peaks;
  /** 원곡 어긋남(초, 원곡이 늦으면 양수): 곡 시간 s초에 원곡 s + offset초가 들린다 */
  readonly offset: number;
  readonly tempo: readonly TempoEvent[];
  /** 화면 시간 축이 시작하는 곡 위치(온음표 단위)와 온음표 하나의 px */
  readonly start: number;
  readonly pxPerWhole: number;
  /** 시간 축이 화면에서 시작하는 자리와 길이(px) */
  readonly axisStart: number;
  readonly length: number;
  readonly at: number;
  readonly size: number;
  readonly horizontal: boolean;
  /** 음이 시작하는 곡 위치(온음표 단위) → 같은 위치에서 시작하는 음 수 (noteStarts) */
  readonly starts: ReadonlyMap<number, number>;
  /** 곡 위치 → 화면 시간 축 자리(px) */
  readonly screenOf: (whole: number) => number;
  readonly css: (name: string) => string;
}

/** 보이는 시간 [from, to] 안에서 음이 시작하는 자리와 그 자리에서 같이 시작하는 음 수 */
export function noteStarts(tracks: readonly { readonly notes: readonly Note[] }[], from: number, to: number): Map<number, number> {
  const starts = new Map<number, number>();
  for (const t of tracks)
    for (const n of t.notes) {
      const at = toFloat(n.start);
      if (at >= from && at <= to) starts.set(at, (starts.get(at) ?? 0) + 1);
    }
  return starts;
}

/** 원곡 파형 띠: 시간 축 한 픽셀마다 그 사이 원곡의 가장 낮은·높은 값을 막대로, 내 곡 음이 시작하는 자리를 띠 아래쪽 눈금으로 */
export function drawWaveStrip(c: CanvasRenderingContext2D, w: WaveStrip): void {
  const seconds = wholeToSecondsFn(w.tempo);
  const mid = w.at + w.size / 2;
  // 원곡에서 가장 큰 소리가 띠 끝에 닿게 (조용하게 녹음한 원곡도 보이게)
  const half = (w.size / 2 - 1) / Math.max(1e-3, w.peaks.peak);
  c.fillStyle = w.css("--line");
  if (w.horizontal) c.fillRect(w.axisStart, w.at + w.size - 1, w.length, 1);
  else c.fillRect(w.at + w.size - 1, w.axisStart, 1, w.length);
  c.fillStyle = w.css("--accent");
  c.globalAlpha = 0.75;
  for (let px = 0; px < w.length; px++) {
    const t0 = w.start + px / w.pxPerWhole;
    const r = peakRange(w.peaks, seconds(t0) + w.offset, seconds(t0 + 1 / w.pxPerWhole) + w.offset);
    if (!r) continue;
    const a = mid - r[1] * half;
    const len = Math.max(1, (r[1] - r[0]) * half);
    // 가로는 시간이 오른쪽, 세로 롤은 위로 흐른다
    if (w.horizontal) c.fillRect(w.axisStart + px, a, 1, len);
    else c.fillRect(a, w.axisStart + w.length - px - 1, len, 1);
  }
  // 내 곡 음이 시작하는 자리를 띠 아래쪽 눈금으로 (원곡 박과 한 줄에서 견주게). 여러 음이 같이 시작하면 길게
  c.fillStyle = w.css("--text");
  c.globalAlpha = 0.6;
  for (const [at, count] of w.starts) {
    const p = w.screenOf(at);
    const len = count >= 3 ? 9 : 6;
    if (w.horizontal) c.fillRect(p, w.at + w.size - 1 - len, 1, len);
    else c.fillRect(w.at + w.size - 1 - len, p, len, 1);
  }
  c.globalAlpha = 1;
}
