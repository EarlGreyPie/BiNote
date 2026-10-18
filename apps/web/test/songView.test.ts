import { describe, expect, it } from "vitest";
import { emptyViewMemory, rememberView } from "../src/lib/viewCarry";
import { freshSongView } from "../src/lib/songView";

/** 앱이 곡을 열 때 하는 일을 흉내 낸다: 자동 보존 작업 id와 보기 세대 번호를 따로 든다 */
function app() {
  const state = { workId: "w1", viewGen: 0, memory: emptyViewMemory() };
  const open = (restoreId?: string) => {
    state.viewGen = freshSongView(state.viewGen).viewGen;
    state.workId = `new${state.viewGen}`;
    // 지난 작업 되살리기: openSong 뒤 바로 같은 작업 id로 되돌린다
    if (restoreId) state.workId = restoreId;
    Object.assign(state.memory, emptyViewMemory());
  };
  return { state, open };
}

describe("곡마다의 보기 상태 비우기", () => {
  it("곡을 열 때마다 보기 세대 번호가 1씩 늘고, 곡마다의 상태는 모두 빈 값", () => {
    const fresh = freshSongView(4);
    expect(fresh.viewGen).toBe(5);
    const { viewGen: _gen, ...rest } = fresh;
    for (const [key, value] of Object.entries(rest)) {
      const empty = value === undefined || value === false || value === "" || (Array.isArray(value) && value.length === 0);
      expect(empty, key).toBe(true);
    }
    // 고른 템포·마커와 열린 템포·마커 창도 비운다 (다른 곡의 같은 마커 id를 지우지 않게)
    expect(fresh.pickedEvent).toBeUndefined();
    expect(fresh.eventEdit).toBeUndefined();
  });

  it("같은 작업을 다시 되살려도 세대 번호는 바뀐다 (작업 id는 같아도)", () => {
    const { state, open } = app();
    open("w1");
    const before = state.viewGen;
    open("w1");
    expect(state.workId).toBe("w1");
    expect(state.viewGen).toBe(before + 1);
  });

  it("세대 번호가 다르면 옛 보기의 기억을 쓰지 않는다: 같은 작업 되살리기 뒤 옛 타브 커서가 남지 않음", () => {
    const { state, open } = app();
    open("w1");
    const oldGen = state.viewGen;
    const tab = { pxPerWhole: 220, cursor: { at: { n: 7, d: 1 }, string: 1 } };
    expect(rememberView(state.memory, oldGen, state.viewGen, { tab })).toBe(true);
    // 같은 작업을 다시 되살린다: 기억을 비우고 세대를 올린다. 옛 보기가 늦게 알린 커서는 버린다
    open("w1");
    expect(state.memory.tab).toBeUndefined();
    expect(rememberView(state.memory, oldGen, state.viewGen, { tab })).toBe(false);
    expect(state.memory.tab).toBeUndefined();
  });
});
