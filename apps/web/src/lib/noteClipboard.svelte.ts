import type { NoteClip } from "@mmlce/core";

/** 피아노롤에서 복사·잘라낸 음 (앱 안에서만 쓰는 클립보드. 트랙을 바꿔 붙일 수 있다) */
class NoteClipboard {
  /**
   * 통째로만 바꾼다($state.raw). 속까지 반응형($state)으로 두면 꺼낸 음의 길이(Rat) 같은 속 값이 Proxy가 되어,
   * 붙여 넣은 음에 그대로 실려 곡 안으로 들어간다. Proxy가 든 곡은 뒤쪽 계산(Web Worker)으로 넘기지 못한다
   */
  clip = $state.raw<NoteClip | undefined>(undefined);
}
export const noteClipboard = new NoteClipboard();
