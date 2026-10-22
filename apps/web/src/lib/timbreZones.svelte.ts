import { loadStored, saveStored } from "./persist";

/**
 * 음색 경계 표시 (보기 설정, 이 브라우저에 기억). 기본은 끔, 설정 → 화면에서 켠다.
 * 켜면 피아노롤에 고르는 트랙 악기의 음색 경계선과 구간 바탕을 옅게 깔고, 경계를 넘는 &를 빨간 선으로 보인다
 */
const KEY = "mmlce.timbreZones";

export const timbreZones = $state<{ on: boolean }>({ on: loadStored(KEY, (raw) => raw === "1") });

export function setTimbreZones(on: boolean): void {
  timbreZones.on = on;
  saveStored(KEY, on ? "1" : "0");
}
