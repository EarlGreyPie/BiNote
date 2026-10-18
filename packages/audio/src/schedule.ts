import { add, chainSampleEnd, cmp, eq, foldPitch, positionToSeconds, soundingRangeOf, TIE_BEND_LIMIT, trackInstrument, type GameProfile, type Note, type Rat, type Song } from "@mmlce/core";

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
  /** bend: 다른 음 붙임. 다시 치지 않고 울리던 음의 높이를 bend 반음만큼 옮긴다(게임 실측) */
  readonly type: "on" | "off" | "bend";
  readonly slot: number;
  readonly note: number;
  readonly velocity: number;
  readonly trackId: string;
  /** bend 일 때 첫 음에서 옮긴 반음 수 (0이면 원래 높이로) */
  readonly bend?: number;
}

/** 피치 벤드 범위(반음). 이보다 멀리 붙인 음은 새로 친다 */
export const BEND_RANGE = TIE_BEND_LIMIT;

/** 반음 → 14비트 피치 휠 값 (가운데 8192) */
export function bendValue(semitones: number): number {
  return Math.max(0, Math.min(16383, Math.round(8192 + (semitones / BEND_RANGE) * 8192)));
}

export interface Schedule {
  readonly slots: VoiceSlot[];
  /** 시각 순. 같은 시각이면 off가 on보다 먼저 */
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

export function buildSchedule(song: Song, profile: GameProfile, options: ScheduleOptions = {}): Schedule {
  const from = options.from;
  const offset = from ? positionToSeconds(song.tempo, from) : 0;
  const anySolo = song.tracks.some((t) => t.solo);
  const slots: VoiceSlot[] = [];
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
    // 다른 음 붙임 사슬: 첫 음을 계속 누른 채 높이만 옮긴다. 게임은 붙인 음의 샘플로 바꿔 타되 샘플 안 위치를
    // 이어 가므로(실측), 사슬의 음들로 샘플 끝을 계산해(chainSampleEnd, 악보 진단과 같은 식) 그때 끊는다
    let chain: { pitch: number; velocity: number; end: number; steps: { at: number; pitch: number }[]; offAt: number } | undefined;
    const closeChain = () => {
      if (!chain) return;
      const base = { slot, note: chain.pitch, velocity: chain.velocity, trackId: track.id };
      events.push({ ...base, time: chain.offAt, type: "off" });
      if (chain.end !== chain.pitch) events.push({ ...base, time: chain.offAt, type: "bend", bend: 0 });
      chain = undefined;
    };
    for (const { note, end, legatoNext } of soundingNotes(track.notes)) {
      const legato = previousLegato;
      previousLegato = legatoNext;
      if (from && cmp(end, from) <= 0) continue;
      const startPos = from && cmp(note.start, from) < 0 ? from : note.start;
      const on = positionToSeconds(song.tempo, startPos) - offset;
      const off = positionToSeconds(song.tempo, end) - offset;
      // 곡 길이는 소리가 샘플 끝에서 먼저 끊겨도 악보상 음 끝까지 (반복·끝 판정이 악보와 맞도록)
      duration = Math.max(duration, off);
      // 게임처럼 악기 범위 밖 음은 옥타브째 접어서 낸다
      const pitch = foldPitch(note.pitch, range);
      const shift = chain ? pitch - chain.pitch : 0;
      if (legato && chain && Math.abs(shift) <= BEND_RANGE) {
        // 샘플이 이미 끝났으면 붙인 음도 소리가 없다
        if (on >= chainSampleEnd(profile, instrument, chain.steps)) continue;
        chain.steps.push({ at: on, pitch });
        chain.end = pitch;
        events.push({ slot, note: chain.pitch, velocity: chain.velocity, trackId: track.id, time: on, type: "bend", bend: shift });
        chain.offAt = Math.min(off, chainSampleEnd(profile, instrument, chain.steps));
        continue;
      }
      closeChain();
      const velocity = velocityForVolume(profile, note.vol);
      if (velocity === 0) continue;
      events.push({ slot, note: pitch, velocity, trackId: track.id, time: on, type: "on" });
      const steps = [{ at: on, pitch }];
      chain = { pitch, velocity, end: pitch, steps, offAt: Math.min(off, chainSampleEnd(profile, instrument, steps)) };
    }
    closeChain();
  }

  // 같은 시각이면 끄기 → 높이 되돌리기 → 켜기
  const order = { off: 0, bend: 1, on: 2 } as const;
  events.sort((a, b) => a.time - b.time || order[a.type] - order[b.type]);
  return { slots, events, duration };
}
