import { MOBILE_PROFILE, STANDARD_TUNING, type PlayerTab } from "@mmlce/core";
import type { MessageKey } from "@mmlce/i18n";

/** 타브 보기 튜닝. 줄은 1번(가장 높은 줄)부터 개방현 MIDI 번호 */
export const TUNINGS = {
  standard: { key: "ui.tuningStandard", strings: STANDARD_TUNING.strings },
  dropD: { key: "ui.tuningDropD", strings: [64, 59, 55, 50, 45, 38] },
  dadgad: { key: "ui.tuningDadgad", strings: [62, 57, 55, 50, 45, 38] },
  // 내슈빌(하이 스트렁): 표준 기타의 3~6번 줄에 12현의 가는 옥타브 줄을 걸어 한 옥타브 위 (E A d g B E)
  nashville: { key: "ui.tuningNashville", strings: [64, 59, 67, 62, 57, 52] },
  // 바리톤: 표준보다 완전4도(B)·완전5도(A) 아래
  baritoneB: { key: "ui.tuningBaritoneB", strings: [59, 54, 50, 45, 40, 35] },
  baritoneA: { key: "ui.tuningBaritoneA", strings: [57, 52, 48, 43, 38, 33] },
  // 부분 내슈빌 바리톤 (A D G C E A, 3·4번 줄만 한 옥타브 위): 팻 메서니 바리톤 편곡 등
  nashvilleBaritone: { key: "ui.tuningNashvilleBaritone", strings: [57, 52, 60, 55, 38, 33] },
  // 베이스: 4줄 E A D G, 5줄은 아래에 B를 더한다 (기타보다 한 옥타브 낮다)
  bass4: { key: "ui.tuningBass4", strings: [43, 38, 33, 28] },
  bass5: { key: "ui.tuningBass5", strings: [43, 38, 33, 28, 23] },
  // 만돌린: G D A E (바이올린과 같은 5도 간격)
  mandolin: { key: "ui.tuningMandolin", strings: [76, 69, 62, 55] },
} as const satisfies Record<string, { key: MessageKey; strings: readonly number[] }>;

export type TuningName = keyof typeof TUNINGS;

/** 앱이 아는 튜닝 이름인지 (파일·곡에 적힌 이름 검사) */
export const isTuningName = (v: unknown): v is TuningName => typeof v === "string" && Object.hasOwn(TUNINGS, v);

/** 직접 입력한 튜닝의 이름 (줄 높이는 strings에 따로 적는다) */
export const CUSTOM_TUNING = "custom";

/** 고를 수 있는 튜닝: 앱이 아는 이름 또는 직접 입력 */
export type TuningChoice = TuningName | typeof CUSTOM_TUNING;

/** 직접 입력할 수 있는 줄 수 (프로젝트 파일이 받는 tabString 1~12와 같다) */
export const MAX_STRINGS = 12;

/** 악보 하나의 타브 튜닝과 카포. 직접 입력한 튜닝이면 strings에 줄 높이(1번 줄부터 개방현 MIDI 번호) */
export interface ScoreTuning {
  readonly tuning: TuningChoice;
  readonly capo: number;
  readonly strings?: readonly number[];
}

/** 줄 높이 목록이 직접 입력 튜닝으로 쓸 만한지 (1~12줄, MIDI 0~127 정수) */
export const validStrings = (v: unknown): v is readonly number[] =>
  Array.isArray(v) && v.length >= 1 && v.length <= MAX_STRINGS && v.every((p) => Number.isInteger(p) && p >= 0 && p <= 127);

/** 곡의 악보 튜닝(Player.tab)을 앱 튜닝으로. 모르는 이름이나 줄 높이가 없는 직접 입력이면 undefined */
export function scoreTuningOf(tab: PlayerTab | undefined): ScoreTuning | undefined {
  if (!tab) return undefined;
  if (isTuningName(tab.tuning)) return { tuning: tab.tuning, capo: tab.capo };
  if (tab.tuning === CUSTOM_TUNING && validStrings(tab.strings)) return { tuning: CUSTOM_TUNING, capo: tab.capo, strings: [...tab.strings] };
  return undefined;
}

/** 튜닝의 줄 높이 (1번 줄부터 개방현 MIDI 번호) */
export function tuningStrings(t: ScoreTuning): readonly number[] {
  if (t.tuning === CUSTOM_TUNING) return t.strings && validStrings(t.strings) ? t.strings : STANDARD_TUNING.strings;
  return TUNINGS[t.tuning].strings;
}

/** 직접 입력 줄·타브 숫자가 낼 수 있는 높이: MML로 쓸 수 있는 o0c(12)~o9g(127) (프로필의 옥타브 범위, MIDI 127까지) */
export const LOWEST_PITCH = (MOBILE_PROFILE.octave.min + 1) * 12;
export const HIGHEST_PITCH = Math.min(127, (MOBILE_PROFILE.octave.max + 1) * 12 + 11);

/** 모든 줄을 반음 semis개만큼 옮긴다. 한 줄이라도 쓸 수 있는 높이(LOWEST_PITCH~HIGHEST_PITCH)를 넘으면 undefined */
export function shiftStrings(strings: readonly number[], semis: number): readonly number[] | undefined {
  const out = strings.map((p) => p + semis);
  return out.every((p) => p >= LOWEST_PITCH && p <= HIGHEST_PITCH) ? out : undefined;
}

/** 개방현 음 이름 (검은건반은 악보집 튜닝 표기처럼 ♭으로) */
const STRING_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"] as const;

/** 줄 하나의 음 이름과 옥타브 (o4c = 60 = C4) */
export const stringName = (p: number) => `${STRING_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;

/** 직접 입력 튜닝 줄임 표기: 프리셋 이름처럼 가장 낮은 줄부터 ("A♭1 D♭2 G♭3 B3 E♭3 A♭3") */
export const stringsLabel = (strings: readonly number[]) => [...strings].reverse().map(stringName).join(" ");
