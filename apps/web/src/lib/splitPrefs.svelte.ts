import { loadStored, saveStored } from "./persist";

/**
 * 악보책 나누기 방식 (이 브라우저에 기억). 나누기 창에서 바꾼다.
 * spread: 나누기 전에 같은 악기 트랙끼리 화음을 고르게 나눈다 (기본 켬. 끄면 악보책 나누기만)
 * thorough: 꼼꼼히 나누기. 곡이 길어도 정확한 최소 권 수를 찾는다 (기본 끔, 오래 걸린다)
 */
const SPREAD = "mmlce.splitSpread";
const THOROUGH = "mmlce.splitThorough";

export const splitPrefs = $state({
  spread: loadStored(SPREAD, (raw) => raw !== "0"),
  thorough: loadStored(THOROUGH, (raw) => raw === "1"),
});

export function setSplitSpread(on: boolean): void {
  splitPrefs.spread = on;
  saveStored(SPREAD, on ? "1" : "0");
}

export function setSplitThorough(on: boolean): void {
  splitPrefs.thorough = on;
  saveStored(THOROUGH, on ? "1" : "0");
}
