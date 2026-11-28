import { describe, expect, it } from "vitest";
import { effectiveOutputDelay, OUTPUT_DELAY_MAX, OutputDelay, outputDelayOf } from "../src/lib/outputDelay";

describe("실제 출력 지연 재기", () => {
  it("출력 시각으로 지금 들리는 소리와 오디오 시계의 차이를 잰다", () => {
    // 1초 전(벽시계) 스피커에서 오디오 시각 9.5가 났다 → 지금 들리는 것은 10.5, 오디오 시계는 10.8
    expect(outputDelayOf({ contextTime: 9.5, performanceTime: 1000 }, 10.8, 2000)).toBeCloseTo(0.3, 9);
  });

  it("모르거나 믿을 수 없는 출력 시각은 쓰지 않는다", () => {
    expect(outputDelayOf(undefined, 1, 1)).toBeUndefined();
    expect(outputDelayOf({}, 1, 1)).toBeUndefined();
    expect(outputDelayOf({ contextTime: 0, performanceTime: 0 }, 1, 1)).toBeUndefined();
    // 들리는 소리가 오디오 시계보다 앞설 수는 없다
    expect(outputDelayOf({ contextTime: 2, performanceTime: 1000 }, 1, 1000)).toBeUndefined();
    // 깨어난 직후의 옛 출력 시각
    expect(outputDelayOf({ contextTime: 1, performanceTime: 1000 }, 1 + OUTPUT_DELAY_MAX + 0.5, 1000)).toBeUndefined();
  });

  it("세 번 넘게 잰 가운데 값을 쓰고, 조금 흔들리면 그대로 둔다", () => {
    const d = new OutputDelay();
    d.add(0.3);
    d.add(0.31);
    expect(d.value).toBeUndefined();
    d.add(0.9);
    expect(d.value).toBeCloseTo(0.31, 9);
    d.add(0.305);
    d.add(0.302);
    expect(d.value).toBeCloseTo(0.31, 9);
    d.add(undefined);
    expect(d.value).toBeCloseTo(0.31, 9);
    d.clear();
    expect(d.value).toBeUndefined();
  });

  it("잰 값이 알려 준 지연보다 뚜렷이 클 때만 재생선에 쓴다", () => {
    expect(effectiveOutputDelay(0.01, undefined)).toBe(0.01);
    expect(effectiveOutputDelay(0.01, 0.02)).toBe(0.01);
    expect(effectiveOutputDelay(0.01, 0.35)).toBe(0.35);
    // 블루투스처럼 브라우저가 큰 지연을 알려 주면 그 값을 그대로 쓴다
    expect(effectiveOutputDelay(0.2, 0.05)).toBe(0.2);
  });
});
