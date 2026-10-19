import { loadStored, parseJson, saveStored } from "./persist";
import { parseTuplet, type Tuplet } from "./tuplet";

/** 사용자가 정한 잇단음 (새 음 → 잇단음…, 이 브라우저에 기억) */
const TUPLET_KEY = "mmlce.tuplet";
/** 타브 음표 입력판에 잇단음 단추를 둘지 (설정 → 화면) */
const PAD_KEY = "mmlce.lengthPadTuplet";

export const tupletPrefs = $state({
  tuplet: loadStored(TUPLET_KEY, (raw) => parseTuplet(parseJson(raw))),
  /** 기본은 끔 */
  pad: loadStored(PAD_KEY, (raw) => raw === "1"),
});

export function setTuplet(tuplet: Tuplet): void {
  tupletPrefs.tuplet = tuplet;
  saveStored(TUPLET_KEY, JSON.stringify(tuplet));
}

export function setLengthPadTuplet(on: boolean): void {
  tupletPrefs.pad = on;
  saveStored(PAD_KEY, on ? "1" : "0");
}
