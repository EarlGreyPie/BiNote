import type { Locale } from "@mmlce/i18n";

/** 공개 저장소. 정보 화면의 소스 코드·문제 신고 링크가 여기로 간다 (GPL-3.0 소스 제공) */
export const REPO_URL = "https://github.com/EarlGreyPie/BiNote";
/** 판마다 바뀐 내용 */
export const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;

/** 언어별 사용 안내서. 한국어 원본은 docs/가이드북.md, 번역은 docs/guide/언어.md */
const GUIDE_FILES: Record<Locale, string> = {
  ko: encodeURIComponent("가이드북") + ".md",
  en: "guide/en.md",
  ja: "guide/ja.md",
  "zh-TW": "guide/zh-TW.md",
  "zh-Hans": "guide/zh-Hans.md",
};

export function guideUrl(locale: Locale): string {
  return `${REPO_URL}/blob/main/docs/${GUIDE_FILES[locale]}`;
}
