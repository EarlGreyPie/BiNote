import {
  assignPatches,
  bendValue,
  buildSchedule,
  LivePlayer,
  PREVIEW_CHANNEL,
  SoundPackRegistry,
  type LiveSink,
  type SoundPackInfo,
  type Unresolved,
  type InstrumentGains,
  type SlotPatch,
  limiterWorkletSource,
  PeakLimiter,
} from "@mmlce/audio/browser";
import { getProfile, positionToSeconds, type Rat, type Song } from "@mmlce/core";
import type { WorkletSynthesizer } from "spessasynth_lib";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import { computePeaks, type Peaks } from "./waveform";
import type { WavRequest } from "./jobs";

/** CC 0 = 뱅크 선택(MSB) */
const BANK_SELECT = 0;
/** 리미터 워크릿 이름 */
const LIMITER = "mmlce-limiter";

/**
 * 브라우저 재생 엔진. AudioWorklet 안의 SpessaSynth에 사운드팩을 여러 개 올리고,
 * 오프라인 렌더와 같은 일정(buildSchedule)을 실시간으로 보낸다.
 */
/** 재생 채널(16n+9 제외)과 미리듣기 채널 63까지 */
const MAX_CHANNELS = 64;
/** 전체 음량 최대 (4배 ≈ +12dB). 사운드팩이 작게 녹음된 경우를 위해 1보다 크게 둔다 */
export const MASTER_MAX = 4;

/** 오디오가 막 깨어났을 때 첫 음 앞에 두는 여유(초). 그동안 신스가 악기 샘플을 준비한다 */
const COLD_START_DELAY = 0.4;

/** 오디오 시계가 실제로 흐르기 시작할 때까지 기다린다 (최대 1초) */
async function waitForClock(context: AudioContext): Promise<void> {
  const t0 = context.currentTime;
  const until = performance.now() + 1000;
  while (context.currentTime <= t0 && performance.now() < until) await new Promise((r) => setTimeout(r, 15));
}

export class Engine {
  readonly registry = new SoundPackRegistry();
  private context: AudioContext | undefined;
  private synth: WorkletSynthesizer | undefined;
  private player: LivePlayer | undefined;
  onEnd: (() => void) | undefined;

  /** 원곡(템포 맞추기용 오디오). 같은 오디오 시계로 곡과 샘플 단위로 맞춰 튼다 */
  private reference: AudioBuffer | undefined;
  private referenceSource: AudioBufferSourceNode | undefined;
  /** 반복 경계에서 멈추게 예약해 둔 앞 회차 원곡. 그 전에 정지하면 함께 끈다 */
  private endingSources = new Set<AudioBufferSourceNode>();
  private referenceGain: GainNode | undefined;
  /** 원곡 시각 = 곡 시각 + 이 값(초). 원곡 앞에 전주가 길면 양수 */
  private referenceOffset = 0;
  private fromSeconds = 0;

  private starting: Promise<WorkletSynthesizer> | undefined;
  /** 지금 있는 신스 채널 수 (라이브러리의 channelCount는 채널을 더할 때 두 번 셀 수 있어 따로 센다) */
  private channels = 16;

  /** 오디오는 사용자가 누른 뒤에만 켤 수 있어서, 처음 쓸 때 만든다. 동시에 불려도 한 번만 만든다 */
  private ready(): Promise<WorkletSynthesizer> {
    if (this.synth) return Promise.resolve(this.synth);
    this.starting ??= this.create().catch((e) => {
      this.starting = undefined;
      throw e;
    });
    return this.starting;
  }

  /** 트랙마다 채널을 쓰므로 모자라면 더 만든다. 새 채널은 드럼으로 생기므로 멜로디 채널로 바꾼다 */
  /** 채널은 시작할 때 MAX_CHANNELS개를 다 만들어 둔다. 그보다 많이 쓰는 일은 없지만, 혹시 넘으면 더 만들고 초기화한다 */
  private ensureChannels(maxChannel: number): void {
    const synth = this.synth!;
    if (this.channels > maxChannel) return;
    while (this.channels <= maxChannel) {
      synth.addNewChannel();
      this.channels++;
    }
    synth.reset();
  }

  private async create(): Promise<WorkletSynthesizer> {
    // 신스 라이브러리는 커서 처음 소리를 낼 때 불러온다 (첫 화면을 빨리 띄우려고)
    const { WorkletSynthesizer } = await import("spessasynth_lib");
    const context = new AudioContext();
    await context.audioWorklet.addModule(processorUrl);
    // 리미터는 WAV 저장과 같은 코드(PeakLimiter)를 워크릿으로 올린다
    const limiterUrl = URL.createObjectURL(new Blob([limiterWorkletSource(LIMITER)], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(limiterUrl);
    } finally {
      URL.revokeObjectURL(limiterUrl);
    }
    const synth = new WorkletSynthesizer(context);
    // 전체 음량: 신스 → 음량 → 스피커 (미리듣기 대체 소리도 같은 음량을 지난다)
    const master = context.createGain();
    master.gain.value = this.masterVolume;
    // 음량을 1보다 크게 올리거나 악기별 음량을 키워도 소리가 깨지지 않게 끝에 리미터를 둔다
    // (문턱 −3dB 아래에서는 손대지 않는다). WAV 저장도 같은 리미터를 거친다
    const limiter = new AudioWorkletNode(context, LIMITER, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    master.connect(limiter).connect(context.destination);
    // 리미터는 다가올 봉우리를 미리 보려고 소리를 조금(3ms) 늦춘다. 재생선도 그만큼 늦춘다
    this.limiterLag = new PeakLimiter(context.sampleRate).latency / context.sampleRate;
    this.master = master;
    synth.connect(master);
    await synth.isReady;
    // 트랙마다 채널을 쓰므로 64채널을 처음에 한 번 다 만든다. 새로 만든 채널은 볼륨 등 컨트롤러가 0이라
    // 소리가 나지 않으므로, 다 만든 뒤 전체 초기화로 기본값(볼륨 100 등)을 채운다. 재생 중에 채널을 늘리면
    // 초기화가 울리는 소리를 끊으니, 시작할 때만 한다
    for (let ch = this.channels; ch < MAX_CHANNELS; ch++) synth.addNewChannel();
    this.channels = MAX_CHANNELS;
    synth.reset();
    const sink: LiveSink = {
      get currentTime() {
        return context.currentTime;
      },
      setGain: (channel, gain) => synth.midiChannels[channel]?.setSystemParameter("gain", gain),
      setPatch(channel, bank, program, time) {
        synth.controllerChange(channel, BANK_SELECT, bank, { time });
        synth.programChange(channel, program, { time });
      },
      noteOn: (channel, note, velocity, time) => synth.noteOn(channel, note, velocity, { time }),
      noteOff: (channel, note, time) => synth.noteOff(channel, note, { time }),
      pitchBend: (channel, semitones, time) => synth.pitchWheel(channel, bendValue(semitones), { time }),
      // 라이브러리 pitchWheelRange는 값(데이터 엔트리)에 시각을 빼먹어 예약하면 범위가 안 바뀐다. 직접 RPN 0을 보낸다
      setBendRange: (channel, semitones, time) => {
        synth.controllerChange(channel, 101, 0, { time });
        synth.controllerChange(channel, 100, 0, { time });
        synth.controllerChange(channel, 6, semitones, { time });
        synth.controllerChange(channel, 38, 0, { time });
        synth.controllerChange(channel, 101, 127, { time });
        synth.controllerChange(channel, 100, 127, { time });
      },
      // All Sound Off(CC 120): 그 채널 음을 끝소리 없이 바로 끊는다. 신스 큐는 같은 시각이면 넣은 순서대로 처리한다
      cut: (channel, time) => synth.controllerChange(channel, 120, 0, { time }),
      silence: () => synth.stopAll(true),
    };
    this.player = new LivePlayer(sink);
    this.player.onEnd = () => {
      this.stopReference();
      this.onEnd?.();
    };
    // 반복 구간 처음으로 돌아가면 원곡도 그 자리로 다시 맞춘다
    this.player.onWrap = (at) => this.startReference(at);
    this.context = context;
    this.synth = synth;
    return synth;
  }

  /** 올린 사운드팩 파일 (WAV 저장 때 워커에서 다시 읽는다) */
  private packFiles = new Map<string, { bank: number; file: File }>();

  async addPack(file: File): Promise<SoundPackInfo> {
    const synth = await this.ready();
    const id = `${file.name}#${this.registry.nextBank}`;
    const bank = this.registry.nextBank;
    this.packFiles.set(id, { bank, file });
    await synth.soundBankManager.addSoundBank(await file.arrayBuffer(), id, bank);
    // 팩마다 뱅크를 밀어 올렸으므로, 이 팩의 프리셋은 그 뱅크 번호로 보인다
    const presets = synth.presetList
      .filter((p) => p.bankMSB === bank)
      .map((p) => ({ program: p.program, bankMSB: 0, name: p.name }));
    return this.registry.add(id, file.name, { presets });
  }

  async removePack(id: string): Promise<void> {
    this.registry.remove(id);
    this.packFiles.delete(id);
    await this.synth?.soundBankManager.deleteSoundBank(id);
  }

  get playing(): boolean {
    return this.player?.playing ?? false;
  }

  /** 한 번이라도 소리를 낸 뒤인지 (첫 재생은 시작을 조금 늦춘다) */
  private warmed = false;

  /** 리미터가 늦추는 시간(초) */
  private limiterLag = 0;

  /** 사용자가 정한 화면 싱크 보정(초). +면 재생선을 더 늦춘다 */
  syncOffset = 0;

  /**
   * 소리가 실제로 스피커에서 나기까지 걸리는 시간(초). 아이패드·블루투스는 이게 커서
   * 재생선이 소리보다 앞서 간다. 브라우저가 알려 주는 출력 지연에 사용자 보정을 더한다
   */
  get outputLag(): number {
    const c = this.context;
    const reported = c ? (c.outputLatency || 0) + (c.baseLatency || 0) : 0;
    return reported + this.limiterLag + this.syncOffset;
  }

  /** 지금 들리는 곡 위치(초). 출력 지연만큼 늦춰 재생선이 소리와 맞게 한다 */
  get position(): number {
    if (!this.player) return 0;
    return this.player.playing ? this.player.positionLagged(this.outputLag) : this.player.position;
  }

  /** 재생을 시작하고, 사운드팩에서 찾지 못한 악기를 돌려준다 */
  /** loop: 반복할 길이(초). 주면 시작 자리부터 그 길이를 끊김 없이 되풀이한다 */
  async play(song: Song, from?: Rat, loop?: number): Promise<Unresolved[]> {
    await this.ready();
    const context = this.context!;
    // 오디오가 쉬고 있다 깨어나면(첫 재생, 아이패드가 재운 뒤) 첫 음이 늦게 나므로 시계가 실제로 돌기를 기다리고 조금 늦게 시작한다
    const cold = !this.warmed || context.state !== "running";
    await context.resume();
    if (cold) await waitForClock(context);
    this.warmed = true;
    const schedule = buildSchedule(song, getProfile(song.meta.profileId), from ? { from } : {});
    const { patches, unresolved } = assignPatches(schedule, this.registry, this.gains);
    this.ensureChannels(Math.max(-1, ...patches.map((p) => p.channel)));
    this.playingPatches = patches;
    this.player!.start(schedule, patches, { ...(loop ? { loop } : {}), ...(cold ? { delay: COLD_START_DELAY } : {}) });
    this.fromSeconds = from ? positionToSeconds(song.tempo, from) : 0;
    this.startReference();
    return unresolved;
  }

  /**
   * WAV 저장 요청: 곡 처음부터 끝까지, 들리는 트랙(뮤트·솔로 반영)을 지금 사운드팩으로. 패치는 재생과 같은 규칙으로
   * 여기서 정하고, 그리기는 워커가 한다. 사운드팩이 없으면 undefined
   */
  async wavRequest(song: Song): Promise<{ request: WavRequest; unresolved: Unresolved[] } | undefined> {
    if (this.packFiles.size === 0) return undefined;
    const schedule = buildSchedule(song, getProfile(song.meta.profileId));
    const { patches, unresolved } = assignPatches(schedule, this.registry, this.gains);
    const used = new Set(patches.map((p) => p.packId));
    const packs = await Promise.all(
      [...this.packFiles].filter(([id]) => used.has(id)).map(async ([id, { bank, file }]) => ({ id, bank, bytes: await file.arrayBuffer() })),
    );
    // 재생과 같은 끝단(전체 음량 → 리미터)으로 그려, 들은 소리와 저장한 소리가 같게 한다
    return { request: { schedule, patches, packs, volume: this.masterVolume }, unresolved };
  }

  /** 악기별 음량(dB). 설정 창에서 바꾸면 재생 중인 소리에도 바로 적용한다 */
  private gains: InstrumentGains = {};
  private playingPatches: readonly SlotPatch[] = [];

  setInstrumentGains(gains: InstrumentGains): void {
    this.gains = gains;
    const synth = this.synth;
    if (!synth) return;
    for (const p of this.playingPatches) {
      synth.midiChannels[p.channel]?.setSystemParameter("gain", this.registry.gainOf(p.packId, p.program, gains));
    }
    this.previewKey = "";
  }

  stop(): void {
    this.player?.stop();
    this.stopReference();
  }

  /** 건반 입력 미리듣기 전용 채널 (재생 트랙 채널과 겹치지 않게 맨 끝) */
  private static readonly PREVIEW_CHANNEL = PREVIEW_CHANNEL;
  private previewKey = "";

  /** 건반을 누르는 동안 그 악기 소리를 낸다 (사운드팩에 없으면 조용히) */
  /** 미리듣기로 누르고 있는 건반. 오디오를 켜는 동안 떼면 늦게 소리 내지 않는다 */
  private previewHeld = new Set<number>();

  async previewOn(instrument: string, program: number | undefined, pitch: number, velocity: number): Promise<void> {
    this.previewHeld.add(pitch);
    const synth = await this.ready();
    await this.context!.resume();
    if (!this.previewHeld.has(pitch)) return;
    const patch = this.registry.resolve(instrument, program);
    if (!patch) {
      // 사운드팩이 없거나 그 악기가 없으면 간단한 소리로 높이만 들려준다
      this.fallbackOn(pitch, velocity);
      return;
    }
    const ch = Engine.PREVIEW_CHANNEL;
    this.ensureChannels(ch);
    const key = `${patch.bank}/${patch.program}`;
    if (key !== this.previewKey) {
      synth.controllerChange(ch, BANK_SELECT, patch.bank);
      synth.programChange(ch, patch.program);
      synth.midiChannels[ch]?.setSystemParameter("gain", this.registry.gainOf(patch.packId, patch.program, this.gains));
      this.previewKey = key;
    }
    synth.noteOn(ch, pitch, velocity);
  }

  previewOff(pitch: number): void {
    this.previewHeld.delete(pitch);
    this.synth?.noteOff(Engine.PREVIEW_CHANNEL, pitch);
    this.fallbackOff(pitch);
  }

  /** 사운드팩 없이 내는 미리듣기 소리 (삼각파, 짧게 줄어듦) */
  private fallback = new Map<number, { osc: OscillatorNode; gain: GainNode }>();

  private fallbackOn(pitch: number, velocity: number): void {
    const context = this.context;
    if (!context) return;
    this.fallbackOff(pitch);
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "triangle";
    osc.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
    const peak = 0.25 * (velocity / 127);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(peak * 0.3, now + 0.8);
    osc.connect(gain).connect(this.master ?? context.destination);
    osc.start(now);
    // 끄기를 놓쳐도 계속 울리지 않게 몇 초 뒤 스스로 멈춘다
    osc.stop(now + 4);
    osc.onended = () => {
      if (this.fallback.get(pitch)?.osc === osc) this.fallback.delete(pitch);
    };
    this.fallback.set(pitch, { osc, gain });
  }

  private fallbackOff(pitch: number): void {
    const voice = this.fallback.get(pitch);
    const context = this.context;
    if (!voice || !context) return;
    this.fallback.delete(pitch);
    const now = context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, 0.03);
    voice.osc.stop(now + 0.2);
  }

  /** 불러온 원곡의 파형 요약 (피아노롤 마디 줄 아래 파형 띠) */
  referencePeaks(): Peaks | undefined {
    const r = this.reference;
    if (!r) return undefined;
    return computePeaks(Array.from({ length: r.numberOfChannels }, (_, i) => r.getChannelData(i)), r.sampleRate);
  }

  /** 원곡 파일(음원·영상)을 불러와 길이(초)를 돌려준다 */
  async loadReference(file: File): Promise<number> {
    await this.ready();
    const context = this.context!;
    this.reference = await context.decodeAudioData(await file.arrayBuffer());
    if (!this.referenceGain) {
      this.referenceGain = context.createGain();
      // 합성음은 리미터를 지나며 3ms 늦게 나오므로 원곡도 같은 만큼 늦춰 함께 듣는 시각을 맞춘다
      const delay = context.createDelay(0.05);
      delay.delayTime.value = this.limiterLag;
      this.referenceGain.connect(delay).connect(context.destination);
    }
    if (this.playing) this.startReference();
    return this.reference.duration;
  }

  clearReference(): void {
    this.stopReference();
    this.reference = undefined;
  }

  private master: GainNode | undefined;
  private masterVolume = 1;

  /** 전체 음량 (0~1.5). 오디오를 켜기 전에 정해도 켤 때 쓴다 */
  setMasterVolume(volume: number): void {
    this.masterVolume = volume;
    if (this.master && this.context) this.master.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
  }

  setReferenceVolume(volume: number): void {
    if (this.referenceGain) this.referenceGain.gain.value = volume;
  }

  /** 어긋남을 바꾸면 재생 중인 원곡도 그 자리로 다시 맞춘다 */
  setReferenceOffset(seconds: number): void {
    this.referenceOffset = seconds;
    if (this.playing) this.startReference();
  }

  private startReference(wrapAt?: number): void {
    // 반복 경계 알림은 미리 예약하느라 경계보다 조금 먼저 온다. 지금 원곡은 경계에서 멈추게 예약한다
    this.stopReference(wrapAt);
    const context = this.context;
    const origin = wrapAt ?? this.player?.startTime;
    if (!context || !this.reference || !this.referenceGain || origin === undefined) return;
    // 지금(아직 시작 전이면 곡 시작 시각) 곡이 있을 자리에 원곡을 맞춘다. 반복으로 돌아갈 때는 그 경계 시각에 맞춘다
    const at = wrapAt ?? Math.max(context.currentTime, origin);
    const want = this.fromSeconds + (at - origin) + this.referenceOffset;
    const source = context.createBufferSource();
    source.buffer = this.reference;
    source.connect(this.referenceGain);
    if (want >= 0) source.start(at, want);
    else source.start(at - want, 0);
    this.referenceSource = source;
  }

  /** at을 주면 그 오디오 시각에 멈추게 예약하고(연결은 소리가 끝날 때 끊긴다), 없으면 바로 멈춘다 */
  private stopReference(at?: number): void {
    const source = this.referenceSource;
    this.referenceSource = undefined;
    const halt = (s: AudioBufferSourceNode, when = 0) => {
      try {
        s.stop(when);
      } catch {
        // 이미 끝난 소스
      }
    };
    if (at === undefined) {
      // 바로 정지: 경계를 기다리던 앞 회차 원곡까지 모두 끈다
      for (const s of [...this.endingSources, ...(source ? [source] : [])]) {
        halt(s);
        s.disconnect();
      }
      this.endingSources.clear();
      return;
    }
    if (!source) return;
    halt(source, at);
    this.endingSources.add(source);
    source.onended = () => {
      source.disconnect();
      this.endingSources.delete(source);
    };
  }
}
