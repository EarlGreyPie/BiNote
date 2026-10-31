import { describe, expect, it } from "vitest";
import { describeDiagnostic, FALLBACK, LOCALES, matchLocale, missingKeys, rawMessage, translate, type MessageKey } from "../src/index.js";
import { ko } from "../src/locales/ko.js";

describe("translate", () => {
  it("값을 끼워 넣는다", () => {
    expect(translate("ko", "diag.unknown-char", { char: "q" })).toBe("알 수 없는 문자를 건너뜀: q");
    expect(translate("en", "diag.unknown-char", { char: "q" })).toBe("Skipped unknown character: q");
  });

  it("번역이 없으면 영어, 그다음 한국어", () => {
    for (const l of LOCALES) {
      if (l === "ko") continue;
      expect(FALLBACK[l][0]).toBe(l);
      expect(FALLBACK[l].slice(-1)).toEqual(["ko"]);
      if (l !== "en") expect(FALLBACK[l]).toContain("en");
    }
  });

  it("& 사슬 높이 차 안내는 숫자를 박지 않고 프로필 한도를 끼워 넣는다", () => {
    for (const l of LOCALES) {
      const text = translate(l, "ui.slideBend", { n: 2, limit: 12 });
      expect(text, l).toContain("12");
      expect(text, l).not.toContain("24");
    }
  });

  it("진단 코드를 문구로", () => {
    expect(describeDiagnostic("ko", { code: "tick-rounded", params: { bpm: 120 } })).toContain("t120");
    expect(describeDiagnostic("ko", { code: "no-such-code" })).toBe("no-such-code");
  });
});

describe("번역 범위", () => {
  it("모든 언어에 빠진 키가 없다", () => {
    for (const l of LOCALES) expect(missingKeys(l), l).toEqual([]);
  });

  it("번역문의 {자리표시자}가 원본과 같다", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const l of LOCALES) {
      for (const key of Object.keys(ko) as MessageKey[]) {
        const text = rawMessage(l, key);
        if (text !== undefined) expect(names(text), `${l} ${key}`).toEqual(names(ko[key]));
      }
    }
  });
});

describe("브라우저 언어", () => {
  it("중국어는 문자 체계와 지역으로 간체·번체를 가른다", () => {
    expect(matchLocale("zh-TW")).toBe("zh-TW");
    expect(matchLocale("zh-HK")).toBe("zh-TW");
    expect(matchLocale("zh-Hant")).toBe("zh-TW");
    expect(matchLocale("zh-CN")).toBe("zh-Hans");
    expect(matchLocale("zh-Hans-SG")).toBe("zh-Hans");
    expect(matchLocale("zh")).toBe("zh-TW");
    expect(matchLocale("zh-Hans-TW")).toBe("zh-Hans");
    expect(matchLocale("zh-Hans-HK")).toBe("zh-Hans");
    expect(matchLocale("zh-Hant-CN")).toBe("zh-TW");
    expect(matchLocale("zh-SG")).toBe("zh-Hans");
    expect(matchLocale("ja-JP")).toBe("ja");
    expect(matchLocale("fr-FR")).toBeUndefined();
  });
});
