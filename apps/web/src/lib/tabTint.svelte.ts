import { loadStored, saveStored } from "./persist";

/**
 * 타브 숫자에 트랙 색 칠하기 (보기 설정, 이 브라우저에 기억). 기본은 켬, 설정 → 화면에서 끈다.
 * 켜면 한 연주자의 트랙을 여러 개 모아 볼 때 숫자 칸을 트랙 색으로 옅게 칠하고 고른 트랙이 아닌 숫자는 흐리게 쓴다
 */
const KEY = "mmlce.tabTrackTint";

export const tabTint = $state({ on: loadStored(KEY, (raw) => raw !== "0") });

export function setTabTint(on: boolean): void {
  tabTint.on = on;
  saveStored(KEY, on ? "1" : "0");
}
