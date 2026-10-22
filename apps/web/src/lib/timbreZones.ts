import { foldPitch, type PitchRange } from "@mmlce/core";

/**
 * 피아노롤 음색 구간 (설정 → 화면 → 음색 경계 표시). 게임은 o3e·o4e·o5f 같은 경계에서 샘플을 바꿔 탄다.
 * 구간은 실제로 나는 높이로 정한다: 악기 범위 밖 음은 옥타브째 접혀 나므로, 접힌 뒤 높이의 구간을 따른다
 */
export interface ZoneRow {
  /** 구간 번호 (아래부터 0). 홀수 구간을 옅게 칠한다 */
  readonly zone: number;
  /** 이 줄 바로 아래(한 반음 아래 줄과 사이)에서 구간이 바뀐다 */
  readonly edge: boolean;
  /** 이 줄과 아래 줄이 모두 악기 범위 안이다 (범위 밖은 접혀 되풀이되는 경계라 옅은 점선) */
  readonly inside: boolean;
}

/** 접힌 뒤 높이의 구간 번호: 그 높이 이하인 경계 수 */
export function zoneIndex(boundaries: readonly number[], pitch: number, range: PitchRange): number {
  const p = foldPitch(pitch, range);
  return boundaries.filter((b) => b <= p).length;
}

/** low ~ high 줄마다 구간과 경계. 경계가 없는 악기는 빈 목록 */
export function zoneRows(boundaries: readonly number[], range: PitchRange, low: number, high: number): Map<number, ZoneRow> {
  const out = new Map<number, ZoneRow>();
  if (boundaries.length === 0) return out;
  for (let p = low; p <= high; p++) {
    const zone = zoneIndex(boundaries, p, range);
    const edge = zoneIndex(boundaries, p - 1, range) !== zone;
    const inside = p - 1 >= range.low && p <= range.high;
    out.set(p, { zone, edge, inside });
  }
  return out;
}
