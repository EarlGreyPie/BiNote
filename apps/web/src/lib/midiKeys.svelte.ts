import { connectMidi } from "./midiInput";

/** 첫 건반부터 이 시간 안에 누른 건반은 화음 하나 */
const CHORD_WINDOW_MS = 60;

export interface MidiKeysHandlers {
  /** 누른 건반을 들려준다 */
  previewOn(pitch: number, velocity: number): void;
  previewOff(pitch: number): void;
  /** 화음 하나(동시에 누른 건반들)를 악보에 넣는다 */
  chord(chord: { pitches: number[]; velocity: number }): void;
  /** MIDI 건반을 못 쓰는 브라우저 */
  unsupported(): void;
}

/**
 * MIDI 건반 입력: 연결·해제, 화음 창, 누르고 있는 건반 정리.
 * 연결하는 동안 끄면 늦게 끝난 연결은 바로 끊고, 끌 때 대기 화음·울리는 음을 모두 정리한다.
 */
export class MidiKeys {
  /** 켜져 있으면 연결된 장치 이름과 세기 사용 여부 */
  status = $state<{ devices: string[]; velocity: boolean } | undefined>(undefined);
  private disconnect: (() => void) | undefined;
  /** 연결 세대 */
  private session = 0;
  private pending: { pitches: number[]; velocity: number } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private held = new Set<number>();

  constructor(private readonly on: MidiKeysHandlers) {}

  get velocity(): boolean {
    return this.status?.velocity ?? false;
  }

  setVelocity(velocity: boolean): void {
    if (this.status) this.status = { ...this.status, velocity };
  }

  /** 켜 두면 건반을 눌러도 악보에 넣지 않는다 (새 판으로 바꾸는 동안) */
  paused = false;

  /** 기다리던 화음을 지금 넣는다 (저장 직전 등) */
  flushPending(): void {
    clearTimeout(this.timer);
    this.flush();
  }

  /** 기다리던 화음을 버린다 (새 곡을 열 때 등) */
  dropPending(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  stop(): void {
    this.session++;
    this.disconnect?.();
    this.disconnect = undefined;
    this.status = undefined;
    this.dropPending();
    for (const pitch of this.held) this.on.previewOff(pitch);
    this.held.clear();
  }

  async toggle(): Promise<void> {
    if (this.status) return this.stop();
    const session = ++this.session;
    try {
      this.status = { devices: [], velocity: false };
      const disconnect = await connectMidi({
        onNoteOn: (pitch, velocity) => {
          if (session === this.session) this.keyDown(pitch, velocity);
        },
        onNoteOff: (pitch) => {
          this.held.delete(pitch);
          this.on.previewOff(pitch);
        },
        onDevices: (names) => {
          if (session === this.session && this.status) this.status = { ...this.status, devices: names };
        },
      });
      if (session !== this.session) return disconnect();
      this.disconnect = disconnect;
    } catch {
      if (session !== this.session) return;
      this.status = undefined;
      this.on.unsupported();
    }
  }

  private keyDown(pitch: number, velocity: number): void {
    if (this.paused) return;
    this.held.add(pitch);
    this.on.previewOn(pitch, velocity);
    // 창은 첫 건반에서 한 번만 연다. 뒤 건반이 창을 늘리지 않아 빠른 단음 연주가 화음으로 뭉치지 않는다
    if (this.pending) {
      this.pending = { pitches: [...this.pending.pitches, pitch], velocity: Math.max(this.pending.velocity, velocity) };
      return;
    }
    this.pending = { pitches: [pitch], velocity };
    this.timer = setTimeout(() => this.flush(), CHORD_WINDOW_MS);
  }

  private flush(): void {
    const chord = this.pending;
    this.pending = undefined;
    this.timer = undefined;
    if (chord) this.on.chord(chord);
  }
}
