import { isGameLength, mul, rat, type LengthLimit, type Rat } from "@mmlce/core";
import type { LengthName } from "./roll";

/**
 * 사용자가 정하는 잇단음: count개를 바탕 음표(1/base, dotted면 점음표 3/(2·base)) 시간에 친다.
 * 음 하나의 MML 길이 숫자는 base×count이고, 점 바탕이면 점이 붙는다
 * (4분 5잇단 = l20, 4분 7잇단 = l28, 2분 5잇단 = l10, 점4분 2잇단 = l8., 점4분 5잇단 = l20.)
 */
export interface Tuplet {
  readonly count: number;
  readonly base: number;
  readonly dotted: boolean;
}

/** 고를 수 있는 음 개수와 바탕 음표 */
export const TUPLET_COUNTS = Array.from({ length: 14 }, (_, k) => k + 2);
export const TUPLET_BASES = [1, 2, 4, 8, 16, 32] as const;

/** 새 음 길이 고르기 칸의 "잇단음…" 항목 값 (길이가 아니라 창을 연다) */
export const TUPLET_PICK = "tuplet";

export const DEFAULT_TUPLET: Tuplet = { count: 5, base: 4, dotted: false };

/** 음 하나의 MML 길이 숫자 (base×count, 점은 따로) */
export function tupletNumber(tuplet: Tuplet): number {
  return tuplet.base * tuplet.count;
}

/** 음 하나의 길이 표기 ("20", 점 바탕이면 "20.") */
export function tupletName(tuplet: Tuplet): `${number}` | `${number}.` {
  return tuplet.dotted ? `${tupletNumber(tuplet)}.` : `${tupletNumber(tuplet)}`;
}

/** 음 하나의 길이 (온음표 단위) */
export function tupletValue(tuplet: Tuplet): Rat {
  const one = rat(1, tupletNumber(tuplet));
  return tuplet.dotted ? mul(one, rat(3, 2)) : one;
}

/**
 * 게임이 받는 한 토막으로 쓸 수 있는지. 못 쓰면 그 조합은 고를 수 없다
 * (점·붙임줄은 음을 늘리기만 해서 가장 짧은 토막보다 짧은 음은 어떻게도 쓸 수 없다. 반올림하지 않는다)
 */
export function tupletFits(tuplet: Tuplet, limit: LengthLimit): boolean {
  return isGameLength(limit, tupletNumber(tuplet), tuplet.dotted ? 1 : 0);
}

/**
 * 잇단음 음들이 칸에 맞는 격자 (1/이 수): 음 하나 길이를 기약분수로 쓴 분모.
 * 4분 5잇단(1/20) → 20, 점4분 2잇단(3/16) → 16, 점4분 5잇단(3/40) → 40
 */
export function tupletGrid(tuplet: Tuplet): number {
  return tupletValue(tuplet).d;
}

/**
 * 격자로 쓸 수 있는 수인지: 칸 하나(1/d)가 게임이 받는 한 토막이어야 한다.
 * 격자대로 넣은 새 음·가위로 자른 조각·칸 사이 쉼표가 칸 하나 길이가 되므로, 더 잘면 쓸 수 없는 음이 생긴다
 */
export function isGridDivision(d: unknown, limit: LengthLimit): d is number {
  return typeof d === "number" && isGameLength(limit, d, 0);
}

/** 저장해 둔 값을 읽는다. 모르는 값이면 기본 (4분 5잇단) */
export function parseTuplet(raw: unknown): Tuplet {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const count = TUPLET_COUNTS.includes(v.count as number) ? (v.count as number) : undefined;
  const base = (TUPLET_BASES as readonly unknown[]).includes(v.base) ? (v.base as number) : undefined;
  return count !== undefined && base !== undefined ? { count, base, dotted: v.dotted === true } : DEFAULT_TUPLET;
}

/** 길이 숫자 하나(점 하나까지)로 된 표기인지: "20" → 20·점 0, "20." → 20·점 1. 격자·모르는 글이면 undefined */
export function lengthNumber(length: string): { length: number; dots: number } | undefined {
  const m = /^([1-9]\d*)(\.?)$/.exec(length);
  return m ? { length: Number(m[1]), dots: m[2] ? 1 : 0 } : undefined;
}

/** 게임이 받는 한 토막 표기인지 ("20", "20.") */
export function isGameLengthName(length: unknown, limit: LengthLimit): length is `${number}` | `${number}.` {
  const p = typeof length === "string" ? lengthNumber(length) : undefined;
  return p !== undefined && isGameLength(limit, p.length, p.dots);
}

/**
 * 길이 목록 list에 더 넣을 길이(extra: 잇단음 등)를 붙인다. 게임이 받는 한 토막만, 이미 있으면 그대로.
 * 길이 순 목록(긴 것부터, 격자 맨 앞)이면 sorted로 제자리에 끼운다. 아니면 끝에 붙인다
 */
export function withLengths<L extends LengthName>(list: readonly L[], extra: readonly string[], limit: LengthLimit, sorted = false): (L | `${number}` | `${number}.`)[] {
  const out: (L | `${number}` | `${number}.`)[] = [...list];
  for (const name of extra) {
    if (!isGameLengthName(name, limit) || out.includes(name)) continue;
    const at = sorted ? out.findIndex((l) => l !== "grid" && lengthValue(l) < lengthValue(name)) : -1;
    if (at < 0) out.push(name);
    else out.splice(at, 0, name);
  }
  return out;
}

/** 길이 표기의 길이 (온음표 = 1, 비교에만 쓴다) */
function lengthValue(l: string): number {
  const dotted = l.endsWith(".");
  const n = Number(dotted ? l.slice(0, -1) : l);
  return dotted ? 3 / (2 * n) : 1 / n;
}

/** 격자 목록에 잇단음 칸과 지금 격자를 끼워 작은 수부터 (격자로 쓸 수 없는 수는 뺀다) */
export function gridDivisions(base: readonly number[], extra: readonly number[], limit: LengthLimit): number[] {
  const out = new Set(base);
  for (const d of extra) if (isGridDivision(d, limit)) out.add(d);
  return [...out].sort((a, b) => a - b);
}

/**
 * 격자 ×2(칸을 두 배로, 1/16 → 1/8)·½(칸을 반으로, 1/16 → 1/32). 셋잇단·잇단음 칸은 같은 갈래 안에서 움직인다 (1/12 ↔ 1/24 ↔ 1/48).
 * 칸이 정수 분모가 아니게 되거나(1/1의 ×2, 1/3의 ×2) 게임이 받는 가장 짧은 토막보다 잘아지면 undefined (그대로 둔다)
 */
export function stepGrid(division: number, way: "double" | "half", limit: LengthLimit): number | undefined {
  const next = way === "double" ? division / 2 : division * 2;
  return Number.isInteger(next) && isGridDivision(next, limit) ? next : undefined;
}
