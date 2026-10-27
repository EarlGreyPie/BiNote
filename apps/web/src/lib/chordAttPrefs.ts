import { rat, type AttenuationOptions } from "@mmlce/core";
import { loadStored, parseJson, saveStored } from "./persist";

/**
 * 화음 감쇠 창 설정 (이 브라우저에 기억). 굴림 폭은 1/n 음표 길이의 n (0이면 없음).
 * 단계 기본값은 MMLCS 화음 감쇠와 같다 (2음 −1, 3음 −2, 4음 이상 −3)
 */
export interface ChordAttPrefs {
  readonly sameStartOnly: boolean;
  readonly roll: 0 | 32 | 16 | 8;
  readonly split: AttenuationOptions["split"];
  readonly amount: "steps" | "law";
  readonly steps: readonly [number, number, number];
  readonly floor: number;
  readonly useBase: boolean;
  readonly base: number;
}

const KEY = "mmlce.chordAtt";

export const CHORD_ATT_DEFAULTS: ChordAttPrefs = {
  sameStartOnly: false,
  roll: 16,
  split: "pitch",
  amount: "steps",
  steps: [1, 2, 3],
  floor: 5,
  useBase: false,
  base: 10,
};

const int = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback;

/** 저장한 값을 읽는다. 모르는 값은 기본값으로. v는 프로필 볼륨 범위(창이 허용하는 범위)로 */
export function readChordAttPrefs(raw: unknown, volume: { readonly min: number; readonly max: number } = { min: 0, max: 15 }): ChordAttPrefs {
  const d = CHORD_ATT_DEFAULTS;
  if (typeof raw !== "object" || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const steps = Array.isArray(r.steps) && r.steps.length === 3 ? r.steps : d.steps;
  return {
    sameStartOnly: r.sameStartOnly === true,
    roll: r.roll === 0 || r.roll === 32 || r.roll === 16 || r.roll === 8 ? r.roll : d.roll,
    split: r.split === "pitch" || r.split === "role" || r.split === "none" ? r.split : d.split,
    amount: r.amount === "law" ? "law" : "steps",
    steps: [int(steps[0], 0, 8, d.steps[0]), int(steps[1], 0, 8, d.steps[1]), int(steps[2], 0, 8, d.steps[2])],
    floor: int(r.floor, volume.min, volume.max, d.floor),
    useBase: r.useBase === true,
    base: int(r.base, volume.min, volume.max, d.base),
  };
}

export function loadChordAttPrefs(volume?: { readonly min: number; readonly max: number }): ChordAttPrefs {
  return loadStored(KEY, (raw) => readChordAttPrefs(parseJson(raw), volume));
}

export function saveChordAttPrefs(p: ChordAttPrefs): void {
  saveStored(KEY, JSON.stringify(p));
}

/** 창 설정 → 계산 옵션 */
export function attenuationOptions(p: ChordAttPrefs): AttenuationOptions {
  return {
    split: p.split,
    amount: p.amount === "law" ? { kind: "law" } : { kind: "steps", two: p.steps[0], three: p.steps[1], fourPlus: p.steps[2] },
    roll: p.roll === 0 ? rat(0) : rat(1, p.roll),
    sameStartOnly: p.sameStartOnly,
    floor: p.floor,
    ...(p.useBase ? { base: p.base } : {}),
  };
}
