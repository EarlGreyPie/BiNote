import { describe, expect, it } from "vitest";
import { rat, type Note } from "@mmlce/core";
import { lengthLoss, lengthText, parseLength, pitchText, positionText } from "../src/lib/noteInfo";

describe("noteInfo", () => {
  it("길이를 MML 길이로, 못 쓰면 분수로", () => {
    expect(lengthText(rat(1, 8))).toBe("8");
    expect(lengthText(rat(3, 16))).toBe("8.");
    expect(lengthText(rat(7, 32))).toBe("8..");
    expect(lengthText(rat(1, 7))).toBe("7");
    expect(lengthText(rat(1, 1))).toBe("1");
    expect(lengthText(rat(2, 1))).toBe("2");
    expect(lengthText(rat(5, 16))).toBe("5/16");
    expect(lengthText(rat(1, 128))).toBe("1/128");
  });

  it("MML 길이·분수를 읽는다", () => {
    expect(parseLength("8")).toEqual(rat(1, 8));
    expect(parseLength(" l8. ")).toEqual(rat(3, 16));
    expect(parseLength("1/7")).toEqual(rat(1, 7));
    expect(parseLength("6/8")).toEqual(rat(3, 4));
    expect(parseLength("0")).toBeUndefined();
    expect(parseLength("1/0")).toBeUndefined();
    expect(parseLength("c8")).toBeUndefined();
  });

  it("음 이름과 마디:박", () => {
    expect(pitchText(60)).toBe("o4c");
    expect(pitchText(61)).toBe("o4c+");
    expect(positionText([], rat(5, 4))).toBe("2:2");
    expect(positionText([{ at: rat(0), beats: 3, unit: 4 }], rat(3, 4))).toBe("2:1");
  });
});

describe("정보 칸 길이로 잘리거나 지워질 음 (lengthLoss)", () => {
  // 시작·길이는 8분음표 단위
  const note = (id: string, start: number, dur: number): Note => ({ id, start: rat(start, 8), dur: rat(dur, 8), pitch: 60, vol: 8, tie: "none" });
  const one = { notes: [note("a", 0, 2), note("b", 2, 2), note("c", 4, 2)] };
  const two = { notes: [note("d", 0, 2), note("e", 2, 2)] };

  it("늘린 음 안에서 시작하는 고르지 않은 음은 지워진다", () => {
    const loss = lengthLoss([one, two], new Set(["a"]), rat(5, 8));
    expect([...loss.removed].sort()).toEqual(["b", "c"]);
    expect(loss.cut.size).toBe(0);
  });

  it("겹치지 않거나 줄이면 아무것도 잃지 않는다", () => {
    for (const dur of [rat(1, 4), rat(1, 8), rat(1, 64)]) {
      const loss = lengthLoss([one, two], new Set(["a", "c"]), dur);
      expect(loss.cut.size + loss.removed.size).toBe(0);
    }
    // 고른 음이 없는 트랙은 건드리지 않는다
    expect(lengthLoss([two], new Set(["a"]), rat(1, 1)).removed.size).toBe(0);
  });

  it("고른 음끼리는 세지 않고, 여러 트랙에서 고르면 트랙마다 센다", () => {
    // a·b를 4/8로: b(2/8~6/8)가 c를 지운다. a가 b에 잘리는 것은 고른 음끼리라 세지 않는다
    expect([...lengthLoss([one], new Set(["a", "b"]), rat(1, 2)).removed]).toEqual(["c"]);
    // 타브처럼 두 트랙에서 a·d를 3/8로: 트랙마다 b·e가 지워진다
    expect([...lengthLoss([one, two], new Set(["a", "d"]), rat(3, 8)).removed].sort()).toEqual(["b", "e"]);
  });

  it("고른 음 앞에서 이미 겹쳐 있던 음은 끝이 잘린다 (replaceNotes와 같은 규칙)", () => {
    const dirty = { notes: [note("p", 0, 4), note("q", 2, 1)] };
    const loss = lengthLoss([dirty], new Set(["q"]), rat(1, 4));
    expect(loss.cut.get("p")).toEqual(rat(1, 4));
    expect(loss.removed.size).toBe(0);
    // 원래 음은 바뀌지 않는다
    expect(dirty.notes[0]!.dur).toEqual(rat(1, 2));
  });
});
