import { describe, expect, it } from "vitest";
import { cmp, emptySong, rat, type Note, type Rat, type Song } from "@mmlce/core";
import { quantizeTake, type TakeNote } from "../src/lib/midiRecord";
import { assignTake, clearRange, liveTarget, planChanges, recordTarget, replaceRange, takeGhosts, type RecordMode } from "../src/lib/recordPlan";
import { previousVolume } from "../src/lib/midiInput";
import { scoreGroups } from "../src/lib/scores";

function song(n: number, notes: Record<number, Note[]> = {}): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  return {
    ...base,
    players: [{ id: "p1", name: "", instrument: { canonical: "piano" } }],
    tracks: Array.from({ length: n }, (_, k) => ({ id: `t${k}`, playerId: "p1", name: "", color: "", role: "free" as const, mute: false, solo: false, notes: notes[k] ?? [], spelling: {} })),
  };
}
const r = (n: number, d = 1) => rat(n, d);
const same = (a: Rat, b: Rat) => cmp(a, b) === 0;
const tn = (pitch: number, start: Rat, dur: Rat): TakeNote => ({ pitch, velocity: 100, start, dur });
const vol = (n: readonly Note[], at: Rat) => previousVolume(n, at);
const G = r(1, 16);
/** 예전 placeTake와 같은 자리: 고른 트랙 t0부터, 악보 트랙 한도 3 */
function placeTake(s: Song, take: readonly TakeNote[], options: { locked?: Set<string>; armed?: Set<string>; mode?: RecordMode; addTracks?: boolean; active?: string } = {}) {
  const target = recordTarget(s, scoreGroups(s, 3), options.active ?? "t0", options.armed, options.locked ?? new Set(), 3, options.addTracks ?? true)!;
  const assign = assignTake(s, target, take, G, options.mode ?? "overdub", vol);
  return { ...planChanges(assign), dropped: assign.dropped.length, assign, target };
}

describe("녹음 격자 맞추기", () => {
  it("시작·끝을 가까운 16분 칸으로, 녹음 시작 앞은 시작으로", () => {
    const out = quantizeTake(
      [
        { pitch: 60, velocity: 90, on: 0.98, off: 1.24 },
        { pitch: 62, velocity: 90, on: 0.95, off: 1.02 },
      ],
      G,
      r(1),
    );
    expect(out.map((n) => n.pitch)).toEqual([62, 60]);
    expect(same(out[1]!.start, r(1)) && same(out[1]!.dur, r(1, 4))).toBe(true);
    // 너무 짧으면 한 칸
    expect(same(out[0]!.start, r(1)) && same(out[0]!.dur, G)).toBe(true);
  });

  it("셋잇단 격자는 분수 그대로 (1/12)", () => {
    const [n] = quantizeTake([{ pitch: 60, velocity: 90, on: 1 / 12 + 0.01, off: 2 / 12 }], r(1, 12), r(0));
    expect(same(n!.start, r(1, 12)) && same(n!.dur, r(1, 12))).toBe(true);
  });

  it("같은 높이를 다시 치면 앞 음을 끊는다", () => {
    const out = quantizeTake(
      [
        { pitch: 60, velocity: 90, on: 0, off: 0.5 },
        { pitch: 60, velocity: 90, on: 0.25, off: 0.5 },
      ],
      G,
      r(0),
    );
    expect(out).toHaveLength(2);
    expect(same(out[0]!.dur, r(1, 4))).toBe(true);
  });
});

describe("녹음 음 트랙에 나누기", () => {
  it("이어 치기에서 조금 늦게 뗀 선율은 고른 트랙에 그대로 (앞 음을 끊는다)", () => {
    const s = song(1);
    const take = [tn(60, r(0), r(5, 16)), tn(62, r(1, 4), r(1, 4))];
    const out = placeTake(s, take);
    expect(out.newTracks).toHaveLength(0);
    const notes = out.changes[0]!.notes;
    expect(notes.map((n) => n.pitch)).toEqual([60, 62]);
    expect(same(notes[0]!.dur, r(1, 4))).toBe(true);
  });

  it("화음은 높은 음부터 트랙을 나누고, 모자라면 한도까지 트랙을 더하고 넘치면 센다", () => {
    const s = song(1);
    const take = [60, 64, 67, 72].map((p) => tn(p, r(0), r(1, 4)));
    const out = placeTake(s, take);
    expect(out.changes[0]!.notes.map((n) => n.pitch)).toEqual([72]);
    expect(out.newTracks.map((t) => t.map((n) => n.pitch))).toEqual([[67], [64]]);
    expect(out.dropped).toBe(1);
  });

  it("길게 누른 화음 위 선율: 선율은 고른 트랙, 받친 음은 다음 트랙", () => {
    const s = song(2);
    const take = [tn(48, r(0), r(1)), tn(72, r(0), r(1, 4)), tn(74, r(1, 4), r(1, 4)), tn(76, r(1, 2), r(1, 2))];
    const out = placeTake(s, take);
    expect(out.changes.find((c) => c.trackId === "t0")!.notes.map((n) => n.pitch)).toEqual([72, 74, 76]);
    expect(out.changes.find((c) => c.trackId === "t1")!.notes.map((n) => n.pitch)).toEqual([48]);
  });

  it("곡에 있던 음은 지우지 않고 그 자리는 다음 트랙에 (덧녹음)", () => {
    const old: Note = { id: "x", start: r(0), dur: r(1, 2), pitch: 50, vol: 9, tie: "none" };
    const s = song(2, { 0: [old] });
    const out = placeTake(s, [tn(60, r(0), r(1, 4)), tn(62, r(1, 2), r(1, 4))]);
    const t0 = out.changes.find((c) => c.trackId === "t0")!.notes;
    expect(t0.map((n) => n.pitch)).toEqual([50, 62]);
    expect(out.changes.find((c) => c.trackId === "t1")!.notes.map((n) => n.pitch)).toEqual([60]);
  });

  it("잠긴 트랙은 건너뛴다", () => {
    const s = song(3);
    const out = placeTake(s, [tn(60, r(0), r(1, 4)), tn(64, r(0), r(1, 4))], { locked: new Set(["t1"]) });
    expect(out.changes.map((c) => c.trackId)).toEqual(["t0", "t2"]);
  });
});


describe("녹음할 트랙 고르기 (recordTarget)", () => {
  it("고르지 않으면 고른 트랙과 그 뒤 트랙들(잠긴 트랙 빼고), 한도까지 더할 수 있다", () => {
    const s = song(2);
    const t = recordTarget(s, scoreGroups(s, 3), "t0", undefined, new Set(["t1"]), 3, true)!;
    expect(t.trackIds).toEqual(["t0"]);
    expect(t.auto).toBe(true);
    expect(t.room).toBe(1);
    expect(t.groupTrackIds).toEqual(["t0", "t1"]);
  });

  it("고른 트랙만 악보 순서로. 다른 악보 트랙만 골라 두었으면 저절로 정한다", () => {
    const s = song(3);
    const t = recordTarget(s, scoreGroups(s, 3), "t0", new Set(["t2", "t0"]), new Set(), 3, true)!;
    expect(t.trackIds).toEqual(["t0", "t2"]);
    expect(t.room).toBe(0);
    const other = recordTarget(s, scoreGroups(s, 3), "t1", new Set(["zz"]), new Set(), 3, true)!;
    expect(other.trackIds).toEqual(["t1", "t2"]);
  });

  it("트랙 더하기를 끄면 더하지 않고, 연주자의 앞 악보면 켜도 더할 수 없다", () => {
    const s = song(4);
    const groups = scoreGroups(s, 3); // 악보 1: t0–t2, 악보 2: t3
    const off = recordTarget(s, groups, "t3", undefined, new Set(), 3, false)!;
    expect(off.room).toBe(0);
    expect(off.canAdd).toBe(true);
    const front = recordTarget(s, groups, "t0", undefined, new Set(), 6, true)!;
    expect(front.canAdd).toBe(false);
    expect(front.room).toBe(0);
  });

  it("고른 트랙 둘에 넣는 화음: 남는 음은 새 트랙, 트랙 더하기를 끄면 빠진다", () => {
    const s = song(3);
    const take = [60, 64, 67].map((p) => tn(p, r(0), r(1, 4)));
    const on = placeTake(s, take, { armed: new Set(["t0", "t2"]) });
    expect(on.changes.map((c) => [c.trackId, c.notes.map((n) => n.pitch)])).toEqual([
      ["t0", [67]],
      ["t2", [64]],
    ]);
    // t1을 고르지 않았고 악보 트랙이 한도(3)라 더할 수 없다
    expect(on.newTracks).toEqual([]);
    expect(on.dropped).toBe(1);
    const one = song(1);
    const off = placeTake(one, take, { addTracks: false });
    expect(off.newTracks).toEqual([]);
    expect(off.dropped).toBe(2);
  });
});

describe("녹음 중 곡이 바뀐 뒤 넣을 곳 (liveTarget)", () => {
  it("녹음 트랙을 다른 연주자의 악보로 옮기면 그 트랙에는 넣지 않는다", () => {
    const s = song(2);
    const target = recordTarget(s, scoreGroups(s, 3), "t0", new Set(["t0"]), new Set(), 3, true)!;
    const moved: Song = { ...s, players: [...s.players, { id: "p2", name: "", instrument: { canonical: "piano" } }], tracks: s.tracks.map((t) => (t.id === "t0" ? { ...t, playerId: "p2" } : t)) };
    const live = liveTarget(moved, scoreGroups(moved, 3), target, new Set(), 3);
    expect(live.trackIds).toEqual([]);
    const assign = assignTake(moved, live, [tn(60, r(0), r(1, 4))], G, "overdub", vol);
    expect(planChanges(assign).changes.map((c) => c.trackId)).not.toContain("t0");
  });

  it("같은 연주자의 다른 악보로 넘어간 트랙은 빼고, 남은 악보에만 넣는다", () => {
    const s = song(4); // 악보 1: t0–t2, 악보 2: t3
    const target = recordTarget(s, scoreGroups(s, 3), "t0", new Set(["t0", "t2"]), new Set(), 3, true)!;
    // t2를 맨 뒤로 옮겨 둘째 악보로 넘어감
    const order = ["t0", "t1", "t3", "t2"];
    const moved: Song = { ...s, tracks: order.map((id) => s.tracks.find((t) => t.id === id)!) };
    const live = liveTarget(moved, scoreGroups(moved, 3), target, new Set(), 3);
    expect(live.trackIds).toEqual(["t0"]);
    expect(live.room).toBe(0);
  });

  it("녹음할 트랙 하나만 다른 악보로 옮기면 그 트랙을 따라가지 않는다", () => {
    const s = song(4); // 악보 1: t0–t2, 악보 2: t3
    const target = recordTarget(s, scoreGroups(s, 3), "t2", new Set(["t2"]), new Set(), 3, true)!;
    const order = ["t0", "t1", "t3", "t2"];
    const moved: Song = { ...s, tracks: order.map((id) => s.tracks.find((t) => t.id === id)!) };
    const live = liveTarget(moved, scoreGroups(moved, 3), target, new Set(), 3);
    expect(live.trackIds).toEqual([]);
    expect(live.groupTrackIds).toEqual(["t0", "t1", "t3"]);
  });

  it("그대로면 시작 때와 같고, 녹음 트랙이 모두 지워져도 새 트랙 자리는 마지막 악보에 남는다", () => {
    const s = song(1);
    const target = recordTarget(s, scoreGroups(s, 3), "t0", undefined, new Set(), 3, true)!;
    expect(liveTarget(s, scoreGroups(s, 3), target, new Set(), 3)).toEqual(target);
    const two = song(2);
    const t2 = recordTarget(two, scoreGroups(two, 3), "t1", undefined, new Set(), 3, true)!;
    const gone: Song = { ...two, tracks: two.tracks.filter((t) => t.id !== "t1") };
    const live = liveTarget(gone, scoreGroups(gone, 3), t2, new Set(), 3);
    expect(live.trackIds).toEqual([]);
    expect(live.room).toBe(1);
  });
});

describe("바꿔 녹음", () => {
  const n = (id: string, start: Rat, dur: Rat, pitch = 50, tie: "none" | "next" = "none"): Note => ({ id, start, dur, pitch, vol: 9, tie });

  it("비울 구간은 친 음의 첫 마디 시작부터 마지막 마디 끝까지 (마디선에서 끝나면 그 마디는 빼고)", () => {
    const ts = song(1).timeSig;
    const [a, b] = replaceRange(ts, [tn(60, r(5, 4), r(1, 4)), tn(62, r(9, 4), r(1, 4))])!;
    expect(same(a, r(1)) && same(b, r(3))).toBe(true);
    const [c, d] = replaceRange(ts, [tn(60, r(1, 2), r(1, 2))])!;
    expect(same(c, r(0)) && same(d, r(1))).toBe(true);
    expect(replaceRange(ts, [])).toBeUndefined();
  });

  it("구간에 걸친 & 사슬은 구간 앞·뒤 조각만 남기고, 앞에서 들어온 사슬은 구간 시작에서 &를 푼다", () => {
    const notes = [n("a", r(1, 2), r(1, 2), 50, "next"), n("b", r(1), r(1, 2)), n("c", r(3, 2), r(1, 2), 52, "next"), n("d", r(2), r(1, 2), 52), n("e", r(3), r(1, 4))];
    const out = clearRange(notes, r(1), r(2));
    expect(out.notes.map((x) => x.id)).toEqual(["a", "d", "e"]);
    expect(out.notes[0]!.tie).toBe("none");
    expect(out.cleared.map((x) => x.id)).toEqual(["b", "c"]);
    // 앞에서 시작해 구간 안으로 들어온 음은 잘린다
    const cut = clearRange([n("x", r(1, 2), r(1))], r(1), r(2));
    expect(same(cut.notes[0]!.dur, r(1, 2))).toBe(true);
    expect(cut.cleared.map((x) => x.id)).toEqual(["x"]);
  });

  it("v8c1&c1&c1에서 2마디만 바꿔 녹음해도 3마디 c1은 남는다 (구간 뒤 사슬 조각)", () => {
    const s = song(1, { 0: [n("c1", r(0), r(1), 60, "next"), n("c2", r(1), r(1), 60, "next"), n("c3", r(2), r(1), 60)] });
    const out = placeTake(s, [tn(62, r(1), r(1, 4))], { mode: "replace", armed: new Set(["t0"]) });
    const t0 = out.changes.find((c) => c.trackId === "t0")!.notes;
    expect(t0.map((x) => [x.pitch, x.start.n / x.start.d, x.tie])).toEqual([[60, 0, "none"], [62, 1, "none"], [60, 2, "none"]]);
    // 한 음이 구간 앞뒤로 걸치면 앞뒤 두 조각
    const long = clearRange([n("w", r(1, 2), r(2), 60)], r(1), r(2));
    expect(long.notes.map((x) => [x.id, x.start.n / x.start.d, x.dur.n / x.dur.d])).toEqual([["w", 0.5, 0.5], ["w.after", 2, 0.5]]);
    expect(long.cleared.map((x) => x.id)).toEqual(["w"]);
  });

  it("친 마디의 녹음할 트랙 음을 비우고 넣는다. 다른 마디·고르지 않은 트랙은 그대로", () => {
    const s = song(2, { 0: [n("old1", r(0), r(1, 4)), n("old2", r(1), r(1, 4)), n("old3", r(2), r(1, 4))], 1: [n("keep", r(1), r(1, 4))] });
    const out = placeTake(s, [tn(60, r(5, 4), r(1, 4))], { mode: "replace", armed: new Set(["t0"]) });
    const t0 = out.changes.find((c) => c.trackId === "t0")!.notes;
    expect(t0.map((x) => x.id.startsWith("old") ? x.id : x.pitch)).toEqual(["old1", 60, "old3"]);
    expect(out.changes.find((c) => c.trackId === "t1")).toBeUndefined();
    expect(out.assign.cleared.map((c) => c.note.id)).toEqual(["old2"]);
  });

  it("덧녹음이면 같은 곳의 음을 지우지 않는다", () => {
    const s = song(1, { 0: [n("old", r(1), r(1, 4))] });
    const out = placeTake(s, [tn(60, r(1), r(1, 4))], { mode: "overdub", addTracks: false });
    expect(out.changes).toEqual([]);
    expect(out.dropped).toBe(1);
  });
});

describe("미리 보기 = 넣는 것", () => {
  it("미리 보기 음(넣을 것·빠질 것·비울 것)이 넣는 바꿈과 같다", () => {
    const old: Note = { id: "o", start: r(0), dur: r(1, 4), pitch: 40, vol: 9, tie: "none" };
    const s = song(1, { 0: [old] });
    const take = [60, 64, 67, 72].map((p) => tn(p, r(0), r(1, 4)));
    const out = placeTake(s, take, { mode: "replace" });
    const ghosts = takeGhosts(out.assign, new Map([["t0", "#123456"]]));
    const placed = ghosts.filter((g) => g.kind === "placed");
    const committed = [...out.changes.flatMap((c) => c.notes), ...out.newTracks.flat()];
    expect(placed.map((g) => g.pitch).sort()).toEqual(committed.map((x) => x.pitch).sort());
    expect(placed.find((g) => g.pitch === 72)!.color).toBe("#123456");
    expect(ghosts.filter((g) => g.kind === "dropped").map((g) => g.pitch)).toEqual([60]);
    expect(ghosts.filter((g) => g.kind === "cleared").map((g) => g.pitch)).toEqual([40]);
  });
});

describe("예비박·메트로놈", () => {
  it("4/4 t120: 녹음 시작 앞 한 마디에 박 넷, 첫 박이 accent, 길이 2초", async () => {
    const { countIn, beatClicks } = await import("../src/lib/midiRecord");
    const s = { ...song(1), tempo: [{ at: r(0), bpm: 120 }] };
    const c = countIn(s, r(1));
    expect(c.seconds).toBeCloseTo(2);
    expect(c.clicks.map((k) => k.at)).toEqual([0, 0.5, 1, 1.5]);
    expect(c.clicks.map((k) => k.accent)).toEqual([true, false, false, false]);
    const b = beatClicks(s, 1, 2);
    expect(b.map((k) => k.at)).toEqual([2, 2.5, 3, 3.5]);
    expect(b[0]!.accent).toBe(true);
  });

  it("6/8은 점4분 박 둘", async () => {
    const { countIn } = await import("../src/lib/midiRecord");
    const s = { ...song(1), tempo: [{ at: r(0), bpm: 120 }], timeSig: [{ at: r(0), beats: 6, unit: 8 }] };
    expect(countIn(s, r(0)).clicks).toHaveLength(2);
  });
});

describe("녹음 모으기", () => {
  it("예비박을 예약하고, 누른 시각을 곡 위치로, 끝낼 때 누르고 있던 건반은 그때 시각에 뗀 것으로", async () => {
    const { MidiRecorder } = await import("../src/lib/midiRecord");
    let now: number | undefined = 1.5;
    const clicks: number[] = [];
    const rec = new MidiRecorder({ heardSeconds: () => now, click: (at) => clicks.push(at) });
    const statuses: (number | undefined)[] = [];
    rec.onstatus = (s) => statuses.push(s?.count);
    const s = { ...song(1), tempo: [{ at: r(0), bpm: 120 }] };
    rec.begin(s, r(1), 7, true);
    // 예비박 넷 (0, 0.5, 1, 1.5초) 뒤 메트로놈을 앞서 예약
    expect(clicks.slice(0, 4)).toEqual([0, 0.5, 1, 1.5]);
    now = 1.98; // 조금 일찍 누름
    rec.keyOn(60, 100);
    now = 2.5;
    rec.keyOff(60);
    rec.keyOn(64, 90);
    now = 3.1;
    const take = rec.end()!;
    expect(rec.recording).toBe(false);
    expect(take.keys.map((k) => k.pitch)).toEqual([60, 64]);
    expect(take.keys[0]!.on).toBeCloseTo(0.99);
    expect(take.keys[1]!.off).toBeCloseTo(1.55); // 끝낼 때 들리던 3.1초 (마지막 표본 2.5초가 아니라, R-03)
    expect(statuses).toEqual([0, 1, 2, undefined]);
    const notes = quantizeTake(take.keys, G, take.from);
    expect(same(notes[0]!.start, r(1)) && same(notes[0]!.dur, r(1, 4))).toBe(true);
  });

  it("치는 동안 live()로 뗀 건반과 누르고 있는 건반(지금 들리는 시각까지)을 보인다", async () => {
    const { MidiRecorder } = await import("../src/lib/midiRecord");
    let now: number | undefined = 2;
    const rec = new MidiRecorder({ heardSeconds: () => now, click: () => {} });
    let lives = 0;
    rec.onlive = () => lives++;
    const s = { ...song(1), tempo: [{ at: r(0), bpm: 120 }] };
    expect(rec.live()).toBeUndefined();
    rec.begin(s, r(1), 1, false);
    rec.keyOn(60, 100);
    rec.keyOn(64, 100); // 화음
    now = 2.5;
    rec.keyOff(60);
    expect(lives).toBe(3);
    const live = rec.live()!;
    expect(live.keys.map((k) => [k.pitch, k.on, k.off])).toEqual([
      [60, 1, 1.25],
      [64, 1, 1.25],
    ]);
    rec.end();
    expect(rec.live()).toBeUndefined();
  });
});

describe("녹음 흐름 (GPT 점검 R-01·R-02·R-03)", () => {
  async function setup() {
    const { MidiRecorder, RecordFlow } = await import("../src/lib/midiRecord");
    let now: number | undefined = 0;
    const rec = new MidiRecorder({ heardSeconds: () => now, click: () => {} });
    const state = { owner: "A" as string | undefined, open: true, capture: false, stops: 0, applied: [] as { owner: string; pitches: number[] }[], lost: 0 };
    let release: (run: number | undefined) => void = () => {};
    const flow = new RecordFlow<string>(rec, {
      owner: () => state.owner,
      open: () => state.open,
      play: () => new Promise((r) => (release = r)),
      stop: () => {
        state.stops++;
        // 엔진이 멈추기 직전 들리던 자리를 알린다
        if (now !== undefined) rec.cut(now);
        now = undefined;
      },
      capture: (on) => (state.capture = on),
      apply: (take, job) => state.applied.push({ owner: job.owner, pitches: take.keys.map((k) => k.pitch) }),
      lost: () => state.lost++,
    });
    const s = { ...song(1), tempo: [{ at: r(0), bpm: 120 }] };
    return { rec, flow, state, s, setNow: (t: number | undefined) => (now = t), resolve: (run: number | undefined) => release(run) };
  }

  it("R-02: 준비 중에 줄을 닫으면 준비가 끝나도 녹음을 시작하지 않는다", async () => {
    const { rec, flow, state, s, resolve } = await setup();
    const started = flow.start("t0", s, r(0), false);
    expect(state.capture).toBe(true);
    state.open = false;
    flow.end();
    resolve(3);
    expect(await started).toBe(false);
    expect(rec.recording).toBe(false);
    expect(state.capture).toBe(false);
  });

  it("R-02: 준비 중에 실험실이 꺼졌으면(닫기 없이) 시작하지 않고 재생을 멈춘다", async () => {
    const { rec, flow, state, s, resolve } = await setup();
    const started = flow.start("t0", s, r(0), false);
    state.open = false;
    resolve(3);
    expect(await started).toBe(false);
    expect(rec.recording).toBe(false);
    expect(state.stops).toBe(1);
  });

  it("R-01: 곡을 바꾸기 전에 끝내면 앞 곡에 넣고, 바뀐 뒤 끝나면 새 곡에 넣지 않는다", async () => {
    const a = await setup();
    const p = a.flow.start("t0", a.s, r(0), false);
    a.resolve(1);
    await p;
    a.setNow(0.5);
    a.rec.keyOn(60, 100);
    a.setNow(1);
    a.rec.keyOff(60);
    // openSong: 바꾸기 전에 끝낸다
    a.flow.end();
    a.state.owner = "B";
    expect(a.state.applied).toEqual([{ owner: "A", pitches: [60] }]);

    const b = await setup();
    const q = b.flow.start("t0", b.s, r(0), false);
    b.resolve(1);
    await q;
    b.setNow(0.5);
    b.rec.keyOn(60, 100);
    b.rec.keyOff(60);
    b.state.owner = "B"; // 끝내기 전에 곡이 바뀜
    b.flow.finish();
    expect(b.state.applied).toEqual([]);
    expect(b.state.lost).toBe(1);
  });

  it("R-03: 누른 채 멈추면 멈춘 그 순간에 뗀 것으로 (마지막 100ms 표본이 아니라)", async () => {
    const { rec, flow, s, setNow, resolve, state } = await setup();
    const p = flow.start("t0", s, r(0), false);
    resolve(1);
    await p;
    setNow(0);
    rec.keyOn(60, 100);
    setNow(0.19); // 다음 표본(0.2초) 전에 멈춤
    let take: TakeNote[] = [];
    const flowApply = state.applied;
    flow.end();
    expect(flowApply).toHaveLength(1);
    // 같은 시계로 직접: cut 시각 0.19초 → t120 16분 격자에서 1/8
    const { MidiRecorder } = await import("../src/lib/midiRecord");
    let now: number | undefined = 0;
    const solo = new MidiRecorder({ heardSeconds: () => now, click: () => {} });
    solo.begin(s, r(0), 1, false);
    solo.keyOn(60, 100);
    now = 0.19;
    solo.cut(0.19);
    now = 5; // 멈춘 뒤 다른 재생의 시각은 쓰지 않는다
    take = quantizeTake(solo.end()!.keys, G, r(0));
    expect(same(take[0]!.dur, r(1, 8))).toBe(true);
  });
});

describe("스텝 입력 커서 (R-04)", () => {
  it("타브 보기면 타브 커서, 아니면 편집 커서를 쓴다", async () => {
    const { stepCursorFor } = await import("../src/lib/midiInput");
    expect(same(stepCursorFor("tab", r(1), r(0))!, r(1))).toBe(true);
    expect(same(stepCursorFor("roll", r(1), r(0))!, r(0))).toBe(true);
    expect(stepCursorFor("tab", undefined, r(0))).toBeUndefined();
  });
});
