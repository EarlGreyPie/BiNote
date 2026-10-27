import { add, decayDbAt, eq, foldPitch, heldMeanDb, positionToSeconds, soundingRangeOf, trackInstrument, type GameProfile, type Note, type PitchRange, type Song, type Track } from "@mmlce/core";

/** 번호로만 아는 악기(추가 사운드팩의 #42.3 등)의 실제 악기. 엔진이 지금 올린 팩으로 알아본다. 모르면 undefined */
export type CanonicalOf = (instrument: string, program: number | undefined, pack?: string) => string | undefined;

/** 트랙이 실제로 소리 내는 악기. 재생과 같이 실제 악기로 정하고, 알아보지 못하면 원래 ID로 정한다 */
export function trackSoundingInstrument(song: Pick<Song, "players">, track: Pick<Track, "playerId" | "instrument">, canonicalOf?: CanonicalOf): string {
  const ref = trackInstrument(song, track);
  return canonicalOf?.(ref.canonical, ref.program, ref.packId) ?? ref.canonical;
}

/** 트랙이 실제로 소리 내는 음역 */
export function trackSoundingRange(profile: GameProfile, song: Pick<Song, "players">, track: Pick<Track, "playerId" | "instrument">, canonicalOf?: CanonicalOf): PitchRange {
  return soundingRangeOf(profile, trackSoundingInstrument(song, track, canonicalOf));
}

/** 미리듣기로 보낼 높이: 실제 악기 음역에 맞춰 재생과 같이 옥타브째 접는다 */
export function previewPitch(profile: GameProfile, canonical: string | undefined, pitch: number): number {
  return foldPitch(pitch, soundingRangeOf(profile, canonical));
}

/**
 * 한 번 친 음이 끝날 때 가장 클 때보다 몇 dB 작은지 (실험실 소리 줄어듦). 앞 음에서 &로 이어 받은 음은 새로 치지 않아 undefined.
 * 샘플이 먼저 끝나면 -Infinity. 감쇠를 모르는 악기는 0
 */
export function noteEndFadeDb(
  profile: GameProfile,
  song: Pick<Song, "players" | "tempo">,
  track: Pick<Track, "playerId" | "instrument" | "notes">,
  note: Note,
  canonicalOf?: CanonicalOf,
): number | undefined {
  if (track.notes.some((n) => n.tie === "next" && eq(add(n.start, n.dur), note.start))) return undefined;
  const instrument = trackSoundingInstrument(song, track, canonicalOf);
  const pitch = foldPitch(note.pitch, soundingRangeOf(profile, instrument));
  const seconds = positionToSeconds(song.tempo, add(note.start, note.dur)) - positionToSeconds(song.tempo, note.start);
  return decayDbAt(profile, instrument, pitch, seconds);
}

/** 긴 음 맞추기의 기준: 이만큼(초) 울리는 음의 평균 크기에 맞춘다 */
export const HELD_REF_SECONDS = 0.5;

/**
 * 실험실 긴 음 맞추기: & 사슬(첫 음부터)이 울리는 동안 평균 크기가 HELD_REF_SECONDS짜리 음보다 몇 dB 작은지.
 * 높이는 첫 음(접은 뒤)으로 잰다. 기준보다 짧으면 0 (짧은 음은 그대로 둔다)
 */
export function heldLossDb(
  profile: GameProfile,
  song: Pick<Song, "players" | "tempo">,
  track: Pick<Track, "playerId" | "instrument">,
  chain: readonly Note[],
  canonicalOf?: CanonicalOf,
): number {
  const head = chain[0];
  const last = chain.at(-1);
  if (!head || !last) return 0;
  const instrument = trackSoundingInstrument(song, track, canonicalOf);
  const pitch = foldPitch(head.pitch, soundingRangeOf(profile, instrument));
  const seconds = positionToSeconds(song.tempo, add(last.start, last.dur)) - positionToSeconds(song.tempo, head.start);
  if (seconds <= HELD_REF_SECONDS) return 0;
  return heldMeanDb(profile, instrument, pitch, HELD_REF_SECONDS) - heldMeanDb(profile, instrument, pitch, seconds);
}
