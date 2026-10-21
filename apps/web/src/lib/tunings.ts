import { STANDARD_TUNING } from "@mmlce/core";
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

/** 악보 하나의 타브 튜닝과 카포 */
export interface ScoreTuning {
  readonly tuning: TuningName;
  readonly capo: number;
}
