import { describe, expect, it } from "vitest";
import { emptySong, findOverlaps, History, rat, replaceSong, type Command, type Track } from "../src/index.js";

const meta = { title: "t", author: "EarlGreyPie", profileId: "mobile" };

describe("History", () => {
  it("실행 취소 뒤 곧바로 다시 실행하면 명령을 다시 계산하지 않고 취소 전의 곡 그대로 돌아온다", () => {
    const a = emptySong(meta);
    let applied = 0;
    // 부를 때마다 새 객체를 만드는 명령 (음 목록을 새로 만드는 편집처럼)
    const rename: Command = {
      label: "rename",
      apply: (song) => {
        applied++;
        return { ...song, meta: { ...song.meta, title: "b" } };
      },
      invert: (before) => ({ label: "rename", apply: () => before, invert: () => rename }),
    };
    const h = new History(a);
    const b = h.run(rename);
    const c = h.run(rename);
    expect(applied).toBe(2);
    expect(h.undo()).toBe(b);
    expect(h.undo()).toBe(a);
    expect(h.redo()).toBe(b);
    expect(h.redo()).toBe(c);
    expect(applied).toBe(2);
  });

  it("실행 취소와 다시 실행 사이에 음소거를 바꿔도 다시 실행은 취소 전의 음 그대로 돌아오고, 바꾼 음소거는 남는다", () => {
    const track = (id: string): Track => ({ id, playerId: "p1", name: id, color: "#000", role: "free", mute: false, solo: false, notes: [], spelling: {} });
    const a = { ...emptySong(meta), tracks: [track("t1"), track("t2")] };
    let applied = 0;
    // 부를 때마다 음 목록을 새 객체로 만드는 편집
    const edit = (id: string): Command => {
      const command: Command = {
        label: id,
        apply: (song) => {
          applied++;
          return { ...song, tracks: song.tracks.map((t) => (t.id === id ? { ...t, notes: [...t.notes, { id: `${id}.${t.notes.length}`, start: rat(0), dur: rat(1, 4), pitch: 60, vol: 8, tie: "none" as const }] } : t)) };
        },
        invert: (before) => ({ label: id, apply: () => before, invert: () => command }),
      };
      return command;
    };
    const h = new History(a);
    const b = h.run(edit("t1"));
    const c = h.run(edit("t2"));
    expect(applied).toBe(2);
    h.undo();
    h.undo();
    // 기록 밖 상태: 트랙 2 끄기
    const muted = h.amend({ ...h.song, tracks: h.song.tracks.map((t) => (t.id === "t2" ? { ...t, mute: true } : t)) });
    expect(muted.tracks[1]!.mute).toBe(true);
    const r1 = h.redo();
    const r2 = h.redo();
    // 명령을 다시 계산하지 않았고, 음 목록은 취소 전과 같은 객체다 (그 곡을 기준으로 세운 뒤 단계가 낡지 않는다)
    expect(applied).toBe(2);
    expect(r1.tracks[0]!.notes).toBe(b.tracks[0]!.notes);
    expect(r2.tracks[0]!.notes).toBe(c.tracks[0]!.notes);
    expect(r2.tracks[1]!.notes).toBe(c.tracks[1]!.notes);
    expect(r1.tracks[1]!.mute).toBe(true);
    expect(r2.tracks[1]!.mute).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it("맨 위 두 단계를 한 칸으로 묶으면 실행 취소·다시 실행 한 번에 두 단계가 함께 오간다", () => {
    const a = emptySong(meta);
    const title = (to: string): Command => {
      const command: Command = {
        label: to,
        apply: (song) => ({ ...song, meta: { ...song.meta, title: to } }),
        invert: (before) => ({ label: to, apply: () => before, invert: () => command }),
      };
      return command;
    };
    const h = new History(a);
    expect(h.mergeLast()).toBe(false);
    h.run(title("b"));
    expect(h.mergeLast()).toBe(false);
    h.run(title("c"));
    const d = h.run(title("d"));
    expect(h.mergeLast()).toBe(true);
    // c와 d가 한 칸: 한 번에 b로, 다시 실행 한 번에 d로
    expect(h.undo().meta.title).toBe("b");
    expect(h.redo()).toBe(d);
    expect(h.undo().meta.title).toBe("b");
    expect(h.undo()).toBe(a);
    expect(h.canUndo).toBe(false);
    expect(h.redo().meta.title).toBe("b");
    expect(h.redo().meta.title).toBe("d");
    expect(h.canRedo).toBe(false);
  });

  it("검사가 거절한 명령은 곡도 기록도 바꾸지 않는다. unchecked는 검사를 건너뛴다", () => {
    const a = emptySong(meta);
    const b = { ...a, meta: { ...meta, title: "b" } };
    const seen: string[] = [];
    const h = new History(a, (_before, after, command) => {
      seen.push(command.label);
      return after.meta.title !== "b";
    });
    expect(h.run(replaceSong("rename", b))).toBe(a);
    expect(h.refused).toBe(true);
    expect(h.refusal).toBe("guard");
    expect(h.canUndo).toBe(false);
    expect(seen).toEqual(["rename"]);
    expect(h.run(replaceSong("text", b), { unchecked: true })).toBe(b);
    expect(h.refused).toBe(false);
    expect(h.canUndo).toBe(true);
    expect(seen).toEqual(["rename"]);
  });

  it("명령이나 검사가 분수 범위를 넘어 RangeError를 던지면 편집만 거절하고 앱은 이어 간다", () => {
    const a = emptySong(meta);
    const b = { ...a, meta: { ...meta, title: "b" } };
    const overflow: Command = {
      label: "overflow",
      apply: () => {
        throw new RangeError("분수 값이 안전한 정수 범위를 넘었습니다");
      },
      invert: () => overflow,
    };
    const h = new History(a);
    expect(h.run(overflow)).toBe(a);
    expect(h.refused).toBe(true);
    expect(h.refusal).toBe("range");
    expect(h.canUndo).toBe(false);
    // 검사 안에서 넘쳐도 같다
    const g = new History(a, () => {
      throw new RangeError("넘침");
    });
    expect(g.run(replaceSong("rename", b))).toBe(a);
    expect(g.refusal).toBe("range");
    // 다음 편집은 그대로 된다
    expect(h.run(replaceSong("rename", b))).toBe(b);
    expect(h.refused).toBe(false);
    expect(h.refusal).toBeUndefined();
    // RangeError가 아닌 예외(코드 잘못)는 숨기지 않는다
    const broken: Command = {
      label: "broken",
      apply: () => {
        throw new TypeError("x");
      },
      invert: () => broken,
    };
    expect(() => h.run(broken)).toThrow(TypeError);
  });

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
