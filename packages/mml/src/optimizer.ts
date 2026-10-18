import { add, cmp, defaultLengthLimit, gameLengths, sub, ZERO, type LengthLimit, type Rat } from "@mmlce/core";
import { continues, mergeTies, sameSound } from "./compare.js";
import { parseMml } from "./parser.js";
import { printMml, splitDuration, type PrintableNote, type PrintOptions, type PrintResult } from "./printer.js";

/**
 * 글자 수를 줄이는 출력기 (설계 6장).
 *
 * 볼륨은 음마다 정해지므로 고를 것이 없다. 고를 수 있는 것은
 * (1) 기본 길이 l을 언제 무엇으로 바꿀지, (2) 길이를 어떤 토막(&)으로 나눠 쓸지,
 * (3) 옥타브 경계 음을 어느 옥타브 이름으로 쓸지 세 가지다.
 * 상태 = (옥타브, 기본 길이)로 두고 음·쉼표마다 DP로 가장 짧은 경로를 고른다.
 *
 * 사용자 곡에서 쓰이는 두 표기도 쓴다: 숫자 없이 점만 붙이기(l8에서 c. = 점8분),
 * 옥타브 경계 음을 b+ / c- 로 쓰기. 끄는 옵션이 있다.
 * 결과는 다시 읽어 원래 음과 소리가 같은지 확인하고, 다르거나 더 길면 단순 출력기 결과를 쓴다.
 */
export function optimizeMml(notes: readonly PrintableNote[], options: OptimizeOptions = {}): PrintResult {
  const fallback = printMml(notes, options);
  const lengths = options.lengths ?? defaultLengthLimit();
  const optimized = optimizeText(notes, options, lengths);
  if (optimized === undefined || optimized.length >= fallback.text.length) return fallback;
  const check = parseMml(optimized, { octave: options.octave ?? 4, volume: options.volume ?? 8 });
  if (!sameSound(check.notes, mergeTies(notes))) return fallback;
  return { text: optimized, diagnostics: fallback.diagnostics };
}

const NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"] as const;

interface Piece {
  readonly length: number;
  readonly dots: number;
  readonly value: Rat;
}

/** 길이 상태 번호: (length - 1) * (maxDots + 1) + dots */
type State = number;

interface Element {
  readonly kind: "note" | "rest";
  /** 앞에 붙는 템포 */
  readonly tempo: string;
  /** 볼륨 (음 앞, 옥타브 뒤) */
  readonly vol: string;
  readonly pitch: number;
  /** 템포 때문에 나뉜 같은 음의 뒷부분. "&"로 시작하고 옥타브·l을 바꾸지 않는다 */
  readonly cont: boolean;
  /** &와 음 사이에는 l을 끼우지 않는다 (게임에서 확인 전) */
  readonly noSwitch: boolean;
  /** 뒤에 붙는 고정 글자 (다음 음과 잇는 &) */
  readonly suffix: string;
  readonly choices: readonly Piece[][];
}

export interface OptimizeOptions extends PrintOptions {
  /** l8에서 c. 처럼 숫자 없이 점만 쓰는 표기 (기본 켬, 사용자 곡에서 쓰이는 표기) */
  readonly bareDots?: boolean;
  /** 옥타브 경계 음을 b+ / c- 로 써서 옥타브 바꾸기를 줄이기 (기본 켬) */
  readonly enharmonic?: boolean;
}

function optimizeText(
  input: readonly PrintableNote[],
  options: OptimizeOptions,
  lengths: LengthLimit,
): string | undefined {
  const maxDots = lengths.dots;
  const notes = mergeTies(input);
  const tempo = [...(options.tempo ?? [])].sort((a, b) => cmp(a.at, b.at));
  const table = pieces(lengths);
  const elements: Element[] = [];

  let volume = options.volume ?? 8;
  let pos: Rat = ZERO;
  let tempoIndex = 0;
  let pending = "";

  const flushTempo = (at: Rat) => {
    while (tempoIndex < tempo.length && cmp(tempo[tempoIndex]!.at, at) <= 0) {
      pending += `t${tempo[tempoIndex]!.bpm}`;
      tempoIndex++;
    }
  };

  // [from, to)를 템포 위치에서 끊는다
  const segments = (from: Rat, to: Rat): Rat[] => {
    const cuts: Rat[] = [];
    let cursor = from;
    for (let k = tempoIndex; k < tempo.length; k++) {
      const at = tempo[k]!.at;
      if (cmp(at, cursor) > 0 && cmp(at, to) < 0) {
        cuts.push(sub(at, cursor));
        cursor = at;
      }
    }
    cuts.push(sub(to, cursor));
    return cuts;
  };

  const rest = (until: Rat) => {
    for (const seg of segments(pos, until)) {
      flushTempo(pos);
      const choices = decompositions(seg, table);
      if (!choices) return false;
      elements.push({ kind: "rest", tempo: pending, vol: "", pitch: 0, cont: false, noSwitch: false, suffix: "", choices });
      pending = "";
      pos = add(pos, seg);
    }
    return true;
  };

  let prev: PrintableNote | undefined;
  for (const note of notes) {
    if (cmp(note.start, pos) < 0) return undefined;
    if (cmp(note.start, pos) > 0 && !rest(note.start)) return undefined;
    flushTempo(pos);
    // & 뒤의 v는 게임이 무시하므로 쓰지 않고, 마지막으로 쓴 v도 그대로 둔다
    const continued = prev !== undefined && continues(prev, note);
    prev = note;
    const vol = !continued && note.vol !== volume ? `v${note.vol}` : "";
    if (!continued) volume = note.vol;
    const segs = segments(note.start, add(note.start, note.dur));
    for (let k = 0; k < segs.length; k++) {
      const seg = segs[k]!;
      if (k > 0) flushTempo(pos);
      const choices = decompositions(seg, table);
      if (!choices) return undefined;
      const last = k === segs.length - 1;
      elements.push({
        kind: "note",
        // 템포가 음 중간에 걸리면 "음 t &음" 순서로 쓴다 (출력기와 같음)
        tempo: pending,
        vol: k === 0 ? vol : "",
        pitch: note.pitch,
        cont: k > 0,
        noSwitch: k > 0 || elements[elements.length - 1]?.suffix === "&",
        suffix: last && note.tie === "next" ? "&" : "",
        choices,
      });
      pending = "";
      pos = add(pos, seg);
    }
  }
  if (tempoIndex < tempo.length) {
    const lastAt = tempo[tempo.length - 1]!.at;
    if (cmp(lastAt, pos) > 0 && !rest(lastAt)) return undefined;
    flushTempo(lastAt);
  }

  return solve(elements, options, maxDots) + pending;
}

const octaveOf = (pitch: number) => Math.floor(pitch / 12) - 1;

/** 옥타브 o에서 이 음을 쓰는 이름. 경계 음은 b+(위 옥타브 도), c-(아래 옥타브 시)로도 쓴다 */
function nameIn(pitch: number, octave: number): string | undefined {
  const semi = pitch - (octave + 1) * 12;
  if (semi >= 0 && semi < 12) return NAMES[semi];
  if (semi === 12) return "b+";
  if (semi === -1) return "c-";
  return undefined;
}

function octaveText(from: number, to: number): string {
  if (from === to) return "";
  const relative = (to > from ? ">" : "<").repeat(Math.abs(to - from));
  const absolute = `o${to}`;
  return relative.length <= absolute.length ? relative : absolute;
}

/**
 * DP. 상태 = (옥타브, 기본 길이). 옥타브는 음이 정하지만 경계 음은 두 옥타브 중 고를 수 있다.
 * 기본 길이를 바꾸는 비용은 "l숫자점" 글자 수.
 */
function solve(elements: readonly Element[], options: OptimizeOptions, maxDots: number): string {
  const bareDots = options.bareDots ?? true;
  const enharmonic = options.enharmonic ?? true;
  // 곡에 나오는 토막 길이만 상태로 둔다 (보통 열 개 남짓)
  const width = maxDots + 1;
  const key = (length: number, dots: number) => (length - 1) * width + dots;
  const index = new Map<number, State>();
  const kinds: [number, number][] = [];
  const addKind = (length: number, dots: number) => {
    if (index.has(key(length, dots))) return;
    index.set(key(length, dots), kinds.length);
    kinds.push([length, dots]);
  };
  addKind(4, 0);
  for (const e of elements) {
    // 상태 후보는 토막이 가장 적은 조합에 나오는 길이만 (상태 수가 DP 시간을 정한다)
    for (const choice of e.choices) {
      if (choice.length > e.choices[0]!.length) continue;
      for (const p of choice) {
        addKind(p.length, p.dots);
        if (bareDots) addKind(p.length, 0);
      }
    }
  }
  const count = kinds.length;
  const stateOf = (length: number, dots: number): State => index.get(key(length, dots))!;
  const lengthOf = (s: State) => kinds[s]![0];
  const dotsOf = (s: State) => kinds[s]![1];
  const switchCost = (s: State) => 1 + String(lengthOf(s)).length + dotsOf(s);
  const pieceText = (p: Piece, s: State): string => {
    if (p.length === lengthOf(s)) {
      if (p.dots === dotsOf(s)) return "";
      if (bareDots && dotsOf(s) === 0) return ".".repeat(p.dots);
    }
    return `${p.length}${".".repeat(p.dots)}`;
  };
  const digits = (n: number) => (n < 10 ? 1 : n < 100 ? 2 : String(n).length);
  const pieceCost = (p: Piece, s: State): number => {
    if (p.length === lengthOf(s)) {
      if (p.dots === dotsOf(s)) return 0;
      if (bareDots && dotsOf(s) === 0) return p.dots;
    }
    return digits(p.length) + p.dots;
  };

  // 원소 글자 수 표: 같은 길이(같은 choices 배열)·같은 이름 길이면 다시 쓴다. 상태마다 [글자 수, 고른 조합]
  const costCache = new Map<readonly Piece[][], Map<number, { cost: Float64Array; pick: Int16Array }>>();
  const costTable = (e: Element, token: number) => {
    let byToken = costCache.get(e.choices);
    if (!byToken) costCache.set(e.choices, (byToken = new Map()));
    let table = byToken.get(token);
    if (table) return table;
    const cost = new Float64Array(count).fill(Infinity);
    const pick = new Int16Array(count);
    for (let s = 0; s < count; s++) {
      e.choices.forEach((choice, k) => {
        let c = 0;
        choice.forEach((p, j) => {
          c += pieceCost(p, s) + token + (e.kind === "note" && j > 0 ? 1 : 0);
        });
        if (c < cost[s]!) {
          cost[s] = c;
          pick[s] = k;
        }
      });
    }
    table = { cost, pick };
    byToken.set(token, table);
    return table;
  };

  const start = options.octave ?? 4;
  let low = start;
  let high = start;
  for (const e of elements) {
    if (e.kind !== "note") continue;
    low = Math.min(low, octaveOf(e.pitch) - 1);
    high = Math.max(high, octaveOf(e.pitch) + 1);
  }
  const octaves = high - low + 1;
  const size = octaves * count;
  // 옥타브 o → t 로 옮기는 글자 수
  const octaveCost: number[][] = Array.from({ length: octaves }, (_, o) =>
    Array.from({ length: octaves }, (_, t) => octaveText(o + low, t + low).length),
  );
  const at = (o: number, s: State) => (o - low) * count + s;

  let dp = new Float64Array(size).fill(Infinity);
  dp[at(start, stateOf(4, 0))] = 0;
  const back: Int32Array[] = [];
  const picks: Int16Array[] = [];

  for (const e of elements) {
    const next = new Float64Array(size).fill(Infinity);
    const from = new Int32Array(size).fill(-1);
    const pick = new Int16Array(size);
    const useful = new Set<State>();
    for (const choice of e.choices) {
      for (const piece of choice) {
        const exact = index.get(key(piece.length, piece.dots));
        if (exact !== undefined) useful.add(exact);
        const bare = bareDots ? index.get(key(piece.length, 0)) : undefined;
        if (bare !== undefined) useful.add(bare);
      }
    }
    // 줄(옥타브)마다 가장 싼 칸
    const rowMin = new Float64Array(octaves).fill(Infinity);
    const rowArg = new Int32Array(octaves);
    for (let o = 0; o < octaves; o++) {
      for (let s = 0; s < count; s++) {
        const v = dp[o * count + s]!;
        if (v < rowMin[o]!) {
          rowMin[o] = v;
          rowArg[o] = o * count + s;
        }
      }
    }

    // 이 원소를 쓸 옥타브 후보
    let targets: number[];
    if (e.kind === "rest") targets = [];
    else if (e.cont) targets = [];
    else {
      const natural = octaveOf(e.pitch);
      targets = [natural];
      if (enharmonic && nameIn(e.pitch, natural - 1)) targets.push(natural - 1);
      if (enharmonic && nameIn(e.pitch, natural + 1)) targets.push(natural + 1);
    }

    if (targets.length === 0) {
      // 옥타브는 그대로: 쉼표, 또는 나뉜 음의 뒷부분
      for (let o = low; o <= high; o++) {
        const token = e.kind === "rest" ? 1 : nameIn(e.pitch, o)?.length;
        if (token === undefined) continue;
        const r = o - low;
        const table = costTable(e, token);
        for (let s = 0; s < count; s++) {
          const stay = dp[r * count + s]!;
          const move = !e.noSwitch && useful.has(s) ? rowMin[r]! + switchCost(s) : Infinity;
          if (stay === Infinity && move === Infinity) continue;
          const c = table.cost[s]!;
          const k = table.pick[s]!;
          const i = r * count + s;
          if (stay <= move) {
            next[i] = stay + c;
            from[i] = i;
          } else {
            next[i] = move + c;
            from[i] = rowArg[r]!;
          }
          pick[i] = k;
        }
      }
    } else {
      for (const t of targets) {
        const token = nameIn(e.pitch, t)!.length;
        const r = t - low;
        let moveBase = Infinity;
        let moveArg = -1;
        for (let o = 0; o < octaves; o++) {
          const v = rowMin[o]! + octaveCost[o]![r]!;
          if (v < moveBase) {
            moveBase = v;
            moveArg = rowArg[o]!;
          }
        }
        const table = costTable(e, token);
        for (let s = 0; s < count; s++) {
          let stay = Infinity;
          let stayArg = -1;
          for (let o = 0; o < octaves; o++) {
            const v = dp[o * count + s]! + octaveCost[o]![r]!;
            if (v < stay) {
              stay = v;
              stayArg = o * count + s;
            }
          }
          const move = !e.noSwitch && useful.has(s) ? moveBase + switchCost(s) : Infinity;
          if (stay === Infinity && move === Infinity) continue;
          const c = table.cost[s]!;
          const k = table.pick[s]!;
          const i = r * count + s;
          const total = Math.min(stay, move) + c;
          if (total < next[i]!) {
            next[i] = total;
            from[i] = stay <= move ? stayArg : moveArg;
            pick[i] = k;
          }
        }
      }
    }
    dp = next;
    back.push(from);
    picks.push(pick);
  }

  let state = 0;
  let best = Infinity;
  dp.forEach((v, i) => {
    if (v < best) [best, state] = [v, i];
  });
  if (best === Infinity) return "";
  const out: string[] = new Array(elements.length);
  for (let k = elements.length - 1; k >= 0; k--) {
    const e = elements[k]!;
    const prev = back[k]![state]!;
    const o = Math.floor(state / count) + low;
    const s = state % count;
    const po = Math.floor(prev / count) + low;
    const ps = prev % count;
    const choice = e.choices[picks[k]![state]!]!;
    const token = e.kind === "rest" ? "r" : nameIn(e.pitch, o)!;
    const body = choice.map((piece) => token + pieceText(piece, s)).join(e.kind === "note" ? "&" : "");
    const change = ps !== s ? `l${lengthOf(s)}${".".repeat(dotsOf(s))}` : "";
    out[k] = e.tempo + (e.cont ? "&" : "") + octaveText(po, o) + e.vol + change + body + e.suffix;
    state = prev;
  }
  return out.join("");
}

/** 게임이 받는 한 토막 길이 (gameLengths, 짧은 순서 그대로) */
function pieces(lengths: LengthLimit): readonly Piece[] {
  return gameLengths(lengths);
}

const ratKey = (r: Rat) => `${r.n}/${r.d}`;

/** 토막 1~2개로 만드는 값 → 조합들 (값마다 여러 개) */
const pairCache = new WeakMap<readonly Piece[], Map<string, Piece[][]>>();

function pairs(table: readonly Piece[]): Map<string, Piece[][]> {
  let map = pairCache.get(table);
  if (map) return map;
  map = new Map();
  const put = (v: Rat, ps: Piece[]) => {
    const key = ratKey(v);
    const list = map!.get(key);
    if (list) list.push(ps);
    else map!.set(key, [ps]);
  };
  table.forEach((p, i) => {
    put(p.value, [p]);
    for (let j = i; j < table.length; j++) put(add(p.value, table[j]!.value), [p, table[j]!]);
  });
  pairCache.set(table, map);
  return map;
}

/** 조합이 너무 많아지지 않게 값마다 살펴볼 수 상한 */
const MAX_CHOICES = 64;

const decompCache = new WeakMap<readonly Piece[], Map<string, Piece[][] | null>>();

/**
 * 길이 dur을 쓰는 토막 조합 후보. 2온음표를 넘는 부분은 l1 토막으로 채우고,
 * 나머지는 토막 3개까지의 정확한 조합을 모두 모은다. 하나도 없으면 단순 출력기의 나누기를 쓴다.
 * 정확히 쓸 수 없는 길이면 null (호출한 쪽이 단순 출력기로 넘긴다).
 */
function decompositions(dur: Rat, table: readonly Piece[]): Piece[][] | null {
  let cache = decompCache.get(table);
  if (!cache) decompCache.set(table, (cache = new Map()));
  const key = ratKey(dur);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const whole = table.find((p) => p.length === 1 && p.dots === 0)!;
  const prefix: Piece[] = [];
  let left = dur;
  const two = add(whole.value, whole.value);
  while (cmp(left, two) > 0) {
    prefix.push(whole);
    left = sub(left, whole.value);
  }

  const map = pairs(table);
  const seen = new Set<string>();
  const out: Piece[][] = [];
  const push = (ps: Piece[]) => {
    const sorted = [...ps].sort((a, b) => cmp(b.value, a.value) || a.dots - b.dots);
    const id = sorted.map((p) => `${p.length}.${p.dots}`).join(",");
    if (seen.has(id) || out.length >= MAX_CHOICES) return;
    seen.add(id);
    out.push([...prefix, ...sorted]);
  };
  for (const ps of map.get(ratKey(left)) ?? []) push(ps);
  if (out.length < MAX_CHOICES) {
    for (const p of table) {
      if (cmp(p.value, left) >= 0) continue;
      for (const ps of map.get(ratKey(sub(left, p.value))) ?? []) {
        if (ps.length === 2) push([p, ...ps]);
      }
    }
  }
  if (out.length === 0) {
    const split = splitDuration(dur, table);
    const result = split.rest.n === 0 ? [split.pieces] : null;
    cache.set(key, result);
    return result;
  }
  // 토막이 적은 것부터 (같은 글자 수면 이음표가 적은 쪽을 고르게).
  // 토막이 최소보다 둘 이상 많은 조합은 & 와 음 이름 글자가 늘어 거의 이기지 못하므로 뺀다
  out.sort((a, b) => a.length - b.length);
  const fewest = out[0]!.length;
  const kept = out.filter((c) => c.length <= fewest + 1);
  cache.set(key, kept);
  return kept;
}
