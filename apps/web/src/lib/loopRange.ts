import { toFloat, type Rat } from "@mmlce/core";

/**
 * 편집에 쓸 반복 구간 끝점 (분수). 화면 반복 구간(loop, 소수)이 잡을 때 기억한 분수(exact)와 같으면 그 분수를,
 * 다르면(다른 길로 바뀜) 지금 격자로 맞춘 값(toRat)을 쓴다. 잡은 뒤 격자를 바꾸면 소수를 새 격자로 되돌릴 수 없어
 * 1/960로 반올림되므로, 마디선이 1/960에 안 맞는 곡에서 고른 마디 밖 마디까지 걸리지 않게 한다
 */
export function loopEnds(
  loop: readonly [number, number] | undefined,
  exact: readonly [Rat, Rat] | undefined,
  toRat: (time: number) => Rat,
): readonly [Rat, Rat] | undefined {
  if (!loop) return undefined;
  if (exact && toFloat(exact[0]) === loop[0] && toFloat(exact[1]) === loop[1]) return exact;
  return [toRat(loop[0]), toRat(loop[1])];
}
