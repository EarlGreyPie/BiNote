import { describe, expect, it } from "vitest";
import { assignPatches, SoundPackRegistry, type InstrumentGains, type PresetSource, type Schedule } from "@mmlce/audio";
import { preparePlay } from "../src/lib/playPlan";

const harp: PresetSource = { presets: [{ program: 24, bankMSB: 0, name: "Harp" }] };
const schedule: Schedule = { slots: [{ key: "t1", instrument: "harp", program: 24 }], events: [], duration: 0 };

/** 엔진처럼 팩 구성 세대 번호와 악기별 음량을 들고, 예열(prepare) 중에 할 일을 끼워 넣는 모의 재생 */
function fakeEngine() {
  const registry = new SoundPackRegistry();
  registry.add("pack-a.dls#0", "pack-a.dls", harp);
  registry.add("pack-b.dls#1", "pack-b.dls", harp);
  const state = { version: 0, gains: {} as InstrumentGains, request: 1, current: 1, prepared: [] as string[][] };
  const run = (during: () => void) => {
    let first = true;
    return preparePlay({
      plan: () => ({ schedule, ...assignPatches(schedule, registry, state.gains) }),
      prepare: async ({ patches }) => {
        state.prepared.push(patches.map((p) => p.packId));
        await Promise.resolve();
        if (first) {
          first = false;
          during();
        }
      },
      packVersion: () => state.version,
      cancelled: () => state.request !== state.current,
      gainOf: (packId, program) => registry.gainOf(packId, program, state.gains),
    });
  };
  return { registry, state, run };
}

describe("preparePlay: 예열 중 바뀐 팩·음량", () => {
  it("예열 중 팩 A를 빼면 A로 시작하지 않고 다시 정해 B로 시작한다", async () => {
    const { registry, state, run } = fakeEngine();
    const plan = await run(() => {
      state.version++;
      registry.remove("pack-a.dls#0");
    });
    expect(state.prepared).toEqual([["pack-a.dls#0"], ["pack-b.dls#1"]]);
    expect(plan!.patches.map((p) => p.packId)).toEqual(["pack-b.dls#1"]);
  });

  it("예열 중 팩 순서를 바꿔도 새 순서로 시작한다", async () => {
    const { registry, state, run } = fakeEngine();
    const plan = await run(() => {
      state.version++;
      registry.setOrder(["pack-b.dls#1", "pack-a.dls#0"]);
    });
    expect(plan!.patches[0]!.packId).toBe("pack-b.dls#1");
  });

  it("예열 중 악기별 음량을 바꾸면 시작 패치에 새 음량이 실린다", async () => {
    const { state, run } = fakeEngine();
    state.gains = { "pack-a.dls#24": 6 };
    const plan = await run(() => {
      state.gains = { "pack-a.dls#24": -6 };
    });
    expect(state.prepared).toHaveLength(1);
    expect(plan!.patches[0]!.gain).toBeCloseTo(10 ** (-6 / 20));
    // 0 dB로 돌리면 음량 배율을 빼서 기본(1)으로
    const back = await fakeEngine().run(() => {});
    expect(back!.patches[0]!.gain).toBeUndefined();
  });

  it("예열 중 정지·새 재생이면 시작하지 않는다", async () => {
    const { state, run } = fakeEngine();
    expect(await run(() => state.current++)).toBeUndefined();
  });
});
