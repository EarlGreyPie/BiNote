import { describe, expect, it } from "vitest";
import { limiterWorkletSource, PeakLimiter } from "../src/index.js";

const RATE = 48000;
const sine = (amp: number, n = RATE / 10) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / RATE));
const peak = (a: Float32Array, from = 0) => a.subarray(from).reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe("PeakLimiter", () => {
  it("문턱(−3dB) 아래 소리는 그대로, latency 샘플만큼 늦춰 내보낸다", () => {
    const left = sine(0.5);
    const right = sine(0.5);
    const before = Float32Array.from(left);
    const limiter = new PeakLimiter(RATE);
    limiter.process(left, right);
    expect(limiter.latency).toBe(144);
    expect(left.subarray(0, limiter.latency).every((v) => v === 0)).toBe(true);
    expect(left.subarray(limiter.latency)).toEqual(before.subarray(0, before.length - limiter.latency));
  });

  it("문턱을 크게 넘는 소리는 첫 샘플부터 문턱 둘레로 줄인다 (봉우리를 미리 본다)", () => {
    for (const amp of [2, 4, 8]) {
      const left = sine(amp);
      const right = sine(amp);
      new PeakLimiter(RATE).process(left, right);
      // 처음부터 끝까지 −3dB(≈0.708) 둘레: 비율 20이라 넘은 만큼의 1/20만 남는다
      expect(peak(left), `amp ${amp}`).toBeLessThan(0.85);
      expect(peak(left, RATE / 50), `amp ${amp}`).toBeGreaterThan(0.6);
    }
  });

  it("짧은 봉우리(한 샘플·짧은 타격)도 넘기지 않는다", () => {
    const single = new Float32Array(2000);
    single[500] = 2;
    const right = Float32Array.from(single);
    new PeakLimiter(RATE).process(single, right);
    expect(peak(single)).toBeLessThan(0.75);
    // 2ms 짜리 큰 타격 다음 조용한 소리
    const burst = Float32Array.from({ length: 4800 }, (_, i) => (i >= 100 && i < 196 ? (i % 2 ? -3 : 3) : 0.2 * Math.sin(i / 7)));
    new PeakLimiter(RATE).process(burst, Float32Array.from(burst));
    expect(peak(burst)).toBeLessThan(0.8);
  });

  it("블록으로 나눠 처리해도 한 번에 처리한 것과 같다 (재생은 128샘플씩)", () => {
    const a = sine(2);
    const b = Float32Array.from(a);
    const whole = new PeakLimiter(RATE);
    whole.process(a, Float32Array.from(a));
    const blocks = new PeakLimiter(RATE);
    const right = Float32Array.from(b);
    for (let i = 0; i < b.length; i += 128) blocks.process(b, right, i, Math.min(128, b.length - i));
    expect(b).toEqual(a);
  });

  it("재생용 워크릿 소스가 같은 리미터로 처리한다", () => {
    let Processor: (new () => { process(i: Float32Array[][], o: Float32Array[][]): boolean }) | undefined;
    class AudioWorkletProcessor {}
    // 워크릿 전역(sampleRate·registerProcessor)을 흉내 내어 소스를 실행한다
    new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor", limiterWorkletSource("t"))(
      AudioWorkletProcessor,
      RATE,
      (_: string, p: typeof Processor) => (Processor = p),
    );
    const node = new Processor!();
    const input = sine(2);
    const expected = Float32Array.from(input);
    const reference = new PeakLimiter(RATE);
    const out = [new Float32Array(128), new Float32Array(128)];
    for (let i = 0; i + 128 <= input.length; i += 128) {
      const block = input.subarray(i, i + 128);
      node.process([[block, block]], [out]);
      const l = expected.subarray(i, i + 128);
      reference.process(l, Float32Array.from(l));
      expect(out[0]).toEqual(Float32Array.from(l));
    }
  });
});
