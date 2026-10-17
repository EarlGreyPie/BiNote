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
 */
function tidy(notes: readonly Note[], before?: readonly Note[]): Note[] {
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
    if (vol === undefined || vol === n.vol) continue;
    const prev = out[i - 1];
    const stillTied = prev?.tie === "next" && cmp(end(prev), n.start) === 0;
    if (!stillTied) out[i] = { ...n, vol };
  }
  return out;
}

/** `placed` 자리를 비우고 넣는다. 잘린 앞 음과 짝을 잃은 &는 풀린다 */
export function placeNote(notes: readonly Note[], placed: Note): Note[] {
  return tidy(placeRaw(notes, placed), notes);
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

/** 음을 옮기거나 길이를 바꾼다. 바뀐 자리에 있던 다른 음은 placeNote 규칙으로 정리한다 */
export function updateNote(notes: readonly Note[], id: string, change: Partial<Omit<Note, "id">>): Note[] {
  const target = notes.find((n) => n.id === id);
  if (!target) return [...notes];
  return placeNote(notes, { ...target, ...change });
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
 */
export function replaceNotes(notes: readonly Note[], changes: ReadonlyMap<string, Note | null>): Note[] {
  let out: Note[] = notes.filter((n) => !changes.has(n.id));
  const placed = [...changes.values()].filter((n): n is Note => n !== null).sort((a, b) => cmp(a.start, b.start));
  for (const n of placed) out = placeRaw(out, n);
  return tidy(out, notes);
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
export function scaleNotes(notes: readonly Note[], factor: Rat): Note[] {
  if (notes.length === 0) return [];
  const origin = notes.reduce((m, n) => (cmp(n.start, m) < 0 ? n.start : m), notes[0]!.start);
  return notes.map((n) => ({ ...n, start: add(origin, mul(sub(n.start, origin), factor)), dur: mul(n.dur, factor) }));
}

/** 복사한 음 묶음: 첫 음 시작을 0으로 옮긴 음들과 원래 시작 위치 */
export interface NoteClip {
  readonly notes: readonly Note[];
  readonly origin: Rat;
  /** 첫 음 시작부터 마지막 음 끝까지 */
  readonly length: Rat;
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

/** 복사한 음을 at 위치에 새 id로 놓을 음들 */
export function pasteClip(clip: NoteClip, at: Rat, newId: () => string): Note[] {
  return clip.notes.map((n) => ({ ...n, id: newId(), start: add(at, n.start) }));
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
