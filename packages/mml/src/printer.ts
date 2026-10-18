import { add, cmp, defaultLengthLimit, eq, gameLengths, sub, ZERO, type LengthLimit, type Rat, type TempoEvent } from "@mmlce/core";
import type { Diagnostic } from "./parser.js";
import { continues, dropDanglingTies } from "./compare.js";

/** 출력에 필요한 음 정보. 모델의 Note와 파서의 ParsedNote 둘 다 넘길 수 있다. */
export interface PrintableNote {
  readonly start: Rat;
  readonly dur: Rat;
  readonly pitch: number;
  readonly vol: number;
  readonly tie: "none" | "next";
}

export interface PrintOptions {
  /** 이 채널에 써 넣을 템포. 곡 템포를 어느 채널에 둘지는 호출한 쪽이 정한다 */
  readonly tempo?: readonly TempoEvent[];
  readonly octave?: number;
  readonly volume?: number;
  /** 한 토막으로 쓸 수 있는 음길이 한도 (GameProfile.length). 없으면 defaultLengthLimit() */
  readonly lengths?: LengthLimit;
}

export interface PrintResult {
  readonly text: string;
  readonly diagnostics: Diagnostic[];
}

interface Piece {
  readonly length: number;
  readonly dots: number;
  readonly value: Rat;
}

const NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"] as const;

const tableCache = new Map<string, Piece[]>();

/** 게임이 받는 한 토막 길이 표 (gameLengths). 긴 것부터, 같은 값이면 짧게 쓰이는 표기(점 없는 쪽)부터 */
function pieceTable(limit: LengthLimit): Piece[] {
  const key = `${limit.min}/${limit.max}/${limit.dots}`;
  const cached = tableCache.get(key);
  if (cached) return cached;
  const built = [...gameLengths(limit)].sort((a, b) => cmp(b.value, a.value) || a.dots - b.dots);
  tableCache.set(key, built);
  return built;
}

/**
 * 길이를 쓸 수 있는 토막들로 나눈다. 온음표 단위 정수 부분은 l1로 채우고,
 * 남은 부분은 토막 4개까지 정확히 맞는 조합을 찾는다. 그래도 없으면 큰 것부터 채우고
 * 남는 만큼 버린다(경고).
 */
const splitCache = new WeakMap<readonly Piece[], Map<string, { pieces: Piece[]; rest: Rat }>>();

export function splitDuration(dur: Rat, table: readonly Piece[]): { pieces: Piece[]; rest: Rat } {
  let cache = splitCache.get(table);
  if (!cache) splitCache.set(table, (cache = new Map()));
  const key = `${dur.n}/${dur.d}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const result = splitUncached(dur, table);
  cache.set(key, result);
  return result;
}

/** 이 길이를 1~64 음길이(점 포함) 조합으로 정확히 쓸 수 있는지 */
/** 이 길이의 쉼표를 l 기본값과 상관없이 숫자를 붙여 쓴다 (글 끝에 덧붙일 때) */
export function restText(dur: Rat, limit: LengthLimit): string {
  return splitDuration(dur, pieceTable(limit))
    .pieces.map((p) => `r${p.length}${".".repeat(p.dots)}`)
    .join("");
}

/** 이 길이를 음길이 숫자(점 포함) 토막들로. 정확히 쓸 수 없으면 undefined (&로 이어 쓸 때) */
export function lengthPieces(dur: Rat, limit: LengthLimit): string[] | undefined {
  const split = splitDuration(dur, pieceTable(limit));
  return split.rest.n === 0 && split.pieces.length > 0 ? split.pieces.map((p) => `${p.length}${".".repeat(p.dots)}`) : undefined;
}

export function canWriteExactly(dur: Rat, limit: LengthLimit): boolean {
  return dur.n === 0 || splitDuration(dur, pieceTable(limit)).rest.n === 0;
}

function splitUncached(dur: Rat, table: readonly Piece[]): { pieces: Piece[]; rest: Rat } {
  const single = table.find((p) => eq(p.value, dur));
  if (single) return { pieces: [single], rest: ZERO };

  const whole = table.find((p) => p.length === 1 && p.dots === 0);
  const pieces: Piece[] = [];
  let left = dur;
  while (whole && cmp(left, whole.value) > 0) {
    pieces.push(whole);
    left = sub(left, whole.value);
  }
  if (left.n === 0) return { pieces, rest: ZERO };

  const exact = findExact(left, table);
  if (exact) return { pieces: [...pieces, ...exact], rest: ZERO };

  for (const p of table) {
    while (cmp(p.value, left) <= 0 && pieces.length < 64) {
      pieces.push(p);
      left = sub(left, p.value);
    }
    if (left.n === 0) break;
  }
  return { pieces, rest: left };
}

// 토막 1~2개로 만들 수 있는 길이 → 그 토막들. 4토막까지는 이 표 두 번 조회로 찾는다.
const pairCache = new WeakMap<readonly Piece[], { map: Map<string, Piece[]>; list: [Rat, Piece[]][] }>();

function pairsOf(table: readonly Piece[]) {
  let pairs = pairCache.get(table);
  if (pairs) return pairs;
  const map = new Map<string, Piece[]>();
  const put = (v: Rat, ps: Piece[]) => {
    const key = `${v.n}/${v.d}`;
    const old = map.get(key);
    if (!old || old.length > ps.length) map.set(key, ps);
  };
  table.forEach((p, i) => {
    put(p.value, [p]);
    for (let j = i; j < table.length; j++) put(add(p.value, table[j]!.value), [p, table[j]!]);
  });
  const list: [Rat, Piece[]][] = [...map.entries()].map(([k, ps]) => {
    const [n, d] = k.split("/").map(Number) as [number, number];
    return [{ n, d }, ps];
  });
  pairs = { map, list };
  pairCache.set(table, pairs);
  return pairs;
}

function findExact(target: Rat, table: readonly Piece[]): Piece[] | undefined {
  const { map, list } = pairsOf(table);
  const direct = map.get(`${target.n}/${target.d}`);
  if (direct) return direct;
  for (const [value, ps] of list) {
    if (cmp(value, target) >= 0) continue;
    const r = sub(target, value);
    const other = map.get(`${r.n}/${r.d}`);
    if (other) return [...ps, ...other];
  }
  return undefined;
}

/**
 * 음 목록을 MML 텍스트로 쓴다. 글자 수를 줄이는 최적화는 하지 않는 단순 출력기다
 * (최적화기는 4단계). 결과를 다시 parseMml로 읽으면 같은 음이 나와야 한다.
 */
export function printMml(notes: readonly PrintableNote[], options: PrintOptions = {}): PrintResult {
  const lengths = options.lengths ?? defaultLengthLimit();
  const table = pieceTable(lengths);
  // 한 번 써 보고 가장 많이 나온 점 없는 토막 길이를 l 기본값으로 삼아 다시 쓴다
  const draft = printWith(notes, options, table, 4);
  let best = 4;
  let bestCount = draft.counts.get(4) ?? 0;
  for (const [length, count] of draft.counts) {
    if (count > bestCount) [best, bestCount] = [length, count];
  }
  if (best === 4) return { text: draft.text, diagnostics: draft.diagnostics };
  const final = printWith(notes, options, table, best);
  return { text: final.text, diagnostics: final.diagnostics };
}

function printWith(
  notes: readonly PrintableNote[],
  options: PrintOptions,
  table: readonly Piece[],
  defaultLength: number,
): PrintResult & { counts: Map<number, number> } {
  const counts = new Map<number, number>();
  const diagnostics: Diagnostic[] = [];
  // 쉼표 앞의 &는 게임이 무시하므로 쓰지 않는다
  const sorted = dropDanglingTies(notes);
  const tempo = [...(options.tempo ?? [])].sort((a, b) => cmp(a.at, b.at));
  const out: string[] = [];

  let octave = options.octave ?? 4;
  let volume = options.volume ?? 8;
  if (defaultLength !== 4) out.push(`l${defaultLength}`);

  let pos: Rat = ZERO;
  let tempoIndex = 0;

  const lengthText = (p: Piece) =>
    p.length === defaultLength && p.dots === 0 ? "" : `${p.length}${".".repeat(p.dots)}`;

  // 위치 at 이전(at 포함)에 걸린 템포를 모두 쓴다
  const flushTempo = (at: Rat) => {
    while (tempoIndex < tempo.length && cmp(tempo[tempoIndex]!.at, at) <= 0) {
      out.push(`t${tempo[tempoIndex]!.bpm}`);
      tempoIndex++;
    }
  };

  // [from, to) 구간을 템포 위치에서 끊어 조각 목록으로
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

  const writeDuration = (dur: Rat, token: string, joiner: string) => {
    const { pieces, rest } = splitDuration(dur, table);
    if (rest.n !== 0) {
      diagnostics.push({
        level: "warning",
        code: "unrepresentable-length",
        params: { min: (options.lengths ?? defaultLengthLimit()).min, max: (options.lengths ?? defaultLengthLimit()).max },
        span: [0, 0],
      });
    }
    for (const p of pieces) if (p.dots === 0) counts.set(p.length, (counts.get(p.length) ?? 0) + 1);
    out.push(pieces.map((p) => token + lengthText(p)).join(joiner));
  };

  const writeRest = (until: Rat) => {
    for (const seg of segments(pos, until)) {
      flushTempo(pos);
      writeDuration(seg, "r", "");
      pos = add(pos, seg);
    }
  };

  /** 바로 앞에 쓴 음 (& 뒤 음인지 보려고) */
  let prev: PrintableNote | undefined;
  for (const note of sorted) {
    if (cmp(note.start, pos) < 0) {
      diagnostics.push({
        level: "error",
        code: "overlap",
        span: [0, 0],
      });
      continue;
    }
    const continued = prev !== undefined && continues(prev, note);
    prev = note;
    if (cmp(note.start, pos) > 0) writeRest(note.start);
    flushTempo(pos);

    const noteOctave = Math.floor(note.pitch / 12) - 1;
    const diff = noteOctave - octave;
    if (diff === 1) out.push(">");
    else if (diff === -1) out.push("<");
    else if (diff !== 0) out.push(`o${noteOctave}`);
    octave = noteOctave;

    // & 뒤의 v는 게임이 무시하므로 쓰지 않는다. 다음에 v가 필요한지는 마지막으로 쓴 v로 따진다
    if (!continued && note.vol !== volume) {
      out.push(`v${note.vol}`);
      volume = note.vol;
    }

    const name = NAMES[((note.pitch % 12) + 12) % 12]!;
    const end = add(note.start, note.dur);
    const segs = segments(note.start, end);
    segs.forEach((seg, k) => {
      if (k > 0) {
        // 사용자 곡(Twinkle 샘플)에서 인게임 동작이 확인된 "음 t &음" 순서로 쓴다
        flushTempo(pos);
        out.push("&");
      }
      writeDuration(seg, name, "&");
      pos = add(pos, seg);
    });
    if (note.tie === "next") out.push("&");
  }

  // 이 채널의 마지막 음 뒤에 남은 템포는 쉼표로 자리를 만들어 쓴다
  if (tempoIndex < tempo.length) {
    const last = tempo[tempo.length - 1]!.at;
    if (cmp(last, pos) > 0) writeRest(last);
    flushTempo(last);
  }

  return { text: out.join(""), diagnostics, counts };
}
