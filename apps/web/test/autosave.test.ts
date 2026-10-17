import { describe, expect, it } from "vitest";
import { AutosaveQueue, AutosaveTracker } from "../src/lib/autosave";

describe("AutosaveTracker", () => {
  it("연 그대로면 적지 않고, 고친 상태는 적는다", () => {
    const a = new AutosaveTracker<object>();
    const opened = {};
    a.reset(opened);
    expect(a.dirty(opened)).toBe(false);
    expect(a.dirty(undefined)).toBe(false);
    expect(a.dirty({})).toBe(true);
  });

  it("저장이 실패하면 같은 상태를 다시 적는다 (B-08)", () => {
    const a = new AutosaveTracker<string>();
    a.reset("t120");
    a.begin("t90")(true);
    expect(a.dirty("t90")).toBe(false);
    const done = a.begin("t80");
    // 저장 중에는 같은 상태를 또 보내지 않는다
    expect(a.dirty("t80")).toBe(false);
    done(false);
    expect(a.dirty("t80")).toBe(true);
    a.begin("t80")(true);
    expect(a.dirty("t80")).toBe(false);
  });

  it("실행 취소로 연 그대로 돌아와도 이미 적었으면 다시 적는다", () => {
    const a = new AutosaveTracker<string>();
    a.reset("open");
    a.begin("edit")(true);
    expect(a.dirty("open")).toBe(true);
  });

  it("앞 작업의 늦은 응답은 새 작업 상태를 바꾸지 않는다", () => {
    const a = new AutosaveTracker<string>();
    a.reset("a0");
    const late = a.begin("a1");
    a.reset("b0");
    late(true);
    expect(a.dirty("a1")).toBe(true);
    expect(a.dirty("b0")).toBe(false);
  });

  it("먼저 보낸 저장이 늦게 성공해도 더 나중 저장을 덮지 않는다", () => {
    const a = new AutosaveTracker<string>();
    a.reset("x");
    const first = a.begin("y");
    const second = a.begin("z");
    second(true);
    first(true);
    expect(a.dirty("z")).toBe(false);
    expect(a.dirty("y")).toBe(true);
  });

  it("다른 상태를 적는 중에 실행 취소로 돌아오면 돌아온 상태를 뒤이어 적는다 (점검 #3)", () => {
    const a = new AutosaveTracker<string>();
    a.reset("A");
    const b = a.begin("B");
    // B를 적는 중 실행 취소로 A: B가 끝나면 기록이 B라서 A를 다시 적어야 한다
    expect(a.dirty("A")).toBe(true);
    const back = a.begin("A");
    expect(a.dirty("A")).toBe(false);
    b(true);
    back(true);
    expect(a.dirty("A")).toBe(false);
    expect(a.dirty("B")).toBe(true);
  });
});

describe("AutosaveTracker (곡 + 튜닝 묶음, PR #89 점검 1번)", () => {
  type State = { song: object; tabs: string };
  const same = (a: State, b: State) => a.song === b.song && a.tabs === b.tabs;

  it("곡이 그대로여도 튜닝·카포만 바뀌면 다시 적는다", () => {
    const a = new AutosaveTracker<State>(same);
    const song = {};
    a.reset({ song, tabs: "standard" });
    a.begin({ song, tabs: "standard" })(true);
    expect(a.dirty({ song, tabs: "standard" })).toBe(false);
    expect(a.dirty({ song, tabs: "bass4" })).toBe(true);
  });

  it("같은 값으로 새로 만든 묶음은 적는 중인 상태와 같다고 본다", async () => {
    const tracker = new AutosaveTracker<State>(same);
    const song = {};
    tracker.reset({ song, tabs: "standard" });
    const q = new AutosaveQueue(tracker);
    let writes = 0;
    let release!: (ok: boolean) => void;
    const first = q.flush({ song, tabs: "bass4" }, () => () => {
      writes++;
      return new Promise<boolean>((r) => (release = r));
    });
    // 저장 중에 같은 값의 새 묶음으로 다시 부르면 그 저장을 기다린다 (두 번 적지 않는다)
    const again = q.flush({ song, tabs: "bass4" }, () => async () => {
      writes++;
      return true;
    });
    await Promise.resolve();
    release(true);
    await Promise.all([first, again]);
    expect(writes).toBe(1);
    expect(tracker.dirty({ song, tabs: "bass4" })).toBe(false);
  });
});

describe("AutosaveQueue", () => {
  it("저장이 false로 실패하면 거부해 업데이트 새로고침을 막는다 (beta.6 점검 1번)", async () => {
    const tracker = new AutosaveTracker<string>();
    tracker.reset("open");
    const q = new AutosaveQueue(tracker);
    await expect(q.flush("A", () => async () => false)).rejects.toThrow();
    // 실패한 상태는 다시 적을 것으로 남는다
    expect(tracker.dirty("A")).toBe(true);
    await expect(q.flush("A", () => async () => true)).resolves.toBeUndefined();
  });

  it("적는 중인 상태를 다시 부르면 그 저장의 결과를 따른다", async () => {
    const tracker = new AutosaveTracker<string>();
    tracker.reset("open");
    const q = new AutosaveQueue(tracker);
    let finish!: (ok: boolean) => void;
    const first = q.flush("A", () => () => new Promise<boolean>((r) => (finish = r)));
    first.catch(() => {});
    let called = false;
    // 적는 중이라 새로 보내지 않고, 앞 저장이 실패하면 함께 실패한다
    const again = q.flush("A", () => ((called = true), async () => true));
    await Promise.resolve();
    finish(false);
    await expect(again).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("이미 적은 상태면 바로 풀리고, 앞 저장이 끝난 뒤에 다음 저장을 한다", async () => {
    const tracker = new AutosaveTracker<string>();
    tracker.reset("open");
    const q = new AutosaveQueue(tracker);
    await expect(q.flush("open", () => async () => false)).resolves.toBeUndefined();
    const order: string[] = [];
    let finishA!: (ok: boolean) => void;
    const a = q.flush("A", () => () => new Promise<boolean>((r) => (finishA = () => (order.push("A"), r(true)))));
    const b = q.flush("B", () => async () => (order.push("B"), true));
    await Promise.resolve();
    finishA(true);
    await Promise.all([a, b]);
    expect(order).toEqual(["A", "B"]);
  });
});
