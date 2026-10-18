import { loadStored, saveStored } from "./persist";

/**
 * 화음 설정 (이 브라우저에 기억). 설정 → 화음과 MIDI 가져오기 창에서 바꾼다.
 * merge: MIDI를 가져올 때 화음 병합 (드문 트랙의 음을 같은 악기의 쉬는 트랙으로 옮긴다, 기본 켬)
 */
const MERGE = "mmlce.midiMerge";

export const chordPrefs = $state({
  merge: loadStored(MERGE, (raw) => raw !== "0"),
});

export function setMidiMerge(on: boolean): void {
  chordPrefs.merge = on;
  saveStored(MERGE, on ? "1" : "0");
}
