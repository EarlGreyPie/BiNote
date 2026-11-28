import { cmp, tempoClock, type Note, type Rat, type TempoEvent } from "@mmlce/core";
import type { TempoSpan } from "@mmlce/mml";
import { attackPositions, matchOnsets } from "./noteOnsets";
import { notesEnd } from "./tempoSnap";

/**
 * 1.1 실험실 "템포를 음 길이로 바꾸기"의 원곡 시작점: 고른 구간마다 음 시작 곁(±창)에서 원곡 소리 시작점을 찾아
 * 바꾸기 전 곡 자리 → 맞출 곡 초 목록으로 (못 찾았거나 앞뒤 순서를 넘은 음은 뺀다. 그 음은 꺾은선으로 따라간다).
 * 찾기는 음 시작에 템포 넣기와 같은 matchOnsets를 쓴다. onset: 곡 초 → 찾은 곡 초 (원곡 어긋남은 부르는 쪽이 맡는다)
 */
export function respaceAnchors(
  tempo: readonly TempoEvent[],
  tracks: readonly { readonly notes: readonly Note[] }[],
  spans: readonly TempoSpan[],
  onset: (seconds: number) => number | undefined,
): { anchors: { at: Rat; seconds: number }[]; found: number; total: number } {
  const clock = tempoClock(tempo);
  const end = notesEnd(tracks);
  const anchors: { at: Rat; seconds: number }[] = [];
  let total = 0;
  for (const [from, until] of spans) {
    const to = until === undefined || cmp(until, end) > 0 ? end : until;
    if (cmp(from, to) >= 0) continue;
    // 구간 처음은 제자리라 찾지 않는다
    const inner = attackPositions(tracks, from, to).filter((at) => cmp(at, from) > 0);
    total += inner.length;
    for (const m of matchOnsets(tempo, inner, onset, { lower: clock(from), upper: clock(to) })) {
      if (m.found !== undefined) anchors.push({ at: m.at, seconds: m.found });
    }
  }
  return { anchors, found: anchors.length, total };
}
