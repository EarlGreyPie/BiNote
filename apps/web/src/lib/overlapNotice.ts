import type { PlaceLoss } from "@mmlce/core";
import type { MessageKey, Params } from "@mmlce/i18n";

/**
 * 음을 놓은 뒤 상태줄에 띄울 글. 한 트랙은 한 번에 한 음만 내므로, 놓은 음과 겹친 다른 음은
 * 끝이 잘리거나 지워진다 (placeLoss). 손해 본 음이 없으면 undefined
 */
export function overlapNotice(loss: PlaceLoss, t: (key: MessageKey, params?: Params) => string): string | undefined {
  const cut = loss.cut.size;
  const removed = loss.removed.size;
  if (cut > 0 && removed > 0) return t("ui.overlapCutRemoved", { cut, removed });
  if (cut > 0) return t("ui.overlapCut", { count: cut });
  if (removed > 0) return t("ui.overlapRemoved", { count: removed });
  return undefined;
}

/**
 * 정보 칸에서 길이를 바꾸기 전에 물을 글. 다른 음이 잘리거나 지워지면 그 수를 넣어 물어보고, 손해 볼 음이 없으면 undefined (묻지 않고 바꾼다)
 */
export function lengthLossQuestion(loss: PlaceLoss, t: (key: MessageKey, params?: Params) => string): string | undefined {
  const cut = loss.cut.size;
  const removed = loss.removed.size;
  if (cut > 0 && removed > 0) return t("ui.noteInfoLengthCutRemovedConfirm", { cut, removed });
  if (cut > 0) return t("ui.noteInfoLengthCutConfirm", { count: cut });
  if (removed > 0) return t("ui.noteInfoLengthRemovedConfirm", { count: removed });
  return undefined;
}
