import { add, cmp, type GameProfile, type Note, type Rat } from "@mmlce/core";
import { gapSplit } from "./compress.js";
import type { GridNote } from "./quantize.js";

/**
 * 화음감쇠. 손마다 따로 센다.
 * 같은 v로 n음(2개 이상)을 함께 치면 단음보다 perDoublingDb × log2(n) dB 커지므로(인게임 실측),
 * 볼륨 곡선에서 그만큼 작은 v를 골라 화음 전체가 그 손의 추정치 단음과 같은 크기로 들리게 한다.
 * 예) 3dB일 때 추정치 12 → 3화음 9, 6화음 8 / 추정치 10 → 2화음 8, 4화음 7.
 */
export function chordVolume(estimate: number, count: number, profile: GameProfile): number {
  if (count < 2) return estimate;
  const { volume, volumeCurve } = profile;
  const dbOf = (v: number) => volumeCurve[v - volume.min] ?? -Infinity;
  const target = dbOf(estimate) - profile.chordAttenuation.perDoublingDb * Math.log2(count);
  let best = estimate;
  for (let v = Math.max(1, volume.min); v <= estimate; v++) {
    if (Math.abs(dbOf(v) - target) < Math.abs(dbOf(best) - target)) best = v;
  }
  return best;
}

export type Hand = "right" | "left";

/**
 * 압축 뒤 남은 음마다 v를 정한다. 같은 자리에서 시작하는 같은 손의 음을 한 화음으로 보고,
 * 손의 추정치는 그 화음에서 가장 센 음의 v(volumeOf)로 둔다.
 * 손은 파트로 알면 hands, 모르면 그 자리에서 울리는 음의 가장 넓은 틈으로 가른다.
 */
export function attenuateChords(
  notes: readonly GridNote[],
  volumeOf: (n: GridNote) => number,
  profile: GameProfile,
  hands?: ReadonlyMap<string, Hand>,
): Map<GridNote, number> {
  const out = new Map<GridNote, number>();
  const byStart = new Map<string, GridNote[]>();
  for (const n of notes) {
    const key = `${n.start.n}/${n.start.d}`;
    const list = byStart.get(key) ?? [];
    list.push(n);
    byStart.set(key, list);
  }
  for (const group of byStart.values()) {
    const at = group[0]!.start;
    const sounding = notes.filter((n) => cmp(n.start, at) <= 0 && cmp(add(n.start, n.dur), at) > 0).map((n) => n.pitch);
    const split = gapSplit(sounding, 60);
    const handOf = (n: GridNote): Hand => hands?.get(n.part) ?? (n.pitch >= split ? "right" : "left");
    for (const hand of ["right", "left"] as const) {
      const chord = group.filter((n) => handOf(n) === hand);
      if (chord.length === 0) continue;
      const estimate = Math.max(...chord.map(volumeOf));
      const v = chordVolume(estimate, chord.length, profile);
      for (const n of chord) out.set(n, v);
    }
  }
  return out;
}

/**
 * 빈 채널에 채워 넣는 음의 v. 그 자리에서 이미 울리는 같은 손 음에 이 음을 더한 개수로 감쇠한다
 * (감쇠 중인 아래 화음에 들어가면 그 화음과 같은 수준이 된다).
 */
export function fillVolume(estimate: number, pitch: number, start: Rat, tracks: readonly (readonly Note[])[], profile: GameProfile): number {
  const sounding = tracks
    .flat()
    .filter((n) => cmp(n.start, start) <= 0 && cmp(add(n.start, n.dur), start) > 0)
    .map((n) => n.pitch);
  const split = gapSplit([...sounding, pitch], 60);
  const right = pitch >= split;
  const same = sounding.filter((p) => p >= split === right).length;
  return chordVolume(estimate, same + 1, profile);
}
