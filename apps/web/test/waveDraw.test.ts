import { describe, expect, it } from "vitest";
import { rat, type Note } from "@mmlce/core";
import { peakRange, wholeToSecondsFn, type Peaks } from "../src/lib/waveform";
import { drawWaveStrip, noteStarts, WAVE_SIZE } from "../src/lib/waveDraw";

/** 그리기 호출을 적는 가짜 캔버스 */
function recorder() {
  const log: string[] = [];
  const g = {
    set fillStyle(v: string) {
      log.push(`fill ${v}`);
    },
    set globalAlpha(v: number) {
      log.push(`alpha ${v}`);
    },
    fillRect(x: number, y: number, w: number, h: number) {
      log.push(`rect ${x} ${y} ${w} ${h}`);
    },
  };
  return { g: g as unknown as CanvasRenderingContext2D, log };
}

/** 공통 함수로 빼기 전 피아노롤 drawWave와 같은 계산 (결과가 그대로인지 견주는 기준) */
function before(c: CanvasRenderingContext2D, o: { peaks: Peaks; offset: number; at: number; size: number; horizontal: boolean; keyboard: number; width: number; height: number; start: number; pxPerWhole: number; starts: Map<number, number> }) {
  const seconds = wholeToSecondsFn([]);
  const axis = o.horizontal ? o.width - o.keyboard : o.height - o.keyboard;
  const mid = o.at + o.size / 2;
  const half = (o.size / 2 - 1) / Math.max(1e-3, o.peaks.peak);
  c.fillStyle = "--line";
  if (o.horizontal) c.fillRect(o.keyboard, o.at + o.size - 1, axis, 1);
  else c.fillRect(o.at + o.size - 1, 0, 1, axis);
  c.fillStyle = "--accent";
  c.globalAlpha = 0.75;
  for (let px = 0; px < axis; px++) {
    const t0 = o.start + px / o.pxPerWhole;
    const r = peakRange(o.peaks, seconds(t0) + o.offset, seconds(t0 + 1 / o.pxPerWhole) + o.offset);
    if (!r) continue;
    const a = mid - r[1] * half;
    const len = Math.max(1, (r[1] - r[0]) * half);
    if (o.horizontal) c.fillRect(o.keyboard + px, a, 1, len);
    else c.fillRect(a, o.height - o.keyboard - px - 1, len, 1);
  }
  const screen = (at: number) => (o.horizontal ? o.keyboard + (at - o.start) * o.pxPerWhole : o.height - o.keyboard - (at - o.start) * o.pxPerWhole);
  c.fillStyle = "--text";
  c.globalAlpha = 0.6;
  for (const [at, count] of o.starts) {
    const p = screen(at);
    const len = count >= 3 ? 9 : 6;
    if (o.horizontal) c.fillRect(p, o.at + o.size - 1 - len, 1, len);
    else c.fillRect(o.at + o.size - 1 - len, p, len, 1);
  }
  c.globalAlpha = 1;
}

const peaks: Peaks = {
  perSecond: 10,
  min: Float32Array.from({ length: 40 }, (_, i) => -Math.abs(Math.sin(i))),
  max: Float32Array.from({ length: 40 }, (_, i) => Math.abs(Math.cos(i * 0.7))),
  peak: 1,
};
const note = (start: number, pitch: number): Note => ({ id: `${start}-${pitch}`, start: rat(start * 16, 16), dur: rat(1, 16), pitch, vol: 10, tie: "none" });

describe("원곡 파형 띠 공통 그리기 (지시서 27)", () => {
  const starts = noteStarts([{ notes: [note(0, 60), note(0, 64), note(0, 67), note(0.25, 62)] }, { notes: [note(0.5, 50)] }], 0, 2);
  it("음 시작 자리와 같이 시작하는 음 수", () => {
    expect([...starts]).toEqual([[0, 3], [0.25, 1], [0.5, 1]]);
  });
  for (const horizontal of [true, false]) {
    it(`빼기 전 피아노롤과 같은 그리기 (${horizontal ? "가로" : "세로"} 롤)`, () => {
      const o = { peaks, offset: 0.13, at: 20, size: WAVE_SIZE, horizontal, keyboard: 40, width: 200, height: 160, start: 0.1, pxPerWhole: 90, starts };
      const a = recorder();
      before(a.g, o);
      const b = recorder();
      drawWaveStrip(b.g, {
        peaks, offset: o.offset, tempo: [], start: o.start, pxPerWhole: o.pxPerWhole,
        axisStart: horizontal ? o.keyboard : 0, length: horizontal ? o.width - o.keyboard : o.height - o.keyboard,
        at: o.at, size: o.size, horizontal, starts,
        screenOf: (at) => (horizontal ? o.keyboard + (at - o.start) * o.pxPerWhole : o.height - o.keyboard - (at - o.start) * o.pxPerWhole),
        css: (name) => name,
      });
      expect(b.log).toEqual(a.log);
      expect(b.log.length).toBeGreaterThan(50);
    });
  }
});
