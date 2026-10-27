import { add, cmp, div, mul, rat, sub, toFloat, ZERO, type Rat } from "./rat.js";
import type { Note, Song } from "./model.js";
import { meterGrid } from "./meter.js";
import { DEFAULT_BPM, normalizeTempo } from "./time.js";

/**
 * 오선보 보기 (실험실, 보기 전용). 곡을 마디마다 그릴 음표 모양(온·2·4·8·16·32·64분 + 점 + 잇단음표)으로 나눈다.
 * 곡은 바꾸지 않는다: 박자 밖 음·이상한 길이는 그리기용으로만 가까운 칸에 맞추고(approx 표시), 원래 값(Rat)은 그대로 둔다.
 * 마디선을 넘는 음과 음표 하나로 못 쓰는 길이는 붙임줄로 이은 여러 조각으로 그린다
 */

/** 오선보 마디 하나 (곡 시간, 온음표 단위) */
export interface StaffBar {
  /** 마디 번호 (1부터, barAt과 같은 규칙: 박자가 바뀌기 전 덜 찬 마디도 한 마디) */
  readonly number: number;
  readonly start: Rat;
  readonly end: Rat;
  readonly beats: number;
  readonly unit: number;
  /** 박자표를 그릴지 (첫 마디, 박자가 바뀐 마디) */
  readonly showSig: boolean;
  /** 이 마디 안의 템포 표시 (첫 마디는 처음 템포를 늘 넣는다) */
  readonly tempo: readonly { readonly at: Rat; readonly bpm: number }[];
}

/** 그릴 음표·쉼표 하나 */
export interface StaffItem {
  readonly rest: boolean;
  /** 그리는 자리 (곡 시간). 박자 밖 음이면 맞춘 자리 */
  readonly start: Rat;
  /** 그리는 길이 (곡 시간) */
  readonly dur: Rat;
  /** 음표 모양: 1 = 온음표, 4 = 4분음표 … 64 */
  readonly base: number;
  readonly dots: number;
  /** 잇단음표 묶음 (num개를 occupied개 자리에). group은 트랙 안에서 묶음마다 다른 번호 */
  readonly tuplet?: { readonly group: number; readonly num: number; readonly occupied: number };
  /** MIDI 음 번호 (쉼표는 없음) */
  readonly pitch?: number;
  /** 원래 음 id (누르면 그 음으로) */
  readonly noteId?: string;
  /** 새로 치는 음의 첫 조각 (붙임줄로 이어 받은 조각·&로 이은 뒷음이 아님) */
  readonly attack: boolean;
  /** 다음 조각과 붙임줄로 잇는다 */
  readonly tie: boolean;
  /** 임시표 (조표 없이 올림표로 쓴다. n = 제자리표) */
  readonly accidental?: "#" | "n";
  /** 셈여림 (v를 pp~ff로 어림, 앞과 달라진 곳에만) */
  readonly dynamic?: string;
  /** 박자 밖 음이라 그리기용으로 자리·길이를 맞췄다 */
  readonly approx: boolean;
}

export interface StaffMeasure {
  readonly items: readonly StaffItem[];
  /** 마디 전체가 쉼 (온쉼표 하나로 그린다) */
  readonly fullRest: boolean;
}

export interface StaffTrack {
  readonly clef: "treble" | "bass";
  /** bars와 같은 순서·개수 */
  readonly measures: readonly StaffMeasure[];
  /** 너무 짧아 그리기용 칸에 맞추면 사라지는 음 수 (곡에는 그대로 있다) */
  readonly hidden: number;
}

/** 셈여림 표시 (v 범위를 여섯으로 나눈다) */
export const STAFF_DYNAMICS = ["pp", "p", "mp", "mf", "f", "ff"] as const;

const LETTERS = ["c", "c", "d", "d", "e", "f", "f", "g", "g", "a", "a", "b"] as const;
const SHARP = [false, true, false, true, false, false, true, false, true, false, true, false] as const;

/** 음 번호 → 오선 위 글자·올림표·옥타브 (o4c = 60 = c/4). 조표 없이 올림표로 쓴다 */
export function staffPitch(pitch: number): { readonly letter: string; readonly sharp: boolean; readonly octave: number } {
  const pc = ((pitch % 12) + 12) % 12;
  return { letter: LETTERS[pc]!, sharp: SHARP[pc]!, octave: Math.floor(pitch / 12) - 1 };
}

/** v → 셈여림 (프로필 v 범위 기준) */
export function staffDynamic(vol: number, range: { readonly min: number; readonly max: number }): string {
  const span = Math.max(1, range.max - range.min);
  const i = Math.floor(((vol - range.min) / span) * STAFF_DYNAMICS.length);
  return STAFF_DYNAMICS[Math.max(0, Math.min(STAFF_DYNAMICS.length - 1, i))]!;
}

const endOf = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);
const min = (a: Rat, b: Rat) => (cmp(a, b) <= 0 ? a : b);
const max = (a: Rat, b: Rat) => (cmp(a, b) >= 0 ? a : b);
const isInt = (r: Rat) => r.d === 1;
const isPow2 = (x: number) => x > 0 && (x & (x - 1)) === 0;
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;

/** 곡 끝 (가장 늦게 끝나는 음) */
function songEnd(song: Pick<Song, "tracks">): Rat {
  let end = ZERO;
  for (const t of song.tracks) for (const n of t.notes) end = max(end, endOf(n));
  return end;
}

/**
 * 곡의 마디 목록. 곡 끝(음이 없으면 한 마디)까지 박자표를 따라 마디를 나눈다.
 * 박자가 마디 중간에서 바뀌면 그 앞 마디는 덜 찬 마디로 끝낸다 (barAt과 같은 번호)
 */
export function staffBars(song: Pick<Song, "tracks" | "timeSig" | "tempo">): StaffBar[] {
  const sorted = [...song.timeSig].sort((a, b) => cmp(a.at, b.at));
  const sigs: { at: Rat; beats: number; unit: number }[] = [];
  for (const s of sorted) {
    if (sigs.length > 0 && cmp(sigs[sigs.length - 1]!.at, s.at) === 0) sigs[sigs.length - 1] = s;
    else sigs.push(s);
  }
  if (sigs.length === 0 || cmp(sigs[0]!.at, ZERO) > 0) sigs.unshift({ at: ZERO, beats: 4, unit: 4 });
  const end = songEnd(song);
  const raw: { start: Rat; end: Rat; beats: number; unit: number }[] = [];
  for (let i = 0; i < sigs.length; i++) {
    const sig = sigs[i]!;
    const next = sigs[i + 1]?.at;
    // 곡 끝 뒤의 박자 바뀜은 그리지 않는다 (첫 박자표만은 늘 한 마디)
    if (raw.length > 0 && cmp(sig.at, end) >= 0) break;
    const { measure } = meterGrid(sig);
    let pos = sig.at;
    do {
      const barEnd = next ? min(add(pos, measure), next) : add(pos, measure);
      raw.push({ start: pos, end: barEnd, beats: sig.beats, unit: sig.unit });
      pos = barEnd;
      // 다음 박자 바뀜이 곡 끝보다 멀어도 곡 끝에서 멈춘다 (먼 박자표 하나로 빈 마디를 잔뜩 만들지 않게)
    } while ((!next || cmp(pos, next) < 0) && cmp(pos, end) < 0);
  }
  const tempo = normalizeTempo(song.tempo);
  let bpm = tempo.length > 0 && cmp(tempo[0]!.at, ZERO) === 0 ? tempo[0]!.bpm : DEFAULT_BPM;
  return raw.map((b, i) => {
    const prev = raw[i - 1];
    const marks: { at: Rat; bpm: number }[] = i === 0 ? [{ at: ZERO, bpm }] : [];
    for (const e of tempo) {
      if (cmp(e.at, b.start) < 0 || cmp(e.at, b.end) >= 0 || (i === 0 && cmp(e.at, ZERO) === 0)) continue;
      if (e.bpm === bpm) continue;
      bpm = e.bpm;
      marks.push({ at: e.at, bpm: e.bpm });
    }
    return {
      number: i + 1,
      start: b.start,
      end: b.end,
      beats: b.beats,
      unit: b.unit,
      showSig: !prev || prev.beats !== b.beats || prev.unit !== b.unit,
      tempo: marks,
    };
  });
}

/** 음 하나 (트랙 안) */
interface Src {
  readonly note: Note;
  readonly end: Rat;
  /** &로 앞 음에 바로 이은 음 (같은 높이면 이어 울림, 다르면 슬라이드. 어느 쪽이든 새로 치지 않는다) */
  readonly joinedIn: boolean;
  /** &로 다음 음에 같은 높이로 이어진다 */
  readonly holdOut: boolean;
}

/** 마디 안 구간 (마디 시작 기준). src가 없으면 쉼 */
interface Seg {
  readonly s: Rat;
  readonly e: Rat;
  readonly src?: Src;
  /** 마디선(또는 창 경계)에서 잘린 앞·뒤 */
  readonly cutStart: boolean;
  readonly cutEnd: boolean;
  readonly moved?: boolean;
}

/** 그릴 조각 (마디 시작 기준 실제 시간) */
interface Piece {
  readonly s: Rat;
  readonly e: Rat;
  readonly base: number;
  readonly dots: number;
  readonly seg: Seg;
  readonly first: boolean;
  readonly last: boolean;
  readonly tuplet?: { readonly ref: object; readonly num: number; readonly occupied: number };
}

interface Plan {
  readonly cost: number;
  readonly pieces: readonly Piece[];
  readonly hidden: number;
}

/** 음표 모양 (긴 것부터): [길이, base, 점] */
const SHAPES: readonly (readonly [Rat, number, number])[] = (() => {
  const out: [Rat, number, number][] = [];
  for (const base of [1, 2, 4, 8, 16, 32, 64]) {
    for (const dots of [0, 1, 2]) {
      if (base * 2 ** dots > 64) continue;
      out.push([mul(rat(1, base), rat(2 * 2 ** dots - 1, 2 ** dots)), base, dots]);
    }
  }
  return out.sort((a, b) => cmp(b[0], a[0]));
})();

/**
 * 쓴 길이(written) 구간 [s, e)를 음표 모양으로 나눈다. origin 기준으로 모양 길이(점 뺀 것)의 배수 자리에서만 시작하고,
 * 점음표는 끝이 구간 끝이나 박(beat) 위일 때만 쓴다 (당김음을 점음표로 흐리지 않게)
 */
function shapes(s: Rat, e: Rat, origin: Rat, beat: Rat): { s: Rat; e: Rat; base: number; dots: number }[] {
  const out: { s: Rat; e: Rat; base: number; dots: number }[] = [];
  let pos = s;
  while (cmp(pos, e) < 0) {
    const rem = sub(e, pos);
    let picked: { len: Rat; base: number; dots: number } | undefined;
    for (const [len, base, dots] of SHAPES) {
      if (cmp(len, rem) > 0) continue;
      if (!isInt(div(sub(pos, origin), rat(1, base)))) continue;
      const end = add(pos, len);
      if (dots > 0 && cmp(end, e) !== 0 && !isInt(div(sub(end, origin), beat))) continue;
      picked = { len, base, dots };
      break;
    }
    // 64분음표 칸에도 안 맞는 자리 (맞추기 전 단계에서 걸러지지만 끝없이 돌지 않게)
    if (!picked) picked = { len: rem, base: 64, dots: 0 };
    out.push({ s: pos, e: add(pos, picked.len), base: picked.base, dots: picked.dots });
    pos = add(pos, picked.len);
  }
  return out;
}

/** 2의 거듭제곱 분모이고 64분음표 칸 위인 자리 */
const onBinaryGrid = (r: Rat) => isPow2(r.d) && r.d <= 64;

/** 창 [ws, we) 안으로 자른 구간 */
function clip(segs: readonly Seg[], ws: Rat, we: Rat): Seg[] {
  const out: Seg[] = [];
  for (const g of segs) {
    if (cmp(g.e, ws) <= 0 || cmp(g.s, we) >= 0) continue;
    const s = max(g.s, ws);
    const e = min(g.e, we);
    out.push({ ...g, s, e, cutStart: g.cutStart || cmp(s, g.s) > 0, cutEnd: g.cutEnd || cmp(e, g.e) < 0 });
  }
  return out;
}

type Kind = { kind: "binary" } | { kind: "tuplet"; m: number; n: number; a: number } | undefined;

/**
 * 창 안 구간을 그대로 쓸 수 있는지: 모두 2분할 칸 위면 binary, 창을 m(홀수)×2^a 칸으로 나눈 자리면 잇단음표.
 * 박보다 긴 창은 셋잇단·다섯잇단·일곱잇단(창 전체를 m개로)만, 박 이하 창은 여섯잇단(a = 1)까지 쓴다
 */
function kindOf(segs: readonly Seg[], ws: Rat, we: Rat, beat: Rat): Kind {
  const pts: Rat[] = [ws, we];
  for (const g of segs) pts.push(g.s, g.e);
  if (pts.every(onBinaryGrid)) return { kind: "binary" };
  const len = sub(we, ws);
  if (!isPow2(len.d) || len.n !== 1 || !onBinaryGrid(ws)) return undefined;
  let d = 1;
  for (const p of pts) d = lcm(d, div(sub(p, ws), len).d);
  let m = d;
  let a = 0;
  while (m % 2 === 0) {
    m /= 2;
    a++;
  }
  if (m === 1) return undefined;
  const long = cmp(len, beat) > 0;
  if (long ? a !== 0 || m > 7 : a > 1 || m > 15) return undefined;
  const n = 2 ** Math.floor(Math.log2(m));
  // 쓴 칸 길이가 64분음표보다 짧으면 못 쓴다
  if (cmp(div(len, rat(n * 2 ** a)), rat(1, 64)) < 0) return undefined;
  return { kind: "tuplet", m, n, a };
}

function piecesOf(segs: readonly Seg[], ws: Rat, we: Rat, beat: Rat, kind: NonNullable<Kind>): Piece[] {
  const out: Piece[] = [];
  if (kind.kind === "binary") {
    for (const g of segs) {
      const parts = shapes(g.s, g.e, ZERO, beat);
      parts.forEach((p, i) => out.push({ ...p, seg: g, first: i === 0, last: i === parts.length - 1 }));
    }
    return out;
  }
  // 잇단음표: 쓴 길이 = 실제 길이 × m/n (셋잇단 8분음표 셋 = 쓴 길이 3/8이 실제 4분음표 하나), 창 시작 기준
  const toWritten = rat(kind.m, kind.n);
  const toReal = rat(kind.n, kind.m);
  const written = mul(sub(we, ws), toWritten);
  const tuplet = { ref: {}, num: kind.m * 2 ** kind.a, occupied: kind.n * 2 ** kind.a };
  for (const g of segs) {
    const parts = shapes(mul(sub(g.s, ws), toWritten), mul(sub(g.e, ws), toWritten), ZERO, written);
    parts.forEach((p, i) =>
      out.push({
        s: add(ws, mul(p.s, toReal)),
        e: add(ws, mul(p.e, toReal)),
        base: p.base,
        dots: p.dots,
        seg: g,
        first: i === 0,
        last: i === parts.length - 1,
        tuplet,
      }),
    );
  }
  return out;
}

/** 이웃한 쉼 구간을 하나로 */
function mergeRests(segs: readonly Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const g of segs) {
    const prev = out[out.length - 1];
    if (prev && !prev.src && !g.src) out[out.length - 1] = { ...prev, e: g.e };
    else out.push(g);
  }
  return out;
}

/** 맞춰 볼 칸 수 (적은 것부터). 맞출 때는 셋잇단까지만 쓴다 (다섯·일곱잇단은 정확히 맞을 때만) */
const SNAP_DIVISIONS = [1, 2, 3, 4, 6, 8, 16] as const;

/** 이 자리부터 박자 밖으로 본다: 64분음표 3분의 1 (120 BPM에서 약 10 ms)보다 멀면 */
const SNAP_TOLERANCE = rat(1, 192);

/**
 * 그대로 못 쓰는 창: 창을 D칸(SNAP_DIVISIONS)으로 나눈 자리에 경계를 맞춰 본다. 가장 적은 칸으로 허용 오차 안에 드는 것,
 * 없으면 사라지는 음이 가장 적고 오차가 가장 작은 것. 창 경계는 움직이지 않는다
 */
function quantize(segs: readonly Seg[], ws: Rat, we: Rat, beat: Rat): Plan {
  const len = sub(we, ws);
  let best: { segs: Seg[]; hidden: number; err: number; kind: NonNullable<Kind>; within: boolean } | undefined;
  for (const d of SNAP_DIVISIONS) {
    const unit = div(len, rat(d));
    const snap = (p: Rat) => (cmp(p, ws) <= 0 ? ws : cmp(p, we) >= 0 ? we : add(ws, mul(unit, rat(Math.round(toFloat(div(sub(p, ws), unit)))))));
    let err = 0;
    let hidden = 0;
    const moved: Seg[] = [];
    for (const g of segs) {
      const s = snap(g.s);
      const e = snap(g.e);
      err = Math.max(err, Math.abs(toFloat(sub(s, g.s))), Math.abs(toFloat(sub(e, g.e))));
      if (cmp(s, e) >= 0) {
        // 다른 창·마디에 이어지는 조각은 거기서 보인다
        if (g.src && !g.cutStart && !g.cutEnd) hidden++;
        continue;
      }
      moved.push({ ...g, s, e, moved: g.moved || cmp(s, g.s) !== 0 || cmp(e, g.e) !== 0 });
    }
    // 사라진 구간 자리는 앞 구간을 늘려 메운다 (경계를 맞춘 것이라 빈 곳은 생기지 않지만 앞뒤가 붙게)
    const filled: Seg[] = [];
    for (const g of moved) {
      const prev = filled[filled.length - 1];
      if (prev && cmp(prev.e, g.s) !== 0) filled[filled.length - 1] = { ...prev, e: g.s };
      filled.push(g);
    }
    const merged = mergeRests(filled);
    const kind = kindOf(merged, ws, we, beat);
    if (!kind) continue;
    const within = hidden === 0 && err <= toFloat(SNAP_TOLERANCE);
    if (within) {
      best = { segs: merged, hidden, err, kind, within };
      break;
    }
    if (!best || hidden < best.hidden || (hidden === best.hidden && err < best.err - 1e-12)) best = { segs: merged, hidden, err, kind, within };
  }
  if (!best) {
    // 창 길이가 2분할로도 잇단으로도 안 되는 마디(박자가 이상한 자리에서 바뀐 덜 찬 마디): 구간마다 가장 가까운 모양 하나로 그리기만 한다
    const pieces: Piece[] = segs.map((g) => {
      const len = sub(g.e, g.s);
      const shape = SHAPES.find(([l]) => cmp(l, len) <= 0) ?? SHAPES[SHAPES.length - 1]!;
      return { s: g.s, e: g.e, base: shape[1], dots: shape[2], seg: { ...g, moved: true }, first: true, last: true };
    });
    return { cost: 1000 + pieces.length, pieces, hidden: 0 };
  }
  const pieces = piecesOf(best.segs, ws, we, beat, best.kind);
  return { cost: 100 + best.hidden * 50 + pieces.length + (best.kind.kind === "tuplet" ? 1 : 0), pieces, hidden: best.hidden };
}

/** 창을 더 작은 창으로: 마디 → 반 마디(박이 넷 이상 짝수) 또는 박, 박보다 길면 박, 박 이하면 둘(점 박이면 셋)로 */
function children(ws: Rat, we: Rat, bar: Rat, beat: Rat): [Rat, Rat][] {
  const len = sub(we, ws);
  const out: [Rat, Rat][] = [];
  const split = (step: Rat) => {
    for (let p = ws; cmp(p, we) < 0; p = add(p, step)) out.push([p, min(add(p, step), we)]);
  };
  if (cmp(len, beat) > 0) {
    const beats = div(len, beat);
    if (cmp(ws, ZERO) === 0 && cmp(we, bar) === 0 && isInt(beats) && beats.n >= 4 && beats.n % 2 === 0) split(div(len, rat(2)));
    else split(beat);
    return out;
  }
  const parts = len.n === 1 ? 2 : len.n === 3 ? 3 : 0;
  if (parts === 0 || cmp(div(len, rat(parts)), rat(1, 32)) < 0) return [];
  split(div(len, rat(parts)));
  return out;
}

/** 창 하나를 그리는 가장 싼 방법 (조각 수가 적고, 박자 밖으로 맞추는 일이 적은 것) */
function plan(segs: readonly Seg[], ws: Rat, we: Rat, bar: Rat, beat: Rat): Plan {
  const inside = clip(segs, ws, we);
  const kind = kindOf(inside, ws, we, beat);
  if (kind?.kind === "binary") {
    const pieces = piecesOf(inside, ws, we, beat, kind);
    return { cost: pieces.length, pieces, hidden: 0 };
  }
  const options: Plan[] = [];
  if (kind) {
    const pieces = piecesOf(inside, ws, we, beat, kind);
    options.push({ cost: pieces.length + 1, pieces, hidden: 0 });
  }
  const kids = children(ws, we, bar, beat);
  if (kids.length > 1) {
    const parts = kids.map(([a, b]) => plan(inside, a, b, bar, beat));
    options.push({ cost: parts.reduce((s, p) => s + p.cost, 0), pieces: parts.flatMap((p) => p.pieces), hidden: parts.reduce((s, p) => s + p.hidden, 0) });
  }
  if (!kind && (kids.length <= 1 || cmp(sub(we, ws), beat) <= 0)) options.push(quantize(inside, ws, we, beat));
  return options.reduce((a, b) => (b.cost < a.cost ? b : a));
}

/**
 * 트랙 하나의 오선보 (마디마다). bars는 staffBars 결과.
 * volume은 프로필 v 범위 (셈여림 어림)
 */
export function staffTrack(notes: readonly Note[], bars: readonly StaffBar[], volume: { readonly min: number; readonly max: number }): StaffTrack {
  const sorted = [...notes].filter((n) => n.dur.n > 0).sort((a, b) => cmp(a.start, b.start));
  const srcs: Src[] = sorted.map((note, i) => {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const end = endOf(note);
    return {
      note,
      end,
      joinedIn: !!prev && prev.tie === "next" && cmp(endOf(prev), note.start) === 0,
      holdOut: note.tie === "next" && !!next && next.pitch === note.pitch && cmp(end, next.start) === 0,
    };
  });
  let k = 0;
  let group = 0;
  const groups = new Map<object, number>();
  const measures: { items: StaffItem[]; fullRest: boolean }[] = [];
  const all: { item: StaffItem; src: Src | undefined; endsNote: boolean }[] = [];
  for (const bar of bars) {
    const len = sub(bar.end, bar.start);
    while (k < srcs.length && cmp(srcs[k]!.end, bar.start) <= 0) k++;
    const segs: Seg[] = [];
    let pos = ZERO;
    for (let i = k; i < srcs.length && cmp(srcs[i]!.note.start, bar.end) < 0; i++) {
      const src = srcs[i]!;
      // 한 트랙은 한 번에 한 음: 겹친 앞부분은 앞 음이 차지한다
      const s = max(sub(src.note.start, bar.start), pos);
      const e = min(sub(src.end, bar.start), len);
      if (cmp(s, e) >= 0) continue;
      if (cmp(s, pos) > 0) segs.push({ s: pos, e: s, cutStart: false, cutEnd: false });
      segs.push({ s, e, src, cutStart: cmp(src.note.start, add(bar.start, s)) < 0, cutEnd: cmp(src.end, add(bar.start, e)) > 0 });
      pos = e;
    }
    if (cmp(pos, len) < 0) segs.push({ s: pos, e: len, cutStart: false, cutEnd: false });
    if (segs.every((g) => !g.src)) {
      measures.push({ items: [], fullRest: true });
      continue;
    }
    const { beat } = meterGrid(bar);
    const p = plan(segs, ZERO, len, len, beat);
    const items: StaffItem[] = [];
    for (const piece of p.pieces) {
      const src = piece.seg.src;
      let tuplet: StaffItem["tuplet"];
      if (piece.tuplet) {
        let id = groups.get(piece.tuplet.ref);
        if (id === undefined) groups.set(piece.tuplet.ref, (id = group++));
        tuplet = { group: id, num: piece.tuplet.num, occupied: piece.tuplet.occupied };
      }
      const item: StaffItem = {
        rest: !src,
        start: add(bar.start, piece.s),
        dur: sub(piece.e, piece.s),
        base: piece.base,
        dots: piece.dots,
        ...(tuplet ? { tuplet } : {}),
        ...(src ? { pitch: src.note.pitch, noteId: src.note.id } : {}),
        attack: !!src && piece.first && !piece.seg.cutStart && !src.joinedIn,
        tie: false,
        approx: !!src && !!piece.seg.moved,
      };
      items.push(item);
      all.push({ item, src, endsNote: !!src && piece.last && !piece.seg.cutEnd });
    }
    measures.push({ items, fullRest: false });
  }
  // 붙임줄: 같은 음의 다음 조각, 또는 &로 같은 높이를 이어 받는 다음 음
  const tied = new Set<StaffItem>();
  const tiedFrom = new Set<StaffItem>();
  const srcOf = new Map<StaffItem, Src>();
  for (let i = 0; i < all.length; i++) {
    const { item, src, endsNote } = all[i]!;
    if (src) srcOf.set(item, src);
    const next = all[i + 1];
    if (!src || !next?.src) continue;
    if (cmp(add(item.start, item.dur), next.item.start) !== 0) continue;
    if (next.src === src ? !endsNote : endsNote && src.holdOut && next.src.note.pitch === src.note.pitch) {
      tied.add(item);
      tiedFrom.add(next.item);
    }
  }
  // 임시표(마디마다 새로. 붙임줄로 이어 받은 조각에는 쓰지 않는다)·셈여림(트랙 전체, 새로 치는 음에서 달라질 때)
  let dynamic: string | undefined;
  const out: StaffMeasure[] = measures.map((m) => {
    const state = new Map<string, boolean>();
    const items = m.items.map((item) => {
      let next: StaffItem = tied.has(item) ? { ...item, tie: true } : item;
      if (item.pitch === undefined) return next;
      const sp = staffPitch(item.pitch);
      const key = `${sp.letter}${sp.octave}`;
      if (!tiedFrom.has(item)) {
        if ((state.get(key) ?? false) !== sp.sharp) next = { ...next, accidental: sp.sharp ? "#" : "n" };
        state.set(key, sp.sharp);
      }
      if (item.attack) {
        const d = staffDynamic(srcOf.get(item)?.note.vol ?? volume.max, volume);
        if (d !== dynamic) next = { ...next, dynamic: d };
        dynamic = d;
      }
      return next;
    });
    return { items, fullRest: m.fullRest };
  });
  const shown = new Set(all.map((x) => x.src));
  return { clef: clefOf(sorted), measures: out, hidden: srcs.filter((x) => !shown.has(x)).length };
}

/** 음 높이 가운데값이 가온 도(60)보다 낮으면 낮은음자리표 */
function clefOf(notes: readonly Note[]): "treble" | "bass" {
  if (notes.length === 0) return "treble";
  const pitches = notes.map((n) => n.pitch).sort((a, b) => a - b);
  return pitches[Math.floor(pitches.length / 2)]! < 60 ? "bass" : "treble";
}
