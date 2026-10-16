import { describe, expect, it } from "vitest";
import { emptySong, rat, type Song } from "@mmlce/core";
import { deleteTime, insertTime, parseTrackText } from "../src/index.js";

function song(text: string): Song {
  const base = emptySong({ title: "", author: "", profileId: "mobile" });
  const notes = parseTrackText("t1", { text }).notes;
  return {
    ...base,
    tempo: [{ at: rat(0), bpm: 120 }, { at: rat(2), bpm: 90 }],
    players: [{ id: "p1", name: "", instrument: { canonical: "piano" } }],
    tracks: [{ id: "t1", playerId: "p1", name: "", color: "", role: "free", mute: false, solo: false, notes, spelling: {}, mml: { text } }],
  };
}
const starts = (s: Song) => s.tracks[0]!.notes.map((n) => [n.start.n / n.start.d, n.dur.n / n.dur.d, n.pitch]);

describe("마디 넣기·빼기", () => {
  it("넣기: 그 자리부터 음·템포를 한 마디 민다", () => {
    const s = insertTime(rat(1), rat(1)).apply(song("c1 d1 e1"));
    expect(starts(s)).toEqual([[0, 1, 60], [2, 1, 62], [3, 1, 64]]);
    expect(s.tempo.map((t) => t.at.n / t.at.d)).toEqual([0, 3]);
    expect(s.tracks[0]!.mml).toBeUndefined();
  });

  it("빼기: 구간 음은 지우고, 걸친 음은 밖 부분만 남기고, 뒤를 당긴다", () => {
    // c2(0~0.5) d1(0.5~1.5) e1(1.5~2.5) f1(2.5~3.5) 에서 [1, 2) 빼기
    const s = deleteTime(rat(1), rat(1)).apply(song("c2 d1 e1 f1"));
    expect(starts(s)).toEqual([[0, 0.5, 60], [0.5, 0.5, 62], [1, 0.5, 64], [1.5, 1, 65]]);
    // 2에 있던 t90은 1로 당겨진다
    expect(s.tempo.map((t) => [t.at.n / t.at.d, t.bpm])).toEqual([[0, 120], [1, 90]]);
  });

  it("빼기: 구간 안 템포는 마지막 값을 구간 시작에 남긴다", () => {
    const s = deleteTime(rat(1), rat(2)).apply(song("c1 d1 e1 f1"));
    expect(s.tempo.map((t) => [t.at.n / t.at.d, t.bpm])).toEqual([[0, 120], [1, 90]]);
    expect(starts(s)).toEqual([[0, 1, 60], [1, 1, 65]]);
  });

  it("빼기: &로 이어 주던 음이 지워지면 &를 푼다", () => {
    // c1&d1 e1 에서 [1, 2) 빼기: d가 지워지므로 c는 e와 이어지지 않는다
    const s = deleteTime(rat(1), rat(1)).apply(song("c1&d1 e1"));
    expect(s.tracks[0]!.notes.map((n) => [n.pitch, n.tie])).toEqual([[60, "none"], [64, "none"]]);
    // 걸친 음은 남은 부분끼리 이어지면 &도 남는다: c1&d1 에서 [1/2, 3/2) 빼기
    const t = deleteTime(rat(1, 2), rat(1)).apply(song("c1&d1"));
    expect(t.tracks[0]!.notes.map((n) => [n.pitch, n.tie])).toEqual([[60, "next"], [62, "none"]]);
  });

  it("넣기: &로 잇던 음 사이에 마디를 넣으면 &를 푼다", () => {
    const s = insertTime(rat(1), rat(1)).apply(song("c1&d1 e1"));
    expect(s.tracks[0]!.notes.map((n) => [n.pitch, n.tie])).toEqual([[60, "none"], [62, "none"], [64, "none"]]);
    // 넣는 자리 뒤끼리 이은 &는 그대로
    const t = insertTime(rat(0), rat(1)).apply(song("c1&d1"));
    expect(t.tracks[0]!.notes.map((n) => [n.pitch, n.tie])).toEqual([[60, "next"], [62, "none"]]);
  });

  it("박자 변화도 함께 밀고 당긴다", () => {
    const base = { ...song("c1 d1 e1"), timeSig: [{ at: rat(0), beats: 4, unit: 4 }, { at: rat(2), beats: 3, unit: 4 }] };
    expect(insertTime(rat(1), rat(1)).apply(base).timeSig.map((x) => x.at)).toEqual([rat(0), rat(3)]);
    expect(deleteTime(rat(1), rat(1)).apply(base).timeSig.map((x) => x.at)).toEqual([rat(0), rat(1)]);
    expect(deleteTime(rat(2), rat(3, 4)).apply(base).timeSig).toEqual([{ at: rat(0), beats: 4, unit: 4 }, { at: rat(2), beats: 3, unit: 4 }]);
  });
});
