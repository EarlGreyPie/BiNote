import { add, cmp, mul, rat, sub, ZERO, type Rat } from "./rat.js";
import type { Note, Song } from "./model.js";
import type { PitchRange } from "./profile.js";
import { replaceNotes } from "./note-edit.js";

/**
 * 아르페지오 자동 만들기. 고른 음(한 트랙)에서 화음 칸을 모으고, 화음 음을 순서대로 펼쳐
 * 한 트랙에 넣거나(펼치기), 원래 음을 둔 채 시작만 늦춰 굴려 치거나(굴려 치기),
 * 같은 악보 트랙을 돌아가며 다시 친다(되풀이). 결과만 계산하고 곡은 바꾸지 않는다.
 */

/** 화음 음 가져오기: 같은 시간 음(고른 구간에서 같은 악보 트랙들이 같은 자리에 시작하는 음) / 고른 음만 / 코드 이름 */
export type ArpSource = "together" | "selected" | "chord";
/** 방식: 한 트랙에 펼치기 / 굴려 치기(원래 음을 두고 시작만 늦춤) / 트랙 돌아가며 되풀이(새 음을 만들어 깔기) */
export type ArpStyle = "spread" | "roll" | "strum";
export type ArpOrder = "up" | "down" | "updown" | "random";

/** 코드 종류: 근음에서 쌓는 반음 간격 */
export const CHORD_KINDS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  "7": [0, 4, 7, 10],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  add9: [0, 4, 7, 14],
} as const satisfies Record<string, readonly number[]>;
export type ChordKind = keyof typeof CHORD_KINDS;
export const CHORD_KIND_IDS = Object.keys(CHORD_KINDS) as ChordKind[];

export interface ArpOptions {
  readonly source: ArpSource;
  /** 코드 이름으로 가져올 때 쌓을 종류 */
  readonly chord: ChordKind;
  readonly style: ArpStyle;
  readonly order: ArpOrder;
  /** 음 하나의 길이 (온음표 단위) */
  readonly step: Rat;
  /** 옥타브 넓이 1~3. 2 이상이면 화음 음을 한 옥타브씩 올려(아래로면 내려) 이어 붙인다 */
  readonly octaves: number;
  /** 켜면 칸이 찰 때까지 되풀이, 끄면 한 번만 돌고 마지막 음을 칸 끝까지 늘린다 */
  readonly repeat: boolean;
  /** 펼치기에서 화음 음으로 가져온 다른 트랙 음(같은 시간 음, 다른 트랙에서 고른 음)을 지운다 */
  readonly clearChordTracks: boolean;
  /** 악기가 소리 내는 음역. 넘는 음은 뺀다 */
  readonly range: PitchRange;
  /** 한 악보에 둘 수 있는 트랙 수 (깔기에서 트랙을 더할 한도, maxChordsOf) */
  readonly maxTracks: number;
  /** 잠근 트랙: 화음 음으로 읽기만 하고 바꾸지 않는다 */
  readonly locked?: ReadonlySet<string>;
  /**
   * 같은 시간 음(굴려 치기 포함)에서 화음에 넣을 같은 악보 트랙. 없으면 모두. 고른 트랙은 늘 들어간다.
   * 빠진 트랙은 읽지도 바꾸지도 않는다 (되풀이에서 결과를 놓을 트랙으로도 쓰지 않는다)
   */
  readonly tracks?: ReadonlySet<string>;
  /**
   * 굴려 치기에서 트랙 접기 (실험실): 같은 악보 트랙을 트랙 바 순서로 앞 fold개만 남기고, 넘치는 트랙의 화음 음을 남는 트랙에 넣는다.
   * 한 트랙은 한 번에 한 음이라 처음 음과 마지막 (fold − 1)음은 끝까지 울리고, 사이 음은 같은 트랙의 다음 음 앞에서 끊기는 짧은 음이 된다.
   * 없거나 악보 트랙 수 이상이면 접지 않는다
   */
  readonly fold?: number;
}

/** 화음 칸 하나: 자리, 볼륨, 화음 음 높이(낮은 순), 화음 음으로 가져온 다른 트랙 음 */
export interface ArpCell {
  readonly start: Rat;
  readonly end: Rat;
  readonly vol: number;
  readonly pitches: readonly number[];
  /** 고른 트랙에서 결과로 바뀌는 음 id */
  readonly picked: readonly string[];
  /** 다른 트랙에서 가져온 음 (트랙 id, 음 id) */
  readonly taken: readonly { readonly trackId: string; readonly noteId: string }[];
  /** 칸을 이루는 원래 음 (고른 음과 가져온 음, 트랙 id와 함께). 코드 이름이면 고른 음만 */
  readonly sources: readonly { readonly trackId: string; readonly note: Note }[];
}

export interface ArpResult {
  /** 바꿀 트랙과 바뀐 뒤 음 전체 */
  readonly changes: readonly { readonly trackId: string; readonly notes: readonly Note[] }[];
  /** 같은 악보에 새로 더할 트랙의 음 (더하는 순서대로) */
  readonly newTracks: readonly (readonly Note[])[];
  /** 만들어진 음 수 */
  readonly notes: number;
  /** 화음 음이 하나뿐이라 건너뛴 칸 수 */
  readonly single: number;
  /** 악기 음역을 넘어 뺀 음 수 (칸마다 한 번 돌 때 기준) */
  readonly outOfRange: number;
  /** 잠겨서 바꾸지 않은 트랙 수 */
  readonly lockedSkipped: number;
  /** 깔기에서 트랙 한도에 걸려 돌아가는 트랙 수를 줄였으면 그 한도 */
  readonly trackLimit?: number;
  /** 굴려 치기에서 너무 짧아(늦춘 시작이 음 끝에 닿음) 그대로 둔 음 수 */
  readonly tooShort?: number;
  /** 트랙 접기로 넘치는 음을 남는 트랙에 넣은 칸 수 */
  readonly folded?: number;
  /** 넘치는 트랙에 음이 있지만 접지 못하고 굴려 치기만 한 칸 수 (잠근 트랙, &, 같은 높이 겹침, 너무 짧음, 남는 트랙 하나 이하) */
  readonly foldSkipped?: number;
  /** 접은 뒤 음이 하나도 남지 않는 넘치는 트랙 id (트랙 바에서 지우면 된다) */
  readonly emptied?: readonly string[];
  /** 만들지 않은 칸 수: 되풀이(깔기)는 원래 화음 음이 짧아지게 되어, 펼치기는 새 음이 고른 트랙의 남는 음 안에서 시작해 빠지게 되어 (그 칸의 원래 음은 그대로) */
  readonly cutCells?: number;
  /** cutCells 가운데 고른 음이 한 트랙에 차례로 놓여(같은 시간에 시작하지 않아) 깔기로 원래 음을 지킬 수 없던 칸 수 */
  readonly sequential?: number;
}

const end = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);

/** 칸의 음이 모두 칸 시작에 함께 시작하는 화음인지 (고른 음만으로 차례로 놓인 음은 아니다) */
const together = (cell: Pick<ArpCell, "start" | "sources">) => cell.sources.every((x) => cmp(x.note.start, cell.start) === 0);

/** 화음에 넣는 트랙인지: 고른 트랙은 늘, 나머지는 tracks가 없거나 tracks에 있으면 */
const included = (options: Pick<ArpOptions, "tracks">, trackId: string, id: string) => id === trackId || !options.tracks || options.tracks.has(id);

/**
 * 화음 칸 모으기. 칸마다 화음 음이 둘 이상인 것과, 하나뿐이라 건너뛴 칸 수.
 * 고른 음은 같은 악보 여러 트랙에 있어도 된다 (타브는 화음 음이 줄마다 다른 트랙에 있다). 고른 트랙(trackId) 음은 picked,
 * 다른 트랙 음은 taken으로 칸에 넣는다.
 * - 같은 시간 음: 고른 음의 첫 시작부터 마지막 시작까지, 화음에 넣는 같은 악보 트랙 음이 시작하는 자리마다 칸 하나
 *   (고른 트랙에 그 자리 음이 없어도 칸이 된다)
 * - 고른 음만: 고른 음 전체가 칸 하나. perStart면(굴려 치기) 고른 음이 시작하는 자리마다 칸 하나
 * - 코드 이름: 고른 음이 시작하는 자리마다 칸 하나, 그 자리에서 가장 낮은 고른 음을 근음으로 쌓는다
 */
export function arpCells(
  song: Song,
  trackId: string,
  picked: readonly Note[],
  options: Pick<ArpOptions, "source" | "chord" | "tracks">,
  perStart = false,
): { cells: ArpCell[]; single: number } {
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track || picked.length === 0) return { cells: [], single: 0 };
  const sorted = [...picked].sort((a, b) => cmp(a.start, b.start));
  const uniq = (ps: readonly number[]) => [...new Set(ps)].sort((a, b) => a - b);
  // 고른 음의 트랙: 고른 트랙 먼저, 없으면 같은 악보 다른 트랙 (못 찾으면 고른 트랙 음으로 본다)
  const scoreTracks = [track, ...song.tracks.filter((t) => t.playerId === track.playerId && t.id !== trackId)];
  const owner = new Map<string, string>();
  for (const t of scoreTracks) for (const o of t.notes) if (!owner.has(o.id)) owner.set(o.id, t.id);
  const entry = (note: Note) => ({ trackId: owner.get(note.id) ?? trackId, note });
  /** 원래 음 묶음 하나로 칸 하나 (pitches를 주면 그 높이로) */
  const cellOf = (here: readonly { trackId: string; note: Note }[], pitches?: readonly number[]): ArpCell => {
    const mine = here.filter((x) => x.trackId === trackId);
    const taken = here.filter((x) => x.trackId !== trackId);
    // 칸 끝은 칸 음 가운데 가장 늦게 끝나는 음의 끝 (고른 음보다 긴 화음 음을 자르지 않게)
    const last = here.reduce((m, x) => (cmp(end(x.note), m) > 0 ? end(x.note) : m), end(here[0]!.note));
    return {
      start: here.reduce((m, x) => (cmp(x.note.start, m) < 0 ? x.note.start : m), here[0]!.note.start),
      end: last,
      vol: (mine[0] ?? here[0]!).note.vol,
      pitches: uniq(pitches ?? here.map((x) => x.note.pitch)),
      picked: mine.map((x) => x.note.id),
      taken: taken.map((x) => ({ trackId: x.trackId, noteId: x.note.id })),
      sources: [...mine, ...taken],
    };
  };
  /** 자리마다 그 자리에서 시작하는 음 묶음 */
  const byStart = (entries: readonly { trackId: string; note: Note }[]) => {
    const starts: Rat[] = [];
    for (const x of entries) if (!starts.some((at) => cmp(at, x.note.start) === 0)) starts.push(x.note.start);
    return starts.sort(cmp).map((at) => entries.filter((x) => cmp(x.note.start, at) === 0));
  };
  let cells: ArpCell[];
  if (options.source === "selected") {
    const entries = sorted.map(entry);
    cells = perStart ? byStart(entries).map((here) => cellOf(here)) : [cellOf(entries)];
  } else if (options.source === "chord") {
    const steps = CHORD_KINDS[options.chord];
    cells = byStart(sorted.map(entry)).map((here) => {
      const root = Math.min(...here.map((x) => x.note.pitch));
      return cellOf(here, steps.map((s) => root + s));
    });
  } else {
    // 고른 트랙을 앞에 두고, 화음에 넣는 같은 악보 트랙만
    const same = scoreTracks.filter((t) => included(options, trackId, t.id));
    const from = sorted[0]!.start;
    const to = sorted[sorted.length - 1]!.start;
    const entries = same.flatMap((t) => t.notes.filter((o) => cmp(o.start, from) >= 0 && cmp(o.start, to) <= 0).map((note) => ({ trackId: t.id, note })));
    cells = byStart(entries).map((here) => cellOf(here));
  }
  const kept = cells.filter((c) => c.pitches.length > 1);
  return { cells: kept, single: cells.length - kept.length };
}

/** 칸 자리로 정하는 고정 씨앗 (같은 곡이면 무작위 순서가 늘 같다: 실행 취소·다시 실행에도) */
function seedOf(at: Rat): number {
  let h = 2166136261;
  for (const ch of `${at.n}/${at.d}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed || 1;
  const next = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** 칸 하나에서 한 번 도는 높이 순서와 음역 밖이라 뺀 수 */
export function arpSequence(cell: Pick<ArpCell, "pitches" | "start">, options: Pick<ArpOptions, "order" | "octaves" | "range">): { pitches: number[]; outOfRange: number } {
  const octaves = Math.max(1, Math.min(3, Math.round(options.octaves)));
  const up = Array.from({ length: octaves }, (_, k) => cell.pitches.map((p) => p + 12 * k)).flat();
  const down = Array.from({ length: octaves }, (_, k) => [...cell.pitches].reverse().map((p) => p - 12 * k)).flat();
  const raw = options.order === "down" ? down : up;
  const inRange = raw.filter((p) => p >= options.range.low && p <= options.range.high);
  const outOfRange = raw.length - inRange.length;
  let pitches: number[];
  if (options.order === "updown") pitches = inRange.length > 2 ? [...inRange, ...inRange.slice(1, -1).reverse()] : inRange;
  else if (options.order === "random") pitches = shuffled(inRange, seedOf(cell.start));
  else pitches = inRange;
  return { pitches, outOfRange };
}

/**
 * 칸 [start, end)에 순서대로 놓을 음 자리. 음마다 step씩 늦게 시작하고, 칸 끝을 넘으면 칸 끝에서 자른다.
 * 반복을 끄면 한 번만 돌고 마지막 음을 칸 끝까지 늘린다
 */
export function arpTimes(cell: Pick<ArpCell, "start" | "end">, count: number, step: Rat, repeat: boolean): { start: Rat; dur: Rat; index: number }[] {
  const out: { start: Rat; dur: Rat; index: number }[] = [];
  if (count === 0 || cmp(step, ZERO) <= 0) return out;
  for (let i = 0; ; i++) {
    if (!repeat && i >= count) break;
    const start = add(cell.start, mul(step, rat(i)));
    if (cmp(start, cell.end) >= 0) break;
    const room = sub(cell.end, start);
    const lastOnce = !repeat && i === count - 1;
    out.push({ start, dur: lastOnce || cmp(step, room) > 0 ? room : step, index: i % count });
  }
  return out;
}

/**
 * 결과 음을 다른 음 사이에 끼운다: 다른 음 안(또는 같은 자리)에서 시작하는 결과 음은 빼고,
 * 다른 음과 겹치면 그 음 시작 앞까지만 늘린다 (다른 음은 지우거나 줄이지 않는다)
 */
function fitAround(results: readonly Note[], others: readonly Note[]): Note[] {
  const out: Note[] = [];
  for (const n of results) {
    if (others.some((o) => cmp(o.start, n.start) <= 0 && cmp(n.start, end(o)) < 0)) continue;
    const next = others.filter((o) => cmp(o.start, n.start) > 0).reduce<Rat | undefined>((m, o) => (m === undefined || cmp(o.start, m) < 0 ? o.start : m), undefined);
    out.push(next !== undefined && cmp(end(n), next) > 0 ? { ...n, dur: sub(next, n.start) } : n);
  }
  return out;
}

/**
 * 한 트랙(줄)에 넣을 새 음 전체를 그 트랙에 남는 음 사이에 겹치지 않게 놓는다 (깔기).
 * 남는 음에는 fitAround와 같은 규칙(그 안이나 같은 자리에서 시작하면 빼고, 겹치면 그 앞까지)이고,
 * 새 음끼리는 같은 자리에서 시작하는 뒤 음을 빼고, 앞 음은 다음 새 음 앞에서 끊는다 (줄을 다시 퉁기듯).
 * 남는 음은 지우거나 줄이지 않는다
 */
function layoutLane(added: readonly Note[], others: readonly Note[]): Note[] {
  const sorted = fitAround(added, others).sort((a, b) => cmp(a.start, b.start));
  const starts = sorted.filter((n, i) => i === 0 || cmp(sorted[i - 1]!.start, n.start) !== 0);
  return starts.map((n, i) => {
    const next = starts[i + 1];
    return next && cmp(end(n), next.start) > 0 ? { ...n, dur: sub(next.start, n.start) } : n;
  });
}

/**
 * 지울 음과 넣을 음으로 트랙 음을 바꾼다. 지운 음 바로 앞에서 &로 이어지던 음은 풀어, 결과와 미끄러짐을 새로 만들지 않는다.
 * fit: 넣을 음을 남는 음 사이에 놓는 규칙 (펼치기는 fitAround, 깔기는 layoutLane)
 */
function rewrite(notes: readonly Note[], removed: ReadonlySet<string>, added: readonly Note[], fit: (added: readonly Note[], others: readonly Note[]) => Note[] = fitAround): Note[] {
  const removedNotes = notes.filter((n) => removed.has(n.id));
  const kept = notes.filter((n) => !removed.has(n.id));
  const others = kept.map((n) => (n.tie === "next" && removedNotes.some((r) => cmp(end(n), r.start) === 0) ? { ...n, tie: "none" as const } : n));
  const fitted = fit(added, others);
  const changes = new Map<string, Note | null>([...removedNotes.map((n): [string, null] => [n.id, null]), ...fitted.map((n): [string, Note] => [n.id, n])]);
  return replaceNotes([...others, ...removedNotes], changes);
}

/**
 * 아르페지오 결과. trackId: 고른 트랙, picked: 고른 음(그 트랙 안). newId: 겹치지 않는 새 음 id
 */
export function planArpeggio(song: Song, trackId: string, picked: readonly Note[], options: ArpOptions, newId: () => string): ArpResult {
  const track = song.tracks.find((t) => t.id === trackId);
  const empty: ArpResult = { changes: [], newTracks: [], notes: 0, single: 0, outOfRange: 0, lockedSkipped: 0 };
  if (!track) return empty;
  const locked = options.locked ?? new Set<string>();
  // 굴려 치기는 같은 자리에 함께 시작하는 원래 음을 늦추는 것이라 자리마다 칸을 만든다.
  // 고른 음만이면 고른 음만 늦추고, 코드 이름은 새 음을 만들어야 해서 같은 시간 음으로 모은다
  const roll = options.style === "roll";
  const { cells, single } = arpCells(song, trackId, picked, roll && options.source === "chord" ? { ...options, source: "together" } : options, roll);
  const seqs = cells.map((c) => ({ cell: c, ...arpSequence(c, options) })).filter((s) => s.pitches.length > 0);
  const outOfRange = seqs.reduce((s, x) => s + x.outOfRange, 0);
  const lockedTracks = new Set<string>();
  const note = (start: Rat, dur: Rat, pitch: number, vol: number): Note => ({ id: newId(), start, dur, pitch, vol, tie: "none" });
  /** 새 음: 같은 높이 원래 화음 음이 있으면 그 음의 v와 타브 줄을 이어받는다 (없으면 칸 v, 줄은 타브 자동 배정) */
  const fresh = (cell: ArpCell, start: Rat, dur: Rat, pitch: number, prefer?: string): Note => {
    const same = cell.sources.filter((x) => x.note.pitch === pitch);
    const src = same.find((x) => x.trackId === prefer) ?? same[0];
    const made = note(start, dur, pitch, src?.note.vol ?? cell.vol);
    return src?.note.tabString !== undefined ? { ...made, tabString: src.note.tabString } : made;
  };

  if (options.style === "spread") {
    if (locked.has(trackId)) return { ...empty, single, outOfRange, lockedSkipped: 1 };
    const planned = seqs.map(({ cell, pitches }) => ({
      cell,
      made: arpTimes(cell, pitches.length, options.step, options.repeat).map((t) => fresh(cell, t.start, t.dur, pitches[t.index]!, trackId)),
    }));
    // 한 규칙: 받아들인 칸 전체로 고른 트랙의 최종 음(rewrite 결과)을 먼저 만들고, 그 최종 음에서 칸마다 본다.
    // 칸의 새 음이 하나도 남지 않거나, 지울 화음 트랙 음의 높이가 그 칸의 남은 새 음에 없으면 그 칸은 만들지 않는다
    // (그 칸의 고른 음·화음 트랙 음도 지우지 않는다). 칸을 빼면 최종 음이 달라지니 그런 칸이 없을 때까지 다시 만든다.
    // 칸이 하나씩 빠지므로 칸 수만큼 돌면 끝난다
    const clearing = options.clearChordTracks;
    let accepted = planned;
    let finalNotes: Note[] = [];
    let survived = new Set<string>();
    for (;;) {
      const removedNow = new Set(accepted.flatMap((p) => p.cell.picked));
      finalNotes = rewrite(track.notes, removedNow, accepted.flatMap((p) => p.made));
      survived = new Set(finalNotes.filter((n) => cmp(n.dur, ZERO) > 0).map((n) => n.id));
      const failed = accepted.find((p) => {
        const kept = p.made.filter((n) => survived.has(n.id));
        if (kept.length === 0) return true;
        if (!clearing) return false;
        const pitches = new Set(kept.map((n) => finalNotes.find((f) => f.id === n.id)!.pitch));
        return p.cell.sources.some((x) => x.trackId !== trackId && !locked.has(x.trackId) && !pitches.has(x.note.pitch));
      });
      if (!failed) break;
      accepted = accepted.filter((p) => p !== failed);
    }
    // 알리는 음 수는 최종 음에 실제로 남은 새 음
    const placedCount = accepted.reduce((sum, p) => sum + p.made.filter((n) => survived.has(n.id)).length, 0);
    const cutCells = planned.length - accepted.length;
    const changes: { trackId: string; notes: Note[] }[] = accepted.length > 0 ? [{ trackId, notes: finalNotes }] : [];
    if (clearing) {
      const byTrack = new Map<string, Set<string>>();
      for (const { cell } of accepted) for (const x of cell.taken) byTrack.set(x.trackId, (byTrack.get(x.trackId) ?? new Set()).add(x.noteId));
      for (const [id, ids] of byTrack) {
        if (locked.has(id)) {
          lockedTracks.add(id);
          continue;
        }
        const other = song.tracks.find((t) => t.id === id)!;
        changes.push({ trackId: id, notes: rewrite(other.notes, ids, []) });
      }
    }
    return { changes, newTracks: [], notes: placedCount, single, outOfRange, lockedSkipped: lockedTracks.size, ...(cutCells > 0 ? { cutCells } : {}) };
  }

  // 굴려 치기 (기타 물결선 화음): 음을 새로 만들지 않고 원래 음을 제자리(트랙·id·v·줄·&)에 둔 채 시작만 순서대로 늦춘다.
  // 끝은 원래 끝 그대로. 옥타브 넓이·반복은 쓰지 않는다
  if (options.style === "roll") return rollChord(song, trackId, cells, single, options);

  // 되풀이(깔기): 같은 악보 트랙을 고른 트랙부터 돌아가며 쓴다 (잠근 트랙은 건너뛴다).
  // 같은 시간 음에서 화음에 넣지 않은 트랙은 읽지도 쓰지도 않는다
  const same = song.tracks.filter((t) => t.playerId === track.playerId && (options.source !== "together" || included(options, trackId, t.id)));
  const from = same.findIndex((t) => t.id === trackId);
  const rotated = [...same.slice(from), ...same.slice(0, from)];
  for (const t of rotated) if (locked.has(t.id)) lockedTracks.add(t.id);
  const usable = rotated.filter((t) => !locked.has(t.id));
  // 돌아가는 트랙 수: 한 번 도는 음 수와 트랙 한도 중 작은 것. 모자라면 같은 악보에 트랙을 더한다
  const need = Math.max(0, ...seqs.map((s) => s.pitches.length));
  const want = Math.min(need, options.maxTracks);
  // 더할 수 있는 트랙 수는 악보 전체 트랙 수로 센다 (화음에서 뺀 트랙도 악보 한도를 차지한다)
  const scoreTracks = song.tracks.filter((t) => t.playerId === track.playerId).length;
  const room = Math.max(0, options.maxTracks - scoreTracks);
  const extra = Math.max(0, Math.min(want - usable.length, room));
  const lanes = Math.min(want, usable.length + extra);
  if (lanes === 0) return { ...empty, single, outOfRange, lockedSkipped: lockedTracks.size };
  const laneTrack = (lane: number) => usable[lane]?.id;
  let count = 0;
  /** 칸마다 놓을 음(줄과 함께)과 지울 원래 음 */
  const plans: { cell: ArpCell; made: { lane: number; note: Note }[]; removes: { trackId: string; noteId: string }[] }[] = [];
  for (const { cell, pitches } of seqs) {
    const times = arpTimes(cell, pitches.length, options.step, options.repeat);
    // 첫 바퀴에서 원래 화음 음과 같은 높이는 그 음이 있던 트랙(줄)을 먼저 쓴다 (멜로디·베이스 트랙이 뒤바뀌지 않게).
    // 다음 바퀴는 같은 줄을 되풀이한다
    const order: number[] = [];
    const free = new Set(Array.from({ length: lanes }, (_, i) => i));
    for (let i = 0; i < Math.min(lanes, times.length); i++) {
      const pitch = pitches[times[i]!.index]!;
      const home = cell.sources.find((x) => x.note.pitch === pitch && !locked.has(x.trackId));
      const lane = home ? usable.findIndex((t) => t.id === home.trackId) : -1;
      if (lane >= 0 && free.has(lane) && !order.includes(lane)) {
        order[i] = lane;
        free.delete(lane);
      }
    }
    for (let i = 0; i < Math.min(lanes, times.length); i++) {
      if (order[i] !== undefined) continue;
      const lane = [...free][0]!;
      order[i] = lane;
      free.delete(lane);
    }
    const made = times.map((t, i) => {
      // 같은 줄의 다음 음이 오면 그 앞에서 끊긴다 (줄을 다시 퉁기듯). 아니면 칸 끝까지 끌어 둔다
      const again = times[i + lanes];
      const stop = again ? again.start : cell.end;
      const lane = order[i % lanes]!;
      return { lane, note: fresh(cell, t.start, sub(stop, t.start), pitches[t.index]!, laneTrack(lane)) };
    });
    // 잠근 트랙의 음은 고른 트랙의 음이라도 지우지 않는다
    const removes = [...(locked.has(trackId) ? [] : cell.picked.map((noteId) => ({ trackId, noteId }))), ...cell.taken.filter((x) => !locked.has(x.trackId))];
    plans.push({ cell, made, removes });
  }
  // 원래 화음 음(잠그지 않은 것)은 모든 칸을 합친 최종 배치에서 같은 트랙에 같은 높이로, 원래 음이 끝나기 전에 시작해 원래 끝까지 울려야 한다.
  // 1) 받아들일 칸의 새 음과 지울 음을 모으고, 2) 기존 트랙·새 트랙 모두 같은 규칙(layoutLane)으로 트랙마다 최종 음을 만들고,
  // 3) 그 최종 음에서 원래 음 보호를 검사한다. 4) 못 지키는 칸이 있으면 첫 칸(원래 음 지우기 포함)을 빼고 다시 계산한다.
  // 칸이 하나씩 빠지므로 칸 수만큼 돌면 끝난다
  type Plan = (typeof plans)[number];
  const layout = (accepted: readonly Plan[]) => {
    const removed = new Map<string, Set<string>>();
    for (const p of accepted) for (const x of p.removes) removed.set(x.trackId, (removed.get(x.trackId) ?? new Set()).add(x.noteId));
    /** 줄마다 최종 배치에 놓인 새 음 (id로 찾는다) */
    const placed = new Map<string, Note>();
    const lanesOut: Note[][] = Array.from({ length: lanes }, (_, lane) => {
      const added = accepted.flatMap((p) => p.made.filter((m) => m.lane === lane).map((m) => m.note));
      const id = laneTrack(lane);
      const gone = id === undefined ? undefined : removed.get(id);
      const others = id === undefined ? [] : song.tracks.find((t) => t.id === id)!.notes.filter((n) => !gone?.has(n.id));
      const fitted = layoutLane(added, others);
      for (const n of fitted) placed.set(n.id, n);
      return fitted;
    });
    return { removed, placed, lanesOut };
  };
  const keeps = (p: Plan, placed: ReadonlyMap<string, Note>) =>
    p.cell.sources.every(
      (x) =>
        locked.has(x.trackId) ||
        p.made.some((m) => {
          const n = placed.get(m.note.id);
          // 늦게 퉁겨도 원래 음이 끝나기 전에 시작해 원래 끝까지 울려야 한다 (원래 음이 끝난 뒤에 시작하면 그 사이 소리가 빈다)
          return n !== undefined && laneTrack(m.lane) === x.trackId && n.pitch === x.note.pitch && cmp(n.start, end(x.note)) < 0 && cmp(end(n), end(x.note)) >= 0;
        }),
    );
  let accepted: Plan[] = plans;
  let final = layout(accepted);
  for (;;) {
    const failed = accepted.find((p) => !keeps(p, final.placed));
    if (!failed) break;
    accepted = accepted.filter((p) => p !== failed);
    final = layout(accepted);
  }
  const cutCells = plans.length - accepted.length;
  const sequential = plans.filter((p) => !accepted.includes(p) && !together(p.cell)).length;
  // 알리는 음 수는 최종 배치에 실제로 들어간 새 음
  count = final.placed.size;
  const changes: { trackId: string; notes: Note[] }[] = [];
  const touched = new Set<string>([...usable.slice(0, lanes).map((t) => t.id), ...final.removed.keys()]);
  for (const id of touched) {
    const t = song.tracks.find((x) => x.id === id)!;
    const lane = usable.findIndex((x) => x.id === id);
    const added = lane >= 0 && lane < lanes ? final.lanesOut[lane]! : [];
    // 이미 최종 배치로 놓은 음이라 그대로 넣는다
    changes.push({ trackId: id, notes: rewrite(t.notes, final.removed.get(id) ?? new Set(), added, (a) => [...a]) });
  }
  // 새 트랙도 같은 규칙으로 놓은 음. 취소된 칸만 쓰던 새 트랙은 더하지 않는다 (빈 트랙이 생기지 않게)
  const newTracks = final.lanesOut.slice(usable.length);
  while (newTracks.length > 0 && newTracks[newTracks.length - 1]!.length === 0) newTracks.pop();
  return {
    changes,
    newTracks,
    notes: count,
    single,
    outOfRange,
    lockedSkipped: lockedTracks.size,
    // 한 번 도는 음보다 트랙이 적으면 앞 음이 일찍 끊긴다
    ...(lanes < need ? { trackLimit: options.maxTracks } : {}),
    ...(cutCells > 0 ? { cutCells } : {}),
    ...(sequential > 0 ? { sequential } : {}),
  };
}

/**
 * 굴려 치기: 칸마다 순서(위로 = 낮은 음부터, 아래로 = 높은 음부터)대로 k번째 높이의 원래 음 시작을 칸 시작 + k × step으로 늦춘다.
 * 끝은 원래 끝 그대로, 트랙·id·v·타브 줄·&도 그대로다. 같은 높이가 여러 트랙에 있으면 모두 같은 자리로.
 * 잠근 트랙 음은 두고 그 순서 자리는 비워 둔다(다른 음을 당기지 않는다). 늦춘 시작이 음 끝에 닿으면 그대로 두고 센다.
 * fold가 있으면 넘치는 트랙에 음이 있는 칸을 접는다 (foldCell)
 */
function rollChord(song: Song, trackId: string, cells: readonly ArpCell[], single: number, options: ArpOptions): ArpResult {
  const locked = options.locked ?? new Set<string>();
  /** 트랙마다 바꿀 음 (null이면 그 트랙에서 뺀다) */
  const moved = new Map<string, Map<string, Note | null>>();
  const put = (id: string, noteId: string, note: Note | null) => moved.set(id, (moved.get(id) ?? new Map<string, Note | null>()).set(noteId, note));
  const lockedTracks = new Set<string>();
  const playerId = song.tracks.find((t) => t.id === trackId)?.playerId;
  const score = song.tracks.filter((t) => t.playerId === playerId);
  const fold = options.fold !== undefined && options.fold >= 1 && options.fold < score.length ? options.fold : undefined;
  const kept = new Set(score.slice(0, fold ?? score.length).map((t) => t.id));
  let count = 0;
  let tooShort = 0;
  let folded = 0;
  let foldSkipped = 0;
  for (const cell of cells) {
    // 있는 음을 옮기므로 음역으로 빼지 않는다. 위아래·무작위도 높이마다 한 자리 (처음 나온 차례)
    const { pitches } = arpSequence(cell, { ...options, octaves: 1, range: { low: 0, high: 127 } });
    const slot = [...new Set(pitches)];
    const at = (pitch: number) => add(cell.start, mul(options.step, rat(slot.indexOf(pitch))));
    if (fold !== undefined && cell.sources.some((x) => !kept.has(x.trackId))) {
      const plan = foldCell(song, cell, at, kept, locked);
      if (plan) {
        for (const x of plan) {
          if (x.lane !== x.trackId) put(x.trackId, x.note.id, null);
          put(x.lane, x.note.id, x.note);
        }
        count += plan.length;
        folded++;
        continue;
      }
      foldSkipped++;
    }
    for (const { trackId: id, note: n } of cell.sources) {
      if (locked.has(id)) {
        lockedTracks.add(id);
        continue;
      }
      const start = at(n.pitch);
      if (cmp(start, n.start) <= 0) continue;
      if (cmp(start, end(n)) >= 0) {
        tooShort++;
        continue;
      }
      put(id, n.id, { ...n, start, dur: sub(end(n), start) });
      count++;
    }
  }
  const changes = [...moved].map(([id, byId]) => ({ trackId: id, notes: replaceNotes(song.tracks.find((t) => t.id === id)!.notes, byId) }));
  const emptied = score.filter((t) => !kept.has(t.id) && t.notes.length > 0 && changes.some((c) => c.trackId === t.id && c.notes.length === 0)).map((t) => t.id);
  const outOfRange = 0;
  return {
    changes,
    newTracks: [],
    notes: count,
    single,
    outOfRange,
    lockedSkipped: lockedTracks.size,
    ...(tooShort > 0 ? { tooShort } : {}),
    ...(folded > 0 ? { folded } : {}),
    ...(foldSkipped > 0 ? { foldSkipped } : {}),
    ...(emptied.length > 0 ? { emptied } : {}),
  };
}

/**
 * 트랙 접기 칸 하나: 칸의 음을 남는 트랙(kept, 이 칸에 음이 있는 트랙)만으로 굴려 친다. 남는 트랙 수를 L이라 하면
 * 순서상 처음 음과 마지막 L − 1음은 끝까지 울리고(원래 끝, 놓인 트랙의 다음 음 앞까지), 사이 음은 같은 트랙의 다음 음 시작에서 끊긴다.
 * 남는 트랙의 음은 끝까지 울리면 제 트랙에 그대로 두고, 넘치는 트랙 음이 끝까지 울릴 자리는 사이 음이 된 남는 트랙에 준다.
 * 사이 음은 제 트랙(처음 음 트랙이 아니면)에, 아니면 사이 음이 적은 트랙부터 넣는다.
 * 잠근 트랙 음, &로 이어진 음, 같은 높이 겹침, 늦춘 시작이 음 끝에 닿는 음이 있거나, 남는 트랙이 하나 이하이거나,
 * 놓을 음이 그 트랙의 다음 음 시작 뒤에 오면 접지 않는다 (undefined)
 */
function foldCell(
  song: Song,
  cell: ArpCell,
  at: (pitch: number) => Rat,
  kept: ReadonlySet<string>,
  locked: ReadonlySet<string>,
): { trackId: string; lane: string; note: Note }[] | undefined {
  const notesOf = (id: string) => song.tracks.find((t) => t.id === id)?.notes ?? [];
  const tiedInto = (id: string, n: Note) => notesOf(id).some((o) => o.tie === "next" && cmp(end(o), n.start) === 0);
  const entries = [...cell.sources].sort((a, b) => cmp(at(a.note.pitch), at(b.note.pitch)));
  if (entries.some((x) => locked.has(x.trackId) || x.note.tie !== "none" || tiedInto(x.trackId, x.note) || cmp(at(x.note.pitch), end(x.note)) >= 0)) return undefined;
  if (new Set(entries.map((x) => x.note.pitch)).size !== entries.length) return undefined;
  const lanes = entries.filter((x) => kept.has(x.trackId)).map((x) => x.trackId);
  if (new Set(lanes).size !== lanes.length || lanes.length < 2) return undefined;
  const L = lanes.length;
  const pos = new Map(entries.map((x, i) => [x, i]));
  // 끝까지 울릴 음: 처음 음, 가장 낮은 음(베이스는 끊기면 아래가 빈다), 그리고 뒤에서부터 L개가 찰 때까지
  const lowest = entries.reduce((m, x) => (x.note.pitch < m.note.pitch ? x : m), entries[0]!);
  const sustained = new Set([entries[0]!, lowest]);
  for (let i = entries.length - 1; sustained.size < L; i--) sustained.add(entries[i]!);
  const laneOf = new Map<(typeof entries)[number], string>();
  for (const x of entries) if (sustained.has(x) && kept.has(x.trackId)) laneOf.set(x, x.trackId);
  // 넘치는 트랙의 끝까지 울릴 음은 사이 음이 된 남는 트랙에: 늦게 울리는 음일수록 제 음이 이른 트랙에 (제 음이 앞에서 끊기게)
  const free = entries.filter((x) => kept.has(x.trackId) && !sustained.has(x)).map((x) => x.trackId);
  entries
    .filter((x) => sustained.has(x) && !kept.has(x.trackId))
    .reverse()
    .forEach((x, i) => laneOf.set(x, free[i]!));
  /** 트랙에서 끝까지 울리는 음의 차례 */
  const lastAt = new Map([...laneOf].map(([x, lane]) => [lane, pos.get(x)!]));
  const load = new Map(lanes.map((id) => [id, 0]));
  // 사이 음은 끝까지 울리는 음이 더 늦게 오는 트랙에만 (그 음 앞에서 끊긴다). 남는 트랙의 사이 음은 제 트랙에 먼저
  for (const x of entries) {
    if (sustained.has(x)) continue;
    const ok = lanes.filter((id) => lastAt.get(id)! > pos.get(x)!);
    if (ok.length === 0) return undefined;
    const lane = ok.includes(x.trackId) ? x.trackId : ok.reduce((m, id) => (load.get(id)! < load.get(m)! ? id : m), ok[0]!);
    laneOf.set(x, lane);
    load.set(lane, load.get(lane)! + 1);
  }
  const ids = new Set(entries.map((x) => x.note.id));
  const out: { trackId: string; lane: string; note: Note }[] = [];
  for (const lane of lanes) {
    const mine = entries.filter((x) => laneOf.get(x) === lane);
    // 이 트랙에서 칸 뒤에 오는 첫 음 (칸 음은 빼고): 끝까지 울리는 음도 그 앞에서 끊는다
    const after = notesOf(lane)
      .filter((o) => !ids.has(o.id) && cmp(o.start, cell.start) > 0)
      .reduce<Rat | undefined>((m, o) => (m === undefined || cmp(o.start, m) < 0 ? o.start : m), undefined);
    // 이 트랙의 다음 음이 칸 음보다 먼저 오면 덮게 되니 접지 않는다
    if (after !== undefined && mine.some((x) => cmp(at(x.note.pitch), after) >= 0)) return undefined;
    mine.forEach((x, i) => {
      const start = at(x.note.pitch);
      const next = mine[i + 1];
      let stop = end(x.note);
      if (next && cmp(at(next.note.pitch), stop) < 0) stop = at(next.note.pitch);
      if (!next && after !== undefined && cmp(after, stop) < 0) stop = after;
      const dur = sub(stop, start);
      if (lane === x.trackId && cmp(start, x.note.start) === 0 && cmp(dur, x.note.dur) === 0) return;
      out.push({ trackId: x.trackId, lane, note: { ...x.note, start, dur } });
    });
  }
  return out;
}
