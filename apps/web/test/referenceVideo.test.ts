import { describe, expect, it } from "vitest";
import { clampFloatBox, defaultFloatBox, FLOAT_MIN_WIDTH, isVideoFile, parseFloatBox, referenceVideoTime } from "../src/lib/referenceVideo";

describe("원곡 영상 띄우기", () => {
  it("영상 파일만 띄울 수 있다 (형식이 비면 확장자로)", () => {
    expect(isVideoFile({ name: "a.mp4", type: "video/mp4" })).toBe(true);
    expect(isVideoFile({ name: "a.m4a", type: "audio/mp4" })).toBe(false);
    expect(isVideoFile({ name: "a.MOV", type: "" })).toBe(true);
    expect(isVideoFile({ name: "a.wav", type: "" })).toBe(false);
  });

  it("영상 시간은 엔진이 원곡을 트는 자리(곡 시간 + 어긋남)와 같다", () => {
    expect(referenceVideoTime(10, 0)).toBe(10);
    expect(referenceVideoTime(10, 1500)).toBe(11.5);
    expect(referenceVideoTime(0.5, -2000)).toBe(-1.5);
  });

  it("창은 화면 밖으로 사라지지 않는다", () => {
    const b = clampFloatBox({ x: 5000, y: -40, width: 100 }, 1000, 700);
    expect(b.width).toBe(FLOAT_MIN_WIDTH);
    expect(b.x).toBeLessThanOrEqual(1000 - 48);
    expect(b.y).toBe(0);
    const left = clampFloatBox({ x: -5000, y: 5000, width: 300 }, 1000, 700);
    expect(left.x + left.width).toBeGreaterThanOrEqual(48);
    expect(left.y).toBeLessThanOrEqual(700 - 48);
    // 좁은 화면에서는 폭도 줄인다
    expect(clampFloatBox({ x: 0, y: 0, width: 900 }, 400, 700).width).toBe(384);
  });

  it("기본 자리는 화면 안 오른쪽 아래", () => {
    const b = defaultFloatBox(1200, 800);
    expect(b.width).toBe(400);
    expect(b.x + b.width).toBeLessThanOrEqual(1200);
    expect(b.y).toBeGreaterThan(400);
  });

  it("저장한 자리 글이 깨졌으면 버린다", () => {
    expect(parseFloatBox('{"x":1,"y":2,"width":300}')).toEqual({ x: 1, y: 2, width: 300 });
    expect(parseFloatBox('{"x":1}')).toBeUndefined();
    expect(parseFloatBox("{")).toBeUndefined();
    expect(parseFloatBox(null)).toBeUndefined();
  });
});
