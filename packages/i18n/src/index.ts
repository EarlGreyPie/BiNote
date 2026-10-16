import { en } from "./locales/en.js";
import { ja } from "./locales/ja.js";
import { ko, type MessageKey } from "./locales/ko.js";
import { zhHans } from "./locales/zh-Hans.js";
import { zhTW } from "./locales/zh-TW.js";

export type { MessageKey };
export type Locale = "ko" | "ja" | "zh-TW" | "zh-Hans" | "en";
export const LOCALES: readonly Locale[] = ["ko", "ja", "zh-TW", "zh-Hans", "en"];

const CATALOGS: Record<Locale, Partial<Record<MessageKey, string>>> = { ko, ja, "zh-TW": zhTW, "zh-Hans": zhHans, en };

/** 번역이 빠졌을 때 찾아볼 순서 */
export const FALLBACK: Record<Locale, readonly Locale[]> = {
  ko: ["ko"],
  en: ["en", "ko"],
  ja: ["ja", "en", "ko"],
  "zh-TW": ["zh-TW", "en", "ko"],
  "zh-Hans": ["zh-Hans", "en", "ko"],
};

export type Params = Readonly<Record<string, string | number>>;

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  let template: string = ko[key];
  for (const l of FALLBACK[locale]) {
    const found = CATALOGS[l][key];
    if (found !== undefined) {
      template = found;
      break;
    }
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params && name in params ? String(params[name]) : whole,
  );
}

/** 진단(코드 + 값)을 문구로. 모르는 코드면 코드를 그대로 보여준다 */
export function describeDiagnostic(locale: Locale, d: { code: string; params?: Params }): string {
  const key = `diag.${d.code}`;
  return key in ko ? translate(locale, key as MessageKey, d.params) : d.code;
}

/** 언어별로 번역이 빠진 키 목록 (CI 보고용) */
export function missingKeys(locale: Locale): MessageKey[] {
  return (Object.keys(ko) as MessageKey[]).filter((k) => CATALOGS[locale][k] === undefined);
}

/** 브라우저 언어 태그를 앱 언어로. 중국어는 문자 체계(Hans/Hant)나 지역으로 간체·번체를 가른다 */
export function matchLocale(tag: string): Locale | undefined {
  const lang = tag.toLowerCase();
  if (lang.startsWith("ko")) return "ko";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("en")) return "en";
  if (lang.startsWith("zh")) {
    // 문자 체계(Hant/Hans)를 적었으면 그것을 따르고, 없을 때만 지역으로 가른다
    if (/-hant\b/.test(lang)) return "zh-TW";
    if (/-hans\b/.test(lang)) return "zh-Hans";
    if (/-(cn|sg|my)\b/.test(lang)) return "zh-Hans";
    return "zh-TW";
  }
  return undefined;
}

/** 그 언어 번역문 그대로 (없으면 undefined). 테스트에서 자리표시자를 맞춰 볼 때 쓴다 */
export function rawMessage(locale: Locale, key: MessageKey): string | undefined {
  return CATALOGS[locale][key];
}

/** 문구 목록에 있는 키인지. 악기 ID처럼 바깥에서 만든 키를 확인할 때 쓴다 */
export function hasKey(key: string): key is MessageKey {
  return key in ko;
}
