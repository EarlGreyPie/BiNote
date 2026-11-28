import { fromLength, rat, type Rat } from "./rat.js";
import { DEFAULT_PROFILE, type GameProfile } from "./profile.js";

/**
 * 게임이 받는 음길이 한도 (GameProfile.length)를 읽는 곳. 출력·검사·길이 고르기·아르페지오·슬라이드가 모두 여기를 거친다.
 * 게임 한도가 바뀌면(128분음표, 점 둘 등) GameProfile.length만 고치면 된다
 */
export type LengthLimit = GameProfile["length"];

/**
 * 길이 숫자와 점 수 → 온음표 단위 분수. 길이 숫자의 값은 늘 이 함수로 구한다 (읽기·쓰기·글자 수 줄이기·검사가 같은 값을 쓰도록).
 * - 한도에 틱 모형(limit.ticks)이 없거나 한도를 주지 않으면 정확한 분수 (`64.` → 3/128, `8..` → 7/32)
 * - 틱 모형이면 정수 틱 / perWhole (온음표 384틱이면 `7` → 54/384, `5.` → 114/384)
 */
export function noteLengthValue(length: number, dots: number, limit?: LengthLimit): Rat {
  const ticks = limit?.ticks;
  if (ticks) return rat(lengthTicks(length, dots, ticks.perWhole), ticks.perWhole);
  return fromLength(length, dots);
}

/**
 * 길이 숫자 하나를 정수 틱으로 읽은 값 (마비꼬와 같은 셈): perWhole / 숫자를 버리고, 점마다 앞에 더한 틱의 절반을 버려 더한다.
 * 온음표 384틱이면 7 → 54, 19 → 20, 19. → 30, 5. → 114
 */
export function lengthTicks(length: number, dots: number, perWhole: number): number {
  let piece = Math.floor(perWhole / length);
  let total = piece;
  for (let k = 0; k < dots; k++) {
    piece = Math.floor(piece / 2);
    total += piece;
  }
  return total;
}

/** 한도의 길이 모형을 가르는 열쇠 (캐시용). 틱 모형이 다르면 같은 숫자도 값이 다르다 */
export function lengthLimitKey(limit: LengthLimit): string {
  const ticks = limit.ticks ? `/t${limit.ticks.perWhole}${limit.ticks.rounding}` : "";
  return `${limit.min}/${limit.max}/${limit.dots}${ticks}`;
}

export interface GameLength {
  readonly length: number;
  readonly dots: number;
  readonly value: Rat;
}

const cache = new Map<string, readonly GameLength[]>();

/** 게임이 받는 한 토막 길이 전부 (min~max, 점 0~dots). 짧은 길이에도 점이 붙는다 (`64.` = 3/128, 게임에서 먹힘) */
export function gameLengths(limit: LengthLimit): readonly GameLength[] {
  const key = lengthLimitKey(limit);
  const hit = cache.get(key);
  if (hit) return hit;
  const out: GameLength[] = [];
  for (let length = Math.max(1, limit.min); length <= limit.max; length++) {
    for (let dots = 0; dots <= limit.dots; dots++) out.push({ length, dots, value: noteLengthValue(length, dots, limit) });
  }
  cache.set(key, out);
  return out;
}

/** 가장 짧은 한 토막 (점 없는 가장 긴 숫자, 지금 1/64) */
export function shortestLength(limit: LengthLimit): Rat {
  return noteLengthValue(limit.max, 0, limit);
}

/** 게임이 받는 한 토막인지 */
export function isGameLength(limit: LengthLimit, length: number, dots: number): boolean {
  return Number.isInteger(length) && Number.isInteger(dots) && length >= limit.min && length <= limit.max && dots >= 0 && dots <= limit.dots;
}

/**
 * 곡 프로필이 닿지 않는 곳에서 쓰는 한도 (DEFAULT_PROFILE). 프로필을 받을 수 있는 곳은 늘 곡 프로필의 length를 넘긴다
 */
export function defaultLengthLimit(): LengthLimit {
  return DEFAULT_PROFILE.length;
}
