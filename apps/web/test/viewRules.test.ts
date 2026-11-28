import { describe, expect, it } from "vitest";
import { COMMANDS } from "../src/lib/keymap";
import { availableView, isViewMode, staffRuleKnown, STAFF_BLOCKED, toggledTabView, viewAllows, viewTakesNoteInput } from "../src/lib/viewRules";

describe("보기별 명령 규칙", () => {
  it("모든 명령이 오선보 규칙 표에 있다 (새 명령을 더하면 막을지 정해야 한다)", () => {
    expect(COMMANDS.filter((c) => !staffRuleKnown(c))).toEqual([]);
  });
  it("피아노롤·타브는 모든 명령을 받는다", () => {
    for (const c of COMMANDS) {
      expect(viewAllows("roll", c)).toBe(true);
      expect(viewAllows("tab", c)).toBe(true);
    }
  });
  it("오선보는 고른 음 편집·고르기·붙여넣기·녹음을 막는다", () => {
    for (const c of STAFF_BLOCKED) expect(viewAllows("staff", c as (typeof COMMANDS)[number])).toBe(false);
    for (const c of ["note.delete", "edit.paste", "edit.cut", "note.split", "edit.selectAll", "record.toggle"] as const) expect(viewAllows("staff", c)).toBe(false);
  });
  it("오선보에서도 실행 취소·재생·이동·저장·곡 단위 명령은 된다", () => {
    for (const c of ["edit.undo", "edit.redo", "play.toggle", "play.nextBar", "file.saveProject", "event.tempo", "edit.transpose", "track.next", "view.tab", "grid.16"] as const) {
      expect(viewAllows("staff", c)).toBe(true);
    }
  });
  it("오선보는 MIDI 건반 음 입력을 받지 않는다", () => {
    expect(viewTakesNoteInput("staff")).toBe(false);
    expect(viewTakesNoteInput("roll")).toBe(true);
    expect(viewTakesNoteInput("tab")).toBe(true);
  });
  it("Alt+T: 타브 ↔ 피아노롤, 오선보에서는 타브로", () => {
    expect(toggledTabView("roll")).toBe("tab");
    expect(toggledTabView("tab")).toBe("roll");
    expect(toggledTabView("staff")).toBe("tab");
  });
  it("실험실이 꺼지면 오선보 보기는 피아노롤로", () => {
    expect(availableView("staff", false)).toBe("roll");
    expect(availableView("staff", true)).toBe("staff");
    expect(availableView("tab", false)).toBe("tab");
  });
  it("보기 이름 검사", () => {
    expect(isViewMode("staff")).toBe(true);
    expect(isViewMode("score")).toBe(false);
  });
});
