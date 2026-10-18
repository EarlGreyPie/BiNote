import { fromLength, type Rat } from "./rat.js";
import { MOBILE_PROFILE, type GameProfile } from "./profile.js";

/**
 * 게임이 받는 음길이 한도 (GameProfile.length)를 읽는 곳. 출력·검사·길이 고르기·아르페지오·슬라이드가 모두 여기를 거친다.
 * 게임 한도가 바뀌면(128분음표, 점 둘 등) GameProfile.length만 고치면 된다
 */
export type LengthLimit = GameProfile["length"];

/** 길이 숫자와 점 수 → 온음표 단위 분수 (`64.` → 3/128, `8..` → 7/32) */
export function noteLengthValue(length: number, dots: number): Rat {
  return fromLength(length, dots);
}

export interface GameLength {
  readonly length: number;
  readonly dots: number;
  readonly value: Rat;
}

const cache = new Map<string, readonly GameLength[]>();

/** 게임이 받는 한 토막 길이 전부 (min~max, 점 0~dots). 짧은 길이에도 점이 붙는다 (`64.` = 3/128, 게임에서 먹힘) */
export function gameLengths(limit: LengthLimit): readonly GameLength[] {
  const key = `${limit.min}/${limit.max}/${limit.dots}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: GameLength[] = [];
  for (let length = Math.max(1, limit.min); length <= limit.max; length++) {
    for (let dots = 0; dots <= limit.dots; dots++) out.push({ length, dots, value: noteLengthValue(length, dots) });
  }
  cache.set(key, out);
  return out;
}

/** 가장 짧은 한 토막 (점 없는 가장 긴 숫자, 지금 1/64) */
export function shortestLength(limit: LengthLimit): Rat {
  return noteLengthValue(limit.max, 0);
}

/** 게임이 받는 한 토막인지 */
export function isGameLength(limit: LengthLimit, length: number, dots: number): boolean {
  return Number.isInteger(length) && Number.isInteger(dots) && length >= limit.min && length <= limit.max && dots >= 0 && dots <= limit.dots;
}

/**
 * 곡 프로필이 닿지 않는 곳에서 쓰는 한도 (모바일). 프로필을 받을 수 있는 곳은 늘 곡 프로필의 length를 넘긴다
 */
export function defaultLengthLimit(): LengthLimit {
  return MOBILE_PROFILE.length;
}
