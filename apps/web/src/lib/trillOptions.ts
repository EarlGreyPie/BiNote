import { TRILL_OFFSET_LIMIT, TRILL_VOLUME_DEPTH_LIMIT, TRILL_VOLUME_PATTERNS, type TrillKind, type TrillVolumePattern } from "@mmlce/core";
import { parseStrings } from "./graceOptions";

/** 트릴·트레몰로 창에서 고르는 음 하나 길이 (게임 최단 l64부터 l8까지) */
export const TRILL_LENGTHS = ["64", "48", "32", "24", "16", "12", "8"] as const;
export type TrillLength = (typeof TRILL_LENGTHS)[number];

/** 트릴·트레몰로 창에서 고른 것 (이 브라우저에 마지막 값을 기억한다) */
export interface TrillChoice {
  readonly kind: TrillKind;
  /** 트릴 상대 음: 본음 기준 반음 수 (0 아님) */
  readonly offset: number;
  readonly length: TrillLength;
  readonly startOther: boolean;
  readonly endOnMain: boolean;
  readonly tie: boolean;
  /** 나눈 음의 v 모양, 낮은 v 깊이, 전체 낮추기 ("auto" = 프로필의 실측 권장값) */
  readonly volumePattern: TrillVolumePattern;
  readonly volumeDepth: number;
  readonly volumeLower: number | "auto";
  /** 끊어 치기 (음마다 앞 절반만 소리) */
  readonly staccato: boolean;
}

export const TRILL_KEY = "mmlce.trill";

/**
 * 기본: 온음 위 트릴, l32, 본음부터, 본음으로 끝내기 끔, &로 잇기 끔, v 모두 같게, 끊어 치기 끔.
 * 트레몰로 실측(2026-10-27): 빠르게 다시 치면 커지므로 전체 낮추기는 자동, 번갈아 작게는 4단계 차이(v12·v8)가 l32에서
 * 거의 안 들려 깊이 5
 */
export const DEFAULT_TRILL: TrillChoice = {
  kind: "trill",
  offset: 2,
  length: "32",
  startOther: false,
  endOnMain: false,
  tie: false,
  volumePattern: "same",
  volumeDepth: 5,
  volumeLower: "auto",
  staccato: false,
};

/** 저장해 둔 값을 읽는다. 모르는 값은 기본으로 */
export function parseTrillChoice(raw: unknown): TrillChoice {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
  const step = (x: unknown, d: number) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= TRILL_VOLUME_DEPTH_LIMIT ? (x as number) : d);
  return {
    kind: v.kind === "tremolo" ? "tremolo" : "trill",
    offset: Number.isInteger(v.offset) && v.offset !== 0 && Math.abs(v.offset as number) <= TRILL_OFFSET_LIMIT ? (v.offset as number) : DEFAULT_TRILL.offset,
    length: TRILL_LENGTHS.includes(v.length as TrillLength) ? (v.length as TrillLength) : DEFAULT_TRILL.length,
    startOther: bool(v.startOther, DEFAULT_TRILL.startOther),
    endOnMain: bool(v.endOnMain, DEFAULT_TRILL.endOnMain),
    tie: bool(v.tie, DEFAULT_TRILL.tie),
    volumePattern: TRILL_VOLUME_PATTERNS.includes(v.volumePattern as TrillVolumePattern) ? (v.volumePattern as TrillVolumePattern) : DEFAULT_TRILL.volumePattern,
    volumeDepth: step(v.volumeDepth, DEFAULT_TRILL.volumeDepth),
    volumeLower: v.volumeLower === "auto" ? "auto" : step(v.volumeLower, -1) < 0 ? DEFAULT_TRILL.volumeLower : step(v.volumeLower, 0),
    staccato: bool(v.staccato, DEFAULT_TRILL.staccato),
  };
}

/**
 * 상대 음 입력 글 → 본음 기준 반음 수 하나. 타브(fret 있음)는 본음 줄의 프렛 번호(0~maxFret, 본음 프렛과 다름)를 받고,
 * 피아노롤은 0이 아닌 반음 수(+2, -1)를 받는다. 잘못되면 undefined
 */
export function parseTrillInput(text: string, tab?: { fret: number; maxFret: number }): number | undefined {
  const p = text.trim();
  if (!(tab ? /^\d+$/ : /^[+-]?\d+$/).test(p)) return undefined;
  const x = Number(p);
  const offset = tab ? (x > tab.maxFret ? NaN : x - tab.fret) : x;
  return Number.isInteger(offset) && offset !== 0 && Math.abs(offset) <= TRILL_OFFSET_LIMIT ? offset : undefined;
}

/** 반음 수 → 입력 글 (parseTrillInput의 반대). 타브에서 프렛이 0 밑이나 maxFret 위로 가면 undefined */
export function formatTrillInput(offset: number, tab?: { fret: number; maxFret: number }): string | undefined {
  if (tab) {
    const fret = tab.fret + offset;
    return fret >= 0 && fret <= tab.maxFret ? String(fret) : undefined;
  }
  return offset > 0 ? `+${offset}` : String(offset);
}

/** 만든 기록에 남기는 설정: 고른 것, 타브에서 열었으면 기준 본음 프렛, 나눈 음을 놓은 타브 줄 (고른 음 id → 줄) */
export interface TrillMade {
  readonly choice: TrillChoice;
  readonly tab?: { readonly fret: number; readonly string: number; readonly maxFret: number };
  readonly strings: readonly (readonly [string, number])[];
}

/** 만든 기록의 설정을 읽는다 (모르는 값은 기본으로) */
export function parseTrillMade(raw: unknown): TrillMade {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const t = v.tab && typeof v.tab === "object" ? (v.tab as Record<string, unknown>) : undefined;
  const int = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;
  const tab = t && int(t.fret) && int(t.string) && int(t.maxFret) ? { fret: t.fret as number, string: t.string as number, maxFret: t.maxFret as number } : undefined;
  // 전체 낮추기가 없던 판(beta.29)에 만든 기록은 낮추지 않은 것이다 (다시 고치기가 같은 결과로 열리게)
  const c = v.choice && typeof v.choice === "object" ? (v.choice as Record<string, unknown>) : undefined;
  const choice = parseTrillChoice(c && !("volumeLower" in c) ? { ...c, volumeLower: 0 } : v.choice);
  return { choice, ...(tab ? { tab } : {}), strings: parseStrings(v.strings) };
}
