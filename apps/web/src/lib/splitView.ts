import { add, cmp, sub, toFloat, ZERO, type Rat } from "@mmlce/core";
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

/**
 * at 자리에 length만큼 마디를 넣은 뒤의 고정 자리: at과 그 뒤 자리는 음과 함께 length만큼 민다.
 * 고정 자리는 곡이 아니라 화면 상태라, 시간을 옮기는 편집이 함께 옮기지 않으면 엉뚱한 악절에서 자른다
 */
export function fixedAfterInsert(list: readonly Rat[], at: Rat, length: Rat): Rat[] {
  return list.map((r) => (cmp(r, at) >= 0 ? add(r, length) : r));
}

/**
 * [시작, 끝) 구간들을 지우고 뒤를 당긴 뒤의 고정 자리: 지운 구간 안 자리는 빼고, 뒤 자리는 앞에서 지운 길이만큼 당긴다.
 * 구간은 겹치거나 순서가 섞여 있어도 된다
 */
export function fixedAfterDelete(list: readonly Rat[], spans: readonly (readonly [Rat, Rat])[]): Rat[] {
  const merged: [Rat, Rat][] = [];
  for (const [from, to] of [...spans].filter(([a, b]) => cmp(a, b) < 0).sort((a, b) => cmp(a[0], b[0]))) {
    const last = merged[merged.length - 1];
    if (last && cmp(from, last[1]) <= 0) {
      if (cmp(to, last[1]) > 0) last[1] = to;
    } else merged.push([from, to]);
  }
  const out: Rat[] = [];
  for (const r of list) {
    if (merged.some(([a, b]) => cmp(r, a) >= 0 && cmp(r, b) < 0)) continue;
    const removed = merged.filter(([, b]) => cmp(b, r) <= 0).reduce((sum, [a, b]) => add(sum, sub(b, a)), ZERO);
    out.push(sub(r, removed));
  }
  return withFixedAll(out);
}

/** 같은 자리를 하나로, 위치 순 */
function withFixedAll(list: readonly Rat[]): Rat[] {
  return list.reduce<Rat[]>((acc, r) => withFixed(acc, r, true), []);
}

/** 잘려 나가는 소리 길이 글 (초, 소수 둘째 자리) */
export function lostText(seconds: number): string {
  return seconds.toFixed(2);
}
