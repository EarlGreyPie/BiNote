import { add, cmp, glueNotes, replaceNotes, scaleNotesIn, toggleTie, type Note, type Rat, type TabTuning } from "@mmlce/core";

/**
 * 타브에서 고른 음 다루기. 타브는 한 악보의 보이는 트랙을 모두 함께 그리므로, 고른 음은 여러 트랙에 걸친다.
 * 여기 함수는 트랙마다 바뀐 음 목록(changes)을 돌려주고, 바꿀 것이 없거나 못 하면 undefined를 돌려준다
 * (한 명령 = 실행 취소 한 번이므로 부르는 쪽이 changes를 한꺼번에 넣는다)
 */

export interface TabTrack {
  readonly id: string;
  readonly notes: readonly Note[];
}

export type TrackChanges = { trackId: string; notes: Note[] }[];

/**
 * 고르기 범위: 시작 자리(anchor)와 커서 자리(head)를 모두 넣는 시간 범위 [from, to). 칸은 격자 한 칸(cell).
 * 커서 칸도 범위에 든다 (기타 프로처럼 커서가 지나간 박을 모두 고른다)
 */
export function selectionRange(anchor: Rat, head: Rat, cell: Rat): [Rat, Rat] {
  const [from, last] = cmp(anchor, head) <= 0 ? [anchor, head] : [head, anchor];
  return [from, add(last, cell)];
}

/** [from, to) 안에서 시작하는 음 id (줄·트랙과 상관없이 세로 한 칸 전체) */
export function notesInRange(tracks: readonly TabTrack[], from: Rat, to: Rat): Set<string> {
  const out = new Set<string>();
  for (const t of tracks) for (const n of t.notes) if (cmp(n.start, from) >= 0 && cmp(n.start, to) < 0) out.add(n.id);
  return out;
}

/** 고른 음 가운데 아직 곡에 있는 것만 (곡이 바뀌어 사라진 음은 뺀다). 바뀐 것이 없으면 같은 Set */
export function pruneSelection(selected: ReadonlySet<string>, tracks: readonly TabTrack[]): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const alive = new Set(tracks.flatMap((t) => t.notes.map((n) => n.id)));
  return [...selected].every((id) => alive.has(id)) ? selected : new Set([...selected].filter((id) => alive.has(id)));
}

/** 이 줄(1 = 가장 높은 줄)에서 이 높이를 칠 수 있는지 */
export function playableOn(tuning: TabTuning, string: number, pitch: number): boolean {
  const open = tuning.strings[string - 1];
  if (open === undefined) return false;
  const fret = pitch - open - tuning.capo;
  return fret >= 0 && fret <= tuning.maxFret;
}

/**
 * 고른 음마다 change를 적용한다 (null이면 지운다). 높이가 바뀌어 적어 둔 줄(tabString)에서 칠 수 없게 되면
 * 줄을 지워 타브가 다시 고르게 한다 (지판 밖이면 칠 수 없는 음으로 남는다. 음을 지우지 않는다)
 */
export function editPicked(tracks: readonly TabTrack[], ids: ReadonlySet<string>, change: (n: Note) => Note | null, tuning?: TabTuning): TrackChanges {
  const out: TrackChanges = [];
  for (const t of tracks) {
    const changes = new Map<string, Note | null>();
    for (const n of t.notes) {
      if (!ids.has(n.id)) continue;
      let next = change(n);
      if (next && tuning && next.pitch !== n.pitch && next.tabString !== undefined && !playableOn(tuning, next.tabString, next.pitch)) {
        const { tabString: _s, ...rest } = next;
        next = rest;
      }
      if (next !== n) changes.set(n.id, next);
    }
    if (changes.size > 0) out.push({ trackId: t.id, notes: replaceNotes(t.notes, changes) });
  }
  return out;
}

/**
 * 고른 음 길이 ×factor (피아노롤과 같은 scaleNotesIn 규칙, 트랙마다). 모든 트랙이 고른 음 가운데 가장 앞 음을 기준으로 해
 * 화음의 리듬이 어긋나지 않는다. 어느 트랙이든 자리가 없으면 아무것도 바꾸지 않는다(undefined).
 * exact면 다음 음 앞에서 잘려야 하는 음이 있어도 바꾸지 않는다 (점 붙이기)
 */
export function scalePicked(tracks: readonly TabTrack[], ids: ReadonlySet<string>, factor: Rat, exact = false): TrackChanges | undefined {
  const picked = tracks.map((t) => ({ t, notes: t.notes.filter((n) => ids.has(n.id)) })).filter((x) => x.notes.length > 0);
  if (picked.length === 0) return undefined;
  const origin = picked.flatMap((x) => x.notes).reduce((m, n) => (cmp(n.start, m) < 0 ? n.start : m), picked[0]!.notes[0]!.start);
  const out: TrackChanges = [];
  for (const { t, notes } of picked) {
    const scaled = scaleNotesIn(t.notes, notes, factor, origin, exact);
    if (!scaled) {
      // 이 트랙은 바뀌는 것이 없을 수도 있다 (모두 자리가 없어 그대로). 다른 트랙만 바뀌면 리듬이 어긋나므로 통째로 그만둔다
      return undefined;
    }
    out.push({ trackId: t.id, notes: replaceNotes(t.notes, new Map(scaled.map((n) => [n.id, n]))) });
  }
  return out;
}

/** 고른 음을 다음 음과 &로 잇거나 푼다 (피아노롤 tieSelected와 같게, 트랙마다). 하나도 못 바꾸면 undefined */
export function tiePicked(tracks: readonly TabTrack[], ids: ReadonlySet<string>): TrackChanges | undefined {
  const out: TrackChanges = [];
  for (const t of tracks) {
    let notes: Note[] = [...t.notes];
    let changed = false;
    for (const n of [...t.notes].filter((x) => ids.has(x.id)).sort((a, b) => cmp(a.start, b.start))) {
      const next = toggleTie(notes, n.id);
      if (next) {
        notes = next;
        changed = true;
      }
    }
    if (changed) out.push({ trackId: t.id, notes });
  }
  return out.length > 0 ? out : undefined;
}

/** 고른 음 가운데 같은 트랙에서 높이가 같고 맞닿은 음을 붙인다 (트랙마다 glueNotes). 남은 음 id도 돌려준다 */
export function gluePicked(tracks: readonly TabTrack[], ids: ReadonlySet<string>): { changes: TrackChanges; kept: Set<string> } | undefined {
  const changes: TrackChanges = [];
  const kept = new Set<string>();
  for (const t of tracks) {
    const done = glueNotes(t.notes, ids);
    if (!done) {
      for (const n of t.notes) if (ids.has(n.id)) kept.add(n.id);
      continue;
    }
    changes.push({ trackId: t.id, notes: done[0] });
    for (const n of done[1]) kept.add(n.id);
  }
  return changes.length > 0 ? { changes, kept } : undefined;
}

const overlaps = (a: readonly Note[], b: readonly Note[]) =>
  a.some((x) => b.some((y) => cmp(x.start, add(y.start, y.dur)) < 0 && cmp(y.start, add(x.start, x.dur)) < 0));

/**
 * 붙일 층(layers, 이미 붙일 자리로 옮긴 음)을 악보의 트랙(tracks, 보이는 트랙 순서)에 놓는다.
 * 층 k는 k번째 트랙에 먼저 넣고, 그 트랙에 겹치는 음이 있으면 placeTabNote처럼 다른 빈 트랙을 찾는다(잠근 트랙은 빼고).
 * 없으면 새 트랙을 room개까지 더한다 (added: 새 트랙마다 음). 하나라도 못 넣으면 아무것도 붙이지 않는다(undefined).
 * 있던 음은 지우거나 자르지 않는다
 */
export function placeLayers(
  tracks: readonly TabTrack[],
  layers: readonly (readonly Note[])[],
  room: number,
  locked?: ReadonlySet<string>,
): { changes: TrackChanges; added: Note[][] } | undefined {
  const current = new Map(tracks.map((t) => [t.id, [...t.notes]]));
  const touched = new Set<string>();
  const added: Note[][] = [];
  for (const [k, layer] of layers.entries()) {
    if (layer.length === 0) continue;
    const first = tracks[k];
    const order = [...(first ? [first] : []), ...tracks.filter((t) => t !== first)].filter((t) => !locked?.has(t.id));
    const target = order.find((t) => !overlaps(current.get(t.id)!, layer));
    if (target) {
      current.set(target.id, [...current.get(target.id)!, ...layer]);
      touched.add(target.id);
      continue;
    }
    const fresh = added.find((notes) => !overlaps(notes, layer));
    if (fresh) fresh.push(...layer);
    else if (added.length < room) added.push([...layer]);
    else return undefined;
  }
  const changes: TrackChanges = tracks
    .filter((t) => touched.has(t.id))
    .map((t) => {
      const fresh = current.get(t.id)!.filter((n) => !t.notes.includes(n));
      return { trackId: t.id, notes: replaceNotes(t.notes, new Map(fresh.map((n) => [n.id, n]))) };
    });
  return { changes, added: added.map((notes) => [...notes].sort((a, b) => cmp(a.start, b.start))) };
}

/**
 * 타브에서 ↑/↓ 키를 앱 명령으로 넘길지. 고른 음이 있고 그 키가 앱의 옥타브 명령(키 설정을 따름, 기본 Shift+↑/↓)에
 * 묶여 있으면 피아노롤처럼 옥타브를 바꾼다. 아니면 타브가 커서를 줄 방향으로 옮긴다 (고르기가 없을 때는 지금처럼)
 */
export function arrowGoesToApp(key: string, hasSelection: boolean, octaveKey: boolean): boolean {
  return (key === "ArrowUp" || key === "ArrowDown") && hasSelection && octaveKey;
}
