import { loadStored, saveStored } from "./persist";

/**
 * 실험실: 정식판 전에 먼저 써 보는 기능을 모아 두는 곳 (설정 → 실험실). 기본은 끔.
 * 끄면 실험실 메뉴가 숨고 곡은 그대로다: 실험실 입력이 곡에 남기는 것은 음 표시(Note.lab)뿐이고, 그것도 프로젝트 파일(.mme)에만 저장된다.
 * 새 실험실 기능은 LAB_FEATURES에 하나 더하고, 메뉴 항목과 창을 App에 붙인다
 */
const LABS_KEY = "mmlce.labs";
const BUTTON_NAMES_KEY = "mmlce.labs.buttonNames";

export type LabFeatureId = "ghost" | "harmonic" | "reverb" | "midiRecord" | "tempoRamp" | "videoBars" | "arpFold";

export interface LabFeature {
  readonly id: LabFeatureId;
  /** 메뉴·설정에 쓰는 이름과 설명 문구 키 */
  readonly label: "ui.labGhost" | "ui.labHarmonic" | "ui.labReverb" | "ui.labMidiRecord" | "ui.tempoRamp" | "ui.labVideoBars" | "ui.labArpFold";
  readonly help: "ui.labGhostHelp" | "ui.labHarmonicHelp" | "ui.labReverbHelp" | "ui.labMidiRecordHelp" | "ui.tempoRampHelp" | "ui.labVideoBarsHelp" | "ui.labArpFoldHelp";
}

/** 실험실 기능 목록 (메뉴와 설정 설명이 이 순서를 따른다) */
export const LAB_FEATURES: readonly LabFeature[] = [
  { id: "ghost", label: "ui.labGhost", help: "ui.labGhostHelp" },
  { id: "harmonic", label: "ui.labHarmonic", help: "ui.labHarmonicHelp" },
  { id: "reverb", label: "ui.labReverb", help: "ui.labReverbHelp" },
  { id: "midiRecord", label: "ui.labMidiRecord", help: "ui.labMidiRecordHelp" },
  { id: "tempoRamp", label: "ui.tempoRamp", help: "ui.tempoRampHelp" },
  { id: "videoBars", label: "ui.labVideoBars", help: "ui.labVideoBarsHelp" },
  // 메뉴 항목 없이 아르페지오 창(굴려 치기) 안에 칸이 생긴다
  { id: "arpFold", label: "ui.labArpFold", help: "ui.labArpFoldHelp" },
];

export const labs = $state({
  on: loadStored(LABS_KEY, (raw) => raw === "1"),
  /** 단추 이름 펼치기 (실험실을 켰을 때만 쓴다). 곡에는 아무것도 남기지 않는 화면 설정 */
  buttonNames: loadStored(BUTTON_NAMES_KEY, (raw) => raw === "1"),
});

/** 단추 이름 펼치기를 지금 쓰는지 */
export function buttonNamesOn(): boolean {
  return labs.on && labs.buttonNames;
}

export function setButtonNames(on: boolean): void {
  labs.buttonNames = on;
  saveStored(BUTTON_NAMES_KEY, on ? "1" : "0");
}

export function setLabs(on: boolean): void {
  labs.on = on;
  saveStored(LABS_KEY, on ? "1" : "0");
}
