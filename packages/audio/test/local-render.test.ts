import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptySong, MOBILE_PROFILE, rat, type Song } from "@mmlce/core";
import { buildSchedule, loadSoundBank, renderOffline, SoundPackRegistry, type LoadedPack } from "../src/index.js";

// 사운드팩은 넥슨 자산이라 저장소에 넣지 않는다. MMLCE_DLS 폴더에 두 팩이 있으면 실제로 그려 본다.
const dir = process.env.MMLCE_DLS;
const FILES = [
  ["fury", "Fury Harmonic muse Pack v1.02.dls"],
  ["muse", "Harmonic Muse Pack v0.25.dls"],
] as const;

function testSong(): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  return {
    ...base,
    tempo: [{ at: rat(0), bpm: 120 }],
    players: [
      { id: "p1", name: "피아노", instrument: { canonical: "piano" } },
      { id: "p2", name: "기타", instrument: { canonical: "folk-guitar" } },
    ],
    tracks: [
      { id: "t1", playerId: "p1", name: "", color: "", role: "free", mute: false, solo: false, spelling: {},
        notes: [{ id: "a", start: rat(1, 4), dur: rat(1, 4), pitch: 60, vol: 15, tie: "none" }] },
      { id: "t2", playerId: "p2", name: "", color: "", role: "free", mute: false, solo: false, spelling: {},
        notes: [{ id: "b", start: rat(1, 2), dur: rat(1, 4), pitch: 55, vol: 15, tie: "none" }] },
    ],
  };
}

describe.skipIf(!dir)("실제 사운드팩으로 그리기", () => {
  it("두 팩을 동시에 올리고 음 시작 시각이 맞는다", { timeout: 120_000 }, async () => {
    const registry = new SoundPackRegistry();
    const packs: LoadedPack[] = FILES.map(([id, file]) => {
      const bytes = readFileSync(join(dir!, file));
      const soundBank = loadSoundBank(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const info = registry.add(id, file, soundBank);
      return { id, bank: info.bank, soundBank };
    });
    registry.setOrder(["muse", "fury"]);
    const schedule = buildSchedule(testSong(), MOBILE_PROFILE);
    const result = await renderOffline(schedule, registry, packs, { sampleRate: 22050, tailSeconds: 0.5 });
    expect(result.unresolved).toEqual([]);

    const firstSound = result.left.findIndex((x) => Math.abs(x) > 1e-4);
    // 피아노가 0.5초(4분음표 하나 뒤)에 시작. 샘플 앞머리의 어택만큼 몇 ms 늦게 들릴 수 있다
    expect(firstSound / result.sampleRate - 0.5).toBeGreaterThanOrEqual(0);
    expect(firstSound / result.sampleRate - 0.5).toBeLessThan(0.01);
    const rms = (from: number, to: number) => {
      let s = 0;
      for (let i = from; i < to; i++) s += result.left[i]! ** 2;
      return Math.sqrt(s / (to - from));
    };
    expect(rms(0, 10000)).toBeLessThan(1e-4);
    expect(rms(11025, 22050)).toBeGreaterThan(1e-3);
  });

  it("17번째 넘는 트랙(추가 채널)도 소리가 난다", { timeout: 120_000 }, async () => {
    const registry = new SoundPackRegistry();
    const [id, file] = FILES[1];
    const bytes = readFileSync(join(dir!, file));
    const soundBank = loadSoundBank(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const info = registry.add(id, file, soundBank);
    const base = testSong();
    // 피아노 트랙 18개 중 마지막(채널 17 이상)에만 음
    const tracks = Array.from({ length: 18 }, (_, i) => ({
      ...base.tracks[0]!,
      id: `t${i}`,
      notes: i === 17 ? base.tracks[0]!.notes : [],
    }));
    const song = { ...base, players: [base.players[0]!], tracks };
    const result = await renderOffline(buildSchedule(song, MOBILE_PROFILE), registry, [{ id, bank: info.bank, soundBank }], { sampleRate: 22050, tailSeconds: 0.5 });
    expect(Math.max(...result.left.map(Math.abs))).toBeGreaterThan(1e-2);
  });

  it("같은 악기가 든 두 팩을 함께 올려도 섞이지 않고, 고른 팩의 소리가 난다", { timeout: 240_000 }, async () => {
    const banks = FILES.map(([, file]) => {
      const bytes = readFileSync(join(dir!, file));
      return loadSoundBank(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    });
    // 팩 하나씩만 올린 것과 두 팩을 함께 올린 것을 같은 곡으로 그려 비교한다
    const render = async (song: Song, use: readonly number[]) => {
      const registry = new SoundPackRegistry();
      const packs: LoadedPack[] = use.map((i) => {
        const [id, file] = FILES[i]!;
        const info = registry.add(id, file, banks[i]!);
        return { id, bank: info.bank, soundBank: banks[i]! };
      });
      const result = await renderOffline(buildSchedule(song, MOBILE_PROFILE), registry, packs, { sampleRate: 22050, tailSeconds: 0.5 });
      expect(result.unresolved).toEqual([]);
      return result.left;
    };
    const same = (a: Float32Array, b: Float32Array) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) < 1e-6);
    const one = (instrument: string): Song => {
      const base = testSong();
      return { ...base, players: [{ ...base.players[0]!, instrument: { canonical: instrument } }], tracks: [base.tracks[0]!] };
    };

    // 두 팩 모두에 있는 기타(Fury 30번, Harmonic Muse 40번)는 우선순위가 앞인 팩(먼저 올린 팩) 소리.
    // 두 팩의 피아노는 샘플이 같아 구별되지 않으므로 기타로 본다
    const guitar = one("folk-guitar");
    const furyGuitar = await render(guitar, [0]);
    const museGuitar = await render(guitar, [1]);
    expect(same(furyGuitar, museGuitar)).toBe(false);
    expect(same(await render(guitar, [0, 1]), furyGuitar)).toBe(true);
    expect(same(await render(guitar, [1, 0]), museGuitar)).toBe(true);

    // 40.3은 Fury 팩을 먼저 올려도 Harmonic Muse 팩 40번(기타) 소리
    expect(same(await render(one(`mabi:${3 * 512 + 40}`), [0, 1]), museGuitar)).toBe(true);
    // 30.2는 .3 팩을 먼저 올려도 .2 팩 30번(기타) 소리
    expect(same(await render(one(`mabi:${2 * 512 + 30}`), [1, 0]), furyGuitar)).toBe(true);
    expect(Math.max(...museGuitar.map(Math.abs))).toBeGreaterThan(1e-2);
  });
});
