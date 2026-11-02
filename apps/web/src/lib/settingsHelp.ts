/**
 * 설정 창 설명 펼침 상태. 줄마다 ⓘ로 하나씩 펼치고, 칸 위 "설명 모두 펼치기"로 한꺼번에 펼친다.
 * all이 바뀌면 줄들이 그 값으로 맞춘다 (그 뒤 줄마다 다시 따로 접고 펼칠 수 있다)
 */
export interface SettingsHelp {
  all: boolean;
}

export const SETTINGS_HELP = Symbol("settingsHelp");
