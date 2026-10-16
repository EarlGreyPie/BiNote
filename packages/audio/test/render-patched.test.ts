import { describe, expect, it } from "vitest";
import { BasicSoundBank } from "spessasynth_core";
import { emptySong, MOBILE_PROFILE, rat, type Song } from "@mmlce/core";
import { assignPatches, buildSchedule, loadSoundBank, renderPatched, SoundPackRegistry, toWav } from "../src/index.js";

describe("renderPatched (WAV 저장)", () => {
  it("합성한 작은 사운드팩(톱니파 하나)으로 곡을 그려 WAV 바이트를 만든다", async () => {
    const song: Song = {
      ...emptySong({ title: "", author: "", profileId: "mobile" }),
      players: [{ id: "p1", name: "류트", instrument: { canonical: "lute", program: 0 } }],
      tracks: [{ id: "a", playerId: "p1", name: "a", color: "", role: "free", mute: false, solo: false, notes: [60, 64, 67].map((pitch, k) => ({ id: `n${k}`, start: rat(k, 8), dur: rat(1, 8), pitch, vol: 10, tie: "none" as const })), spelling: {} }],
    };
    const bytes = BasicSoundBank.getSampleSoundBankFile();
    const registry = new SoundPackRegistry();
    registry.add("saw#0", "saw.sf2", { presets: [{ program: 0, bankMSB: 0, name: "Saw Wave" }] });
    const schedule = buildSchedule(song, MOBILE_PROFILE);
    const { patches, unresolved } = assignPatches(schedule, registry);
    expect(unresolved).toEqual([]);
    const seen: number[] = [];
    const result = await renderPatched(schedule, patches, [{ id: "saw#0", bank: 0, soundBank: loadSoundBank(bytes) }], { onProgress: (p) => seen.push(p) });
    const wav = toWav(result);
    const view = new DataView(wav);
    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...new Uint8Array(wav, 8, 4))).toBe("WAVE");
    expect(view.byteLength).toBeGreaterThan(44);
    // 소리가 실제로 들어 있다 (16비트 표본 중 0이 아닌 것)
    let loud = 0;
    for (let i = 44; i + 1 < view.byteLength; i += 2) if (view.getInt16(i, true) !== 0) loud++;
    expect(loud).toBeGreaterThan(100);
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.at(-1)).toBeGreaterThan(0.95);
  });
});
