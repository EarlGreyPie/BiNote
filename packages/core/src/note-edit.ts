import { add, cmp, div, mul, sub, type Rat } from "./rat.js";
import type { Note } from "./model.js";

/**
 * 한 트랙 안의 음 편집. 트랙은 동시에 한 음만 내므로, 넣거나 옮긴 음과 겹치는 음은
 * 앞 음이면 끝을 잘라 내고, 그 안에 들어오는 음은 지운다. 결과는 늘 시작 순이다.
 */
function end(n: Note): Rat {
  return add(n.start, n.dur);
}

/**
 * 시작 순으로 놓고, 바로 뒤에 붙은 음이 없는 &는 푼다.
 * before(편집 전 음)를 주면, & 사슬 가운데에 있다가 사슬이 끊겨 새로 소리를 내게 된 음은
 * 그 사슬 첫 음의 v를 받는다 (&로 이은 음은 첫 음 v로 울렸으므로, 적혀 있던 v로 바뀌어 들리지 않게. splitNote와 같은 규칙)
 * explicitVol(호출하는 쪽이 볼륨을 일부러 정한 음 id)에 든 음은 이 보정을 받지 않는다. 명시한 볼륨이 사슬 보정보다 우선한다
 */
function tidy(notes: readonly Note[], before?: readonly Note[], explicitVol?: ReadonlySet<string>): Note[] {
  const out = [...notes].sort((a, b) => cmp(a.start, b.start));
  for (let i = 0; i < out.length; i++) {
    const n = out[i]!;
    const next = out[i + 1];
    if (n.tie === "next" && (!next || cmp(next.start, end(n)) !== 0)) out[i] = { ...n, tie: "none" };
  }
  if (!before) return out;
  // 편집 전 사슬에서 첫 음이 아니던 음 id → 그 사슬 첫 음의 v (&를 풀거나 앞 음을 자를 때 음을 복사하므로 객체가 아니라 id로 찾는다)
  const headVol = new Map<string, number>();
  for (const chain of tieChains(before)) for (const n of chain.slice(1)) headVol.set(n.id, chain[0]!.vol);
  if (headVol.size === 0) return out;
  for (let i = 0; i < out.length; i++) {
    const n = out[i]!;
    const vol = headVol.get(n.id);
    if (vol === undefined || vol === n.vol || explicitVol?.has(n.id)) continue;
    const prev = out[i - 1];
    const stillTied = prev?.tie === "next" && cmp(end(prev), n.start) === 0;
    if (!stillTied) out[i] = { ...n, vol };
  }
  return out;
}

/**
 * `placed` 자리를 비우고 넣는다. 잘린 앞 음과 짝을 잃은 &는 풀린다.
 * explicitVol에 든 음은 & 사슬이 끊겨도 적힌 v를 그대로 둔다 (tidy 참고)
 */
export function placeNote(notes: readonly Note[], placed: Note, explicitVol?: ReadonlySet<string>): Note[] {
  return tidy(placeRaw(notes, placed), notes, explicitVol);
}

/** placeNote에서 &정리만 뺀 것 (여러 음을 넣는 중간에는 아직 안 넣은 뒤 음 때문에 &를 풀면 안 된다) */
function placeRaw(notes: readonly Note[], placed: Note): Note[] {
  const out: Note[] = [];
  const from = placed.start;
  const to = end(placed);
  for (const n of notes) {
    if (n.id === placed.id) continue;
    if (cmp(end(n), from) <= 0 || cmp(n.start, to) >= 0) {
      out.push(n);
    } else if (cmp(n.start, from) < 0) {
      out.push({ ...n, dur: sub(from, n.start), tie: "none" });
    }
    // 새 음 안에서 시작하는 음은 지운다
  }
  out.push(placed);
  return out;
}

export function removeNotes(notes: readonly Note[], ids: ReadonlySet<string>): Note[] {
  return tidy(notes.filter((n) => !ids.has(n.id)), notes);
}

/**
 * 음을 옮기거나 길이를 바꾼다. 바뀐 자리에 있던 다른 음은 placeNote 규칙으로 정리한다.
 * change에 vol이 있으면 (원래 값과 같아도) 그 음은 & 사슬 보정 없이 change.vol을 그대로 쓴다
 */
export function updateNote(notes: readonly Note[], id: string, change: Partial<Omit<Note, "id">>): Note[] {
  const target = notes.find((n) => n.id === id);
  if (!target) return [...notes];
  return placeNote(notes, { ...target, ...change }, change.vol !== undefined ? new Set([id]) : undefined);
}

/** 위치 바로 앞(또는 그 위치)에 있는 음. 새 음의 볼륨을 이어받을 때 쓴다 */
export function noteBefore(notes: readonly Note[], at: Rat): Note | undefined {
  let found: Note | undefined;
  for (const n of notes) {
    if (cmp(n.start, at) <= 0 && (!found || cmp(n.start, found.start) > 0)) found = n;
  }
  return found;
}

/** 위치와 높이에 걸린 음 */
export function noteAt(notes: readonly Note[], at: Rat, pitch: number): Note | undefined {
  return notes.find((n) => n.pitch === pitch && cmp(n.start, at) <= 0 && cmp(at, end(n)) < 0);
}

/**
 * 고른 음과 바로 다음 음을 &로 잇거나 푼다 (같은 음이면 한 음, 다른 음이면 슬라이딩).
 * 다음 음과 사이가 떠 있으면 고른 음을 다음 음 시작까지 늘려서 잇는다. 다음 음이 없으면 undefined
 */
export function toggleTie(notes: readonly Note[], id: string): Note[] | undefined {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
  const i = sorted.findIndex((n) => n.id === id);
  const n = sorted[i];
  if (!n) return undefined;
  if (n.tie === "next") {
    sorted[i] = { ...n, tie: "none" };
    return sorted;
  }
  const next = sorted.slice(i + 1).find((x) => cmp(x.start, end(n)) >= 0);
  if (!next) return undefined;
  sorted[i] = { ...n, dur: sub(next.start, n.start), tie: "next" };
  return tidy(sorted);
}

/**
 * 여러 음을 한꺼번에 바꾼다 (고른 음 여러 개 옮기기·지우기). changes: id → 바뀐 음, null이면 지운다.
 * 바뀌는 음을 먼저 모두 빼고 시작 순으로 다시 넣으므로, 함께 옮기는 음끼리 서로 잘라 먹지 않는다.
 * explicitVol: 호출하는 쪽이 볼륨을 일부러 정한 음 id. 이 음들은 & 사슬이 끊겨도 적힌 v를 그대로 둔다
 */
export function replaceNotes(
  notes: readonly Note[],
  changes: ReadonlyMap<string, Note | null>,
  explicitVol?: ReadonlySet<string>,
): Note[] {
  let out: Note[] = notes.filter((n) => !changes.has(n.id));
  const placed = [...changes.values()].filter((n): n is Note => n !== null).sort((a, b) => cmp(a.start, b.start));
  // 넣는 음이 남은 음·서로와 겹치지 않으면 하나씩 넣어도 자르거나 지울 음이 없으므로 뒤에 붙이기만 한다 (결과가 같다).
  // 넣는 음이 많을 때 음마다 트랙 전체를 훑지 않게 (트릴·꾸밈음처럼 한 트랙에 수천 음을 넣는 경우)
  if (placed.length > 1 && fitsApart(out, placed, changes)) return tidy([...out, ...placed], notes, explicitVol);
  for (const n of placed) out = placeRaw(out, n);
  return tidy(out, notes, explicitVol);
}

/**
 * replaceNotes에서 넣는 음(시작 순)을 하나씩 placeRaw로 넣을 때 남은 음(rest)이나 먼저 넣은 음을 하나도 자르거나 지우지 않는지.
 * 바뀐 음이 제 id 칸에 들어 있고 길이가 0보다 길 때만 본다 (아니면 false: 하나씩 넣는다)
 */
function fitsApart(rest: readonly Note[], placed: readonly Note[], changes: ReadonlyMap<string, Note | null>): boolean {
  for (const [id, n] of changes) if (n && (n.id !== id || n.dur.n <= 0)) return false;
  // 넣는 음끼리: 앞에 넣은 음 끝 가운데 가장 늦은 것이 이 음 시작을 넘으면 placeRaw가 그 음을 자른다
  let reach: Rat | undefined;
  for (const p of placed) {
    if (reach && cmp(reach, p.start) > 0) return false;
    if (!reach || cmp(end(p), reach) > 0) reach = end(p);
  }
  // 남은 음: 시작 순으로 놓고 끝의 앞쪽 최댓값을 두면, 넣는 음 끝보다 먼저 시작하는 음 가운데 그 음 시작보다 늦게 끝나는 음이 있는지 바로 안다
  const sorted = [...rest].sort((a, b) => cmp(a.start, b.start));
  const reachUpTo: Rat[] = [];
  for (const n of sorted) {
    const last = reachUpTo[reachUpTo.length - 1];
    reachUpTo.push(last && cmp(last, end(n)) >= 0 ? last : end(n));
  }
  for (const p of placed) {
    const to = end(p);
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(sorted[mid]!.start, to) < 0) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && cmp(reachUpTo[lo - 1]!, p.start) > 0) return false;
  }
  return true;
}

/** 음을 넣거나 옮길 때 손해 보는 다른 음. cut: 끝이 잘릴 음 id → 남는 길이, removed: 지워질 음 id */
export interface PlaceLoss {
  readonly cut: ReadonlyMap<string, Rat>;
  readonly removed: ReadonlySet<string>;
}

/**
 * replaceNotes(notes, changes)를 하면 changes에 없는 음 가운데 무엇이 잘리고 지워지는지.
 * 끄는 동안 먹힐 음을 미리 보여 주고, 놓은 뒤 몇 개가 잘렸는지 알릴 때 쓴다. 규칙은 replaceNotes(placeRaw)와 똑같다
 */
export function placeLoss(notes: readonly Note[], changes: ReadonlyMap<string, Note | null>): PlaceLoss {
  const cut = new Map<string, Rat>();
  const removed = new Set<string>();
  const placed = [...changes.values()].filter((n): n is Note => n !== null).sort((a, b) => cmp(a.start, b.start));
  if (placed.length === 0) return { cut, removed };
  let out: Note[] = notes.filter((n) => !changes.has(n.id));
  for (const n of placed) out = placeRaw(out, n);
  const left = new Map(out.map((n) => [n.id, n]));
  for (const n of notes) {
    if (changes.has(n.id)) continue;
    const after = left.get(n.id);
    if (!after) removed.add(n.id);
    else if (cmp(after.dur, n.dur) < 0) cut.set(n.id, after.dur);
  }
  return { cut, removed };
}

/** 음 높이를 반음 단위로 옮긴다 (음정 변환). MIDI 범위(0~127)를 벗어나는 음이 하나라도 있으면 undefined */
export function transposeNotes(notes: readonly Note[], semitones: number): Note[] | undefined {
  const out = notes.map((n) => ({ ...n, pitch: n.pitch + semitones }));
  return out.every((n) => n.pitch >= 0 && n.pitch <= 127) ? out : undefined;
}

/**
 * 음 길이를 factor배로 (마비꼬의 길이 ×2·½). 첫 음 시작을 기준으로 시작 위치도 같은 배율로 벌리거나 좁혀
 * 리듬 모양을 지킨다. 바꾼 음만 돌려주므로 트랙에는 replaceNotes로 넣는다
 */
export function scaleNotes(notes: readonly Note[], factor: Rat, from?: Rat): Note[] {
  if (notes.length === 0) return [];
  // from: 기준 시작 (여러 트랙을 같이 바꿀 때 트랙마다 같은 기준을 써서 화음의 리듬이 어긋나지 않게)
  const origin = from ?? notes.reduce((m, n) => (cmp(n.start, m) < 0 ? n.start : m), notes[0]!.start);
  return notes.map((n) => ({ ...n, start: add(origin, mul(sub(n.start, origin), factor)), dur: mul(n.dur, factor) }));
}

/**
 * 한 트랙(notes)에서 고른 음(picked)만 길이 factor배 (scaleNotes와 같은 리듬 모양). 고르지 않은 음은 지우거나 줄이지 않는다:
 * 늘어난 음이 고르지 않은 다음 음과 겹치면 그 음 시작 앞까지만 늘린다 (타브의 길이 바꾸기와 같다).
 * 바꾼 고른 음만 돌려준다. 바뀌는 것이 없거나(늘릴 자리가 없음) 고른 음이 고르지 않은 음 자리로 옮겨 가 겹치면 undefined.
 * exact면 다음 음 앞에서 잘리는 음이 하나라도 있을 때 바꾸지 않는다 (점 붙이기처럼 정확한 길이가 아니면 뜻이 없는 경우)
 */
export function scaleNotesIn(notes: readonly Note[], picked: readonly Note[], factor: Rat, from?: Rat, exact = false): Note[] | undefined {
  const ids = new Set(picked.map((n) => n.id));
  const others = notes.filter((n) => !ids.has(n.id));
  const out: Note[] = [];
  for (const n of scaleNotes(picked, factor, from)) {
    // 옮겨 간 시작이 고르지 않은 음 안(또는 같은 자리)이면 그 음을 지우게 되므로 하지 않는다
    if (others.some((o) => cmp(o.start, n.start) <= 0 && cmp(n.start, end(o)) < 0)) return undefined;
    const next = others.filter((o) => cmp(o.start, n.start) > 0).reduce<Rat | undefined>((m, o) => (m === undefined || cmp(o.start, m) < 0 ? o.start : m), undefined);
    const cut = next !== undefined && cmp(end(n), next) > 0;
    if (cut && exact) return undefined;
    out.push(cut ? { ...n, dur: sub(next, n.start) } : n);
  }
  const before = new Map(picked.map((n) => [n.id, n]));
  const changed = out.some((n) => {
    const b = before.get(n.id)!;
    return cmp(b.start, n.start) !== 0 || cmp(b.dur, n.dur) !== 0;
  });
  return changed ? out : undefined;
}

/**
 * 한 트랙 음을 시작 순으로 놓고 id·자리로 바로 찾게 한 것. 트릴·꾸밈음처럼 고른 음마다 앞 음·& 사슬을 보는 도구가
 * 음마다 트랙 전체를 다시 정렬하고 처음부터 훑지 않도록 트랙마다 한 번 만들어 쓴다. 트랙 음이 바뀌면 새로 만든다
 */
export interface TrackIndex {
  /** 시작 순 (시작이 같으면 원래 순서) */
  readonly sorted: readonly Note[];
  /** id 음의 sorted 안 자리 (같은 id가 여럿이면 앞의 것). 없으면 -1 */
  indexOf(id: string): number;
  /** id 음 (원래 순서에서 처음 나오는 것) */
  get(id: string): Note | undefined;
  /** 시작이 at인 음들 (시작 순) */
  startingAt(at: Rat): Note[];
  /** n 바로 앞 음: n보다 먼저 시작하는 마지막 음 */
  before(n: Note): Note | undefined;
  /** 바로 앞 음이 &로 이어 주는 음인지 (새로 치지 않는 음) */
  isHeld(n: Note): boolean;
}

export function trackIndex(notes: readonly Note[]): TrackIndex {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
  const at = new Map<string, number>();
  sorted.forEach((n, i) => {
    if (!at.has(n.id)) at.set(n.id, i);
  });
  const byId = new Map<string, Note>();
  for (const n of notes) if (!byId.has(n.id)) byId.set(n.id, n);
  /** 시작이 pos 이상인 첫 음 자리 */
  const firstFrom = (pos: Rat) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(sorted[mid]!.start, pos) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const before = (n: Note) => {
    // 앞에서부터 훑어 n 자신이나 n 시작 이후 음을 만나기 직전 음과 같다 (n이 시작보다 앞자리에 놓였으면 그 앞)
    const i = at.get(n.id);
    const stop = Math.min(firstFrom(n.start), i ?? Infinity);
    return stop > 0 ? sorted[stop - 1] : undefined;
  };
  return {
    sorted,
    indexOf: (id) => at.get(id) ?? -1,
    get: (id) => byId.get(id),
    startingAt: (pos) => {
      const out: Note[] = [];
      for (let i = firstFrom(pos); i < sorted.length && cmp(sorted[i]!.start, pos) === 0; i++) out.push(sorted[i]!);
      return out;
    },
    before,
    isHeld: (n) => {
      const prev = before(n);
      return !!prev && prev.tie === "next" && cmp(end(prev), n.start) === 0;
    },
  };
}

/**
 * 트랙 음이 깔끔한지: 시작이 모두 다르고, 길이가 0보다 길고, 앞 음 끝이 뒤 음 시작을 넘지 않고, id가 겹치지 않는다.
 * 이런 트랙은 서로 떨어진 자리의 바꿈을 replaceNotes 한 번에 모아 넣어도 하나씩 넣은 것과 결과가 같다
 */
export function isCleanTrack(notes: readonly Note[]): boolean {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
  const ids = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n.dur.n <= 0 || ids.has(n.id)) return false;
    ids.add(n.id);
    const next = sorted[i + 1];
    if (next && (cmp(next.start, n.start) <= 0 || cmp(end(n), next.start) > 0)) return false;
  }
  return true;
}

/** 복사한 음 묶음: 첫 음 시작을 0으로 옮긴 음들과 원래 시작 위치 */
export interface NoteClip {
  /** 모든 음 (층이 여럿이면 모두 모은 것, 시작 순) */
  readonly notes: readonly Note[];
  readonly origin: Rat;
  /** 첫 음 시작부터 마지막 음 끝까지 */
  readonly length: Rat;
  /**
   * 트랙 나눔 (타브에서 여러 트랙의 화음을 복사한 경우, 원래 트랙 순서대로). 층마다 겹치지 않는 음 한 줄이다.
   * 없으면 트랙 하나 (notes가 한 층)
   */
  readonly layers?: readonly (readonly Note[])[];
}

/**
 * 한 트랙(겹치지 않는 음)에서 &로 이은 음 덩어리들. 시작 순. &가 있어도 다음 음이 바로 붙어 있지 않으면 덩어리가 끝난다
 */
export function tieChains(notes: readonly Note[]): Note[][] {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
  const chains: Note[][] = [];
  let chain: Note[] = [];
  sorted.forEach((n, i) => {
    chain.push(n);
    const next = sorted[i + 1];
    if (!(n.tie === "next" && next && cmp(end(n), next.start) === 0)) {
      chains.push(chain);
      chain = [];
    }
  });
  return chains;
}

/**
 * 음마다 실제로 나는 볼륨. &로 바로 이은 음은 게임에서 첫 음 v로 이어 나므로 사슬 첫 음 v를 쓴다
 * (뒤 조각의 v는 무시된다)
 */
export function chainVolumes(notes: readonly Note[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const chain of tieChains(notes)) for (const n of chain) out.set(n.id, chain[0]!.vol);
  return out;
}

/**
 * 고른 음(한 트랙)을 복사한다. &로 이은 짝이 함께 복사되지 않은 음은 &를 풀어,
 * 붙여넣은 트랙에 우연히 바로 뒤에 있는 다른 음과 이어지지 않게 한다
 */
export function clipNotes(notes: readonly Note[]): NoteClip | undefined {
  if (notes.length === 0) return undefined;
  const origin = notes.reduce((m, n) => (cmp(n.start, m) < 0 ? n.start : m), notes[0]!.start);
  const last = notes.reduce((m, n) => (cmp(end(n), m) > 0 ? end(n) : m), end(notes[0]!));
  const kept = tieChains(notes).flatMap((chain) =>
    chain.map((n, i): Note => (i === chain.length - 1 && n.tie === "next" ? { ...n, tie: "none" } : n)),
  );
  return { notes: kept.map((n) => ({ ...n, start: sub(n.start, origin) })), origin, length: sub(last, origin) };
}

/**
 * 여러 트랙의 고른 음을 트랙 나눔 그대로 복사한다 (layers: 트랙 순서대로, 빈 층은 뺀다). 모든 층이 같은 기준(가장 앞 음 시작)을 쓴다.
 * 층이 하나면 clipNotes와 같다
 */
export function clipLayers(layers: readonly (readonly Note[])[]): NoteClip | undefined {
  const used = layers.filter((l) => l.length > 0);
  if (used.length === 0) return undefined;
  if (used.length === 1) return clipNotes(used[0]!);
  const clips = used.map((l) => clipNotes(l)!);
  const origin = clips.reduce((m, c) => (cmp(c.origin, m) < 0 ? c.origin : m), clips[0]!.origin);
  const shifted = clips.map((c) => c.notes.map((n) => ({ ...n, start: add(n.start, sub(c.origin, origin)) })));
  const length = clips.reduce((m, c) => {
    const e = add(sub(c.origin, origin), c.length);
    return cmp(e, m) > 0 ? e : m;
  }, clips[0]!.length);
  return { notes: shifted.flat().sort((a, b) => cmp(a.start, b.start)), origin, length, layers: shifted };
}

/** 층들을 트랙 하나에 모으면 음이 겹치는지 (화음을 피아노롤의 트랙 하나에 붙일 수 없다) */
export function clipOverlaps(clip: NoteClip): boolean {
  let reach: Rat | undefined;
  for (const n of [...clip.notes].sort((a, b) => cmp(a.start, b.start))) {
    if (reach && cmp(n.start, reach) < 0) return true;
    if (!reach || cmp(end(n), reach) > 0) reach = end(n);
  }
  return false;
}

/** 복사한 음을 at 위치에 새 id로 놓을 음들. 만든 기록 표시는 떼어 보통 음으로 (되돌리기가 붙인 음까지 지우지 않게) */
export function pasteClip(clip: NoteClip, at: Rat, newId: () => string): Note[] {
  return clip.notes.map(({ made: _made, ...n }) => ({ ...n, id: newId(), start: add(at, n.start) }));
}

/**
 * 다른 트랙에서 가져올 음을 이 트랙에 넣을 수 있는 것과 없는 것으로 나눈다. 트랙은 한 번에 한 음이라
 * 이미 있는 음(또는 앞서 넣기로 한 음)과 시간이 겹치면 넣지 않는다
 */
export function fitNotes(target: readonly Note[], incoming: readonly Note[]): { fits: Note[]; blocked: Note[] } {
  const taken: Note[] = [...target];
  const fits: Note[] = [];
  const blocked: Note[] = [];
  for (const n of [...incoming].sort((a, b) => cmp(a.start, b.start))) {
    const clash = taken.some((t) => cmp(t.start, end(n)) < 0 && cmp(n.start, end(t)) < 0);
    if (clash) blocked.push(n);
    else {
      fits.push(n);
      taken.push(n);
    }
  }
  return { fits, blocked };
}

/**
 * 음을 at에서 둘로 자른다 (Split). 두 음은 &로 잇지 않으므로 뒤 음은 새로 소리를 낸다.
 * 뒤 음 v는 그 음이 실제로 울리던 v(& 사슬 첫 음의 v)를 받고, 원래 음의 &는 뒤 음이 이어받는다.
 * at이 음 안(시작·끝 제외)이 아니면 undefined. 돌려주는 값은 [바뀐 트랙 음, 앞 음, 뒤 음]
 */
export function splitNote(notes: readonly Note[], id: string, at: Rat, newId: string): [Note[], Note, Note] | undefined {
  const n = notes.find((x) => x.id === id);
  if (!n || cmp(at, n.start) <= 0 || cmp(at, end(n)) >= 0) return undefined;
  const chain = tieChains(notes).find((c) => c.some((x) => x.id === id));
  const head: Note = { ...n, dur: sub(at, n.start), tie: "none" };
  const tail: Note = { ...n, id: newId, start: at, dur: sub(end(n), at), vol: chain?.[0]?.vol ?? n.vol };
  const out = notes.filter((x) => x.id !== id);
  return [tidy([...out, head, tail]), head, tail];
}

/**
 * 고른 음 가운데 높이가 같고 맞닿은(앞 음 끝 = 뒤 음 시작) 음들을 한 음으로 붙인다 (Glue).
 * 붙인 음은 앞 음의 id·v를, 마지막 음의 &를 물려받는다. &로 이은 것과 달리 편집에서 한 덩어리가 된다.
 * 붙일 것이 없으면 undefined. 돌려주는 값은 [바뀐 트랙 음, 붙여서 남은 음들]
 */
export function glueNotes(notes: readonly Note[], ids: ReadonlySet<string>): [Note[], Note[]] | undefined {
  const picked = notes.filter((n) => ids.has(n.id)).sort((a, b) => cmp(a.start, b.start));
  const merged: Note[] = [];
  let changed = false;
  for (const n of picked) {
    const last = merged[merged.length - 1];
    if (last && last.pitch === n.pitch && cmp(end(last), n.start) === 0) {
      merged[merged.length - 1] = { ...last, dur: add(last.dur, n.dur), tie: n.tie };
      changed = true;
    } else merged.push(n);
  }
  if (!changed) return undefined;
  return [tidy([...notes.filter((n) => !ids.has(n.id)), ...merged]), merged];
}

/** 음량 레인의 막대 하나 = &로 이은 사슬 하나. 높이는 첫 음 v (게임은 사슬을 첫 음 v로 이어 낸다) */
export interface VolumeBar {
  readonly head: Note;
  /** 사슬에 든 음 id (첫 음 포함, 시작 순) */
  readonly ids: readonly string[];
  readonly start: Rat;
  readonly end: Rat;
  readonly vol: number;
}

/** 이음 사슬마다 막대 하나. 시작 순 */
export function volumeBars(notes: readonly Note[]): VolumeBar[] {
  return tieChains(notes).map((chain) => {
    const head = chain[0]!;
    return { head, ids: chain.map((n) => n.id), start: head.start, end: end(chain[chain.length - 1]!), vol: head.vol };
  });
}

/**
 * 직선 긋기: (from, v0)에서 (to, v1)까지 선을 긋고, 시작이 그 사이(양 끝 포함)인 막대마다
 * 시작 위치의 선 높이를 반올림해 범위 안으로 넣는다. 거꾸로 그어도 같다. 결과는 첫 음 id → v
 */
export function rampVolumes(
  bars: readonly VolumeBar[],
  from: Rat,
  to: Rat,
  v0: number,
  v1: number,
  range: { readonly min: number; readonly max: number },
): Map<string, number> {
  const out = new Map<string, number>();
  const [a, b, va, vb] = cmp(from, to) <= 0 ? [from, to, v0, v1] : [to, from, v1, v0];
  const span = sub(b, a);
  for (const bar of bars) {
    if (cmp(bar.start, a) < 0 || cmp(bar.start, b) > 0) continue;
    // 위치 비율은 분수로 정확히 구하고, 값으로 바꿀 때만 소수를 쓴다
    const r = span.n === 0 ? undefined : div(sub(bar.start, a), span);
    const f = r ? r.n / r.d : 1;
    const v = Math.round(va + (vb - va) * f);
    out.set(bar.head.id, Math.min(range.max, Math.max(range.min, v)));
  }
  return out;
}

/**
 * 첫 음 id → v 를 사슬에 적용한다. 꼬리 음 v도 같이 덮어(`wholeChain`) 나중에 &를 풀거나 잘라도
 * 들리던 v가 남게 한다. 음 순서·위치는 그대로, 바뀐 것이 없으면 같은 배열 내용을 돌려준다
 */
export function applyVolumes(notes: readonly Note[], byHead: ReadonlyMap<string, number>, wholeChain = true): Note[] {
  const target = new Map<string, number>();
  for (const chain of tieChains(notes)) {
    const v = byHead.get(chain[0]!.id);
    if (v === undefined) continue;
    for (const n of wholeChain ? chain : chain.slice(0, 1)) target.set(n.id, v);
  }
  return notes.map((n) => {
    const v = target.get(n.id);
    return v === undefined || v === n.vol ? n : { ...n, vol: v };
  });
}

/** 여러 트랙에 한 번에 음량을 그릴 때 사슬의 자리: 멜로디 트랙, 아니면 그 순간 울리는 음 가운데 맨 위·가운데·맨 아래 */
export type VoiceRank = "melody" | "top" | "middle" | "bottom";

/** 시작 순으로 놓인 음에서 at에 울리고 있는 음 (start ≤ at < 끝) */
function soundingIn(sorted: readonly Note[], at: Rat): Note | undefined {
  let lo = 0;
  let hi = sorted.length;
  // at 이하에서 시작하는 마지막 음
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cmp(sorted[mid]!.start, at) <= 0) lo = mid + 1;
    else hi = mid;
  }
  const n = sorted[lo - 1];
  return n && cmp(at, end(n)) < 0 ? n : undefined;
}

/**
 * 트랙마다 사슬 첫 음 id → 자리. 멜로디 트랙의 사슬은 "melody". 다른 트랙은 사슬이 시작하는 순간
 * 멜로디가 아닌 다른 트랙에서 울리는 음과 높이를 견준다: 가장 높으면 top, 가장 낮으면 bottom, 사이면 middle.
 * 견줄 음이 없으면 혼자 반주하는 음이라 멜로디보다 낮으면 bottom, 아니면 top
 */
export function voiceRanks(voices: readonly { readonly id: string; readonly notes: readonly Note[]; readonly melody: boolean }[]): Map<string, Map<string, VoiceRank>> {
  const sorted = voices.map((v) => ({ ...v, notes: [...v.notes].sort((a, b) => cmp(a.start, b.start)) }));
  const out = new Map<string, Map<string, VoiceRank>>();
  for (const voice of sorted) {
    const ranks = new Map<string, VoiceRank>();
    for (const chain of tieChains(voice.notes)) {
      const head = chain[0]!;
      if (voice.melody) {
        ranks.set(head.id, "melody");
        continue;
      }
      const others: number[] = [];
      let melody: number | undefined;
      for (const other of sorted) {
        if (other.id === voice.id) continue;
        const n = soundingIn(other.notes, head.start);
        if (!n) continue;
        if (other.melody) melody = Math.max(melody ?? -Infinity, n.pitch);
        else others.push(n.pitch);
      }
      const p = head.pitch;
      let rank: VoiceRank;
      if (others.length === 0) rank = melody !== undefined && melody > p ? "bottom" : "top";
      else if (p >= Math.max(...others)) rank = "top";
      else if (p <= Math.min(...others)) rank = "bottom";
      else rank = "middle";
      ranks.set(head.id, rank);
    }
    out.set(voice.id, ranks);
  }
  return out;
}
