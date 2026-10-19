import { describe, expect, it } from "vitest";
import { defaultLengthLimit, emptySong, rat, type Note, type Song } from "@mmlce/core";
import { newUnwritableTrack, unwritableCount } from "../src/lib/writable";

const limit = defaultLengthLimit();
const note = (id: string, start: [number, number], dur: [number, number]): Note => ({ id, start: rat(...start), dur: rat(...dur), pitch: 60, vol: 8, tie: "none" });
const withNotes = (notes: Note[]): Song => ({
  ...emptySong({ title: "", author: "", profileId: "mobile" }),
  tracks: [{ id: "t1", playerId: "p1", name: "트랙 1", color: "#000", role: "free", mute: false, solo: false, notes, spelling: {} }],
});

describe("쓸 수 없는 길이 검사", () => {
  it("음 길이와 음 사이 쉼표를 센다", () => {
    expect(unwritableCount([note("a", [0, 1], [1, 20]), note("b", [1, 20], [1, 20])], limit)).toBe(0);
    // 1/20 음을 1/28에서 자르면 뒤 조각 1/70
    expect(unwritableCount([note("a", [0, 1], [1, 28]), note("b", [1, 28], [1, 70])], limit)).toBe(1);
    // l28 음 두 개를 0과 1/20에: 사이 쉼표 1/70
    expect(unwritableCount([note("a", [0, 1], [1, 28]), note("b", [1, 20], [1, 28])], limit)).toBe(1);
    // 1/20 + 1/40 같은 이음 길이·점 길이(l20.)는 쓸 수 있다
    expect(unwritableCount([note("a", [0, 1], [3, 40]), note("b", [1, 4], [3, 40])], limit)).toBe(0);
    expect(unwritableCount([note("a", [0, 1], [1, 128])], limit)).toBe(1);
  });

  it("편집이 쓸 수 없는 길이를 늘린 트랙만 잡는다 (원래 있던 것은 막지 않는다)", () => {
    const before = withNotes([note("a", [0, 1], [1, 20])]);
    const cut = withNotes([note("a", [0, 1], [1, 28]), note("b", [1, 28], [1, 70])]);
    expect(newUnwritableTrack(before, cut, limit)).toBe("t1");
    const fine = withNotes([note("a", [0, 1], [1, 40]), note("b", [1, 40], [1, 40])]);
    expect(newUnwritableTrack(before, fine, limit)).toBeUndefined();
    // 이미 1/70 조각이 있는 곡에서 다른 음을 옮겨도 막지 않는다
    const moved = withNotes([...cut.tracks[0]!.notes, note("c", [1, 1], [1, 4])]);
    expect(newUnwritableTrack(cut, moved, limit)).toBeUndefined();
    // 음 목록이 그대로인 트랙은 보지 않는다
    expect(newUnwritableTrack(cut, cut, limit)).toBeUndefined();
  });
});
