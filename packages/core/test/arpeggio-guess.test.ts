import { describe, expect, it } from "vitest";
import { adoptMade, emptySong, guessArpeggio, guessArpeggioAround, planArpeggio, rat, restoreMade, unmarkNotes, type ArpOptions, type ArpOrder, type Note, type Song, type Track } from "../src/index.js";

/** 8분음표 단위로 음을 만든다 */
const n = (id: string, start: number, dur: number, pitch: number, vol = 10): Note => ({ id, start: rat(start, 8), dur: rat(dur, 8), pitch, vol, tie: "none" });

function songOf(tracks: Record<string, Note[]>): Song {
  const ids = Object.keys(tracks);
  const list: Track[] = ids.map((id) => ({ id, playerId: "p1", name: id, color: "", role: "free", mute: false, solo: false, notes: tracks[id]!, spelling: {} }));
  return { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [{ id: "p1", name: "p1", instrument: { canonical: "piano" } }], tracks: list };
}

const base: ArpOptions = {
  source: "together", chord: "major", style: "spread", order: "up", step: rat(1, 16), octaves: 1, repeat: true,
  clearChordTracks: true, range: { low: 0, high: 127 }, maxTracks: 6,
};
let k = 0;
const newId = () => `x${++k}`;
/** 트랙마다 음 모양 (id·기록은 보지 않는다) */
const shape = (s: Song) => Object.fromEntries(s.tracks.map((t) => [t.id, t.notes.map((x) => `${x.pitch}@${x.start.n}/${x.start.d}+${x.dur.n}/${x.dur.d}`).sort()]));

// C(0~1/2)·F(1/2~1) 화음 두 칸: t1 근음, t2·t3 나머지
const chords = () =>
  songOf({
    t1: [n("c", 0, 4, 60), n("f", 4, 4, 65)],
    t2: [n("e", 0, 4, 64), n("a", 4, 4, 69)],
    t3: [n("g", 0, 4, 67), n("c5", 4, 4, 72)],
  });

/** 아르페지오를 넣고 기록 없이 (전 판에서 만든 것처럼) */
function arpeggiate(song: Song, options: Partial<ArpOptions>): Song {
  const r = planArpeggio(song, "t1", song.tracks[0]!.notes, { ...base, ...options }, newId);
  expect(r.newTracks).toEqual([]);
  const byId = new Map(r.changes.map((c) => [c.trackId, c.notes]));
  return { ...song, tracks: song.tracks.map((t) => ({ ...t, notes: unmarkNotes(byId.get(t.id) ?? t.notes) })) };
}

/** 고른 음을 알아본 뒤 원래대로 되돌린 곡 */
function guessAndRestore(song: Song, picked: readonly Note[]) {
  const g = guessArpeggio(song, picked, newId);
  if (!g.ok) throw new Error(g.reason);
  const adopted = adoptMade(song, { tool: "arpeggio", options: {}, trackId: g.trackId, picked: g.picked }, g.before, g.after);
  expect(adopted).not.toBe(song);
  const plan = restoreMade(adopted, [adopted.made!.at(-1)!.id]);
  if (!plan.ok) throw new Error(plan.reason);
  expect(plan.edited).toBe(0);
  const byId = new Map(plan.changes.map((c) => [c.trackId, c.notes]));
  return { guess: g, restored: { ...adopted, tracks: adopted.tracks.map((t) => ({ ...t, notes: byId.get(t.id) ?? t.notes })) } };
}

describe("기록 없는 아르페지오 알아보기", () => {
  const orders: ArpOrder[] = ["up", "down", "updown", "random"];
  for (const order of orders)
    for (const repeat of [true, false])
      it(`펼치기 (${order}, 반복 ${repeat ? "켬" : "끔"}): 설정을 맞히고 되돌리면 원래 화음`, () => {
        const original = chords();
        const made = arpeggiate(original, { order, repeat });
        const { guess, restored } = guessAndRestore(made, made.tracks[0]!.notes);
        expect(guess).toMatchObject({ style: "spread", step: rat(1, 16), octaves: 1, clearChordTracks: true, trackId: "t1", dropped: 0, skipped: 0 });
        if (order !== "random") expect(guess.ok && guess.order).toBe(order);
        if (repeat) expect(guess.ok && guess.repeat).toBe(true);
        expect(guess.ok && guess.cells.map((c) => c.pitches)).toEqual([
          [60, 64, 67],
          [65, 69, 72],
        ]);
        expect(shape(restored)).toEqual(shape(original));
      });

  it("펼치기 옥타브 2: 원래 화음은 한 옥타브", () => {
    const original = chords();
    const made = arpeggiate(original, { octaves: 2 });
    const { guess, restored } = guessAndRestore(made, made.tracks[0]!.notes);
    expect(guess.ok && [guess.octaves, guess.cells[0]!.pitches]).toEqual([2, [60, 64, 67]]);
    expect(shape(restored)).toEqual(shape(original));
  });

  it("화음 트랙 음을 지우지 않은 펼치기: 남은 화음 음은 그대로 두고 고른 트랙에 한 음만 돌려놓는다", () => {
    const original = chords();
    const made = arpeggiate(original, { clearChordTracks: false });
    // 드래그로 다른 트랙 화음 음까지 같이 골라도 된다
    const picked = made.tracks.flatMap((t) => t.notes);
    const { guess, restored } = guessAndRestore(made, picked);
    expect(guess).toMatchObject({ style: "spread", clearChordTracks: false, skipped: 0 });
    expect(guess.ok && guess.before.map((b) => b.trackId)).toEqual(["t1"]);
    expect(shape(restored)).toEqual(shape(original));
  });

  for (const repeat of [true, false])
    it(`되풀이 (반복 ${repeat ? "켬" : "끔"}): 트랙마다 첫 음 높이로 화음을 돌려놓는다`, () => {
      const original = chords();
      const made = arpeggiate(original, { style: "strum", repeat });
      const picked = made.tracks.flatMap((t) => t.notes);
      const { guess, restored } = guessAndRestore(made, picked);
      expect(guess.ok && guess.style).toBe(repeat ? "strum" : "roll");
      expect(shape(restored)).toEqual(shape(original));
    });

  it("굴려 치기: 원래 음 시작을 칸 처음으로", () => {
    const original = chords();
    const made = arpeggiate(original, { style: "roll", step: rat(1, 32) });
    const picked = made.tracks.flatMap((t) => t.notes);
    const { guess, restored } = guessAndRestore(made, picked);
    expect(guess).toMatchObject({ style: "roll", step: rat(1, 32) });
    expect(shape(restored)).toEqual(shape(original));
  });

  it("빈 트랙이 모자라면 남는 화음 음은 빼고 센다", () => {
    const made = arpeggiate(songOf({ t1: [n("c", 0, 4, 60)], t2: [n("e", 0, 4, 64)], t3: [n("g", 0, 4, 67)] }), {});
    const busy = { ...made, tracks: made.tracks.map((t) => (t.id === "t3" ? { ...t, notes: [n("z", 0, 4, 40)] } : t)) };
    const g = guessArpeggio(busy, busy.tracks[0]!.notes, newId);
    expect(g.ok && [g.dropped, g.before.map((b) => b.trackId)]).toEqual([1, ["t1", "t2"]]);
  });

  it("아르페지오 모양이 아니면 알아보지 않는다", () => {
    // 높이가 하나뿐 / 길이가 제각각인 선율
    const one = songOf({ t1: [n("a", 0, 1, 60), n("b", 1, 1, 60)] });
    expect(guessArpeggio(one, one.tracks[0]!.notes, newId)).toMatchObject({ ok: false, reason: "none" });
    const melody = songOf({ t1: [n("a", 0, 2, 60), n("b", 2, 1, 62), n("c", 3, 3, 64), n("d", 6, 1, 65)] });
    expect(guessArpeggio(melody, melody.tracks[0]!.notes, newId)).toMatchObject({ ok: false, reason: "none" });
  });

  it("이미 기록이 있는 음이 섞이면 알아보지 않는다", () => {
    const made = arpeggiate(chords(), {});
    const g = guessArpeggio(made, made.tracks[0]!.notes, newId);
    if (!g.ok) throw new Error();
    const adopted = adoptMade(made, { tool: "arpeggio", options: {}, picked: g.picked }, g.before, g.after);
    const again = guessArpeggio(adopted, adopted.tracks[0]!.notes, newId);
    expect(again).toMatchObject({ ok: false, reason: "made" });
    // 그사이 붙은 음에는 다시 붙이지 않는다
    expect(adoptMade(adopted, { tool: "arpeggio", options: {}, picked: [] }, g.before, g.after)).toBe(adopted);
  });

  it("굴려 치기는 원래 음 끝이 달라도 알아보고, 피아노롤처럼 한 음만 골라도 둘레를 묶는다", () => {
    // 베이스가 더 긴 화음을 굴려 친다
    const original = songOf({ t1: [n("c", 0, 8, 48)], t2: [n("e", 0, 4, 64)], t3: [n("g", 0, 4, 67)], t4: [n("x", 8, 2, 50)] });
    const made = arpeggiate(original, { style: "roll", step: rat(1, 32) });
    // 다른 트랙 음은 고를 수 없으니 한 음만
    const one = made.tracks[0]!.notes.slice(0, 1);
    expect(guessArpeggio(made, one, newId)).toMatchObject({ ok: false, reason: "none" });
    const g = guessArpeggioAround(made, one, newId);
    if (!g.ok) throw new Error(g.reason);
    expect(g).toMatchObject({ style: "roll", step: rat(1, 32), skipped: 0 });
    const adopted = adoptMade(made, { tool: "arpeggio", options: {}, trackId: g.trackId, picked: g.picked }, g.before, g.after);
    const plan = restoreMade(adopted, [adopted.made!.at(-1)!.id]);
    if (!plan.ok) throw new Error(plan.reason);
    const byId = new Map(plan.changes.map((c) => [c.trackId, c.notes]));
    expect(shape({ ...adopted, tracks: adopted.tracks.map((t) => ({ ...t, notes: byId.get(t.id) ?? t.notes })) })).toEqual(shape(original));
  });

  it("펼치기도 한 음만 골라 그 트랙에서 이어진 음으로 넓힌다", () => {
    const original = chords();
    const made = arpeggiate(original, {});
    const g = guessArpeggioAround(made, made.tracks[0]!.notes.slice(3, 4), newId);
    expect(g.ok && [g.style, g.cells.length]).toEqual(["spread", 2]);
  });

  it("한 연주자가 악보 여럿으로 나뉘면 다른 악보 트랙은 둘레로 묶지 않는다", () => {
    // 1번 c1, 2~6번 빈 트랙, 7번(둘째 악보) r16e2
    const song = songOf({ t1: [n("c", 0, 8, 60)], t2: [], t3: [], t4: [], t5: [], t6: [], t7: [{ ...n("e", 0, 4, 64), start: rat(1, 16) }] });
    const scores = [["t1", "t2", "t3", "t4", "t5", "t6"], ["t7"]];
    const one = song.tracks[0]!.notes;
    expect(guessArpeggioAround(song, one, newId).ok).toBe(true);
    expect(guessArpeggioAround(song, one, newId, new Set(), scores)).toMatchObject({ ok: false, reason: "none" });
    // 두 악보 음을 함께 고르면 여러 악보
    expect(guessArpeggio(song, [...one, ...song.tracks[6]!.notes], newId, new Set(), scores)).toMatchObject({ ok: false, reason: "score" });
  });

  it("&로 이은 음은 하나로 본다", () => {
    // 굴려 치기 뒤 각 음을 &로 둘로 나눈 것
    const tied = songOf({
      t1: [{ ...n("c1", 0, 2, 60), tie: "next" }, n("c2", 2, 2, 60)],
      t2: [n("e0", 0, 1, 40), { ...n("e1", 1, 1, 64), tie: "next" }, n("e2", 2, 2, 64)],
      t3: [n("g0", 0, 1, 41), { ...n("g1", 2, 1, 67), tie: "next" }, n("g2", 3, 1, 67)],
    });
    const picked = tied.tracks.flatMap((t) => t.notes.filter((x) => !x.id.endsWith("0")));
    const g = guessArpeggio(tied, picked, newId);
    expect(g.ok && [g.style, g.after.flatMap((a) => a.notes.map((x) => x.id)).sort()]).toEqual(["roll", ["c1", "c2", "e1", "e2", "g1", "g2"]]);
  });
});
