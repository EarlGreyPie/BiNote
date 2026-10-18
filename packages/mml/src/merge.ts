import { add, cmp, eq, rat, sub, trackInstrument, type GameProfile, type Note, type Rat, type Song, type Track } from "@mmlce/core";
import { chordsPerScore, scoreChunks } from "./clipboard.js";
import { optimizeMml } from "./optimizer.js";
import { parseMml } from "./parser.js";
import { sameSound } from "./compare.js";
import { canPlaceTempoAt } from "./tempo-placement.js";
import { audibleTempo } from "./tempo-text.js";

/**
 * 화음 병합. MIDI를 가져오면 잠깐 화음이 늘어난 자리의 음이 따로 트랙에 남아, 음이 드문드문한 트랙이 생긴다.
 * 그런 드문 트랙의 음을, 같은 악기 트랙 중 그 시간에 쉬고 있는 트랙으로 옮겨 트랙 수를 줄인다.
 * 같은 악기 안에서 옮기므로 소리는 같고, 음을 빼거나 줄이지 않는다. 다른 트랙과 겹치는 음은 그대로 둔다.
 *
 * - 옮기는 단위 = 음 하나, 또는 &로 이어진 음 묶음 전체.
 * - 음이 적은 트랙에서 많은 트랙으로만 옮긴다 (되돌려 보내지 않는다). 음 수가 같은 트랙끼리는 주고받지 않는다.
 * - 같은 게임 악보 안에서 악기·끄기·솔로·채널 볼륨·팬이 모두 같은 트랙끼리만 옮긴다. 잠근 트랙은 보내지도 받지도 않는다.
 * - 받는 트랙이 여럿이면 옮기는 자리 앞뒤 음과 높이가 가장 가까운 트랙 (옥타브 명령이 덜 붙는다).
 *   앞뒤 음과 완전5도(MERGE_MAX_JUMP)보다 멀면 그 트랙에는 넣지 않는다 (선율이 이상하게 튀지 않게).
 * - 받는 트랙의 앞 음에 &가 붙어 있어 옮긴 음과 이어지게 되면(슬라이드가 생기면) 그 트랙에는 넣지 않는다.
 * - 받는 트랙이 한도를 새로 넘거나, 일부만 옮기는데 글자 수 합이 늘면 옮기지 않는다 (mergeVoices).
 * - 음을 모두 보낸 트랙은 지운다. 처음부터 비어 있던 트랙은 그대로 둔다.
 *
 * 위 규칙은 빠르게 거르는 것일 뿐이다. 병합을 받아들일지는 mergeResult(곡 메뉴)·midiToSong(MIDI 가져오기)이
 * 게임에 붙여넣을 최종 출력을 악보마다 다시 읽어(gameTimeline) 병합 전과 같은지로만 정한다.
 * 악보 나뉨·악보마다의 끝이 바뀌어도 받아들이지 않는다.
 */
export interface MergeResult {
  readonly song: Song;
  /** 옮긴 음 수 */
  readonly moved: number;
  /** 음을 모두 보내 지운 트랙 id */
  readonly removed: string[];
}

export interface MergeOptions {
  /** 잠근 트랙 id: 음을 빼지도 넣지도 않는다 */
  readonly locked?: ReadonlySet<string>;
  /** 주면 이 연주자들의 트랙만 병합한다 (최종 출력 검사를 연주자마다 따로 하려고) */
  readonly players?: ReadonlySet<string>;
  /** 음을 모두 보낸 트랙도 빈 트랙으로 남긴다 (지우면 뒤 트랙이 앞 악보로 당겨질 때) */
  readonly keepEmpty?: boolean;
}

export function mergeChords(song: Song, profile: GameProfile, options: MergeOptions = {}): MergeResult {
  const groups = new Map<string, number[]>();
  // 음은 같은 게임 악보 안에서만 옮긴다 (악보마다 따로 연주되므로)
  const scoreOf = new Map<string, number>();
  scoreChunks(song, chordsPerScore(song, profile)).forEach((c, i) => c.trackIds.forEach((id) => scoreOf.set(id, i)));
  song.tracks.forEach((t, k) => {
    if (options.locked?.has(t.id)) return;
    if (options.players && !options.players.has(t.playerId)) return;
    const inst = trackInstrument(song, t);
    // 소리가 같아야 하므로 악기뿐 아니라 끄기·솔로·채널 볼륨·팬도 같은 트랙끼리만
    const key = `${scoreOf.get(t.id) ?? -1}|${t.playerId}|${inst.canonical}|${inst.program ?? ""}|${t.mute}|${t.solo}|${t.mix?.volume ?? ""}|${t.mix?.pan ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), k]);
  });
  const notes = song.tracks.map((t) => [...t.notes].sort((a, b) => cmp(a.start, b.start)));
  const tempo = audibleTempo(song.tempo).map((e) => e.at);
  let moved = 0;
  for (const mine of groups.values()) {
    if (mine.length < 2) continue;
    const r = mergeVoices(mine.map((k) => notes[k]!), { limit: profile.charLimitPerScore, tempo });
    mine.forEach((k, j) => (notes[k] = r.tracks[j]!));
    moved += r.moved;
  }
  if (moved === 0) return { song, moved: 0, removed: [] };

  const removed: string[] = [];
  const tracks: Track[] = [];
  song.tracks.forEach((t, k) => {
    const next = notes[k]!;
    // 음 수가 같아도 받고 준 음이 다를 수 있으니(하나 받고 하나 보냄) 음 하나하나로 비교한다.
    // id는 다른 편집이 겹치게 만들었을 수 있어 쓰지 않는다
    const before = new Set(t.notes);
    if (next.length === t.notes.length && next.every((n) => before.has(n))) {
      tracks.push(t);
      return;
    }
    if (next.length === 0 && !options.keepEmpty) {
      removed.push(t.id);
      return;
    }
    // 음이 바뀐 트랙은 원문을 지우고 출력기가 다시 쓴다
    const { mml: _mml, ...rest } = t;
    tracks.push({ ...rest, notes: next });
  });
  return { song: { ...song, tracks }, moved, removed };
}

export interface MergeVoiceOptions {
  /** 채널 글자 수 한도 (게임 악보 한 권). 받는 트랙이 이 한도를 새로 넘거나 악보책 권 수가 늘 만큼 길어지면 옮기지 않는다 */
  readonly limit: number;
  /**
   * 곡 템포 자리. 옮기기 전에 그 자리에 템포를 정확히 쓸 수 있던 트랙은 옮긴 뒤에도 쓸 수 있어야 한다
   * (못 쓰면 출력기가 템포를 뒤 음 경계로 미뤄 게임에서 빠르기가 바뀌는 자리가 달라진다)
   */
  readonly tempo?: readonly Rat[];
  /** 채널 글자 수. 생략하면 최적화 출력기 글자 수. 출력기가 그대로 쓰지 못하면(다시 읽은 음이 다르면) undefined */
  readonly length?: (notes: readonly Note[]) => number | undefined;
}

/** 받는 트랙의 앞뒤 음과 이보다 멀면(반음) 넣지 않는다: 완전5도. 선율이 튀고 옥타브 명령이 붙는다 */
export const MERGE_MAX_JUMP = 7;
/** 이만큼(온음표) 안에 있는 앞뒤 음만 높이를 비교한다. 오래 쉰 뒤의 음은 이어지는 선율로 보지 않는다 */
const NEAR = rat(1, 1);

/**
 * 같은 악기 트랙들(각각 시작 순으로 정렬, 서로 겹치지 않음) 사이에서 드문 트랙의 음을 쉬는 트랙으로 옮긴다.
 * MIDI 가져오기도 이것을 쓴다. 비게 된 트랙도 빈 배열로 그 자리에 남긴다.
 *
 * 글자 수: 한 트랙에서 옮길 음을 다 정한 뒤, 받는 트랙이 한도를 새로 넘지 않을 때만(이미 넘는 트랙은 악보책 권 수가
 * 늘지 않을 때만) 옮긴다. 보내는 트랙이 다 비지 않고 일부만 옮길 때는 보내는 트랙과 받는 트랙의 글자 수 합도 늘지 않아야 한다.
 * 한꺼번에 안 되면 받는 트랙마다 따로 따져 된 것만 옮긴다.
 */
export function mergeVoices(tracks: readonly (readonly Note[])[], options: MergeVoiceOptions): { tracks: Note[][]; moved: number } {
  const length = options.length ?? printedLength;
  const limit = options.limit;
  const tempo = options.tempo ?? [];
  const out = tracks.map((t) => [...t].sort((a, b) => cmp(a.start, b.start)));
  const count = out.map((t) => t.length);
  // 글자 수는 옮겨 볼 때 처음 센다 (옮길 자리가 없는 트랙은 세지 않는다)
  const known: (number | undefined | null)[] = out.map(() => null);
  const size = (k: number) => {
    if (known[k] === null) known[k] = length(out[k]!);
    return known[k] ?? undefined;
  };
  // 음이 적은 트랙부터 보낸다. 같으면 아래 트랙부터 (위 트랙이 이어받게)
  const order = out.map((_, k) => k).filter((k) => count[k]! > 0).sort((a, b) => count[a]! - count[b]! || b - a);
  const books = (n: number) => Math.max(1, Math.ceil(n / limit));
  const roomy = (before: number, after: number) => after <= limit || books(after) <= books(before);
  let moved = 0;

  order.forEach((from, rank) => {
    // 받는 트랙: 순서상 뒤에 있고(되돌려 보내지 않게) 음이 더 많은 트랙
    const targets = order.slice(rank + 1).filter((to) => count[to]! > count[from]!);
    if (targets.length === 0) return;
    // 묶음마다 받을 트랙을 정한다 (아직 옮기지 않음. 앞서 정한 묶음도 받는 트랙의 자리를 차지한다)
    const planned = new Map<number, Note[]>(targets.map((to) => [to, [...out[to]!]]));
    const plan: { unit: Note[]; to: number }[] = [];
    for (const unit of chains(out[from]!)) {
      let best: number | undefined;
      let bestCost = Infinity;
      for (const to of targets) {
        const cost = fit(planned.get(to)!, unit);
        if (cost < bestCost) {
          bestCost = cost;
          best = to;
        }
      }
      if (best === undefined) continue;
      plan.push({ unit, to: best });
      planned.set(best, insert(planned.get(best)!, unit));
    }
    if (plan.length === 0) return;

    // 옮길 묶음을 넣고 빼 본다. 된 경우에만 out·글자 수를 바꾼다
    const attempt = (moves: readonly { unit: Note[]; to: number }[]): boolean => {
      if (moves.length === 0) return false;
      // 음 하나하나로 뺀다 (id가 겹친 음이 함께 빠지지 않게)
      const gone = new Set(moves.flatMap((m) => m.unit));
      const source = out[from]!.filter((n) => !gone.has(n));
      const next = new Map<number, Note[]>();
      for (const m of moves) next.set(m.to, insert(next.get(m.to) ?? out[m.to]!, m.unit));
      if (!keepsTempo(source, next)) return false;
      const sourceSize = length(source);
      if (sourceSize === undefined) return false;
      let before = size(from) ?? Infinity;
      let after = sourceSize;
      const nextSizes = new Map<number, number>();
      for (const [to, notes] of next) {
        const grown = length(notes);
        // 옮긴 뒤 출력기가 쓰지 못하는 길이(예: 1/96 쉼)가 생기면 옮기지 않는다
        if (grown === undefined) return false;
        const was = size(to) ?? Infinity;
        if (!roomy(was, grown)) return false;
        nextSizes.set(to, grown);
        before += was;
        after += grown;
      }
      // 트랙 하나를 통째로 비우면 채널이 하나 줄어드니 글자 수 합이 조금 늘어도 옮긴다 (받는 트랙 한도는 위에서 지킨다)
      if (after > before && source.length > 0) return false;
      out[from] = source;
      known[from] = sourceSize;
      for (const [to, notes] of next) {
        out[to] = notes;
        known[to] = nextSizes.get(to)!;
        count[to] = notes.length;
      }
      count[from] = source.length;
      moved += moves.reduce((sum, m) => sum + m.unit.length, 0);
      return true;
    };
    /** 템포를 정확히 쓸 수 있던 트랙은 옮긴 뒤에도 쓸 수 있다. 보내는 트랙이 비면 그 몫은 같은 악기 다른 트랙이 맡아야 한다 */
    function keepsTempo(source: readonly Note[], next: ReadonlyMap<number, Note[]>): boolean {
      for (const at of tempo) {
        for (const [to, notes] of next) if (canPlaceTempoAt(out[to]!, at) && !canPlaceTempoAt(notes, at)) return false;
        if (!canPlaceTempoAt(out[from]!, at)) continue;
        if (source.length > 0 ? !canPlaceTempoAt(source, at) : !out.some((t, k) => k !== from && t.length > 0 && canPlaceTempoAt(next.get(k) ?? t, at))) return false;
      }
      return true;
    }
    if (attempt(plan)) return;
    for (const to of targets) attempt(plan.filter((m) => m.to === to));
  });
  return { tracks: out, moved };
}

/** 최적화 출력기 글자 수. 다시 읽은 음이 원래 음과 다르면(쓸 수 없는 길이) undefined */
function printedLength(notes: readonly Note[]): number | undefined {
  if (notes.length === 0) return 0;
  const text = optimizeMml(notes).text;
  return sameSound(notes, parseMml(text).notes) ? text.length : undefined;
}

function insert(track: readonly Note[], unit: readonly Note[]): Note[] {
  const at = track.findIndex((n) => cmp(n.start, unit[0]!.start) > 0);
  const out = [...track];
  out.splice(at < 0 ? out.length : at, 0, ...unit);
  return out;
}

/** &로 이어진 음(앞 음 끝 = 다음 음 시작)은 한 묶음 */
function chains(notes: readonly Note[]): Note[][] {
  const out: Note[][] = [];
  let chain: Note[] = [];
  notes.forEach((n, i) => {
    chain.push(n);
    const next = notes[i + 1];
    if (n.tie === "next" && next && eq(add(n.start, n.dur), next.start)) return;
    out.push(chain);
    chain = [];
  });
  return out;
}

/**
 * 묶음을 이 트랙에 넣을 수 있으면 가까운 앞뒤 음과의 평균 높이 차, 없으면 Infinity.
 * 겹치거나, &가 새로 이어지거나, 가까운 앞뒤 음과 MERGE_MAX_JUMP보다 멀면 넣지 않는다.
 * 가까운 앞뒤 음이 없으면(그 트랙이 오래 쉬는 자리) 넣을 수는 있지만 가장 나중에 고른다
 */
function fit(track: readonly Note[], unit: readonly Note[]): number {
  const start = unit[0]!.start;
  const last = unit[unit.length - 1]!;
  const end = add(last.start, last.dur);
  // 끝이 start보다 뒤인 첫 음 (트랙은 시작 순이고 겹치지 않으니 끝도 순서대로다)
  let lo = 0;
  let hi = track.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cmp(add(track[mid]!.start, track[mid]!.dur), start) <= 0) lo = mid + 1;
    else hi = mid;
  }
  const prev: Note | undefined = track[lo - 1];
  const next: Note | undefined = track[lo];
  if (next && cmp(next.start, end) < 0) return Infinity; // 겹친다
  // &가 새로 이어지면 소리가 바뀐다 (같은 높이는 붙임, 다른 높이는 슬라이드)
  if (prev && prev.tie === "next" && eq(add(prev.start, prev.dur), start)) return Infinity;
  if (next && last.tie === "next" && eq(end, next.start)) return Infinity;
  const near: number[] = [];
  if (prev && cmp(sub(start, add(prev.start, prev.dur)), NEAR) <= 0) near.push(Math.abs(prev.pitch - unit[0]!.pitch));
  if (next && cmp(sub(next.start, end), NEAR) <= 0) near.push(Math.abs(next.pitch - last.pitch));
  if (near.some((d) => d > MERGE_MAX_JUMP)) return Infinity;
  // 앞 음과 v가 다르면 v 명령이 붙으니 같은 높이 차면 v가 같은 트랙을 고른다
  const vol = prev && prev.vol !== unit[0]!.vol ? 0.5 : 0;
  return (near.length === 0 ? 100 : near.reduce((a, b) => a + b, 0) / near.length) + vol;
}

