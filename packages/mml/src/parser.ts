import { add, fromLength, ZERO, type Rat, type TempoEvent } from "@mmlce/core";

/** 파서가 읽어 낸 음 하나. id·트랙 정보는 호출한 쪽이 붙인다. */
export interface ParsedNote {
  readonly start: Rat;
  readonly dur: Rat;
  /** MIDI 번호. o4c = 60, MML의 n48 = o4c */
  readonly pitch: number;
  readonly vol: number;
  readonly tie: "none" | "next";
  /** 원문에서 이 음이 차지한 범위 [from, to) */
  readonly span: readonly [number, number];
}

export type DiagnosticLevel = "error" | "warning" | "info";

/**
 * 진단은 코드와 값만 담는다. 화면은 `@mmlce/i18n`의 `diag.<code>` 문구로 사용자의 언어로 보여준다.
 */
export interface Diagnostic {
  readonly level: DiagnosticLevel;
  readonly code: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly span: readonly [number, number];
}

export interface ParseOptions {
  /** 채널 시작 옥타브. 마비노기 기본 o4 */
  readonly octave?: number;
  readonly length?: number;
  readonly volume?: number;
}

/** 원문에 쓴 숫자 값. 검사기가 프로필 범위와 비교한다 (파서는 범위를 모른다) */
export interface WrittenValue {
  readonly kind: "tempo" | "length" | "dots" | "volume";
  readonly value: number;
  readonly span: readonly [number, number];
}

/** 쉼표 하나. 원문 수술(템포 넣기)이 요소 경계를 찾을 때 쓴다 */
export interface ParsedRest {
  readonly start: Rat;
  readonly dur: Rat;
  readonly span: readonly [number, number];
}

export interface ParseResult {
  readonly notes: ParsedNote[];
  readonly rests: ParsedRest[];
  readonly values: WrittenValue[];
  readonly tempo: TempoEvent[];
  readonly diagnostics: Diagnostic[];
  /** 마지막 음·쉼표가 끝나는 위치 */
  readonly end: Rat;
}

const SEMITONE: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** MIDI 번호 = (옥타브 + 1) × 12 + 반음. MML의 n 번호는 MIDI − 12 */
export const N_COMMAND_OFFSET = 12;

export function midiFromOctave(octave: number, semitone: number): number {
  return (octave + 1) * 12 + semitone;
}

/**
 * MML 채널 하나를 읽는다. 범위 밖 값(t288, v20 등)은 거부하지 않고 그대로 읽는다.
 * 게임 한도 검사는 검사기가 프로필을 보고 따로 한다.
 */
export function parseMml(text: string, options: ParseOptions = {}): ParseResult {
  const src = text.toLowerCase();
  const notes: ParsedNote[] = [];
  const rests: ParsedRest[] = [];
  const tempo: TempoEvent[] = [];
  const diagnostics: Diagnostic[] = [];
  const values: WrittenValue[] = [];
  const written = (kind: WrittenValue["kind"], value: number, from: number, to: number) => {
    values.push({ kind, value, span: [from, to] });
  };

  let octave = options.octave ?? 4;
  let defaultLength = options.length ?? 4;
  let defaultDots = 0;
  let volume = options.volume ?? 8;
  let pos: Rat = ZERO;
  let i = 0;

  const diag = (
    level: DiagnosticLevel,
    code: string,
    from: number,
    to: number,
    params?: Record<string, string | number>,
  ) => {
    diagnostics.push(params ? { level, code, params, span: [from, to] } : { level, code, span: [from, to] });
  };

  const readInt = (): number | undefined => {
    const start = i;
    while (i < src.length && src.charCodeAt(i) >= 48 && src.charCodeAt(i) <= 57) i++;
    return i > start ? Number(src.slice(start, i)) : undefined;
  };

  const readDots = (): number => {
    let dots = 0;
    while (src[i] === ".") {
      dots++;
      i++;
    }
    return dots;
  };

  // 음길이: 숫자가 없으면 l 값과 l에 붙은 점을 물려받고, 숫자나 점을 직접 쓰면 그것을 쓴다.
  const readDuration = (from: number): Rat => {
    const len = readInt();
    const dots = readDots();
    const length = len ?? defaultLength;
    const useDots = len === undefined && dots === 0 ? defaultDots : dots;
    if (len !== undefined) written("length", len, from, i);
    if (dots > 0) written("dots", dots, from, i);
    if (length < 1) {
      diag("error", "length-zero", from, i);
      return fromLength(defaultLength, defaultDots);
    }
    return fromLength(length, useDots);
  };

  // 서로소 음길이(l7·l11·l13 …)가 쌓이면 분수가 안전한 정수 범위를 넘을 수 있다. 예외로 끝내지 않고 진단으로 알린 뒤 거기서 멈춘다
  let statement = 0;
  try {
    while (i < src.length) {
      const ch = src[i]!;
      const from = i;
      statement = from;

      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        i++;
        continue;
      }

      // /* ... */ 주석 (3MLE 파일에 들어 있음)
      if (ch === "/" && src[i + 1] === "*") {
        const close = src.indexOf("*/", i + 2);
        if (close < 0) {
          // 3MLE는 닫히지 않은 주석을 채널 끝까지 주석으로 본다
          diag("warning", "unclosed-comment", from, src.length);
          break;
        }
        i = close + 2;
        continue;
      }

      if (ch in SEMITONE || ch === "n") {
        i++;
        let pitch: number;
        if (ch === "n") {
          const num = readInt();
          if (num === undefined) {
            diag("error", "n-number", from, i);
            continue;
          }
          pitch = num + N_COMMAND_OFFSET;
          // n 음표는 숫자가 음 번호라서 길이는 l 값을 쓴다
          const dur = fromLength(defaultLength, defaultDots);
          notes.push({ start: pos, dur, pitch, vol: volume, tie: "none", span: [from, i] });
          pos = add(pos, dur);
          continue;
        }
        let semitone = SEMITONE[ch]!;
        while (src[i] === "+" || src[i] === "#" || src[i] === "-") {
          semitone += src[i] === "-" ? -1 : 1;
          i++;
        }
        pitch = midiFromOctave(octave, semitone);
        const dur = readDuration(from);
        notes.push({ start: pos, dur, pitch, vol: volume, tie: "none", span: [from, i] });
        pos = add(pos, dur);
        continue;
      }

      switch (ch) {
        case "r": {
          i++;
          const dur = readDuration(from);
          rests.push({ start: pos, dur, span: [from, i] });
          pos = add(pos, dur);
          continue;
        }
        case "&": {
          i++;
          const last = notes[notes.length - 1];
          // 바로 앞이 음표일 때만 잇는다. 쉼표 뒤의 &는 의미가 없다.
          if (last && last.tie === "none" && last.span[1] <= from && endsAt(last, pos)) {
            notes[notes.length - 1] = { ...last, tie: "next" };
          } else {
            diag("warning", "tie-without-note", from, i);
          }
          continue;
        }
        case "o": {
          i++;
          const num = readInt();
          if (num === undefined) diag("error", "o-number", from, i);
          else octave = num;
          continue;
        }
        case "<":
          i++;
          octave--;
          continue;
        case ">":
          i++;
          octave++;
          continue;
        case "l": {
          i++;
          const num = readInt();
          const dots = readDots();
          if (num === undefined || num < 1) {
            diag("error", "l-number", from, i);
          } else {
            defaultLength = num;
            defaultDots = dots;
            written("length", num, from, i);
            if (dots > 0) written("dots", dots, from, i);
          }
          continue;
        }
        case "v": {
          i++;
          const num = readInt();
          if (num === undefined) diag("error", "v-number", from, i);
          else {
            volume = num;
            written("volume", num, from, i);
          }
          continue;
        }
        case "t": {
          i++;
          const num = readInt();
          if (num === undefined || num < 1) {
            diag("error", "t-number", from, i);
          } else {
            tempo.push({ at: pos, bpm: num });
            written("tempo", num, from, i);
          }
          continue;
        }
        default:
          i++;
          // 3MLE처럼 건너뛰고 계속 읽는다. 게임에 그대로 넣으면 문제가 될 수 있어 경고로 남긴다
          diag("warning", "unknown-char", from, i, { char: text[from]! });
      }
    }
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    diag("error", "length-overflow", statement, src.length);
    // 끝 위치를 셀 수 없는 음(넘치기 직전에 넣은 음)은 뒤 계산(재생·검사)에서도 넘치므로 뺀다
    const fits = (n: ParsedNote) => {
      try {
        add(n.start, n.dur);
        return true;
      } catch {
        return false;
      }
    };
    while (notes.length > 0 && !fits(notes[notes.length - 1]!)) notes.pop();
  }

  return { notes, rests, values, tempo, diagnostics, end: pos };
}

function endsAt(note: ParsedNote, pos: Rat): boolean {
  const end = add(note.start, note.dur);
  return end.n === pos.n && end.d === pos.d;
}
