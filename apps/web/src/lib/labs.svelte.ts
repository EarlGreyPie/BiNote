import { BASIC_SCRIPTOR_ON } from "./basicScriptor";
import { loadStored, saveStored } from "./persist";

/**
 * 실험실: 정식판 전에 먼저 써 보는 기능을 모아 두는 곳 (설정 → 실험실). 기본은 끔.
 * 끄면 실험실 메뉴가 숨고 곡은 그대로다: 실험실 입력이 곡에 남기는 것은 음 표시(Note.lab)뿐이고, 그것도 프로젝트 파일(.mme)에만 저장된다.
 * 새 실험실 기능은 LAB_FEATURES에 하나 더하고, 메뉴 항목과 창을 App에 붙인다
 */
const LABS_KEY = "mmlce.labs";
const BUTTON_NAMES_KEY = "mmlce.labs.buttonNames";
const FADE_KEY = "mmlce.labs.fade";
const LIVE_EDIT_KEY = "mmlce.labs.liveEdit";
const IMPORT_GAME_KEY = "mmlce.labs.importGame";

/** 소리 줄어듦 알림: 가장 클 때보다 이만큼(dB) 작아진 뒤로도 이어지는 음을 검사에서 알린다 */
export const FADE_DB = 30;

/**
 * PC 마비노기 게임 바꾸기를 보일지. 1.1.0-beta.1에서는 끈다: 코드와 고친 점은 그대로 두고,
 * 실험실 목록·게임 하위 메뉴·불러올 게임 고르기·잇단음 되살리기를 숨긴다. beta.2 전에 다시 설계한 뒤 켠다
 */
export const PC_GAME_ON = false;

export type LabFeatureId = "ghost" | "harmonic" | "reverb" | "midiRecord" | "tempoRamp" | "videoBars" | "arpFold" | "loudness" | "staff" | "musicXml" | "transcribe" | "noteDrop" | "tempoSnap" | "tempoLength" | "tempoFold" | "memo" | "loudnessGuide" | "gameProfile";

/** 고른 음을 바꾸는 창(LabNoteDialog)으로 여는 기능. 나머지는 저마다 메뉴·창이 있다 (새 기능이 이 창으로 잘못 열리지 않게 이름으로 적는다) */
export type NoteLabId = "ghost" | "harmonic";
export const isNoteLab = (id: LabFeatureId): id is NoteLabId => id === "ghost" || id === "harmonic";

export interface LabFeature {
  readonly id: LabFeatureId;
  /** 메뉴·설정에 쓰는 이름과 설명 문구 키 */
  readonly label: "ui.labGhost" | "ui.labHarmonic" | "ui.labReverb" | "ui.labMidiRecord" | "ui.tempoRamp" | "ui.labVideoBars" | "ui.labArpFold" | "ui.labLoudness" | "ui.labStaff" | "ui.labMusicXml" | "ui.labTranscribe" | "ui.labNoteDrop" | "ui.labTempoSnap" | "ui.labTempoLength" | "ui.labTempoFold" | "ui.labMemo" | "ui.labLoudnessGuide" | "ui.labGameProfile";
  readonly help: "ui.labTranscribeHelpScriptor" | "ui.labGhostHelp" | "ui.labHarmonicHelp" | "ui.labReverbHelp" | "ui.labMidiRecordHelp" | "ui.tempoRampHelp" | "ui.labVideoBarsHelp" | "ui.labArpFoldHelp" | "ui.labLoudnessHelp" | "ui.labStaffHelp" | "ui.labMusicXmlHelp" | "ui.labTranscribeHelp" | "ui.labNoteDropHelp" | "ui.labTempoSnapHelp" | "ui.labTempoLengthHelp" | "ui.labTempoFoldHelp" | "ui.labMemoHelp" | "ui.labLoudnessGuideHelp" | "ui.labGameProfileHelp";
}

/** 실험실 기능 목록 (메뉴와 설정 설명이 이 순서를 따른다) */
export const LAB_FEATURES: readonly LabFeature[] = ([
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
  // 곡 없이도 쓴다: 받아 적은 음은 MIDI 불러오기 창으로 새 곡이 된다 (모든 기기는 브라우저 안 basic-pitch, BASIC_SCRIPTOR_ON이면 PC는 Basic Scriptor도)
  { id: "transcribe", label: "ui.labTranscribe", help: BASIC_SCRIPTOR_ON ? "ui.labTranscribeHelpScriptor" : "ui.labTranscribeHelp" },
  // 메뉴 항목 없이 곡 검사에 연주 누락음 위험(fast-run-drop)이 더해지고, 그 줄의 고치기 창으로 고친다 (기준은 GameProfile.fastRunDrop, 실측 전)
  { id: "noteDrop", label: "ui.labNoteDrop", help: "ui.labNoteDropHelp" },
  // 곡 → 템포 ▸ 에 음 시작을 원곡에 맞추기(원곡이 있을 때)와 템포 정리 두 항목. 곡 템포만 바꾼다 (실행 취소 한 칸)
  { id: "tempoSnap", label: "ui.labTempoSnap", help: "ui.labTempoSnapHelp" },
  // 곡 → 템포 ▸ 에 템포를 음 길이로 바꾸기. 고른 구간의 템포를 펴고 음 자리·길이를 다시 쓴다 (실행 취소 한 칸)
  { id: "tempoLength", label: "ui.labTempoLength", help: "ui.labTempoLengthHelp" },
  // 메뉴 항목 없이 탭 템포·마디선 끌기·템포 창·음 시작 맞추기가 범위 밖 템포를 음 길이로 풀고, 곡 검사에 끝값에 닿은 템포를 정보로 더한다
  { id: "tempoFold", label: "ui.labTempoFold", help: "ui.labTempoFoldHelp" },
  // 작업 메모: 마커 칸에 할 일 쪽지 (프로젝트 파일에만 저장, 내보내기에는 나가지 않는다). 실험실 메뉴의 목록 패널과 Alt+N으로 넣는다.
  // 실험실을 꺼도 곡에 있는 메모는 그대로 남고 이벤트 줄에 그려진다 (넣기·목록만 숨는다)
  { id: "memo", label: "ui.labMemo", help: "ui.labMemoHelp" },
  // 보기만: 메뉴 항목 없이 음량 레인(펼침)에 "원곡 세기" 단추가 생긴다 (원곡을 불러온 곡에서). 단추는 기본 끔
  { id: "loudnessGuide", label: "ui.labLoudnessGuide", help: "ui.labLoudnessGuideHelp" },
  // 실험실 메뉴의 게임 하위 메뉴: 곡의 게임 프로필을 바꾼다 (틱 칸을 쓰는 게임이면 음을 칸에 맞춘다, 실행 취소 한 칸)
  { id: "gameProfile", label: "ui.labGameProfile", help: "ui.labGameProfileHelp" },
] satisfies LabFeature[]).filter((f) => PC_GAME_ON || f.id !== "gameProfile");

export const labs = $state({
  on: loadStored(LABS_KEY, (raw) => raw === "1"),
  /** 단추 이름 펼치기 (실험실을 켰을 때만 쓴다). 곡에는 아무것도 남기지 않는 화면 설정 */
  buttonNames: loadStored(BUTTON_NAMES_KEY, (raw) => raw === "1"),
  /** 소리 줄어듦 알림 (실험실을 켰을 때만 쓴다). 곡은 바꾸지 않고 검사 안내만 더한다 */
  fade: loadStored(FADE_KEY, (raw) => raw === "1"),
  /** 재생 중 고친 것 바로 듣기 (실험실을 켰을 때만 쓴다). 실험실을 켜면 처음부터 켜져 있고, 끈 것만 기억한다. 곡은 바꾸지 않고 재생만 따라간다 */
  liveEdit: loadStored(LIVE_EDIT_KEY, (raw) => raw !== "0"),
  /** 3MLE·마비꼬·MML@ 글을 열 때 어느 게임의 글로 읽을지 (게임 프로필 id, 실험실을 켰을 때만 쓴다). 없으면 기본 게임 */
  importGame: loadStored<string | undefined>(IMPORT_GAME_KEY, (raw) => raw ?? undefined),
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

/** 범위 밖 템포를 길이로 풀기를 지금 쓰는지 (실험실을 켜면 함께 켜진다. 곡은 넣는 순간에만 바뀌고 실행 취소 한 칸이다) */
export function tempoFoldOn(): boolean {
  return labs.on;
}

export function setFade(on: boolean): void {
  labs.fade = on;
  saveStored(FADE_KEY, on ? "1" : "0");
}

/** 재생 중 고친 것 바로 듣기를 지금 쓰는지 */
export function liveEditOn(): boolean {
  return labs.on && labs.liveEdit;
}

export function setLiveEdit(on: boolean): void {
  labs.liveEdit = on;
  saveStored(LIVE_EDIT_KEY, on ? "1" : "0");
}

/** 파일·MML@ 글을 읽을 게임 (실험실을 껐으면 기본 게임, undefined) */
export function importGameId(): string | undefined {
  return labs.on && PC_GAME_ON ? labs.importGame : undefined;
}

export function setImportGame(profileId: string): void {
  labs.importGame = profileId;
  saveStored(IMPORT_GAME_KEY, profileId);
}

export function setLabs(on: boolean): void {
  labs.on = on;
  saveStored(LABS_KEY, on ? "1" : "0");
}
