import type { CommandId } from "./keymap";

/**
 * 편집 칸 보기: 피아노롤 · 타브 · 오선보(실험실).
 * 오선보는 보기 전용이라 고른 음을 고치는 명령을 받지 않는다. 그 규칙을 이 파일 한 곳에 둔다
 * (App의 run 입구와 메뉴 회색 처리, MIDI 건반 입력이 모두 여기를 묻는다).
 */
export type ViewMode = "roll" | "tab" | "staff";

export const VIEW_MODES: readonly ViewMode[] = ["roll", "tab", "staff"];

export function isViewMode(v: unknown): v is ViewMode {
  return (VIEW_MODES as readonly unknown[]).includes(v);
}

/**
 * 오선보에서도 되는 명령. 곡 단위(실행 취소·템포·이조·트랙 순서 등)와 재생·이동·저장·보기는 오선보와 상관없이 된다.
 * 이조·볼륨 창은 고른 음이 없으니 트랙 전체에 쓰인다
 */
const STAFF_ALLOWED: ReadonlySet<string> = new Set([
  "file.open",
  "file.save3mle",
  "file.saveMmi",
  "file.saveProject",
  "file.saveProjectAs",
  "edit.undo",
  "edit.redo",
  "edit.find",
  "edit.replace",
  "edit.findNext",
  "edit.findPrev",
  "edit.transpose",
  "edit.volume",
  // 조표에 맞추기는 이조처럼 마디 범위 창으로 곡 단위. 조표 맞춤 입력 켜기·끄기는 입력 방식 설정일 뿐 곡을 바꾸지 않는다
  "edit.keyFit",
  "edit.keyLock",
  "event.tempo",
  "event.marker",
  // 작업 메모 넣기(실험실)는 마커처럼 곡 위치에 쪽지를 붙일 뿐 고른 음을 바꾸지 않는다
  "event.memo",
  "tempo.tap",
  "play.toggle",
  "play.start",
  "play.stop",
  "play.fromEditCursor",
  "play.toStart",
  "play.toEnd",
  "play.prevBar",
  "play.nextBar",
  "track.prev",
  "track.next",
  "track.moveUp",
  "track.moveDown",
  "view.tab",
  "view.orientation",
  "view.keymap",
]);

/**
 * 오선보에서 막는 명령: 고른 음 편집·고르기·붙여넣기·새 음 길이·녹음.
 * 새 명령을 더하면 위나 여기 둘 중 한 곳에 넣어야 테스트(viewRules.test.ts)를 지난다
 */
export const STAFF_BLOCKED: ReadonlySet<string> = new Set([
  "edit.selectAll",
  "edit.selectTracks",
  "edit.selectBefore",
  "edit.selectAfter",
  "edit.copy",
  "edit.cut",
  "edit.paste",
  "edit.pasteInPlace",
  "edit.duplicate",
  "edit.lengthDouble",
  "edit.lengthHalf",
  "edit.dotToggle",
  "note.delete",
  "note.octaveUp",
  "note.octaveDown",
  "note.volumeUp",
  "note.volumeDown",
  "note.tie",
  "note.split",
  "note.glue",
  "record.toggle",
]);

/** 이 보기에서 명령을 받는지. 피아노롤·타브는 지금까지처럼 모두 받는다 (각 명령이 알아서 할 일을 정한다) */
export function viewAllows(view: ViewMode, command: CommandId): boolean {
  if (view !== "staff") return true;
  // 격자는 화면 설정일 뿐 곡을 바꾸지 않는다
  if (command.startsWith("grid.")) return true;
  return STAFF_ALLOWED.has(command);
}

/** 명령이 오선보 규칙 표에 있는지 (테스트용: 새 명령을 표에 넣지 않으면 실패하게) */
export function staffRuleKnown(command: CommandId): boolean {
  return command.startsWith("grid.") || STAFF_ALLOWED.has(command) || STAFF_BLOCKED.has(command);
}

/** MIDI 건반으로 음을 넣는 입력(스텝 입력·녹음)을 받는 보기인지. 오선보는 보기 전용이라 받지 않는다 */
export function viewTakesNoteInput(view: ViewMode): boolean {
  return view !== "staff";
}

/** Alt+T(타브 보기): 타브면 피아노롤로, 피아노롤·오선보면 타브로 */
export function toggledTabView(view: ViewMode): ViewMode {
  return view === "tab" ? "roll" : "tab";
}

/** 실험실을 끄면 오선보 보기는 쓸 수 없다: 피아노롤로 돌아간다 */
export function availableView(view: ViewMode, labsOn: boolean): ViewMode {
  return view === "staff" && !labsOn ? "roll" : view;
}
