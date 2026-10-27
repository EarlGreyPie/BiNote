import { add, cmp, DEFAULT_BPM, normalizeTempo, positionToSeconds, secondsToWhole, toFloat, ZERO, type TempoEvent, type TimeSigEvent } from "@mmlce/core";
import { analyzeMidi, type MidiAnalysis } from "./analyze.js";
import type { Smf, SmfEvent } from "./smf.js";

/**
 * 음원에서 받아 적은 음(초 단위)을 MIDI로 만든다. 받아 적기(브라우저 안 basic-pitch, PC의 Basic Scriptor)와
 * MIDI 불러오기 사이의 다리다. 받아 적은 음은 초로 오고, 곡 위치(박)는 템포 지도가 있어야 정해진다.
 * - 템포 지도를 주면(지금 곡의 템포, 원곡에 탭 템포로 맞춘 것) 그 템포로 음을 놓는다. 마디선이 원곡과 맞는다
 * - 주지 않으면 t120 하나로 놓는다(MIDI 0초 = 음원 0초)
 * MIDI는 정수 tick이라 위치는 tick에 반올림한다(PPQ 480, 내보내기와 같음). 가져오기 창에 넘길 때는
 * timedPartsToAnalysis가 아주 잘게(ANALYSIS_PPQ) 놓아 가져오기 격자 판정과 다른 칸이 되지 않게 한다
 */

/** 받아 적은 음 하나. 시작·길이는 음원 기준 초 */
export interface TimedNote {
  readonly start: number;
  readonly dur: number;
  readonly pitch: number;
  /** MIDI 세기 1~127 */
  readonly velocity: number;
}

/** 받아 적은 음의 묶음 (MIDI 트랙 하나) */
export interface TimedPart {
  readonly name: string;
  readonly channel: number;
  readonly program: number;
  readonly notes: readonly TimedNote[];
}

/** 음을 놓을 시간 틀 */
export interface TranscribeTiming {
  readonly tempo: readonly TempoEvent[];
  readonly timeSig: readonly TimeSigEvent[];
  /**
   * 원곡 어긋남(초). 재생과 같은 값이다: 원곡 시각 = 곡 시각 + 이 값, 그래서 곡 시각 = 음원 시각 - 이 값.
   * 원곡이 아닌 음원은 0
   */
  readonly offsetSeconds: number;
}

export const TRANSCRIBE_PPQ = 480;
/**
 * 가져오기 창에 넘길 때의 tick 잘게: 온음표 2^20칸. 파일로 쓰지 않는 메모리 안 MIDI라 MIDI 파일 한도(15비트)와 상관없다.
 * 480으로 놓으면 음 시작이 한 번 반올림된 뒤 가져오기 격자에서 다시 반올림되어 격자 반 칸 근처의 음이 옆 칸으로 갈 수 있다
 */
export const ANALYSIS_PPQ = 2 ** 18;

/** 받아 적은 음을 MIDI(형식 1: 0번 트랙은 템포·박자, 그 뒤 묶음마다 트랙 하나)로 */
export function timedPartsToSmf(parts: readonly TimedPart[], timing?: TranscribeTiming, ppq = TRANSCRIBE_PPQ): Smf {
  const tempo = timing && timing.tempo.length > 0 ? timing.tempo : [];
  const offset = timing?.offsetSeconds ?? 0;
  const tickOfWhole = (whole: number) => Math.max(0, Math.round(whole * ppq * 4));
  const tickOf = (seconds: number) => tickOfWhole(secondsToWhole(tempo, seconds - offset));

  const conductor: SmfEvent[] = [];
  if (tempo.length === 0 || tempo.every((t) => cmp(t.at, ZERO) !== 0)) conductor.push({ tick: 0, type: "tempo", usPerQuarter: Math.round(60_000_000 / DEFAULT_BPM) });
  for (const t of tempo) conductor.push({ tick: tickOfWhole(toFloat(t.at)), type: "tempo", usPerQuarter: Math.round(60_000_000 / t.bpm) });
  for (const sig of timing?.timeSig ?? []) conductor.push({ tick: tickOfWhole(toFloat(sig.at)), type: "timeSig", beats: sig.beats, unit: sig.unit });

  const tracks = [{ events: conductor }];
  for (const part of parts) {
    const events: SmfEvent[] = [{ tick: 0, type: "name", text: part.name }, { tick: 0, type: "program", channel: part.channel, program: part.program }];
    for (const n of untangle(part.notes.map((n) => ({ on: tickOf(n.start), off: tickOf(n.start + n.dur), pitch: n.pitch, velocity: n.velocity })))) {
      events.push({ tick: n.on, type: "noteOn", channel: part.channel, pitch: n.pitch, velocity: n.velocity });
      events.push({ tick: n.off, type: "noteOff", channel: part.channel, pitch: n.pitch });
    }
    tracks.push({ events });
  }
  return { format: 1, ppq, tracks };
}

interface TickNote {
  on: number;
  off: number;
  readonly pitch: number;
  readonly velocity: number;
}

/**
 * 같은 높이 음이 겹치면 앞 음을 뒤 음 시작에서 끊는다(MIDI는 같은 채널·같은 높이의 겹친 음을 구별하지 못한다).
 * 0 tick 길이가 된 음은 버리고, 높이·세기는 MIDI 범위로 맞춘다
 */
function untangle(notes: readonly TickNote[]): TickNote[] {
  const clean = notes
    .filter((n) => Number.isFinite(n.on) && Number.isFinite(n.off))
    .map((n) => ({ ...n, pitch: Math.min(127, Math.max(0, Math.round(n.pitch))), velocity: Math.min(127, Math.max(1, Math.round(n.velocity))) }))
    .sort((a, b) => a.on - b.on || a.pitch - b.pitch);
  const last = new Map<number, TickNote>();
  for (const n of clean) {
    const before = last.get(n.pitch);
    if (before && before.off > n.on) before.off = n.on;
    last.set(n.pitch, n);
  }
  return clean.filter((n) => n.off > n.on);
}

/**
 * 불러온 MIDI의 음을 초로 되돌린다 (그 MIDI의 템포로). Basic Scriptor가 보낸 MIDI를 지금 곡 템포에 다시 놓을 때 쓴다.
 * 파트(트랙·채널)마다 묶음 하나, 드럼 파트는 10번 채널 그대로
 */
export function analysisToTimedParts(analysis: MidiAnalysis): TimedPart[] {
  return analysis.parts.map((part) => ({
    name: part.name,
    channel: part.channel,
    program: part.program,
    notes: part.notes.map((n) => {
      const start = positionToSeconds(analysis.tempo, n.start);
      const end = positionToSeconds(analysis.tempo, add(n.start, n.dur));
      return { start, dur: end - start, pitch: n.pitch, velocity: n.velocity };
    }),
  }));
}

/**
 * 받아 적은 음을 MIDI 가져오기 창에 넘길 분석 결과로. 시간 틀을 주면 템포·박자는 곡의 것을 분수 그대로 넘기고
 * (PPQ 480 tick으로 반올림하지 않는다, keepTiming) 음만 tick 자리로 놓는다. 음은 가져오기에서 어차피 격자에 맞춘다
 */
export function timedPartsToAnalysis(parts: readonly TimedPart[], timing?: TranscribeTiming): MidiAnalysis {
  const analysis = analyzeMidi(timedPartsToSmf(parts, timing, ANALYSIS_PPQ));
  if (!timing) return analysis;
  const tempo = normalizeTempo(timing.tempo);
  // 곡 첫 박자표가 0이 아니면 그 앞은 곡과 같이 기본 4/4다 (가져오기가 첫 박자표를 0으로 당기지 않게 앞에 둔다)
  const timeSig = timing.timeSig.length > 0 && cmp(timing.timeSig[0]!.at, ZERO) !== 0 ? [{ at: ZERO, beats: 4, unit: 4 }, ...timing.timeSig] : [...timing.timeSig];
  return {
    ...analysis,
    tempo: tempo.length > 0 && cmp(tempo[0]!.at, ZERO) === 0 ? tempo : [{ at: ZERO, bpm: DEFAULT_BPM }, ...tempo],
    timeSig,
    keepTiming: true,
  };
}

/**
 * 받아 적기에 쓸 시간 틀. 곡 템포에 놓지 않으면 없음(t120). 원곡이 아닌 음원은 원곡 어긋남이 그 음원과 상관없으므로
 * 어긋남 0으로 곡 처음부터 놓는다
 */
export function transcribeTimingFor(timing: TranscribeTiming | undefined, retime: boolean, fromReference: boolean): TranscribeTiming | undefined {
  if (!retime || !timing) return undefined;
  return fromReference ? timing : { ...timing, offsetSeconds: 0 };
}
