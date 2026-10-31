import { loadStored, saveStored } from "./persist";
import { parsePlaySpeed } from "./playSpeed";

/**
 * 일반 재생 덧붙임 (이 브라우저에 기억). 재생 단추 옆 메뉴에서 바꾼다.
 * metronome: 박마다 딸깍, 마디 첫 박은 높게 (기본 끔)
 * countIn: 멈춰 있다가 재생을 시작하면 한 마디 예비박 (기본 끔)
 * speed: 재생 속도 (1 = 원래, PLAY_SPEEDS)
 */
const METRONOME = "mmlce.playMetronome";
const COUNT_IN = "mmlce.playCountIn";
const SPEED = "mmlce.playSpeed";

export const playPrefs = $state({
  metronome: loadStored(METRONOME, (raw) => raw === "1"),
  countIn: loadStored(COUNT_IN, (raw) => raw === "1"),
  speed: loadStored(SPEED, parsePlaySpeed),
});

export function setPlayMetronome(on: boolean): void {
  playPrefs.metronome = on;
  saveStored(METRONOME, on ? "1" : "0");
}

export function setPlayCountIn(on: boolean): void {
  playPrefs.countIn = on;
  saveStored(COUNT_IN, on ? "1" : "0");
}

export function setPlaySpeed(speed: number): void {
  playPrefs.speed = parsePlaySpeed(String(speed));
  saveStored(SPEED, String(playPrefs.speed));
}
