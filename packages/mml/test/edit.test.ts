import { describe, expect, it } from "vitest";
import { emptySong, History, rat, type Song } from "@mmlce/core";
import { appendSong, compactSong, mergeTies, parseTrackText, setTrackText, trackSource } from "../src/index.js";

function base(): Song {
  const t1 = parseTrackText("t1", { text: "t120 cde" });
  const t2 = parseTrackText("t2", { text: "r2 t90 c" });
  const make = (id: string, text: string, notes: typeof t1.notes) => ({
    id,
    playerId: "p1",
    name: id,
    color: "#000",
    role: "free" as const,
    mute: false,
    solo: false,
    notes,
    spelling: {},
    mml: { text },
  });
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: [...t1.tempo, ...t2.tempo],
    players: [{ id: "p1", name: "피아노", instrument: { canonical: "piano" } }],
    tracks: [make("t1", "t120 cde", t1.notes), make("t2", "r2 t90 c", t2.notes)],
  };
}

describe("MML 원문 편집", () => {
  it("원문을 바꾸면 음과 원문이 같이 바뀐다", () => {
    const h = new History(base());
    const s = h.run(setTrackText("t1", "t120 c4 g2"));
    expect(s.tracks[0]!.mml?.text).toBe("t120 c4 g2");
    expect(s.tracks[0]!.notes.map((n) => n.pitch)).toEqual([60, 67]);
    expect(s.tracks[1]).toBe(h.song.tracks[1]);
  });

  it("템포는 그 트랙이 넣었던 것만 바꾸고 다른 트랙 템포는 둔다", () => {
    const h = new History(base());
    const s = h.run(setTrackText("t1", "t150 cde"));
    expect(s.tempo).toEqual([
      { at: rat(0), bpm: 150 },
      { at: rat(1, 2), bpm: 90 },
    ]);
    const s2 = h.run(setTrackText("t2", "r2 c"));
    expect(s2.tempo).toEqual([{ at: rat(0), bpm: 150 }]);
  });

  it("여러 트랙에 같이 적혀 하나로 합쳐진 템포는 한 트랙에서 지워도 남는다", () => {
    const s = base();
    const t3 = parseTrackText("t3", { text: "r2 t90 e" });
    const song = { ...s, tracks: [...s.tracks, { ...s.tracks[1]!, id: "t3", name: "t3", notes: t3.notes, mml: { text: "r2 t90 e" } }] };
    const next = setTrackText("t2", "r2 c").apply(song);
    expect(next.tempo).toEqual([
      { at: rat(0), bpm: 120 },
      { at: rat(1, 2), bpm: 90 },
    ]);
  });

  it("실행 취소·다시 실행", () => {
    const start = base();
    const h = new History(start);
    h.run(setTrackText("t1", "t150 g"));
    h.run(setTrackText("t1", "t150 g a"));
    expect(h.undo().tracks[0]!.mml?.text).toBe("t150 g");
    const back = h.undo();
    expect(back.tracks[0]).toEqual(start.tracks[0]);
    expect(back.tempo).toEqual(start.tempo);
    expect(h.redo().tracks[0]!.mml?.text).toBe("t150 g");
  });

  it("원문이 없는 트랙은 출력기로 보여 주고, 첫 트랙에 곡 템포가 들어간다", () => {
    const s = base();
    const bare = { ...s, tracks: s.tracks.map(({ mml: _mml, ...t }) => t) };
    expect(trackSource(bare, bare.tracks[0]!).text).toContain("t120");
    expect(trackSource(bare, bare.tracks[1]!).text).not.toContain("t");
    // 출력된 첫 트랙 글을 고쳐도 템포가 겹쳐 쌓이지 않는다
    const edited = setTrackText("t1", trackSource(bare, bare.tracks[0]!).text.replace("t120", "t100")).apply(bare);
    expect(edited.tempo.map((t) => t.bpm)).toEqual([100, 90]);
  });
});

describe("compactSong", () => {
  it("글자 수가 줄고 소리·템포는 같으며 실행 취소된다", () => {
    const text = "t120 c8d8e8f8g8a8b8>c8< c8&c8 r8r8 o5c4o4c4";
    const track = { id: "a", playerId: "p", name: "a", color: "#000", role: "free" as const, mute: false, solo: false, notes: parseTrackText("a", { text }).notes, spelling: {}, mml: { text } };
    const song = { ...emptySong({ title: "", author: "", profileId: "mobile" }), tracks: [track], tempo: parseTrackText("a", { text }).tempo };
    const h = new History(song);
    const next = h.run(compactSong());
    const out = next.tracks[0]!;
    expect(out.mml!.text.length).toBeLessThan(text.replace(/\s/g, "").length);
    expect(mergeTies(out.notes)).toEqual(mergeTies(track.notes).map((n) => expect.objectContaining({ start: n.start, dur: n.dur, pitch: n.pitch })));
    expect(parseTrackText("a", out.mml!).tempo).toEqual(song.tempo);
    expect(h.undo()).toBe(song);
  });
});

describe("compactSong 음 보존", () => {
  it("출력기가 쓸 수 없는 길이가 있으면 음을 잃지 않게 곡을 그대로 둔다", () => {
    // 1/96 길이 셋 (출력기가 표기하지 못함)
    const notes = [0, 1, 2].map((k) => ({ id: `n${k}`, start: rat(k, 96), dur: rat(1, 96), pitch: 60, vol: 8, tie: "none" as const }));
    const track = { id: "a", playerId: "p", name: "a", color: "#000", role: "free" as const, mute: false, solo: false, notes, spelling: {} };
    const song = { ...emptySong({ title: "", author: "", profileId: "mobile" }), tracks: [track] };
    expect(compactSong().apply(song)).toBe(song);
  });
});

describe("appendSong", () => {
  it("연주자·트랙 id를 새로 매겨 뒤에 붙이고, 되돌리면 원래대로", () => {
    const song = base();
    const other = base();
    const history = new History(song);
    const next = history.run(appendSong(other));
    expect(next.players.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(next.tracks.map((t) => [t.id, t.playerId])).toEqual([
      ["t1", "p1"],
      ["t2", "p1"],
      ["t3", "p2"],
      ["t4", "p2"],
    ]);
    expect(new Set(next.tracks.flatMap((t) => t.notes.map((n) => n.id))).size).toBe(8);
    // 같은 자리의 같은 템포는 하나로 합친다
    expect(next.tempo.map((t) => t.bpm)).toEqual([120, 90]);
    expect(history.undo()).toEqual(song);
  });
});
