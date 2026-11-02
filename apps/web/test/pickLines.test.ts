import { describe, expect, it } from "vitest";
import { defaultLengthLimit, History, MOBILE_PROFILE, planGrace, planTrill, rat, type Note, type Rat, type Song } from "@mmlce/core";
import { addTrack, canWriteExactly, madeCommand, newSong, setTracksNotes } from "@mmlce/mml";
import { excludedOf, mainNoteOf, parseExcluded, pickedTracks, pickedWithout } from "../src/lib/pickLines";
import { parseGraceMade } from "../src/lib/graceOptions";
import { parseTrillMade } from "../src/lib/trillOptions";
import { newUnwritableTrack } from "../src/lib/writable";

// 트릴·트레몰로·꾸밈음 창의 쓸 줄(트랙) 고르기: 뺀 줄의 음은 계산에 넘기지 않고 그대로 둔다
const note = (id: string, pitch: number): Note => ({ id, start: rat(0), dur: rat(1, 4), pitch, vol: 10, tie: "none" });
/** 같은 연주자 세 줄 화음: t1 위(64), t2 가운데(60), t3 아래(55) */
function chord(): Song {
  const s = addTrack("p1", "트랙 3").apply(addTrack("p1", "트랙 2").apply(newSong({ playerName: "기타", trackName: "트랙 1" })));
  const pitches = [64, 60, 55];
  return { ...s, tracks: s.tracks.map((x, i) => ({ ...x, notes: [note(`n${i}`, pitches[i]!)] })) };
}
const all = (s: Song) => s.tracks.flatMap((x) => x.notes);
const canWrite = (r: Rat) => canWriteExactly(r, MOBILE_PROFILE.length);
const guarded = (s: Song) => new History(s, (before, after) => newUnwritableTrack(before, after, defaultLengthLimit()) === undefined);
const trill = (kind: "trill" | "tremolo") => ({ kind, offset: 2, length: rat(1, 16), startOther: false, endOnMain: false, tie: false, canWrite });

describe("쓸 줄 고르기 도움 함수", () => {
  it("고른 음이 든 트랙만, 뺀 트랙 음은 덜어 내고, 기록에는 고른 음이 든 뺀 트랙만", () => {
    const s = chord();
    const [a, b, c] = s.tracks.map((x) => x.id) as [string, string, string];
    expect(pickedTracks(s, all(s)).map((x) => x.id)).toEqual([a, b, c]);
    expect(pickedWithout(s, all(s), new Set([a])).map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(excludedOf(s, [all(s)[1]!], new Set([a, b, "없는 트랙"]))).toEqual([b]);
  });
  it("기준 본음은 가장 먼저 시작하는 음 중 가장 높은 음", () => {
    const s = chord();
    expect(mainNoteOf(all(s))?.id).toBe("n0");
    expect(mainNoteOf(all(s).slice(1))?.id).toBe("n1");
    expect(mainNoteOf([])).toBeUndefined();
  });
  it("옛 기록(뺀 트랙 없음)은 모두 씀", () => {
    expect(parseExcluded(undefined)).toEqual([]);
    expect(parseExcluded(["t2", 3])).toEqual(["t2"]);
    expect(parseTrillMade({ choice: {}, strings: [] }).excluded).toEqual([]);
    expect(parseGraceMade({ choice: {}, strings: [], excluded: ["t3"] }).excluded).toEqual(["t3"]);
  });
});

describe("트릴·트레몰로: 뺀 줄은 그대로", () => {
  it("트레몰로는 체크한 줄만 나눈다 (실행 취소 한 번에 원래 곡, 기록에 뺀 트랙)", () => {
    const s = chord();
    const off = s.tracks[1]!.id;
    let k = 0;
    const r = planTrill(s, pickedWithout(s, all(s), new Set([off])), trill("tremolo"), MOBILE_PROFILE, () => `x${++k}`);
    expect(r.changes.map((c) => c.trackId).sort()).toEqual([s.tracks[0]!.id, s.tracks[2]!.id].sort());
    const h = guarded(s);
    h.run(madeCommand(setTracksNotes(r.changes, "트릴"), { tool: "trill", options: { excluded: [off] }, picked: all(s).map((n) => n.id) }));
    expect(h.refused).toBe(false);
    expect(h.song.tracks[1]!.notes).toBe(s.tracks[1]!.notes);
    expect(parseTrillMade(h.song.made!.at(-1)!.options).excluded).toEqual([off]);
    h.undo();
    expect(h.song).toBe(s);
  });
  it("트릴은 위 줄을 빼면 남은 줄 가운데 가장 높은 음에 건다", () => {
    const s = chord();
    let k = 0;
    const full = planTrill(s, all(s), trill("trill"), MOBILE_PROFILE, () => `x${++k}`);
    expect(full.changes.map((c) => c.trackId)).toEqual([s.tracks[0]!.id]);
    const lower = planTrill(s, pickedWithout(s, all(s), new Set([s.tracks[0]!.id])), trill("trill"), MOBILE_PROFILE, () => `y${++k}`);
    expect(lower.changes.map((c) => c.trackId)).toEqual([s.tracks[1]!.id]);
  });
});

describe("꾸밈음: 위 줄을 빼면 아래 줄에", () => {
  it("남은 줄 가운데 가장 높은 음에 붙고, 실행 취소 한 번에 원래 곡", () => {
    const s = chord();
    const top = s.tracks[0]!.id;
    let k = 0;
    const r = planGrace(s, pickedWithout(s, all(s), new Set([top])), { offsets: [-2], length: rat(1, 32), timing: "on", tie: false, canWrite }, MOBILE_PROFILE, () => `g${++k}`);
    expect(r.made).toBe(1);
    const mid = r.changes.find((c) => c.trackId === s.tracks[1]!.id)!;
    expect(mid.notes.map((n) => n.pitch)).toEqual([58, 60]);
    const h = guarded(s);
    h.run(madeCommand(setTracksNotes(r.changes, "꾸밈음"), { tool: "grace", options: { excluded: [top] }, picked: all(s).map((n) => n.id) }));
    expect(h.refused).toBe(false);
    h.undo();
    expect(h.song).toBe(s);
  });
});
