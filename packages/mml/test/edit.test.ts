import { describe, expect, it } from "vitest";
import { emptySong, History, rat, type Song } from "@mmlce/core";
import { appendSong, compactResult, compactSong, mergeTies, scoresMissingTempo, tempoMismatch, parseTrackText, setTrackText, trackSource } from "../src/index.js";

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

describe("compactSong 잠근 트랙의 템포", () => {
  const make = (id: string, text: string) => ({ id, playerId: "p", name: id, color: "#000", role: "free" as const, mute: false, solo: false, notes: parseTrackText(id, { text }).notes, spelling: {}, mml: { text } });
  const songOf = (a: string, b: string) => ({
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    players: [{ id: "p", name: "피아노", instrument: { canonical: "piano" } }],
    tracks: [make("a", a), make("b", b)],
    tempo: [...parseTrackText("a", { text: a }).tempo, ...parseTrackText("b", { text: b }).tempo],
  });
  const written = (s: Song) => s.tracks.flatMap((t) => parseTrackText(t.id, t.mml!).tempo.map((e) => e.bpm));

  it("잠근 트랙에 템포를 맡기지 않아 악보 글에서 템포가 사라지지 않는다", () => {
    const song = songOf("g", "t90cdef");
    const out = compactSong(undefined, undefined, new Set(["a"])).apply(song);
    expect(out.tracks[0]).toBe(song.tracks[0]);
    expect(written(out)).toEqual([90]);
  });

  it("잠근 글의 같은 자리에 템포가 여럿이면 마지막 것만 적힌 것으로 본다 (t90t120)", () => {
    const song = songOf("t90t120ggggg", "t90cdef");
    const r = compactResult(song, undefined, new Set(["a"]));
    expect(r.kept).toBeUndefined();
    const out = r.song;
    // 그 자리에서 들리는 템포는 120이므로 지도의 90은 다른 트랙에 남아야 한다
    expect(parseTrackText("b", out.tracks[1]!.mml!).tempo.map((e) => e.bpm)).toEqual([90]);
    expect(tempoMismatch(out)).toBe(tempoMismatch(song));
  });

  it("템포를 글에 다 적을 수 없으면 줄이지 않고 그 까닭을 알린다", () => {
    const ns = [5, 7, 11, 13, 17];
    const h = ns.map((n) => `r${n}`).join("");
    const q = ns.map((n) => `r${n}`.repeat(n - 1)).join("");
    const song = songOf("t90" + h + "r19t90g", h + "t120" + q + "c");
    expect(scoresMissingTempo(song)).toEqual([]);
    const r = compactResult(song, undefined, new Set(["a"]));
    expect(r.kept).toBe("tempo");
    expect(r.song).toBe(song);
    expect(compactSong(undefined, undefined, new Set(["a"])).apply(song)).toBe(song);
  });

  it("잠근 트랙 글에 이미 있는 템포는 다른 트랙에 또 넣지 않는다", () => {
    const song = songOf("t90g", "cdef");
    const out = compactSong(undefined, undefined, new Set(["a"])).apply(song);
    expect(out.tracks[0]).toBe(song.tracks[0]);
    expect(written(out)).toEqual([90]);
  });
});

describe("compactSong 옮겨 쓰는 템포", () => {
  it("음 가운데라 뒤 음 경계로 옮겨 쓰는 템포는 막지 않는다 (원문 없는 트랙이 있는 악보)", () => {
    const make = (id: string, text: string, withText: boolean) => ({
      id, playerId: "p", name: id, color: "#000", role: "free" as const, mute: false, solo: false,
      notes: parseTrackText(id, { text }).notes, spelling: {}, ...(withText ? { mml: { text } } : {}),
    });
    for (let k = 1; k < 48; k++) {
      const song: Song = {
        ...emptySong({ title: "", author: "", profileId: "mobile" }),
        players: [{ id: "p", name: "피아노", instrument: { canonical: "piano" } }],
        tracks: [make("a", "c8 d8 e8 f8 g8 a8 b8 >c8", false), make("b", "e8 f8 g8 a8 b8 >c8 d8 e8", true)],
        tempo: [{ at: rat(0), bpm: 150 }, { at: rat(k, 192), bpm: 90 }],
      };
      const r = compactResult(song);
      expect(r.kept, `k=${k}`).toBeUndefined();
    }
  });
});

describe("compactSong 겹치는 템포", () => {
  it("출력기가 아주 짧은 쉼표를 빼 두 템포가 한 자리에 겹치면 줄이지 않는다", () => {
    const song: Song = {
      ...emptySong({ title: "", author: "", profileId: "mobile" }),
      players: [{ id: "p", name: "피아노", instrument: { canonical: "piano" } }],
      tracks: [
        { id: "a", playerId: "p", name: "a", color: "#000", role: "free", mute: false, solo: false, notes: parseTrackText("a", { text: "c4" }).notes, spelling: {} },
        { id: "b", playerId: "p", name: "b", color: "#000", role: "free", mute: false, solo: false, notes: parseTrackText("b", { text: "t150e1" }).notes, spelling: {}, mml: { text: "t150e1" } },
      ],
      tempo: [{ at: rat(0), bpm: 150 }, { at: rat(17, 64), bpm: 90 }, { at: rat(13, 48), bpm: 120 }],
    };
    const r = compactResult(song);
    expect(r.kept).toBe("tempo");
    expect(r.song).toBe(song);
  });
});

describe("compactSong 두 번 줄이기", () => {
  it("한 번 줄여 템포를 옮겨 쓴 악보를 잠그고 다시 줄여도 막지 않는다", () => {
    const make = (id: string, playerId: string, text: string, withText: boolean) => ({
      id, playerId, name: id, color: "#000", role: "free" as const, mute: false, solo: false,
      notes: parseTrackText(id, { text }).notes, spelling: {}, ...(withText ? { mml: { text } } : {}),
    });
    const song: Song = {
      ...emptySong({ title: "", author: "", profileId: "mobile" }),
      players: [
        { id: "p", name: "피아노", instrument: { canonical: "piano" } },
        { id: "q", name: "류트", instrument: { canonical: "lute" } },
      ],
      tracks: [
        make("a", "p", "c8 d8 e8 f8 g8 a8 b8 >c8", false),
        make("b", "p", "e8 f8 g8 a8 b8 >c8 d8 e8", true),
        make("c", "q", "c8 c8 c8 c8 c8 c8 c8 c8", true),
      ],
      tempo: [{ at: rat(0), bpm: 150 }, { at: rat(1, 192), bpm: 90 }],
    };
    const once = compactResult(song);
    expect(once.kept).toBeUndefined();
    // 첫 악보를 잠그고 다시 줄인다 (둘째 악보는 원문을 되돌려 다시 줄일 거리를 만든다)
    const again = { ...once.song, tracks: once.song.tracks.map((t) => (t.id === "c" ? song.tracks[2]! : t)) };
    const r = compactResult(again, undefined, new Set(["a", "b"]));
    expect(r.kept).toBeUndefined();
    expect(r.song.tracks[0]).toBe(again.tracks[0]);
    expect(r.song.tracks[1]).toBe(again.tracks[1]);
  });

  it("따로인 두 악보에서 한쪽을 잠그고 다시 줄여도 막지 않는다 (옮긴 템포가 1/32 경계에 있는 경우)", () => {
    const make = (id: string, playerId: string, text: string) => ({
      id, playerId, name: id, color: "#000", role: "free" as const, mute: false, solo: false,
      notes: parseTrackText(id, { text }).notes, spelling: {}, mml: { text },
    });
    const song: Song = {
      ...emptySong({ title: "", author: "", profileId: "mobile" }),
      players: [
        { id: "p", name: "피아노", instrument: { canonical: "piano" } },
        { id: "q", name: "류트", instrument: { canonical: "lute" } },
      ],
      tracks: [make("a", "p", "t150 c64 d64 t90 e64"), make("b", "q", "t150 e64 f64 t90 g64")],
      tempo: [{ at: rat(0), bpm: 150 }, { at: rat(1, 48), bpm: 90 }],
    };
    const once = compactResult(song);
    expect(once.kept).toBeUndefined();
    const r = compactResult(once.song, undefined, new Set(["a"]));
    expect(r.kept).toBeUndefined();
    expect(r.song.tracks[0]).toBe(once.song.tracks[0]);
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
