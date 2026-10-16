import { STANDARD_TUNING } from "@mmlce/core";
import type { MessageKey } from "@mmlce/i18n";

/** 타브 보기 튜닝. 줄은 1번(가장 높은 줄)부터 개방현 MIDI 번호 */
export const TUNINGS = {
  standard: { key: "ui.tuningStandard", strings: STANDARD_TUNING.strings },
  dropD: { key: "ui.tuningDropD", strings: [64, 59, 55, 50, 45, 38] },
  dadgad: { key: "ui.tuningDadgad", strings: [62, 57, 55, 50, 45, 38] },
  // 바리톤: 표준보다 완전4도(B)·완전5도(A) 아래
  baritoneB: { key: "ui.tuningBaritoneB", strings: [59, 54, 50, 45, 40, 35] },
  baritoneA: { key: "ui.tuningBaritoneA", strings: [57, 52, 48, 43, 38, 33] },
  // 부분 내슈빌 바리톤 (A D G C E A, 3·4번 줄만 한 옥타브 위): 팻 메서니 바리톤 편곡 등
  nashvilleBaritone: { key: "ui.tuningNashvilleBaritone", strings: [57, 52, 60, 55, 38, 33] },
} as const satisfies Record<string, { key: MessageKey; strings: readonly number[] }>;

export type TuningName = keyof typeof TUNINGS;
