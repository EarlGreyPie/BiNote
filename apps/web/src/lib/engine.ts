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
import { getProfile, positionToSeconds, type GameProfile, type Rat, type Song } from "@mmlce/core";
import type { WorkletSynthesizer } from "spessasynth_lib";
import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";
import { computePeaks, type Peaks } from "./waveform";
import { previewPitch } from "./instrumentRange";
import { PreviewVoices } from "./previewVoices";
import { preparePlay } from "./playPlan";
import type { WavRequest } from "./jobs";
import { audioLag, CLOCK_STOP_SLACK, clockMoves, clockStats, FROZEN_MS, isTouchWebKit, needsRebuild, settlesWithin, staleAfterReturn, type ClockPair } from "./audioHealth";

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
/** 보통 재생 시작 여유(초). LivePlayer 기본값과 같다 */
const START_DELAY = 0.1;

/** CC 120 = 소리 모두 끄기 (끝소리 없이) */
const ALL_SOUND_OFF = 120;

/** 잠자기 뒤 오디오를 깨울 때 resume()을 기다리는 최대 시간(ms). 아이패드는 이게 끝나지 않을 때가 있다 */
const RESUME_TIMEOUT = 800;
/** 깨운 뒤 오디오 시계가 흐르는지 보는 시간(ms) */
const CLOCK_TIMEOUT = 400;

/** 브라우저가 알려 주는 출력 지연(초). 모르는 브라우저는 0 */
function reportedLatency(context: AudioContext): number {
  return (context.outputLatency || 0) + (context.baseLatency || 0);
}

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

  /** 워크릿이 오류로 멈췄다. 다음에 쓸 때 오디오를 새로 만든다 */
  private broken = false;
  /**
   * 기기를 재웠거나 화면을 가렸다가 돌아왔다. 아이패드는 전원 버튼으로 재웠다 깨우면 오디오를 멈춘 채 두고
   * 다시 켜지지 않을 때가 있어(소리 없음, 사운드팩 다시 올리기도 멈춤), 다음에 쓸 때 살아 있는지 확인한다
   */
  private suspect = false;
  /** 화면이 가려진 시각(performance.now). 보이는 동안은 undefined */
  private hiddenAt: number | undefined;
  /** 마지막으로 오디오를 확인한 뒤 가장 오래 가려져 있던 시간(ms) */
  private hiddenMs = 0;
  /** 가려진 사이 시스템이 오디오를 멈췄다 (아이패드 화면 잠금 등). 다시 켜졌어도 소리가 밀릴 수 있어 새로 만든다 */
  private interrupted = false;
  /** 소리를 처음 낼 때 브라우저가 알려 준 출력 지연(초). 돌아온 뒤 크게 늘었으면 오디오를 새로 만든다 */
  private latencyBefore = 0;
  /** 아이패드·아이폰인지 (화면 잠금 뒤 오디오를 새로 만들지 정할 때 쓴다) */
  private readonly touchWebKit = typeof navigator !== "undefined" && isTouchWebKit(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  /** 마지막 심장 박동(1초마다 부르는 타이머)에서 읽은 시계. 오디오 시계가 멈췄었는지 보려고 */
  private beat: (ClockPair & { at: number }) | undefined;
  /** 오디오 상태 칸에 보여 줄 최근 일 (가려짐·멈춤·새로 만듦) */
  private readonly events: string[] = [];
  /** 오디오를 새로 만든 횟수 (처음 만든 것 빼고) */
  private rebuilds = 0;
  /** 오디오를 새로 만드는 중 */
  private reviving: Promise<WorkletSynthesizer> | undefined;
  /** 지금 신스를 버리면 풀리는 약속. 버린 신스의 응답을 기다리던 작업(팩 올리기 등)이 멈춰 있지 않게 한다 */
  private lost: { promise: Promise<void>; resolve: () => void } = Engine.lostSignal();

  private static lostSignal(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  }

  constructor() {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.suspect = true;
        this.hiddenAt ??= performance.now();
        this.note("hidden");
        return;
      }
      if (this.hiddenAt !== undefined) this.hiddenMs = Math.max(this.hiddenMs, performance.now() - this.hiddenAt);
      this.note(`visible after ${this.hiddenAt === undefined ? "?" : ((performance.now() - this.hiddenAt) / 1000).toFixed(1)}s, audio ${this.context?.state ?? "-"}`);
      this.hiddenAt = undefined;
      // 돌아왔는데 오디오가 멈춰 있으면 가려진 사이 시스템이 멈춘 것이다 (onstatechange가 늦게 오거나 안 올 때)
      const c = this.context;
      if (c && this.warmed && c.state !== "running") this.interrupted = true;
    });
    // 앱으로 띄운 아이패드는 화면을 잠가도 가려짐 알림이 오지 않을 때가 있다. 1초마다 시계를 읽어
    // 타이머가 오래 멈췄으면(페이지가 얼었음) 잠금으로, 오디오 시계만 덜 갔으면 오디오가 멈췄던 것으로 본다
    setInterval(() => this.heartbeat(), 1000);
    // 뒤로 가기 캐시에서 돌아온 페이지도 오디오가 멈춰 있을 수 있다
    window.addEventListener("pageshow", (e) => {
      if (!e.persisted) return;
      this.suspect = true;
      if (this.warmed) this.interrupted = true;
    });
    // 한 번 소리를 낸 뒤 멈춘 오디오는 화면을 누를 때 바로 깨운다. 아이패드는 누른 그 순간에만 깨울 수 있다.
    // 화면 잠금 뒤처럼 새로 만들 오디오는 깨우지 않는다 (재생·미리듣기를 누를 때 새로 만든다)
    const wake = () => {
      const c = this.context;
      if (c && this.warmed && c.state !== "running" && c.state !== "closed" && !this.stale()) void c.resume().catch(() => {});
    };
    document.addEventListener("pointerdown", wake, true);
    document.addEventListener("keydown", wake, true);
  }
  /** 지금 있는 신스 채널 수 (라이브러리의 channelCount는 채널을 더할 때 두 번 셀 수 있어 따로 센다) */
  private channels = 16;

  /** 오디오는 사용자가 누른 뒤에만 켤 수 있어서, 처음 쓸 때 만든다. 동시에 불려도 한 번만 만든다 */
  private ready(made?: AudioContext): Promise<WorkletSynthesizer> {
    if (this.synth) return Promise.resolve(this.synth);
    this.starting ??= this.create(made).catch((e) => {
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

  private async create(made?: AudioContext): Promise<WorkletSynthesizer> {
    // 새로 만들 때는 누른 그 순간에 오디오를 만들어 둔다 (아이패드는 그때만 소리를 켤 수 있다)
    const context = made ?? new AudioContext();
    // 신스 라이브러리는 커서 처음 소리를 낼 때 불러온다 (첫 화면을 빨리 띄우려고)
    const { WorkletSynthesizer } = await import("spessasynth_lib");
    await context.audioWorklet.addModule(processorUrl);
    // 리미터는 WAV 저장과 같은 코드(PeakLimiter)를 워크릿으로 올린다
    const limiterUrl = URL.createObjectURL(new Blob([limiterWorkletSource(LIMITER)], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(limiterUrl);
    } finally {
      URL.revokeObjectURL(limiterUrl);
    }
    const synth = new WorkletSynthesizer(context);
    // 워크릿이 오류로 멈추면 그 뒤로 소리가 나지 않는다. 다음에 쓸 때 새로 만든다
    const node = (synth as unknown as { worklet?: AudioWorkletNode }).worklet;
    if (node) node.onprocessorerror = () => (this.broken = true);
    // 소리를 낸 뒤 오디오가 멈추면(잠자기·다른 앱이 오디오를 가져감) 다음에 쓸 때 살아 있는지 확인한다
    context.onstatechange = () => {
      if (this.context === context) this.note(`audio ${context.state}`);
      if (this.context !== context || context.state === "running" || !this.warmed) return;
      this.suspect = true;
      if (document.visibilityState === "hidden") this.interrupted = true;
    };
    // 전체 음량: 신스 → 음량 → 스피커 (미리듣기 대체 소리도 같은 음량을 지난다)
    const master = context.createGain();
    master.gain.value = this.masterVolume;
    // 음량을 1보다 크게 올리거나 악기별 음량을 키워도 소리가 깨지지 않게 끝에 리미터를 둔다
    // (문턱 −3dB 아래에서는 손대지 않는다). WAV 저장도 같은 리미터를 거친다
    const limiter = new AudioWorkletNode(context, LIMITER, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    limiter.onprocessorerror = () => (this.broken = true);
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
    // 오디오를 새로 만든 경우: 올려 두었던 사운드팩을 같은 이름·뱅크로 다시 올린다 (등록부는 그대로)
    for (const [id, { bank, file }] of [...this.packFiles]) {
      if (this.packFiles.get(id)?.file !== file) continue;
      try {
        await synth.soundBankManager.addSoundBank(await file.arrayBuffer(), id, bank);
      } catch {
        // 한 팩을 못 올려도 나머지 팩과 오디오는 살린다 (그 팩 악기만 소리가 나지 않는다)
      }
    }
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

  /**
   * 쓰기 전에 오디오가 살아 있는지 본다. 잠자기 뒤 멈춘 채 깨어나지 않거나 닫혔거나 워크릿이 멈췄으면
   * 버리고 새로 만든 뒤 사운드팩을 다시 올린다. 재생·미리듣기·사운드팩 올리기/빼기 때 부른다
   */
  private async live(): Promise<WorkletSynthesizer> {
    if (this.reviving) return this.reviving;
    const context = this.context;
    if (!this.synth || !context) return this.ready();
    const state = context.state as string;
    // 닫혔거나 멈췄거나, 재운 뒤 "중단됨"으로 남아 있으면 바로 새로 만든다 (누른 그 순간에 만들어야 소리가 켜진다)
    if (this.broken || state === "closed" || (this.suspect && state === "interrupted")) return this.rebuild(this.broken ? "broken" : state);
    if (!this.suspect) return this.synth;
    // 화면 잠금 뒤처럼 시계는 흘러도 소리가 밀리는 경우: 누른 그 순간에 새로 만든다
    if (this.stale()) return this.rebuild(this.interrupted ? "stale: interrupted" : `stale: hidden ${(this.hiddenMs / 1000).toFixed(1)}s`);
    // 의심스러우면 깨워 보고 시계가 흐르는지 확인한다
    await settlesWithin(context.resume(), RESUME_TIMEOUT);
    const clockMoved = context.state === "running" && (await clockMoves(() => context.currentTime, CLOCK_TIMEOUT));
    if (this.context !== context) return this.live();
    if (!needsRebuild({ state: context.state, broken: this.broken, suspect: this.suspect, clockMoved })) {
      this.suspect = false;
      this.interrupted = false;
      this.hiddenMs = 0;
      return this.synth!;
    }
    return this.rebuild("clock stuck");
  }

  /** 1초마다: 페이지가 얼었었는지, 그사이 오디오 시계가 멈췄었는지 본다 */
  private heartbeat(): void {
    const now = performance.now();
    const last = this.beat;
    const c = this.context;
    this.beat = c ? { audio: c.currentTime, wall: now / 1000, at: now } : undefined;
    if (!last || !c) return;
    const gap = now - last.at;
    if (gap >= FROZEN_MS) {
      // 타이머가 오래 멈췄다: 화면 잠금·절전. 가려짐 알림이 없었어도 가려졌던 것으로 친다
      this.suspect = true;
      this.hiddenMs = Math.max(this.hiddenMs, gap);
      this.note(`frozen ${(gap / 1000).toFixed(1)}s, audio ${c.state}`);
    }
    if (!this.warmed) return;
    const lag = audioLag(last, this.beat!);
    if (lag > CLOCK_STOP_SLACK) {
      // 벽시계는 갔는데 오디오 시계는 멈춰 있었다: 시스템이 오디오를 멈췄다 (다시 켜졌어도 밀릴 수 있음)
      this.suspect = true;
      if (!this.interrupted) this.note(`audio clock stopped ${lag.toFixed(1)}s`);
      this.interrupted = true;
    }
  }

  /** 오디오 상태 칸에 남길 일 (최근 12개) */
  private note(what: string): void {
    const d = new Date();
    const hms = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
    this.events.push(`${hms} ${what}`);
    if (this.events.length > 12) this.events.shift();
  }

  /** 오디오 상태 칸의 "오디오 다시 만들기". 누른 그 순간에 새로 만들고, 잠금 뒤 밀림이 이것으로 풀리는지 볼 수 있다 */
  async rebuildNow(): Promise<void> {
    if (!this.context) return;
    await this.rebuild("manual");
  }

  /**
   * 오디오 상태 칸에 보여 줄 글. 오디오 시계를 1초 동안 읽어 빠르기·건너뛰기를 재고,
   * 브라우저가 알려 주는 지연과 실제 출력 시각(getOutputTimestamp)을 함께 적는다. 화면 잠금 전후를 비교하려고 쓴다
   */
  async audioReport(): Promise<string> {
    const c = this.context;
    const ms = (s: number) => `${(s * 1000).toFixed(1)}ms`;
    const standalone = typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches;
    const lines = [
      `ua: ${navigator.userAgent}`,
      `app: ${standalone ? "standalone" : "browser"}, touchWebKit: ${this.touchWebKit}, visible: ${document.visibilityState}`,
    ];
    if (!c) {
      lines.push("audio: - (no sound yet)");
    } else {
      const samples: ClockPair[] = [];
      const until = performance.now() + 1000;
      while (performance.now() < until) {
        samples.push({ audio: c.currentTime, wall: performance.now() / 1000 });
        await new Promise((r) => setTimeout(r, 10));
      }
      const { rate, maxStepMs } = clockStats(samples);
      lines.push(
        `state: ${c.state}, sampleRate: ${c.sampleRate}, warmed: ${this.warmed}, suspect: ${this.suspect}, stale: ${this.stale()}`,
        `baseLatency: ${ms(c.baseLatency || 0)}, outputLatency: ${ms(c.outputLatency || 0)}, limiter: ${ms(this.limiterLag)}, syncOffset: ${ms(this.syncOffset)}`,
        `clock rate: ${rate.toFixed(4)}, max step: ${maxStepMs.toFixed(1)}ms`,
      );
      if (typeof c.getOutputTimestamp === "function") {
        const ts = c.getOutputTimestamp();
        const now = performance.now();
        // 지금 오디오 시계와 지금 스피커에서 나는 소리의 오디오 시각 차이 = 실제 출력 지연(근사)
        if (ts.contextTime !== undefined && ts.performanceTime !== undefined) {
          const heard = ts.contextTime + (now - ts.performanceTime) / 1000;
          lines.push(`output delay (timestamp): ${ms(c.currentTime - heard)}`);
        }
      }
    }
    lines.push(`rebuilds: ${this.rebuilds}`, ...this.events);
    return lines.join("\n");
  }

  /** 화면을 가렸다 돌아온 뒤 시계가 흘러도 오디오를 새로 만들어야 하는지 (staleAfterReturn) */
  private stale(): boolean {
    const c = this.context;
    if (!c || !this.suspect) return false;
    return staleAfterReturn({
      warmed: this.warmed,
      interrupted: this.interrupted,
      hiddenMs: this.hiddenMs,
      touchWebKit: this.touchWebKit,
      latencyBefore: this.latencyBefore,
      latencyNow: reportedLatency(c),
    });
  }

  /** 지금 오디오를 버리고 새로 만든다 (사운드팩은 create가 다시 올린다). reason은 오디오 상태 칸에 남긴다 */
  private rebuild(reason: string): Promise<WorkletSynthesizer> {
    if (this.reviving) return this.reviving;
    this.rebuilds++;
    this.note(`rebuild (${reason})`);
    let fresh: AudioContext | undefined;
    try {
      fresh = new AudioContext();
      void fresh.resume().catch(() => {});
    } catch {
      // 만들지 못하면 create가 다시 시도한다
    }
    this.discard();
    const reviving = this.ready(fresh).finally(() => {
      if (this.reviving === reviving) this.reviving = undefined;
    });
    this.reviving = reviving;
    return reviving;
  }

  /** 지금 오디오와 신스를 버린다. 재생 중이던 소리·원곡·미리듣기도 함께 끝난다 */
  private discard(): void {
    try {
      this.player?.stop();
    } catch {
      // 멈춘 신스에 보내는 정지
    }
    this.player = undefined;
    this.stopReference();
    this.fallback.clear();
    this.previewHeld.clear();
    this.previewSent = new PreviewVoices();
    try {
      this.synth?.destroy();
    } catch {
      // 이미 멈춘 워크릿
    }
    const old = this.context;
    if (old && old.state !== "closed") void old.close().catch(() => {});
    this.context = undefined;
    this.synth = undefined;
    this.master = undefined;
    this.referenceGain = undefined;
    this.starting = undefined;
    this.channels = 16;
    this.warmed = false;
    this.broken = false;
    this.suspect = false;
    this.interrupted = false;
    this.hiddenMs = 0;
    this.latencyBefore = 0;
    this.preparedVoices.clear();
    this.previewKey = "";
    this.packVersion++;
    // 버린 신스의 응답을 기다리던 작업을 풀어 준다
    this.lost.resolve();
    this.lost = Engine.lostSignal();
  }

  /** 신스 작업을 기다리되, 그사이 오디오를 새로 만들면(그 신스를 버리면) 더 기다리지 않는다. 끝까지 했으면 true */
  private async untilLost(work: Promise<unknown>): Promise<boolean> {
    const lost = this.lost.promise;
    return Promise.race([work.then(() => true), lost.then(() => false)]);
  }

  /**
   * 번호로만 아는 악기(#42.3 등)를 지금 올린 팩의 프리셋 이름으로 알아본다. 음역·샘플 길이를 맞추려고.
   * 악보 진단·롤 음역도 재생과 같게 이걸 쓴다. pack은 트랙에서 고른 팩 파일 이름 (없거나 지금 없는 팩이면 자동)
   */
  readonly canonicalOf = (instrument: string, program: number | undefined, pack?: string) =>
    this.registry.resolve(instrument, program, this.registry.idOfLabel(pack))?.canonical;

  /** 올린 사운드팩 파일 (WAV 저장 때 워커에서 다시 읽는다) */
  private packFiles = new Map<string, { bank: number; file: File }>();

  async addPack(file: File): Promise<SoundPackInfo> {
    this.packVersion++;
    let synth = await this.live();
    const id = `${file.name}#${this.registry.nextBank}`;
    const bank = this.registry.nextBank;
    this.packFiles.set(id, { bank, file });
    try {
      // 올리는 사이 오디오를 새로 만들면 새 신스가 이 팩도 다시 올리므로, 버린 신스의 대답은 기다리지 않는다
      if (!(await this.untilLost(synth.soundBankManager.addSoundBank(await file.arrayBuffer(), id, bank)))) synth = await this.live();
    } catch (e) {
      this.packFiles.delete(id);
      throw e;
    }
    // 팩을 바꾸면 신스가 준비해 둔 음을 비운다
    this.preparedVoices.clear();
    // 팩마다 뱅크를 밀어 올렸으므로, 이 팩의 프리셋은 그 뱅크 번호로 보인다
    const presets = synth.presetList
      .filter((p) => p.bankMSB === bank)
      .map((p) => ({ program: p.program, bankMSB: 0, name: p.name }));
    const info = this.registry.add(id, file.name, { presets });
    // 등록부에 실제로 들어간 뒤에도 한 번 더 (그사이 예열을 마친 재생이 새 팩 없이 시작하지 않게)
    this.packVersion++;
    return info;
  }

  /** 사운드팩 우선순위 바꾸기. 위에 있는 팩이 먼저 쓰인다 */
  setPackOrder(ids: readonly string[]): void {
    this.packVersion++;
    this.registry.setOrder(ids);
  }

  async removePack(id: string): Promise<void> {
    this.packVersion++;
    this.registry.remove(id);
    this.packFiles.delete(id);
    this.preparedVoices.clear();
    if (!this.synth) return;
    // 잠자기 뒤 멈춘 신스에 빼기를 보내면 대답이 없어 다시 올리기까지 멈춘다. 먼저 살아 있는지 본다
    const synth = await this.live();
    await this.untilLost(synth.soundBankManager.deleteSoundBank(id));
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
    return (c ? reportedLatency(c) : 0) + this.limiterLag + this.syncOffset;
  }

  /** 지금 들리는 곡 위치(초). 출력 지연만큼 늦춰 재생선이 소리와 맞게 한다 */
  get position(): number {
    if (!this.player) return 0;
    return this.player.playing ? this.player.positionLagged(this.outputLag) : this.player.position;
  }

  /** 재생을 시작하고, 사운드팩에서 찾지 못한 악기를 돌려준다 */
  /** loop: 반복할 길이(초). 주면 시작 자리부터 그 길이를 끊김 없이 되풀이한다. rate: 재생 속도 (원곡도 같은 속도로).
   * offset: from에서 이만큼(곡 초) 뒤부터 소리를 낸다 (반복 구간 가운데서 이어 재생).
   * record: MIDI 건반 녹음. leadIn초(오디오 시간) 예비박을 두고 시작하며, 곡이 끝나도 정지할 때까지 멈추지 않는다 */
  async play(song: Song, from?: Rat, loop?: number, rate = 1, offset = 0, record?: { leadIn: number }): Promise<Unresolved[]> {
    const request = ++this.playRequest;
    await this.live();
    const context = this.context!;
    // 오디오가 쉬고 있다 깨어나면(첫 재생, 아이패드가 재운 뒤) 첫 음이 늦게 나므로 시계가 실제로 돌기를 기다리고 조금 늦게 시작한다
    const cold = !this.warmed || context.state !== "running";
    // 아이패드는 resume()이 끝나지 않을 때가 있어 오래 기다리지 않는다
    await settlesWithin(context.resume(), RESUME_TIMEOUT);
    if (request !== this.playRequest || this.context !== context) return [];
    if (cold) await waitForClock(context);
    // 처음 소리를 낼 때의 출력 지연을 기억해 둔다 (돌아온 뒤 크게 늘었는지 보려고)
    if (!this.warmed) this.latencyBefore = reportedLatency(context);
    this.warmed = true;
    // 예열을 기다리는 사이 팩 구성이 바뀌면 패치를 다시 정하고, 시작 직전 악기별 음량은 최신 값으로 (preparePlay)
    let last: Unresolved[] = [];
    const ready = await preparePlay({
      plan: () => {
        const schedule = buildSchedule(song, getProfile(song.meta.profileId), { ...(from ? { from } : {}), canonicalOf: this.canonicalOf });
        const { patches, unresolved } = assignPatches(schedule, this.registry, this.gains);
        last = unresolved;
        this.ensureChannels(Math.max(-1, ...patches.map((p) => p.channel)));
        this.playingPatches = patches;
        return { schedule, patches, unresolved };
      },
      prepare: ({ schedule, patches }) => this.prepareVoices(schedule, patches),
      packVersion: () => this.packVersion,
      // 기다리는 사이 정지나 다른 재생을 눌렀으면 이 재생은 시작하지 않는다
      cancelled: () => request !== this.playRequest,
      gainOf: (packId, program) => this.registry.gainOf(packId, program, this.gains),
    });
    if (!ready) return last;
    const { patches, unresolved } = ready;
    const schedule = record ? { ...ready.schedule, duration: Infinity } : ready.schedule;
    this.playingPatches = patches;
    const delay = record ? (cold ? COLD_START_DELAY : START_DELAY) + Math.max(0, record.leadIn) : cold ? COLD_START_DELAY : undefined;
    // 앞 재생이 여기서 멈춘다: 그 순간 들리던 자리를 알린다 (녹음)
    this.noticeStopping();
    this.player!.start(schedule, patches, { ...(loop ? { loop } : {}), ...(delay !== undefined ? { delay } : {}), ...(rate !== 1 ? { rate } : {}), ...(offset > 0 ? { offset } : {}) });
    this.fromSeconds = from ? positionToSeconds(song.tempo, from) : 0;
    this.startReference();
    return unresolved;
  }

  /** 재생 요청 번호. 정지·새 재생마다 늘어, 준비하는 동안 취소된 재생이 뒤늦게 시작하지 않게 한다 */
  private playRequest = 0;
  /** 팩 구성 세대 번호. 팩을 더하거나 빼거나 순서를 바꿀 때마다 늘어, 예열 중인 재생이 패치를 다시 정하게 한다 */
  private packVersion = 0;

  /** 신스가 이미 준비한 음: 팩/뱅크/프로그램/음높이/세기 */
  private preparedVoices = new Set<string>();

  /**
   * 곡에 쓰이는 음을 재생 전에 신스에 미리 준비시킨다. 신스는 어떤 음(악기·높이·세기)을 처음 칠 때
   * 샘플을 풀고 음 설정을 계산하는데, 그 일이 소리를 만드는 오디오 스레드에서 일어나 재생 중에 처음 나오는
   * 음마다 수 ms씩 걸린다. 느린 PC에서는 그동안 소리를 제때 못 만들어 살짝 끊겼다 (WAV 저장은 미리 그리므로 괜찮았다).
   * 미리듣기 채널을 소리 없이(음량 0) 두고 그 음들을 한 번씩 쳤다가 바로 끈다. 준비는 팩을 바꾸기 전까지 남는다
   */
  private async prepareVoices(schedule: ReturnType<typeof buildSchedule>, patches: readonly SlotPatch[]): Promise<void> {
    const synth = this.synth!;
    const context = this.context!;
    const bySlot = new Map(patches.map((p) => [p.slot, p]));
    const todo = new Map<string, { patch: SlotPatch; note: number; velocity: number }>();
    for (const e of schedule.events) {
      if (e.type !== "on") continue;
      const patch = bySlot.get(e.slot);
      if (!patch) continue;
      const key = `${patch.packId}/${patch.bank}/${patch.program}/${e.note}/${e.velocity}`;
      if (!this.preparedVoices.has(key)) todo.set(key, { patch, note: e.note, velocity: e.velocity });
    }
    if (todo.size === 0) return;
    const ch = Engine.PREVIEW_CHANNEL;
    this.ensureChannels(ch);
    synth.midiChannels[ch]?.setSystemParameter("gain", 0);
    let program = "";
    for (const [key, { patch, note, velocity }] of todo) {
      const p = `${patch.bank}/${patch.program}`;
      if (p !== program) {
        synth.controllerChange(ch, ALL_SOUND_OFF, 0);
        synth.controllerChange(ch, BANK_SELECT, patch.bank);
        synth.programChange(ch, patch.program);
        program = p;
      }
      synth.noteOn(ch, note, velocity);
      synth.controllerChange(ch, ALL_SOUND_OFF, 0);
      this.preparedVoices.add(key);
    }
    // 미리듣기는 다음에 누를 때 악기와 음량을 다시 정한다
    this.previewKey = "";
    // 준비가 끝나야 오디오 시계가 다시 흐른다. 그 뒤에 시작해야 첫 음들이 늦게 몰려 나오지 않는다
    const t0 = context.currentTime;
    const until = performance.now() + 3000;
    while (context.currentTime < t0 + 0.02 && performance.now() < until) await new Promise((r) => setTimeout(r, 10));
  }

  /**
   * WAV 저장 요청: 곡 처음부터 끝까지, 들리는 트랙(뮤트·솔로 반영)을 지금 사운드팩으로. 패치는 재생과 같은 규칙으로
   * 여기서 정하고, 그리기는 워커가 한다. 사운드팩이 없으면 undefined
   */
  async wavRequest(song: Song): Promise<{ request: WavRequest; unresolved: Unresolved[] } | undefined> {
    if (this.packFiles.size === 0) return undefined;
    const schedule = buildSchedule(song, getProfile(song.meta.profileId), { canonicalOf: this.canonicalOf });
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
    this.playRequest++;
    this.noticeStopping();
    this.player?.stop();
    this.stopReference();
    this.stopClicks();
  }

  /**
   * 녹음: 지금 들리는 곡 시각(초). 예비박 동안은 시작 자리보다 앞(작은 값)을 돌려준다. 재생 중이 아니면 undefined.
   * 들리는 소리에 맞춰 누르므로 출력 지연만큼 앞당겨 잰다
   */
  heardSeconds(): number | undefined {
    const start = this.player?.startTime;
    const context = this.context;
    if (start === undefined || !context || !this.player) return undefined;
    return this.fromSeconds + (context.currentTime - this.outputLag - start) * this.player.speed;
  }

  /** 재생이 멈추거나 다른 재생으로 바뀌기 바로 전, 그때 들리던 곡 시각(초)을 받는다 (녹음이 누른 채 멈춘 음의 끝으로 쓴다) */
  onStopping: ((heardSeconds: number) => void) | undefined;

  private noticeStopping(): void {
    if (!this.player?.playing) return;
    const heard = this.heardSeconds();
    if (heard !== undefined) this.onStopping?.(heard);
  }

  /** 예약해 둔 메트로놈 소리 */
  private clicks = new Set<OscillatorNode>();

  /**
   * 메트로놈 딸깍 하나를 곡 시각(초)에 예약한다 (녹음). 곡 소리와 같은 오디오 시계로 맞춘다.
   * 이미 지난 시각이면 넣지 않는다. 정지하면 아직 안 난 딸깍도 끈다
   */
  click(songSeconds: number, accent: boolean): void {
    const start = this.player?.startTime;
    const context = this.context;
    if (start === undefined || !context || !this.player) return;
    const at = start + (songSeconds - this.fromSeconds) / this.player.speed;
    if (at < context.currentTime) return;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1760 : 1320;
    const peak = accent ? 0.18 : 0.11;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain).connect(this.master ?? context.destination);
    osc.start(at);
    osc.stop(at + 0.06);
    this.clicks.add(osc);
    osc.onended = () => {
      this.clicks.delete(osc);
      osc.disconnect();
    };
  }

  private stopClicks(): void {
    for (const osc of this.clicks) {
      try {
        osc.stop();
      } catch {
        // 이미 멈춘 소리
      }
    }
    this.clicks.clear();
  }

  /** 건반 입력 미리듣기 전용 채널 (재생 트랙 채널과 겹치지 않게 맨 끝) */
  private static readonly PREVIEW_CHANNEL = PREVIEW_CHANNEL;
  private previewKey = "";

  /** 건반을 누르는 동안 그 악기 소리를 낸다 (사운드팩에 없으면 조용히) */
  /** 미리듣기로 누르고 있는 건반. 오디오를 켜는 동안 떼면 늦게 소리 내지 않는다 */
  private previewHeld = new Set<number>();
  /** 누른 건반 높이 → 음역에 맞춰 접어 보낸 높이 (뗄 때 보낸 높이로 끈다) */
  private previewSent = new PreviewVoices();

  /** profile은 곡의 프로필 (재생과 같은 음역으로 높이를 접는다). pack은 트랙에서 고른 팩 파일 이름 */
  async previewOn(
    instrument: string,
    program: number | undefined,
    pitch: number,
    velocity: number,
    profile: GameProfile = getProfile("mobile"),
    pack?: string,
  ): Promise<void> {
    this.previewHeld.add(pitch);
    const synth = await this.live();
    await settlesWithin(this.context!.resume(), RESUME_TIMEOUT);
    if (this.synth !== synth) return;
    if (!this.previewHeld.has(pitch)) return;
    const patch = this.registry.resolve(instrument, program, this.registry.idOfLabel(pack));
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
    // 재생과 같이 실제 악기 음역으로 옥타브째 접는다 (번호로만 아는 악기도 알아본 악기로)
    const sent = previewPitch(profile, patch.canonical ?? instrument, pitch);
    // 같은 건반이 아직 울리면(다른 악기로 다시 누름) 앞 음을 먼저 끈다
    for (const off of this.previewSent.press(pitch, sent)) synth.noteOff(ch, off);
    synth.noteOn(ch, sent, velocity);
  }

  previewOff(pitch: number): void {
    this.previewHeld.delete(pitch);
    // 다른 건반이 같은 높이로 접혀 아직 울리면 끄지 않는다
    for (const off of this.previewSent.release(pitch)) this.synth?.noteOff(Engine.PREVIEW_CHANNEL, off);
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
    await this.live();
    const context = this.context!;
    this.reference = await context.decodeAudioData(await file.arrayBuffer());
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

  private referenceVolume = 1;

  setReferenceVolume(volume: number): void {
    this.referenceVolume = volume;
    if (this.referenceGain) this.referenceGain.gain.value = volume;
  }

  /** 원곡 음량 노드. 오디오를 새로 만들면 다시 만든다 */
  private referenceOut(context: AudioContext): GainNode {
    if (this.referenceGain) return this.referenceGain;
    const gain = context.createGain();
    gain.gain.value = this.referenceVolume;
    // 합성음은 리미터를 지나며 3ms 늦게 나오므로 원곡도 같은 만큼 늦춰 함께 듣는 시각을 맞춘다
    const delay = context.createDelay(0.05);
    delay.delayTime.value = this.limiterLag;
    gain.connect(delay).connect(context.destination);
    this.referenceGain = gain;
    return gain;
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
    if (!context || !this.reference || origin === undefined) return;
    const out = this.referenceOut(context);
    // 지금(아직 시작 전이면 곡 시작 시각) 곡이 있을 자리에 원곡을 맞춘다. 반복으로 돌아갈 때는 그 경계 시각에 맞춘다.
    // 느리게 재생하면 원곡도 같은 속도로 돈다 (테이프처럼 음 높이도 내려가지만, 박 자리는 샘플 단위로 맞는다)
    const rate = this.player?.speed ?? 1;
    const at = wrapAt ?? Math.max(context.currentTime, origin);
    const want = this.fromSeconds + (at - origin) * rate + this.referenceOffset;
    const source = context.createBufferSource();
    source.buffer = this.reference;
    source.playbackRate.value = rate;
    source.connect(out);
    if (want >= 0) source.start(at, want);
    else source.start(at - want / rate, 0);
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
