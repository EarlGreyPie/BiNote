import { describe, expect, it } from "vitest";
import { emptySong, History, normalizeTempo, rat, type Song } from "@mmlce/core";
import { compactSong, fillScoreTempo, keepScoreTempo, moveTempo, parseMml, parseTrackText, scoresMissingTempo, removeTempoAt, setTempoAt, setTempos, setTrackText, tempoInsertOffset, tempoMismatch, trackSource } from "../src/index.js";
import { moveTrackToNewPlayer, setPlayerInstrument, shiftTrack } from "../src/structure.js";

/** 원문들로 곡을 만든다. null이면 원문 없는(음만 있는) 트랙 */
function songOf(...texts: (string | { text: string; notesOnly: true })[]): Song {
  const tracks = texts.map((src, k) => {
    const text = typeof src === "string" ? src : src.text;
    const parsed = parseTrackText(`t${k + 1}`, { text });
    return {
      id: `t${k + 1}`,
      playerId: "p1",
      name: `t${k + 1}`,
      color: "#000",
      role: "free" as const,
      mute: false,
      solo: false,
      notes: parsed.notes,
      spelling: {},
      ...(typeof src === "string" ? { mml: { text } } : {}),
      tempo: parsed.tempo,
    };
  });
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: normalizeTempo(tracks.flatMap((t) => t.tempo)),
    players: [{ id: "p1", name: "피아노", instrument: { canonical: "piano" } }],
    tracks: tracks.map(({ tempo: _t, ...t }) => t),
  };
}

const texts = (s: Song) => s.tracks.map((t) => t.mml?.text);
/** 원문들을 다시 읽어 모은 템포가 곡 템포 지도와 같은지 */
const mirrored = (s: Song) => !tempoMismatch(s);

describe("템포 넣을 글 자리", () => {
  it("그 위치에서 시작하는 음·쉼표 앞, 곡 끝이면 글 끝", () => {
    const text = "c4 r4 d4";
    const parsed = parseMml(text);
    expect(tempoInsertOffset(text, parsed, rat(1, 4))).toBe(3);
    expect(tempoInsertOffset(text, parsed, rat(1, 2))).toBe(6);
    expect(tempoInsertOffset(text, parsed, rat(3, 4))).toBe(text.length);
    expect(tempoInsertOffset(text, parsed, rat(1, 8))).toBeUndefined();
  });

  it("& 뒤 자리는 다른 후보가 없을 때 쓴다", () => {
    const text = "c4&d4";
    expect(tempoInsertOffset(text, parseMml(text), rat(1, 4))).toBe(3);
  });
});

describe("템포 편집 (원문 수술)", () => {
  it("고치면 그 자리 t를 쓴 원문을 모두 고친다", () => {
    const s = setTempoAt(rat(1, 2), 100).apply(songOf("t120 c2 t90 c2", "r2 t90 e2"));
    expect(texts(s)).toEqual(["t120 c2 t100 c2", "r2 t100 e2"]);
    expect(s.tempo).toEqual([{ at: rat(0), bpm: 120 }, { at: rat(1, 2), bpm: 100 }]);
    expect(mirrored(s)).toBe(true);
  });

  it("없던 자리에는 경계가 있는 원문 하나에 끼운다 (t를 이미 쓴 트랙 먼저)", () => {
    const s = setTempoAt(rat(1, 4), 90).apply(songOf("c2 d2", "t120 e4 f4"));
    expect(texts(s)).toEqual(["c2 d2", "t120 e4 t90f4"]);
    expect(mirrored(s)).toBe(true);
  });

  it("쉼표 경계에도 끼운다", () => {
    const s = setTempoAt(rat(1, 2), 80).apply(songOf("c1", "r2 e2"));
    expect(texts(s)).toEqual(["c1", "r2 t80e2"]);
  });

  it("어느 원문에도 경계가 없으면 첫 트랙 원문을 버려 출력기가 음을 잘라 쓴다", () => {
    const s = setTempoAt(rat(1, 8), 90).apply(songOf("c4 d4", "e2"));
    expect(s.tracks[0]!.mml).toBeUndefined();
    expect(trackSource(s, s.tracks[0]!).text).toMatch(/t90/);
    expect(mirrored(s)).toBe(true);
  });

  it("문법 오류가 있는 원문은 손대지 않는다", () => {
    const s = setTempoAt(rat(1, 4), 90).apply(songOf("c4 d4 o", "e4 f4"));
    expect(texts(s)).toEqual(["c4 d4 o", "e4 t90f4"]);
  });

  it("원문 offset을 빼고 찾는다", () => {
    const song = songOf("c4 d4");
    const shifted: Song = { ...song, tracks: song.tracks.map((t) => ({ ...t, mml: { text: "c4 d4", offset: rat(1) } })) };
    const s = setTempoAt(rat(5, 4), 90).apply(shifted);
    expect(texts(s)).toEqual(["c4 t90d4"]);
  });

  it("지우면 그 자리 t를 모두 지운다", () => {
    const s = removeTempoAt(rat(1, 2)).apply(songOf("t120 c2 t90 c2", "r2 t90 e2"));
    expect(texts(s)).toEqual(["t120 c2 c2", "r2 e2"]);
    expect(s.tempo).toEqual([{ at: rat(0), bpm: 120 }]);
    expect(mirrored(s)).toBe(true);
  });

  it("옮기면 지우고 새 자리에 넣는다 (실행 취소 한 칸)", () => {
    const start = songOf("t120 c4 t90 c4 d4");
    const h = new History(start);
    const s = h.run(moveTempo(rat(1, 4), rat(1, 2)));
    expect(texts(s)).toEqual(["t120 c4 c4 t90d4"]);
    expect(s.tempo).toEqual([{ at: rat(0), bpm: 120 }, { at: rat(1, 2), bpm: 90 }]);
    expect(h.undo()).toBe(start);
  });

  it("여러 템포를 한 번에 고치고 지운다 (실행 취소 한 칸)", () => {
    const start = songOf("t120 c4 t90 c4 d4 e4");
    const h = new History(start);
    const s = h.run(setTempos([{ at: rat(0), bpm: 100 }, { at: rat(1, 2), bpm: 110 }], [rat(1, 4)]));
    expect(texts(s)).toEqual(["t100 c4 c4 t110d4 e4"]);
    expect(mirrored(s)).toBe(true);
    expect(h.undo()).toBe(start);
  });

  it("원문 없는 첫 트랙은 다른 원문이 적은 템포를 다시 쓰지 않는다", () => {
    const s = songOf({ text: "c2 c2", notesOnly: true }, "r2 t90 e2");
    expect(trackSource(s, s.tracks[0]!).text).not.toMatch(/t90/);
  });

  it("원문의 t와 지도가 다르면 tempoMismatch", () => {
    const s = songOf("t120 c2 t90 c2");
    expect(tempoMismatch(s)).toBe(false);
    expect(tempoMismatch({ ...s, tempo: [{ at: rat(0), bpm: 120 }] })).toBe(true);
    // 원문 없는 트랙이 있으면 지도에만 있는 템포는 괜찮다 (저장 때 출력기가 쓴다)
    const mixed = songOf("t120 c2 c2", { text: "r2 t90 c2", notesOnly: true });
    expect(tempoMismatch(mixed)).toBe(false);
  });
});

describe("악보마다 템포", () => {
  /** 트랙마다 연주자를 정해 두 악보 곡으로 */
  function twoScores(a: string, b: string | { text: string; notesOnly: true }, c?: string): Song {
    const s = c === undefined ? songOf(a, b) : songOf(a, b, c);
    return {
      ...s,
      players: [...s.players, { id: "p2", name: "플루트", instrument: { canonical: "flute" } }],
      tracks: s.tracks.map((t, k) => (k === 0 ? t : { ...t, playerId: "p2" })),
    };
  }

  it("원문 없는 트랙은 연주자마다 첫 트랙 글에 곡 템포를 넣는다", () => {
    const s = twoScores("t120 c4 d4", { text: "e4 f4", notesOnly: true });
    expect(trackSource(s, s.tracks[1]!).text).toContain("t120");
    expect(scoresMissingTempo(s)).toEqual([]);
  });

  it("악보 1에만 템포를 쓴 곡은 악보마다 템포 넣기로 악보 2 글에도 적는다 (실행 취소 한 칸)", () => {
    const s = twoScores("t120 c4 t90 d4", "e4 f4", "g2");
    expect(scoresMissingTempo(s).map((ids) => s.tracks.find((t) => t.id === ids[0])!.playerId)).toEqual(["p2"]);
    const h = new History(s);
    const next = h.run(fillScoreTempo());
    expect(texts(next)).toEqual(["t120 c4 t90 d4", "t120e4 t90f4", "g2"]);
    expect(scoresMissingTempo(next)).toEqual([]);
    expect(next.tempo).toEqual(s.tempo);
    expect(mirrored(next)).toBe(true);
    expect(h.undo()).toBe(s);
  });

  it("새 템포는 악보마다 적고, 고치면 모든 악보 글이 같이 바뀐다", () => {
    const s = twoScores("t120 c4 d4", "t120 e4 f4");
    const added = setTempoAt(rat(1, 4), 100).apply(s);
    expect(texts(added)).toEqual(["t120 c4 t100d4", "t120 e4 t100f4"]);
    const changed = setTempoAt(rat(1, 4), 80).apply(added);
    expect(texts(changed)).toEqual(["t120 c4 t80d4", "t120 e4 t80f4"]);
    expect(texts(removeTempoAt(rat(1, 4)).apply(changed))).toEqual(["t120 c4 d4", "t120 e4 f4"]);
  });

  it("글자 수 줄이기도 악보마다 템포를 적는다", () => {
    const s = twoScores("t120 c4 d4", "e4 f4");
    const next = compactSong().apply(s);
    for (const t of next.tracks) expect(parseMml(t.mml!.text).tempo.map((e) => e.bpm)).toEqual([120]);
  });
});

describe("공개 전 점검: 악보마다 템포", () => {
  it("오르골 6트랙(악보 3+3)은 뒤쪽 악보도 템포가 빠졌다고 알리고, 템포 넣기는 뒤쪽 악보 원문에도 적는다 (#5)", () => {
    const base = songOf("t150 c4 d4", "e2", "g2", "c2", "e4 f4", "g2");
    const s: Song = { ...base, players: [{ id: "p1", name: "오르골", instrument: { canonical: "music-box" } }] };
    expect(scoresMissingTempo(s)).toEqual([["t4", "t5", "t6"]]);
    const h = new History(s);
    const next = h.run(fillScoreTempo());
    expect(texts(next)[3]).toBe("t150c2");
    expect(scoresMissingTempo(next)).toEqual([]);
    // 새 템포도 두 악보에 모두
    const more = h.run(setTempoAt(rat(1, 4), 90));
    expect(texts(more).filter((t) => t?.includes("t90")).length).toBe(2);
    expect(mirrored(more)).toBe(true);
  });

  it("모든 트랙에서 음 가운데인 템포는 음을 버리지 않고 뒤쪽 음 경계에 적는다 (#2)", () => {
    const s = songOf("t150 c48 t90 e48", { text: "c64 d64 e64", notesOnly: true });
    const two: Song = {
      ...s,
      players: [...s.players, { id: "p2", name: "플루트", instrument: { canonical: "flute" } }],
      tracks: s.tracks.map((t, k) => (k === 0 ? t : { ...t, playerId: "p2" })),
    };
    const text = trackSource(two, two.tracks[1]!).text;
    const parsed = parseMml(text);
    expect(parsed.notes.map((n) => n.pitch)).toEqual([60, 62, 64]);
    // t90은 d가 끝나는 1/32에
    expect(parsed.tempo.map((e) => [e.bpm, e.at])).toEqual([
      [150, rat(0)],
      [90, rat(1, 32)],
    ]);
    expect(scoresMissingTempo(two)).toEqual([]);
    expect(tempoMismatch(two)).toBe(false);
  });
});

describe("공개 전 재점검: 옮겨 적은 템포와 원문", () => {
  /** 두 연주자(악보): 첫 트랙은 p1, 나머지는 p2 */
  function split2(s: Song): Song {
    return {
      ...s,
      players: [...s.players, { id: "p2", name: "플루트", instrument: { canonical: "flute" } }],
      tracks: s.tracks.map((t, k) => (k === 0 ? t : { ...t, playerId: "p2" })),
    };
  }

  it("옮겨 적은 t도 그 템포로 고치고 지우며, 음 하나를 고쳐도 지운 템포가 되살아나지 않는다 (#1)", () => {
    // 악보 2 원문에 1/48 템포를 음 경계 1/32에 옮겨 적은 t (파일을 다시 열었을 때와 같다)
    const s = split2(songOf("t150 c48 t90 e48", "t150 c64 d64 t90 e64"));
    expect(s.tempo.map((e) => [e.bpm, e.at])).toEqual([
      [150, rat(0)],
      [90, rat(1, 48)],
      [90, rat(1, 32)],
    ]);
    const read: Song = { ...s, tempo: s.tempo.slice(0, 2) };
    expect(tempoMismatch(read)).toBe(false);
    expect(scoresMissingTempo(read)).toEqual([]);
    const h = new History(read);
    const changed = h.run(setTempoAt(rat(1, 48), 100));
    expect(texts(changed)).toEqual(["t150 c48 t100 e48", "t150 c64 d64 t100 e64"]);
    const removed = h.run(removeTempoAt(rat(1, 48)));
    expect(texts(removed)).toEqual(["t150 c48 e48", "t150 c64 d64 e64"]);
    const edited = h.run(setTrackText("t2", "t150 c64 d64 f64"));
    expect(edited.tempo).toEqual([{ at: rat(0), bpm: 150 }]);
  });

  it("같은 빠르기를 일부러 다시 적은 t는 지도에 남아, 앞 템포를 고쳐도 원문과 재생이 같다 (#2)", () => {
    const s = songOf("t150 c4 t150 d4 t90 e4");
    expect(s.tempo).toHaveLength(3);
    const next = new History(s).run(setTempoAt(rat(0), 100));
    expect(texts(next)).toEqual(["t100 c4 t150 d4 t90 e4"]);
    expect(next.tempo.map((e) => e.bpm)).toEqual([100, 150, 90]);
    expect(tempoMismatch(next)).toBe(false);
  });

  it("뒤 템포를 지우거나 옮기면 그 때문에 들리지 않던 앞 템포를 그 악보에 다시 적는다 (#3)", () => {
    const s = split2(songOf("t150 c48 t90 e48", "c64 d64 t100 e64 f64"));
    const h = new History(s);
    const filled = h.run(fillScoreTempo());
    expect(scoresMissingTempo(filled)).toEqual([]);
    // 악보 2에서 t90(1/48)은 음 경계 1/32로 옮겨야 하는데 그 자리에 t100이 있어 쓰지 않았다
    const bpms = (song: Song) => parseMml(trackSource(song, song.tracks[1]!).text).tempo.map((e) => e.bpm);
    expect(bpms(filled)).toEqual([150, 100]);
    const removed = h.run(removeTempoAt(rat(1, 32)));
    expect(bpms(removed)).toEqual([150, 90]);
    expect(scoresMissingTempo(removed)).toEqual([]);
    h.undo();
    const moved = h.run(moveTempo(rat(1, 32), rat(1, 16)));
    expect(bpms(moved)).toEqual([150, 90, 100]);
    expect(scoresMissingTempo(moved)).toEqual([]);
  });

  it("원문 있는 트랙과 없는 트랙이 섞인 악보는 원문 없는 트랙이 템포를 받아 빠진 것으로 세지 않는다 (#4)", () => {
    const s = songOf({ text: "c64 d64 e64", notesOnly: true }, { text: "t150 c48 t90 e48", notesOnly: true });
    expect(scoresMissingTempo(s)).toEqual([]);
    const mixed = songOf("c64 d64 e64", { text: "t150 c48 t90 e48", notesOnly: true });
    expect(mixed.tempo).toHaveLength(2);
    expect(scoresMissingTempo(mixed)).toEqual([]);
    const second = parseMml(trackSource(mixed, mixed.tracks[1]!).text);
    expect(second.tempo.map((e) => [e.bpm, e.at])).toEqual([
      [150, rat(0)],
      [90, rat(1, 48)],
    ]);
  });

  it("점검 재현 그대로: 채우기 → 고치기 → 지우기 → 음 하나 고치기에서 지운 템포가 돌아오지 않는다 (#1)", () => {
    const h = new History(split2(songOf("t150 c48 t90 e48", "c64 d64 e64")));
    h.run(fillScoreTempo());
    h.run(setTempoAt(rat(1, 48), 100));
    const removed = h.run(removeTempoAt(rat(1, 48)));
    const second = removed.tracks[1]!;
    const text = trackSource(removed, second).text;
    expect(text).not.toMatch(/t90|t100/);
    const edited = h.run(setTrackText(second.id, text.replace(/e$/, "f")));
    expect(edited.tempo).toEqual([{ at: rat(0), bpm: 150 }]);
  });
});


describe("beta.8 점검: 옮긴 트랙의 악보 템포 (PR #91)", () => {
  const split = { solo: (c: string) => c === "music-box", name: () => "플루트 1", limit: 6 };

  it("원문만 있는 트랙을 오르골 악보에서 떼어 내면 새 악보 원문에도 곡 템포를 적는다", () => {
    const base = songOf("t90c4", "d4");
    const s: Song = { ...base, tracks: base.tracks.map((t, k) => (k === 1 ? { ...t, instrument: { canonical: "flute" } } : t)) };
    const h = new History(s);
    const next = h.run(keepScoreTempo(setPlayerInstrument("p1", "music-box", undefined, "악기", split)));
    expect(next.players.length).toBe(2);
    expect(texts(next)).toEqual(["t90c4", "t90d4"]);
    expect(scoresMissingTempo(next)).toEqual([]);
    expect(mirrored(next)).toBe(true);
    expect(h.undo()).toBe(s);
    // 감싸지 않으면 새 악보 글에 템포가 빠진다 (점검 재현)
    expect(scoresMissingTempo(setPlayerInstrument("p1", "music-box", undefined, "악기", split).apply(s)).length).toBe(1);
  });

  it("새 악보로 옮기기도 같고, 옮기기 전부터 빠져 있던 악보는 그대로 둔다", () => {
    const s = songOf("t90c4", "d4");
    expect(texts(keepScoreTempo(moveTrackToNewPlayer("t2", "새 악보")).apply(s))).toEqual(["t90c4", "t90d4"]);
    // p1·p2 둘 다 템포가 있고 p3만 원래 빠진 곡: p3는 손대지 않는다
    const three: Song = {
      ...songOf("t90c4", "t90d4", "e4"),
      players: [
        { id: "p1", name: "a", instrument: { canonical: "piano" } },
        { id: "p2", name: "b", instrument: { canonical: "piano" } },
        { id: "p3", name: "c", instrument: { canonical: "piano" } },
      ],
    };
    const placed: Song = { ...three, tracks: three.tracks.map((t, k) => ({ ...t, playerId: `p${k + 1}` })) };
    const changed = keepScoreTempo(setPlayerInstrument("p3", "flute")).apply(placed);
    expect(changed).not.toBe(placed);
    expect(texts(changed)).toEqual(["t90c4", "t90d4", "e4"]);
  });

  it("오르골 3+3 묶음 경계를 넘는 위·아래 옮기기도 템포를 적는다 (#97 점검 2번)", () => {
    const base = songOf("t90c4", "d4", "e4", "t90f4", "g4", "a4");
    const s: Song = { ...base, players: [{ id: "p1", name: "오르골", instrument: { canonical: "music-box" } }] };
    expect(scoresMissingTempo(shiftTrack("t4", -1).apply(s)).length).toBe(1);
    const next = keepScoreTempo(shiftTrack("t4", -1)).apply(s);
    expect(scoresMissingTempo(next)).toEqual([]);
    expect(mirrored(next)).toBe(true);
  });
});
