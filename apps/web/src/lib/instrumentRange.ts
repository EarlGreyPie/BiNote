import { foldPitch, soundingRangeOf, trackInstrument, type GameProfile, type PitchRange, type Song, type Track } from "@mmlce/core";

/** 번호로만 아는 악기(추가 사운드팩의 #42.3 등)의 실제 악기. 엔진이 지금 올린 팩으로 알아본다. 모르면 undefined */
export type CanonicalOf = (instrument: string, program: number | undefined) => string | undefined;

/** 트랙이 실제로 소리 내는 음역. 재생과 같이 실제 악기로 정하고, 알아보지 못하면 원래 ID로 정한다 */
export function trackSoundingRange(profile: GameProfile, song: Pick<Song, "players">, track: Pick<Track, "playerId" | "instrument">, canonicalOf?: CanonicalOf): PitchRange {
  const ref = trackInstrument(song, track);
  return soundingRangeOf(profile, canonicalOf?.(ref.canonical, ref.program) ?? ref.canonical);
}

/** 미리듣기로 보낼 높이: 실제 악기 음역에 맞춰 재생과 같이 옥타브째 접는다 */
export function previewPitch(profile: GameProfile, canonical: string | undefined, pitch: number): number {
  return foldPitch(pitch, soundingRangeOf(profile, canonical));
}
