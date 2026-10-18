import { mul, rat, type GameProfile, type Rat } from "@mmlce/core";
import { lengthPieces } from "@mmlce/mml";

/**
 * `.` 키: 점음표 붙이기·떼기. 길이가 게임이 한 토큰으로 쓰는 "2의 거듭제곱 길이"(점 없음)면 점을 붙이고(× 3/2),
 * 점 하나 붙은 길이면 뗀다(× 2/3). 셋잇단(12·24·48)이나 이어 붙인 길이처럼 애매한 길이는 바꾸지 않는다.
 * 결과는 프로필 길이 범위(length.min~max)와 점 수(length.dots) 안에서 한 토큰으로 쓸 수 있어야 한다
 */

/** 한 토큰으로 쓰는 길이면 [길이 숫자, 점 수] (출력기와 같은 길이 표) */
function token(dur: Rat, profile: GameProfile): [number, number] | undefined {
  const pieces = lengthPieces(dur, profile.length);
  if (!pieces || pieces.length !== 1) return undefined;
  const m = /^(\d+)(\.*)$/.exec(pieces[0]!);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (n < profile.length.min || (n & (n - 1)) !== 0) return undefined;
  return [n, m[2]!.length];
}

const ADD = rat(3, 2);
const REMOVE = rat(2, 3);

/** 이 길이에 점을 붙이거나 뗄 배수. 못 하면 undefined */
function factorOf(dur: Rat, profile: GameProfile): Rat | undefined {
  const t = token(dur, profile);
  if (!t) return undefined;
  if (t[1] === 1) return REMOVE;
  if (t[1] === 0 && profile.length.dots >= 1 && token(mul(dur, ADD), profile)) return ADD;
  return undefined;
}

/** 점을 붙이거나 뗀 길이. 못 하면 undefined */
export function toggleDot(dur: Rat, profile: GameProfile): Rat | undefined {
  const f = factorOf(dur, profile);
  return f ? mul(dur, f) : undefined;
}

/**
 * 여러 음에 한꺼번에: 첫 음으로 붙일지 뗄지 정하고, 모든 음이 같은 쪽으로 바뀌어 한 토큰이 될 때만 그 배수
 * (길이 ×2처럼 scaleNotesIn에 넘겨 리듬 모양을 지킨다). 못 하면 undefined
 */
export function dotFactor(durs: readonly Rat[], profile: GameProfile): Rat | undefined {
  const first = durs[0];
  const f = first && factorOf(first, profile);
  if (!f) return undefined;
  return durs.every((d) => factorOf(d, profile) === f) ? f : undefined;
}
