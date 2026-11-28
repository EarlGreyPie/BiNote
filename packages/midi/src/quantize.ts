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
  /** 타브 줄 번호 (MusicXML에서 읽었을 때만) */
  readonly string?: number;
  /** 악보 성부 (MusicXML). 있으면 tidy가 성부마다 따로 정리한다 */
  readonly voice?: string;
}

export interface QuantizeOptions {
  /** 격자 음길이(16 = 16분음표). "auto"면 곡에서 추정한다 */
  readonly grid?: number | "auto";
  /** 박마다 셋잇단 격자가 더 맞으면 그 박은 셋잇단으로 맞춘다. 4분·2분 셋잇단과 4분 5·7·9잇단도 이 설정을 따른다 */
  readonly triplets?: boolean;
  /** 이 시간(ms) 안에 시작한 음은 한 화음으로 보고 같은 자리에 맞춘다 */
  readonly chordMs?: number;
  /**
   * 셋잇단으로 골랐지만 셋잇단 자리에 친 음이 분명하지 않은 박(밀려 친 정규 음)을 정규 칸으로 맞춰 본다.
   * 끄면(기본) 박 판정은 그대로다. 켜면 midiToSong이 화음 정리까지 한 결과를 비교해 나빠지지 않는 박만 바꾼다
   */
  readonly straighten?: boolean;
  /**
   * 칸에 맞추지 않고 위치·길이를 그대로 쓴다 (MusicXML처럼 악보에 적힌 정확한 길이). 나머지 칸 설정은 쓰지 않는다
   */
  readonly exact?: boolean;
}

export const GRID_CHOICES = [4, 8, 16, 32, 64] as const;
/** 추정할 때 "맞는다"고 보는 오차(초)와 비율 */
const FIT_SECONDS = 0.03;
const FIT_RATIO = 0.97;
/** 굵은 격자가 시작을 이보다 멀리(초) 옮기면 잘게 친 음인지 본다 (guessGrid) */
const MOVE_SECONDS = 0.06;

export interface QuantizeResult {
  readonly notes: GridNote[];
  /** 실제로 쓴 격자 */
  readonly grid: number;
  /** 셋잇단으로 맞춘 박 수 */
  readonly tripletBeats: number;
  /** 4분 5잇단(1/20 칸)으로 맞춘 박 수 */
  readonly quintupletBeats: number;
  /** 4분 7잇단(1/28 칸)으로 맞춘 박 수 */
  readonly septupletBeats: number;
  /** 4분 9잇단(1/36 칸)으로 맞춘 박 수 */
  readonly nonupletBeats: number;
  /** 2박에 걸친 8분 5잇단(1/10 칸, l10)으로 맞춘 묶음 수 */
  readonly eighthQuintuplets: number;
  /** 한 마디(온음표)에 걸친 4분음표 5잇단(1/5 칸, l5)으로 맞춘 묶음 수 */
  readonly barQuintuplets: number;
  /** 시작이 달랐는데 칸에 맞추며 같은 자리의 같은 음이 되어 하나로 합쳐진 음 수 */
  readonly merged: number;
  /** 셋잇단으로 골랐지만 셋잇단 자리에 친 음이 분명하지 않은 박 (박 번호 = 4분음표 순번) */
  readonly suspect: readonly number[];
}

/**
 * 박자 맞추기 (설계 11장 1단계). 화음 묶기 → 박마다 정규/셋잇단/5·7·9잇단 격자 고르기 → 시작·끝 맞추기 →
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
  if (all.length === 0) return { grid: 16, suspect: [], place: () => ({ notes: [], grid: 16, tripletBeats: 0, quintupletBeats: 0, septupletBeats: 0, nonupletBeats: 0, eighthQuintuplets: 0, barQuintuplets: 0, merged: 0, suspect: [] }) };

  const secondsPerWhole = (at: number) => 240 / bpmAt(tempo, at);
  // 격자는 묶기 전의 음 시작으로 추정한다
  const rawOnsets = [...new Set(all.map(({ n }) => toFloat(n.start)))].sort((a, b) => a - b);
  const grid = options.grid && options.grid !== "auto" ? options.grid : guessGrid(rawOnsets, triplets, secondsPerWhole);

  // 화음 묶기: 파트마다 가까이 시작한 음을 묶고, 묶음의 평균 위치를 대표로 쓴다.
  // 빠른 악절의 이웃 음까지 묶지 않게 묶는 폭은 격자 한 칸의 40%를 넘지 않는다.
  // 5·7·9잇단 박은 칸이 격자보다 좁으므로 잇단 칸의 40%로 줄인다 (120 BPM 9잇단은 음 사이가 55ms라 격자 칸으로 재면 이웃 음이 묶였다)
  const rawChoice = chooseBeats(rawOnsets, grid, triplets);
  const cellOf = (at: number) => {
    const step = rawChoice.get(Math.floor(at * 4 + 1e-9));
    return step !== undefined && TUPLETS.some((t) => t.step === step) ? step : grid;
  };
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
      const width = Math.min(chordSeconds, (secondsPerWhole(toFloat(n.start)) / cellOf(toFloat(n.start))) * 0.4);
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
    for (const beat of suspect) if (straight?.has(beat)) beatChoice.delete(beat);
    const snap = (x: number): Rat => {
      const [n, d] = snapPoint(x, beatChoice.get(Math.floor(x * 4 + 1e-9)) ?? grid, grid);
      return rat(n, d);
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
      tripletBeats: [...beatChoice.values()].filter((step) => step === (grid * 3) / 2).length,
      quintupletBeats: [...beatChoice.values()].filter((step) => step === TUPLETS[0].step).length,
      septupletBeats: [...beatChoice.values()].filter((step) => step === TUPLETS[1].step).length,
      nonupletBeats: [...beatChoice.values()].filter((step) => step === TUPLETS[2].step).length,
      eighthQuintuplets: [...beatChoice.values()].filter((step) => step === WIDE_QUINTUPLETS[1].step).length / WIDE_QUINTUPLETS[1].beats,
      barQuintuplets: [...beatChoice.values()].filter((step) => step === WIDE_QUINTUPLETS[0].step).length / WIDE_QUINTUPLETS[0].beats,
      merged,
      suspect,
    };
  };
  return { grid, suspect, place };
}

/**
 * 격자 고르기: 가장 굵은 격자 중 음 시작의 97%가 30ms 안에 맞는 것. 그런 격자가 없으면 가장 많이 맞는 격자.
 *
 * 다만 굵은 격자가 어떤 시작을 60ms 넘게 옮기면, 그 시작이 "흔들린 음"인지 "잘게 친 음"인지 가린다.
 * 잘게 친 음이면 굵은 격자로 맞출 때 음이 한 칸 옆으로 가므로 그 굵은 격자는 쓰지 않는다.
 * 잘게 친 음으로 보려면 더 잘게 나눈 격자 가운데
 * - 두 단계 안(4분 격자면 8분·16분)이고 (외톨이 32분 엇박은 음악에서 드물어, 흔들린 음이 우연히 걸린 것으로 본다)
 * - 칸이 120ms 이상이며 (좁은 칸에는 흔들린 음도 어디엔가 걸린다)
 * - 그 칸 자리에 칸 너비의 20% 안, 30ms 안으로 붙어 있는
 * 격자가 있어야 한다. 칸 너비에 견준 기준이라 칸 가장자리에 겨우 걸린 음(60 BPM 32분 칸에서 29ms 어긋남)은 흔들림으로 본다.
 *
 * 지난 고침들 (같은 곳을 여러 번 고쳐 한 규칙으로 다시 짰다):
 * - 97%만 보면 한 음이 30ms 경계를 넘나드는 것만으로 1/8 ↔ 1/4가 바뀌어 엇박 8분음표가 옮겨졌다 (beta.38)
 * - 더 잘게 나눈 격자를 모두 보면 느린 곡의 흔들린 음 하나로 32분 격자가 되어 다른 음 길이까지 바뀌었다 (beta.39 점검)
 * - 바로 다음 격자만 보면 느린 곡의 외톨이 16분음표가 4분 칸으로 옮겨졌다 (beta.39 점검)
 */
function guessGrid(onsets: readonly number[], triplets: boolean, secondsPerWhole: (at: number) => number): number {
  // 격자마다 시작의 오차와 칸 너비(초)
  const errors = GRID_CHOICES.map((grid) => {
    const choice = chooseBeats(onsets, grid, triplets);
    const stepOf = (x: number) => choice.get(Math.floor(x * 4 + 1e-9)) ?? grid;
    return {
      grid,
      // 4분 격자의 셋잇단 칸(1/6)에는 박 경계(1/4·3/4)가 없다. 그래서 셋잇단 박에서 끝나는 정규 음(다른 파트의 4분음표 등)이
      // 1/6이나 1/3으로 밀린다. 셋잇단 박이 있어야 맞는 곡이면 셋잇단 칸(1/12)에 박 경계가 있는 8분 격자부터 본다
      skip: grid === 4 && choice.size > 0,
      error: onsets.map((x) => {
        const [n, d] = snapPoint(x, stepOf(x), grid);
        return Math.abs(x - n / d) * secondsPerWhole(x);
      }),
      cell: onsets.map((x) => secondsPerWhole(x) / stepOf(x)),
      tuplet: onsets.map((x) => {
        const step = stepOf(x);
        return isTupletStep(step) && snapPoint(x, step, grid)[1] === step;
      }),
      /** 칸에 맞춘 자리 (온음표 단위) */
      at: onsets.map((x) => {
        const [n, d] = snapPoint(x, stepOf(x), grid);
        return n / d;
      }),
    };
  });
  /** k번째 시작이 i번째 격자보다 잘게 친 음인가 (위 규칙) */
  const finerNote = (i: number, k: number) =>
    errors.slice(i + 1, i + 1 + FINER_LEVELS).some((f) => f.cell[k]! >= MIN_CELL_SECONDS && f.error[k]! <= Math.min(FIT_SECONDS, f.cell[k]! * TIGHT_RATIO));
  /**
   * k번째 시작이 더 잘게 나눈 격자에서 5·7·9잇단 칸에 붙어 있는데, i번째 격자가 그 음을 다른 자리로 옮기는가.
   * 옮기는 거리와 칸 너비(120ms)는 따지지 않는다. chooseBeats가 한 박에 시작이 4-8개 몰리고 잇단 칸 오차가
   * 정규 칸의 절반 아래일 때만 잇단을 고르므로, 흔들린 음 하나가 우연히 걸린 것이 아니다.
   * 거리로 따지면 빠른 곡(240 BPM 8분 칸 125ms)에서는 7·9잇단 음이 모두 60ms 안으로 옮겨져, 8분음표 위주 곡의
   * 잇단 한 박이 8분 격자로 뭉개지고 같은 높이 음이 합쳐졌다
   */
  const movesTuplet = (i: number, k: number) =>
    errors
      .slice(i + 1, i + 1 + FINER_LEVELS)
      .some((f) => f.tuplet[k]! && f.error[k]! <= Math.min(FIT_SECONDS, f.cell[k]! * TUPLET_TIGHT_RATIO) && Math.abs(f.at[k]! - errors[i]!.at[k]!) > 1e-9);
  let best: number = GRID_CHOICES[2];
  let bestFit = -1;
  for (const [i, { grid, skip, error }] of errors.entries()) {
    if (skip) continue;
    const fit = error.filter((e) => e <= FIT_SECONDS).length;
    const movesFinerNote = error.some((e, k) => (e > MOVE_SECONDS && finerNote(i, k)) || movesTuplet(i, k));
    if (fit >= onsets.length * FIT_RATIO && !movesFinerNote) return grid;
    // 더 잘게 나눠도 맞는 음이 거의 늘지 않으면 굵은 쪽을 남긴다
    if (!movesFinerNote && fit > bestFit + onsets.length * 0.05) {
      best = grid;
      bestFit = fit;
    }
  }
  return best;
}
/** 잘게 친 음을 찾을 때 볼 더 잘게 나눈 격자 단계 수 */
const FINER_LEVELS = 2;
/** 잘게 친 음으로 볼 칸의 가장 좁은 너비(초) */
const MIN_CELL_SECONDS = FIT_SECONDS * 4;
/** 잘게 친 음으로 보려면 칸 자리에 칸 너비의 이 비율 안으로 붙어 있어야 한다 */
const TIGHT_RATIO = 0.2;
/** 5·7·9잇단 박의 음은 칸이 좁으니 칸 너비의 이 비율 안이면 된다 (30ms 한도는 그대로) */
const TUPLET_TIGHT_RATIO = 0.35;

/**
 * 4분음표 한 박을 5·7·9개로 나눈 잇단 칸 (온음표를 20·28·36칸으로). 16분보다 굵은 격자에서는 쓰지 않는다
 * (8분 격자에서는 흔들린 16분음표가 5잇단 칸에 더 잘 맞아 보일 수 있다).
 * minOnsets: 그 잇단으로 보려면 한 박에 있어야 하는 시작 수 (잇단 음 수보다 하나 적게: 쉼표 하나는 봐준다).
 * 점음표 리듬 두세 음이나 흔들린 16분 넷이 우연히 잇단 칸에 맞는 일을 막는다. 7·9잇단은 16분 격자의 한 박(4칸)보다
 * 시작이 많아야 하므로 정규 16분 리듬과 헷갈리지 않는다.
 * regular: 같이 견줄 정규 칸. 9잇단 칸(1/36)은 32분 칸보다 잘아서, 16분 격자에서 32분음표 8개도 9잇단 칸에 더 잘 맞아 보인다.
 * 그래서 9잇단은 32분 칸으로 맞출 때보다도 오차가 절반 아래여야 한다
 */
const TUPLETS = [
  { step: 20, minOnsets: 4, regular: 16 },
  { step: 28, minOnsets: 6, regular: 16 },
  { step: 36, minOnsets: 8, regular: 32 },
] as const;

/**
 * 박을 넘는 5잇단 칸. beats박(박 수의 배수 자리에서 시작)에 5음을 고르게 둔다.
 * - 4분음표 5잇단: 한 마디(4박, 온음표)에 5음, 1/5 칸 (l5)
 * - 8분음표 5잇단: 2박(2분음표)에 5음, 1/10 칸 (l10)
 * 넓은 쪽을 먼저 본다. 1/5 자리는 1/10 자리이기도 해서, 한 마디 5잇단을 2박씩 나눠 보면 앞 2박에 시작이 셋뿐이라 8분 5잇단이 되지 않는다.
 * minOnsets: 한 묶음에 있어야 하는 5잇단 시작 수 (쉼표 하나는 봐준다). 묶음 첫 자리는 정규 박과 같아 가릴 수 없으므로,
 * 나머지 네 자리 가운데 minOnsets - 1 자리 이상에 5잇단 칸에 더 가까운 시작이 있어야 한다
 */
const WIDE_QUINTUPLETS = [
  { step: 5, beats: 4, minOnsets: 4 },
  { step: 10, beats: 2, minOnsets: 4 },
] as const;

/**
 * x를 박의 칸에 맞춘 자리 (분자, 분모). 박을 넘는 5잇단 박은 5잇단 칸과 정규 격자 가운데 가까운 쪽에 둔다.
 * 1/5·1/10 칸에는 박 경계(1/4 등)가 없어서, 한 칸만 쓰면 같은 때 박에 맞춰 친 다른 파트의 음(왼손 4분음표 등)이 옮겨진다
 */
function snapPoint(x: number, step: number, grid: number): [number, number] {
  const own: [number, number] = [Math.round(x * step), step];
  if (!WIDE_QUINTUPLETS.some((t) => t.step === step)) return own;
  // 5잇단 음인지는 chooseBeats처럼 16분 칸과 견줘 가린다. 아니면 곡의 격자(32분 등)에 둔다
  const rival = Math.min(grid, WIDE_RIVAL);
  const off = (s: number) => Math.abs(x - Math.round(x * s) / s);
  return off(step) < off(rival) ? own : [Math.round(x * grid), grid];
}

/** 박을 넘는 5잇단 음을 가릴 때 견주는 가장 잘게 나눈 정규 칸 (16분) */
const WIDE_RIVAL = 16;

/** 정규·셋잇단이 아닌 잇단 칸인가 (격자 추정에서 잇단 음을 흔들린 음과 가르려고) */
function isTupletStep(step: number): boolean {
  return TUPLETS.some((t) => t.step === step) || WIDE_QUINTUPLETS.some((t) => t.step === step);
}

/** 박마다 쓸 칸 수 (온음표를 몇 칸으로 나누나). 없으면 정규 격자 */
type BeatSteps = Map<number, number>;

/**
 * 박(4분음표)마다 정규·셋잇단·5·7·9잇단 가운데 어느 칸을 쓸지.
 * 셋잇단: 박 안의 셋잇단 오차가 정규 오차의 절반보다 작을 때. 시작이 하나뿐인 박은 박을 넘는 셋잇단(4분·2분 셋잇단)일 때만
 * 셋잇단으로 본다. 그 시작이 8분 셋잇단 자리(박의 1/3·2/3)에 있고, 이웃 박과 묶은 2박 창에 그런 시작이 둘 이상 있으며,
 * 창의 어느 시작도 정규 칸에 더 가깝지 않고, 창 전체의 셋잇단 오차가 정규 오차의 절반보다 작아야 한다.
 * 흔들린 정규 음 하나를 셋잇단으로 잘못 보지 않게 하려고 창으로 본다.
 * 5·7·9잇단: 16분이나 그보다 잘게 나눈 격자에서, 시작이 TUPLETS의 minOnsets 이상인 박의 잇단 오차가
 * 정규·셋잇단(9잇단은 32분 칸도) 오차 가운데 가장 작은 것의 절반보다 작을 때. 여럿이 되면 오차가 가장 작은 잇단
 * 박을 넘는 5잇단(WIDE_QUINTUPLETS): 8분이나 그보다 잘게 나눈 격자에서, 묶음 자리(2박·4박)의 첫 자리를 뺀 5잇단 자리
 * 넷 가운데 셋 이상에 정규·셋잇단 칸보다 5잇단 칸에 더 가까운 시작이 있고, 그 시작들의 5잇단 오차가 정규·셋잇단 오차 가운데
 * 작은 쪽의 절반보다 작을 때. 묶음 안 박에 이미 4분 5·7·9잇단을 골랐으면 건드리지 않는다.
 * 묶음 안의 다른 시작(다른 파트의 박 음 등)은 정규 격자에 그대로 둔다 (snapPoint).
 * 묶음 전체로 보므로, 흔들린 정규 음 한두 개가 5잇단 칸에 걸린다고 바뀌지 않는다
 */
function chooseBeats(onsets: readonly number[], grid: number, triplets: boolean): BeatSteps {
  const out: BeatSteps = new Map();
  if (!triplets) return out;
  const tri = (grid * 3) / 2;
  // 박을 넘는 셋잇단 자리를 가리는 굵은 셋잇단 칸 (8분 셋잇단, 4분 격자면 4분 셋잇단)
  const coarse = Math.min(tri, 12);
  const off = (x: number, step: number) => Math.abs(x - Math.round(x * step) / step);
  const beats = new Map<number, number[]>();
  for (const x of onsets) {
    const beat = Math.floor(x * 4 + 1e-9);
    const list = beats.get(beat);
    if (list) list.push(x);
    else beats.set(beat, [x]);
  }
  const sum = (list: readonly number[], step: number) => list.reduce((s, x) => s + off(x, step), 0);
  for (const [beat, list] of beats) {
    const bin = sum(list, grid);
    const t = sum(list, tri);
    // 박의 첫 음 하나만 있는 박은 어느 쪽이든 같으므로 정규로 둔다 (박을 넘는 셋잇단은 아래에서 따로 본다)
    if (list.length >= 2 && t < bin * 0.5) out.set(beat, tri);
    if (grid < 16) continue;
    let best: { step: number; error: number } | undefined;
    for (const { step, minOnsets, regular } of TUPLETS) {
      if (list.length < minOnsets) continue;
      const error = sum(list, step);
      const rival = Math.min(bin, t, regular > grid ? sum(list, regular) : Infinity);
      if (error < rival * 0.5 && (!best || error < best.error)) best = { step, error };
    }
    if (best) out.set(beat, best.step);
  }
  // 박을 넘는 5잇단: 묶음 자리(2박·4박)마다 본다
  if (grid >= 8) {
    // 견줄 정규·셋잇단 칸은 16분·16분 셋잇단까지만. 더 잘게 나눈 칸(32분 1/32 등)은 5잇단 자리에도 가까워 무엇이든 설명해 버린다
    const wideRival = Math.min(grid, WIDE_RIVAL);
    const wideTri = (wideRival * 3) / 2;
    const firstBeat = Math.min(...beats.keys());
    const lastBeat = Math.max(...beats.keys());
    for (const { step, beats: span, minOnsets } of WIDE_QUINTUPLETS) {
      for (let start = Math.floor(firstBeat / span) * span; start <= lastBeat; start += span) {
        const covered = Array.from({ length: span }, (_, i) => start + i);
        if (covered.some((b) => TUPLETS.some((t) => t.step === out.get(b)) || WIDE_QUINTUPLETS.some((t) => t.step === out.get(b)))) continue;
        const origin = start / 4;
        const window = covered.flatMap((b) => beats.get(b) ?? []);
        // 5잇단 칸에 더 가까운 시작. 정규 격자와 겹치는 5잇단 자리(묶음 첫 자리)는 어느 쪽인지 가릴 수 없어 세지 않는다
        const own = window.filter((x) => off(x, step) < Math.min(off(x, wideRival), off(x, wideTri)) && Math.round((x - origin) * step) % 5 !== 0);
        const slots = new Set(own.map((x) => Math.round((x - origin) * step)));
        if (slots.size < minOnsets - 1) continue;
        if (sum(own, step) < Math.min(sum(own, wideRival), sum(own, wideTri)) * 0.5) for (const b of covered) out.set(b, step);
      }
    }
  }
  // 박을 넘는 셋잇단: 시작이 하나뿐인 박을 이웃 박과 묶은 2박 창에서 본다
  const across = (x: number) => off(x, coarse) < off(x, grid) * 0.5;
  for (const [beat, list] of beats) {
    if (list.length !== 1 || out.has(beat) || !across(list[0]!)) continue;
    for (const other of [beat - 1, beat + 1]) {
      const window = [...list, ...(beats.get(other) ?? [])];
      if (window.filter(across).length >= 2 && window.every((x) => off(x, tri) <= off(x, grid)) && sum(window, tri) < sum(window, grid) * 0.5) {
        out.set(beat, tri);
        break;
      }
    }
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
function suspectTriplets(choice: ReadonlyMap<number, number>, onsets: readonly number[], grid: number): number[] {
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
  for (const [beat, step] of choice) {
    const [bin, mixed] = errors.get(beat)!;
    if (step === (grid * 3) / 2 && mixed >= bin * 0.25) out.push(beat);
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

/** 같은 파트(성부가 있으면 같은 성부)의 같은 음이 겹치면 앞 음을 뒤 음 시작에서 끊고, 같은 자리의 같은 음은 하나만 둔다 */
export function tidy(notes: readonly GridNote[]): GridNote[] {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start) || b.pitch - a.pitch);
  const out: GridNote[] = [];
  const last = new Map<string, number>();
  for (const n of sorted) {
    const key = `${n.part}:${n.voice ?? ""}:${n.pitch}`;
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
