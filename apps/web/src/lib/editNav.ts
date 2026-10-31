/**
 * DAW식 이동·고르기 명령의 셈 (화면 없이 시험할 수 있게 따로 둔다).
 * 마디 앞뒤로 가기, 곡 끝, 커서 앞·뒤 음 고르기, 끄는 동안 격자 끄기, 가장자리 자동 넘김.
 */
import { add, cmp, meterAt, meterGrid, measureStart, ZERO, type Note, type Rat, type TimeSigEvent } from "@mmlce/core";

/** at 바로 다음 마디의 시작. 박자가 마디 가운데서 바뀌면 그 자리가 다음 마디 시작이다 (덜 찬 마디도 한 마디로 센다) */
export function nextBarStart(timeSig: readonly TimeSigEvent[], at: Rat): Rat {
  const here = measureStart(timeSig, at);
  const next = add(here, meterGrid(meterAt(timeSig, at)).measure);
  const change = [...timeSig].sort((a, b) => cmp(a.at, b.at)).find((s) => cmp(s.at, at) > 0);
  return change && cmp(change.at, next) < 0 ? change.at : next;
}

/**
 * at 앞의 마디 시작. 마디 가운데면 그 마디 시작, 마디선 위면 앞 마디 시작. 곡 처음보다 앞으로는 가지 않는다.
 * justPast: 재생 중에 쓴다. 마디 첫머리를 막 지난 자리면(참) 그 앞 마디로 간다.
 * 재생선은 옮긴 뒤에도 계속 흘러가므로, 이것이 없으면 거듭 눌러도 방금 간 마디 첫머리에 다시 걸린다
 */
export function prevBarStart(timeSig: readonly TimeSigEvent[], at: Rat, justPast?: (bar: Rat) => boolean): Rat {
  if (cmp(at, ZERO) <= 0) return ZERO;
  const here = measureStart(timeSig, at);
  if (cmp(here, at) < 0) return cmp(here, ZERO) > 0 && justPast?.(here) ? prevBarStart(timeSig, here) : here;
  // 마디선 위: 바로 앞 자리에 걸린 박자표로 앞 마디를 센다
  let sig: TimeSigEvent = { at: ZERO, beats: 4, unit: 4 };
  for (const s of [...timeSig].sort((a, b) => cmp(a.at, b.at))) if (cmp(s.at, at) < 0) sig = s;
  const { measure } = meterGrid(sig);
  let pos = sig.at;
  while (cmp(add(pos, measure), at) < 0) pos = add(pos, measure);
  return pos;
}

/** 곡 끝 (모든 트랙에서 가장 늦게 끝나는 음의 끝). 음이 없으면 0 */
export function songEnd(tracks: readonly { readonly notes: readonly Note[] }[]): Rat {
  let last: Rat = ZERO;
  for (const tr of tracks) for (const n of tr.notes) {
    const end = add(n.start, n.dur);
    if (cmp(end, last) > 0) last = end;
  }
  return last;
}

/** 커서 앞(시작이 커서보다 앞) 또는 뒤(시작이 커서 자리이거나 그 뒤)의 음 id */
export function notesBeside(notes: readonly Note[], at: Rat, side: "before" | "after"): string[] {
  return notes.filter((n) => (side === "before" ? cmp(n.start, at) < 0 : cmp(n.start, at) >= 0)).map((n) => n.id);
}

/**
 * 끄는 동안 격자를 끌 때(Alt) 쓰는 칸 (온음표의 1/n). 게임에서 쓸 수 있는 가장 짧은 길이(GameProfile.length.max) 칸이고,
 * 지금 격자가 그보다 잘면 지금 격자를 그대로 쓴다
 */
export function freeDivision(division: number, lengthMax: number): number {
  return Math.max(division, lengthMax);
}

/** 가장자리 자동 넘김 띠 두께 (px) */
export const EDGE_ZONE = 24;
/** 가장 빨리 넘길 때 한 화면 틀(약 1/60초)에 움직이는 px */
export const EDGE_SPEED = 14;

/**
 * 끄는 손이 시간 축 끝에 가까우면 화면을 얼마나 넘길지 (−1~1, 0이면 안 넘김).
 * along = 시간 축을 따라 잰 손 위치 (0 = 화면에 보이는 첫 시간, length = 마지막), 띠 안쪽 깊을수록·화면 밖일수록 빠르다
 */
export function edgeScroll(along: number, length: number, zone = EDGE_ZONE): number {
  if (length <= zone * 2) return 0;
  if (along < zone) return -Math.min(1, (zone - along) / zone);
  if (along > length - zone) return Math.min(1, (along - (length - zone)) / zone);
  return 0;
}

