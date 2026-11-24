import { add, chainSampleEnd, chainSamplePosition, cmp, eq, foldPitch, sampleZoneAt, soundingRangeOf, tempoClock, trackInstrument, type GameProfile, type Note, type Rat, type Song } from "@mmlce/core";
import { CHANNELS } from "./patches.js";

/** 신스에 보낼 소리 지점. 악기는 아직 실제 팩 번호가 아니라 공통 ID다 */
export interface VoiceSlot {
  /** 트랙마다 채널 하나 (다른 음 붙임을 피치 벤드로 내려면 채널을 같이 쓰면 안 된다) */
  readonly key: string;
  readonly instrument: string;
  readonly program?: number;
  /** 트랙에서 고른 사운드팩 파일 이름 (InstrumentRef.packId). 없으면 자동 */
  readonly pack?: string;
}

export interface PlaybackEvent {
  readonly time: number;
  /**
   * bend: 다른 음 붙임. 다시 치지 않고 울리던 음의 높이를 bend 반음만큼 옮긴다(게임 실측).
   * 아래 셋은 음색 경계를 넘는 붙임에만 쓴다 (buildSchedule의 "바꿔 타기"):
   * cut: 그 소리 지점의 소리를 끝소리(릴리스) 없이 바로 끊는다. mute: 그 소리 지점 소리를 0으로 줄인다(음은 계속 돈다).
   * unmute: 줄인 소리를 되돌린다
   */
  readonly type: "on" | "off" | "bend" | "cut" | "mute" | "unmute";
  readonly slot: number;
  readonly note: number;
  readonly velocity: number;
  readonly trackId: string;
  /** bend 일 때 첫 음에서 옮긴 반음 수 (0이면 원래 높이로) */
  readonly bend?: number;
}

/**
 * 신스에 맞추는 피치 벤드 범위(반음). 붙인 음을 새로 칠지는 profile.tieBendLimit로 정하므로,
 * 프로필 한도가 이보다 넓어지면 이 값도 넓혀야 벤드가 잘리지 않는다
 */
export const BEND_RANGE = 24;

/** 같은 시각 이벤트의 순서: 끄기·끊기 → 소리 줄이기·되돌리기 → 높이 옮기기 → 켜기 */
export const EVENT_ORDER = { off: 0, cut: 0, mute: 1, unmute: 1, bend: 2, on: 3 } as const;

/**
 * 바꿔 타기에서 앞 소리 지점을 줄인 뒤 끊기까지의 틈(초). 신스는 음량을 한 처리 단위(128샘플 ≈ 3ms)에 걸쳐
 * 바꾸므로, 그동안 줄어들게 두었다가 끊어야 "딱" 소리가 나지 않는다
 */
export const LANE_GAP = 0.004;

/** 반음 → 14비트 피치 휠 값 (가운데 8192) */
export function bendValue(semitones: number): number {
  return Math.max(0, Math.min(16383, Math.round(8192 + (semitones / BEND_RANGE) * 8192)));
}

export interface Schedule {
  /**
   * 들리는 트랙마다 하나씩(audibleTrackIds 순서). 음색 경계를 넘는 붙임이 있는 트랙은 그 뒤에 "바꿔 타기"용
   * 소리 지점을 하나 더 받는다 (key = 트랙 키 + "#zone", 같은 악기). 채널이 모자라면 받지 않는다
   */
  readonly slots: VoiceSlot[];
  /** 시각 순. 같은 시각이면 off·cut → mute·unmute → bend → on */
  readonly events: PlaybackEvent[];
  /** 악보상 마지막 음이 끝나는 시각(초). 샘플이 먼저 끝나도 줄지 않는다 */
  readonly duration: number;
}

export interface ScheduleOptions {
  /** 이 위치부터 재생 (커서 위치부터 재생). 걸쳐 있는 음은 그 위치에서 시작한다 */
  readonly from?: Rat;
  /**
   * 트랙 악기의 실제 공통 ID를 알려 준다(보통 사운드팩 등록부). `mabi:1578`(#42.3)처럼 번호로만 아는 악기도
   * 팩의 프리셋 이름이 냥모니카면 냥모니카 음역·샘플 길이로 그린다. 모르면 undefined
   */
  readonly canonicalOf?: (instrument: string, program: number | undefined, pack?: string) => string | undefined;
}

/**
 * 프로필의 v → dB 표를 MIDI 세기로. SoundFont/DLS 기본 감쇠가 세기 v에 대해
 * 약 40·log10(v/127) dB라서 그 역함수를 쓴다. 실측 곡선이 들어오면 표만 바뀐다.
 */
export function velocityForVolume(profile: GameProfile, vol: number): number {
  const index = Math.min(Math.max(vol, profile.volume.min), profile.volume.max) - profile.volume.min;
  const db = profile.volumeCurve[index] ?? 0;
  if (!Number.isFinite(db)) return 0;
  return Math.max(1, Math.min(127, Math.round(127 * 10 ** (db / 40))));
}

/** 같은 높이로 & 이은 음은 한 음으로 소리 낸다. & 뒤의 v는 게임처럼 무시하고 첫 음 v로 이어 간다(실측) */
function soundingNotes(notes: readonly Note[]): { note: Note; end: Rat; legatoNext: boolean }[] {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
  const out: { note: Note; end: Rat; legatoNext: boolean }[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.note.tie === "next" && eq(prev.end, n.start)) {
      if (prev.note.pitch === n.pitch) {
        prev.end = add(n.start, n.dur);
        prev.note = { ...prev.note, tie: n.tie };
        continue;
      }
      prev.legatoNext = true;
    }
    out.push({ note: n, end: add(n.start, n.dur), legatoNext: false });
  }
  return out;
}

/** 소리 내는 트랙의 ID (끄기·솔로 반영). 일정의 소리 지점은 이 순서대로 하나씩이다 */
export function audibleTrackIds(song: Song): string[] {
  const anySolo = song.tracks.some((t) => t.solo);
  return song.tracks.filter((t) => !t.mute && (!anySolo || t.solo)).map((t) => t.id);
}

export function buildSchedule(song: Song, profile: GameProfile, options: ScheduleOptions = {}): Schedule {
  const from = options.from;
  // 템포 지도는 한 번만 정리한다 (음마다 두 번씩 바꾸므로)
  const secondsAt = tempoClock(song.tempo);
  const offset = from ? secondsAt(from) : 0;
  const anySolo = song.tracks.some((t) => t.solo);
  const slots: VoiceSlot[] = [];
  /** 바꿔 타기용 소리 지점. 들리는 트랙의 소리 지점 뒤에 붙인다 (앞쪽 번호가 트랙 순서와 맞도록) */
  const extraSlots: VoiceSlot[] = [];
  const primaryCount = audibleTrackIds(song).length;
  const events: PlaybackEvent[] = [];
  let duration = 0;

  for (const track of song.tracks) {
    if (track.mute || (anySolo && !track.solo)) continue;
    const ref = trackInstrument(song, track);
    // 패치는 원래 ID·번호(1578 등)로 찾고, 음역·샘플 길이는 실제 악기로 정한다
    const instrument = options.canonicalOf?.(ref.canonical, ref.program, ref.packId) ?? ref.canonical;
    const range = soundingRangeOf(profile, instrument);
    // 같은 악기라도 고른 팩이 다르면 다른 채널 (트랙마다 채널 하나라 이미 나뉘지만, 키에도 팩을 넣어 둔다)
    const key = ref.packId === undefined ? track.id : `${track.id}@${ref.packId}`;
    const slot = slots.length;
    slots.push({
      key,
      instrument: ref.canonical,
      ...(ref.program === undefined ? {} : { program: ref.program }),
      ...(ref.packId === undefined ? {} : { pack: ref.packId }),
    });

    let previousLegato = false;
    // 바꿔 타기용 소리 지점 (처음 필요할 때 만든다)
    let lane: number | undefined;
    const laneSlot = (): number | undefined => {
      if (lane !== undefined) return lane;
      const index = primaryCount + extraSlots.length;
      if (index >= CHANNELS.length) return undefined;
      extraSlots.push({ ...slots[slot]!, key: `${key}#zone` });
      lane = index;
      return lane;
    };
    // 다른 음 붙임 사슬: 첫 음을 계속 누른 채 높이만 옮긴다. 게임은 붙인 음의 샘플로 바꿔 타되 샘플 안 위치를
    // 이어 가므로(실측), 사슬의 음들로 샘플 끝을 계산해(chainSampleEnd, 악보 진단과 같은 식) 그때 끊는다.
    // 신스는 친 건반의 샘플을 끝까지 쓰므로, 음색 경계(샘플 구간)를 넘을 때는 높이만 옮기면 앞 구간 샘플이
    // 빨리 돌아 일찍 끝나고 음색도 다르다. 그래서 새 구간 음을 다른 소리 지점에서 소리 없이 미리 쳐서 게임의 샘플 안
    // 위치까지 돌려 두었다가, 경계를 넘는 때에 그쪽 소리를 켜고 앞 소리를 끈다 (바꿔 타기)
    type Chain = {
      /** 사슬 첫 음(접은 높이). 붙임 한도(tieBendLimit)는 이 음에서 잰다 */
      head: number;
      /** 지금 소리 내는 소리 지점과 그곳에서 친 음 */
      slot: number;
      pitch: number;
      velocity: number;
      /** 지금 높이 */
      end: number;
      start: number;
      steps: { at: number; pitch: number }[];
      offAt: number;
      /** 바꿔 타고 비운 소리 지점: at에 끊었다. 다시 쓰지 않으면 사슬 끝에서 소리·높이를 되돌린다 */
      freed?: { slot: number; note: number; at: number };
    };
    let chain: Chain | undefined;
    const restore = (freed: NonNullable<Chain["freed"]>) => {
      const base = { slot: freed.slot, note: freed.note, velocity: 0, trackId: track.id, time: freed.at };
      events.push({ ...base, type: "unmute" }, { ...base, type: "bend", bend: 0 });
    };
    const closeChain = () => {
      if (!chain) return;
      const base = { slot: chain.slot, note: chain.pitch, velocity: chain.velocity, trackId: track.id };
      events.push({ ...base, time: chain.offAt, type: "off" });
      if (chain.end !== chain.pitch) events.push({ ...base, time: chain.offAt, type: "bend", bend: 0 });
      if (chain.freed) restore(chain.freed);
      chain = undefined;
    };
    /**
     * 붙인 음(on초, 높이 pitch)에서 음색 구간이 바뀌면 다른 소리 지점으로 바꿔 탄다. 바꿔 탔으면 true.
     * 채널이 모자라거나 틈이 너무 짧으면 false (예전처럼 높이만 옮긴다)
     */
    const switchZone = (c: Chain, on: number, off: number, pitch: number): boolean => {
      const zone = sampleZoneAt(profile, instrument, pitch);
      const before = sampleZoneAt(profile, instrument, c.end);
      if (!zone || !before || zone.from === before.from) return false;
      // 붙인 음이 너무 짧으면 끊기 전에 다음 음이 온다
      if (off - on < LANE_GAP) return false;
      const steps = [...c.steps, { at: on, pitch }];
      // 새 구간 샘플이 이미 끝났으면 바꿔 탈 것이 없다 (소리는 on에서 끝난다)
      if (chainSampleEnd(profile, instrument, steps) <= on) return false;
      const extra = laneSlot();
      if (extra === undefined) return false;
      const target = c.slot === slot ? extra : slot;
      // 미리 칠 소리 지점이 비는 때: 이 사슬에서 아직 안 썼으면 사슬 처음, 썼으면 앞서 끊은 때
      const from = c.freed?.slot === target ? c.freed.at : c.start;
      if (from >= on) return false;
      // 게임이 on초에 닿는 샘플 안 위치. 미리 친 음이 그 위치에 닿도록 그동안 높이(재생 빠르기)를 맞춘다
      const position = chainSamplePosition(profile, instrument, c.steps, on);
      const rate = position / (on - from);
      const lead = rate > 0 ? zone.from - pitch + 12 * Math.log2(rate) : -BEND_RANGE;
      // 높이 옮기기 범위로 그 위치에 닿지 못하면(경계를 잇달아 넘어 비운 소리 지점의 틈이 짧을 때) 틀린 위치로
      // 바꿔 타지 않고 예전처럼 높이만 옮긴다 (끝나는 때는 그대로 게임과 맞다)
      if (rate > 0 && Math.abs(lead) > BEND_RANGE + 1e-9) return false;
      const bend = Math.max(-BEND_RANGE, Math.min(BEND_RANGE, lead));
      const shadow = { slot: target, note: pitch, velocity: c.velocity, trackId: track.id };
      events.push({ ...shadow, time: from, type: "mute" });
      if (bend !== 0) events.push({ ...shadow, time: from, type: "bend", bend });
      events.push({ ...shadow, time: from, type: "on" });
      // 경계에서: 새 소리를 켜고(높이 그대로) 앞 소리는 줄였다가 조금 뒤 끊는다
      events.push({ ...shadow, time: on, type: "unmute" });
      if (bend !== 0) events.push({ ...shadow, time: on, type: "bend", bend: 0 });
      const old = { slot: c.slot, note: c.pitch, velocity: c.velocity, trackId: track.id };
      events.push({ ...old, time: on, type: "mute" }, { ...old, time: on + LANE_GAP, type: "cut" });
      // 앞서 비운 소리 지점을 다시 쓰지 않았으면 되돌린다 (다시 썼으면 지금 켰다)
      if (c.freed && c.freed.slot !== target) restore(c.freed);
      c.freed = { slot: c.slot, note: c.pitch, at: on + LANE_GAP };
      c.slot = target;
      c.pitch = pitch;
      c.end = pitch;
      c.steps = steps;
      c.offAt = Math.min(off, chainSampleEnd(profile, instrument, steps));
      return true;
    };
    for (const { note, end, legatoNext } of soundingNotes(track.notes)) {
      const legato = previousLegato;
      previousLegato = legatoNext;
      if (from && cmp(end, from) <= 0) continue;
      const startPos = from && cmp(note.start, from) < 0 ? from : note.start;
      const on = secondsAt(startPos) - offset;
      const off = secondsAt(end) - offset;
      // 곡 길이는 소리가 샘플 끝에서 먼저 끊겨도 악보상 음 끝까지 (반복·끝 판정이 악보와 맞도록)
      duration = Math.max(duration, off);
      // 게임처럼 악기 범위 밖 음은 옥타브째 접어서 낸다
      const pitch = foldPitch(note.pitch, range);
      if (legato && chain && Math.abs(pitch - chain.head) <= Math.min(profile.tieBendLimit, BEND_RANGE)) {
        // 샘플이 이미 끝났으면 붙인 음도 소리가 없다
        if (on >= chainSampleEnd(profile, instrument, chain.steps)) continue;
        if (switchZone(chain, on, off, pitch)) continue;
        const shift = pitch - chain.pitch;
        if (Math.abs(shift) <= BEND_RANGE) {
          chain.steps.push({ at: on, pitch });
          chain.end = pitch;
          events.push({ slot: chain.slot, note: chain.pitch, velocity: chain.velocity, trackId: track.id, time: on, type: "bend", bend: shift });
          chain.offAt = Math.min(off, chainSampleEnd(profile, instrument, chain.steps));
          continue;
        }
      }
      closeChain();
      const velocity = velocityForVolume(profile, note.vol);
      if (velocity === 0) continue;
      events.push({ slot, note: pitch, velocity, trackId: track.id, time: on, type: "on" });
      const steps = [{ at: on, pitch }];
      chain = { head: pitch, slot, pitch, velocity, end: pitch, start: on, steps, offAt: Math.min(off, chainSampleEnd(profile, instrument, steps)) };
    }
    closeChain();
  }

  slots.push(...extraSlots);
  // 같은 시각이면 끄기 → 소리 줄이기·되돌리기 → 높이 옮기기 → 켜기
  events.sort((a, b) => a.time - b.time || EVENT_ORDER[a.type] - EVENT_ORDER[b.type]);
  return { slots, events, duration };
}
