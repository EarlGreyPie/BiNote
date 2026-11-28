import { barBeatAt, memoMarkers, structureMarkers, type Marker, type Rat, type Song, type TimeSigEvent } from "@mmlce/core";

/** 마디:박 글자 (박이 정수가 아니면 소수 둘째 자리까지). 템포·마커 창과 같은 모양 */
export function barBeatText(timeSig: readonly TimeSigEvent[], at: Rat): string {
  const { bar, beat } = barBeatAt(timeSig, at);
  return `${bar}:${Number.isInteger(beat) ? beat : beat.toFixed(2)}`;
}

/** 작업 메모 자리 글: 한 자리면 "12:1", 범위 메모면 "12:1 - 14:1" */
export function memoWhere(timeSig: readonly TimeSigEvent[], memo: Pick<Marker, "at" | "end">): string {
  return memo.end ? `${barBeatText(timeSig, memo.at)} - ${barBeatText(timeSig, memo.end)}` : barBeatText(timeSig, memo.at);
}

/** 메모 목록 패널에 보일 것: 자리순 메모 (안 끝낸 것만 거르기), 개수, 메모로 바꿀 수 있는 구조 마커 */
export function memoListOf(song: Pick<Song, "markers">, onlyOpen: boolean): { readonly memos: readonly Marker[]; readonly open: number; readonly total: number; readonly markers: readonly Marker[] } {
  const all = memoMarkers(song.markers);
  const open = all.filter((m) => !m.done).length;
  return { memos: onlyOpen ? all.filter((m) => !m.done) : all, open, total: all.length, markers: structureMarkers(song.markers) };
}
