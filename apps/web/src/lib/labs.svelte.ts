import { loadStored, saveStored } from "./persist";

/**
 * 실험실: 정식판 전에 먼저 써 보는 기능을 모아 두는 곳 (설정 → 실험실). 기본은 끔.
 * 끄면 실험실 메뉴가 숨고 곡은 그대로다: 실험실 입력이 곡에 남기는 것은 음 표시(Note.lab)뿐이고, 그것도 프로젝트 파일(.mme)에만 저장된다.
 * 새 실험실 기능은 LAB_FEATURES에 하나 더하고, 메뉴 항목과 창을 App에 붙인다
 */
const LABS_KEY = "mmlce.labs";
const BUTTON_NAMES_KEY = "mmlce.labs.buttonNames";
const FADE_KEY = "mmlce.labs.fade";

/** 소리 줄어듦 알림: 가장 클 때보다 이만큼(dB) 작아진 뒤로도 이어지는 음을 검사에서 알린다 */
export const FADE_DB = 30;

export type LabFeatureId = "ghost" | "harmonic" | "reverb" | "midiRecord" | "tempoRamp" | "videoBars" | "arpFold" | "loudness" | "staff" | "musicXml" | "transcribe" | "noteDrop";

/** 고른 음을 바꾸는 창(LabNoteDialog)으로 여는 기능. 나머지는 저마다 메뉴·창이 있다 (새 기능이 이 창으로 잘못 열리지 않게 이름으로 적는다) */
export type NoteLabId = "ghost" | "harmonic";
export const isNoteLab = (id: LabFeatureId): id is NoteLabId => id === "ghost" || id === "harmonic";

export interface LabFeature {
  readonly id: LabFeatureId;
  /** 메뉴·설정에 쓰는 이름과 설명 문구 키 */
  readonly label: "ui.labGhost" | "ui.labHarmonic" | "ui.labReverb" | "ui.labMidiRecord" | "ui.tempoRamp" | "ui.labVideoBars" | "ui.labArpFold" | "ui.labLoudness" | "ui.labStaff" | "ui.labMusicXml" | "ui.labTranscribe" | "ui.labNoteDrop";
  readonly help: "ui.labGhostHelp" | "ui.labHarmonicHelp" | "ui.labReverbHelp" | "ui.labMidiRecordHelp" | "ui.tempoRampHelp" | "ui.labVideoBarsHelp" | "ui.labArpFoldHelp" | "ui.labLoudnessHelp" | "ui.labStaffHelp" | "ui.labMusicXmlHelp" | "ui.labTranscribeHelp" | "ui.labNoteDropHelp";
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
  // 보기만: 곡을 바꾸지 않는다 (원곡을 불러온 곡에서 실험실 메뉴)
  { id: "loudness", label: "ui.labLoudness", help: "ui.labLoudnessHelp" },
  // 보기만: 편집기 위 오선보 칸 (보기 메뉴에서 켜고 끈다)
  { id: "staff", label: "ui.labStaff", help: "ui.labStaffHelp" },
  // 실험실 메뉴에 가져오기·내보내기 두 항목 (가져오기는 MIDI 가져오기 창을 같이 쓴다)
  { id: "musicXml", label: "ui.labMusicXml", help: "ui.labMusicXmlHelp" },
  // 곡 없이도 쓴다: 받아 적은 음은 MIDI 불러오기 창으로 새 곡이 된다 (PC는 Basic Scriptor, 모든 기기는 브라우저 안 basic-pitch)
  { id: "transcribe", label: "ui.labTranscribe", help: "ui.labTranscribeHelp" },
  // 메뉴 항목 없이 곡 검사에 연주 누락음 위험(fast-run-drop)이 더해지고, 그 줄의 고치기 창으로 고친다 (기준은 GameProfile.fastRunDrop, 실측 전)
  { id: "noteDrop", label: "ui.labNoteDrop", help: "ui.labNoteDropHelp" },
];

export const labs = $state({
  on: loadStored(LABS_KEY, (raw) => raw === "1"),
  /** 단추 이름 펼치기 (실험실을 켰을 때만 쓴다). 곡에는 아무것도 남기지 않는 화면 설정 */
  buttonNames: loadStored(BUTTON_NAMES_KEY, (raw) => raw === "1"),
  /** 소리 줄어듦 알림 (실험실을 켰을 때만 쓴다). 곡은 바꾸지 않고 검사 안내만 더한다 */
  fade: loadStored(FADE_KEY, (raw) => raw === "1"),
});

/** 단추 이름 펼치기를 지금 쓰는지 */
export function buttonNamesOn(): boolean {
  return labs.on && labs.buttonNames;
}

export function setButtonNames(on: boolean): void {
  labs.buttonNames = on;
  saveStored(BUTTON_NAMES_KEY, on ? "1" : "0");
}

/** 소리 줄어듦 알림을 지금 쓰는지 */
export function fadeOn(): boolean {
  return labs.on && labs.fade;
}

/** 연주 누락음 검사을 지금 쓰는지 (실험실을 켜면 함께 켜진다. 곡은 고치기를 고를 때만 바뀐다) */
export function noteDropOn(): boolean {
  return labs.on;
}

export function setFade(on: boolean): void {
  labs.fade = on;
  saveStored(FADE_KEY, on ? "1" : "0");
}

export function setLabs(on: boolean): void {
  labs.on = on;
  saveStored(LABS_KEY, on ? "1" : "0");
}
