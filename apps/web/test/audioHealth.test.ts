import { describe, expect, it } from "vitest";
import { clockMoves, needsRebuild, settlesWithin } from "../src/lib/audioHealth";

describe("잠자기 뒤 오디오 확인", () => {
  it("끝나지 않는 resume()을 오래 기다리지 않는다", async () => {
    expect(await settlesWithin(new Promise(() => {}), 20)).toBe(false);
    expect(await settlesWithin(Promise.resolve(), 20)).toBe(true);
    expect(await settlesWithin(Promise.reject(new Error("x")), 20)).toBe(false);
  });

  it("시계가 흐르는지 본다", async () => {
    let t = 0;
    expect(await clockMoves(() => (t += 0.01), 50)).toBe(true);
    expect(await clockMoves(() => 5, 40)).toBe(false);
  });

  it("닫혔거나 워크릿이 멈췄으면 언제나 새로 만든다", () => {
    expect(needsRebuild({ state: "closed", broken: false, suspect: false, clockMoved: false })).toBe(true);
    expect(needsRebuild({ state: "running", broken: true, suspect: false, clockMoved: true })).toBe(true);
  });

  it("잠자기 뒤 깨워도 시계가 멈춰 있으면 새로 만든다", () => {
    expect(needsRebuild({ state: "suspended", broken: false, suspect: true, clockMoved: false })).toBe(true);
    expect(needsRebuild({ state: "interrupted", broken: false, suspect: true, clockMoved: false })).toBe(true);
    expect(needsRebuild({ state: "running", broken: false, suspect: true, clockMoved: true })).toBe(false);
  });

  it("처음 켤 때 아직 누르지 않아 멈춰 있는 것은 새로 만들지 않는다", () => {
    expect(needsRebuild({ state: "suspended", broken: false, suspect: false, clockMoved: false })).toBe(false);
  });
});
