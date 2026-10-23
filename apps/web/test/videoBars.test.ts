import { describe, expect, it } from "vitest";
import { pickBarStarts, tintedCount, toLevels, type ScanSample } from "../src/lib/videoBars";

const W = 40;
const H = 20;

/** 흰 바탕 RGBA 프레임에 마디 상자(가로 x0..x1)를 칠하고 검은 음표 몇 개를 찍는다 */
function frame(box: [number, number] | undefined, color: [number, number, number] = [220, 220, 220]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (box && x >= box[0] && x < box[1] && y >= 4 && y < 16) out.set(color, i);
      if (y === 10 && x % 7 === 0) out.set([0, 0, 0], i);
    }
  return out;
}

describe("영상 마디 넘김 찾기", () => {
  it("상자가 다음 마디로 옮겨지면 새로 칠해진 점만 센다", () => {
    const a = toLevels(frame([0, 10]));
    const b = toLevels(frame([10, 20]));
    // 새 상자 10×12점 가운데 검은 음표 자리(x=14) 1점은 빠진다
    expect(tintedCount(a, b)).toBe(10 * 12 - 1);
    expect(tintedCount(b, b)).toBe(0);
  });

  it("연한 노랑 상자도 흰 바탕과 구별한다", () => {
    expect(tintedCount(toLevels(frame(undefined)), toLevels(frame([0, 10], [255, 250, 200])))).toBe(10 * 12 - 2);
  });

  it("서서히 밝기가 바뀌는 화면 전환은 세지 않는다", () => {
    const a = toLevels(frame(undefined));
    const b = a.map((v) => (v === 255 ? 245 : v));
    expect(tintedCount(a, b)).toBe(0);
  });

  it("문턱을 넘는 변화만 고르고, 너무 가까운 두 변화는 하나로 본다", () => {
    const samples: ScanSample[] = [
      { time: 0, count: 0 },
      { time: 1, count: 100 },
      { time: 1.1, count: 90 },
      { time: 1.5, count: 3 },
      { time: 2, count: 120 },
      { time: 3, count: 110 },
    ];
    expect(pickBarStarts(samples, 1000)).toEqual([1, 2, 3]);
  });

  it("맨 앞 제목 화면과 맨 끝 화면처럼 멀리 떨어진 변화는 뺀다", () => {
    // 실제 악보 영상에서 잰 시각: 2.63초는 제목 화면에서 악보로 바뀐 때
    const times = [2.633, 8.733, 9.633, 10.767, 12.2, 12.967, 14.0, 14.7, 15.6, 30];
    const samples = times.map((time) => ({ time, count: 500 }));
    expect(pickBarStarts(samples, 14400)).toEqual(times.slice(1, -1));
  });

  it("변화가 적으면 그대로 돌려준다", () => {
    expect(pickBarStarts([{ time: 1, count: 500 }, { time: 9, count: 500 }], 14400)).toEqual([1, 9]);
  });
});
