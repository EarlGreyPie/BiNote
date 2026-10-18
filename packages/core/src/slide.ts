import { add, cmp, div, mul, rat, sub, ZERO, type Rat } from "./rat.js";
import type { Note, Song } from "./model.js";
import { chainSampleEnd, foldPitch, soundingRangeOf, TIE_BEND_LIMIT, type GameProfile } from "./profile.js";
import { gameLengths, shortestLength, type LengthLimit } from "./note-length.js";
import { replaceNotes, tieChains } from "./note-edit.js";
import { positionToSeconds } from "./time.js";

/**
 * 기타 슬라이드: 두 음 사이(또는 한 음 앞뒤)를 반음씩 잇는 사이 음을 채운다. 높이가 다른 음을 &로 이으면
 * 게임은 다시 치지 않고 높이만 바꾸므로(실측), 사이 음을 모두 &로 이어 한 사슬로 만든다.
 * 결과만 계산하고 곡은 바꾸지 않는다
 */

/** 두 음 사이 / 미끄러져 들어가기 / 미끄러져 나가기 */
export type SlideKind = "between" | "in" | "out";

export interface SlideOptions {
  readonly kind: SlideKind;
  /** 반음씩 / 바로(사이 음 없이 &만) */
  readonly path: "chromatic" | "direct";
  /** 들어가기·나가기: 출발(도착) 높이가 아래인지 위인지와 반음 수 */
  readonly direction: "down" | "up";
  readonly semitones: number;
  /** 미끄러지는 데 쓸 길이 (온음표 단위) */
  readonly length: Rat;
  /** 한 걸음 길이. 없으면 자동 (미끄러지는 길이를 걸음 수로 똑같이 나눔) */
  readonly step?: Rat;
  /** 트랙이 실제로 소리 내는 악기 (음역 접기·샘플 길이). 재생·검사와 같은 해석 */
  readonly instrument: string;
  readonly locked?: ReadonlySet<string>;
}

export interface SlideResult {
  /** 바뀐 뒤 트랙 음 전체. 바뀐 것이 없으면 undefined */
  readonly notes?: readonly Note[];
  /** 만든 슬라이드 수 */
  readonly made: number;
  /** 만든 사슬의 음 id (출발 음·사이 음·도착 음). 적용 뒤 고른 음으로 쓴다 */
  readonly chain: readonly string[];
  /** 건너뛴 수: 이어지지 않음 / 같은 높이 / 높이 차가 너무 큼 / 너무 짧음 / 이미 이어진 음 / 길이를 나눌 수 없음 */
  readonly skipped: { readonly gap: number; readonly same: number; readonly bend: number; readonly short: number; readonly tied: number; readonly unsplittable: number };
  /** 음 길이보다 길어 줄인 미끄러지는 길이 수 */
  readonly shortened: number;
  /** 게임 최단 길이 때문에 반음을 건너뛴 곳 수 */
  readonly skippedSemitones: number;
  /** 샘플 끝에 닿아 소리가 일찍 끊길 수 있는 사슬 수 */
  readonly sampleCut: number;
  /** 잠긴 트랙이라 바꾸지 않음 */
  readonly locked: boolean;
}

const end = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);

/** 한 토막으로 쓰는 게임 길이인지 */
function isOnePiece(dur: Rat, limit: LengthLimit): boolean {
  return gameLengths(limit).some((g) => cmp(g.value, dur) === 0);
}

/** limit의 한 토막 길이 가운데 value 이하에서 가장 긴 것 */
function pieceAtMost(value: Rat, limit: LengthLimit): Rat | undefined {
  let best: Rat | undefined;
  for (const g of gameLengths(limit)) if (cmp(g.value, value) <= 0 && (!best || cmp(g.value, best) > 0)) best = g.value;
  return best;
}

/** 길이를 게임 한 토막들로 정확히 쓸 수 있는지 (한 토막 또는 같은 높이 &로 이은 여러 토막) */
function writable(dur: Rat, limit: LengthLimit): boolean {
  // 큰 것부터 채워 정확히 떨어지는지 (출력기는 더 넓게 찾지만 여기서는 걸음 길이를 고르는 데만 쓴다)
  const pieces = [...gameLengths(limit)].sort((a, b) => cmp(b.value, a.value));
  let left = dur;
  for (let guard = 0; guard < 16 && cmp(left, ZERO) > 0; guard++) {
    const p = pieces.find((x) => cmp(x.value, left) <= 0);
    if (!p) return false;
    left = sub(left, p.value);
  }
  return cmp(left, ZERO) === 0;
}

/**
 * 미끄러지는 길이 L을 걸음 k개로 나눈 길이들. 자동이면 k를 most에서 least까지 줄여 가며 L/k가 한 토막이고 최단 이상인 첫 k.
 * 없으면 앞 걸음은 한 토막(최단 이상), 마지막 걸음이 나머지(정확히 써지는 길이)를 맡는다. 직접 고른 걸음이면 그 길이로 나누고
 * 남는 나머지(lead)는 원래 음에 남긴다(사이·나가기는 출발 음, 들어가기는 도착 음). 나눌 수 없으면 undefined
 */
function splitRun(L: Rat, most: number, least: number, limit: LengthLimit, step: Rat | undefined): { durs: Rat[]; lead: Rat } | undefined {
  const shortest = shortestLength(limit);
  if (step) {
    let k = 0;
    while (cmp(mul(step, rat(k + 1)), L) <= 0) k++;
    k = Math.min(k, most);
    if (k < least) return undefined;
    return { durs: Array.from({ length: k }, () => step), lead: sub(L, mul(step, rat(k))) };
  }
  for (let k = most; k >= least; k--) {
    const each = div(L, rat(k));
    if (cmp(each, shortest) >= 0 && isOnePiece(each, limit)) return { durs: Array.from({ length: k }, () => each), lead: ZERO };
  }
  for (let k = most; k >= least; k--) {
    const each = pieceAtMost(div(L, rat(k)), limit);
    if (!each || cmp(each, shortest) < 0) continue;
    const last = sub(L, mul(each, rat(k - 1)));
    if (cmp(last, shortest) >= 0 && writable(last, limit)) return { durs: [...Array.from({ length: k - 1 }, () => each), last], lead: ZERO };
  }
  return undefined;
}

export function planSlide(song: Song, trackId: string, picked: readonly Note[], options: SlideOptions, profile: GameProfile, newId: () => string): SlideResult {
  const skipped = { gap: 0, same: 0, bend: 0, short: 0, tied: 0, unsplittable: 0 };
  const empty = { made: 0, chain: [], skipped, shortened: 0, skippedSemitones: 0, sampleCut: 0, locked: false };
  const track = song.tracks.find((t) => t.id === trackId);
  if (!track || picked.length === 0) return empty;
  if (options.locked?.has(trackId)) return { ...empty, locked: true };
  const limit = profile.length;
  const shortest = shortestLength(limit);
  const range = soundingRangeOf(profile, options.instrument);
  const fold = (p: number) => foldPitch(p, range);
  const sorted = [...track.notes].sort((a, b) => cmp(a.start, b.start));
  const ids = new Set(picked.map((n) => n.id));
  const mine = sorted.filter((n) => ids.has(n.id));
  const indexOf = new Map(sorted.map((n, i) => [n.id, i]));
  /** 음이 든 & 사슬 (편집 전) */
  const chains = tieChains(sorted);
  const chainOf = new Map<string, Note[]>();
  for (const c of chains) for (const n of c) chainOf.set(n.id, c);
  const adjacentNext = (n: Note) => {
    const next = sorted[(indexOf.get(n.id) ?? -1) + 1];
    return next && cmp(end(n), next.start) === 0 ? next : undefined;
  };
  const adjacentPrev = (n: Note) => {
    const prev = sorted[(indexOf.get(n.id) ?? 0) - 1];
    return prev && cmp(end(prev), n.start) === 0 ? prev : undefined;
  };

  const changes = new Map<string, Note>();
  const chainIds: string[] = [];
  const touched: Note[][] = [];
  let shortened = 0;
  let skippedSemitones = 0;
  let made = 0;
  const current = (n: Note) => changes.get(n.id) ?? n;

  /** 미끄러질 길이: 그 음 길이 이상이면 최단 길이는 남기고 줄인다. 음이 최단의 두 배보다 짧으면 undefined */
  const slideLength = (dur: Rat): Rat | undefined => {
    if (cmp(dur, mul(shortest, rat(2))) < 0) return undefined;
    if (cmp(options.length, dur) >= 0) {
      shortened++;
      return sub(dur, shortest);
    }
    return options.length;
  };
  /** 사슬 첫 음(접은 높이) 기준으로 높이 차 한도 안인지 */
  const withinBend = (head: number, pitches: readonly number[]) => pitches.every((p) => Math.abs(fold(p) - fold(head)) <= TIE_BEND_LIMIT);
  const pitchAt = (from: number, d: number, sign: number, i: number, parts: number) => from + sign * Math.round((i * d) / parts);

  if (options.kind === "between") {
    /** 이번에 이은 음의 사슬 첫 음 (c→d→e를 이으면 e의 사슬 첫 음은 c) */
    const linkedHead = new Map<string, Note>();
    for (let i = 0; i + 1 < mine.length; i++) {
      const a = current(mine[i]!);
      const b = mine[i + 1]!;
      if (adjacentNext(mine[i]!)?.id !== b.id) {
        skipped.gap++;
        continue;
      }
      if (a.pitch === b.pitch) {
        skipped.same++;
        continue;
      }
      const d = Math.abs(b.pitch - a.pitch);
      const sign = Math.sign(b.pitch - a.pitch);
      const head = linkedHead.get(a.id) ?? chainOf.get(a.id)![0]!;
      const after = (chainOf.get(b.id) ?? [b]).slice((chainOf.get(b.id) ?? [b]).findIndex((x) => x.id === b.id));
      // 사이 음이 없는(반음 하나, 바로) 쌍은 &만 건다
      if (options.path === "direct" || d === 1) {
        if (!withinBend(head.pitch, after.map((x) => x.pitch))) {
          skipped.bend++;
          continue;
        }
        if (a.tie !== "next") changes.set(a.id, { ...a, tie: "next" });
        linkedHead.set(b.id, head);
        chainIds.push(a.id, b.id);
        touched.push([a, b]);
        made++;
        continue;
      }
      const L = slideLength(a.dur);
      if (!L) {
        skipped.short++;
        continue;
      }
      const run = splitRun(L, d - 1, 1, limit, options.step);
      if (!run) {
        skipped.unsplittable++;
        continue;
      }
      const k = run.durs.length;
      const pitches = run.durs.map((_, j) => pitchAt(a.pitch, d, sign, j + 1, k + 1));
      if (!withinBend(head.pitch, [...pitches, ...after.map((x) => x.pitch)])) {
        skipped.bend++;
        continue;
      }
      if (k < d - 1) skippedSemitones++;
      // 출발 음은 미끄러지는 길이만큼 줄고 (직접 고른 걸음의 나머지는 출발 음에 붙는다), 그 뒤에 사이 음이 온다
      const shortenedA: Note = { ...a, dur: add(sub(a.dur, L), run.lead), tie: "next" };
      const startAt = end(shortenedA);
      changes.set(a.id, shortenedA);
      let at = startAt;
      const added: Note[] = run.durs.map((dur, j) => {
        const n: Note = { id: newId(), start: at, dur, pitch: pitches[j]!, vol: head.vol, tie: "next", ...(a.tabString !== undefined ? { tabString: a.tabString } : {}) };
        at = add(at, dur);
        return n;
      });
      for (const n of added) changes.set(n.id, n);
      if (a.tabString !== undefined && b.tabString !== a.tabString) changes.set(b.id, { ...current(b), tabString: a.tabString });
      linkedHead.set(b.id, head);
      chainIds.push(a.id, ...added.map((n) => n.id), b.id);
      touched.push([shortenedA, ...added, b]);
      made++;
    }
  } else {
    const sign = options.direction === "down" ? -1 : 1;
    const s = Math.max(1, Math.min(12, Math.round(options.semitones)));
    for (const orig of mine) {
      const n = current(orig);
      if (options.kind === "in" ? adjacentPrev(orig)?.tie === "next" : n.tie === "next" && adjacentNext(orig)) {
        skipped.tied++;
        continue;
      }
      const L = slideLength(n.dur);
      if (!L) {
        skipped.short++;
        continue;
      }
      // 들어가기: 출발 높이 음부터 사이 음까지 (도착 = 원래 음), 나가기: 사이 음부터 도착 높이 음까지 (출발 = 원래 음)
      const far = n.pitch + sign * s;
      const run = options.path === "direct" ? { durs: [L], lead: ZERO } : splitRun(L, s, 1, limit, options.step);
      if (!run) {
        skipped.unsplittable++;
        continue;
      }
      const k = run.durs.length;
      if (options.path !== "direct" && k < s) skippedSemitones++;
      const pitches =
        options.kind === "in"
          ? run.durs.map((_, j) => pitchAt(far, s, -sign, j, k))
          : run.durs.map((_, j) => pitchAt(n.pitch, s, sign, j + 1, k));
      const head = options.kind === "in" ? far : chainOf.get(n.id)![0]!.pitch;
      const rest = options.kind === "in" ? (chainOf.get(n.id) ?? [n]) : [];
      if (!withinBend(head, [...pitches, n.pitch, ...rest.map((x) => x.pitch)])) {
        skipped.bend++;
        continue;
      }
      const vol = options.kind === "in" ? n.vol : chainOf.get(n.id)![0]!.vol;
      // 원래 음에서는 실제 사이 음 길이의 합만 뗀다 (직접 고른 걸음이 L을 다 나누지 못한 나머지는 원래 음에 남긴다):
      // 들어가기는 사이 음 바로 뒤에 원래 음이 &로 이어지고, 나가기는 원래 끝을 지킨다
      const R = sub(L, run.lead);
      const tab = n.tabString !== undefined ? { tabString: n.tabString } : {};
      if (options.kind === "in") {
        let at = n.start;
        const added = run.durs.map((dur, j): Note => {
          const x: Note = { id: newId(), start: at, dur, pitch: pitches[j]!, vol, tie: "next", ...tab };
          at = add(at, dur);
          return x;
        });
        const moved: Note = { ...n, start: add(n.start, R), dur: sub(n.dur, R) };
        changes.set(n.id, moved);
        for (const x of added) changes.set(x.id, x);
        chainIds.push(...added.map((x) => x.id), n.id);
        touched.push([...added, moved]);
      } else {
        const kept: Note = { ...n, dur: sub(n.dur, R), tie: "next" };
        let at = end(kept);
        const added = run.durs.map((dur, j): Note => {
          const x: Note = { id: newId(), start: at, dur, pitch: pitches[j]!, vol, tie: j === k - 1 ? "none" : "next", ...tab };
          at = add(at, dur);
          return x;
        });
        changes.set(n.id, kept);
        for (const x of added) changes.set(x.id, x);
        chainIds.push(n.id, ...added.map((x) => x.id));
        touched.push([kept, ...added]);
      }
      made++;
    }
  }

  if (made === 0) return { ...empty, skipped, shortened, skippedSemitones };
  const notes = replaceNotes(track.notes, changes, new Set(changes.keys()));
  // 만든 사슬마다 샘플 끝에 닿는지 (재생·악보 검사와 같은 식). 사슬 전체(앞뒤로 이어진 음 포함)로 잰다
  const after = tieChains(notes);
  const seen = new Set<Note[]>();
  let sampleCut = 0;
  for (const part of touched) {
    const chain = after.find((c) => c.some((x) => x.id === part[0]!.id));
    if (!chain || seen.has(chain)) continue;
    seen.add(chain);
    const steps: { at: number; pitch: number }[] = [];
    for (const x of chain) {
      const pitch = fold(x.pitch);
      if (steps.at(-1)?.pitch !== pitch) steps.push({ at: positionToSeconds(song.tempo, x.start), pitch });
    }
    const soundEnd = chainSampleEnd(profile, options.instrument, steps);
    if (soundEnd < positionToSeconds(song.tempo, end(chain.at(-1)!)) - 1e-9) sampleCut++;
  }
  return { notes, made, chain: chainIds, skipped, shortened, skippedSemitones, sampleCut, locked: false };
}
