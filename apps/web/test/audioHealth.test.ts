import { describe, expect, it } from "vitest";
import { clockMoves, isTouchWebKit, LATENCY_JUMP, LOCK_HIDDEN_MS, needsRebuild, settlesWithin, staleAfterReturn } from "../src/lib/audioHealth";

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

describe("화면을 가렸다 돌아온 뒤 오디오 새로 만들기 (아이패드 잠금 뒤 소리 밀림)", () => {
  const base = { warmed: true, interrupted: false, hiddenMs: 0, touchWebKit: false, latencyBefore: 0.01, latencyNow: 0.01 };

  it("소리를 낸 적이 없으면 새로 만들지 않는다", () => {
    expect(staleAfterReturn({ ...base, warmed: false, interrupted: true, touchWebKit: true, hiddenMs: 60_000 })).toBe(false);
  });

  it("가려진 사이 시스템이 오디오를 멈췄으면 다시 켜졌어도 새로 만든다", () => {
    expect(staleAfterReturn({ ...base, interrupted: true })).toBe(true);
  });

  it("아이패드·아이폰에서 오래 가려져 있었으면(화면 잠금) 새로 만든다", () => {
    expect(staleAfterReturn({ ...base, touchWebKit: true, hiddenMs: LOCK_HIDDEN_MS })).toBe(true);
    expect(staleAfterReturn({ ...base, touchWebKit: true, hiddenMs: LOCK_HIDDEN_MS - 1 })).toBe(false);
  });

  it("PC에서 다른 탭을 오래 보다 와도 오디오가 멀쩡하면 그대로 쓴다", () => {
    expect(staleAfterReturn({ ...base, hiddenMs: 600_000 })).toBe(false);
  });

  it("출력 지연이 크게 늘었으면 새로 만든다", () => {
    expect(staleAfterReturn({ ...base, latencyNow: base.latencyBefore + LATENCY_JUMP + 0.01 })).toBe(true);
    expect(staleAfterReturn({ ...base, latencyNow: base.latencyBefore + LATENCY_JUMP / 2 })).toBe(false);
    // 지연이 줄어든 것은 문제 삼지 않는다
    expect(staleAfterReturn({ ...base, latencyBefore: 0.3, latencyNow: 0.02 })).toBe(false);
  });

  it("아이패드·아이폰을 알아본다", () => {
    expect(isTouchWebKit("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5)).toBe(true);
    expect(isTouchWebKit("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5)).toBe(true);
    // 아이패드 사파리·크롬은 데스크톱(Macintosh)처럼 알린다
    expect(isTouchWebKit("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isTouchWebKit("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isTouchWebKit("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 10)).toBe(false);
  });
});
