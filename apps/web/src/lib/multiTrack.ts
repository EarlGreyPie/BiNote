import { add, clipLayers, cmp, pasteClip, placeLoss, removeNotes, replaceNotes, toFloat, type Note, type NoteClip, type PlaceLoss, type Rat } from "@mmlce/core";

/**
 * 피아노롤에서 여러 트랙을 함께 고르기 (구간의 모든 트랙 음). 고르기·복사·붙여넣기 계산만 하고 곡은 바꾸지 않는다.
 * 고른 음은 트랙마다 다른 트랙이라 화음으로 겹쳐도 되고, 붙일 때는 층을 복사해 온 제 트랙에 다시 넣는다
 */

interface TrackNotes {
  readonly id: string;
  readonly notes: readonly Note[];
}

/** [from, to) 안에서 시작하는 음 id (화면 위치, 온음표 단위 소수). 트랙과 높이는 보지 않는다 */
export function idsInRange(tracks: readonly TrackNotes[], from: number, to: number): Set<string> {
  const out = new Set<string>();
  for (const t of tracks) for (const n of t.notes) if (toFloat(n.start) >= from && toFloat(n.start) < to) out.add(n.id);
  return out;
}

/** 고른 음을 트랙 나눔 그대로 복사한다. 층마다 트랙 id를 단다. 고른 음이 없으면 undefined */
export function clipTracks(tracks: readonly TrackNotes[], ids: ReadonlySet<string>): NoteClip | undefined {
  const picked = tracks.map((t) => ({ id: t.id, notes: t.notes.filter((n) => ids.has(n.id)) })).filter((t) => t.notes.length > 0);
  const clip = clipLayers(picked.map((t) => t.notes));
  if (!clip) return undefined;
  // 층이 하나면 clipLayers가 layers를 달지 않는다. 그래도 트랙 id를 달아 제 트랙에 붙게 한다
  return { ...clip, layers: clip.layers ?? [clip.notes], trackIds: picked.map((t) => t.id) };
}

export interface TracksPaste {
  /** 트랙마다 붙인 뒤 음 전체 */
  readonly changes: readonly { readonly trackId: string; readonly notes: readonly Note[] }[];
  /** 붙인 음 id */
  readonly pasted: ReadonlySet<string>;
  /** 붙이면서 잘리거나 지워질 원래 음 (모든 트랙) */
  readonly loss: PlaceLoss;
  /** 붙인 끝 위치 */
  readonly end: Rat;
}

/**
 * 트랙 id가 달린 복사본을 at에 붙인다 (층마다 제 트랙에). 복사해 온 트랙이 하나라도 없으면 undefined
 * (지운 트랙의 음을 다른 트랙에 몰래 넣지 않는다)
 */
export function pasteTracks(tracks: readonly TrackNotes[], clip: NoteClip, at: Rat, newId: () => string): TracksPaste | undefined {
  const ids = clip.trackIds;
  const layers = clip.layers ?? [clip.notes];
  if (!ids || ids.length !== layers.length) return undefined;
  const changes: { trackId: string; notes: Note[] }[] = [];
  const pasted = new Set<string>();
  const cut = new Map<string, Rat>();
  const removed = new Set<string>();
  for (let k = 0; k < ids.length; k++) {
    const track = tracks.find((t) => t.id === ids[k]);
    if (!track) return undefined;
    const notes = pasteClip({ notes: layers[k]!, origin: clip.origin, length: clip.length }, at, newId);
    const map = new Map<string, Note | null>(notes.map((n) => [n.id, n]));
    const loss = placeLoss(track.notes, map);
    for (const [id, d] of loss.cut) cut.set(id, d);
    for (const id of loss.removed) removed.add(id);
    changes.push({ trackId: track.id, notes: replaceNotes(track.notes, map) });
    for (const n of notes) pasted.add(n.id);
  }
  return { changes, pasted, loss: { cut, removed }, end: add(at, clip.length) };
}

/** 고른 음을 트랙마다 지운 결과 (고른 음이 없는 트랙은 뺀다). 남은 & 사슬은 removeNotes로 정리한다 (첫 음을 지우면 남은 음 볼륨, 끊긴 &) */
export function removeFromTracks(tracks: readonly TrackNotes[], ids: ReadonlySet<string>): { trackId: string; notes: Note[] }[] {
  return tracks
    .filter((t) => t.notes.some((n) => ids.has(n.id)))
    .map((t) => ({ trackId: t.id, notes: removeNotes(t.notes, ids) }));
}

const end = (n: Note): Rat => add(n.start, n.dur);

/** 고른 음이 걸친 시간 [첫 시작, 마지막 끝] (화면 위치). 없으면 undefined */
export function spanOf(notes: readonly Note[]): [number, number] | undefined {
  if (notes.length === 0) return undefined;
  let a = notes[0]!.start;
  let b = end(notes[0]!);
  for (const n of notes) {
    if (cmp(n.start, a) < 0) a = n.start;
    if (cmp(end(n), b) > 0) b = end(n);
  }
  return [toFloat(a), toFloat(b)];
}
