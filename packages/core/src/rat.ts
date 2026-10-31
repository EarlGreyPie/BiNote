// 정확한 분수 시간. 단위는 온음표(= 1).
// l7, l37 같은 불규칙 음길이를 정수 tick으로 반올림하면 오차가 쌓이므로
// 위치와 길이는 항상 약분된 분수로 다루고, 재생·화면 직전에만 실수로 바꾼다.

export interface Rat {
  readonly n: number;
  readonly d: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function checked(x: number): number {
  if (!Number.isSafeInteger(x)) {
    throw new RangeError(`분수 값이 안전한 정수 범위를 넘었습니다: ${x}`);
  }
  return x;
}

export function rat(n: number, d = 1): Rat {
  if (d === 0) throw new RangeError("분모가 0입니다");
  checked(n);
  checked(d);
  if (n === 0) return ZERO;
  const g = gcd(n, d);
  const sign = d < 0 ? -1 : 1;
  return { n: (sign * n) / g, d: (sign * d) / g };
}

export const ZERO: Rat = Object.freeze({ n: 0, d: 1 });

export function add(a: Rat, b: Rat): Rat {
  const g = gcd(a.d, b.d);
  // 두 곱을 따로 본다: 곱 하나가 넘쳐 반올림된 뒤 비슷한 크기끼리 빼면, 합은 안전 범위 안이어도 틀린 값이 된다
  const left = a.n * (b.d / g);
  const right = b.n * (a.d / g);
  const d = (a.d / g) * b.d;
  if (Number.isSafeInteger(left) && Number.isSafeInteger(right) && Number.isSafeInteger(left + right) && Number.isSafeInteger(d)) {
    return rat(left + right, d);
  }
  // 중간 곱만 넘치고 약분하면 들어오는 경우가 있어 BigInt로 정확히 다시 센다. 약분해도 넘치면 그대로 멈춘다
  const bn = BigInt(a.n) * BigInt(b.d / g) + BigInt(b.n) * BigInt(a.d / g);
  const bd = BigInt(a.d / g) * BigInt(b.d);
  const bg = bigGcd(bn, bd);
  return rat(fromBig(bn / bg), fromBig(bd / bg));
}

function bigGcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function fromBig(x: bigint): number {
  const n = Number(x);
  if (!Number.isSafeInteger(n) || BigInt(n) !== x) {
    throw new RangeError(`분수 값이 안전한 정수 범위를 넘었습니다: ${x}`);
  }
  return n;
}

export function sub(a: Rat, b: Rat): Rat {
  return add(a, { n: -b.n, d: b.d });
}

export function mul(a: Rat, b: Rat): Rat {
  const g1 = gcd(a.n, b.d);
  const g2 = gcd(b.n, a.d);
  return rat(checked((a.n / g1) * (b.n / g2)), checked((a.d / g2) * (b.d / g1)));
}

export function div(a: Rat, b: Rat): Rat {
  if (b.n === 0) throw new RangeError("0으로 나눌 수 없습니다");
  return mul(a, { n: b.d, d: b.n });
}

/**
 * 두 분수의 크기 비교 (-1, 0, 1). 비교는 새 분수를 만들지 않으므로 분모가 아무리 커도 예외를 던지지 않는다.
 * 교차곱이 안전한 정수 범위를 넘으면 BigInt로 비교한다 (위치를 격자와 견줄 때 앱이 멈추지 않게)
 */
export function cmp(a: Rat, b: Rat): number {
  if (a.d === b.d) return a.n < b.n ? -1 : a.n > b.n ? 1 : 0;
  const g = gcd(a.d, b.d);
  const left = a.n * (b.d / g);
  const right = b.n * (a.d / g);
  if (Number.isSafeInteger(left) && Number.isSafeInteger(right)) return left < right ? -1 : left > right ? 1 : 0;
  const bl = BigInt(a.n) * BigInt(b.d / g);
  const br = BigInt(b.n) * BigInt(a.d / g);
  return bl < br ? -1 : bl > br ? 1 : 0;
}

export function eq(a: Rat, b: Rat): boolean {
  return a.n === b.n && a.d === b.d;
}

export function toFloat(a: Rat): number {
  return a.n / a.d;
}

/**
 * MML 음길이 표기를 분수로. `length`는 l 뒤의 숫자(4 = 4분음표),
 * `dots`는 점 개수. 점 하나는 1.5배, 둘은 1.75배.
 */
export function fromLength(length: number, dots = 0): Rat {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`음길이는 1 이상의 정수여야 합니다: ${length}`);
  }
  if (!Number.isInteger(dots) || dots < 0) {
    throw new RangeError(`점 개수가 올바르지 않습니다: ${dots}`);
  }
  const scale = 2 ** dots;
  // 1/len × (2 − 1/2^dots) = (2·2^dots − 1) / (len · 2^dots)
  return rat(2 * scale - 1, length * scale);
}
