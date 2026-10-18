import { add, cmp, rat, sub, toFloat, type Rat, type TempoEvent } from "@mmlce/core";
import type { RawNote } from "./analyze.js";

/** 격자에 맞춘 음. 세기는 아직 MIDI 값 */
export interface GridNote {
  readonly start: Rat;
  readonly dur: Rat;
  readonly pitch: number;
  readonly velocity: number;
  /** 어느 MIDI 파트에서 왔는지 */
  readonly part: string;
}

export interface QuantizeOptions {
  /** 격자 음길이(16 = 16분음표). "auto"면 곡에서 추정한다 */
  readonly grid?: number | "auto";
  /** 박마다 셋잇단 격자가 더 맞으면 그 박은 셋잇단으로 맞춘다 */
  readonly triplets?: boolean;
  /** 이 시간(ms) 안에 시작한 음은 한 화음으로 보고 같은 자리에 맞춘다 */
  readonly chordMs?: number;
  /**
   * 셋잇단으로 골랐지만 셋잇단 자리에 친 음이 분명하지 않은 박(밀려 친 정규 음)을 정규 칸으로 맞춰 본다.
   * 끄면(기본) 박 판정은 그대로다. 켜면 midiToSong이 화음 정리까지 한 결과를 비교해 나빠지지 않는 박만 바꾼다
   */
  readonly straighten?: boolean;
}

export const GRID_CHOICES = [4, 8, 16, 32, 64] as const;
/** 추정할 때 "맞는다"고 보는 오차(초)와 비율 */
const FIT_SECONDS = 0.03;
const FIT_RATIO = 0.97;

export interface QuantizeResult {
  readonly notes: GridNote[];
  /** 실제로 쓴 격자 */
  readonly grid: number;
  /** 셋잇단으로 맞춘 박 수 */
  readonly tripletBeats: number;
  /** 시작이 달랐는데 칸에 맞추며 같은 자리의 같은 음이 되어 하나로 합쳐진 음 수 */
  readonly merged: number;
  /** 셋잇단으로 골랐지만 셋잇단 자리에 친 음이 분명하지 않은 박 (박 번호 = 4분음표 순번) */
  readonly suspect: readonly number[];
}

/**
 * 박자 맞추기 (설계 11장 1단계). 화음 묶기 → 박마다 정규/셋잇단 격자 고르기 → 시작·끝 맞추기 →
 * 같은 음 겹침 정리. 길이는 최소 격자 하나.
 */
export function quantize(
  parts: readonly { readonly id: string; readonly notes: readonly RawNote[] }[],
  tempo: readonly TempoEvent[],
  options: QuantizeOptions = {},
): QuantizeResult {
  return prepareQuantize(parts, tempo, options).place();
}

export interface PreparedQuantize {
  readonly grid: number;
  /** 셋잇단으로 골랐지만 셋잇단 자리에 친 음이 분명하지 않은 박 */
  readonly suspect: readonly number[];
  /**
   * 칸에 맞춘다. straight: suspect 가운데 정규 칸으로 맞출 박.
   * window: [시작, 끝)(온음표 단위)에 걸친 음만 맞춘다 (박 하나를 바꿔 볼 때 빠르게 따지려고)
   */
  place(straight?: ReadonlySet<number>, window?: readonly [number, number]): QuantizeResult;
}

/** 격자 추정·화음 묶기·박 고르기까지 한 번 해 두고, 박 판정을 바꿔 가며 칸에 맞춰 볼 수 있게 한다 */
export function prepareQuantize(
  parts: readonly { readonly id: string; readonly notes: readonly RawNote[] }[],
  tempo: readonly TempoEvent[],
  options: QuantizeOptions = {},
): PreparedQuantize {
  const chordSeconds = (options.chordMs ?? 80) / 1000;
  const triplets = options.triplets ?? true;
  const all = parts.flatMap((p) => p.notes.map((n) => ({ n, part: p.id })));
  if (all.length === 0) return { grid: 16, suspect: [], place: () => ({ notes: [], grid: 16, tripletBeats: 0, merged: 0, suspect: [] }) };

  const secondsPerWhole = (at: number) => 240 / bpmAt(tempo, at);
  // 격자는 묶기 전의 음 시작으로 추정한다
  const rawOnsets = [...new Set(all.map(({ n }) => toFloat(n.start)))].sort((a, b) => a - b);
  const grid = options.grid && options.grid !== "auto" ? options.grid : guessGrid(rawOnsets, triplets, secondsPerWhole);

  // 화음 묶기: 파트마다 가까이 시작한 음을 묶고, 묶음의 평균 위치를 대표로 쓴다.
  // 빠른 악절의 이웃 음까지 묶지 않게 묶는 폭은 격자 한 칸의 40%를 넘지 않는다
  const anchor = new Map<RawNote, number>();
  for (const p of parts) {
    const sorted = [...p.notes].sort((a, b) => a.seconds - b.seconds);
    let group: RawNote[] = [];
    const flush = () => {
      const at = group.reduce((s, n) => s + toFloat(n.start), 0) / group.length;
      for (const n of group) anchor.set(n, at);
      group = [];
    };
    for (const n of sorted) {
      const width = Math.min(chordSeconds, (secondsPerWhole(toFloat(n.start)) / grid) * 0.4);
      if (group.length > 0 && n.seconds - group[0]!.seconds > width) flush();
      group.push(n);
    }
    if (group.length > 0) flush();
  }

  const onsets = [...new Set(anchor.values())].sort((a, b) => a - b);
  const mainChoice = chooseBeats(onsets, grid, triplets);
  const suspect = suspectTriplets(mainChoice, onsets, grid);
  // 칸에 맞추기 전 위치: 시작은 묶음 대표, 끝은 대표로 옮긴 만큼 함께 옮긴다
  const placed = all.map(({ n, part }) => {
    const at = anchor.get(n)!;
    return { n, part, at, end: toFloat(add(n.start, n.dur)) + (at - toFloat(n.start)) };
  });

  const place = (straight?: ReadonlySet<number>, window?: readonly [number, number]): QuantizeResult => {
    const beatChoice = new Map(mainChoice);
    for (const beat of suspect) if (straight?.has(beat)) beatChoice.set(beat, false);
    const snap = (x: number): Rat => {
      const beat = Math.floor(x * 4 + 1e-9);
      const step = beatChoice.get(beat) ? (grid * 3) / 2 : grid;
      return rat(Math.round(x * step), step);
    };

    const unit = rat(1, grid);
    const chosen = window ? placed.filter((x) => x.at < window[1] && x.end > window[0]) : placed;
    const out = chosen.map(({ n, part, at, end: rawEnd }) => {
      const start = snap(at);
      let end = snap(rawEnd);
      if (cmp(end, start) <= 0) end = add(start, unit);
      return { raw: n, note: { start, end, pitch: n.pitch, velocity: n.velocity, part } };
    });

    // 레가토로 살짝 겹친 음(겹침이 격자 반 칸보다 짧음)은 다음 음 시작에서 끊는다.
    // 안 끊으면 흔들림 때문에 홑음 줄이 화음처럼 보여 트랙이 늘어난다
    const byPart = new Map<string, typeof out>();
    for (const x of out) {
      const list = byPart.get(x.note.part);
      if (list) list.push(x);
      else byPart.set(x.note.part, [x]);
    }
    for (const list of byPart.values()) {
      list.sort((a, b) => cmp(a.note.start, b.note.start));
      for (let i = 0; i < list.length; i++) {
        const a = list[i]!;
        const rawEnd = toFloat(add(a.raw.start, a.raw.dur));
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j]!;
          const c = cmp(b.note.start, a.note.start);
          if (c === 0) continue;
          if (cmp(b.note.start, a.note.end) >= 0) break;
          const overlap = rawEnd - toFloat(b.raw.start);
          if (overlap <= 0.5 / grid) {
            a.note.end = b.note.start;
            break;
          }
        }
      }
    }

    // 원래 시작이 다른 같은 파트·같은 높이의 음이 같은 칸에 모이면 tidy가 하나로 합친다. 그 수를 알린다
    const spots = new Map<string, Set<number>>();
    for (const { raw, note } of out) {
      const key = `${note.part}:${note.pitch}:${toFloat(note.start)}`;
      spots.set(key, (spots.get(key) ?? new Set()).add(toFloat(raw.start)));
    }
    const merged = [...spots.values()].reduce((s, starts) => s + starts.size - 1, 0);

    return {
      notes: tidy(out.map(({ note }) => ({ start: note.start, dur: sub(note.end, note.start), pitch: note.pitch, velocity: note.velocity, part: note.part }))),
      grid,
      tripletBeats: [...beatChoice.values()].filter(Boolean).length,
      merged,
      suspect,
    };
  };
  return { grid, suspect, place };
}

/** 가장 굵은 격자 중 음 시작의 90%가 30ms 안에 맞는 것. 그런 격자가 없으면 가장 많이 맞는 격자 */
function guessGrid(onsets: readonly number[], triplets: boolean, secondsPerWhole: (at: number) => number): number {
  let best: number = GRID_CHOICES[2];
  let bestFit = -1;
  for (const grid of GRID_CHOICES) {
    const choice = chooseBeats(onsets, grid, triplets);
    let fit = 0;
    for (const x of onsets) {
      const step = choice.get(Math.floor(x * 4 + 1e-9)) ? (grid * 3) / 2 : grid;
      const error = Math.abs(x - Math.round(x * step) / step) * secondsPerWhole(x);
      if (error <= FIT_SECONDS) fit++;
    }
    if (fit >= onsets.length * FIT_RATIO) return grid;
    // 더 잘게 나눠도 맞는 음이 거의 늘지 않으면 굵은 쪽을 남긴다
    if (fit > bestFit + onsets.length * 0.05) {
      best = grid;
      bestFit = fit;
    }
  }
  return best;
}

/** 박(4분음표)마다 셋잇단 격자를 쓸지. 셋잇단 오차가 정규 오차의 절반보다 작을 때만 */
function chooseBeats(onsets: readonly number[], grid: number, triplets: boolean): Map<number, boolean> {
  const out = new Map<number, boolean>();
  if (!triplets) return out;
  const tri = (grid * 3) / 2;
  const errors = new Map<number, [number, number, number]>();
  for (const x of onsets) {
    const beat = Math.floor(x * 4 + 1e-9);
    const e = errors.get(beat) ?? [0, 0, 0];
    e[0] += Math.abs(x - Math.round(x * grid) / grid);
    e[1] += Math.abs(x - Math.round(x * tri) / tri);
    e[2]++;
    errors.set(beat, e);
  }
  for (const [beat, [bin, t, count]] of errors) {
    // 박의 첫 음 하나만 있는 박은 어느 쪽이든 같으므로 정규로 둔다
    out.set(beat, count >= 2 && t < bin * 0.5);
  }
  return out;
}

/**
 * 셋잇단으로 고른 박 가운데, 셋잇단 자리에 친 음이 분명하지 않은 박.
 * 32분·64분 격자의 셋잇단 칸(1/48·1/96)은 잘아서, 사람이 친 듯 조금씩 밀린 정규 음도 셋잇단 칸에 더 잘 맞아 보여
 * 셋잇단 박으로 골랐고, 길이가 19/192 같은 조각이 되어 글자 수가 늘었다.
 * "분명하다" = 정규 칸과 16분 셋잇단 칸(1/24)을 함께 쓰면 정규 칸만 쓸 때보다 오차가 4분의 1 아래로 준다.
 * 이 박을 정규 칸으로 맞출지는 음을 잃지 않는지 최종 결과로 따져야 하므로 여기서는 후보만 고른다 (midiToSong)
 */
function suspectTriplets(choice: ReadonlyMap<number, boolean>, onsets: readonly number[], grid: number): number[] {
  const coarse = (Math.min(grid, 16) * 3) / 2;
  const off = (x: number, step: number) => Math.abs(x - Math.round(x * step) / step);
  const errors = new Map<number, [number, number]>();
  for (const x of onsets) {
    const beat = Math.floor(x * 4 + 1e-9);
    const e = errors.get(beat) ?? [0, 0];
    e[0] += off(x, grid);
    e[1] += Math.min(off(x, grid), off(x, coarse));
    errors.set(beat, e);
  }
  const out: number[] = [];
  for (const [beat, triplet] of choice) {
    const [bin, mixed] = errors.get(beat)!;
    if (triplet && mixed >= bin * 0.25) out.push(beat);
  }
  return out.sort((a, b) => a - b);
}

function bpmAt(tempo: readonly TempoEvent[], at: number): number {
  let bpm = 120;
  for (const t of tempo) {
    if (toFloat(t.at) > at + 1e-9) break;
    bpm = t.bpm;
  }
  return bpm;
}

/** 같은 파트의 같은 음이 겹치면 앞 음을 뒤 음 시작에서 끊고, 같은 자리의 같은 음은 하나만 둔다 */
export function tidy(notes: readonly GridNote[]): GridNote[] {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start) || b.pitch - a.pitch);
  const out: GridNote[] = [];
  const last = new Map<string, number>();
  for (const n of sorted) {
    const key = `${n.part}:${n.pitch}`;
    const i = last.get(key);
    if (i !== undefined) {
      const prev = out[i]!;
      const c = cmp(prev.start, n.start);
      if (c === 0) {
        // 같은 자리에 두 번: 긴 쪽을 남긴다
        if (cmp(n.dur, prev.dur) > 0) out[i] = { ...prev, dur: n.dur, velocity: Math.max(prev.velocity, n.velocity) };
        continue;
      }
      if (cmp(add(prev.start, prev.dur), n.start) > 0) out[i] = { ...prev, dur: sub(n.start, prev.start) };
    }
    last.set(key, out.length);
    out.push(n);
  }
  return out;
}
