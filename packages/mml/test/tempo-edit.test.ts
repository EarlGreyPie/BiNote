import { describe, expect, it } from "vitest";
import { emptySong, History, MOBILE_PROFILE, normalizeTempo, rat, type Song } from "@mmlce/core";
import { changedBpm, changeTempos, changeTemposResult, compactSong, fillScoreTempo, keepScoreTempo, moveTempo, parseMml, parseTrackText, scoresMissingTempo, removeTempoAt, setTempoAt, setTempos, setTrackText, tempoChangeTargets, tempoInsertOffset, tempoMismatch, trackSource } from "../src/index.js";
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

  it("악보 끝 자리와 그 뒤 템포는 비교하지 않는다: 글자 수 줄이기 뒤 오탐이 없다 (PR122 점검)", () => {
    const s = songOf("t100c1r1t120");
    expect(tempoMismatch(s)).toBe(false);
    const compact = compactSong(MOBILE_PROFILE).apply(s);
    const text = trackSource(compact, compact.tracks[0]!).text;
    expect(text).toBe("t100c1r1t100");
    expect(parseMml(text).gameEnd).toEqual(rat(2));
    expect(tempoMismatch(compact)).toBe(false);
    // 원문 없는 트랙이 섞여도 같다
    const { mml: _mml, ...bare } = compact.tracks[0]!;
    const mixed = { ...compact, tracks: [...compact.tracks, { ...bare, id: "x", notes: parseTrackText("x", { text: "e1" }).notes }] };
    expect(tempoMismatch(mixed)).toBe(false);
  });

  it("악보 안의 진짜 어긋남은 그대로 잡는다", () => {
    const s = songOf("t100c1t130c1");
    expect(tempoMismatch({ ...s, tempo: [{ at: rat(0), bpm: 100 }] })).toBe(true);
    // 다른 악보가 계속 울리는 자리의 지도 템포는 들린다
    const two = songOf("t100c1r1t120", "t100c1c1c1");
    expect(tempoMismatch({ ...two, tracks: [two.tracks[0]!, { ...two.tracks[1]!, playerId: "p2" }], players: [...two.players, { id: "p2", name: "", instrument: { canonical: "flute" } }] })).toBe(true);
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
    // t100을 옮긴 1/16은 악보 2가 끝난 자리라 그 악보에는 쓰지 않는다 (악보가 끝난 뒤 템포는 쓰지 않는다)
    expect(bpms(moved)).toEqual([150, 90]);
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

describe("템포 한꺼번에 바꾸기", () => {
  it("곡 전체를 %로 바꾸면 지도와 모든 원문의 t가 함께 바뀐다", () => {
    const s = changeTempos({ mode: "scale", value: 150 }).apply(songOf("t100 c2 t80 c2", "t100 r2 t80 e2"));
    expect(texts(s)).toEqual(["t150 c2 t120 c2", "t150 r2 t120 e2"]);
    expect(s.tempo).toEqual([{ at: rat(0), bpm: 150 }, { at: rat(1, 2), bpm: 120 }]);
    expect(mirrored(s)).toBe(true);
  });

  it("모두 한 값으로 바꾸고 ±BPM은 반올림한 정수, 1~999 안", () => {
    const s = changeTempos({ mode: "set", value: 90 }).apply(songOf("t100 c2 t80 c2"));
    expect(texts(s)).toEqual(["t90 c2 t90 c2"]);
    const low = changeTempos({ mode: "add", value: -200 }).apply(songOf("t100 c2"));
    expect(low.tempo).toEqual([{ at: rat(0), bpm: 1 }]);
  });

  it("템포가 하나도 없던 곡은 곡 처음에 바꾼 템포를 넣는다 (기본 t120)", () => {
    const s = changeTempos({ mode: "add", value: 10 }).apply(songOf("c2 d2"));
    expect(s.tempo).toEqual([{ at: rat(0), bpm: 130 }]);
    expect(mirrored(s)).toBe(true);
  });

  it("구간만 바꾸면 구간 처음에 바꾼 템포, 끝에 원래 템포를 넣고 밖은 그대로 둔다", () => {
    const s = changeTempos({ mode: "set", value: 60 }, rat(1, 4), rat(3, 4)).apply(songOf("t100 c4 d4 e4 f4"));
    expect(s.tempo).toEqual([{ at: rat(0), bpm: 100 }, { at: rat(1, 4), bpm: 60 }, { at: rat(3, 4), bpm: 100 }]);
    expect(texts(s)).toEqual(["t100 c4 t60d4 e4 t100f4"]);
    expect(mirrored(s)).toBe(true);
  });

  it("구간 안 t만 고치고 구간 끝 뒤에 음이 없으면 끝 템포를 넣지 않는다", () => {
    const s = changeTempos({ mode: "add", value: 20 }, rat(1, 2), rat(1)).apply(songOf("t100 c2 t80 c2"));
    expect(texts(s)).toEqual(["t100 c2 t100 c2"]);
    expect(s.tempo).toEqual([{ at: rat(0), bpm: 100 }, { at: rat(1, 2), bpm: 100 }]);
  });

  it("실행 취소 한 칸으로 되돌린다", () => {
    const h = new History(songOf("t100 c2 t80 c2"));
    h.run(changeTempos({ mode: "scale", value: 50 }));
    expect(texts(h.song)).toEqual(["t50 c2 t40 c2"]);
    h.undo();
    expect(texts(h.song)).toEqual(["t100 c2 t80 c2"]);
  });

  it("바뀌는 게 없으면 곡을 그대로 돌려준다", () => {
    const song = songOf("t100 c2");
    expect(changeTempos({ mode: "scale", value: 100 }).apply(song)).toBe(song);
  });
});

describe("PR #106 Codex 점검: 구간 경계 템포", () => {
  /** 원문마다 다른 악보(연주자)인 곡 */
  function scoresOf(...texts: string[]): Song {
    const base = songOf(...texts);
    return {
      ...base,
      players: texts.map((_, k) => ({ id: `p${k + 1}`, name: "피아노", instrument: { canonical: "piano" as const } })),
      tracks: base.tracks.map((t, k) => ({ ...t, playerId: `p${k + 1}` })),
    };
  }

  it("구간 끝 뒤에 같은 값 t가 있어도 끝 자리에 원래 템포를 적는다", () => {
    const s = changeTempos({ mode: "set", value: 60 }, rat(1, 4), rat(1, 2)).apply(scoresOf("t100 c4 t80 d4 e4 f4 g1", "t100 c4 t80 d4 e4 t80 f4 g1"));
    expect(s.tempo).toEqual([{ at: rat(0), bpm: 100 }, { at: rat(1, 4), bpm: 60 }, { at: rat(1, 2), bpm: 80 }, { at: rat(3, 4), bpm: 80 }]);
    for (const t of s.tracks) expect(parseMml(t.mml!.text).tempo).toContainEqual({ at: rat(1, 2), bpm: 80 });
    expect(texts(s)[1]).toBe("t100 c4 t60 d4 t80e4 t80 f4 g1");
    expect(mirrored(s)).toBe(true);
  });

  it("구간 처음 뒤에 바꾼 값과 같은 t가 생겨도 처음 자리에 바꾼 템포를 적는다", () => {
    const s = changeTempos({ mode: "set", value: 60 }, rat(1, 4), rat(3, 4)).apply(songOf("t100 c4 d4 t80 e4 f4 g1"));
    expect(s.tempo).toEqual([{ at: rat(0), bpm: 100 }, { at: rat(1, 4), bpm: 60 }, { at: rat(1, 2), bpm: 60 }, { at: rat(3, 4), bpm: 80 }]);
    const tempo = parseMml(s.tracks[0]!.mml!.text).tempo;
    expect(tempo).toContainEqual({ at: rat(1, 4), bpm: 60 });
    expect(tempo).toContainEqual({ at: rat(3, 4), bpm: 80 });
    expect(mirrored(s)).toBe(true);
  });
});

describe("PR #106 Codex 재점검: 원문을 버리지 않는 구간 경계", () => {
  it("빠르기가 그대로인 경계에는 t를 넣지 않고 끝 쉼표도 남긴다", () => {
    const song = songOf("t100c2d4t80e4r4r4");
    const s = changeTempos({ mode: "set", value: 100 }, rat(1, 4), rat(1)).apply(song);
    expect(texts(s)).toEqual(["t100c2d4t100e4r4r4"]);
    expect(parseMml(s.tracks[0]!.mml!.text).end).toEqual(parseMml(song.tracks[0]!.mml!.text).end);
    expect(mirrored(s)).toBe(true);
  });

  it("한 악보 여러 트랙에서 경계 자리에 음 경계가 없으면 음을 &로 나눠 t를 적는다", () => {
    const song = songOf("t100c1d1", "t100e2t80f2g1");
    const s = changeTempos({ mode: "set", value: 60 }, rat(1, 4), rat(3, 4)).apply(song);
    for (const t of s.tracks) expect(t.mml).toBeDefined();
    const tempo = s.tracks.flatMap((t) => parseMml(t.mml!.text).tempo);
    expect(tempo).toContainEqual({ at: rat(1, 4), bpm: 60 });
    expect(tempo).toContainEqual({ at: rat(3, 4), bpm: 80 });
    expect(texts(s)).toEqual(["t100c4&t60c2&t80c4d1", "t100e2t60f2g1"]);
    // 음은 그대로 (나눈 음은 &로 이어진다)
    expect(s.tracks.map((t) => parseTrackText(t.id, t.mml!).notes.length)).toEqual(song.tracks.map((t) => parseTrackText(t.id, t.mml!).notes.length + (t.id === "t1" ? 2 : 0)));
    expect(s.tracks[0]!.notes).toEqual(parseTrackText("t1", s.tracks[0]!.mml!).notes);
    expect(mirrored(s)).toBe(true);
  });

  it("경계에 걸친 쉼표는 둘로 나눠 사이에 적는다", () => {
    const s = changeTempos({ mode: "set", value: 60 }, rat(1, 4)).apply(songOf("t100 r2 c2"));
    expect(texts(s)).toEqual(["t100 r4t60r4 c2"]);
  });

  it("원문 없는 트랙이 있는 악보도 경계 뒤 같은 값 t를 경계로 보지 않는다", () => {
    const base = songOf("t100 c4 t80 d4 e4 t80 f4 g1", { text: "r2 g2", notesOnly: true });
    const s = changeTempos({ mode: "set", value: 60 }, rat(1, 4), rat(1, 2)).apply(base);
    expect(parseMml(s.tracks[0]!.mml!.text).tempo).toContainEqual({ at: rat(1, 2), bpm: 80 });
    expect(mirrored(s)).toBe(true);
  });

  it("음이 모두 끝난 뒤 구간만 바꾸면 경계를 만들지 않는다", () => {
    const song = songOf("t100c1");
    expect(changeTempos({ mode: "set", value: 60 }, rat(2), rat(3)).apply(song)).toBe(song);
  });
});

describe("PR #106 Codex 3차 점검: 끝난 악보의 원문을 늘이지 않기", () => {
  function scoresOf(...texts: string[]): Song {
    const base = songOf(...texts);
    return {
      ...base,
      players: texts.map((_, k) => ({ id: `p${k + 1}`, name: "피아노", instrument: { canonical: "piano" as const } })),
      tracks: base.tracks.map((t, k) => ({ ...t, playerId: `p${k + 1}` })),
    };
  }

  it("먼저 끝난 악보의 원문은 늘이지 않고, 끝 쉼표가 있는 악보의 원문은 그대로 둔다", () => {
    const s = changeTempos({ mode: "set", value: 60 }, rat(1, 2)).apply(scoresOf("t100c4", "t100d2e2r4r4"));
    expect(texts(s)).toEqual(["t100c4", "t100d2t60e2r4r4"]);
    expect(tempoMismatch(s)).toBe(false);
  });

  it("마지막 쉼표를 나눠 게임 길이를 늘리지 않는다", () => {
    const song = scoresOf("t100c4r1", "t100e1f1");
    const s = changeTempos({ mode: "set", value: 60 }, rat(1, 2)).apply(song);
    expect(texts(s)[0]).toBe("t100c4r1");
    expect(parseMml(texts(s)[0]!).gameEnd).toEqual(parseMml("t100c4r1").gameEnd);
  });
});

describe("템포 한꺼번에 바꾸기 점검 (지시문 9)", () => {
  function scoresOf(...scores: string[][]): Song {
    const base = songOf(...scores.flat());
    let k = 0;
    const owner = scores.flatMap((texts, p) => texts.map(() => `p${p + 1}`));
    return {
      ...base,
      players: scores.map((_, p) => ({ id: `p${p + 1}`, name: "피아노", instrument: { canonical: "piano" as const } })),
      tracks: base.tracks.map((t) => ({ ...t, playerId: owner[k++]! })),
    };
  }

  it("1. 한 악보가 경계 템포를 넣지 못하면 다른 악보가 바뀌어도 그 악보와 까닭을 알려 준다", () => {
    const song = scoresOf(["t100c4r4", "t100l1n48n50"], ["t100c1d1"]);
    const { song: next, failed } = changeTemposResult(song, { mode: "set", value: 60 }, rat(1, 2), rat(3, 4));
    expect(texts(next).slice(0, 2)).toEqual(["t100c4r4", "t100l1n48n50"]);
    expect(texts(next)[2]).not.toBe("t100c1d1");
    expect(failed).toEqual([{ score: 0, reasons: ["length", "n-note"] }]);
    // 명령도 같은 곡을 만든다
    expect(texts(changeTempos({ mode: "set", value: 60 }, rat(1, 2), rat(3, 4)).apply(song))).toEqual(texts(next));
  });

  it("2. 모두 이 값으로: 지도 값이 같아도 어긋난 원문 t를 맞춘다", () => {
    const base = scoresOf(["t90c1"], ["t100c1"]);
    const song = { ...base, tempo: [{ at: rat(0), bpm: 100 }] };
    const targets = tempoChangeTargets(song);
    expect([...targets.bpms].sort((a, b) => a - b)).toEqual([90, 100]);
    const next = changeTempos({ mode: "set", value: 100 }).apply(song);
    expect(next).not.toBe(song);
    expect(texts(next)).toEqual(["t100c1", "t100c1"]);
  });

  it("3. 겹쳐 쓴 t(t250t100)도 미리보기 목록에 들어가 바뀐 값이 범위를 넘는지 셀 수 있다", () => {
    const song = songOf("t250t100v9c1");
    const { bpms } = tempoChangeTargets(song);
    expect([...bpms].sort((a, b) => a - b)).toEqual([100, 250]);
    const after = bpms.map((b) => changedBpm(b, { mode: "add", value: 10 }));
    expect(after.filter((b) => b > MOBILE_PROFILE.tempo.max)).toEqual([260]);
    expect(texts(changeTempos({ mode: "add", value: 10 }).apply(song))).toEqual(["t260t110v9c1"]);
  });
});
