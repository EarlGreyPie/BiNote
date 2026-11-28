import { describe, expect, it } from "vitest";
import { History, MOBILE_PROFILE, normalizeTempo, rat, replaceSong, tempoClock, type Note, type Rat, type Song, type TempoEvent } from "@mmlce/core";
import { addTrack, newSong, setTempos } from "@mmlce/mml";
import { foldDoneText, foldFailedText, foldOffer, foldPlan, maxShiftMoved, planOutOfRange } from "../src/lib/tempoFold";
import { tapMarks, tapTempos } from "../src/lib/tempoSync";

const range = MOBILE_PROFILE.tempo;
const note = (id: string, start: Rat, dur: Rat, pitch = 60): Note => ({ id, start, dur, pitch, vol: 8, tie: "none" });
/** 4분음표 n개 (0부터) */
const quarters = (n: number): Note[] => Array.from({ length: n }, (_, i) => note(`n${i}`, rat(i, 4), rat(1, 4), 60 + (i % 5)));
function songOf(notes: Note[], tempo: TempoEvent[]): Song {
  const s = addTrack("p1", "트랙 2").apply(newSong({ playerName: "기타", trackName: "트랙 1" }));
  // 원문 없이 음만 (편집기에서 찍은 곡)
  const base = { ...s, tracks: s.tracks.map(({ mml: _mml, ...tr }) => ({ ...tr, notes: tr.id === "t1" ? notes : [] })) };
  return setTempos(tempo, [], "준비").apply(base);
}
/** 글 키 그대로 + 값 (문구 확인용) */
const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ""}`;

describe("범위 밖 템포를 길이로 풀기 (탭 템포)", () => {
  // 4/4, t120: 한 마디 2초. 2마디를 0.8초에 찍으면 t300 (범위 밖)
  const s = songOf(quarters(20), [{ at: rat(0), bpm: 120 }]);
  const taps = [0, 2, 2.8, 4.8, 6.8];

  it("끝값으로 막지 않은 계획을 넣고 범위 밖 마디만 길이를 반으로 푼다. 탭 자리 시각은 그대로", () => {
    const raw = tapTempos(s.tempo, s.timeSig, rat(0), taps)!;
    expect(planOutOfRange(raw, range)).toBe(true);
    const r = foldPlan(s, raw, range);
    expect(r.failed).toEqual([]);
    expect(r.folded).toEqual([{ at: rat(1), bpm: 300, scale: rat(1, 2), to: 150 }]);
    expect(normalizeTempo(r.song.tempo).every((e) => e.bpm >= range.min && e.bpm <= range.max)).toBe(true);
    // 2마디가 4/8이 되고 그 뒤는 반 마디 당겨진다
    expect(r.song.timeSig.map((e) => [e.at, e.beats, e.unit])).toContainEqual([rat(1), 4, 8]);
    const clock = tempoClock(r.song.tempo);
    const marks = tapMarks(s.timeSig, rat(0), taps.length, "bar");
    marks.forEach((m, k) => expect(clock(r.move(m))).toBeCloseTo(taps[k]!, 9));
  });

  it("끝값으로 막은 계획은 2마디 뒤가 어긋나지만, 길이로 푼 곡은 모든 음이 막지 않은 계획과 같은 시각에 난다", () => {
    const raw = tapTempos(s.tempo, s.timeSig, rat(0), taps)!;
    const unclamped = setTempos(raw.set, raw.remove).apply(s);
    const r = foldPlan(s, raw, range);
    expect(maxShiftMoved(unclamped, r.song, r.move)).toBeLessThan(1e-9);
    const clamped = tapTempos(s.tempo, s.timeSig, rat(0), taps, { range })!;
    expect(clamped.clamped).toEqual([{ at: rat(1), bpm: 300 }]);
    const clampedSong = setTempos(clamped.set, clamped.remove).apply(s);
    // 막은 계획은 2마디 안 음이 늦게 난다 (끝값 t255로 0.8초 대신 0.94초)
    expect(maxShiftMoved(unclamped, clampedSong, (at) => at)).toBeGreaterThan(0.1);
  });

  it("실행 취소 한 번에 탭을 넣기 전 곡으로 돌아온다", () => {
    const raw = tapTempos(s.tempo, s.timeSig, rat(0), taps)!;
    const r = foldPlan(s, raw, range);
    const h = new History(s);
    h.run(replaceSong("탭 템포", r.song));
    expect(h.song).toBe(r.song);
    h.undo();
    expect(h.song).toBe(s);
  });

  it("4배로도 못 닿는 템포는 곡을 바꾸지 않고 그 자리를 알린다", () => {
    // 2마디를 60초에 찍으면 t4
    const raw = tapTempos(s.tempo, s.timeSig, rat(0), [0, 2, 62, 64])!;
    const r = foldPlan(s, raw, range);
    expect(r.failed.length).toBe(1);
    expect(r.song).not.toBe(s); // 막지 않은 계획을 넣은 곡 그대로 (부르는 쪽이 버리고 끝값 계획을 넣는다)
    expect(foldFailedText(s, r, range, 64, t)).toBe('ui.tempoFoldTooFar{"where":"2:1","bpm":4,"min":32,"max":255}');
  });
});

describe("문구와 템포 창 제안", () => {
  it("템포 창: 범위 밖이면 배율과 넣을 템포, 4배로도 못 풀면 빈 제안, 범위 안이면 없음", () => {
    expect(foldOffer(300, range)).toEqual({ scale: "1/2", to: 150 });
    expect(foldOffer(20, range)).toEqual({ scale: "2", to: 40 });
    expect(foldOffer(600, range)).toEqual({ scale: "1/4", to: 150 });
    expect(foldOffer(7, range)).toEqual({});
    expect(foldOffer(120, range)).toBeUndefined();
  });

  it("푼 결과 한 줄: 자리(마디:박), 원래 값, 넣은 값, 배율", () => {
    const s = songOf(quarters(12), [
      { at: rat(0), bpm: 120 },
      { at: rat(1), bpm: 301 },
      { at: rat(2), bpm: 120 },
    ]);
    const r = foldPlan(s, { set: [], remove: [] }, range);
    // 계획에 범위 밖 템포가 없으면 아무것도 풀지 않는다 (이미 곡에 있던 템포는 건드리지 않는다)
    expect(r.folded).toEqual([]);
    const all = foldPlan(s, { set: [{ at: rat(1), bpm: 301 }], remove: [] }, range);
    expect(foldDoneText(s, all, t)).toBe(
      'ui.tempoFoldDone{"n":1,"places":"ui.tempoFoldPlace{\\"where\\":\\"2:1\\",\\"bpm\\":301,\\"to\\":151,\\"scale\\":\\"1/2\\"}"} ui.tempoFoldRounded{"bpm":301,"to":151} ui.tempoFoldShift{"ms":-2.6}',
    );
  });
});
