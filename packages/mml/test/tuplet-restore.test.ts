import { describe, expect, it } from "vitest";
import { cmp, emptySong, MOBILE_PROFILE, rat, songProfile, type Note, type Player, type Song } from "@mmlce/core";
import { canWriteExactly, lostOnReturn, restoreTuplets, songProfileChange, unwritableNotes } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };
const note = (id: string, start: [number, number], dur: [number, number], pitch = 60): Note => ({ id, start: rat(...start), dur: rat(...dur), pitch, vol: 8, tie: "none" });

/** 4분음표 c, 4분 5잇단(l20) 다섯, 8분 셋잇단(l12) 셋, 2분음표 */
function mobileSong(): Song {
  const notes: Note[] = [note("a", [0, 1], [1, 4])];
  for (let k = 0; k < 5; k++) notes.push(note(`q${k}`, [5 + k, 20], [1, 20], 62 + k));
  for (let k = 0; k < 3; k++) notes.push(note(`t${k}`, [6 + k, 12], [1, 12], 67));
  notes.push(note("z", [3, 4], [1, 2], 72));
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    players: [piano],
    tracks: [{ id: "t1", playerId: "p1", name: "t1", color: "#000", role: "free", mute: false, solo: false, notes, spelling: {} }],
    tempo: [{ at: rat(0), bpm: 120 }],
  };
}
const shape = (s: Song) => [...s.tracks[0]!.notes].sort((a, b) => cmp(a.start, b.start)).map((n) => `${n.id}:${n.start.n}/${n.start.d}+${n.dur.n}/${n.dur.d}`);

describe("잇단음 되살리기 (PC → 모바일)", () => {
  it("틱 칸에 남은 19/384 길이는 모바일 출력이 정확히 쓸 수 없다 (곡 검사가 알릴 근거)", () => {
    expect(canWriteExactly(rat(19, 384), MOBILE_PROFILE.length)).toBe(false);
    expect(canWriteExactly(rat(20, 384), MOBILE_PROFILE.length)).toBe(true);
  });

  it("모바일 → PC(틱에 맞춤) → 모바일 + 되살리기 = 처음 곡", () => {
    const start = mobileSong();
    const pc = songProfileChange(start, "pc").song;
    expect(pc.tracks[0]!.notes.some((n) => n.dur.d !== 20 && n.id.startsWith("q"))).toBe(true);
    const back = songProfileChange(pc, "mobile").song;
    expect(songProfile(back).id).toBe("mobile");
    expect(unwritableNotes(back.tracks[0]!, MOBILE_PROFILE.length).length).toBeGreaterThan(0);
    const r = restoreTuplets(back);
    expect(r.tracks.map((x) => x.trackId)).toEqual(["t1"]);
    expect(r.left).toBe(0);
    expect(shape(r.song)).toEqual(shape(start));
  });

  it("틱 셈 글로 적으면 틀어지는 정확한 분수 음(잇단음 밖)은 되살리면서 바꾸지 않는다", () => {
    const back = songProfileChange(songProfileChange(mobileSong(), "pc").song, "mobile").song;
    // 되살릴 잇단음 곁에, 틱 칸 밖이지만 모바일에서는 정확히 쓸 수 있는 음 (1/5 길이)
    const odd = note("x", [2, 1], [1, 5], 50);
    const s: Song = { ...back, tracks: [{ ...back.tracks[0]!, notes: [...back.tracks[0]!.notes, odd] }] };
    const r = restoreTuplets(s);
    expect(r.tracks.map((x) => x.trackId)).toEqual(["t1"]);
    const x = r.song.tracks[0]!.notes.find((n) => n.id === "x")!;
    expect(x.start).toEqual(rat(2));
    expect(x.dur).toEqual(rat(1, 5));
    expect(shape(r.song).filter((t) => !t.startsWith("x:"))).toEqual(shape(mobileSong()));
  });

  it("되살릴 것이 없으면 곡 그대로", () => {
    const s = mobileSong();
    const r = restoreTuplets(s);
    expect(r.song).toBe(s);
    expect(r.moved).toBe(0);
  });

  it("잠근 트랙은 그대로", () => {
    const back = songProfileChange(songProfileChange(mobileSong(), "pc").song, "mobile").song;
    expect(restoreTuplets(back, new Set(["t1"])).song).toBe(back);
  });

  it("PC로 바꿀 때 되돌릴 수 없는 음: 잇단음은 0, 틱 칸 밖 자리는 센다", () => {
    expect(lostOnReturn(mobileSong(), "pc")).toBe(0);
    const s = mobileSong();
    const odd = { ...s, tracks: [{ ...s.tracks[0]!, notes: [...s.tracks[0]!.notes, note("x", [2001, 1000], [1, 1000], 50)] }] };
    expect(lostOnReturn(odd, "pc")).toBeGreaterThan(0);
  });
});
