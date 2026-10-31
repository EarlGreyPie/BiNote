import type { MessageKey } from "@mmlce/i18n";

/**
 * CodeMirror 찾기·바꾸기 칸의 영어 문구 → 화면 문구 키. 편집기가 EditorState.phrases로 넣는다.
 * 줄 번호로 가기(Go to line)는 단축키를 달지 않아 뺀다
 */
export const SEARCH_PHRASES: Readonly<Record<string, MessageKey>> = {
  Find: "ui.searchFind",
  Replace: "ui.searchReplace",
  next: "ui.searchNext",
  previous: "ui.searchPrev",
  all: "ui.searchAll",
  "match case": "ui.searchMatchCase",
  regexp: "ui.searchRegexp",
  "by word": "ui.searchByWord",
  replace: "ui.searchReplaceOne",
  "replace all": "ui.searchReplaceAll",
  close: "ui.searchClose",
  "current match": "ui.searchCurrent",
  "on line": "ui.searchOnLine",
  "replaced match on line $": "ui.searchReplacedOne",
  "replaced $ matches": "ui.searchReplacedAll",
};

/** 지금 화면 언어의 찾기 칸 문구 */
export function searchPhrases(t: (key: MessageKey) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(SEARCH_PHRASES).map(([en, key]) => [en, t(key)]));
}
