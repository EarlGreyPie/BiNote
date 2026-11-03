import { describe, expect, it } from "vitest";
import { rat, ZERO } from "@mmlce/core";
import type { SplitResult } from "@mmlce/mml";
import { bookMarks, withFixed } from "../src/lib/splitView";

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
});
