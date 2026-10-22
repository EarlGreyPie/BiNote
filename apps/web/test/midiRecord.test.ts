import { describe, expect, it } from "vitest";
import { cmp, emptySong, rat, type Note, type Rat, type Song } from "@mmlce/core";
import { placeTake, quantizeTake, type TakeNote } from "../src/lib/midiRecord";
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
    const out = placeTake(s, scoreGroups(s, 3), "t0", take, G, vol, 3);
    expect(out.newTracks).toHaveLength(0);
    const notes = out.changes[0]!.notes;
    expect(notes.map((n) => n.pitch)).toEqual([60, 62]);
    expect(same(notes[0]!.dur, r(1, 4))).toBe(true);
  });

  it("화음은 높은 음부터 트랙을 나누고, 모자라면 한도까지 트랙을 더하고 넘치면 센다", () => {
    const s = song(1);
    const take = [60, 64, 67, 72].map((p) => tn(p, r(0), r(1, 4)));
    const out = placeTake(s, scoreGroups(s, 3), "t0", take, G, vol, 3);
    expect(out.changes[0]!.notes.map((n) => n.pitch)).toEqual([72]);
    expect(out.newTracks.map((t) => t.map((n) => n.pitch))).toEqual([[67], [64]]);
    expect(out.dropped).toBe(1);
  });

  it("길게 누른 화음 위 선율: 선율은 고른 트랙, 받친 음은 다음 트랙", () => {
    const s = song(2);
    const take = [tn(48, r(0), r(1)), tn(72, r(0), r(1, 4)), tn(74, r(1, 4), r(1, 4)), tn(76, r(1, 2), r(1, 2))];
    const out = placeTake(s, scoreGroups(s, 3), "t0", take, G, vol, 3);
    expect(out.changes.find((c) => c.trackId === "t0")!.notes.map((n) => n.pitch)).toEqual([72, 74, 76]);
    expect(out.changes.find((c) => c.trackId === "t1")!.notes.map((n) => n.pitch)).toEqual([48]);
  });

  it("곡에 있던 음은 지우지 않고 그 자리는 다음 트랙에 (덧녹음)", () => {
    const old: Note = { id: "x", start: r(0), dur: r(1, 2), pitch: 50, vol: 9, tie: "none" };
    const s = song(2, { 0: [old] });
    const out = placeTake(s, scoreGroups(s, 3), "t0", [tn(60, r(0), r(1, 4)), tn(62, r(1, 2), r(1, 4))], G, vol, 3);
    const t0 = out.changes.find((c) => c.trackId === "t0")!.notes;
    expect(t0.map((n) => n.pitch)).toEqual([50, 62]);
    expect(out.changes.find((c) => c.trackId === "t1")!.notes.map((n) => n.pitch)).toEqual([60]);
  });

  it("잠긴 트랙은 건너뛴다", () => {
    const s = song(3);
    const out = placeTake(s, scoreGroups(s, 3), "t0", [tn(60, r(0), r(1, 4)), tn(64, r(0), r(1, 4))], G, vol, 3, new Set(["t1"]));
    expect(out.changes.map((c) => c.trackId)).toEqual(["t0", "t2"]);
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
