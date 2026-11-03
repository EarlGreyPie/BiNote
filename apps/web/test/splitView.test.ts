import { describe, expect, it } from "vitest";
import { rat, ZERO } from "@mmlce/core";
import type { SplitResult } from "@mmlce/mml";
import { bookMarks, fixedAfterDelete, fixedAfterInsert, withFixed } from "../src/lib/splitView";

describe("악보책 자르는 자리 표시", () => {
  it("마지막 권 끝은 빼고, 권마다 자르는 자리와 지연 구간 시작을 온음표 단위로", () => {
    const part = (start: number, end: number, trim: number, clean: boolean, fixed: boolean) => ({
      start: rat(start),
      end: rat(end),
      texts: [],
      cut: 0,
      trim: rat(trim * 4, 4),
      moved: 0,
      lossy: [],
      clean,
      lost: clean ? 0 : 0.5,
      fixed,
      choices: [],
    });
    const result: SplitResult = { needed: true, ignored: [], parts: [part(0, 10, 0.5, true, false), part(10, 20, 0.25, false, true), part(20, 25, 0, true, false)] };
    expect(bookMarks(result)).toEqual([
      { book: 2, at: 10, trimFrom: 9.5, clean: true, lost: 0, fixed: false },
      { book: 3, at: 20, trimFrom: 19.75, clean: false, lost: 0.5, fixed: true },
    ]);
  });

  it("고정 자리는 같은 자리를 겹쳐 넣지 않고 늘 위치 순이다", () => {
    let list = withFixed([], rat(3), true);
    list = withFixed(list, rat(1), true);
    list = withFixed(list, rat(6, 2), true);
    expect(list.map((r) => r.n / r.d)).toEqual([1, 3]);
    expect(withFixed(list, rat(1), false).map((r) => r.n / r.d)).toEqual([3]);
    expect(withFixed([ZERO], ZERO, false)).toEqual([]);
  });

  it("마디를 넣거나 지우면 고정 자리도 음과 함께 옮긴다 (지운 구간 안 자리는 뺀다)", () => {
    const key = (list: readonly { n: number; d: number }[]) => list.map((r) => r.n / r.d);
    // 3마디 시작(2/1)을 고정하고 곡 처음에 4/4 한 마디를 넣으면 3/1로
    expect(key(fixedAfterInsert([rat(2)], ZERO, rat(1)))).toEqual([3]);
    // 넣는 자리보다 앞 자리는 그대로, 넣는 자리와 같은 자리는 민다
    expect(key(fixedAfterInsert([rat(1), rat(2)], rat(2), rat(3, 4)))).toEqual([1, 2.75]);
    // 1~2마디(0~2/1)를 지우면 3/1 → 1/1, 지운 구간 안(1/1)은 빠지고, 구간 끝(2/1)은 0으로
    expect(key(fixedAfterDelete([rat(1), rat(2), rat(3)], [[ZERO, rat(2)]]))).toEqual([0, 1]);
    // 겹치고 순서가 섞인 구간
    expect(key(fixedAfterDelete([rat(5)], [[rat(3), rat(4)], [rat(1), rat(2)], [rat(3, 2), rat(5, 2)]]))).toEqual([5 - 1.5 - 1]);
  });
});
