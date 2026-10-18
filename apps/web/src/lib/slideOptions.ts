import type { SlideKind } from "@mmlce/core";
import { NOTE_LENGTHS, type NoteLength } from "./roll";

/** 슬라이드 창에서 고른 것 (이 브라우저에 마지막 값을 기억한다) */
export interface SlideChoice {
  readonly kind: SlideKind;
  readonly path: "chromatic" | "direct";
  readonly direction: "down" | "up";
  readonly semitones: number;
  /** 미끄러지는 길이 */
  readonly length: Exclude<NoteLength, "grid">;
  /** 한 걸음 길이 ("auto"면 자동) */
  readonly step: Exclude<NoteLength, "grid"> | "auto";
}

export const SLIDE_KEY = "mmlce.slide";

export const DEFAULT_SLIDE: SlideChoice = { kind: "between", path: "chromatic", direction: "down", semitones: 2, length: "16", step: "auto" };

const LENGTHS = NOTE_LENGTHS.filter((l): l is Exclude<NoteLength, "grid"> => l !== "grid");

/** 저장해 둔 값을 읽는다. 모르는 값은 기본으로 */
export function parseSlideChoice(raw: unknown): SlideChoice {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const semitones = typeof v.semitones === "number" && Number.isInteger(v.semitones) && v.semitones >= 1 && v.semitones <= 12 ? v.semitones : DEFAULT_SLIDE.semitones;
  return {
    kind: pick(v.kind, ["between", "in", "out"] as const, DEFAULT_SLIDE.kind),
    path: pick(v.path, ["chromatic", "direct"] as const, DEFAULT_SLIDE.path),
    direction: pick(v.direction, ["down", "up"] as const, DEFAULT_SLIDE.direction),
    semitones,
    length: pick(v.length, LENGTHS, DEFAULT_SLIDE.length),
    step: pick(v.step, [...LENGTHS, "auto"] as const, DEFAULT_SLIDE.step),
  };
}
