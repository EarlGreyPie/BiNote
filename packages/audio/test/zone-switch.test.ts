import { describe, expect, it } from "vitest";
import { BasicInstrument, BasicPreset, BasicSoundBank, EmptySample, Generator, GeneratorTypes } from "spessasynth_core";
import { chainSamplePosition, emptySong, MOBILE_PROFILE, rat, type Note, type Song } from "@mmlce/core";
import { assignPatches, buildSchedule, CHANNELS, LANE_GAP, LivePlayer, loadSoundBank, renderPatched, SoundPackRegistry, type LiveSink, type TimerHost } from "../src/index.js";

// 음색 경계(샘플 구간)를 넘는 & 붙임: 게임은 다시 치지 않고 새 구간 샘플로 바꿔 타며 샘플 안 위치를 이어 간다.
// 피아노 구간은 52·64·77부터 (MOBILE_PROFILE.sampleSeconds)

const n = (id: string, start: [number, number], dur: [number, number], pitch: number, extra: Partial<Note> = {}): Note => ({
  id, start: rat(...start), dur: rat(...dur), pitch, vol: 15, tie: "none", ...extra,
});

function pianoSong(notes: Note[], tracks = 1): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  return {
    ...base,
    tempo: [{ at: rat(0), bpm: 120 }],
    players: [{ id: "p1", name: "", instrument: { canonical: "piano", program: 0 } }],
    tracks: Array.from({ length: tracks }, (_, i) => ({
      id: `t${i + 1}`, playerId: "p1", name: "", color: "", role: "free" as const, mute: false, solo: false, spelling: {},
      notes: i === 0 ? notes : [n(`x${i}`, [0, 1], [1, 4], 60)],
    })),
  };
}

const line = (e: { time: number; type: string; slot: number; note: number; bend?: number }) =>
  `${e.time.toFixed(3)} ${e.type} ${e.slot}:${e.note}${e.bend === undefined ? "" : ` ${+e.bend.toFixed(3)}`}`;

describe("음색 경계를 넘는 & 붙임 (바꿔 타기)", () => {
  it("d+&e: 새 구간 음을 소리 없이 미리 쳐 두었다가 경계에서 바꿔 탄다", () => {
    // t120 온음표 2초씩. o4d+(63)는 52 구간, o4e(64)는 64 구간
    const s = buildSchedule(pianoSong([n("a", [0, 1], [1, 1], 63, { tie: "next" }), n("b", [1, 1], [1, 1], 64)]), MOBILE_PROFILE);
    expect(s.slots.map((x) => x.key)).toEqual(["t1", "t1#zone"]);
    // 미리 친 음의 높이: 앞 2초 동안 게임이 52 구간 샘플을 2^(11/12)배로 돌린 만큼 64 구간 샘플도 돌도록 +11반음
    expect(s.events.map(line)).toEqual([
      "0.000 mute 1:64",
      "0.000 bend 1:64 11",
      "0.000 on 0:63",
      "0.000 on 1:64",
      "2.000 unmute 1:64",
      "2.000 mute 0:63",
      "2.000 bend 1:64 0",
      `${(2 + LANE_GAP).toFixed(3)} cut 0:63`,
      `${(2 + LANE_GAP).toFixed(3)} unmute 0:63`,
      `${(2 + LANE_GAP).toFixed(3)} bend 0:63 0`,
      "3.515 off 1:64",
    ]);
    // 끝나는 때는 게임 실측(3.51초)과 같다
    expect(s.events.at(-1)!.time).toBeCloseTo(3.51, 1);
  });

  it("같은 구간 안의 붙임은 예전처럼 높이만 옮긴다 (소리 지점을 더 쓰지 않는다)", () => {
    const s = buildSchedule(pianoSong([n("a", [0, 1], [1, 4], 60, { tie: "next" }), n("b", [1, 4], [1, 4], 62)]), MOBILE_PROFILE);
    expect(s.slots).toHaveLength(1);
    expect(s.events.map((e) => e.type)).toEqual(["on", "bend", "off", "bend"]);
  });

  it("경계를 두 번 넘으면 두 소리 지점을 번갈아 쓴다. 두 번째는 앞서 끊은 때부터 미리 친다", () => {
    // 63 → 64(64 구간) → 77(77 구간). t120 4분음표 0.5초씩
    const s = buildSchedule(
      pianoSong([n("a", [0, 1], [1, 4], 63, { tie: "next" }), n("b", [1, 4], [1, 4], 64, { tie: "next" }), n("c", [1, 2], [1, 4], 77)]),
      MOBILE_PROFILE,
    );
    expect(s.slots).toHaveLength(2);
    const at = (t: number) => s.events.filter((e) => Math.abs(e.time - t) < 1e-9).map(line);
    const freed = 0.5 + LANE_GAP;
    // 0.5초에 끊은 소리 지점 0에서 77을 미리 치고, 1초에 그쪽으로 바꿔 탄다
    const steps = [{ at: 0, pitch: 63 }, { at: 0.5, pitch: 64 }];
    const lead = 77 - 77 + 12 * Math.log2(chainSamplePosition(MOBILE_PROFILE, "piano", steps, 1) / (1 - freed));
    expect(at(freed)).toEqual([`${freed.toFixed(3)} cut 0:63`, `${freed.toFixed(3)} mute 0:77`, `${freed.toFixed(3)} bend 0:77 ${+lead.toFixed(3)}`, `${freed.toFixed(3)} on 0:77`]);
    expect(at(1)).toEqual(["1.000 unmute 0:77", "1.000 mute 1:64", "1.000 bend 0:77 0"]);
    // 사슬 끝: 소리 지점 0에서 끄고, 비운 소리 지점 1은 되돌린다
    expect(s.events.slice(-4).map(line)).toEqual([
      `${(1 + LANE_GAP).toFixed(3)} cut 1:64`,
      `${(1 + LANE_GAP).toFixed(3)} unmute 1:64`,
      `${(1 + LANE_GAP).toFixed(3)} bend 1:64 0`,
      "1.500 off 0:77",
    ]);
  });

  it("비운 소리 지점의 틈이 짧아 높이 옮기기로 샘플 위치에 닿지 못하면, 그 경계는 바꿔 타지 않고 높이만 옮긴다", () => {
    // t120 o4 d+4&e32&d+4: 63 → 64(바꿔 탐, 0.5초) → 63(0.5625초). 두 번째는 0.5초 남짓에 1초쯤 위치가 필요해 +24반음으로도 못 닿는다
    const s = buildSchedule(
      pianoSong([n("a", [0, 1], [1, 4], 63, { tie: "next" }), n("b", [1, 4], [1, 32], 64, { tie: "next" }), n("c", [9, 32], [1, 4], 63)]),
      MOBILE_PROFILE,
    );
    const second = 0.5625;
    // 두 번째 경계에서는 새로 미리 치지 않고, 지금 소리 지점(1:64)을 63으로 내린다
    expect(s.events.filter((e) => e.type === "on").map(line)).toEqual(["0.000 on 0:63", "0.000 on 1:64"]);
    expect(s.events.filter((e) => Math.abs(e.time - second) < 1e-9).map(line)).toEqual([`${second.toFixed(3)} bend 1:64 -1`]);
    // 미리 친 음의 높이는 모두 범위 안이다
    for (const e of s.events) if (e.type === "bend") expect(Math.abs(e.bend!)).toBeLessThanOrEqual(24);
  });

  it("채널이 모자라면 바꿔 타지 않고 예전처럼 높이만 옮긴다", () => {
    const notes = [n("a", [0, 1], [1, 1], 63, { tie: "next" }), n("b", [1, 1], [1, 1], 64)];
    const s = buildSchedule(pianoSong(notes, CHANNELS.length), MOBILE_PROFILE);
    expect(s.slots).toHaveLength(CHANNELS.length);
    expect(s.events.filter((e) => e.slot === 0).map((e) => e.type)).toEqual(["on", "bend", "off", "bend"]);
  });

  it("커서 위치부터 재생해도 시각이 0 아래로 가지 않는다", () => {
    const s = buildSchedule(pianoSong([n("a", [0, 1], [1, 1], 63, { tie: "next" }), n("b", [1, 1], [1, 1], 64)]), MOBILE_PROFILE, { from: rat(1, 2) });
    expect(Math.min(...s.events.map((e) => e.time))).toBe(0);
    expect(s.events.filter((e) => e.type === "on").map((e) => e.slot)).toEqual([0, 1]);
  });
});

/** 구간마다 다른 소리(52 구간 = 사인파, 64 구간 = 네모파)이고 반복 없이 끝나는 샘플. 길이는 프로필 피아노 구간 길이 */
function zoneBank(): ArrayBuffer {
  const bank = new BasicSoundBank();
  const rate = 8000;
  const make = (name: string, root: number, seconds: number, wave: (phase: number) => number) => {
    const data = new Float32Array(Math.round(seconds * rate));
    const hz = 440 * 2 ** ((root - 69) / 12);
    for (let i = 0; i < data.length; i++) data[i] = 0.5 * wave((i * hz) / rate);
    const sample = new EmptySample();
    sample.name = name;
    sample.originalKey = root;
    sample.loopStart = 0;
    sample.loopEnd = data.length;
    sample.setAudioData(data, rate);
    bank.addSamples(sample);
    return sample;
  };
  const low = make("low", 52, 5.3, (p) => Math.sin(2 * Math.PI * p));
  const high = make("high", 64, 5.29, (p) => (p % 1 < 0.5 ? 1 : -1));
  const inst = new BasicInstrument();
  inst.name = "Zones";
  inst.globalZone.addGenerators(new Generator(GeneratorTypes.sampleModes, 0), new Generator(GeneratorTypes.releaseVolEnv, -12000));
  const z1 = inst.createZone(low);
  z1.keyRange = { min: 0, max: 63 };
  const z2 = inst.createZone(high);
  z2.keyRange = { min: 64, max: 127 };
  bank.addInstruments(inst);
  const preset = new BasicPreset(bank);
  preset.name = "Zones";
  preset.createZone(inst);
  bank.addPresets(preset);
  bank.flush();
  return bank.writeSF2();
}

describe("바꿔 타기를 실제로 그리기 (합성 사운드팩)", () => {
  it("d+&e가 게임처럼 3.5초까지 울리고, 미리 친 음은 바꿔 타기 전에 들리지 않는다", { timeout: 60_000 }, async () => {
    const registry = new SoundPackRegistry();
    registry.add("z#0", "zones.sf2", { presets: [{ program: 0, bankMSB: 0, name: "Zones" }] });
    const soundBank = loadSoundBank(zoneBank());
    const render = async (song: Song) => {
      const schedule = buildSchedule(song, MOBILE_PROFILE);
      const { patches, unresolved } = assignPatches(schedule, registry);
      expect(unresolved).toEqual([]);
      return renderPatched(schedule, patches, [{ id: "z#0", bank: 0, soundBank }], { limit: false, sampleRate: 22050 });
    };
    const tied = await render(pianoSong([n("a", [0, 1], [1, 1], 63, { tie: "next" }), n("b", [1, 1], [1, 1], 64, { tie: "none" })]));
    const alone = await render(pianoSong([n("a", [0, 1], [1, 1], 63)]));
    const rms = (r: { left: Float32Array; sampleRate: number }, from: number, to: number) => {
      let sum = 0;
      const a = Math.round(from * r.sampleRate);
      const b = Math.round(to * r.sampleRate);
      for (let i = a; i < b; i++) sum += r.left[i]! ** 2;
      return Math.sqrt(sum / (b - a));
    };
    // 바꿔 타기 전: 미리 친 음(소리 0)이 섞이지 않아 앞 음만 칠 때와 같다
    const before = rms(alone, 0.2, 1.9);
    expect(before).toBeGreaterThan(0.01);
    expect(Math.abs(rms(tied, 0.2, 1.9) - before) / before).toBeLessThan(0.01);
    // 예전에는 앞 구간 샘플을 높이만 올려 2.76초쯤 끝났다. 이제 새 구간 샘플로 3.5초 가까이 울린다
    expect(rms(tied, 3.2, 3.45)).toBeGreaterThan(0.01);
    expect(rms(tied, 3.6, 4)).toBeLessThan(1e-4);
    // 바꿔 탄 뒤는 새 구간 소리(네모파)다: 네모파는 같은 크기 사인파보다 실효값이 크다
    expect(rms(tied, 2.2, 3.2)).toBeGreaterThan(before * 1.2);
  });
});

class Sink implements LiveSink {
  currentTime = 10;
  log: string[] = [];
  setPatch() {}
  noteOn(channel: number, note: number, _v: number, time: number) {
    this.log.push(`on ${channel} ${note} @${time.toFixed(3)}`);
  }
  noteOff(channel: number, note: number, time: number) {
    this.log.push(`off ${channel} ${note} @${time.toFixed(3)}`);
  }
  pitchBend(channel: number, semitones: number, time: number) {
    this.log.push(`bend ${channel} ${+semitones.toFixed(3)} @${time.toFixed(3)}`);
  }
  setBendRange() {}
  cut(channel: number, time: number) {
    this.log.push(`cut ${channel} @${time.toFixed(3)}`);
  }
  setExpression(channel: number, value: number, time: number) {
    this.log.push(`expr ${channel} ${value} @${time.toFixed(3)}`);
  }
  silence() {}
}

const timers: TimerHost = { setInterval: () => 1, clearInterval: () => {} };

describe("실시간 재생의 바꿔 타기", () => {
  const schedule = buildSchedule(pianoSong([n("a", [0, 1], [1, 4], 63, { tie: "next" }), n("b", [1, 4], [1, 4], 64)]), MOBILE_PROFILE);
  const patches = [
    { slot: 0, channel: 0, bank: 0, program: 0, packId: "z" },
    { slot: 1, channel: 1, bank: 0, program: 0, packId: "z" },
  ];

  it("소리 줄이기·되돌리기·끊기를 신스에 보내고, 시작할 때 소리 크기를 되돌려 둔다", () => {
    const sink = new Sink();
    const player = new LivePlayer(sink, { timers, lookahead: 5, startDelay: 0 });
    player.start(schedule, patches);
    // 악기를 정할 때(첫 음보다 먼저) 두 채널 모두 소리 크기를 되돌린다
    expect(sink.log.indexOf("expr 0 127 @10.000")).toBeLessThan(sink.log.indexOf("on 0 63 @10.000"));
    expect(sink.log.indexOf("expr 1 127 @10.000")).toBeLessThan(sink.log.indexOf("expr 1 0 @10.000"));
    expect(sink.log).toContain("expr 1 0 @10.000");
    expect(sink.log).toContain("expr 1 127 @10.500");
    expect(sink.log).toContain("expr 0 0 @10.500");
    expect(sink.log).toContain(`cut 0 @${(10.5 + LANE_GAP).toFixed(3)}`);
    expect(sink.log.at(-1)).toBe("off 1 64 @11.000");
  });

  it("재생 중 고치기는 이어 붙이지 않고 다시 재생하게 한다", () => {
    const player = new LivePlayer(new Sink(), { timers, lookahead: 0.1, startDelay: 0 });
    player.start(schedule, patches);
    expect(player.replace(schedule, patches)).toBe(false);
  });

  it("반복 끝에서 소리를 줄여 둔 채널은 끝소리 없이 끊고 되돌린다", () => {
    const sink = new Sink();
    const player = new LivePlayer(sink, { timers, lookahead: 0.1, startDelay: 0 });
    // 0.25초에서 반복: 미리 친 음(채널 1)이 소리 0인 채로 반복 끝을 맞는다
    player.start(schedule, patches, { loop: 0.25 });
    sink.currentTime = 10.2;
    sink.log = [];
    player.tick();
    expect(sink.log.slice(0, 4)).toEqual(["off 0 63 @10.250", "off 1 64 @10.250", "cut 1 @10.250", "expr 1 127 @10.250"]);
  });
});
