import { sub, toFloat, type Rat } from "@mmlce/core";
import type { SplitResult } from "@mmlce/mml";

/** 글자 수 맞추기 창의 칸: 화음 분산, 화음 병합, 악보책 나누기 */
export type FitTab = "spread" | "merge" | "split";

/**
 * 악보책 자르는 자리 표시 (글자 수 맞추기 창의 띠, 피아노롤 위 예상 분할 위치).
 * at = 자르는 자리(다음 권 시작), trimFrom = 앞 권이 일찍 끝나는 자리(권 사이 지연을 메우는 구간 시작). 온음표 단위 실수
 */
export interface BookMark {
  /** 이 자리에서 시작하는 권 번호 (2권부터) */
  readonly book: number;
  readonly at: number;
  readonly trimFrom: number;
  /** 지연 구간에서 모든 트랙이 쉬는지 */
  readonly clean: boolean;
  /** 지연 구간에서 잘려 나가는 소리 (초) */
  readonly lost: number;
  /** 사용자가 고정한 자리인지 */
  readonly fixed: boolean;
}

/** 나누기 결과의 자르는 자리들 (마지막 권 끝은 빼고) */
export function bookMarks(result: SplitResult): BookMark[] {
  return result.parts.slice(0, -1).map((p, k) => ({
    book: k + 2,
    at: toFloat(p.end),
    trimFrom: toFloat(sub(p.end, p.trim)),
    clean: p.clean,
    lost: p.lost,
    fixed: p.fixed,
  }));
}

/** 고정 자리 목록에 at을 더하거나(같은 자리가 있으면 그대로) 뺀다. 늘 위치 순 */
export function withFixed(list: readonly Rat[], at: Rat, on: boolean): Rat[] {
  const key = (r: Rat) => r.n / r.d;
  const rest = list.filter((r) => Math.abs(key(r) - key(at)) > 1e-12);
  return (on ? [...rest, at] : rest).sort((a, b) => key(a) - key(b));
}

/** 잘려 나가는 소리 길이 글 (초, 소수 둘째 자리) */
export function lostText(seconds: number): string {
  return seconds.toFixed(2);
}
