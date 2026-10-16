import type { NoteClip } from "@mmlce/core";

/** 피아노롤에서 복사·잘라낸 음 (앱 안에서만 쓰는 클립보드. 트랙을 바꿔 붙일 수 있다) */
export const noteClipboard = $state<{ clip: NoteClip | undefined }>({ clip: undefined });
