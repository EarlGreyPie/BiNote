import { add, cmp, sub, ZERO, type LengthLimit, type Note, type Rat, type Song } from "@mmlce/core";
import { canWriteExactly } from "@mmlce/mml";

type Notes = readonly Pick<Note, "start" | "dur">[];

/**
 * 트랙 음 목록에서 게임 음길이(1~64, 점 포함, &로 잇기)로 정확히 쓸 수 없는 길이 목록: 음 길이("n:1/70")와 음 사이 쉼표("r:1/70").
 * 출력기는 이런 길이의 남는 조각을 버리므로(음이 빠지거나 뒤 음이 당겨짐) 편집으로 새로 만들면 안 된다
 */
export function unwritableLengths(notes: Notes, limit: LengthLimit): string[] {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
  const out: string[] = [];
  let pos: Rat = ZERO;
  for (const n of sorted) {
    if (cmp(n.start, pos) > 0) {
      const gap = sub(n.start, pos);
      if (!canWriteExactly(gap, limit)) out.push(`r:${gap.n}/${gap.d}`);
    }
    if (!canWriteExactly(n.dur, limit)) out.push(`n:${n.dur.n}/${n.dur.d}`);
    const end = add(n.start, n.dur);
    if (cmp(end, pos) > 0) pos = end;
  }
  return out;
}

export function unwritableCount(notes: Notes, limit: LengthLimit): number {
  return unwritableLengths(notes, limit).length;
}

/**
 * 곡을 바꾼 결과(after)가 편집 전(before)에 없던 쓸 수 없는 길이를 만든 트랙. 없으면 undefined.
 * 곡 전체의 쓸 수 없는 길이를 길이별로 세어 늘어난 길이가 있으면 그 길이를 가진 트랙(바뀐 트랙 먼저)을 돌려준다.
 * 길이별로 세므로 개수가 같아도 다른 길이로 바뀌면 잡고, 원래 있던 조각을 다른 트랙으로 옮기거나(합치기·나누기)
 * 앞뒤로 밀기만 하면(마디 넣기) 막지 않는다
 */
export function newUnwritableTrack(before: Song, after: Song, limit: LengthLimit): string | undefined {
  const cache = new Map<Notes, string[]>();
  const of = (notes: Notes) => {
    let v = cache.get(notes);
    if (!v) cache.set(notes, (v = unwritableLengths(notes, limit)));
    return v;
  };
  const count = new Map<string, number>();
  for (const tr of before.tracks) for (const k of of(tr.notes)) count.set(k, (count.get(k) ?? 0) + 1);
  const added = new Set<string>();
  for (const tr of after.tracks) {
    for (const k of of(tr.notes)) {
      const left = (count.get(k) ?? 0) - 1;
      count.set(k, left);
      if (left < 0) added.add(k);
    }
  }
  if (added.size === 0) return undefined;
  const old = new Map(before.tracks.map((tr) => [tr.id, tr.notes]));
  const changed = after.tracks.filter((tr) => old.get(tr.id) !== tr.notes);
  const rest = after.tracks.filter((tr) => old.get(tr.id) === tr.notes);
  return [...changed, ...rest].find((tr) => of(tr.notes).some((k) => added.has(k)))?.id;
}
