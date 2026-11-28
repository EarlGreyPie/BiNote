import { describe, expect, it } from "vitest";
import { savedReferenceHint, signedMs } from "../src/lib/referenceSaved";

describe("원곡 줄의 맞춤값 늘 보이기", () => {
  it("어긋남을 부호 붙여 적는다", () => {
    expect(signedMs(-767)).toBe("-767ms");
    expect(signedMs(120)).toBe("+120ms");
    expect(signedMs(0)).toBe("0ms");
    expect(signedMs(12.6)).toBe("+13ms");
  });

  it("안 불러왔으면 적힌 값, 다른 이름으로 불러왔으면 쓸 수 있는 값, 같은 이름이면 없음", () => {
    const saved = { name: "a.m4a", offsetMs: -767, volume: 0.8 };
    expect(savedReferenceHint(undefined, saved)).toEqual({ name: "a.m4a", offsetMs: -767 });
    expect(savedReferenceHint({ name: "a.mp4" }, saved)).toEqual({ name: "a.m4a", offsetMs: -767 });
    expect(savedReferenceHint({ name: "a.m4a" }, saved)).toBeUndefined();
    expect(savedReferenceHint(undefined, undefined)).toBeUndefined();
  });
});
