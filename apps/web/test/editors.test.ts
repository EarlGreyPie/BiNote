import { describe, expect, it } from "vitest";
import { fillEditorTracks, oldestEditor, parseEditorCount, parseEditorMax, swapIntoEditors } from "../src/lib/editors";

const ids = ["t1", "t2", "t3", "t4"];

describe("편집기 여러 개: 아래 칸 트랙 채우기", () => {
  it("고른 것이 없으면 고른 트랙 다음부터 차례로", () => {
    expect(fillEditorTracks(ids, "t2", [], 4)).toEqual(["t3", "t4", "t1"]);
    expect(fillEditorTracks(ids, "t1", [], 2)).toEqual(["t2"]);
    expect(fillEditorTracks(ids, "t1", [], 1)).toEqual([]);
  });

  it("트랙 수보다 편집기가 많으면 트랙 수만큼만 연다", () => {
    expect(fillEditorTracks(["t1", "t2"], "t1", [], 4)).toEqual(["t2"]);
    expect(fillEditorTracks(["t1"], "t1", [], 4)).toEqual([]);
  });

  it("고른 트랙을 칸 자리에 두고, 지워졌거나 위·앞 칸과 겹치면 채운다", () => {
    expect(fillEditorTracks(ids, "t1", ["t4", "t2"], 3)).toEqual(["t4", "t2"]);
    expect(fillEditorTracks(ids, "t1", ["gone", "t3"], 3)).toEqual(["t2", "t3"]);
    expect(fillEditorTracks(ids, "t1", ["t1", "t3", "t3"], 4)).toEqual(["t2", "t3", "t4"]);
  });

  it("위에서 아래 칸 트랙을 고르면 그 칸에 원래 위 트랙이 들어간다", () => {
    const shown = fillEditorTracks(ids, "t1", [], 3);
    expect(shown).toEqual(["t2", "t3"]);
    const chosen = swapIntoEditors(shown, "t1", "t3")!;
    expect(fillEditorTracks(ids, "t3", chosen, 3)).toEqual(["t2", "t1"]);
    expect(swapIntoEditors(shown, "t1", "t4")).toBeUndefined();
  });

  it("Alt+클릭은 가장 오래전에 바뀐 칸을 바꾼다 (바뀐 적 없는 칸이 먼저)", () => {
    expect(oldestEditor([], 3)).toBe(0);
    expect(oldestEditor([5, undefined, 3], 3)).toBe(1);
    expect(oldestEditor([5, 2, 3], 3)).toBe(1);
    expect(oldestEditor([5, 2, 3], 1)).toBe(0);
  });
});

describe("편집기 수·최대치 저장값", () => {
  it("예전 편집기 둘 나란히(켜짐)는 처음 한 번 2로 옮긴다", () => {
    expect(parseEditorCount(null, "1", 4)).toBe(2);
    expect(parseEditorCount(null, "0", 4)).toBe(1);
    expect(parseEditorCount(null, null, 4)).toBe(1);
    expect(parseEditorCount("3", "1", 4)).toBe(3);
    expect(parseEditorCount("6", null, 4)).toBe(4);
    expect(parseEditorCount("x", null, 4)).toBe(1);
  });

  it("최대치는 2 ~ 한 악보 트랙 수, 기본 4", () => {
    expect(parseEditorMax(null, 6)).toBe(4);
    expect(parseEditorMax("6", 6)).toBe(6);
    expect(parseEditorMax("7", 6)).toBe(4);
    expect(parseEditorMax("1", 6)).toBe(4);
    expect(parseEditorMax(null, 3)).toBe(3);
  });
});
