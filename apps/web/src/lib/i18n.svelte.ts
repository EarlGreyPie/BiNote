import { loadStored, saveStored } from "./persist";
import { describeDiagnostic, LOCALES, matchLocale, translate, type Locale, type MessageKey, type Params } from "@mmlce/i18n";
import { instrumentLabelIn, instrumentNameIn } from "./instrumentLabel";

const STORAGE_KEY = "mmlce.locale";

function initialLocale(): Locale {
  const saved = loadStored(STORAGE_KEY, (raw) => raw);
  if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  for (const lang of navigator.languages ?? [navigator.language]) {
    const found = matchLocale(lang);
    if (found) return found;
  }
  // 고를 수 있는 언어가 아니면(프랑스어·베트남어 등) 한국어보다 읽힐 가능성이 큰 영어로 연다
  return "en";
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
  return instrumentNameIn(i18n.locale, canonical);
}

/** 트랙의 지금 악기 글. .2·.3 팩 악기는 하프(24.2)처럼 팩 번호를 붙인다 (instrumentLabelIn) */
export function instrumentLabel(ref: { readonly canonical: string; readonly program?: number | undefined }): string {
  return instrumentLabelIn(i18n.locale, ref);
}
