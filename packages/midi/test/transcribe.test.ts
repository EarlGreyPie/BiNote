import { describe, expect, it } from "vitest";
import { cmp, MOBILE_PROFILE, rat, toFloat } from "@mmlce/core";
import { analysisToTimedParts, analyzeMidi, midiToSong, readSmf, suggestPlan, timedPartsToAnalysis, timedPartsToSmf, transcribeTimingFor, writeSmf, type SmfEvent, type TimedPart } from "../src/index.js";

const part = (notes: TimedPart["notes"]): TimedPart => ({ name: "basic-pitch", channel: 0, program: 0, notes });
const noteEvents = (events: readonly SmfEvent[]) => events.filter((e) => e.type === "noteOn" || e.type === "noteOff");

describe("받아 적은 음 → MIDI", () => {
  it("템포가 없으면 t120 하나로 놓는다 (MIDI 0초 = 음원 0초)", () => {
    const smf = timedPartsToSmf([part([{ start: 0.5, dur: 0.25, pitch: 60, velocity: 90 }])]);
    expect(smf.ppq).toBe(480);
    expect(smf.tracks[0]!.events).toEqual([{ tick: 0, type: "tempo", usPerQuarter: 500_000 }]);
    // t120: 0.5초 = 한 박 = 480 tick
    expect(noteEvents(smf.tracks[1]!.events)).toEqual([
      { tick: 480, type: "noteOn", channel: 0, pitch: 60, velocity: 90 },
      { tick: 720, type: "noteOff", channel: 0, pitch: 60 },
    ]);
  });

  it("곡 템포와 원곡 어긋남으로 놓으면 마디선이 원곡과 맞는다", () => {
    // t60, 어긋남 1초(재생과 같은 뜻: 원곡 시각 = 곡 시각 + 1초): 음원 2.5초 = 곡 1.5초 = 1.5박
    const timing = { tempo: [{ at: rat(0), bpm: 60 }], timeSig: [{ at: rat(0), beats: 3, unit: 4 }], offsetSeconds: 1 };
    const smf = timedPartsToSmf([part([{ start: 2.5, dur: 1, pitch: 64, velocity: 70 }])], timing);
    expect(smf.tracks[0]!.events).toContainEqual({ tick: 0, type: "tempo", usPerQuarter: 1_000_000 });
    expect(smf.tracks[0]!.events).toContainEqual({ tick: 0, type: "timeSig", beats: 3, unit: 4 });
    expect(noteEvents(smf.tracks[1]!.events).map((e) => e.tick)).toEqual([720, 1200]);
  });

  it("템포가 바뀌는 곡은 바뀐 뒤 템포로 센다", () => {
    // 첫 마디(온음표) t120 = 2초, 그 뒤 t60. 음원 3초 = 2초 + t60 한 박 → 온음표 1 + 4분 1 = 5박
    const timing = { tempo: [{ at: rat(0), bpm: 120 }, { at: rat(1), bpm: 60 }], timeSig: [], offsetSeconds: 0 };
    const smf = timedPartsToSmf([part([{ start: 3, dur: 0.5, pitch: 67, velocity: 64 }])], timing);
    expect(smf.tracks[0]!.events.filter((e) => e.type === "tempo").map((e) => e.tick)).toEqual([0, 1920]);
    expect(noteEvents(smf.tracks[1]!.events)[0]!.tick).toBe(2400);
  });

  it("어긋남으로 곡 앞으로 나간 음은 0에서 시작하고 길이가 없어지면 버린다", () => {
    // 어긋남 1초: 음원 1초가 곡 처음. 음원 1초 앞 음은 곡 앞이다
    const timing = { tempo: [], timeSig: [], offsetSeconds: 1 };
    const smf = timedPartsToSmf([part([{ start: 0.2, dur: 0.3, pitch: 60, velocity: 80 }, { start: 0.5, dur: 1, pitch: 62, velocity: 80 }])], timing);
    expect(noteEvents(smf.tracks[1]!.events).map((e) => [e.type, e.tick, e.pitch])).toEqual([
      ["noteOn", 0, 62],
      ["noteOff", 480, 62],
    ]);
  });

  it("같은 높이가 겹치면 앞 음을 뒤 음 시작에서 끊고, 세기·높이는 MIDI 범위로 맞춘다", () => {
    const smf = timedPartsToSmf([
      part([
        { start: 0, dur: 1, pitch: 60, velocity: 200 },
        { start: 0.5, dur: 0.5, pitch: 60, velocity: 0 },
      ]),
    ]);
    expect(noteEvents(smf.tracks[1]!.events).map((e) => [e.type, e.tick, "velocity" in e ? e.velocity : undefined])).toEqual([
      ["noteOn", 0, 127],
      ["noteOff", 480, undefined],
      ["noteOn", 480, 1],
      ["noteOff", 960, undefined],
    ]);
  });

  it("MIDI 불러오기로 읽힌다 (파일로 써서 다시 읽기)", () => {
    const smf = timedPartsToSmf([part([{ start: 0, dur: 0.5, pitch: 60, velocity: 100 }, { start: 0, dur: 0.5, pitch: 64, velocity: 100 }])]);
    const analysis = analyzeMidi(readSmf(writeSmf(smf)));
    expect(analysis.parts).toHaveLength(1);
    expect(analysis.parts[0]!.name).toBe("basic-pitch");
    expect(analysis.parts[0]!.notes.map((n) => [n.pitch, toFloat(n.start), toFloat(n.dur)]).sort((a, b) => a[0]! - b[0]!)).toEqual([
      [60, 0, 0.25],
      [64, 0, 0.25],
    ]);
  });

  it("Basic Scriptor MIDI를 초로 되돌려 곡 템포에 다시 놓는다", () => {
    // Basic Scriptor는 t120으로 보냈다: 1박(0.5초) 자리 음
    const sent = timedPartsToSmf([{ name: "guitar", channel: 2, program: 24, notes: [{ start: 0.5, dur: 0.5, pitch: 55, velocity: 50 }] }]);
    const parts = analysisToTimedParts(analyzeMidi(readSmf(writeSmf(sent))));
    expect(parts).toEqual([{ name: "guitar", channel: 2, program: 24, notes: [{ start: 0.5, dur: 0.5, pitch: 55, velocity: 50 }] }]);
    // 곡은 t60: 0.5초 = 반 박
    const placed = timedPartsToSmf(parts, { tempo: [{ at: rat(0), bpm: 60 }], timeSig: [], offsetSeconds: 0 });
    expect(noteEvents(placed.tracks[1]!.events).map((e) => [e.tick, e.channel])).toEqual([
      [240, 2],
      [480, 2],
    ]);
  });

  it("원곡이 아닌 음원은 원곡 어긋남 없이, 곡 템포에 놓지 않으면 시간 틀 없이", () => {
    const timing = { tempo: [{ at: rat(0), bpm: 90 }], timeSig: [], offsetSeconds: 2 };
    expect(transcribeTimingFor(timing, true, true)).toBe(timing);
    expect(transcribeTimingFor(timing, true, false)).toEqual({ ...timing, offsetSeconds: 0 });
    expect(transcribeTimingFor(timing, false, true)).toBeUndefined();
    expect(transcribeTimingFor(undefined, true, true)).toBeUndefined();
  });

  it("곡 템포의 분수 위치를 PPQ 480 tick으로 반올림하지 않고 새 곡까지 그대로 넘긴다", () => {
    // 1/7 온음표 자리(480 tick으로 나누어떨어지지 않음)에서 템포가 바뀌는 곡
    const at = rat(1, 7);
    const timing = { tempo: [{ at: rat(0), bpm: 120 }, { at, bpm: 100.5 }], timeSig: [{ at: rat(0), beats: 3, unit: 4 }], offsetSeconds: 0 };
    const analysis = timedPartsToAnalysis([part([{ start: 0, dur: 1, pitch: 60, velocity: 80 }])], timing);
    expect(analysis.keepTiming).toBe(true);
    expect(analysis.tempo).toEqual(timing.tempo);
    const song = midiToSong(analysis, suggestPlan(analysis, MOBILE_PROFILE), MOBILE_PROFILE).song;
    expect(song.tempo.map((t) => [cmp(t.at, at) === 0 || cmp(t.at, rat(0)) === 0, t.bpm])).toEqual([
      [true, 120],
      [true, 100.5],
    ]);
    expect(cmp(song.tempo[1]!.at, at)).toBe(0);
    expect(song.timeSig).toEqual([{ at: rat(0), beats: 3, unit: 4 }]);
  });

  it("곡 템포가 0 자리에서 시작하지 않으면 앞에 t120을 둔다", () => {
    const analysis = timedPartsToAnalysis([part([{ start: 0, dur: 0.5, pitch: 60, velocity: 80 }])], { tempo: [{ at: rat(1), bpm: 90 }], timeSig: [], offsetSeconds: 0 });
    expect(analysis.tempo.map((t) => [toFloat(t.at), t.bpm])).toEqual([
      [0, 120],
      [1, 90],
    ]);
  });

  it("곡 첫 박자표가 0이 아닌 자리에 있으면 그 자리 그대로 두고 앞은 4/4", () => {
    const at = rat(1, 7);
    const analysis = timedPartsToAnalysis([part([{ start: 0, dur: 1, pitch: 60, velocity: 80 }])], { tempo: [{ at: rat(0), bpm: 120 }], timeSig: [{ at, beats: 3, unit: 4 }], offsetSeconds: 0 });
    const song = midiToSong(analysis, suggestPlan(analysis, MOBILE_PROFILE), MOBILE_PROFILE).song;
    expect(song.timeSig).toEqual([
      { at: rat(0), beats: 4, unit: 4 },
      { at, beats: 3, unit: 4 },
    ]);
  });

  it("음 시작을 480 tick으로 먼저 반올림하지 않아 가져오기 격자에서 옆 칸으로 가지 않는다", () => {
    // t120에서 0.06249초 = 온음표 0.031245: 1/16 격자의 반 칸(1/32)보다 조금 앞이라 0 칸이다.
    // 480 tick으로 먼저 놓으면 1/32(60 tick)이 되어 1/16 칸으로 갔다
    const analysis = timedPartsToAnalysis([part([{ start: 0.06249, dur: 0.5, pitch: 60, velocity: 80 }])]);
    const plan = { ...suggestPlan(analysis, MOBILE_PROFILE), quantize: { grid: 16, triplets: false } };
    const notes = midiToSong(analysis, plan, MOBILE_PROFILE).song.tracks.flatMap((t) => t.notes);
    expect(notes).toHaveLength(1);
    expect(cmp(notes[0]!.start, rat(0))).toBe(0);
  });

  it("음이 아주 많은 결과(14만 음)도 인자 펼치기 한도에 걸리지 않고 분석한다", () => {
    const notes = Array.from({ length: 140_000 }, (_, i) => ({ start: i * 0.0035, dur: 0.003, pitch: 50 + (i % 14), velocity: 64 }));
    const analysis = timedPartsToAnalysis([part(notes)]);
    expect(analysis.parts[0]!.notes).toHaveLength(140_000);
    expect([analysis.parts[0]!.low, analysis.parts[0]!.high]).toEqual([50, 63]);
  });
});

