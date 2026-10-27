import { add, cmp, eq, sub, ZERO, type Rat } from "./rat.js";
import type { Note, Song } from "./model.js";
import type { ArpOrder, ArpStyle } from "./arpeggio.js";
import type { MadeNotes } from "./made.js";

/**
 * 기록 없는 아르페지오 알아보기: 만든 기록이 없는 음(전 판에서 만들었거나 .mml로 다시 연 곡)을 사용자가 골라 부르면,
 * 음 배치에서 아르페지오 설정과 원래 화음을 짐작해 만든 기록으로 남길 재료를 만든다 (되돌리기·다시 고치기가 되게).
 * 곡을 저절로 훑지는 않는다: 보통 선율도 같은 길이로 이어 놓으면 아르페지오와 모양이 같아서 고른 음만 본다.
 * 원래 화음은 짐작이다 (칸 처음부터 끝까지 이어지는 화음, 트랙은 아래 규칙). 결과만 계산하고 곡은 바꾸지 않는다
 *
 * - 여러 트랙에 걸친 음이 칸마다 같은 간격으로 하나씩 늦게 시작하고, 트랙마다 다음 음 앞이나 칸 끝에서 끝나면
 *   되풀이(트랙마다 음이 하나면 굴려 치기). 원래 화음은 트랙마다 그 칸 첫 음 높이로 칸 처음부터 끝까지
 * - 아니면 펼치기: 고른 음이 가장 많은 트랙에서 같은 길이로 빈틈없이 이어진 음을 화음 칸으로 나눈다.
 *   다른 트랙에 칸 처음에 시작하는 화음 음이 남아 있으면(화음 트랙 음 지우기를 껐던 것) 그 음은 그대로 두고 나머지 한 음만 이 트랙에,
 *   아니면 가장 낮은 음은 이 트랙에, 나머지는 같은 악보에서 그 자리가 빈 트랙에 하나씩 (빈 트랙이 모자라면 뺀다)
 */

export interface ArpGuessCell {
  readonly start: Rat;
  readonly end: Rat;
  /** 짐작한 원래 화음 높이 (낮은 순, 옥타브 넓이를 걷어낸 것) */
  readonly pitches: readonly number[];
}

export type ArpGuess =
  | {
      readonly ok: true;
      readonly style: ArpStyle;
      readonly order: ArpOrder;
      /** 음 하나의 길이 */
      readonly step: Rat;
      readonly octaves: 1 | 2 | 3;
      readonly repeat: boolean;
      /** 펼치기에서 화음 트랙 음을 지웠던 것으로 보이는지 */
      readonly clearChordTracks: boolean;
      /** 고른 트랙 (펼치기 결과가 있는 트랙, 되풀이·굴려 치기는 첫 음 트랙) */
      readonly trackId: string;
      readonly cells: readonly ArpGuessCell[];
      /** 짐작한 원래 음 (트랙마다, 새 id) */
      readonly before: readonly MadeNotes[];
      /** 기록을 붙일 만든 음 (트랙마다) */
      readonly after: readonly MadeNotes[];
      /** 다시 고치기에서 고를 원래 음 id (고른 트랙의 원래 음) */
      readonly picked: readonly string[];
      /** 빈 트랙이 모자라 원래 화음에서 뺀 음 수 */
      readonly dropped: number;
      /** 아르페지오 모양이 아니라 뺀 고른 음 수 (높이가 하나뿐인 칸, 다른 트랙에 남은 원래 화음 음 제외) */
      readonly skipped: number;
    }
  | {
      readonly ok: false;
      /** made: 이미 기록이 있는 음이 섞임 / score: 여러 악보 / none: 아르페지오 모양을 찾지 못함 */
      readonly reason: "made" | "score" | "none";
      /** 걸리는 음 id (made) */
      readonly blocking: readonly string[];
    };

interface Entry {
  readonly trackId: string;
  /** &로 이은 음은 하나로 본 음 (시작은 첫 음, 길이는 사슬 전체) */
  readonly note: Note;
  /** 곡에 있는 실제 음 (& 사슬이면 사슬 음 모두) */
  readonly members: readonly Note[];
}

const end = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);

/** 칸 하나 (같은 칸의 만든 음, 시작 순) */
interface RawCell {
  readonly entries: readonly Entry[];
  readonly start: Rat;
  readonly end: Rat;
}

/** 높이 차례에서 한 번 도는 길이: 첫 높이가 다시 나오는 자리 (없으면 전부) */
function periodOf(seq: readonly number[]): number {
  for (let j = 2; j < seq.length; j++) if (seq[j] === seq[0]) return j;
  return seq.length;
}

/** 한 번 도는 높이 차례로 순서·옥타브 넓이·원래 화음 */
function shapeOf(seq: readonly number[]): { order: ArpOrder; octaves: 1 | 2 | 3; pitches: number[]; pass: number } {
  const pass = periodOf(seq);
  const once = seq.slice(0, pass);
  const uniq = [...new Set(once)].sort((a, b) => a - b);
  const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const up = uniq;
  const down = [...uniq].reverse();
  const updown = uniq.length > 2 ? [...uniq, ...uniq.slice(1, -1).reverse()] : uniq;
  const order: ArpOrder = same(once, up) ? "up" : same(once, down) ? "down" : same(once, updown) ? "updown" : "random";
  for (const k of [3, 2] as const) {
    if (uniq.length % k !== 0) continue;
    const n = uniq.length / k;
    if (n < 2) continue;
    if (!uniq.every((p, i) => i < n || p === uniq[i - n]! + 12)) continue;
    // 아래로는 맨 위 옥타브가 원래 화음이다 (한 옥타브씩 내려 이어 붙인다)
    return { order, octaves: k, pitches: order === "down" ? uniq.slice(-n) : uniq.slice(0, n), pass };
  }
  return { order, octaves: 1, pitches: uniq, pass };
}

/** 한 트랙에 빈틈없이 이어진 음을 화음 칸으로 나눈다 (펼치기) */
function spreadCells(entries: readonly Entry[]): RawCell[] {
  const sorted = [...entries].sort((a, b) => cmp(a.note.start, b.note.start));
  const cells: Entry[][] = [];
  let cur: Entry[] = [];
  for (const x of sorted) {
    const prev = cur.at(-1)?.note;
    let fresh = !prev || prev.tie === "next" || !eq(x.note.start, end(prev));
    // 앞 음 길이가 한 음 길이와 다르면 그 음이 칸 끝이다 (반복을 끄면 마지막 음을 늘리고, 칸 끝에 걸리면 자른다)
    if (!fresh && cur.length > 1 && !eq(prev!.dur, cur[0]!.note.dur)) fresh = true;
    if (!fresh) {
      const seq = cur.map((c) => c.note.pitch);
      const pass = periodOf(seq);
      // 한 바퀴를 돈 뒤 차례가 어긋나면 새 화음이다
      if (pass < seq.length) fresh = x.note.pitch !== seq[seq.length - pass];
      // 첫 바퀴에서 첫 음이 아닌 높이가 다시 나오면 위아래(updown)의 내려오는 쪽일 때만 같은 칸
      else if (seq.length >= 2 && x.note.pitch !== seq[0] && seq.includes(x.note.pitch)) fresh = !isUpdownTail(seq, x.note.pitch);
    }
    if (fresh && cur.length > 0) {
      cells.push(cur);
      cur = [];
    }
    cur.push(x);
  }
  if (cur.length > 0) cells.push(cur);
  return cells.map((list) => ({ entries: list, start: list[0]!.note.start, end: end(list[list.length - 1]!.note) }));
}

/** 위아래 차례에서 다음 음인지: seq가 꼭대기까지 오름차순으로 간 뒤 거울처럼 내려오고 있고, p가 그다음 내려올 높이 */
function isUpdownTail(seq: readonly number[], p: number): boolean {
  const top = seq.indexOf(Math.max(...seq));
  for (let i = 1; i <= top; i++) if (seq[i]! <= seq[i - 1]!) return false;
  for (let k = 1; top + k < seq.length; k++) if (seq[top + k] !== seq[top - k]) return false;
  return seq[top - (seq.length - 1 - top) - 1] === p;
}

/**
 * 여러 트랙에 걸친 음을 칸으로 (어느 음도 걸치지 않는 자리에서 끊는다). 되풀이·굴려 치기 모양인 칸만 (아닌 칸은 뺀다)
 * - 굴려 치기: 칸 안에서 트랙마다 음이 하나이고 같은 간격으로 하나씩 늦게 시작한다 (끝은 원래 끝이라 저마다 달라도 된다)
 * - 되풀이: 같은 간격으로 하나씩 늦게 시작하고, 트랙마다 다음 음 앞이나 칸 끝에서 끝난다
 */
function laneCells(entries: readonly Entry[]): (RawCell & { roll: boolean })[] {
  const sorted = [...entries].sort((a, b) => cmp(a.note.start, b.note.start));
  const groups: Entry[][] = [];
  let reach: Rat | undefined;
  for (const x of sorted) {
    if (!reach || cmp(x.note.start, reach) >= 0) groups.push([]);
    groups[groups.length - 1]!.push(x);
    reach = !reach || cmp(end(x.note), reach) > 0 ? end(x.note) : reach;
  }
  const cells: (RawCell & { roll: boolean })[] = [];
  for (const list of groups) {
    const start = list[0]!.note.start;
    const last = list.reduce((m, x) => (cmp(end(x.note), m) > 0 ? end(x.note) : m), end(list[0]!.note));
    const tracks = new Set(list.map((x) => x.trackId));
    if (list.length < 2 || tracks.size < 2) continue;
    const step = sub(list[1]!.note.start, start);
    if (cmp(step, ZERO) <= 0 || !list.every((x, i) => i === 0 || eq(sub(x.note.start, list[i - 1]!.note.start), step))) continue;
    const roll = tracks.size === list.length;
    // 같은 트랙 다음 음 앞에서 끊기거나 칸 끝까지
    const strum = list.every((x, i) => {
      const next = list.slice(i + 1).find((y) => y.trackId === x.trackId);
      return eq(end(x.note), next ? next.note.start : last);
    });
    if (!roll && !strum) continue;
    cells.push({ entries: list, start, end: last, roll });
  }
  return cells;
}

/** 칸마다 쓰는 차례·한 음 길이 (가장 많이 나온 것) */
function mostCommon<T>(items: readonly T[], key: (x: T) => string): T {
  const count = new Map<string, number>();
  for (const x of items) count.set(key(x), (count.get(key(x)) ?? 0) + 1);
  return [...items].sort((a, b) => count.get(key(b))! - count.get(key(a))!)[0]!;
}

/** 칸마다 차례가 다르면 무작위 (무작위도 칸에 따라 우연히 위로·아래로가 될 수 있다) */
function orderOf(shapes: readonly { order: ArpOrder }[]): ArpOrder {
  return shapes.every((s) => s.order === shapes[0]!.order) ? shapes[0]!.order : "random";
}

/** 악보 묶음(트랙 id 목록). 주지 않으면 연주자 하나를 악보 하나로 본다 */
export type ScoreTrackIds = readonly (readonly string[])[];

/** 이 트랙들이 한 악보에 있으면 그 악보 트랙 (곡 순서대로), 여러 악보에 걸치면 undefined */
function scoreTracksOf(song: Song, trackIds: ReadonlySet<string>, scores?: ScoreTrackIds): Song["tracks"] | undefined {
  if (!scores) {
    const players = new Set(song.tracks.filter((t) => trackIds.has(t.id)).map((t) => t.playerId));
    if (players.size !== 1) return undefined;
    const playerId = [...players][0]!;
    return song.tracks.filter((t) => t.playerId === playerId);
  }
  const hit = scores.filter((ids) => ids.some((id) => trackIds.has(id)));
  if (hit.length !== 1 || [...trackIds].some((id) => !hit[0]!.includes(id))) return undefined;
  const ids = new Set(hit[0]!);
  return song.tracks.filter((t) => ids.has(t.id));
}

/**
 * 고른 음에서 아르페지오 짐작. newId: 원래 음에 쓸 겹치지 않는 새 id. locked: 원래 음을 놓지 않을 트랙.
 * scores: 악보 묶음 (한 연주자가 악보 여럿으로 나뉠 때 다른 악보 트랙을 묶지 않게)
 */
export function guessArpeggio(song: Song, picked: readonly Note[], newId: () => string, locked: ReadonlySet<string> = new Set(), scores?: ScoreTrackIds): ArpGuess {
  const ids = new Set(picked.map((n) => n.id));
  const liveRecords = new Set((song.made ?? []).map((r) => r.id));
  const entries: Entry[] = [];
  for (const t of song.tracks) {
    // &로 이은 고른 음은 하나로 본다 (사슬 머리부터)
    const mine = t.notes.filter((n) => ids.has(n.id)).sort((a, b) => cmp(a.start, b.start));
    let chain: Note[] = [];
    const flush = () => {
      if (chain.length === 0) return;
      const head = chain[0]!;
      const tail = chain[chain.length - 1]!;
      entries.push({ trackId: t.id, note: { ...head, dur: sub(end(tail), head.start), tie: tail.tie }, members: chain });
      chain = [];
    };
    for (const n of mine) {
      const prev = chain.at(-1);
      if (!(prev && prev.tie === "next" && eq(end(prev), n.start))) flush();
      chain.push(n);
    }
    flush();
  }
  const made = entries.flatMap((x) => x.members).filter((n) => n.made !== undefined && liveRecords.has(n.made)).map((n) => n.id);
  if (made.length > 0) return { ok: false, reason: "made", blocking: made };
  const trackIds = new Set(entries.map((x) => x.trackId));
  const scoreTracks = scoreTracksOf(song, trackIds, scores);
  if (entries.length > 0 && !scoreTracks) return { ok: false, reason: "score", blocking: [] };
  const none = { ok: false, reason: "none", blocking: [] } as const;
  if (entries.length < 2 || !scoreTracks) return none;

  // 되풀이·굴려 치기
  const lanes = trackIds.size > 1 ? laneCells(entries) : [];
  if (lanes.length > 0) {
    const shapes = lanes.map((c) => ({ cell: c, ...shapeOf(c.entries.map((x) => x.note.pitch)), step: sub(c.entries[1]!.note.start, c.start) }));
    const kept = shapes.filter((s) => new Set(s.cell.entries.map((x) => x.note.pitch)).size > 1);
    if (kept.length === 0) return none;
    const roll = kept.every((s) => s.cell.roll);
    const first = kept[0]!;
    const trackId = first.cell.entries[0]!.trackId;
    const before = new Map<string, Note[]>();
    for (const { cell } of kept) {
      const seen = new Set<string>();
      for (const x of cell.entries) {
        if (seen.has(x.trackId)) continue;
        seen.add(x.trackId);
        const list = before.get(x.trackId) ?? [];
        // 굴려 치기는 원래 음 끝이 그대로다
        list.push(origin(newId(), cell.start, roll ? end(x.note) : cell.end, x.note.pitch, x.note));
        before.set(x.trackId, list);
      }
    }
    const order = orderOf(kept);
    const step = mostCommon(kept, (s) => `${s.step.n}/${s.step.d}`).step;
    const octaves = mostCommon(kept, (s) => String(s.octaves)).octaves;
    // 한 바퀴보다 음이 많으면 되풀이를 켠 것
    const repeat = roll ? false : kept.some((s) => s.cell.entries.length > s.pass) || !kept.some((s) => s.cell.entries.length === s.pass);
    const covered = new Set(kept.flatMap((s) => s.cell.entries.map((x) => x.note.id)));
    return {
      ok: true,
      style: roll ? "roll" : "strum",
      order,
      step,
      octaves: roll ? 1 : octaves,
      repeat,
      clearChordTracks: true,
      trackId,
      cells: kept.map((s) => ({ start: s.cell.start, end: s.cell.end, pitches: s.pitches })),
      before: groupsOf(before, scoreTracks),
      after: afterOf(entries, covered, scoreTracks),
      picked: (before.get(trackId) ?? []).map((n) => n.id),
      dropped: 0,
      skipped: entries.length - covered.size,
    };
  }

  // 펼치기: 고른 음이 가장 많은 트랙
  const counts = scoreTracks.map((t) => ({ t, n: entries.filter((x) => x.trackId === t.id).length }));
  const host = counts.reduce((m, x) => (x.n > m.n ? x : m)).t;
  const raw = spreadCells(entries.filter((x) => x.trackId === host.id));
  const shapes = raw.map((c) => ({ cell: c, ...shapeOf(c.entries.map((x) => x.note.pitch)), step: c.entries[0]!.note.dur }));
  // 음 셋 이상, 앞 두 음이 같은 길이인 칸만 (길이가 제각각인 선율 두 음을 화음 칸으로 보지 않게)
  const kept = shapes.filter((s) => s.cell.entries.length > 2 && eq(s.cell.entries[1]!.note.dur, s.step) && s.pitches.length > 1);
  if (kept.length === 0) return none;
  const before = new Map<string, Note[]>();
  const covered = new Set<string>();
  const leftAlone = new Set<string>();
  let dropped = 0;
  let clearing = false;
  for (const s of kept) {
    const { cell } = s;
    for (const x of cell.entries) covered.add(x.note.id);
    /** 그 높이로 만든 첫 음 (v·타브 줄을 원래 음에 준다): 옥타브를 넓혔으면 옮긴 높이도 본다 */
    const sample = (p: number) => (cell.entries.find((x) => x.note.pitch === p) ?? cell.entries.find((x) => (x.note.pitch - p) % 12 === 0) ?? cell.entries[0]!).note;
    // 다른 트랙에 칸 처음에 시작하는 같은 높이 음이 남아 있으면 지우지 않은 화음 음이다
    const others = scoreTracks.filter((t) => t.id !== host.id);
    const found = new Map<number, Note>();
    for (const p of s.pitches) {
      const hit = others.flatMap((t) => t.notes).find((n) => n.pitch === p && eq(n.start, cell.start) && !covered.has(n.id));
      if (hit) found.set(p, hit);
    }
    const keepMode = found.size > 0 && found.size === s.pitches.length - 1;
    if (keepMode) for (const n of found.values()) leftAlone.add(n.id);
    else clearing = true;
    const rest = s.pitches.filter((p) => !keepMode || !found.has(p));
    const add = (trackId: string, p: number) => {
      const list = before.get(trackId) ?? [];
      list.push(origin(newId(), cell.start, cell.end, p, sample(p)));
      before.set(trackId, list);
    };
    add(host.id, rest[0]!);
    // 나머지 화음 음은 같은 악보에서 칸 자리가 빈 트랙에 하나씩
    const used = new Set<string>([host.id]);
    for (const p of rest.slice(1)) {
      const free = others.find(
        (t) =>
          !used.has(t.id) &&
          !locked.has(t.id) &&
          !t.notes.some((n) => cmp(n.start, cell.end) < 0 && cmp(cell.start, end(n)) < 0) &&
          !(before.get(t.id) ?? []).some((n) => cmp(n.start, cell.end) < 0 && cmp(cell.start, end(n)) < 0),
      );
      if (!free) {
        dropped++;
        continue;
      }
      used.add(free.id);
      add(free.id, p);
    }
  }
  const order = orderOf(kept);
  const step = mostCommon(kept, (s) => `${s.step.n}/${s.step.d}`).step;
  const octaves = mostCommon(kept, (s) => String(s.octaves)).octaves;
  // 반복을 끄면 한 바퀴만 돌고 마지막 음을 칸 끝까지 늘린다. 한 바퀴보다 많거나 마지막 음이 한 음 길이 이하면 켠 것
  const repeat = kept.some((s) => s.cell.entries.length > s.pass) || kept.some((s) => cmp(s.cell.entries[s.cell.entries.length - 1]!.note.dur, s.step) <= 0);
  return {
    ok: true,
    style: "spread",
    order,
    step,
    octaves,
    repeat,
    clearChordTracks: clearing,
    trackId: host.id,
    cells: kept.map((s) => ({ start: s.cell.start, end: s.cell.end, pitches: s.pitches })),
    before: groupsOf(before, scoreTracks),
    after: afterOf(entries, covered, scoreTracks),
    picked: (before.get(host.id) ?? []).map((n) => n.id),
    dropped,
    skipped: entries.filter((x) => !covered.has(x.note.id) && !leftAlone.has(x.note.id)).length,
  };
}

/** 짐작한 원래 음 하나: 칸 처음부터 끝까지, v·타브 줄은 그 높이로 만든 음에서 */
function origin(id: string, start: Rat, stop: Rat, pitch: number, like: Note): Note {
  return { id, start, dur: sub(stop, start), pitch, vol: like.vol, tie: "none", ...(like.tabString !== undefined ? { tabString: like.tabString } : {}) };
}

function groupsOf(byTrack: ReadonlyMap<string, Note[]>, order: readonly { id: string }[]): MadeNotes[] {
  return order.filter((t) => byTrack.has(t.id)).map((t) => ({ trackId: t.id, notes: byTrack.get(t.id)! }));
}

function afterOf(entries: readonly Entry[], covered: ReadonlySet<string>, order: readonly { id: string }[]): MadeNotes[] {
  return order
    .map((t) => ({ trackId: t.id, notes: entries.filter((x) => x.trackId === t.id && covered.has(x.note.id)).flatMap((x) => x.members) }))
    .filter((g) => g.notes.length > 0);
}

/**
 * 고른 음에서 짐작하고, 못 찾으면 고른 음 둘레로 넓혀 본다 (한 음만 골라도 되게):
 * 같은 악보에서 고른 음과 시간이 겹쳐 이어지는 음 묶음(되풀이·굴려 치기), 고른 음 트랙에서 빈틈없이 이어진 음(펼치기)
 */
export function guessArpeggioAround(
  song: Song,
  picked: readonly Note[],
  newId: () => string,
  locked: ReadonlySet<string> = new Set(),
  scores?: ScoreTrackIds,
): ArpGuess {
  const direct = guessArpeggio(song, picked, newId, locked, scores);
  if (direct.ok || direct.reason !== "none" || picked.length === 0) return direct;
  const ids = new Set(picked.map((n) => n.id));
  const owner = new Map<string, Song["tracks"][number]>();
  for (const t of song.tracks) for (const n of t.notes) if (ids.has(n.id)) owner.set(n.id, t);
  const score = scoreTracksOf(song, new Set([...owner.values()].map((t) => t.id)), scores);
  if (!score) return direct;
  // 1) 시간이 겹쳐 이어지는 음 묶음 (어느 음도 걸치지 않는 자리에서 끊는다)
  const all = score.flatMap((t) => t.notes).sort((a, b) => cmp(a.start, b.start));
  const groups: Note[][] = [];
  let reach: Rat | undefined;
  for (const n of all) {
    if (!reach || cmp(n.start, reach) >= 0) groups.push([]);
    groups[groups.length - 1]!.push(n);
    reach = !reach || cmp(end(n), reach) > 0 ? end(n) : reach;
  }
  const crossing = groups.filter((g) => g.some((n) => ids.has(n.id))).flat();
  // 2) 고른 음 트랙에서 빈틈없이 이어진 음 (앞뒤로)
  const runs: Note[] = [];
  for (const t of new Set(owner.values())) {
    const sorted = [...t.notes].sort((a, b) => cmp(a.start, b.start));
    for (let i = 0; i < sorted.length; i++) {
      if (!ids.has(sorted[i]!.id)) continue;
      let lo = i;
      let hi = i;
      while (lo > 0 && eq(end(sorted[lo - 1]!), sorted[lo]!.start)) lo--;
      while (hi < sorted.length - 1 && eq(end(sorted[hi]!), sorted[hi + 1]!.start)) hi++;
      runs.push(...sorted.slice(lo, hi + 1));
    }
  }
  for (const wider of [crossing, runs]) {
    const uniq = [...new Map(wider.map((n) => [n.id, n])).values()];
    if (uniq.length <= picked.length) continue;
    const r = guessArpeggio(song, uniq, newId, locked, scores);
    if (r.ok) return r;
  }
  return direct;
}
