import { keyNames, keySignText } from "@mmlce/core";
import { t } from "./i18n.svelte";

/** 조표 고르기 칸 글 (예: "G장조 / e단조 · #1") */
export function keyOptionLabel(fifths: number): string {
  const n = keyNames(fifths);
  const sign = keySignText(fifths);
  const name = t("ui.keyName", { major: n.major, minor: n.minor });
  return sign ? `${name} · ${sign}` : name;
}
