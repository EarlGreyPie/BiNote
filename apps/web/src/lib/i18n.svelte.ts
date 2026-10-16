import { loadStored, saveStored } from "./persist";
import { describeDiagnostic, hasKey, LOCALES, matchLocale, translate, type Locale, type MessageKey, type Params } from "@mmlce/i18n";
import { splitPackProgram } from "@mmlce/core";

const STORAGE_KEY = "mmlce.locale";

function initialLocale(): Locale {
  const saved = loadStored(STORAGE_KEY, (raw) => raw);
  if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  for (const lang of navigator.languages ?? [navigator.language]) {
    const found = matchLocale(lang);
    if (found) return found;
  }
  return "ko";
}

/** 언어 이름 (각 언어로 적는다) */
export const LOCALE_LABELS: Record<Locale, string> = {
  ko: "한국어",
  ja: "日本語",
  "zh-TW": "繁體中文",
  "zh-Hans": "简体中文",
  en: "English",
};

/** <html lang>에 쓸 값. 한자 글꼴(한·일·번체·간체 자형)을 언어에 맞게 고르게 한다 */
export const HTML_LANG: Record<Locale, string> = { ko: "ko", ja: "ja", "zh-TW": "zh-Hant-TW", "zh-Hans": "zh-Hans", en: "en" };

export const i18n = $state({ locale: initialLocale() });
applyHtmlLang(i18n.locale);

function applyHtmlLang(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = HTML_LANG[locale];
}

export function setLocale(locale: Locale): void {
  i18n.locale = locale;
  saveStored(STORAGE_KEY, locale);
  applyHtmlLang(locale);
}

export function t(key: MessageKey, params?: Params): string {
  return translate(i18n.locale, key, params);
}

export function diag(d: { code: string; params?: Params }): string {
  return describeDiagnostic(i18n.locale, d);
}

/** 공통 악기 ID를 화면 이름으로. 모르는 ID(mabi:번호 등)는 그대로 보여 준다 */
export function instrumentName(canonical: string): string {
  const key = `inst.${canonical}`;
  if (hasKey(key)) return translate(i18n.locale, key);
  // 팩마다 번호가 다른 악기(기타 30/40 등)는 번호로 보여 준다
  // 마비꼬 추가 팩 번호(팩 × 512 + 번호)는 마비꼬 화면과 같이 "번호.팩"으로
  const numbered = /^mabi:(\d+)$/.exec(canonical);
  if (!numbered) return canonical;
  const { pack, number } = splitPackProgram(Number(numbered[1]));
  return pack > 0 ? `#${number}.${pack}` : `#${number}`;
}
