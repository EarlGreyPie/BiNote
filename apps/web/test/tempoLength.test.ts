import { describe, expect, it } from "vitest";
import { add, cmp, rat, tempoClock, type Note, type Rat, type TempoEvent } from "@mmlce/core";
import { newSong, tempoToLengthsResult } from "@mmlce/mml";
import { respaceAnchors } from "../src/lib/tempoLength";

const note = (id: string, start: Rat, dur: Rat, pitch = 60): Note => ({ id, start, dur, pitch, vol: 8, tie: "none" });
/** 정해진 시각 목록 가운데 window 안 가장 가까운 것 (합성 원곡) */
const nearest = (onsets: readonly number[], window: number) => (time: number) => {
  let best: number | undefined;
  for (const o of onsets) if (Math.abs(o - time) <= window && (best === undefined || Math.abs(o - time) < Math.abs(best - time))) best = o;
  return best;
};
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
/** 16분음표 n개와 음마다 템포 (템포로 때운 빠른 연속음) */
function patched(bpms: readonly number[], tail = 100) {
  const notes = bpms.map((_, i) => note(`n${i}`, rat(i, 16), rat(1, 16), 60 + (i % 7)));
  notes.push(note("tail", rat(bpms.length, 16), rat(1, 4), 72));
  const tempo: TempoEvent[] = bpms.map((bpm, i) => ({ at: rat(i, 16), bpm }));
  tempo.push({ at: rat(bpms.length, 16), bpm: tail });
  const base = newSong({ playerName: "기타", trackName: "기타" });
  // 원문 없이 음만 (출력기가 쓴다)
  return { ...base, tempo, tracks: base.tracks.map(({ mml: _mml, ...t }) => ({ ...t, notes })) };
}

describe("템포를 음 길이로 바꾸기: 원곡 시작점", () => {
  it("찾은 음 시작은 그 시각으로, 못 찾은 음은 앞뒤를 따라간다", () => {
    const song = patched([120, 120, 120, 120, 120, 120, 120, 120]);
    const clock = tempoClock(song.tempo);
    // 원곡: 둘째 음 25ms 늦게, 다섯째 음 20ms 이르게. 일곱째 음은 원곡에 없다
    const notes = song.tracks[0]!.notes;
    const onsets = notes.slice(0, 8).map((n, i) => clock(n.start) + (i === 1 ? 0.025 : i === 4 ? -0.02 : 0)).filter((_, i) => i !== 6);
    const spans = [[rat(0), rat(1, 2)]] as const;
    const found = respaceAnchors(song.tempo, song.tracks, spans, nearest(onsets, 0.06));
    expect(found.total).toBe(7);
    expect(found.found).toBe(6);
    const r = tempoToLengthsResult(song, spans, { scale: "auto", anchors: found.anchors });
    expect(r.failed).toEqual([]);
    const after = tempoClock(r.song.tempo);
    const moved = r.song.tracks[0]!.notes;
    expect(Math.abs(after(moved[1]!.start) - onsets[1]!)).toBeLessThanOrEqual(0.016);
    expect(Math.abs(after(moved[4]!.start) - onsets[4]!)).toBeLessThanOrEqual(0.016);
    expect(r.maxError).toBeLessThanOrEqual(0.016);
  });

  it("무작위 템포로 때운 구간: 음 시작은 허용 오차 안, 트랙 안 음은 겹치지 않고 길이가 0이 아니다", () => {
    let done = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const next = random(seed);
      const bpms = Array.from({ length: 8 + Math.floor(next() * 9) }, () => 50 + Math.floor(next() * 150));
      const song = patched(bpms);
      const before = tempoClock(song.tempo);
      const end = rat(bpms.length, 16);
      const r = tempoToLengthsResult(song, [[rat(0), end]], { grid: "auto" });
      if (r.failed.length > 0) {
        // 거절하면 곡은 그대로
        expect(r.song).toBe(song);
        continue;
      }
      done++;
      const after = tempoClock(r.song.tempo);
      const notes = r.song.tracks[0]!.notes;
      const was = new Map(song.tracks[0]!.notes.map((n) => [n.id, n]));
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i]!;
        expect(n.dur.n).toBeGreaterThan(0);
        if (i > 0) expect(cmp(add(notes[i - 1]!.start, notes[i - 1]!.dur), n.start)).toBeLessThanOrEqual(0);
        if (n.id !== "tail") expect(Math.abs(after(n.start) - before(was.get(n.id)!.start))).toBeLessThanOrEqual(0.015 + 0.012);
      }
      // 구간 뒤 음은 마지막 조각 반올림 오차만큼만
      expect(Math.abs(after(notes.at(-1)!.start) - before(was.get("tail")!.start))).toBeLessThanOrEqual(0.012);
    }
    // 거절은 드물어야 한다 (대부분 바꾼다)
    expect(done).toBeGreaterThanOrEqual(36);
  });
});
