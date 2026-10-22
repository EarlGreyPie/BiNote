import { add, cmp, div, gridLines, meterAt, meterGrid, mul, placeNote, positionToSeconds, rat, secondsToWhole, sub, toFloat, type Note, type Rat, type Song } from "@mmlce/core";
import type { ScoreGroup } from "./scores";
import type { ChordPlan } from "./midiInput";

/**
 * MIDI 건반 녹음(실험실): 곡을 들으며 친 건반을 격자에 맞춰 음으로 넣는다.
 * 친 시각은 곡 위치(온음표 단위, 실수)로 받아, 여기서 격자에 맞춘 분수로 바꾼다 (정수 tick으로 반올림하지 않는다).
 */

/** 녹음한 건반 하나 (곡 위치, 온음표 단위) */
export interface TakeKey {
  readonly pitch: number;
  readonly velocity: number;
  readonly on: number;
  readonly off: number;
}

/** 격자에 맞춘 음 */
export interface TakeNote {
  readonly pitch: number;
  readonly velocity: number;
  readonly start: Rat;
  readonly dur: Rat;
}

/**
 * 격자에 맞춘다. 시작·끝을 가장 가까운 격자 칸으로 옮기고, 녹음 시작(from) 앞이면 from으로 당긴다.
 * 너무 짧아 시작과 끝이 같은 칸이 되면 한 칸 길이로 둔다. 같은 높이 음이 겹치면 앞 음을 뒤 음 시작에서 끊는다
 * (게임은 한 트랙에 한 음이라, 같은 높이를 다시 친 것은 다시 친 음으로 본다)
 */
export function quantizeTake(keys: readonly TakeKey[], grid: Rat, from: Rat): TakeNote[] {
  const g = toFloat(grid);
  const f = toFloat(from);
  const cell = (x: number) => Math.max(0, Math.round((x - f) / g));
  const raw = keys
    .map((k) => {
      const a = cell(k.on);
      const b = Math.max(a + 1, cell(k.off));
      return { pitch: k.pitch, velocity: k.velocity, a, b };
    })
    .sort((x, y) => x.a - y.a || y.pitch - x.pitch);
  // 같은 높이: 앞 음을 뒤 음 시작에서 끊고, 같은 칸에서 시작한 같은 높이는 하나만 둔다
  const out: { pitch: number; velocity: number; a: number; b: number }[] = [];
  for (const n of raw) {
    const prev = out.filter((o) => o.pitch === n.pitch).at(-1);
    if (prev && prev.a === n.a) {
      prev.b = Math.max(prev.b, n.b);
      prev.velocity = Math.max(prev.velocity, n.velocity);
      continue;
    }
    if (prev && prev.b > n.a) prev.b = n.a;
    out.push({ ...n });
  }
  return out.map((n) => ({ pitch: n.pitch, velocity: n.velocity, start: add(from, mul(grid, rat(n.a))), dur: mul(grid, rat(n.b - n.a)) }));
}

const overlaps = (a: { start: Rat; dur: Rat }, start: Rat, end: Rat) => cmp(a.start, end) < 0 && cmp(start, add(a.start, a.dur)) < 0;

/**
 * 녹음한 음을 트랙에 나눠 넣는다. 고른 트랙부터 같은 악보의 다음 트랙들(잠긴 트랙은 건너뜀), 모자라면 악보 트랙 한도까지 더한 새 트랙 순서로,
 * 같은 시각에 친 음은 높은 음부터 그 자리가 빈 첫 트랙에 넣는다 (트랙은 한 번에 한 음).
 * - 곡에 이미 있던 음은 지우지 않는다. 그 자리는 찬 것으로 보고 다음 트랙에 넣는다 (덧녹음)
 * - 같은 트랙의 앞 녹음 음이 격자 한 칸 이하로만 겹치면(이어 치기에서 조금 늦게 뗀 것) 앞 음을 끊고 같은 트랙에 넣는다.
 *   그래야 선율이 트랙을 옮겨 다니지 않는다
 * - 넣을 트랙이 없으면 버리고 그 수를 센다
 */
export function placeTake(
  song: Song,
  groups: readonly ScoreGroup[],
  activeTrackId: string,
  take: readonly TakeNote[],
  grid: Rat,
  volumeOf: (track: readonly Note[], at: Rat, velocity: number) => number,
  maxTracks = Infinity,
  locked: ReadonlySet<string> = new Set(),
): ChordPlan {
  const active = song.tracks.find((t) => t.id === activeTrackId);
  if (!active) return { changes: [], newTracks: [], dropped: 0 };
  const group = groups.find((g) => g.trackIds.includes(activeTrackId));
  const after = group ? group.trackIds.slice(group.trackIds.indexOf(activeTrackId) + 1) : [];
  const existing = [activeTrackId, ...after.filter((id) => !locked.has(id))].map((id) => song.tracks.find((t) => t.id === id)!).filter(Boolean);
  const lastOfPlayer = !group || groups.filter((g) => g.playerId === group.playerId).at(-1) === group;
  const room = lastOfPlayer ? Math.max(0, maxTracks - (group?.trackIds.length ?? 1)) : 0;
  // 트랙마다: 원래 음과 녹음해 넣는 음
  const lanes = existing.map((t) => ({ base: t.notes as readonly Note[], added: [] as Note[], id: t.id as string | undefined }));
  for (let k = 0; k < room; k++) lanes.push({ base: [], added: [], id: undefined });
  const stamp = Date.now().toString(36);
  let dropped = 0;
  let serial = 0;
  for (const n of [...take].sort((a, b) => cmp(a.start, b.start) || b.pitch - a.pitch)) {
    const end = add(n.start, n.dur);
    const fits = (lane: (typeof lanes)[number]) => {
      if (lane.base.some((o) => overlaps(o, n.start, end))) return false;
      const hit = lane.added.filter((o) => overlaps(o, n.start, end));
      if (hit.length === 0) return true;
      // 앞에서 시작해 격자 한 칸 이하로 겹친 녹음 음 하나면 끊을 수 있다
      return hit.length === 1 && cmp(hit[0]!.start, n.start) < 0 && cmp(sub(add(hit[0]!.start, hit[0]!.dur), n.start), grid) <= 0;
    };
    // 새 트랙은 원래 트랙 뒤에 있어, 앞 새 트랙을 다 쓴 뒤에야 다음 새 트랙을 연다
    const pick = lanes.find(fits);
    if (!pick) {
      dropped++;
      continue;
    }
    pick.added = pick.added.map((o) => (overlaps(o, n.start, end) ? { ...o, dur: sub(n.start, o.start) } : o));
    const volBase = pick.id !== undefined ? [...pick.base, ...pick.added] : [...active.notes];
    pick.added.push({
      id: `${pick.id ?? `${active.playerId}.r`}.rec${stamp}${serial++}`,
      start: n.start,
      dur: n.dur,
      pitch: n.pitch,
      vol: volumeOf(volBase, n.start, n.velocity),
      tie: "none",
    });
  }
  const changes: { trackId: string; notes: Note[] }[] = [];
  const newTracks: Note[][] = [];
  for (const lane of lanes) {
    if (lane.added.length === 0) continue;
    if (lane.id === undefined) newTracks.push(lane.added);
    else changes.push({ trackId: lane.id, notes: lane.added.reduce<Note[]>((notes, n) => placeNote(notes, n), [...lane.base]) });
  }
  return { changes, newTracks, dropped };
}

/** 메트로놈 딸깍 하나: 곡 시각(초), 마디 첫 박이면 accent */
export interface Click {
  readonly at: number;
  readonly accent: boolean;
}

/** 화면 위치(실수) → 곡 초. 격자선 위치는 박자표 칸이라 1/3840 칸으로 충분하다 */
const secondsAt = (song: Song, at: number) => positionToSeconds(song.tempo, rat(Math.round(at * 3840), 3840));

/**
 * 예비박: 녹음 시작(from, 마디 시작) 앞 한 마디의 박. 박 길이는 from의 템포·박자로 잰다.
 * seconds는 그 마디 길이(곡 초). 재생 속도가 느리면 오디오에서는 그만큼 길어진다
 */
export function countIn(song: Song, from: Rat): { clicks: Click[]; seconds: number } {
  const { beat, measure } = meterGrid(meterAt(song.timeSig, from));
  const base = positionToSeconds(song.tempo, from);
  const beatSeconds = positionToSeconds(song.tempo, add(from, beat)) - base;
  const beats = Math.max(1, Math.round(toFloat(div(measure, beat))));
  const clicks = Array.from({ length: beats }, (_, k) => ({ at: base - (beats - k) * beatSeconds, accent: k === 0 }));
  return { clicks, seconds: beats * beatSeconds };
}

/** [from, to) 위치(온음표, 실수)의 박마다 딸깍. 마디 첫 박은 accent */
export function beatClicks(song: Song, from: number, to: number): Click[] {
  return gridLines(song.timeSig, from, to)
    .filter((l) => l.kind !== "unit")
    .map((l) => ({ at: secondsAt(song, l.at), accent: l.kind === "measure" }));
}

/** 녹음에 쓰는 재생 쪽 기능 (엔진) */
export interface RecordClock {
  /** 지금 들리는 곡 시각(초). 예비박 동안은 시작 자리보다 앞. 재생 중이 아니면 undefined */
  heardSeconds(): number | undefined;
  /** 곡 시각(초)에 메트로놈 딸깍 */
  click(songSeconds: number, accent: boolean): void;
}

/** 메트로놈을 이만큼(곡 초) 앞서 예약한다 */
const CLICK_AHEAD = 1.5;
const TICK_MS = 100;

/** 녹음 중 화면에 보일 것 */
export interface RecordStatus {
  readonly from: Rat;
  readonly count: number;
  /** 재생 번호 (다른 재생이 시작되면 녹음을 끝낸다) */
  readonly run: number;
}

interface Session {
  readonly song: Song;
  readonly from: Rat;
  /** 재생 번호 (다른 재생이 시작되면 녹음을 끝낸다) */
  readonly run: number;
  readonly metronome: boolean;
  /** 메트로놈을 예약해 둔 곳까지 (위치, 온음표 실수) */
  clickedTo: number;
  /** 마지막으로 잰 곡 시각(초). 정지 뒤 누르고 있던 건반의 끝으로 쓴다 */
  now: number;
  /** 재생이 멈춘 순간(cut). 그 뒤 시계는 다른 재생이거나 없으므로 건반·시각을 더 받지 않는다 */
  cut: boolean;
  readonly keys: { pitch: number; velocity: number; on: number; off: number }[];
  readonly held: Map<number, { velocity: number; on: number }>;
}

/**
 * MIDI 건반 녹음 (실험실). 곡을 재생하며 누른 건반의 시각을 곡 초로 모으고, 끝낼 때 곡 위치(온음표)로 바꿔 돌려준다.
 * 격자 맞추기와 트랙 나누기는 midiRecord.ts가 한다
 */
export class MidiRecorder {
  /** 녹음 중이면 시작 자리와 모은 음 수 */
  status: RecordStatus | undefined;
  /** status가 바뀔 때 (화면에 보이려고) */
  onstatus: ((status: RecordStatus | undefined) => void) | undefined;
  private session: Session | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly clock: RecordClock) {}

  private setStatus(status: RecordStatus | undefined): void {
    this.status = status;
    this.onstatus?.(status);
  }

  get recording(): boolean {
    return this.session !== undefined;
  }

  /** 재생이 시작된 뒤 부른다: 예비박을 예약하고 건반을 모으기 시작한다 */
  begin(song: Song, from: Rat, run: number, metronome: boolean): void {
    this.end();
    const fromSeconds = positionToSeconds(song.tempo, from);
    this.session = { song, from, run, metronome, clickedTo: toFloat(from), now: fromSeconds, cut: false, keys: [], held: new Map() };
    if (metronome) for (const c of countIn(song, from).clicks) this.clock.click(c.at, c.accent);
    this.setStatus({ from, count: 0, run });
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const s = this.session;
    if (!s || s.cut) return;
    const heard = this.clock.heardSeconds();
    if (heard === undefined) return;
    s.now = Math.max(s.now, heard);
    if (!s.metronome) return;
    const to = secondsToWhole(s.song.tempo, Math.max(0, heard) + CLICK_AHEAD);
    if (to <= s.clickedTo) return;
    for (const c of beatClicks(s.song, s.clickedTo, to)) this.clock.click(c.at, c.accent);
    s.clickedTo = to;
  }

  keyOn(pitch: number, velocity: number): void {
    const s = this.session;
    const at = this.clock.heardSeconds();
    if (!s || s.cut || at === undefined) return;
    s.now = Math.max(s.now, at);
    this.release(s, pitch, at);
    s.held.set(pitch, { velocity, on: at });
  }

  keyOff(pitch: number): void {
    const s = this.session;
    if (!s || s.cut) return;
    const at = this.clock.heardSeconds() ?? s.now;
    this.release(s, pitch, at);
  }

  /**
   * 재생이 멈추는(또는 다른 재생으로 바뀌는) 바로 그 순간 들리던 곡 시각(초)을 받는다 (엔진이 멈추기 직전에 부른다).
   * 누르고 있던 건반은 이 시각에 뗀 것으로 보고, 그 뒤 건반·시각은 받지 않는다.
   * 마지막 주기 표본(최대 100ms 전)으로 닫으면 누른 채 멈춘 음이 격자 한 칸 짧아질 수 있어서
   */
  cut(heardSeconds: number): void {
    const s = this.session;
    if (!s || s.cut) return;
    s.now = Math.max(s.now, heardSeconds);
    for (const pitch of [...s.held.keys()]) this.release(s, pitch, s.now);
    s.cut = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private release(s: Session, pitch: number, at: number): void {
    const held = s.held.get(pitch);
    if (!held) return;
    s.held.delete(pitch);
    s.keys.push({ pitch, velocity: held.velocity, on: held.on, off: Math.max(held.on, at) });
    this.setStatus({ from: s.from, count: s.keys.length, run: s.run });
  }

  /**
   * 녹음을 끝내고 모은 건반을 곡 위치(온음표)로 돌려준다. 누르고 있던 건반은 멈춘 순간(cut), cut이 없었으면
   * 지금 들리는 시각, 그것도 없으면 마지막으로 잰 시각에 뗀 것으로 본다
   */
  end(): { song: Song; from: Rat; keys: TakeKey[] } | undefined {
    clearInterval(this.timer);
    this.timer = undefined;
    const s = this.session;
    this.session = undefined;
    if (!s) return undefined;
    if (!s.cut) s.now = Math.max(s.now, this.clock.heardSeconds() ?? s.now);
    for (const pitch of [...s.held.keys()]) this.release(s, pitch, s.now);
    this.setStatus(undefined);
    const whole = (sec: number) => secondsToWhole(s.song.tempo, Math.max(0, sec));
    return { song: s.song, from: s.from, keys: s.keys.map((k) => ({ pitch: k.pitch, velocity: k.velocity, on: whole(k.on), off: whole(k.off) })) };
  }
}

/** 녹음이 넣을 곳: 시작할 때의 곡 기록(owner)과 고른 트랙 */
export interface RecordJob<O> {
  readonly owner: O;
  readonly trackId: string;
}

/** 녹음 흐름이 앱에 바라는 것 */
export interface RecordHost<O> {
  /** 지금 곡 기록 (곡을 바꾸면 다른 것이 된다) */
  owner(): O | undefined;
  /** 녹음 줄이 열려 있고 실험실이 켜져 있는지 */
  open(): boolean;
  /** 예비박을 두고 재생을 시작한다. 시작했으면 그 재생 번호 */
  play(): Promise<number | undefined>;
  stop(): void;
  /** 건반을 녹음으로 보낼지 */
  capture(on: boolean): void;
  /** 모은 건반을 넣는다 (격자 맞추기·트랙 나누기·commit) */
  apply(take: { from: Rat; keys: TakeKey[] }, job: RecordJob<O>): void;
  /** 시작한 곡이 아니어서 넣지 않았다 */
  lost(): void;
}

/**
 * 녹음 시작·끝의 순서를 한곳에서 지킨다.
 * - 재생 준비를 기다리는 동안 닫기·실험실 끄기·곡 바꾸기·새 녹음이 오면(end) 요청 세대가 바뀌어, 준비가 끝나도 시작하지 않는다
 * - 녹음은 시작한 곡 기록(owner)에만 넣는다. 곡을 바꾸기 전에 end를 부르면 앞 곡에 넣고, 바뀐 뒤 끝나면 넣지 않는다
 */
export class RecordFlow<O> {
  private token = 0;
  private pending = false;
  private job: RecordJob<O> | undefined;

  constructor(
    private readonly recorder: MidiRecorder,
    private readonly host: RecordHost<O>,
  ) {}

  /** 준비 중이거나 녹음 중 */
  get busy(): boolean {
    return this.pending || this.recorder.recording;
  }

  async start(trackId: string, song: Song, from: Rat, metronome: boolean): Promise<boolean> {
    this.end();
    const owner = this.host.owner();
    if (owner === undefined) return false;
    const token = ++this.token;
    this.pending = true;
    // 재생을 기다리는 동안 누른 건반은 녹음 세션이 없어 버려진다
    this.host.capture(true);
    const run = await this.host.play();
    if (token !== this.token) return false;
    this.pending = false;
    if (run === undefined || !this.host.open() || this.host.owner() !== owner) {
      this.host.capture(false);
      if (run !== undefined) this.host.stop();
      return false;
    }
    this.job = { owner, trackId };
    this.recorder.begin(song, from, run, metronome);
    return true;
  }

  /** 지금 끝낸다: 준비 중이면 취소(재생도 멈춤), 녹음 중이면 멈추고 시작한 곡에 넣는다 */
  end(): void {
    this.token++;
    if (this.pending) {
      this.pending = false;
      this.host.capture(false);
      this.host.stop();
    }
    if (this.recorder.recording) {
      this.host.stop();
      this.finish();
    }
  }

  /** 재생이 멈췄거나 다른 재생으로 바뀌었다: 녹음을 넣는다. 녹음 중이 아니면 아무것도 하지 않는다 */
  finish(): void {
    if (!this.recorder.recording) return;
    this.host.capture(false);
    const take = this.recorder.end();
    const job = this.job;
    this.job = undefined;
    if (!take || !job) return;
    if (this.host.owner() !== job.owner) return this.host.lost();
    this.host.apply(take, job);
  }
}
