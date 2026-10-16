import { audioToWav, SoundBankLoader, SpessaSynthProcessor, type BasicSoundBank } from "spessasynth_core";
import { PeakLimiter } from "./limiter.js";
import { assignPatches, type SlotPatch, type Unresolved } from "./patches.js";
import { BEND_RANGE, bendValue } from "./schedule.js";
import type { InstrumentGains, SoundPackRegistry } from "./registry.js";
import type { Schedule } from "./schedule.js";

/** 사운드팩 파일 바이트를 SpessaSynth 사운드뱅크로 읽는다. DLS·SF2 모두 된다 */
export function loadSoundBank(bytes: ArrayBuffer): BasicSoundBank {
  return SoundBankLoader.fromArrayBuffer(bytes);
}

export interface LoadedPack {
  readonly id: string;
  readonly bank: number;
  readonly soundBank: BasicSoundBank;
}

export async function createSynth(sampleRate: number, packs: readonly LoadedPack[]): Promise<SpessaSynthProcessor> {
  const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false, effectsEnabled: false });
  await synth.processorInitialized;
  for (const p of packs) synth.soundBankManager.addSoundBank(p.soundBank, p.id, p.bank);
  return synth;
}

export interface RenderResult {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
  readonly unresolved: Unresolved[];
}

const BLOCK = 128;

/**
 * 일정을 오디오로 미리 그린다(WAV 내보내기, 시험용). 실시간 재생은 같은 일정을
 * AudioWorklet 안의 신스로 보내는 방식이라 결과가 같다.
 */
export async function renderOffline(
  schedule: Schedule,
  registry: SoundPackRegistry,
  packs: readonly LoadedPack[],
  options: RenderOptions = {},
  gains: InstrumentGains = {},
): Promise<RenderResult> {
  const { patches, unresolved } = assignPatches(schedule, registry, gains);
  return { ...(await renderPatched(schedule, patches, packs, options)), unresolved };
}

export interface RenderOptions {
  readonly sampleRate?: number;
  readonly tailSeconds?: number;
  /** 그린 길이 (0~1). 블록마다 부르지 않고 대략 1%마다 */
  readonly onProgress?: (fraction: number) => void;
  /** 전체 음량 (재생의 전체 음량과 같은 배율). 기본 1 */
  readonly volume?: number;
  /** 재생과 같은 리미터를 마지막에 거친다. 기본 켬 (끄는 것은 시험용) */
  readonly limit?: boolean;
}

/**
 * 패치(채널·뱅크·프로그램)를 이미 정한 일정을 그린다. 화면 쪽에서 사운드팩 목록으로 패치를 정하고
 * 웹 워커에서 그릴 때 쓴다
 */
export async function renderPatched(
  schedule: Schedule,
  patches: readonly SlotPatch[],
  packs: readonly LoadedPack[],
  options: RenderOptions = {},
): Promise<RenderResult> {
  const sampleRate = options.sampleRate ?? 44100;
  const synth = await createSynth(sampleRate, packs);
  const bySlot = new Map(patches.map((p) => [p.slot, p]));
  const maxChannel = Math.max(-1, ...patches.map((p) => p.channel));
  if (synth.midiChannels.length <= maxChannel) {
    while (synth.midiChannels.length <= maxChannel) synth.createMIDIChannel();
    // 새로 만든 채널은 볼륨 등 컨트롤러가 0이라 소리가 나지 않는다. 전체 초기화로 기본값을 채운다
    // (드럼은 16n+9만 되고, 그 채널은 쓰지 않는다)
    synth.reset();
  }
  for (const p of patches) {
    synth.controllerChange(p.channel, 0, p.bank);
    synth.programChange(p.channel, p.program);
    synth.midiChannels[p.channel]!.setSystemParameter("gain", p.gain ?? 1);
    setBendRange(synth, p.channel, BEND_RANGE);
  }

  const total = Math.ceil((schedule.duration + (options.tailSeconds ?? 1.5)) * sampleRate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let cursor = 0;
  let index = 0;
  const events = schedule.events;
  const step = Math.max(1, Math.floor(total / 100));
  const volume = options.volume ?? 1;
  const limiter = options.limit === false ? undefined : new PeakLimiter(sampleRate);
  let nextReport = step;

  while (cursor < total) {
    // 다음 이벤트 시각에서 블록을 끊으므로 이벤트는 샘플 단위로 정확히 들어간다
    while (index < events.length && Math.round(events[index]!.time * sampleRate) <= cursor) {
      const e = events[index++]!;
      const patch = bySlot.get(e.slot);
      if (!patch) continue;
      if (e.type === "bend") synth.pitchWheel(patch.channel, bendValue(e.bend ?? 0));
      else if (e.type === "on") synth.noteOn(patch.channel, e.note, e.velocity);
      else synth.noteOff(patch.channel, e.note);
    }
    const next = index < events.length ? Math.round(events[index]!.time * sampleRate) : total;
    const count = Math.max(1, Math.min(BLOCK, next - cursor, total - cursor));
    synth.process(left, right, cursor, count);
    // 재생과 같은 끝단: 전체 음량 → 리미터
    if (volume !== 1) {
      for (let i = cursor; i < cursor + count; i++) {
        left[i] = left[i]! * volume;
        right[i] = right[i]! * volume;
      }
    }
    limiter?.process(left, right, cursor, count);
    cursor += count;
    if (cursor >= nextReport) {
      options.onProgress?.(Math.min(1, cursor / total));
      nextReport += step;
    }
  }
  // 리미터는 latency 샘플만큼 늦춰 내보낸다: 남은 소리를 마저 꺼내고 앞을 잘라 시작을 맞춘다
  if (limiter) {
    const lag = limiter.latency;
    const tailLeft = new Float32Array(lag);
    const tailRight = new Float32Array(lag);
    limiter.process(tailLeft, tailRight);
    left.copyWithin(0, lag);
    right.copyWithin(0, lag);
    for (let i = Math.max(0, total - lag); i < total; i++) {
      left[i] = tailLeft[i + lag - total]!;
      right[i] = tailRight[i + lag - total]!;
    }
  }
  return { left, right, sampleRate, unresolved: [] };
}

/** RPN 0(피치 벤드 범위)을 반음 단위로 */
function setBendRange(synth: SpessaSynthProcessor, channel: number, semitones: number): void {
  synth.controllerChange(channel, 101, 0);
  synth.controllerChange(channel, 100, 0);
  synth.controllerChange(channel, 6, semitones);
  synth.controllerChange(channel, 38, 0);
}

export function toWav(result: RenderResult): ArrayBuffer {
  return audioToWav([result.left, result.right], result.sampleRate);
}
