import { add, cmp, div, mul, rat, sub, ZERO, type Rat } from "./rat.js";
import type { Note, Song } from "./model.js";
import { chainSampleEnd, crossesTimbre, foldPitch, soundingRangeOf, type GameProfile } from "./profile.js";
import { roomBefore } from "./grace.js";
import { gameLengths, shortestLength, type LengthLimit } from "./note-length.js";
import { replaceNotes, tieChains } from "./note-edit.js";
import { positionToSeconds } from "./time.js";

/**
 * 기타 슬라이드: 두 음 사이(또는 한 음 앞뒤)를 반음씩 잇는 사이 음을 채운다. 높이가 다른 음을 &로 이으면
 * 게임은 다시 치지 않고 높이만 바꾸므로(실측), 사이 음을 모두 &로 이어 한 사슬로 만든다.
 * 결과만 계산하고 곡은 바꾸지 않는다
 */

/** 두 음 사이 / 미끄러져 들어가기 / 미끄러져 나가기 / 들어가고 나가기 (타브 "/14\\") */
export type SlideKind = "between" | "in" | "out" | "both";

/** 들어가기·나가기 한쪽: 출발(도착) 높이가 아래인지 위인지, 반음(= 프렛) 수, 미끄러지는 길이 */
export interface SlideSide {
  readonly direction: "down" | "up";
  readonly semitones: number;
  readonly length: Rat;
}

export interface SlideOptions {
  readonly kind: SlideKind;
  /** 반음씩 / 바로(사이 음 없이 &만) */
  readonly path: "chromatic" | "direct";
  /** 들어가기·나가기: 출발(도착) 높이가 아래인지 위인지와 반음 수. 들어가고 나가기에서는 들어가는 쪽 */
  readonly direction: "down" | "up";
  readonly semitones: number;
  /** 미끄러지는 데 쓸 길이 (온음표 단위). 들어가고 나가기에서는 들어가는 쪽 */
  readonly length: Rat;
  /** 들어가고 나가기의 나가는 쪽. 없으면 들어가는 쪽과 같은 거리·길이로 같은 쪽(아래에서 들어오면 아래로)으로 나간다 */
  readonly out?: SlideSide;
  /**
   * 들어가기를 어디서 가져오나. on(기본) = 도착 음 앞부분을 깎아 도착 음이 늦게 들린다.
   * before = 꾸밈음의 "박 앞"처럼 앞 음 꼬리(또는 앞 쉼표)에서 가져와 도착 음이 제 박에 들린다
   */
  readonly timing?: "on" | "before";
  /**
   * 음색 경계에서 끊기: 만든 사슬이 게임의 샘플 구간 경계(o3e·o4e·o5f 등)를 넘는 곳에서 &를 빼고 다시 친다
   * (&로 넘으면 게임은 새 구간 샘플로 바꿔 타서 음색이 튄다). 원래 있던 &는 건드리지 않는다
   */
  readonly breakAtZones?: boolean;
  /** 한 걸음 길이. 없으면 자동 (미끄러지는 길이를 걸음 수로 똑같이 나눔) */
  readonly step?: Rat;
  /** 트랙이 실제로 소리 내는 악기 (음역 접기·샘플 길이). 재생·검사와 같은 해석 */
  readonly instrument: string;
  readonly locked?: ReadonlySet<string>;
  /** 이 길이를 게임 길이로 정확히 쓸 수 있는지 (출력기와 같은 판정). 없으면 한 토막을 큰 것부터 채워 본다 */
  readonly canWrite?: (dur: Rat) => boolean;
  /** 사이 음을 놓을 타브 줄 (출발 음이 보이는 줄). 없으면 출발 음에 적어 둔 줄 */
  readonly stringOf?: (note: Note) => number | undefined;
}

export interface SlideResult {
  /** 바뀐 뒤 트랙 음 전체. 바뀐 것이 없으면 undefined */
  readonly notes?: readonly Note[];
  /** 만든 슬라이드 수 */
  readonly made: number;
  /** 만든 사슬의 음 id (출발 음·사이 음·도착 음). 적용 뒤 고른 음으로 쓴다 */
  readonly chain: readonly string[];
  /**
   * 건너뛴 수: 이어지지 않음 / 같은 높이 / 높이 차가 너무 큼 / 너무 짧음 / 이미 이어진 음 / 길이를 나눌 수 없음 /
   * 바로 잇는 두 음이 음색 경계를 넘어 끊으면 아무것도 남지 않음
   */
  readonly skipped: SlideSkipped;
  /** 음 길이보다 길어 줄인 미끄러지는 길이 수 */
  readonly shortened: number;
  /** 게임 최단 길이 때문에 반음을 건너뛴 곳 수 */
  readonly skippedSemitones: number;
  /** 샘플 끝에 닿아 소리가 일찍 끊길 수 있는 사슬 수 */
  readonly sampleCut: number;
  /** 음색 경계에서 &를 빼 다시 치게 한 곳 수 (breakAtZones) */
  readonly zoneBreaks: number;
  /** 끊지 않고 음색 경계를 &로 넘는 곳 수 (breakAtZones를 끈 때) */
  readonly zoneCrossings: number;
  /** 음색 경계 바로 뒤 음 id (끊었으면 다시 치는 음, 아니면 음색이 튀는 음). 미리 보기 표시용 */
  readonly zoneAt: readonly string[];
  /** 잠긴 트랙이라 바꾸지 않음 */
  readonly locked: boolean;
}

export interface SlideSkipped {
  readonly gap: number;
  readonly same: number;
  readonly bend: number;
  readonly short: number;
  readonly tied: number;
  readonly unsplittable: number;
  readonly zone: number;
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
  const skipped = { gap: 0, same: 0, bend: 0, short: 0, tied: 0, unsplittable: 0, zone: 0 };
  const empty = { made: 0, chain: [], skipped, shortened: 0, skippedSemitones: 0, sampleCut: 0, zoneBreaks: 0, zoneCrossings: 0, zoneAt: [], locked: false };
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

  const canWrite = options.canWrite ?? ((dur: Rat) => writable(dur, limit));
  /** 미끄러질 길이: 그 음 길이 이상이면 최단 길이는 남기고 줄인다. 음이 최단의 두 배보다 짧으면 undefined */
  const slideLength = (dur: Rat, want: Rat): Rat | undefined => {
    if (cmp(dur, mul(shortest, rat(2))) < 0) return undefined;
    if (cmp(want, dur) >= 0) {
      shortened++;
      return sub(dur, shortest);
    }
    return want;
  };
  /** 사슬 첫 음(접은 높이) 기준으로 높이 차 한도 안인지 */
  const withinBend = (head: number, pitches: readonly number[]) => pitches.every((p) => Math.abs(fold(p) - fold(head)) <= profile.tieBendLimit);
  const pitchAt = (from: number, d: number, sign: number, i: number, parts: number) => from + sign * Math.round((i * d) / parts);
  /** 사이 음에 넣을 타브 줄 */
  const tabOf = (n: Note) => {
    const string = options.stringOf?.(n) ?? n.tabString;
    return string !== undefined ? { tabString: string } : {};
  };
  const zoneAt: string[] = [];
  let zoneBreaks = 0;
  let zoneCrossings = 0;
  /** 만든 사슬 조각(시간 순)에서 음색 경계를 &로 넘는 곳: 끊기를 켰으면 앞 음의 &를 빼고, 아니면 센다 */
  const zones = (part: Note[]) => {
    for (let j = 0; j + 1 < part.length; j++) {
      const a = part[j]!;
      const b = part[j + 1]!;
      if (a.tie !== "next" || a.pitch === b.pitch || !crossesTimbre(profile, options.instrument, a.pitch, b.pitch)) continue;
      zoneAt.push(b.id);
      if (!options.breakAtZones) {
        zoneCrossings++;
        continue;
      }
      part[j] = { ...a, tie: "none" };
      changes.set(a.id, part[j]!);
      zoneBreaks++;
    }
  };

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
        // 끊기를 켰는데 경계를 넘으면 걸 &가 없다 (원래 &가 있던 쌍은 건드리지 않는다)
        if (options.breakAtZones && crossesTimbre(profile, options.instrument, a.pitch, b.pitch)) {
          skipped.zone++;
          continue;
        }
        if (a.tie !== "next") changes.set(a.id, { ...a, tie: "next" });
        if (crossesTimbre(profile, options.instrument, a.pitch, b.pitch)) {
          zoneAt.push(b.id);
          zoneCrossings++;
        }
        linkedHead.set(b.id, head);
        chainIds.push(a.id, b.id);
        touched.push([a, b]);
        made++;
        continue;
      }
      const L = slideLength(a.dur, options.length);
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
      const tab = tabOf(mine[i]!);
      const added: Note[] = run.durs.map((dur, j) => {
        const n: Note = { id: newId(), start: at, dur, pitch: pitches[j]!, vol: head.vol, tie: "next", ...tab };
        at = add(at, dur);
        return n;
      });
      for (const n of added) changes.set(n.id, n);
      if (tab.tabString !== undefined && b.tabString !== tab.tabString) changes.set(b.id, { ...current(b), tabString: tab.tabString });
      const part = [shortenedA, ...added, current(b)];
      zones(part);
      linkedHead.set(b.id, head);
      chainIds.push(a.id, ...added.map((n) => n.id), b.id);
      touched.push(part);
      made++;
    }
  } else {
    const wantIn = options.kind === "in" || options.kind === "both";
    const wantOut = options.kind === "out" || options.kind === "both";
    const inSide: SlideSide = { direction: options.direction, semitones: options.semitones, length: options.length };
    const outSide: SlideSide = options.kind === "both" ? (options.out ?? inSide) : inSide;
    /** 들어가기가 도착 음 앞부분을 깎는지 (박 앞이면 앞 음·쉼표에서 가져온다) */
    const cutIn = wantIn && options.timing !== "before";
    const distance = (side: SlideSide) => Math.max(1, Math.min(12, Math.round(side.semitones)));
    const split = (L: Rat, s: number) => (options.path === "direct" ? { durs: [L], lead: ZERO } : splitRun(L, s, 1, limit, options.step));
    for (const orig of mine) {
      const n = current(orig);
      if ((wantIn && adjacentPrev(orig)?.tie === "next") || (wantOut && n.tie === "next" && adjacentNext(orig))) {
        skipped.tied++;
        continue;
      }
      // 미끄러지는 길이: 도착 음에서 깎는 쪽(나가기, 박 위 들어가기)은 도착 음 길이 안에서
      let Lin: Rat | undefined = wantIn ? inSide.length : undefined;
      let Lout: Rat | undefined = wantOut ? outSide.length : undefined;
      if (cutIn && wantOut) {
        // 두 쪽이 음 하나를 나눠 쓴다: 합이 (음 길이 − 최단)을 넘으면 두 쪽 다 그 절반 이하에서 가장 긴 한 토막까지 줄인다
        const room = sub(n.dur, shortest);
        if (cmp(add(Lin!, Lout!), room) > 0) {
          const half = pieceAtMost(div(room, rat(2)), limit);
          if (!half || cmp(half, shortest) < 0) {
            skipped.short++;
            continue;
          }
          if (cmp(Lin!, half) > 0) Lin = half;
          if (cmp(Lout!, half) > 0) Lout = half;
          shortened++;
        }
      } else if (cutIn) Lin = slideLength(n.dur, Lin!);
      else if (wantOut) Lout = slideLength(n.dur, Lout!);
      if ((wantIn && !Lin) || (wantOut && !Lout)) {
        skipped.short++;
        continue;
      }
      const sIn = distance(inSide);
      const sOut = distance(outSide);
      const signIn = inSide.direction === "down" ? -1 : 1;
      const signOut = outSide.direction === "down" ? -1 : 1;
      const runIn = wantIn ? split(Lin!, sIn) : { durs: [], lead: ZERO };
      const runOut = wantOut ? split(Lout!, sOut) : { durs: [], lead: ZERO };
      if (!runIn || !runOut) {
        skipped.unsplittable++;
        continue;
      }
      if (options.path !== "direct" && ((wantIn && runIn.durs.length < sIn) || (wantOut && runOut.durs.length < sOut))) skippedSemitones++;
      // 들어가기: 출발 높이 음부터 사이 음까지 (도착 = 원래 음), 나가기: 사이 음부터 도착 높이 음까지 (출발 = 원래 음)
      const far = n.pitch + signIn * sIn;
      const inPitches = runIn.durs.map((_, j) => pitchAt(far, sIn, -signIn, j, runIn.durs.length));
      const outPitches = runOut.durs.map((_, j) => pitchAt(n.pitch, sOut, signOut, j + 1, runOut.durs.length));
      const head = wantIn ? far : chainOf.get(n.id)![0]!.pitch;
      const rest = wantIn && !wantOut ? (chainOf.get(n.id) ?? [n]) : [];
      if (!withinBend(head, [...inPitches, n.pitch, ...outPitches, ...rest.map((x) => x.pitch)])) {
        skipped.bend++;
        continue;
      }
      // 원래 음에서는 실제 사이 음 길이의 합만 뗀다 (직접 고른 걸음이 다 나누지 못한 나머지는 원래 음에 남긴다):
      // 박 위 들어가기는 사이 음 바로 뒤에 원래 음이 &로 이어지고, 나가기는 원래 끝을 지킨다
      const Rin = wantIn ? sub(Lin!, runIn.lead) : ZERO;
      const Rout = wantOut ? sub(Lout!, runOut.lead) : ZERO;
      let edit: Note | undefined;
      if (wantIn && !cutIn) {
        // 박 앞: 꾸밈음과 같은 자리 계산으로 앞 음 꼬리(또는 쉼표)에서 가져온다
        const own = replaceNotes(track.notes, changes, new Set(changes.keys())).sort((a, b) => cmp(a.start, b.start));
        const fit = roomBefore(own, n, Rin, canWrite, shortest);
        if (!fit.ok) {
          if (fit.why === "short") skipped.short++;
          else skipped.unsplittable++;
          continue;
        }
        edit = fit.prev;
      }
      const vol = wantIn ? n.vol : chainOf.get(n.id)![0]!.vol;
      const tab = tabOf(orig);
      let at = cutIn ? n.start : sub(n.start, Rin);
      const ins = runIn.durs.map((dur, j): Note => {
        const x: Note = { id: newId(), start: at, dur, pitch: inPitches[j]!, vol, tie: "next", ...tab };
        at = add(at, dur);
        return x;
      });
      const target: Note = { ...n, start: cutIn ? add(n.start, Rin) : n.start, dur: sub(sub(n.dur, cutIn ? Rin : ZERO), Rout), ...(wantOut ? { tie: "next" as const } : {}) };
      at = end(target);
      const outs = runOut.durs.map((dur, j): Note => {
        const x: Note = { id: newId(), start: at, dur, pitch: outPitches[j]!, vol, tie: j === runOut.durs.length - 1 ? "none" : "next", ...tab };
        at = add(at, dur);
        return x;
      });
      if (edit) changes.set(edit.id, edit);
      changes.set(n.id, target);
      for (const x of [...ins, ...outs]) changes.set(x.id, x);
      const part = [...ins, target, ...outs];
      zones(part);
      chainIds.push(...ins.map((x) => x.id), n.id, ...outs.map((x) => x.id));
      touched.push(part);
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
    for (const first of part) {
      const chain = after.find((c) => c.some((x) => x.id === first.id));
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
  }
  return { notes, made, chain: chainIds, skipped, shortened, skippedSemitones, sampleCut, zoneBreaks, zoneCrossings, zoneAt, locked: false };
}

/** 여러 트랙 슬라이드 결과 (화음: 줄마다 자기 트랙) */
export interface SlidesResult extends Omit<SlideResult, "notes" | "locked"> {
  /** 바뀐 트랙과 그 트랙 음 전체 */
  readonly changes: readonly { readonly trackId: string; readonly notes: readonly Note[] }[];
  /** 잠겨서 건너뛴 트랙 수 */
  readonly locked: number;
}

/**
 * 고른 음을 트랙마다 나눠 planSlide를 따로 돌린다. 화음은 줄마다 이미 자기 트랙(채널)에 있으므로 트랙을 새로 만들지 않고
 * (그래서 연주자 화음 수 한도를 넘지 않는다), 줄마다 자기 트랙 안에서 &로 미끄러진다. 예: 빈 자리에서 화음 전체로 "/" 들어가기,
 * 두 화음을 함께 고르면 줄마다 두 음 사이 (6-6-5-5 → 5-5-5-4)
 */
export function planSlides(
  song: Song,
  picked: readonly Note[],
  options: Omit<SlideOptions, "instrument"> & { readonly instrumentOf: (trackId: string) => string | undefined },
  profile: GameProfile,
  /** 새 음 id (그 음이 들어갈 트랙) */
  newId: (trackId: string) => string,
): SlidesResult {
  const ids = new Set(picked.map((n) => n.id));
  const skipped = { gap: 0, same: 0, bend: 0, short: 0, tied: 0, unsplittable: 0, zone: 0 };
  const changes: { trackId: string; notes: readonly Note[] }[] = [];
  const chain: string[] = [];
  const zoneAt: string[] = [];
  let made = 0;
  let shortened = 0;
  let skippedSemitones = 0;
  let sampleCut = 0;
  let zoneBreaks = 0;
  let zoneCrossings = 0;
  let locked = 0;
  for (const track of song.tracks) {
    const mine = track.notes.filter((n) => ids.has(n.id));
    if (mine.length === 0) continue;
    const r = planSlide(song, track.id, mine, { ...options, instrument: options.instrumentOf(track.id) ?? "" }, profile, () => newId(track.id));
    if (r.locked) {
      locked++;
      continue;
    }
    for (const key of Object.keys(skipped) as (keyof SlideSkipped)[]) skipped[key] += r.skipped[key];
    shortened += r.shortened;
    skippedSemitones += r.skippedSemitones;
    if (!r.notes) continue;
    changes.push({ trackId: track.id, notes: r.notes });
    chain.push(...r.chain);
    zoneAt.push(...r.zoneAt);
    made += r.made;
    sampleCut += r.sampleCut;
    zoneBreaks += r.zoneBreaks;
    zoneCrossings += r.zoneCrossings;
  }
  return { changes, made, chain, skipped, shortened, skippedSemitones, sampleCut, zoneBreaks, zoneCrossings, zoneAt, locked };
}

/**
 * 이미 있는 &가 음색 경계를 넘는 곳 (검사 "tie-across-boundary"와 같은 판정). 높이가 다른 두 음을 &로 이은 앞 음 id.
 * trackIds를 주면 그 트랙만
 */
export function timbreTies(song: Song, profile: GameProfile, instrumentOf: (trackId: string) => string | undefined, trackIds?: ReadonlySet<string>): { trackId: string; id: string }[] {
  const out: { trackId: string; id: string }[] = [];
  for (const track of song.tracks) {
    if (trackIds && !trackIds.has(track.id)) continue;
    const instrument = instrumentOf(track.id);
    const sorted = [...track.notes].sort((a, b) => cmp(a.start, b.start));
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      if (a.tie !== "next" || a.pitch === b.pitch || cmp(end(a), b.start) !== 0) continue;
      if (crossesTimbre(profile, instrument, a.pitch, b.pitch)) out.push({ trackId: track.id, id: a.id });
    }
  }
  return out;
}

/**
 * 음색 경계를 넘는 &를 모두 뺀다 (검사 목록의 "모두 끊기"). 뒤 음은 게임에서 새로 쳐서 음색이 튀지 않는다.
 * 잠근 트랙은 건드리지 않는다. 바뀐 트랙과 그 음 전체, 뺀 & 수
 */
export function breakTimbreTies(
  song: Song,
  profile: GameProfile,
  instrumentOf: (trackId: string) => string | undefined,
  locked?: ReadonlySet<string>,
): { changes: { trackId: string; notes: Note[] }[]; count: number } {
  const hits = timbreTies(song, profile, instrumentOf).filter((h) => !locked?.has(h.trackId));
  const byTrack = new Map<string, Set<string>>();
  for (const h of hits) {
    let set = byTrack.get(h.trackId);
    if (!set) byTrack.set(h.trackId, (set = new Set()));
    set.add(h.id);
  }
  const changes = song.tracks
    .filter((t) => byTrack.has(t.id))
    .map((t) => ({ trackId: t.id, notes: t.notes.map((n): Note => (byTrack.get(t.id)!.has(n.id) ? { ...n, tie: "none" } : n)) }));
  return { changes, count: hits.length };
}
