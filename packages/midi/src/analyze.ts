import { rat, type Rat, type TempoEvent, type TimeSigEvent } from "@mmlce/core";
import type { Smf } from "./smf.js";
import { suggestInstrument, type InstrumentSuggestion } from "./gm.js";

/** MIDI에서 읽은 음. 위치·길이는 tick을 그대로 옮긴 정확한 분수(온음표 단위) */
export interface RawNote {
  readonly start: Rat;
  readonly dur: Rat;
  /** 시작 시각(초). 화음 묶기에 쓴다 */
  readonly seconds: number;
  readonly pitch: number;
  readonly velocity: number;
}

/** MIDI 파트 = (트랙, 채널) 하나. 악기 지정 화면의 한 줄 */
export interface MidiPart {
  readonly id: string;
  readonly track: number;
  readonly channel: number;
  readonly name: string;
  readonly program: number;
  /** 10번 채널(드럼) */
  readonly drum: boolean;
  readonly notes: RawNote[];
  readonly low: number;
  readonly high: number;
  /** 동시에 울리는 음 수의 최대 */
  readonly polyphony: number;
  readonly suggestion: InstrumentSuggestion;
}

export interface MidiAnalysis {
  readonly ppq: number;
  readonly parts: MidiPart[];
  /** 정확한 빠르기(소수). 곡에 넣을 때 반올림한다 */
  readonly tempo: TempoEvent[];
  readonly timeSig: TimeSigEvent[];
}

const SUSTAIN = 64;

/**
 * SMF를 파트별 음 목록으로. 서스테인 페달은 음 길이로 푼다:
 * 페달을 밟은 동안 끈 음은 페달을 뗄 때(또는 같은 음을 다시 칠 때)까지 늘린다.
 */
export function analyzeMidi(smf: Smf): MidiAnalysis {
  const quarter = smf.ppq;
  const toWhole = (tick: number) => rat(tick, quarter * 4);

  // 템포 지도는 모든 트랙의 템포 이벤트를 모은 것 (형식 1은 보통 첫 트랙에 있다)
  const tempoTicks: { tick: number; us: number }[] = [];
  const timeSig: TimeSigEvent[] = [];
  for (const track of smf.tracks) {
    for (const e of track.events) {
      if (e.type === "tempo") tempoTicks.push({ tick: e.tick, us: e.usPerQuarter });
      else if (e.type === "timeSig") timeSig.push({ at: toWhole(e.tick), beats: e.beats, unit: e.unit });
    }
  }
  tempoTicks.sort((a, b) => a.tick - b.tick);
  const seconds = secondsAt(tempoTicks, quarter);

  const parts: MidiPart[] = [];
  smf.tracks.forEach((track, trackIndex) => {
    const name = track.events.find((e) => e.type === "name")?.text ?? "";
    const byChannel = new Map<number, { notes: RawNote[]; program: number }>();
    const program = new Map<number, number>();
    const pedal = new Map<number, boolean>();
    // (채널, 음) → 켜진 음들 (같은 음이 겹쳐 켜질 수 있다)
    const open = new Map<string, { tick: number; velocity: number; released: boolean }[]>();
    const sorted = [...track.events].sort((a, b) => a.tick - b.tick);

    const close = (channel: number, pitch: number, tick: number, which: "first" | "released") => {
      const key = `${channel}:${pitch}`;
      const list = open.get(key);
      if (!list || list.length === 0) return;
      const i = which === "first" ? 0 : list.findIndex((n) => n.released);
      if (i < 0) return;
      const [n] = list.splice(i, 1);
      if (tick <= n!.tick) return;
      let slot = byChannel.get(channel);
      if (!slot) byChannel.set(channel, (slot = { notes: [], program: program.get(channel) ?? 0 }));
      slot.notes.push({
        start: toWhole(n!.tick),
        dur: toWhole(tick - n!.tick),
        seconds: seconds(n!.tick),
        pitch,
        velocity: n!.velocity,
      });
    };

    for (const e of sorted) {
      if (e.type === "program") {
        program.set(e.channel, e.program);
        const slot = byChannel.get(e.channel);
        if (slot && slot.notes.length === 0) slot.program = e.program;
      } else if (e.type === "control" && e.control === SUSTAIN) {
        const down = e.value >= 64;
        pedal.set(e.channel, down);
        if (!down) {
          // 페달을 떼면 그동안 손을 뗀 음들을 끝낸다
          for (const [key, list] of open) {
            const [ch, p] = key.split(":").map(Number) as [number, number];
            if (ch !== e.channel) continue;
            while (list.some((n) => n.released)) close(ch, p, e.tick, "released");
          }
        }
      } else if (e.type === "noteOn") {
        const key = `${e.channel}:${e.pitch}`;
        // 페달로 늘어나던 같은 음은 새로 칠 때 끝난다
        const list = open.get(key) ?? [];
        while (list.some((n) => n.released)) close(e.channel, e.pitch, e.tick, "released");
        list.push({ tick: e.tick, velocity: e.velocity, released: false });
        open.set(key, list);
        if (!byChannel.has(e.channel)) byChannel.set(e.channel, { notes: [], program: program.get(e.channel) ?? 0 });
      } else if (e.type === "noteOff") {
        const list = open.get(`${e.channel}:${e.pitch}`);
        if (!list) continue;
        if (pedal.get(e.channel)) {
          const n = list.find((x) => !x.released);
          if (n) n.released = true;
        } else close(e.channel, e.pitch, e.tick, "first");
      }
    }
    // 끝까지 안 꺼진 음은 트랙 끝(End-of-Track, 없으면 마지막 이벤트)에서 끝낸다
    const lastTick = Math.max(track.endTick ?? 0, sorted.length > 0 ? sorted[sorted.length - 1]!.tick : 0);
    for (const [key, list] of open) {
      const [ch, p] = key.split(":").map(Number) as [number, number];
      while (list.length > 0) close(ch, p, lastTick, "first");
    }

    for (const [channel, slot] of [...byChannel].sort((a, b) => a[0] - b[0])) {
      if (slot.notes.length === 0) continue;
      slot.notes.sort((a, b) => a.seconds - b.seconds || b.pitch - a.pitch);
      const pitches = slot.notes.map((n) => n.pitch);
      const drum = channel === 9;
      parts.push({
        id: `m${trackIndex + 1}c${channel + 1}`,
        track: trackIndex,
        channel,
        name: name || `Track ${trackIndex + 1}`,
        program: slot.program,
        drum,
        notes: slot.notes,
        low: Math.min(...pitches),
        high: Math.max(...pitches),
        polyphony: polyphony(slot.notes),
        suggestion: drum ? { canonical: "bass-drum", matched: true, alternatives: ["cymbal"] } : suggestInstrument(slot.program),
      });
    }
  });

  const tempo: TempoEvent[] = tempoTicks.map((t) => ({ at: toWhole(t.tick), bpm: 60_000_000 / t.us }));
  return { ppq: quarter, parts, tempo, timeSig };
}

/** tick → 초 (템포 지도를 따라) */
function secondsAt(tempo: readonly { tick: number; us: number }[], ppq: number): (tick: number) => number {
  return (tick) => {
    let seconds = 0;
    let lastTick = 0;
    let us = 500_000;
    for (const t of tempo) {
      if (t.tick >= tick) break;
      seconds += ((t.tick - lastTick) * us) / ppq / 1e6;
      lastTick = t.tick;
      us = t.us;
    }
    return seconds + ((tick - lastTick) * us) / ppq / 1e6;
  };
}

function polyphony(notes: readonly RawNote[]): number {
  const edges: [number, number][] = [];
  for (const n of notes) {
    edges.push([n.start.n / n.start.d, 1]);
    edges.push([(n.start.n * n.dur.d + n.dur.n * n.start.d) / (n.start.d * n.dur.d), -1]);
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let max = 0;
  for (const [, d] of edges) max = Math.max(max, (now += d));
  return max;
}
