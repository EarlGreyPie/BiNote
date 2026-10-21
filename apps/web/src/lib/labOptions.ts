import { LAB_STEP_MAX, type HarmonicType } from "@mmlce/core";

/** 실험실 창에서 고른 것 (이 브라우저에 마지막 값을 기억한다) */
export interface LabChoice {
  /** 고스트 노트: 주변 보통 음보다 몇 단계 작게 */
  readonly ghostSteps: number;
  readonly harmonic: HarmonicType;
  /** 하모닉스: 몇 단계 작게 */
  readonly harmonicQuieter: number;
}

export const LAB_CHOICE_KEY = "mmlce.labChoice";

/** 기본: 고스트 4단계 작게(주변 v9면 v5), 자연 하모닉스, 2단계 작게 */
export const DEFAULT_LAB_CHOICE: LabChoice = { ghostSteps: 4, harmonic: "natural", harmonicQuieter: 2 };

/** 저장해 둔 값을 읽는다. 모르는 값은 기본으로 */
export function parseLabChoice(raw: unknown): LabChoice {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const step = (x: unknown, min: number, fallback: number) => (Number.isInteger(x) && (x as number) >= min && (x as number) <= LAB_STEP_MAX ? (x as number) : fallback);
  return {
    ghostSteps: step(v.ghostSteps, 1, DEFAULT_LAB_CHOICE.ghostSteps),
    harmonic: v.harmonic === "artificial" ? "artificial" : v.harmonic === "natural" ? "natural" : DEFAULT_LAB_CHOICE.harmonic,
    harmonicQuieter: step(v.harmonicQuieter, 0, DEFAULT_LAB_CHOICE.harmonicQuieter),
  };
}

/** 울림 (꼬리 쪼개기·빈칸 채우기)에서 고른 것. 길이는 n분음표의 n (8 = 8분음표) */
export interface ReverbChoice {
  /** 꼬리 조각 v 순서 (가장 큰 v로 친 음 기준) */
  readonly levels: readonly number[];
  /** 조각 하나 길이 */
  readonly piece: number;
  /** 앞부분을 이만큼은 그대로 (끝에서부터 놓을 때) */
  readonly keep: number;
  /** 일괄: 이 길이 이상인 음에만 꼬리 */
  readonly minLength: number;
  /** 일괄: 뒤에 쉼표가 있는 음에만 */
  readonly beforeRest: boolean;
  /** 일괄: 스타카토 빈칸 채우기 */
  readonly fill: boolean;
  readonly fillLevel: number;
  /** 일괄: 이 길이 이하인 음 뒤의 빈칸만 */
  readonly fillMaxNote: number;
}

export const REVERB_CHOICE_KEY = "mmlce.labReverb";

/** 고를 수 있는 길이 (n분음표) */
export const REVERB_LENGTHS: readonly number[] = [1, 2, 4, 8, 16, 32];

/** 기본: 마비꼬 악보 제작 가이드의 예 (v15 뒤 6·3·2·1, 스타카토 빈칸 v4). 8분 조각, 앞 4분은 그대로, 2분음표 이상에만 */
export const DEFAULT_REVERB_CHOICE: ReverbChoice = { levels: [6, 3, 2, 1], piece: 8, keep: 4, minLength: 2, beforeRest: false, fill: false, fillLevel: 4, fillMaxNote: 8 };

/** "6 3 2 1"·"6-3-2-1"·"6,3,2,1" 같은 글을 v 순서로. 1~15만, 최대 개수까지. 읽을 수 없으면 undefined */
export function parseLevels(text: string, max: number, limit: number): number[] | undefined {
  const parts = text.split(/[\s,\-·/]+/).filter((p) => p !== "");
  if (parts.length === 0 || parts.length > limit) return undefined;
  const out = parts.map(Number);
  return out.every((v) => Number.isInteger(v) && v >= 1 && v <= max) ? out : undefined;
}

/** 저장해 둔 울림 값을 읽는다. 모르는 값은 기본으로 */
export function parseReverbChoice(raw: unknown, max = 15, limit = 8): ReverbChoice {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_REVERB_CHOICE;
  const len = (x: unknown, fallback: number) => (typeof x === "number" && REVERB_LENGTHS.includes(x) ? x : fallback);
  const levels = Array.isArray(v.levels) && v.levels.length > 0 && v.levels.length <= limit && v.levels.every((x) => Number.isInteger(x) && x >= 1 && x <= max) ? (v.levels as number[]) : d.levels;
  return {
    levels,
    piece: len(v.piece, d.piece),
    keep: len(v.keep, d.keep),
    minLength: len(v.minLength, d.minLength),
    beforeRest: typeof v.beforeRest === "boolean" ? v.beforeRest : d.beforeRest,
    fill: typeof v.fill === "boolean" ? v.fill : d.fill,
    fillLevel: Number.isInteger(v.fillLevel) && (v.fillLevel as number) >= 1 && (v.fillLevel as number) <= max ? (v.fillLevel as number) : d.fillLevel,
    fillMaxNote: len(v.fillMaxNote, d.fillMaxNote),
  };
}
