import { describe, expect, it } from "vitest";
import { nextSynthLag, PING_MAX_ROUND, SYNTH_LAG_SLACK, SynthClock, synthLagOf } from "../src/lib/synthClock";

describe("신스 시계가 오디오 시계보다 뒤처진 만큼 재기", () => {
  it("시계가 맞으면 0에 가깝다", () => {
    expect(synthLagOf([{ sent: 10, received: 10, synth: 10 }])).toBe(0);
    expect(synthLagOf([{ sent: 10, received: 10.004, synth: 10.002 }])).toBeCloseTo(0, 6);
  });

  it("신스가 뒤처졌으면 그만큼을 돌려준다", () => {
    expect(synthLagOf([{ sent: 30, received: 30, synth: 29.85 }])).toBeCloseTo(0.15, 6);
  });

  it("물어보고 답 받기까지가 가장 짧은 재기를 쓴다", () => {
    const lag = synthLagOf([
      { sent: 5, received: 5.04, synth: 4.93 },
      { sent: 6, received: 6.002, synth: 5.901 },
    ]);
    expect(lag).toBeCloseTo(0.1, 6);
  });

  it("답이 너무 늦었거나 값이 이상한 재기는 버린다", () => {
    expect(synthLagOf([])).toBeUndefined();
    expect(synthLagOf([{ sent: 1, received: 1 + PING_MAX_ROUND + 0.01, synth: 1 }])).toBeUndefined();
    expect(synthLagOf([{ sent: 2, received: 1.9, synth: 1 }])).toBeUndefined();
    expect(synthLagOf([{ sent: 2, received: 2, synth: Number.NaN }])).toBeUndefined();
  });

  it("재는 오차만큼 작으면 0으로, 지금 값과 거의 같으면 그대로 둔다", () => {
    expect(nextSynthLag(0, SYNTH_LAG_SLACK / 2)).toBe(0);
    expect(nextSynthLag(0.12, 0.003)).toBe(0);
    expect(nextSynthLag(0.12, 0.122)).toBe(0.12);
    expect(nextSynthLag(0.12, 0.2)).toBe(0.2);
    expect(nextSynthLag(0, 0.05)).toBe(0.05);
  });
});

describe("예약 시각을 신스 시계로 바꾸기", () => {
  it("뒤처진 만큼 앞당겨 넣는다", () => {
    const clock = new SynthClock();
    clock.lag = 0.1;
    expect(clock.at(5)).toBeCloseTo(4.9, 9);
    expect(clock.on(0, 60, 5)).toBeCloseTo(4.9, 9);
    expect(clock.off(0, 60, 5.5)).toBeCloseTo(5.4, 9);
  });

  it("값이 커진 뒤에도 짧은 음의 끄기가 켜기보다 앞서지 않는다", () => {
    const clock = new SynthClock();
    const on = clock.on(1, 64, 10);
    clock.lag = 0.08;
    // 0.03초짜리 음: 그대로 빼면 9.95로 켜기(10)보다 앞선다
    expect(clock.off(1, 64, 10.03)).toBe(on);
    // 다른 음·다른 채널은 그대로
    expect(clock.off(1, 65, 10.03)).toBeCloseTo(9.95, 9);
    expect(clock.off(2, 64, 10.03)).toBeCloseTo(9.95, 9);
  });

  it("정지할 때 앞날의 켜기는 그 켜기를 넣은 시각에 끊는다", () => {
    const clock = new SynthClock();
    clock.lag = 0.02;
    const first = clock.on(3, 60, 20);
    const second = clock.on(3, 62, 20.2);
    clock.lag = 0.09;
    expect(clock.cut(3, 20)).toBe(first);
    expect(clock.cut(3, 20.2)).toBe(second);
    // 켜기와 상관없는 끊기(정지 뒤 한 번 더)는 지금 값으로
    expect(clock.cut(3, 19.5)).toBeCloseTo(19.41, 9);
    expect(clock.cut(4, 20)).toBeCloseTo(19.91, 9);
  });
});
