import { measureStart, ZERO, type Command, type Rat, type TimeSigEvent } from "@mmlce/core";
import { setMeter } from "@mmlce/mml";

/**
 * 박자를 바꿀 마디의 처음 (도구줄 박자 칸, 곡 → 박자 바꾸기). 타브 보기에 타브 커서가 있으면 그 커서가 든 마디,
 * 아니면 재생 커서가 든 마디, 둘 다 없으면 곡 처음. Alt+B·Alt+M 창과 같은 우선순위다
 */
export function meterTarget(timeSig: readonly TimeSigEvent[], viewMode: "roll" | "tab", tabCursor: Rat | undefined, editCursor: Rat | undefined): Rat {
  const at = (viewMode === "roll" ? undefined : tabCursor) ?? editCursor;
  return at ? measureStart(timeSig, at) : ZERO;
}

/** 이벤트 창(템포·박자·마커 줄)에서 박자를 넣거나 고친다: 그 자리가 든 마디 처음부터 바꾼다 */
export function meterEditAt(timeSig: readonly TimeSigEvent[], at: Rat, beats: number, unit: number, label?: string): Command {
  return setMeter(measureStart(timeSig, at), beats, unit, label);
}
