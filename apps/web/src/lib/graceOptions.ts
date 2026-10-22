import type { GraceTiming } from "@mmlce/core";

/** 꾸밈음 창에서 고르는 꾸밈음 하나 길이 (게임 최단 l64부터 l16까지) */
export const GRACE_LENGTHS = ["64", "48", "32", "24", "16"] as const;
export type GraceLength = (typeof GRACE_LENGTHS)[number];

/** 꾸밈음 창에서 고른 것 (이 브라우저에 마지막 값을 기억한다) */
export interface GraceChoice {
  /** 꾸밈음 높이: 본음 기준 반음 수, 치는 순서대로 */
  readonly offsets: readonly number[];
  readonly length: GraceLength;
  readonly timing: GraceTiming;
  readonly tie: boolean;
}

export const GRACE_KEY = "mmlce.grace";

/** 기본: 2반음 아래 꾸밈음 하나, l64, 박 위에서, &로 잇기 끔 */
export const DEFAULT_GRACE: GraceChoice = { offsets: [-2], length: "64", timing: "on", tie: false };

/** 본음과의 높이 차 한도 (입력 상한. 실제 범위는 MIDI 0~127과 & 사슬 한도가 정한다) */
export const GRACE_OFFSET_LIMIT = 48;
/** 한 번에 넣는 꾸밈음 수 상한 (core GRACE_MAX와 같다) */
const COUNT_LIMIT = 32;

/** 저장해 둔 값을 읽는다. 모르는 값은 기본으로 */
export function parseGraceChoice(raw: unknown): GraceChoice {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const offsets =
    Array.isArray(v.offsets) && v.offsets.length >= 1 && v.offsets.length <= COUNT_LIMIT && v.offsets.every((o) => Number.isInteger(o) && Math.abs(o as number) <= GRACE_OFFSET_LIMIT)
      ? (v.offsets as number[])
      : DEFAULT_GRACE.offsets;
  return {
    offsets,
    length: GRACE_LENGTHS.includes(v.length as GraceLength) ? (v.length as GraceLength) : DEFAULT_GRACE.length,
    timing: v.timing === "before" ? "before" : DEFAULT_GRACE.timing,
    tie: typeof v.tie === "boolean" ? v.tie : DEFAULT_GRACE.tie,
  };
}

/**
 * 높이 입력 글 → 본음 기준 반음 수. 빈칸·쉼표로 나눈 정수들.
 * 타브(fret 있음)는 본음 줄의 프렛 번호(0~maxFret)를 받아 본음 프렛과의 차로 바꾸고, 피아노롤은 반음 수(+2, -1)를 그대로 받는다.
 * 잘못된 값이 하나라도 있으면 undefined
 */
export function parseGraceInput(text: string, tab?: { fret: number; maxFret: number }): number[] | undefined {
  const parts = text.trim().split(/[\s,]+/).filter((p) => p !== "");
  if (parts.length === 0 || parts.length > COUNT_LIMIT) return undefined;
  const out: number[] = [];
  for (const p of parts) {
    if (!(tab ? /^\d+$/ : /^[+-]?\d+$/).test(p)) return undefined;
    const x = Number(p);
    if (tab) {
      if (x > tab.maxFret) return undefined;
      out.push(x - tab.fret);
    } else {
      if (Math.abs(x) > GRACE_OFFSET_LIMIT) return undefined;
      out.push(x);
    }
  }
  return out;
}

/** 반음 수 → 입력 글 (parseGraceInput의 반대). 타브에서 프렛이 0 밑이나 maxFret 위로 가면 undefined */
export function formatGraceInput(offsets: readonly number[], tab?: { fret: number; maxFret: number }): string | undefined {
  if (tab) {
    const frets = offsets.map((o) => tab.fret + o);
    return frets.every((f) => f >= 0 && f <= tab.maxFret) ? frets.join(" ") : undefined;
  }
  return offsets.map((o) => (o > 0 ? `+${o}` : `${o}`)).join(" ");
}

/** 만든 기록에 남기는 꾸밈음 설정: 고른 것, 타브에서 열었으면 기준 본음 프렛, 꾸밈음을 놓은 타브 줄 (고른 음 id → 줄) */
export interface GraceMade {
  readonly choice: GraceChoice;
  readonly tab?: { readonly fret: number; readonly string: number; readonly maxFret: number };
  readonly strings: readonly (readonly [string, number])[];
}

/** 만든 기록의 설정을 읽는다 (모르는 값은 기본으로) */
export function parseGraceMade(raw: unknown): GraceMade {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const t = v.tab && typeof v.tab === "object" ? (v.tab as Record<string, unknown>) : undefined;
  const int = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;
  const tab = t && int(t.fret) && int(t.string) && int(t.maxFret) ? { fret: t.fret as number, string: t.string as number, maxFret: t.maxFret as number } : undefined;
  return { choice: parseGraceChoice(v.choice), ...(tab ? { tab } : {}), strings: parseStrings(v.strings) };
}

/** 고른 음 id → 타브 줄 목록 (만든 기록) */
export function parseStrings(raw: unknown): [string, number][] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is [string, number] => Array.isArray(x) && typeof x[0] === "string" && Number.isInteger(x[1]) && x[1] >= 1 && x[1] <= 12);
}
