import { add, cmp, rat, sub, type Note, type Rat } from "@mmlce/core";
import { optimizeMml } from "@mmlce/mml";
import type { GridNote } from "./quantize.js";

/**
 * 빈 채널 채우기 (EarlGreyPie "선형 방식"). 압축으로 빠진 소리를, 같은 연주자의 채널이 쉬는 자리에 다시 넣어
 * 쓰는 채널이 비지 않게 한다.
 *
 * - 후보: 그 쉼 동안 울려야 했던 빠진 음(뺀 음, 자른 음의 남은 부분). 쉼과 겹치는 부분만 넣는다.
 * - 같은 높이가 다른 채널에서 이미 울리고 있으면 넣지 않는다(겹친 음을 만들지 않음).
 * - 후보가 여럿이면 길게 겹치는 것, 그다음 그 채널 앞 음과 높이가 가까운 것(옥타브 명령이 덜 붙음)을 고른다.
 * - v는 volumeOf가 정한다 (넣는 자리에서 울리는 같은 손 음 수로 화음감쇠한 값).
 * - 채널 글자 수가 한도를 넘으면 넣은 음을 뒤에서부터 뺀다.
 */
export interface FillOptions {
  /** 이보다 짧은 조각은 넣지 않는다 (글자 수만 늘고 소리 보강은 작다) */
  readonly minLength: Rat;
  /** 채널 글자 수 한도 */
  readonly charLimit: number;
}

export interface FillResult {
  readonly tracks: Note[][];
  /** 넣은 음 수 */
  readonly added: number;
}

export function fillRests(
  tracks: readonly (readonly Note[])[],
  spare: readonly GridNote[],
  volumeOf: (n: GridNote, start: Rat, tracks: readonly (readonly Note[])[]) => number,
  nextId: () => string,
  options: FillOptions,
): FillResult {
  const out = tracks.map((t) => [...t].sort((a, b) => cmp(a.start, b.start)));
  const added = out.map(() => [] as Note[]);
  // 남은 후보 조각 (쓴 부분은 잘라 낸다)
  let pool = spare.map((n) => ({ start: n.start, end: add(n.start, n.dur), pitch: n.pitch, source: n }));

  const soundingElsewhere = (pitch: number, start: Rat, end: Rat, except: number) =>
    out.some((t, k) => k !== except && t.some((n) => n.pitch === pitch && cmp(n.start, end) < 0 && cmp(add(n.start, n.dur), start) > 0));

  out.forEach((track, k) => {
    // 시간 순으로 쉼을 훑는다. 넣은 음은 다음 쉼 계산에 들어가도록 track을 바로 고친다
    for (let i = 0; i + 1 < track.length; i++) {
      const prev = track[i]!;
      const gapStart = add(prev.start, prev.dur);
      const gapEnd = track[i + 1]!.start;
      if (cmp(sub(gapEnd, gapStart), options.minLength) < 0) continue;
      let best: { piece: (typeof pool)[number]; start: Rat; end: Rat; score: number } | undefined;
      for (const piece of pool) {
        if (cmp(piece.start, gapEnd) >= 0) break;
        const start = later(piece.start, gapStart);
        const end = earlier(piece.end, gapEnd);
        if (cmp(sub(end, start), options.minLength) < 0) continue;
        if (soundingElsewhere(piece.pitch, start, end, k)) continue;
        const length = (end.n / end.d - start.n / start.d) * 64;
        const score = length * 10 - Math.abs(piece.pitch - prev.pitch);
        if (!best || score > best.score) best = { piece, start, end, score };
      }
      if (!best) continue;
      const note: Note = {
        id: nextId(),
        start: best.start,
        dur: sub(best.end, best.start),
        pitch: best.piece.pitch,
        vol: volumeOf(best.piece.source, best.start, out),
        tie: "none",
      };
      track.splice(i + 1, 0, note);
      added[k]!.push(note);
      // 쓴 부분을 후보에서 잘라 낸다
      const used = best;
      pool = pool.flatMap((p) => {
        if (p !== used.piece) return [p];
        const rest = [];
        if (cmp(p.start, used.start) < 0) rest.push({ ...p, end: used.start });
        if (cmp(used.end, p.end) < 0) rest.push({ ...p, start: used.end });
        return rest;
      });
    }
  });

  // 글자 수 한도: 넘친 채널은 넣은 음을 뒤에서부터 덜어 낸다 (이분 탐색으로 남길 개수를 찾는다)
  let total = 0;
  out.forEach((track, k) => {
    const mine = added[k]!;
    const length = (notes: readonly Note[]) => optimizeMml(notes).text.length;
    if (mine.length > 0 && length(track) > options.charLimit) {
      const without = (keep: number) => {
        const drop = new Set(mine.slice(keep).map((n) => n.id));
        return track.filter((n) => !drop.has(n.id));
      };
      let lo = 0;
      let hi = mine.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (length(without(mid)) <= options.charLimit) lo = mid;
        else hi = mid - 1;
      }
      out[k] = without(lo);
      total += lo;
    } else total += mine.length;
  });
  return { tracks: out, added: total };
}

const later = (a: Rat, b: Rat) => (cmp(a, b) >= 0 ? a : b);
const earlier = (a: Rat, b: Rat) => (cmp(a, b) <= 0 ? a : b);
export const SIXTEENTH = rat(1, 16);
