import { loadStored, saveStored } from "./persist";
import { parseAdvanceDir, type PadAdvanceDir } from "./lengthPad";

export type { PadAdvanceDir };

/** 타브 프렛 숫자판 설정 (설정 → 화면, 이 브라우저에 기억) */
const TRIPLETS_KEY = "mmlce.lengthPadTriplets";
const ADVANCE_KEY = "mmlce.fretPadAdvanceDir";

export const fretPadPrefs = $state({
  /** 음표 입력판에 셋잇단(3·6·12·24·48) 단추를 둘지. 기본은 끔 */
  triplets: loadStored(TRIPLETS_KEY, (raw) => raw === "1"),
  advance: loadStored(ADVANCE_KEY, parseAdvanceDir),
});

export function setLengthPadTriplets(on: boolean): void {
  fretPadPrefs.triplets = on;
  saveStored(TRIPLETS_KEY, on ? "1" : "0");
}

export function setPadAdvanceDir(dir: PadAdvanceDir): void {
  fretPadPrefs.advance = dir;
  saveStored(ADVANCE_KEY, dir);
}
