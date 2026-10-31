import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySong, rat, type Song } from "@mmlce/core";
import type { Engine } from "../src/lib/engine";
import { Playback } from "../src/lib/playback.svelte";

const t120 = (): Song => ({ ...emptySong({ title: "", author: "", profileId: "mobile" }), tempo: [{ at: rat(0), bpm: 120 }] });

/** 소리 없는 엔진: 재생 요청과 메트로놈 딸깍만 적어 둔다 */
function fakeEngine() {
  const log = { plays: [] as unknown[][], clicks: [] as number[], cleared: 0 };
  let heard: number | undefined;
  const engine = {
    onEnd: undefined as (() => void) | undefined,
    playing: false,
    position: 0,
    runClock: {
      heard: () => (engine.playing ? heard : undefined),
      click: (at: number) => log.clicks.push(at),
    },
    clearClicks: () => log.cleared++,
    async play(...args: unknown[]) {
      log.plays.push(args);
      engine.playing = true;
      heard = -0.1;
      return [];
    },
    stop() {
      engine.playing = false;
    },
  };
  return { engine, log, hear: (at: number) => (heard = at) };
}

describe("일반 재생 메트로놈 연결 (점검 S24 재점검)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    // 저장소 전체 시험은 svelte 변환 없이 돈다: 룬은 값을 그대로 돌려주는 함수로 둔다
    vi.stubGlobal("$state", Object.assign(<T>(v: T) => v, { raw: <T>(v: T) => v }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("예비박을 켜면 한 마디(재생 속도로 늘린 오디오 초)를 비우고 딸깍 넷, 메트로놈을 켜면 박도", async () => {
    const { engine, log } = fakeEngine();
    const p = new Playback(engine as unknown as Engine);
    p.setMetronome(true);
    await p.play(t120(), undefined, undefined, 0.5, undefined, { countIn: true });
    const lead = log.plays[0]![5] as { leadIn: number; endless: boolean };
    expect(lead.leadIn).toBeCloseTo(4);
    expect(lead.endless).toBe(false);
    expect(log.clicks.slice(0, 4)).toEqual([-2, -1.5, -1, -0.5]);
    expect(log.clicks.slice(4, 7)).toEqual([0, 0.5, 1]);
    p.stop();
  });

  it("녹음·짧게 듣기에는 일반 재생 메트로놈을 울리지 않고, 녹음 중에 메트로놈을 꺼도 녹음 딸깍은 끄지 않는다", async () => {
    const { engine, log } = fakeEngine();
    const p = new Playback(engine as unknown as Engine);
    p.setMetronome(true);
    await p.play(t120(), undefined, undefined, 1, undefined, { record: true });
    expect((log.plays[0]![5] as { endless: boolean }).endless).toBe(true);
    expect(log.clicks).toEqual([]);
    p.setMetronome(false);
    expect(log.cleared).toBe(0);
    p.setMetronome(true);
    await p.play(t120(), undefined, undefined, 1, undefined, { noClicks: true });
    expect(log.clicks).toEqual([]);
    p.stop();
  });

  it("재생 중에 켜면 지금 자리부터 울리고, 끄면 남은 딸깍을 끈다. 곡이 끝나도 끈다", async () => {
    const { engine, log, hear } = fakeEngine();
    const p = new Playback(engine as unknown as Engine);
    await p.play(t120(), undefined, undefined);
    expect(log.clicks).toEqual([]);
    hear(3.2);
    p.setMetronome(true);
    expect(log.clicks).toEqual([3.5, 4, 4.5]);
    p.setMetronome(false);
    expect(log.cleared).toBe(1);
    p.setMetronome(true);
    engine.playing = false;
    engine.onEnd?.();
    expect(log.cleared).toBe(2);
    expect(p.playing).toBe(false);
  });
});
