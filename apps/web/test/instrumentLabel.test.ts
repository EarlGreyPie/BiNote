import { describe, expect, it } from "vitest";
import { instrumentLabelIn } from "../src/lib/instrumentLabel";

describe("instrumentLabelIn: 트랙의 지금 악기 글", () => {
  it(".2·.3 팩 번호가 있으면 이름 뒤에 번호.팩을 붙인다", () => {
    expect(instrumentLabelIn("ko", { canonical: "harp", program: 1048 })).toBe("하프(24.2)");
    expect(instrumentLabelIn("ko", { canonical: "folk-guitar", program: 3 * 512 + 40 })).toBe("포크 기타(40.3)");
  });

  it("팩 번호가 0이거나 번호가 없으면 이름만", () => {
    expect(instrumentLabelIn("ko", { canonical: "harp", program: 24 })).toBe("하프");
    expect(instrumentLabelIn("ko", { canonical: "harp" })).toBe("하프");
  });

  it("이름을 모르는 번호 악기는 #번호.팩 그대로", () => {
    expect(instrumentLabelIn("ko", { canonical: "mabi:1578", program: 1578 })).toBe("#42.3");
  });

  it("다른 언어도 같은 모양 (번호는 번역하지 않는다)", () => {
    expect(instrumentLabelIn("en", { canonical: "harp", program: 1048 })).toBe("Harp(24.2)");
    expect(instrumentLabelIn("en", { canonical: "harp", program: 24 })).toBe("Harp");
  });
});
