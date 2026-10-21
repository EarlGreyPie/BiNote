import { loadStored, saveStored } from "./persist";

/**
 * 실험실: 정식판 전에 먼저 써 보는 기능을 모아 두는 곳 (설정 → 실험실). 기본은 끔.
 * 끄면 실험실 메뉴가 숨고 곡은 그대로다: 실험실 입력이 곡에 남기는 것은 음 표시(Note.lab)뿐이고, 그것도 프로젝트 파일(.mme)에만 저장된다.
 * 새 실험실 기능은 LAB_FEATURES에 하나 더하고, 메뉴 항목과 창을 App에 붙인다
 */
const LABS_KEY = "mmlce.labs";

export type LabFeatureId = "ghost" | "harmonic" | "reverb";

export interface LabFeature {
  readonly id: LabFeatureId;
  /** 메뉴·설정에 쓰는 이름과 설명 문구 키 */
  readonly label: "ui.labGhost" | "ui.labHarmonic" | "ui.labReverb";
  readonly help: "ui.labGhostHelp" | "ui.labHarmonicHelp" | "ui.labReverbHelp";
}

/** 실험실 기능 목록 (메뉴와 설정 설명이 이 순서를 따른다) */
export const LAB_FEATURES: readonly LabFeature[] = [
  { id: "ghost", label: "ui.labGhost", help: "ui.labGhostHelp" },
  { id: "harmonic", label: "ui.labHarmonic", help: "ui.labHarmonicHelp" },
  { id: "reverb", label: "ui.labReverb", help: "ui.labReverbHelp" },
];

export const labs = $state({
  on: loadStored(LABS_KEY, (raw) => raw === "1"),
});

export function setLabs(on: boolean): void {
  labs.on = on;
  saveStored(LABS_KEY, on ? "1" : "0");
}
