import { loadStored, saveStored } from "./persist";
import { parseSelectKeys, type SelectKeysMode } from "./selectKeys";

/** 고른 음 건반 불 켜기 (이 브라우저에 기억). 기본은 고른 동안 계속, 설정 → 재생에서 고른다 */
const KEY = "mmlce.selectKeys";

export const selectKeys = $state<{ mode: SelectKeysMode }>({ mode: loadStored(KEY, parseSelectKeys) });

export function setSelectKeys(mode: SelectKeysMode): void {
  selectKeys.mode = mode;
  saveStored(KEY, mode);
}
