import { cmp, type Note, type Rat, type SlideKind, type Song } from "@mmlce/core";
import { NOTE_LENGTHS, type NoteLength } from "./roll";

/** 슬라이드 창에서 고른 것 (이 브라우저에 마지막 값을 기억한다) */
export interface SlideChoice {
  readonly kind: SlideKind;
  readonly path: "chromatic" | "direct";
  /** 들어가기·나가기 (들어가고 나가기에서는 들어가는 쪽) */
  readonly direction: "down" | "up";
  readonly semitones: number;
  /** 미끄러지는 길이 */
  readonly length: Exclude<NoteLength, "grid">;
  /** 들어가고 나가기의 나가는 쪽 */
  readonly outDirection: "down" | "up";
  readonly outSemitones: number;
  readonly outLength: Exclude<NoteLength, "grid">;
  /** 들어가기를 도착 음 앞부분에서(on) / 앞 음 꼬리에서(before, 박 앞) */
  readonly timing: "on" | "before";
  /** 음색 바뀌는 곳에서 끊기 */
  readonly breakAtZones: boolean;
  /** 한 걸음 길이 ("auto"면 자동) */
  readonly step: Exclude<NoteLength, "grid"> | "auto";
}

export const SLIDE_KEY = "mmlce.slide";

export const DEFAULT_SLIDE: SlideChoice = {
  kind: "between",
  path: "chromatic",
  direction: "down",
  semitones: 2,
  length: "16",
  outDirection: "down",
  outSemitones: 2,
  outLength: "16",
  timing: "on",
  breakAtZones: true,
  step: "auto",
};

const LENGTHS = NOTE_LENGTHS.filter((l): l is Exclude<(typeof NOTE_LENGTHS)[number], "grid"> => l !== "grid");

/** 저장해 둔 값을 읽는다. 모르는 값은 기본으로 */
export function parseSlideChoice(raw: unknown): SlideChoice {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const count = (value: unknown, fallback: number) => (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12 ? value : fallback);
  return {
    kind: pick(v.kind, ["between", "in", "out", "both"] as const, DEFAULT_SLIDE.kind),
    path: pick(v.path, ["chromatic", "direct"] as const, DEFAULT_SLIDE.path),
    direction: pick(v.direction, ["down", "up"] as const, DEFAULT_SLIDE.direction),
    semitones: count(v.semitones, DEFAULT_SLIDE.semitones),
    length: pick(v.length, LENGTHS, DEFAULT_SLIDE.length),
    outDirection: pick(v.outDirection, ["down", "up"] as const, DEFAULT_SLIDE.outDirection),
    outSemitones: count(v.outSemitones, DEFAULT_SLIDE.outSemitones),
    outLength: pick(v.outLength, LENGTHS, DEFAULT_SLIDE.outLength),
    timing: pick(v.timing, ["on", "before"] as const, DEFAULT_SLIDE.timing),
    breakAtZones: typeof v.breakAtZones === "boolean" ? v.breakAtZones : DEFAULT_SLIDE.breakAtZones,
    step: pick(v.step, [...LENGTHS, "auto"] as const, DEFAULT_SLIDE.step),
  };
}

/**
 * 타브에서 고른 음 없이 슬라이드를 열 때 쓸 음: 커서 자리에서 시작하는 화음 전체 (지금 트랙과 같은 악보의 소리 나는 트랙마다).
 * 빈 자리에서 화음 전체로 "/" 들어가기를 한 번에 하려고 (줄마다 자기 트랙에서 미끄러진다)
 */
export function tabSlidePick(song: Pick<Song, "tracks">, activeTrackId: string | undefined, at: Rat | undefined): Note[] {
  const active = song.tracks.find((t) => t.id === activeTrackId);
  if (!active || !at) return [];
  return song.tracks.filter((t) => t.playerId === active.playerId && !t.mute).flatMap((t) => t.notes.filter((n) => cmp(n.start, at) === 0));
}
