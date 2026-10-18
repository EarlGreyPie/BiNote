import { hasKey, translate, type Locale } from "@mmlce/i18n";
import { splitPackProgram } from "@mmlce/core";

/** 공통 악기 ID를 locale의 화면 이름으로. 모르는 ID(mabi:번호 등)는 그대로 보여 준다 */
export function instrumentNameIn(locale: Locale, canonical: string): string {
  const key = `inst.${canonical}`;
  if (hasKey(key)) return translate(locale, key);
  // 팩마다 번호가 다른 악기(기타 30/40 등)는 번호로 보여 준다
  // 마비꼬 추가 팩 번호(팩 × 512 + 번호)는 마비꼬 화면과 같이 "번호.팩"으로
  const numbered = /^mabi:(\d+)$/.exec(canonical);
  if (!numbered) return canonical;
  const { pack, number } = splitPackProgram(Number(numbered[1]));
  return pack > 0 ? `#${number}.${pack}` : `#${number}`;
}

/**
 * 트랙이 지금 쓰는 악기의 화면 글. 악기 번호에 마비꼬 팩 번호(.2·.3)가 있으면 이름 뒤에 마비꼬와 같은 "번호.팩"을 붙인다
 * (하프(24.2)). 팩 번호가 없으면 이름만, 이름을 모르는 번호 악기는 #42.3 그대로
 */
export function instrumentLabelIn(locale: Locale, ref: { readonly canonical: string; readonly program?: number | undefined }): string {
  const name = instrumentNameIn(locale, ref.canonical);
  if (ref.program === undefined || ref.canonical.startsWith("mabi:")) return name;
  const { pack, number } = splitPackProgram(ref.program);
  return pack > 0 ? `${name}(${number}.${pack})` : name;
}
