import type { Locale } from "@mmlce/i18n";

/** 공개 저장소(소유자/이름). 새 판의 바뀐 내용은 이 저장소의 GitHub Releases에서 읽는다 */
export const REPO = "EarlGreyPie/BiNote";
/** 공개 저장소. 정보 화면의 소스 코드·문제 신고 링크가 여기로 간다 (GPL-3.0 소스 제공) */
export const REPO_URL = `https://github.com/${REPO}`;
/** 언어별 바뀐 내용. 한국어 원본은 CHANGELOG.md(beta부터 모든 판), 번역은 docs/changelog/언어.md(1.0.0부터) */
export const CHANGELOG_FILES: Record<Locale, string> = {
  ko: "CHANGELOG.md",
  en: "docs/changelog/en.md",
  ja: "docs/changelog/ja.md",
  "zh-TW": "docs/changelog/zh-TW.md",
  "zh-Hans": "docs/changelog/zh-Hans.md",
};

/** 판마다 바뀐 내용 (그 언어 파일) */
export function changelogUrl(locale: Locale): string {
  return `${REPO_URL}/blob/main/${CHANGELOG_FILES[locale]}`;
}

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
