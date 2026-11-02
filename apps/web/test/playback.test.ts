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

describe("재생 중 고친 것 바로 듣기: 기다리는 곡 (beta.36 Codex 점검)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("$state", Object.assign(<T>(v: T) => v, { raw: <T>(v: T) => v }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** 다른 곡 객체 (Playback은 곡을 참조로 견준다) */
  const edited = (song: Song, title: string): Song => ({ ...song, meta: { ...song.meta, title } });

  function withUpdate() {
    const fake = fakeEngine();
    const updates: Song[] = [];
    Object.assign(fake.engine, {
      async update(song: Song) {
        updates.push(song);
        return { result: "live", unresolved: [] };
      },
    });
    return { ...fake, updates };
  }

  it("고친 뒤 120ms 안에 되돌리면 되돌린 편집을 엔진에 넣지 않는다", async () => {
    const { engine, updates } = withUpdate();
    const p = new Playback(engine as unknown as Engine);
    const a = t120();
    await p.play(a, undefined, undefined);
    const b = edited(a, "고침");
    p.followEdit(b, undefined);
    p.followEdit(a, undefined); // 되돌리기: 들리는 곡과 같다
    await vi.advanceTimersByTimeAsync(500);
    expect(updates).toEqual([]);
    p.stop();
  });

  it("기다리는 동안 멈추고 다시 재생하면 앞 재생의 곡을 새 재생에 넣지 않는다", async () => {
    const { engine, updates } = withUpdate();
    const p = new Playback(engine as unknown as Engine);
    const a = t120();
    await p.play(a, undefined, undefined);
    p.followEdit(edited(a, "앞 재생에서 고침"), undefined);
    p.stop();
    const c = edited(a, "새 재생");
    await p.play(c, undefined, undefined);
    await vi.advanceTimersByTimeAsync(500);
    expect(updates).toEqual([]);
    // 새 재생에서 고친 것은 그대로 들린다
    const d = edited(c, "새로 고침");
    p.followEdit(d, undefined);
    await vi.advanceTimersByTimeAsync(500);
    expect(updates).toEqual([d]);
    p.stop();
  });

  it("앞 재생의 넣기가 끝나기 전에 멈추고 다시 재생해 고치면, 앞 넣기가 끝난 뒤에도 새 재생의 고친 것이 들린다", async () => {
    const fake = fakeEngine();
    const updates: Song[] = [];
    const waiting: (() => void)[] = [];
    Object.assign(fake.engine, {
      async update(song: Song) {
        updates.push(song);
        // 첫 넣기만 음 준비가 오래 걸린다
        if (updates.length === 1) await new Promise<void>((resolve) => waiting.push(resolve));
        return { result: "live", unresolved: [] };
      },
    });
    const p = new Playback(fake.engine as unknown as Engine);
    const a = t120();
    await p.play(a, undefined, undefined);
    const b = edited(a, "앞 재생에서 고침");
    p.followEdit(b, undefined);
    await vi.advanceTimersByTimeAsync(200);
    expect(updates).toEqual([b]); // 아직 준비 중
    p.stop();
    const c = edited(a, "새 재생");
    await p.play(c, undefined, undefined);
    const d = edited(c, "새로 고침");
    p.followEdit(d, undefined);
    await vi.advanceTimersByTimeAsync(200);
    // 앞 넣기가 늦게 끝나도 새 재생의 고친 것은 넣는다
    waiting.shift()!();
    await vi.advanceTimersByTimeAsync(500);
    expect(updates).toEqual([b, d]);
    p.stop();
  });

  it("템포를 바꿔 다시 재생을 준비하는 동안 되돌리면, 준비가 끝난 뒤 되돌린 곡을 넣는다", async () => {
    const fake = fakeEngine();
    const updates: Song[] = [];
    const plays: (() => void)[] = [];
    const play = fake.engine.play;
    Object.assign(fake.engine, {
      async update(song: Song) {
        updates.push(song);
        // 처음 고친 것은 템포가 바뀌어 다시 재생, 그 뒤는 이어 붙이기
        return updates.length === 1 ? { result: "restart" } : { result: "live", unresolved: [] };
      },
      async play(...args: unknown[]) {
        // 두 번째 재생(다시 재생)은 준비가 오래 걸린다
        if (fake.log.plays.length >= 1) await new Promise<void>((resolve) => plays.push(resolve));
        return play(...args);
      },
    });
    const p = new Playback(fake.engine as unknown as Engine);
    const a = t120();
    await p.play(a, undefined, undefined);
    const b = { ...edited(a, "템포 고침"), tempo: [{ at: rat(0), bpm: 90 }] };
    p.followEdit(b, undefined);
    await vi.advanceTimersByTimeAsync(200);
    expect(updates).toEqual([b]);
    expect(plays).toHaveLength(1); // b로 다시 재생 준비 중
    p.followEdit(a, undefined); // 되돌리기
    plays.shift()!();
    await vi.advanceTimersByTimeAsync(500);
    expect(updates).toEqual([b, a]);
    p.stop();
  });
});
