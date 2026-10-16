import { describe, expect, it } from "vitest";
import { emptySong, findOverlaps, History, rat, replaceSong, type Track } from "../src/index.js";

const meta = { title: "t", author: "EarlGreyPie", profileId: "mobile" };

describe("History", () => {
  it("실행 취소와 다시 실행", () => {
    const a = emptySong(meta);
    const b = { ...a, meta: { ...meta, title: "b" } };
    const h = new History(a);
    h.run(replaceSong("rename", b));
    expect(h.song.meta.title).toBe("b");
    expect(h.undo().meta.title).toBe("t");
    expect(h.canRedo).toBe(true);
    expect(h.redo().meta.title).toBe("b");
  });

  it("실행 취소로 사라졌다 다시 실행으로 돌아온 트랙도 음소거를 지킨다", () => {
    const track: Track = { id: "t1", playerId: "p1", name: "1", color: "", role: "free", mute: false, solo: false, spelling: {}, notes: [] };
    const a = emptySong(meta);
    const h = new History(a);
    h.run(replaceSong("add", { ...a, tracks: [track] }));
    h.amend({ ...h.song, tracks: [{ ...track, mute: true }] });
    h.undo();
    expect(h.redo().tracks[0]!.mute).toBe(true);
  });

  it("같은 id로 새로 생긴 트랙은 예전 트랙의 음소거를 물려받지 않는다", () => {
    const track: Track = { id: "t2", playerId: "p1", name: "2", color: "", role: "free", mute: false, solo: false, spelling: {}, notes: [] };
    const a = emptySong(meta);
    const h = new History(a);
    h.run(replaceSong("add", { ...a, tracks: [track] }));
    h.amend({ ...h.song, tracks: [{ ...track, mute: true }] });
    h.undo();
    h.run(replaceSong("add other", { ...a, tracks: [{ ...track, name: "새" }] }));
    h.undo();
    expect(h.redo().tracks[0]).toMatchObject({ name: "새", mute: false });
  });

  it("음소거·솔로(기록 밖)는 실행 취소·다시 실행해도 지금 값을 지킨다", () => {
    const track: Track = { id: "t1", playerId: "p1", name: "1", color: "", role: "free", mute: false, solo: false, spelling: {}, notes: [] };
    const a = { ...emptySong(meta), tracks: [track] };
    const b = { ...a, tracks: [{ ...track, name: "2" }] };
    const h = new History(a);
    h.run(replaceSong("rename", b));
    h.amend({ ...h.song, tracks: [{ ...h.song.tracks[0]!, mute: true }] });
    const undone = h.undo();
    expect(undone.tracks[0]).toMatchObject({ name: "1", mute: true });
    expect(h.redo().tracks[0]).toMatchObject({ name: "2", mute: true });
  });
});

describe("findOverlaps", () => {
  it("한 트랙 안의 겹친 음을 찾는다", () => {
    const track: Track = {
      id: "t1", playerId: "p1", name: "1", color: "#000", role: "melody",
      mute: false, solo: false, spelling: {},
      notes: [
        { id: "a", start: rat(0), dur: rat(1, 2), pitch: 60, vol: 8, tie: "none" },
        { id: "b", start: rat(1, 4), dur: rat(1, 4), pitch: 62, vol: 8, tie: "none" },
        { id: "c", start: rat(1, 2), dur: rat(1, 4), pitch: 64, vol: 8, tie: "none" },
      ],
    };
    expect(findOverlaps(track)).toEqual([{ trackId: "t1", first: "a", second: "b" }]);
  });
});
