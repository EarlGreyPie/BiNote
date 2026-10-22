import type { SlotPatch } from "./patches.js";
import { BEND_RANGE, type Schedule } from "./schedule.js";

/**
 * 실시간 재생이 소리를 보내는 곳. 브라우저에서는 AudioWorklet 신스가 이 모양을 갖추고,
 * 시험에서는 받은 이벤트를 적어 두는 가짜를 쓴다. 시각은 오디오 시계(초) 기준이다.
 */
export interface LiveSink {
  readonly currentTime: number;
  setPatch(channel: number, bank: number, program: number, time: number): void;
  /** 채널 음량 배율 (악기별 음량). 시각 없이 바로 바뀐다 */
  setGain?(channel: number, gain: number): void;
  noteOn(channel: number, note: number, velocity: number, time: number): void;
  noteOff(channel: number, note: number, time: number): void;
  /** 채널 높이를 반음 단위로 옮긴다 (다른 음 붙임). 범위는 BEND_RANGE */
  pitchBend(channel: number, semitones: number, time: number): void;
  /** 피치 벤드 범위(반음)를 정한다 */
  setBendRange(channel: number, semitones: number, time: number): void;
  /**
   * 그 시각에 채널 소리를 끝소리(릴리스) 없이 바로 끊는다 (MIDI All Sound Off).
   * 같은 시각에 먼저 넣은 켜기 뒤에 처리되어야 한다. 없으면 noteOff로 대신한다
   */
  cut?(channel: number, time: number): void;
  /** 울리는 소리를 모두 끈다 */
  silence(): void;
}

export interface TimerHost {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface LivePlayerOptions {
  /** 지금부터 몇 초 앞까지 미리 예약할지. 길수록 끊김에 강하고 정지 반응이 조금 늦다 */
  readonly lookahead?: number;
  /** 예약을 채우는 간격(밀리초) */
  readonly intervalMs?: number;
  /** 재생 버튼을 누른 뒤 첫 음까지의 여유(초) */
  readonly startDelay?: number;
  readonly timers?: TimerHost;
}

/** 정지 뒤 한 번 더 끊을 때까지의 틈(초). 신스가 한두 처리 단위 늦게 켜는 음까지 덮는다 */
const STOP_GUARD = 0.03;

const defaultTimers: TimerHost = {
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>),
};

/**
 * 일정을 조금씩 앞서 예약하며 재생한다. 곡 전체를 한 번에 넘기지 않으므로
 * 정지하면 바로 멈추고, 긴 곡도 신스 큐가 쌓이지 않는다.
 */
export class LivePlayer {
  private schedule: Schedule | undefined;
  private bySlot = new Map<number, SlotPatch>();
  private index = 0;
  private origin = 0;
  /** 첫 회차가 소리 나기 시작한 시각. 반복 중 화면 위치는 여기서부터 잰다 (예약 기준 origin은 앞서 나간다) */
  private firstOrigin = 0;
  /** 신스에 넣은 예약 가운데 가장 늦은 시각. 신스 큐는 지울 수 없으니, 다시 재생할 때는 그 뒤에서 시작한다 */
  private quietAfter = 0;
  /** 반복 길이(곡 시간 초). 있으면 이 길이마다 처음으로 돌아가 이어 예약한다 */
  private loop: number | undefined;
  /** 재생 속도 (1 = 원래, 0.5 = 절반). 곡 시간 = 흐른 오디오 시간 × 속도 */
  private rate = 1;
  private handle: unknown;
  /** 소리가 켜진(또는 켜지도록 예약된) 음: 채널:음 → 켠 시각 */
  private sounding = new Map<string, { channel: number; note: number; at: number }>();
  /** 아직 오지 않은 시각에 예약한 켜기. 정지하면 바로 끄도록 붙잡아 둔다 (신스 큐는 지울 수 없어서) */
  private future: { channel: number; note: number; at: number }[] = [];
  private bent = new Set<number>();
  private readonly lookahead: number;
  private readonly intervalMs: number;
  private readonly startDelay: number;
  private readonly timers: TimerHost;
  /** 끝까지 재생했을 때 부른다 */
  onEnd: (() => void) | undefined;
  /** 반복 구간 처음으로 돌아갈 때 그 오디오 시계 시각과 함께 부른다 (원곡 다시 맞추기) */
  onWrap: ((at: number) => void) | undefined;

  constructor(
    private readonly sink: LiveSink,
    options: LivePlayerOptions = {},
  ) {
    this.lookahead = options.lookahead ?? 0.3;
    this.intervalMs = options.intervalMs ?? 50;
    this.startDelay = options.startDelay ?? 0.1;
    this.timers = options.timers ?? defaultTimers;
  }

  get playing(): boolean {
    return this.schedule !== undefined;
  }

  /** 지금 도는 회차가 소리 나기 시작한(반복이면 이번 회차 처음) 오디오 시계 시각. 정지 중이면 undefined */
  get startTime(): number | undefined {
    return this.schedule ? this.origin : undefined;
  }

  /** 지금 재생 속도 (정지 중이면 1) */
  get speed(): number {
    return this.schedule ? this.rate : 1;
  }

  /** 재생 시작(반복이면 이번 회차 처음) 뒤 흐른 곡 시간(초). 정지 중이면 0 */
  get position(): number {
    return this.positionLagged(0);
  }

  /** lag초 전의 재생 위치 (스피커에서 지금 들리는 자리). 반복이면 지연을 뺀 뒤에 회차를 접는다 */
  positionLagged(lag: number): number {
    if (!this.schedule) return 0;
    if (this.loop !== undefined) {
      const t = (this.sink.currentTime - lag - this.firstOrigin) * this.rate;
      return t <= 0 ? 0 : t % this.loop;
    }
    const t = (this.sink.currentTime - lag - this.origin) * this.rate;
    return Math.min(Math.max(0, t), this.schedule.duration);
  }

  /**
   * loop: 반복 길이(초). 일정의 0부터 이 길이까지를 끊김 없이 되풀이한다.
   * delay: 이번만 시작을 이만큼(초) 늦춘다 (오디오가 막 깨어나 첫 음이 늦게 나는 기기용).
   * rate: 재생 속도 (0.5면 곡을 절반 빠르기로). 음 높이는 그대로이고 음 사이 간격만 늘어난다.
   * offset: 일정의 이 곡 시각(초)부터 시작한다 (반복 구간 가운데서 이어 재생). 그 앞에서 시작해 울리던 음은 다시 치지 않는다
   */
  start(schedule: Schedule, patches: readonly SlotPatch[], options: { loop?: number; delay?: number; rate?: number; offset?: number } = {}): void {
    this.stop();
    this.schedule = schedule;
    this.rate = options.rate !== undefined && options.rate > 0 && Number.isFinite(options.rate) ? options.rate : 1;
    this.loop = options.loop !== undefined && options.loop > 0 ? options.loop : undefined;
    this.bySlot = new Map(patches.map((p) => [p.slot, p]));
    const end = this.loop ?? schedule.duration;
    const offset = options.offset !== undefined && options.offset > 0 && options.offset < end ? options.offset : 0;
    // 건너뛴 자리 앞의 이벤트는 보내지 않는다
    this.index = 0;
    while (this.index < schedule.events.length && schedule.events[this.index]!.time < offset) this.index++;
    // 앞 재생이 미리 넣어 둔 끄기·높이 되돌리기가 새 음을 건드리지 않게, 그 예약이 다 지난 뒤에 시작한다
    const begin = Math.max(this.sink.currentTime + (options.delay ?? this.startDelay), this.quietAfter + 0.005);
    // offset부터 시작하면 일정 0초는 그만큼 앞선 오디오 시각이다
    this.origin = begin - offset / this.rate;
    this.firstOrigin = this.origin;
    // 악기는 첫 음보다 먼저 바꿔 둔다 (신스가 샘플을 준비할 틈). 앞 재생의 끄기 예약이 끝난 뒤로
    const patchAt = Math.min(begin, Math.max(this.sink.currentTime, this.quietAfter + 0.001));
    for (const p of patches) {
      this.sink.setPatch(p.channel, p.bank, p.program, patchAt);
      this.sink.setGain?.(p.channel, p.gain ?? 1);
      this.sink.setBendRange(p.channel, BEND_RANGE, patchAt);
      this.sink.pitchBend(p.channel, 0, patchAt);
    }
    this.tick();
    this.handle = this.timers.setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.handle !== undefined) this.timers.clearInterval(this.handle);
    this.handle = undefined;
    if (this.schedule) {
      const now = this.sink.currentTime;
      // 이미 신스 큐에 들어간 앞날의 켜기는 지울 수 없으니, 같은 시각에 곧바로 끊는다.
      // noteOff면 켜진 뒤 끝소리(릴리스)가 남아 멈춘 뒤에도 "띠잉" 하고 울리므로 끝소리 없이 자른다
      const cutAt = new Map<number, Set<number>>();
      for (const f of this.future) {
        if (f.at <= now) continue;
        if (!this.sink.cut) {
          this.sink.noteOff(f.channel, f.note, f.at);
          continue;
        }
        const times = cutAt.get(f.channel) ?? new Set<number>();
        if (!times.has(f.at)) this.sink.cut(f.channel, f.at);
        times.add(f.at);
        cutAt.set(f.channel, times);
      }
      this.quietAfter = Math.max(this.quietAfter, ...this.future.map((f) => f.at));
      this.sink.silence();
      // 정지 바로 앞에 켜진 음은 신스가 아직 처리하기 전일 수 있다 (정지보다 늦게 켜진다). 쓰던 채널을 조금 뒤에 한 번 더 끊는다
      if (this.sink.cut) {
        const after = now + STOP_GUARD;
        for (const ch of new Set([...this.bySlot.values()].map((p) => p.channel))) this.sink.cut(ch, after);
        this.quietAfter = Math.max(this.quietAfter, after);
      }
    }
    this.future = [];
    this.sounding.clear();
    this.bent.clear();
    this.schedule = undefined;
  }

  /** 지금 + lookahead 안에 드는 이벤트를 예약한다. 보통 타이머가 부르고, 시험에서는 직접 부른다 */
  tick(): void {
    const schedule = this.schedule;
    if (!schedule) return;
    const now = this.sink.currentTime;
    this.future = this.future.filter((f) => f.at > now);
    const events = schedule.events;
    for (;;) {
      // 미리 예약할 범위는 곡 시간으로 잰다 (느리게 재생하면 오디오 시간 lookahead 안에 드는 곡 시간이 줄어든다)
      const horizon = (now - this.origin + this.lookahead) * this.rate;
      const end = this.loop ?? Infinity;
      while (this.index < events.length && events[this.index]!.time <= horizon && events[this.index]!.time < end) {
        this.send(events[this.index++]!);
      }
      if (this.loop === undefined || horizon < this.loop) break;
      // 반복 끝: 울리던 음을 끊고, 높이를 되돌리고, 같은 오디오 시계에서 처음부터 이어 예약한다
      const boundary = this.origin + this.loop / this.rate;
      this.quietAfter = Math.max(this.quietAfter, boundary);
      for (const s of this.sounding.values()) this.sink.noteOff(s.channel, s.note, boundary);
      for (const ch of this.bent) this.sink.pitchBend(ch, 0, boundary);
      this.sounding.clear();
      this.bent.clear();
      this.origin = boundary;
      this.index = 0;
      this.onWrap?.(boundary);
    }
    if (this.loop === undefined && this.index >= events.length && (now - this.origin) * this.rate >= schedule.duration) {
      if (this.handle !== undefined) this.timers.clearInterval(this.handle);
      this.handle = undefined;
      this.schedule = undefined;
      this.sounding.clear();
      this.future = [];
      this.onEnd?.();
    }
  }

  private send(e: Schedule["events"][number]): void {
    const patch = this.bySlot.get(e.slot);
    if (!patch) return;
    const at = this.origin + e.time / this.rate;
    this.quietAfter = Math.max(this.quietAfter, at);
    const key = `${patch.channel}:${e.note}`;
    if (e.type === "bend") {
      this.sink.pitchBend(patch.channel, e.bend ?? 0, at);
      if (e.bend) this.bent.add(patch.channel);
      else this.bent.delete(patch.channel);
    } else if (e.type === "on") {
      this.sink.noteOn(patch.channel, e.note, e.velocity, at);
      this.sounding.set(key, { channel: patch.channel, note: e.note, at });
      this.future.push({ channel: patch.channel, note: e.note, at });
    } else {
      this.sink.noteOff(patch.channel, e.note, at);
      this.sounding.delete(key);
    }
  }
}
