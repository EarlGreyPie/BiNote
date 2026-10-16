import { describe, expect, it } from "vitest";
import { rat } from "@mmlce/core";
import { lengthText, parseLength, pitchText, positionText } from "../src/lib/noteInfo";

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
