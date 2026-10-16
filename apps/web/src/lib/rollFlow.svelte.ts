import { loadStored, saveStored } from "./persist";

/**
 * 재생할 때 롤이 움직이는 방식 (보기 설정, 이 브라우저에 기억). 설정 → 화면에서 고른다.
 * - page: 재생선이 화면 끝 가까이 가면 한 쪽씩 넘긴다 (기본)
 * - flow: 건반 선 = 지금 재생 위치로 두고 악보가 계속 흐른다. 세로 롤이면 떨어지는 음 영상처럼 음이 건반으로 내려온다
 * 건반에 맞춘 배경 영상이 있으면 이 설정과 상관없이 늘 흐른다 (영상 속 음과 롤 음이 겹치게)
 */
export type RollFlow = "page" | "flow";

const KEY = "mmlce.rollFlow";

export const rollFlow = $state<{ mode: RollFlow }>({ mode: loadStored(KEY, (raw) => (raw === "flow" ? "flow" : "page")) });

export function setRollFlow(mode: RollFlow): void {
  rollFlow.mode = mode;
  saveStored(KEY, mode);
}
