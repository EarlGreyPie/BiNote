import { describe, expect, it } from "vitest";
import { placeLoss, rat, type Note } from "@mmlce/core";
import { translate, type MessageKey, type Params } from "@mmlce/i18n";
import { overlapNotice } from "../src/lib/overlapNotice";

const note = (id: string, start: number, dur: number): Note => ({ id, start: rat(start, 8), dur: rat(dur, 8), pitch: 60, vol: 8, tie: "none" });
const ko = (key: MessageKey, params?: Params) => translate("ko", key, params);
const base = [note("a", 0, 2), note("b", 2, 2), note("c", 4, 2)];

describe("놓은 뒤 겹친 음 알림", () => {
  it("잘린 음과 지워진 음 수를 알맞은 글로 알린다", () => {
    // x(1/8~5/8): a는 끝이 잘리고 b·c는 지워진다
    expect(overlapNotice(placeLoss(base, new Map([["x", note("x", 1, 4)]])), ko)).toBe("겹친 음 1개는 끝이 잘리고 2개는 지워졌어요. 되돌리기로 되돌릴 수 있어요");
    // x(1/8~2/8): a만 잘리고 b(2/8~)는 그대로
    expect(overlapNotice(placeLoss(base, new Map([["x", note("x", 1, 1)]])), ko)).toBe("겹친 음 1개의 끝이 잘렸어요. 되돌리기로 되돌릴 수 있어요");
    // a를 2/8 길이 그대로 b 자리(2/8)로 옮기면 b만 지워진다
    expect(overlapNotice(placeLoss(base, new Map([["a", note("a", 2, 2)]])), ko)).toBe("겹친 음 1개가 지워졌어요. 되돌리기로 되돌릴 수 있어요");
  });

  it("손해 본 음이 없으면 알리지 않는다", () => {
    expect(overlapNotice(placeLoss(base, new Map([["x", note("x", 6, 2)]])), ko)).toBeUndefined();
    expect(overlapNotice(placeLoss(base, new Map([["a", null]])), ko)).toBeUndefined();
  });
});
