import { describe, expect, it } from "vitest";
import { add, cmp, History, MOBILE_PROFILE, normalizeTempo, rat, tempoClock, toFloat, type Note, type Rat, type Song, type TempoEvent } from "@mmlce/core";
import { addTrack, gameScores, newSong, setTempos } from "@mmlce/mml";
import { attackPositions, matchOnsets } from "../src/lib/noteOnsets";
import { applyTempoPlan, maxOnsetShift, snapTemposToOnsets, tempoPlanBetween, temposIn, tidyTempos } from "../src/lib/tempoSnap";
import { onsetNear, tapTempos } from "../src/lib/tempoSync";
import type { Peaks } from "../src/lib/waveform";

const note = (id: string, start: Rat, dur: Rat, pitch = 60, tie: Note["tie"] = "none"): Note => ({ id, start, dur, pitch, vol: 8, tie });
/** 8분음표 n개 (0부터) */
const eighths = (n: number, from = 0): Note[] => Array.from({ length: n }, (_, i) => note(`n${i}`, rat(from * 8 + i, 8), rat(1, 8), 60 + (i % 5)));
/** 정해진 시각 목록 가운데 window 안 가장 가까운 것 (합성 원곡) */
const nearest = (onsets: readonly number[], window: number) => (time: number) => {
  let best: number | undefined;
  for (const o of onsets) if (Math.abs(o - time) <= window && (best === undefined || Math.abs(o - time) < Math.abs(best - time))) best = o;
  return best;
};
/** 고정된 의사 난수 (시험마다 같은 값) */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const range = MOBILE_PROFILE.tempo;

describe("원곡 음 시작 찾기 (다시 쓰는 모듈)", () => {
  it("& 로 이어 받은 음은 소리 시작이 아니고, 같은 자리 화음은 하나로 센다", () => {
    const tracks = [
      { notes: [note("a", rat(0), rat(1, 4), 60, "next"), note("b", rat(1, 4), rat(1, 4), 60), note("c", rat(1, 2), rat(1, 4), 62)] },
      { notes: [note("d", rat(1, 2), rat(1, 4), 67), note("e", rat(3, 4), rat(1, 4), 64)] },
    ];
    expect(attackPositions(tracks, rat(0), rat(1))).toEqual([rat(0), rat(1, 2), rat(3, 4)]);
    // 구간 [1/4, 3/4)
    expect(attackPositions(tracks, rat(1, 4), rat(3, 4))).toEqual([rat(1, 2)]);
  });

  it("못 찾은 음과 앞뒤 순서를 넘는 결과는 버린다", () => {
    const tempo = [{ at: rat(0), bpm: 120 }];
    // 8분음표 = 0.25초. 0.25 자리는 원곡 없음, 0.5 자리는 0.53, 0.75 자리는 앞 음(0.53)과 같은 자리로 잘못 잡힘
    const onsets = (time: number) => (time === 0.5 ? 0.53 : time === 0.75 ? 0.535 : undefined);
    const m = matchOnsets(tempo, [rat(1, 8), rat(2, 8), rat(3, 8)], onsets, { lower: 0, upper: 1 });
    expect(m.map((x) => x.found)).toEqual([undefined, 0.53, undefined]);
    expect(m.map((x) => x.seconds)).toEqual([0.25, 0.5, 0.75]);
  });

  it("파형(onsetNear)으로 찾기", () => {
    const n = 800;
    const min = new Float32Array(n);
    const max = new Float32Array(n);
    const onsets = [0.52, 1.04, 1.47];
    for (let k = 0; k < n; k++) {
      let v = 0.01;
      for (const o of onsets) if (k / 200 >= o) v = Math.max(v, 0.8 * Math.exp(-(k / 200 - o) * 8));
      max[k] = v;
      min[k] = -v;
    }
    const peaks: Peaks = { perSecond: 200, min, max, peak: 0.8 };
    const m = matchOnsets([{ at: rat(0), bpm: 120 }], [rat(1, 4), rat(2, 4), rat(3, 4)], (t) => onsetNear(peaks, t, 0.06), { lower: 0, upper: 2 });
    expect(m.map((x) => x.found)).toEqual([expect.closeTo(0.52, 2), expect.closeTo(1.04, 2), expect.closeTo(1.47, 2)]);
  });
});

describe("음 시작에 템포 넣기", () => {
  // t120 8분음표 16개 (4/4 두 마디, 0.25초 간격). 원곡은 음마다 ±45ms 흔들림
  const notes = eighths(16);
  const tracks = [{ notes }];
  const tempo: TempoEvent[] = [{ at: rat(0), bpm: 120 }];
  const rnd = random(7);
  const jitter = notes.map((_, i) => (i === 0 ? 0 : (rnd() - 0.5) * 0.09));
  const reference = notes.map((n, i) => toFloat(n.start) * 2 + jitter[i]!);

  it("찾은 음은 원곡 시각에 맞고, 반올림 오차만 남는다", () => {
    const r = snapTemposToOnsets(tempo, tracks, [[rat(0), rat(2)]], nearest(reference, 0.06), { range });
    expect(r.total).toBe(15);
    expect(r.found).toBe(15);
    const clock = tempoClock(applyTempoPlan(tempo, r.plan));
    notes.forEach((n, i) => expect(Math.abs(clock(n.start) - reference[i]!)).toBeLessThan(0.006));
    expect(r.meanShift).toBeGreaterThan(0.01);
  });

  it("합치기 허용 오차를 주면 템포가 줄고 모든 음이 오차 안이다", () => {
    const loose = snapTemposToOnsets(tempo, tracks, [[rat(0), rat(2)]], nearest(reference, 0.06), { slack: 0.02, range });
    const tight = snapTemposToOnsets(tempo, tracks, [[rat(0), rat(2)]], nearest(reference, 0.06), { range });
    const count = (p: typeof loose.plan) => applyTempoPlan(tempo, p).length;
    expect(count(loose.plan)).toBeLessThan(count(tight.plan));
    const clock = tempoClock(applyTempoPlan(tempo, loose.plan));
    notes.forEach((n, i) => expect(Math.abs(clock(n.start) - reference[i]!)).toBeLessThan(0.02 + 0.006));
  });

  it("창 밖 음은 건너뛰고, 구간 밖 음은 반올림 오차 밖으로 움직이지 않는다", () => {
    // 4분음표 한 마디 뒤에 두 마디: 구간 = 2마디(온음표 1-2)만. 원곡은 5번째 음만 창 밖(+150ms)
    const all = eighths(24);
    const ref = all.map((n, i) => toFloat(n.start) * 2 + (i === 12 ? 0.15 : i % 2 ? 0.03 : -0.02));
    const r = snapTemposToOnsets(tempo, [{ notes: all }], [[rat(1), rat(2)]], nearest(ref, 0.06), { range });
    expect(r.total).toBe(7);
    expect(r.found).toBe(6);
    const before = tempoClock(tempo);
    const after = tempoClock(applyTempoPlan(tempo, r.plan));
    for (const n of all) if (cmp(n.start, rat(1)) <= 0) expect(after(n.start)).toBe(before(n.start));
    for (const n of all) if (cmp(n.start, rat(2)) >= 0) expect(Math.abs(after(n.start) - before(n.start))).toBeLessThan(0.006);
    // 구간 끝에서 원래 템포(t120)로 돌아간다
    expect(normalizeTempo(applyTempoPlan(tempo, r.plan)).find((e) => cmp(e.at, rat(2)) === 0)?.bpm).toBe(120);
  });

  it("구간이 마디 가운데서 시작하고 5/4·1/4 마디가 있어도 위치(온음표)로 맞춘다", () => {
    const all = eighths(20);
    const ref = all.map((n, i) => toFloat(n.start) * 2 + (i % 3 === 0 ? 0.04 : -0.03));
    const from = rat(3, 8);
    const to = rat(17, 8);
    const r = snapTemposToOnsets(tempo, [{ notes: all }], [[from, to]], nearest(ref, 0.06), { range });
    const after = tempoClock(applyTempoPlan(tempo, r.plan));
    all.forEach((n, i) => {
      if (cmp(n.start, from) > 0 && cmp(n.start, to) < 0) expect(Math.abs(after(n.start) - ref[i]!)).toBeLessThan(0.006);
    });
  });

  it("범위 밖 템포가 나오는 음은 표시에서 빼고(못 맞춘 음), 끝값 템포는 만들지 않는다", () => {
    // 6번째 음(i=5)이 원곡에서 뒤 음 25ms 앞에 있다 (8분음표 25ms → t600)
    const ref = notes.map((n) => toFloat(n.start) * 2);
    ref[5] = ref[6]! - 0.025;
    const r = snapTemposToOnsets(tempo, tracks, [[rat(0), rat(2)]], nearest(ref, 0.3), { range });
    const after = applyTempoPlan(tempo, r.plan);
    for (const e of after) expect(e.bpm >= range.min && e.bpm <= range.max).toBe(true);
    expect(r.outOfRange.length).toBeGreaterThan(0);
    // 찾은 음 + 못 맞춘 음 = 원곡 시작점을 찾은 음 (못 찾은 음 없음)
    expect(r.found + r.outOfRange.length).toBe(r.total);
    // 남은 음은 원곡 시각에 맞는다
    const clock = tempoClock(after);
    notes.forEach((n, i) => {
      if (i > 0 && !r.outOfRange.some((at) => cmp(at, n.start) === 0)) expect(Math.abs(clock(n.start) - ref[i]!)).toBeLessThan(0.006);
    });
  });

  it("빼다가 표시가 고정점 둘만 남으면 그 구간은 그대로 둔다 (되풀이가 끝난다)", () => {
    // 구간 끝(1/4 자리)을 넘지 못할 만큼 원곡이 늦다: 한 음뿐이고 그 음과 구간 끝 사이가 범위 밖
    const two = [{ notes: [note("a", rat(0), rat(1, 8)), note("b", rat(1, 8), rat(1, 8)), note("c", rat(1, 4), rat(1, 4))] }];
    const r = snapTemposToOnsets(tempo, two, [[rat(0), rat(1, 4)]], () => 0.48, { range });
    expect(r.found).toBe(0);
    expect(r.outOfRange).toEqual([rat(1, 8)]);
    expect(r.plan).toEqual({ set: [], remove: [] });
  });

  it("무작위로 튀는 원곡: 범위 밖 템포가 없고, 못 맞춘 음 수가 미리보기 수와 맞는다", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rnd = random(seed);
      const all = eighths(32);
      // 두세 음마다 아주 붙거나 멀리 떨어진 꾸밈음 같은 자리
      const ref = all.map((n, i) => toFloat(n.start) * 2 + (i && rnd() < 0.3 ? (rnd() - 0.5) * 0.4 : (rnd() - 0.5) * 0.06));
      for (let i = 1; i < ref.length; i++) if (ref[i]! <= ref[i - 1]! + 0.02) ref[i] = ref[i - 1]! + 0.02;
      for (const slack of [0, 0.02]) {
        const r = snapTemposToOnsets(tempo, [{ notes: all }], [[rat(0), undefined]], nearest(ref, 0.25), { slack, range });
        for (const e of applyTempoPlan(tempo, r.plan)) expect(e.bpm >= range.min && e.bpm <= range.max).toBe(true);
        expect(new Set(r.outOfRange.map((at) => toFloat(at))).size).toBe(r.outOfRange.length);
        expect(r.found + r.outOfRange.length).toBeLessThanOrEqual(r.total);
      }
    }
  });

  it("원곡 시작점을 하나도 못 찾으면 아무것도 바꾸지 않는다", () => {
    const r = snapTemposToOnsets(tempo, tracks, [[rat(0), undefined]], () => undefined, { range });
    expect(r.found).toBe(0);
    expect(r.plan.set).toEqual([]);
    expect(r.plan.remove).toEqual([]);
  });

  it("곡 끝까지면 곡 끝에 원래 템포를 새로 넣지 않는다", () => {
    const ref = notes.map((n, i) => toFloat(n.start) * 2 + (i ? 0.02 : 0));
    const r = snapTemposToOnsets(tempo, tracks, [[rat(0), undefined]], nearest(ref, 0.06), { range });
    expect(applyTempoPlan(tempo, r.plan).some((e) => cmp(e.at, rat(2)) >= 0)).toBe(false);
  });
});

describe("템포 정리 (허용 오차로 합치기)", () => {
  /** 음 시작마다 템포를 넣은 곡 (EarlGreyPie의 작업처럼): 8분음표마다 t100-140 사이 */
  function patched(seed: number, count: number) {
    const rnd = random(seed);
    const notes = eighths(count);
    const tempo: TempoEvent[] = notes.filter(() => rnd() < 0.7).map((n) => ({ at: n.start, bpm: Math.round(100 + rnd() * 40) }));
    if (tempo[0] && cmp(tempo[0].at, rat(0)) !== 0) tempo.unshift({ at: rat(0), bpm: 120 });
    return { tracks: [{ notes }], tempo, notes };
  }
  /** 지킬 자리: 음 시작과 끝, 템포 자리 */
  const keys = (notes: readonly Note[], tempo: readonly TempoEvent[]) => [...notes.flatMap((n) => [n.start, add(n.start, n.dur)]), ...tempo.map((e) => e.at)];

  it("무작위 곡: 합친 뒤 모든 지킬 자리가 허용 오차 안이고, 템포는 원래 자리에만 남는다", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { tracks, tempo, notes } = patched(seed, 48);
      for (const tolerance of [0.005, 0.01, 0.02, 0.03]) {
        const plan = tidyTempos(tempo, tracks, [[rat(0), undefined]], tolerance, range);
        const after = applyTempoPlan(tempo, plan);
        expect(after.length).toBeLessThanOrEqual(normalizeTempo(tempo).length);
        for (const e of after) expect(tempo.some((x) => cmp(x.at, e.at) === 0)).toBe(true);
        const a = tempoClock(tempo);
        const b = tempoClock(after);
        for (const at of keys(notes, tempo)) expect(Math.abs(a(at) - b(at))).toBeLessThanOrEqual(tolerance + 1e-6);
      }
    }
  });

  it("허용 오차가 클수록 템포가 줄어든다", () => {
    const { tracks, tempo } = patched(3, 64);
    const counts = [0.005, 0.01, 0.02, 0.03].map((tol) => applyTempoPlan(tempo, tidyTempos(tempo, tracks, [[rat(0), undefined]], tol, range)).length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!);
    expect(counts.at(-1)!).toBeLessThan(normalizeTempo(tempo).length);
  });

  it("고른 구간 밖 템포는 그대로, 구간 밖 음은 마지막 묶음 반올림 오차 안에서만 움직인다", () => {
    const { tracks, tempo, notes } = patched(11, 48);
    const from = rat(9, 8);
    const to = rat(4);
    const plan = tidyTempos(tempo, tracks, [[from, to]], 0.02, range);
    const after = applyTempoPlan(tempo, plan);
    for (const e of normalizeTempo(tempo)) if (cmp(e.at, from) < 0 || cmp(e.at, to) > 0) expect(after).toContainEqual(e);
    const a = tempoClock(tempo);
    const b = tempoClock(after);
    for (const n of notes) {
      if (cmp(n.start, from) <= 0) expect(b(n.start)).toBe(a(n.start));
      else expect(Math.abs(b(n.start) - a(n.start))).toBeLessThanOrEqual(0.02 + 1e-6);
    }
  });

  it("범위 밖 템포로는 합치지 않는다", () => {
    const notes = eighths(8);
    // 아주 빠른 두 조각 (합치면 t256 넘음)
    const tempo = [
      { at: rat(0), bpm: 250 },
      { at: rat(1, 8), bpm: 260 },
    ];
    const plan = tidyTempos(tempo, [{ notes }], [[rat(0), undefined]], 0.03, range);
    for (const e of applyTempoPlan(tempo, plan)) expect(e.bpm === 260 || e.bpm <= range.max).toBe(true);
  });

  it("붙임줄 사슬: 이어 받은 음의 끝도 지킬 자리다", () => {
    const notes = [note("a", rat(0), rat(3, 8), 60, "next"), note("b", rat(3, 8), rat(5, 8), 60)];
    const tempo = [
      { at: rat(0), bpm: 120 },
      { at: rat(1, 8), bpm: 60 },
      { at: rat(3, 8), bpm: 125 },
      { at: rat(1, 2), bpm: 118 },
    ];
    const plan = tidyTempos(tempo, [{ notes }], [[rat(0), undefined]], 0.02, range);
    const a = tempoClock(tempo);
    const b = tempoClock(applyTempoPlan(tempo, plan));
    for (const at of [rat(3, 8), rat(1)]) expect(Math.abs(a(at) - b(at))).toBeLessThanOrEqual(0.02 + 1e-6);
  });

  it("고칠 템포가 없으면 빈 계획", () => {
    const plan = tidyTempos([{ at: rat(0), bpm: 120 }], [{ notes: eighths(8) }], [[rat(0), undefined]], 0.02, range);
    expect(plan).toEqual({ set: [], remove: [] });
  });
});

describe("곡에 넣기 (실행 취소 한 칸, 게임 출력)", () => {
  function songOf(notes: Note[], tempo: TempoEvent[]): Song {
    const s = addTrack("p1", "트랙 2").apply(newSong({ playerName: "기타", trackName: "트랙 1" }));
    const base = { ...s, tracks: s.tracks.map((tr) => ({ ...tr, notes: tr.id === "t1" ? notes : [] })) };
    return setTempos(tempo, [], "준비").apply(base);
  }

  it("템포 정리는 실행 취소 한 번에 돌아가고, 게임 출력이 옮겨 쓰는 템포가 늘지 않는다", () => {
    const rnd = random(5);
    const notes = eighths(32);
    const tempo = notes.filter(() => rnd() < 0.6).map((n) => ({ at: n.start, bpm: Math.round(100 + rnd() * 40) }));
    tempo.unshift({ at: rat(0), bpm: 120 });
    const s = songOf(notes, tempo);
    const h = new History(s);
    const plan = tidyTempos(s.tempo, s.tracks, [[rat(0), undefined]], 0.02, range);
    h.run(setTempos(plan.set, plan.remove, "템포 정리"));
    expect(h.song.tempo.length).toBeLessThan(s.tempo.length);
    const moved = (song: Song) => gameScores(song, MOBILE_PROFILE.maxChordsPerPlayer).reduce((sum, x) => sum + x.moved.length, 0);
    expect(moved(h.song)).toBeLessThanOrEqual(moved(s));
    expect(maxOnsetShift(s.tracks, s.tempo, h.song.tempo)).toBeLessThanOrEqual(0.02 + 1e-6);
    h.undo();
    expect(h.song).toBe(s);
  });

  it("음 시작에 템포 넣기도 실행 취소 한 번에 돌아간다", () => {
    const notes = eighths(16);
    const s = songOf(notes, [{ at: rat(0), bpm: 120 }]);
    const ref = notes.map((n, i) => toFloat(n.start) * 2 + (i ? (i % 2 ? 0.03 : -0.02) : 0));
    const r = snapTemposToOnsets(s.tempo, s.tracks, [[rat(0), undefined]], nearest(ref, 0.06), { range });
    const h = new History(s);
    h.run(setTempos(r.plan.set, r.plan.remove, "음 시작에 템포 넣기"));
    expect(temposIn(h.song.tempo, rat(0), undefined)).toBeGreaterThan(1);
    const clock = tempoClock(h.song.tempo);
    notes.forEach((n, i) => expect(Math.abs(clock(n.start) - ref[i]!)).toBeLessThan(0.006));
    h.undo();
    expect(h.song).toBe(s);
  });
});

describe("계획 도우미", () => {
  it("차이 계획을 넣으면 같은 지도가 된다", () => {
    const a = [{ at: rat(0), bpm: 120 }, { at: rat(1), bpm: 90 }, { at: rat(2), bpm: 100 }];
    const b = [{ at: rat(0), bpm: 120 }, { at: rat(3, 2), bpm: 80 }, { at: rat(2), bpm: 101 }];
    expect(applyTempoPlan(a, tempoPlanBetween(a, b))).toEqual(b);
  });

  it("탭 템포는 바깥 함수로 옮긴 뒤에도 같은 결과", () => {
    const plan = tapTempos([{ at: rat(0), bpm: 120 }], [], rat(0), [0, 2.1, 4.0, 6.2], { slack: 0 })!;
    expect(plan.set.map((e) => e.bpm)).toEqual([114, 127, 109, 120]);
  });
});
