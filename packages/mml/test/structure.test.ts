import { describe, expect, it } from "vitest";
import { assignTab, History, MOBILE_PROFILE, planSlide, rat, replaceSong, trackInstrument, type Command } from "@mmlce/core";
import { addPlayer, addTrack, addTrackWithNotes, duplicateTrack, duplicateTrackToNewPlayer, moveTrack, moveTrackToNewPlayer, newSong, shiftTrack, trackMoveBlock, planMergeTracks, planMoveNotes, planVoiceByPitch, removeTrack, renamePlayer, renameTrack, setMeter, setPlayerInstrument, setPlayerTab, setTrackInstrument, setTrackPack, setNotesAndAddTracks, blockedSplitBack } from "../src/index.js";
import { optimizeMml, setTracksNotes } from "../src/index.js";

const fresh = () => newSong({ playerName: "피아노", trackName: "트랙 1" });

describe("악보 구성", () => {
  it("새 악보는 피아노 연주자 하나, 빈 트랙 하나, t120 4/4", () => {
    const s = fresh();
    expect(s.players).toEqual([{ id: "p1", name: "피아노", instrument: { canonical: "piano", program: 21 } }]);
    expect(s.tracks.map((t) => [t.id, t.playerId, t.notes.length])).toEqual([["t1", "p1", 0]]);
    expect(s.tempo).toEqual([]);
    expect(s.timeSig[0]).toMatchObject({ beats: 4, unit: 4 });
  });

  it("트랙은 그 연주자 끝에 붙고, 연주자를 더하면 빈 트랙도 함께 생긴다", () => {
    const h = new History(fresh());
    h.run(addPlayer("flute", "플루트 1", "트랙 1"));
    const s = h.run(addTrack("p1", "트랙 2"));
    expect(s.tracks.map((t) => [t.id, t.playerId])).toEqual([["t1", "p1"], ["t3", "p1"], ["t2", "p2"]]);
    expect(s.players[1]!.instrument).toEqual({ canonical: "flute", program: 5 });
  });

  it("트랙을 더하며 음을 넣고, 실행 취소 한 번에 둘 다 되돌린다", () => {
    const h = new History(fresh());
    const note = { id: "x", start: rat(0), dur: rat(1, 8), pitch: 60, vol: 8, tie: "none" as const };
    const s = h.run(addTrackWithNotes("p1", "트랙 2", [note]));
    expect(s.tracks.map((t) => [t.id, t.notes.map((n) => n.pitch)])).toEqual([["t1", []], ["t2", [60]]]);
    expect(h.undo().tracks.map((t) => t.id)).toEqual(["t1"]);
    // 악기를 주면 새 트랙도 그 악기, 안 주면 악보 악기를 따른다
    const guitar = { canonical: "guitar" };
    const g = new History(fresh()).run(addTrackWithNotes("p1", "트랙 2", [note], "트랙 추가", guitar));
    expect(g.tracks[1]!.instrument).toEqual(guitar);
    expect(s.tracks[1]!.instrument).toBeUndefined();
  });

  it("마지막 트랙을 지우면 연주자도 지우고, 실행 취소로 되돌린다", () => {
    const h = new History(fresh());
    h.run(addPlayer("harp", "하프 1", "트랙 1"));
    const s = h.run(removeTrack("t2"));
    expect(s.players.map((p) => p.id)).toEqual(["p1"]);
    expect(h.run(addTrack("p1", "트랙 2")).tracks.map((t) => t.id)).toEqual(["t1", "t2"]);
    h.undo();
    expect(h.undo().players.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("악기를 바꾸면 이름이 악기 이름 그대로일 때만 이름도 바꾼다", () => {
    const s = setPlayerInstrument("p1", "lute", { from: "피아노", to: "류트" }).apply(fresh());
    expect(s.players[0]).toMatchObject({ name: "류트", instrument: { canonical: "lute", program: 0 } });
    const named = { ...fresh(), players: [{ ...fresh().players[0]!, name: "오른손" }] };
    expect(setPlayerInstrument("p1", "lute", { from: "피아노", to: "류트" }).apply(named).players[0]!.name).toBe("오른손");
  });
});

describe("박자 바꾸기", () => {
  it("처음 박자를 바꾸고, 곡 중간부터 바꾸고, 앞과 같아지면 그 바뀜을 지운다", () => {
    const a = setMeter(rat(0), 3, 4).apply(fresh());
    expect(a.timeSig).toEqual([{ at: rat(0), beats: 3, unit: 4 }]);
    const b = setMeter(rat(3), 6, 8).apply(a);
    expect(b.timeSig.map((s) => [s.at, s.beats, s.unit])).toEqual([[rat(0), 3, 4], [rat(3), 6, 8]]);
    expect(setMeter(rat(3), 3, 4).apply(b).timeSig).toEqual(a.timeSig);
  });
});

describe("이름 바꾸기", () => {
  it("트랙·악보 이름을 바꾸고, 빈 이름은 무시한다", () => {
    const s = renamePlayer("p1", " 오른손 ").apply(renameTrack("t1", "멜로디").apply(fresh()));
    expect([s.tracks[0]!.name, s.players[0]!.name]).toEqual(["멜로디", "오른손"]);
    expect(renameTrack("t1", "  ").apply(s)).toBe(s);
  });
});

describe("트랙 악기", () => {
  it("트랙만 다른 악기로 바꾸고, 악보 악기와 같게 고르면 따로 정한 것을 지운다", () => {
    const s = setTrackInstrument("t1", "flute").apply(fresh());
    expect(trackInstrument(s, s.tracks[0]!)).toEqual({ canonical: "flute", program: 5 });
    const back = setTrackInstrument("t1", "piano").apply(s);
    expect(back.tracks[0]!.instrument).toBeUndefined();
    expect(trackInstrument(back, back.tracks[0]!).canonical).toBe("piano");
  });
});

describe("오르골·축음기 악보의 트랙 악기", () => {
  const split = {
    solo: (c: string) => c === "music-box" || c === "gramophone",
    name: (s: { players: readonly { instrument: { canonical: string } }[] }, c: string) => `${c} ${s.players.filter((p) => p.instrument.canonical === c).length + 1}`,
    limit: 6,
  };
  /** 피아노 악보 6트랙: 1~3 악보 악기, 4 플루트, 5 류트, 6 플루트 */
  const sixTracks = () => {
    let s = fresh();
    for (let i = 2; i <= 6; i++) s = addTrack("p1", `트랙 ${i}`).apply(s);
    const ids = s.tracks.map((t) => t.id);
    s = setTrackInstrument(ids[3]!, "flute").apply(s);
    s = setTrackInstrument(ids[4]!, "lute").apply(s);
    return { song: setTrackInstrument(ids[5]!, "flute").apply(s), ids };
  };

  it("악보를 오르골로 바꾸면 다른 악기 트랙은 새 악보 하나로 모이고, 나머지는 오르골에 남는다", () => {
    const { song, ids } = sixTracks();
    const s = setPlayerInstrument("p1", "music-box", undefined, "악기", split).apply(song);
    expect(s.players.map((p) => [p.id, p.name, p.instrument.canonical])).toEqual([
      ["p1", "피아노", "music-box"],
      ["p2", "flute 1", "flute"],
    ]);
    expect(s.tracks.map((t) => [t.id, t.playerId, t.instrument?.canonical])).toEqual([
      [ids[0], "p1", undefined],
      [ids[1], "p1", undefined],
      [ids[2], "p1", undefined],
      [ids[3], "p2", undefined],
      [ids[4], "p2", "lute"],
      [ids[5], "p2", undefined],
    ]);
    // 소리는 그대로: 떼어 낸 트랙은 고른 악기 그대로 친다
    expect(s.tracks.slice(3).map((t) => trackInstrument(s, t).canonical)).toEqual(["flute", "lute", "flute"]);
  });

  it("split을 주지 않거나, 다른 악기 트랙이 없거나, 보통 악기로 바꾸면 트랙은 그대로", () => {
    const { song } = sixTracks();
    expect(setPlayerInstrument("p1", "music-box").apply(song).tracks).toEqual(song.tracks);
    expect(setPlayerInstrument("p1", "harp", undefined, "악기", split).apply(song).tracks).toEqual(song.tracks);
    const plain = setPlayerInstrument("p1", "gramophone", undefined, "악기", split).apply(fresh());
    expect(plain.players).toHaveLength(1);
  });

  it("악보 악기와 같은 트랙 악기는 지우고, 다 다른 악기면 오르골 악보는 없어진다", () => {
    let s = addTrack("p1", "트랙 2").apply(fresh());
    s = setTrackInstrument("t1", "music-box").apply(s);
    s = setTrackInstrument("t2", "flute").apply(s);
    const a = setPlayerInstrument("p1", "music-box", undefined, "악기", split).apply(s);
    expect(a.tracks.map((t) => [t.id, t.playerId, t.instrument])).toEqual([
      ["t1", "p1", undefined],
      ["t2", "p2", undefined],
    ]);
    const only = setPlayerInstrument("p1", "music-box", undefined, "악기", split).apply(setTrackInstrument("t1", "flute").apply(fresh()));
    expect(only.players.map((p) => p.instrument.canonical)).toEqual(["flute"]);
  });

  it("오르골 악보의 트랙에 다른 악기를 고르면 새 악보로, 보통 악보 트랙에 축음기를 고르면 축음기 악보로", () => {
    const box = setPlayerInstrument("p1", "music-box").apply(addTrack("p1", "트랙 2").apply(fresh()));
    const a = setTrackInstrument("t2", "flute", "악기", split).apply(box);
    expect(a.tracks.map((t) => [t.id, t.playerId])).toEqual([["t1", "p1"], ["t2", "p2"]]);
    expect(a.players[1]!.instrument.canonical).toBe("flute");
    const piano = addTrack("p1", "트랙 2").apply(fresh());
    const b = setTrackInstrument("t2", "gramophone", "악기", split).apply(piano);
    expect(b.players.map((p) => p.instrument.canonical)).toEqual(["piano", "gramophone"]);
    expect(b.tracks.map((t) => [t.id, t.playerId, t.instrument])).toEqual([["t1", "p1", undefined], ["t2", "p2", undefined]]);
    // 보통 악보의 보통 악기 트랙은 그대로 한 악보에 (첫 연주자 + 한 명씩)
    expect(setTrackInstrument("t2", "flute", "악기", split).apply(piano).players).toHaveLength(1);
  });

  it("새 악보에 모을 때 팩·번호가 다른 같은 악기는 트랙 악기로 남긴다", () => {
    let s = addTrack("p1", "트랙 2").apply(addTrack("p1", "트랙 3").apply(fresh()));
    const ids = s.tracks.map((t) => t.id);
    s = setTrackInstrument(ids[1]!, "flute").apply(s);
    s = { ...s, tracks: s.tracks.map((t) => (t.id === ids[2] ? { ...t, instrument: { canonical: "flute", packId: "extra", program: 517 } } : t)) };
    const a = setPlayerInstrument("p1", "music-box", undefined, "악기", split).apply(s);
    expect(a.tracks.map((t) => [t.playerId, t.instrument])).toEqual([
      ["p1", undefined],
      ["p2", undefined],
      ["p2", { canonical: "flute", packId: "extra", program: 517 }],
    ]);
  });

  it("축음기로 바꿨다가 보통 악기로 돌리면 떼어 냈던 트랙이 원래 악보로 돌아온다", () => {
    const { song, ids } = sixTracks();
    const box = setPlayerInstrument("p1", "gramophone", undefined, "악기", split).apply(song);
    expect(box.players.map((p) => [p.id, p.splitFrom])).toEqual([["p1", undefined], ["p2", "p1"]]);
    const back = setPlayerInstrument("p1", "guitar", undefined, "악기", split).apply(box);
    expect(back.players.map((p) => p.id)).toEqual(["p1"]);
    expect(back.tracks.map((t) => [t.id, t.playerId, t.instrument?.canonical])).toEqual([
      [ids[0], "p1", undefined],
      [ids[1], "p1", undefined],
      [ids[2], "p1", undefined],
      [ids[3], "p1", "flute"],
      [ids[4], "p1", "lute"],
      [ids[5], "p1", "flute"],
    ]);
    // 떼어 낸 악기와 같은 악기로 돌리면 그 트랙은 악보 악기를 따른다
    const flute = setPlayerInstrument("p1", "flute", undefined, "악기", split).apply(box);
    expect(flute.tracks.map((t) => t.instrument?.canonical)).toEqual([undefined, undefined, undefined, undefined, "lute", undefined]);
  });

  it("축음기 트랙은 원래 악보를 보통 악기로 바꿔도 돌려보내지 않는다", () => {
    const piano = addTrack("p1", "트랙 2").apply(fresh());
    const gram = setTrackInstrument("t2", "gramophone", "악기", split).apply(piano);
    expect(gram.players.map((p) => [p.instrument.canonical, p.splitFrom])).toEqual([["piano", undefined], ["gramophone", "p1"]]);
    expect(setPlayerInstrument("p1", "guitar", undefined, "악기", split).apply(gram).tracks.map((t) => t.playerId)).toEqual(["p1", "p2"]);
    // 떼어 낸 악보를 나중에 축음기로 바꿔도 마찬가지
    const { song } = sixTracks();
    const box = setPlayerInstrument("p1", "music-box", undefined, "악기", split).apply(song);
    const later = setPlayerInstrument("p2", "gramophone").apply(box);
    const back = setPlayerInstrument("p1", "piano", undefined, "악기", split).apply(later);
    // 축음기 악보의 트랙 악기 류트는 돌아오고, 축음기로 치는 두 트랙은 남는다
    expect(back.tracks.filter((t) => t.playerId === "p1").map((t) => t.instrument?.canonical)).toEqual([undefined, undefined, undefined, "lute"]);
    expect(back.tracks.filter((t) => t.playerId === "p2")).toHaveLength(2);
    // 떼어 낸 악보 안에서 트랙 악기만 축음기인 트랙은 남기고 나머지는 돌려보낸다
    const mixed = { ...box, tracks: box.tracks.map((t, i) => (i === 4 ? { ...t, instrument: { canonical: "gramophone" } } : t)) };
    const part = setPlayerInstrument("p1", "piano", undefined, "악기", split).apply(mixed);
    expect(part.tracks.filter((t) => t.playerId === "p1")).toHaveLength(5);
    expect(part.tracks.filter((t) => t.playerId === "p2").map((t) => t.instrument?.canonical)).toEqual(["gramophone"]);
  });

  it("돌려보내면 한도를 넘을 때, split을 주지 않을 때는 그대로 둔다", () => {
    const { song } = sixTracks();
    const box = setPlayerInstrument("p1", "music-box", undefined, "악기", split).apply(song);
    const full = addTrack("p1", "x").apply(addTrack("p1", "y").apply(addTrack("p1", "z").apply(box)));
    expect(setPlayerInstrument("p1", "piano", undefined, "악기", split).apply(full).players).toHaveLength(2);
    expect(setPlayerInstrument("p1", "piano").apply(box).players).toHaveLength(2);
  });

  it("한도로 돌아오지 못한 악보와 트랙 수를 알려 준다 (#96 점검 4번)", () => {
    const { song } = sixTracks();
    const box = setPlayerInstrument("p1", "music-box", undefined, "악기", split).apply(song);
    const full = addTrack("p1", "x").apply(box);
    const kept = setPlayerInstrument("p1", "piano", undefined, "악기", split).apply(full);
    expect(blockedSplitBack(kept, "p1", split)).toEqual([{ playerId: "p2", tracks: 3 }]);
    // 다 돌아오면 남은 것이 없다
    expect(blockedSplitBack(setPlayerInstrument("p1", "piano", undefined, "악기", split).apply(box), "p1", split)).toEqual([]);
  });

  it("A→B→C로 겹쳐 떼어 낸 뒤 B가 A로 다 돌아가면 C는 A를 원래 악보로 이어 받는다 (#96 점검 3번)", () => {
    const { song } = sixTracks();
    const box = setPlayerInstrument("p1", "music-box", undefined, "악기", split).apply(song);
    // B(p2)의 류트 트랙을 축음기로 → C(p3), splitFrom p2
    const lute = box.tracks.find((t) => t.instrument?.canonical === "lute")!;
    const nested = setTrackInstrument(lute.id, "gramophone", "악기", split).apply(box);
    expect(nested.players.map((p) => [p.id, p.splitFrom])).toEqual([["p1", undefined], ["p2", "p1"], ["p3", "p2"]]);
    const back = setPlayerInstrument("p1", "guitar", undefined, "악기", split).apply(nested);
    expect(back.players.map((p) => [p.id, p.splitFrom])).toEqual([["p1", undefined], ["p3", "p1"]]);
    // C를 보통 악기로 바꾼 뒤 A를 다시 바꾸면 C도 돌아온다
    const plain = setPlayerInstrument("p3", "harp").apply(back);
    expect(setPlayerInstrument("p1", "piano", undefined, "악기", split).apply(plain).players.map((p) => p.id)).toEqual(["p1"]);
  });

  it("C를 먼저 보통 악기로 바꾸고 A를 바꾸면 B와 C가 한 번에 돌아오고, 한도 알림은 없다 (#97 3차 점검)", () => {
    const { song } = sixTracks();
    const box = setPlayerInstrument("p1", "music-box", undefined, "악기", split).apply(song);
    const lute = box.tracks.find((t) => t.instrument?.canonical === "lute")!;
    const nested = setTrackInstrument(lute.id, "gramophone", "악기", split).apply(box);
    const plain = setPlayerInstrument("p3", "harp").apply(nested);
    const back = setPlayerInstrument("p1", "guitar", undefined, "악기", split).apply(plain);
    expect(back.players.map((p) => p.id)).toEqual(["p1"]);
    expect(back.tracks).toHaveLength(6);
    expect(blockedSplitBack(back, "p1", split)).toEqual([]);
    // C가 축음기 그대로면 B만 돌아오고 C는 A를 원래 악보로 이어 받아 남는다(돌아갈 트랙이 없어 알림도 없다)
    const stay = setPlayerInstrument("p1", "guitar", undefined, "악기", split).apply(nested);
    expect(stay.players.map((p) => [p.id, p.splitFrom])).toEqual([["p1", undefined], ["p3", "p1"]]);
    expect(blockedSplitBack(stay, "p1", split)).toEqual([]);
  });

  it("떼어 낸 악보를 지우면 그 악보를 가리키던 연결도 지운다 (같은 id로 만든 새 악보와 섞이지 않게)", () => {
    const { song } = sixTracks();
    const box = setPlayerInstrument("p1", "music-box", undefined, "악기", split).apply(song);
    const lute = box.tracks.find((t) => t.instrument?.canonical === "lute")!;
    const nested = setTrackInstrument(lute.id, "gramophone", "악기", split).apply(box);
    let s = nested;
    for (const t of nested.tracks.filter((tr) => tr.playerId === "p2")) s = removeTrack(t.id).apply(s);
    expect(s.players.map((p) => [p.id, p.splitFrom])).toEqual([["p1", undefined], ["p3", undefined]]);
  });

  it("실행 취소 한 번에 악기와 옮긴 트랙이 함께 돌아온다", () => {
    const { song } = sixTracks();
    const h = new History(song);
    h.run(setPlayerInstrument("p1", "music-box", undefined, "악기", split));
    expect(h.undo()).toEqual(song);
  });
});

describe("박자 바꾸기 경계", () => {
  it("박자표가 없던 곡의 중간을 바꾸면 처음은 4/4로 남긴다", () => {
    const empty = { ...fresh(), timeSig: [] };
    expect(setMeter(rat(1), 3, 4).apply(empty).timeSig.map((s) => [s.at, s.beats, s.unit])).toEqual([
      [rat(0), 4, 4],
      [rat(1), 3, 4],
    ]);
  });

  it("앞 박자와 같아도 마디 경계가 어긋나면 바뀜을 지우지 않는다", () => {
    // 0에 4/4, 2에 3/4 → 1을 3/4로: 2의 3/4는 1부터 센 마디 경계(1 + 3/4·k)가 아니라 남는다
    const s = { ...fresh(), timeSig: [{ at: rat(0), beats: 4, unit: 4 }, { at: rat(2), beats: 3, unit: 4 }] };
    expect(setMeter(rat(1), 3, 4).apply(s).timeSig.map((x) => x.at)).toEqual([rat(0), rat(1), rat(2)]);
  });
});

describe("음 옮기기·트랙 합치기", () => {
  const n = (id: string, start: number, dur: number, pitch = 60) => ({ id, start: rat(start, 4), dur: rat(dur, 4), pitch, vol: 8, tie: "none" as const });
  const two = () => {
    const s = new History(fresh()).run(addTrack("p1", "트랙 2"));
    return {
      ...s,
      tracks: s.tracks.map((t) =>
        t.id === "t1" ? { ...t, notes: [n("a", 0, 1), n("b", 1, 1, 64), n("c", 2, 1, 67)] } : { ...t, notes: [n("x", 1, 1, 72)] },
      ),
    };
  };

  it("고른 음을 다른 트랙으로 옮기고, 받는 트랙과 겹치는 음은 남긴다", () => {
    const plan = planMoveNotes(two(), "t1", new Set(["b", "c"]), "t2");
    expect([plan.moved, plan.blocked]).toEqual([1, 1]);
    const [t1, t2] = plan.song.tracks;
    expect(t1!.notes.map((x) => x.id)).toEqual(["a", "b"]);
    expect(t2!.notes.map((x) => x.pitch)).toEqual([72, 67]);
    expect(t2!.mml).toBeUndefined();
  });

  it("새 트랙으로 옮기면 같은 연주자 끝에 트랙을 만든다", () => {
    const plan = planMoveNotes(two(), "t1", new Set(["a"]), { newTrackName: "트랙 3" });
    expect(plan.targetId).toBe("t3");
    expect(plan.song.tracks.map((t) => [t.id, t.playerId, t.notes.length])).toEqual([["t1", "p1", 2], ["t2", "p1", 1], ["t3", "p1", 1]]);
  });

  it("트랙 합치기: 겹치지 않는 음만 모은다", () => {
    const plan = planMergeTracks(two(), ["t2"], "t1");
    expect([plan.moved, plan.blocked]).toEqual([0, 1]);
    const merged = planMergeTracks(two(), ["t1"], "t2");
    expect([merged.moved, merged.blocked]).toEqual([2, 1]);
    expect(merged.song.tracks[1]!.notes.map((x) => x.pitch)).toEqual([60, 72, 67]);
  });
});

describe("높이 순으로 다시 나누기", () => {
  const n = (id: string, start: number, dur: number, pitch: number, tie: "none" | "next" = "none") => ({ id, start: rat(start, 4), dur: rat(dur, 4), pitch, vol: 8, tie });
  it("같은 때 나는 음은 높은 음이 앞 트랙으로, &로 이은 음은 함께", () => {
    const base = new History(fresh()).run(addTrack("p1", "트랙 2"));
    const song = {
      ...base,
      tracks: base.tracks.map((t) =>
        t.id === "t1"
          ? { ...t, notes: [n("a", 0, 1, 60), n("b", 1, 1, 72, "next"), n("c", 2, 1, 74)] }
          : { ...t, notes: [n("x", 0, 1, 67), n("y", 1, 2, 64)] },
      ),
    };
    const plan = planVoiceByPitch(song, ["t1", "t2"]);
    const [t1, t2] = plan.song.tracks;
    expect(t1!.notes.map((x) => x.id)).toEqual(["x", "b", "c"]);
    expect(t2!.notes.map((x) => x.id)).toEqual(["a", "y"]);
    expect(plan.moved).toBe(2);
    // 낮은 음부터: 처음 함께 시작하는 음 중 낮은 음이 첫 트랙으로
    const low = planVoiceByPitch(song, ["t1", "t2"], "low");
    expect(low.song.tracks[0]!.notes[0]!.pitch).toBeLessThan(low.song.tracks[1]!.notes[0]!.pitch);
  });
});

describe("옮기기·합치기와 &", () => {
  const n = (id: string, start: number, dur: number, pitch: number, tie: "none" | "next" = "none") => ({ id, start: rat(start, 4), dur: rat(dur, 4), pitch, vol: 8, tie });
  // 보낼 트랙 c4&d4, 받을 트랙 r4>c4 (감사 2번 사례)
  const song = () => {
    const base = new History(fresh()).run(addTrack("p1", "트랙 2"));
    return {
      ...base,
      tracks: base.tracks.map((t) =>
        t.id === "t1" ? { ...t, notes: [n("a", 0, 1, 60, "next"), n("b", 1, 1, 62)] } : { ...t, notes: [n("x", 1, 1, 72)] },
      ),
    };
  };

  it("&로 이은 덩어리 중 한 음이라도 겹치면 덩어리째 남긴다", () => {
    for (const plan of [planMoveNotes(song(), "t1", new Set(["a", "b"]), "t2"), planMergeTracks(song(), ["t1"], "t2")]) {
      expect([plan.moved, plan.blocked]).toEqual([0, 2]);
      expect(plan.song.tracks[1]!.notes.map((x) => [x.pitch, x.tie])).toEqual([[72, "none"]]);
    }
  });

  it("하나만 골라도 &로 이은 덩어리째 옮기고, 끝 음 &는 풀어 둔다", () => {
    const s = song();
    const free = { ...s, tracks: s.tracks.map((t) => (t.id === "t2" ? { ...t, notes: [n("x", 2, 1, 72)] } : t)) };
    const plan = planMoveNotes(free, "t1", new Set(["a"]), "t2");
    expect(plan.moved).toBe(2);
    expect(plan.song.tracks[0]!.notes).toEqual([]);
    expect(plan.song.tracks[1]!.notes.map((x) => [x.pitch, x.tie])).toEqual([[60, "next"], [62, "none"], [72, "none"]]);
  });
});

describe("트랙 순서·복제·악보 간 이동", () => {
  /** p1: t1 t3 t4, p2: t2 */
  function fourTracks() {
    const h = new History(fresh());
    h.run(addPlayer("flute", "플루트 1", "트랙 1"));
    h.run(addTrack("p1", "트랙 2"));
    h.run(addTrack("p1", "트랙 3"));
    return h;
  }
  const layout = (s: { tracks: readonly { id: string; playerId: string }[] }) => s.tracks.map((t) => `${t.playerId}:${t.id}`);

  it("같은 악보 안에서 위·아래로 옮기고 끝에서는 그대로 둔다", () => {
    const h = fourTracks();
    expect(layout(h.song)).toEqual(["p1:t1", "p1:t3", "p1:t4", "p2:t2"]);
    expect(layout(h.run(shiftTrack("t4", -1)))).toEqual(["p1:t1", "p1:t4", "p1:t3", "p2:t2"]);
    expect(layout(h.run(shiftTrack("t1", 1)))).toEqual(["p1:t4", "p1:t1", "p1:t3", "p2:t2"]);
    const top = h.song;
    expect(shiftTrack("t4", -1).apply(top)).toBe(top);
    expect(shiftTrack("t3", 1).apply(top)).toBe(top);
    h.undo();
    expect(layout(h.undo())).toEqual(["p1:t1", "p1:t3", "p1:t4", "p2:t2"]);
  });

  it("다른 악보의 원하는 자리로 옮기고, 비게 된 연주자는 지운다 (실행 취소로 되돌림)", () => {
    const h = fourTracks();
    const s = h.run(moveTrack("t2", "p1", 1));
    expect(layout(s)).toEqual(["p1:t1", "p1:t2", "p1:t3", "p1:t4"]);
    expect(s.players.map((p) => p.id)).toEqual(["p1"]);
    expect(s.tracks.find((t) => t.id === "t2")!.notes).toBe(h.undo().tracks.find((t) => t.id === "t2")!.notes);
    expect(h.song.players.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(layout(moveTrack("t3", "p2", 9).apply(h.song))).toEqual(["p1:t1", "p1:t4", "p2:t2", "p2:t3"]);
    expect(moveTrack("t3", "p1", 1).apply(h.song)).toBe(h.song);
  });

  it("연주자 악기를 따르던 트랙은 다른 악기 악보로 옮겨도 쓰던 악기를 지킨다", () => {
    const h = fourTracks();
    const before = trackInstrument(h.song, h.song.tracks.find((t) => t.id === "t2")!).canonical;
    const s = h.run(moveTrack("t2", "p1", 0));
    const t2 = s.tracks.find((t) => t.id === "t2")!;
    expect(trackInstrument(s, t2).canonical).toBe(before);
    expect(t2.instrument).toMatchObject({ canonical: before });
    // 같은 악기 악보로 가거나 같은 악보 안 순서만 바꾸면 따로 적지 않는다
    expect(moveTrack("t3", "p1", 0).apply(s).tracks.find((t) => t.id === "t3")!.instrument).toBeUndefined();
    expect(h.undo().tracks.find((t) => t.id === "t2")!.instrument).toBeUndefined();
  });

  it("받는 연주자 트랙이 다 찼으면 막는다 (같은 악보 안 순서 바꾸기는 된다)", () => {
    const h = fourTracks();
    expect(trackMoveBlock(h.song, "t2", "p1", 3)).toBe("full");
    expect(trackMoveBlock(h.song, "t2", "p1", 6)).toBeUndefined();
    expect(trackMoveBlock(h.song, "t3", "p1", 3)).toBeUndefined();
    expect(trackMoveBlock(h.song, "t9", "p1", 6)).toBe("missing");
    expect(trackMoveBlock(h.song, "t1", "p9", 6)).toBe("missing");
  });

  it("복제는 바로 아래에 새 id로 만들고 끄기·솔로는 풀어 둔다", () => {
    const base = setTrackInstrument("t1", "lute").apply(fresh());
    const song = {
      ...base,
      tracks: base.tracks.map((t) => ({
        ...t,
        mute: true,
        notes: [
          { id: "a", start: rat(0), dur: rat(1, 4), pitch: 60, vol: 8, tie: "next" as const },
          { id: "b", start: rat(1, 4), dur: rat(1, 7), pitch: 62, vol: 8, tie: "none" as const },
        ],
      })),
    };
    const s = duplicateTrack("t1", "트랙 1 복제").apply(song);
    expect(s.tracks.map((t) => t.id)).toEqual(["t1", "t2"]);
    const copy = s.tracks[1]!;
    expect(copy).toMatchObject({ name: "트랙 1 복제", playerId: "p1", mute: false, solo: false, instrument: { canonical: "lute" } });
    expect(copy.notes.map((n) => [n.start, n.dur, n.pitch, n.tie])).toEqual(song.tracks[0]!.notes.map((n) => [n.start, n.dur, n.pitch, n.tie]));
    const ids = s.tracks.flatMap((t) => t.notes.map((n) => n.id));
    expect(new Set(ids).size).toBe(4);
  });

  it("새 악보로 떼어 내면 트랙이 쓰던 악기를 새 연주자 악기로 삼는다", () => {
    const h = fourTracks();
    h.run(setTrackInstrument("t3", "harp"));
    const s = h.run(moveTrackToNewPlayer("t3", "하프 1"));
    expect(layout(s)).toEqual(["p1:t1", "p1:t4", "p2:t2", "p3:t3"]);
    expect(s.players[2]).toMatchObject({ id: "p3", name: "하프 1", instrument: { canonical: "harp" } });
    expect(s.tracks.find((t) => t.id === "t3")!.instrument).toBeUndefined();
    expect(trackInstrument(s, s.tracks.find((t) => t.id === "t3")!).canonical).toBe("harp");
  });

  it("새 악보로 복제: 원래 트랙은 남고, 복제본만 든 새 연주자가 트랙 악기로 생긴다", () => {
    const h = fourTracks();
    h.run(setTrackInstrument("t3", "harp"));
    const s = h.run(duplicateTrackToNewPlayer("t3", "트랙 3 복제", "하프 1"));
    expect(layout(s)).toEqual(["p1:t1", "p1:t3", "p1:t4", "p2:t2", "p3:t5"]);
    const copy = s.tracks.find((t) => t.id === "t5")!;
    expect(copy).toMatchObject({ name: "트랙 3 복제", playerId: "p3" });
    expect(copy.instrument).toBeUndefined();
    expect(s.players[2]).toMatchObject({ id: "p3", name: "하프 1", instrument: { canonical: "harp" } });
    expect(s.tracks.find((t) => t.id === "t3")!.instrument).toMatchObject({ canonical: "harp" });
    expect(duplicateTrackToNewPlayer("없음", "x", "y").apply(s)).toBe(s);
  });
});

describe("악보 타브 튜닝 (기록 밖 상태, beta.11)", () => {
  const base = () => newSong({ playerName: "피아노 1", trackName: "트랙 1" });
  const tabOf = (s: { players: readonly { id: string; tab?: unknown }[] }, id: string) => s.players.find((p) => p.id === id)?.tab;
  /** 앱처럼 튜닝은 기록 없이 바꾼다 */
  const tune = (h: History, id: string, tuning: string, capo: number) => h.amend(setPlayerTab(id, { tuning, capo }).apply(h.song));

  it("튜닝을 바꾼 뒤 되돌리기는 앞 편집만 되돌리고 튜닝은 그대로 둔다 (beta.10 제보)", () => {
    const h = new History(base());
    h.run(addTrack("p1", "트랙 2"));
    tune(h, "p1", "dropD", 2);
    h.run(addTrack("p1", "트랙 3"));
    h.undo();
    expect(tabOf(h.song, "p1")).toEqual({ tuning: "dropD", capo: 2 });
    // 튜닝보다 앞 편집까지 되돌려도 튜닝은 남는다
    expect(tabOf(h.undo(), "p1")).toEqual({ tuning: "dropD", capo: 2 });
    expect(h.canUndo).toBe(false);
    expect(tabOf(h.redo(), "p1")).toEqual({ tuning: "dropD", capo: 2 });
  });

  it("곡째 되돌리는 명령(악기 바꾸기 등)을 실행 취소해도 지금 튜닝을 지킨다", () => {
    const h = new History(base());
    h.run(setPlayerInstrument("p1", "guitar"));
    tune(h, "p1", "bass4", 0);
    expect(tabOf(h.undo(), "p1")).toEqual({ tuning: "bass4", capo: 0 });
    expect(tabOf(h.redo(), "p1")).toEqual({ tuning: "bass4", capo: 0 });
  });

  it("새 악보에 정한 튜닝은 실행 취소 → 다시 실행 뒤에도 남는다 (#97 점검 재현 A)", () => {
    const h = new History(base());
    h.run(addPlayer("lute", "류트 1", "트랙 1"));
    tune(h, "p2", "dropD", 2);
    h.undo();
    expect(h.song.players.some((p) => p.id === "p2")).toBe(false);
    expect(tabOf(h.redo(), "p2")).toEqual({ tuning: "dropD", capo: 2 });
  });

  it("지운 악보와 같은 id로 새로 만든 악보는 튜닝을 물려받지 않고, 되돌리면 옛 악보는 제 튜닝으로 돌아온다", () => {
    const h = new History(base());
    h.run(addPlayer("lute", "류트 1", "트랙 1"));
    tune(h, "p2", "bass4", 0);
    h.run(removeTrack("t2"));
    const again = h.run(addPlayer("lute", "류트 2", "트랙 1"));
    expect(again.players.find((p) => p.id === "p2")?.name).toBe("류트 2");
    expect(tabOf(again, "p2")).toBeUndefined();
    tune(h, "p2", "mandolin", 1);
    h.undo();
    expect(tabOf(h.undo(), "p2")).toEqual({ tuning: "bass4", capo: 0 });
    h.redo();
    expect(tabOf(h.redo(), "p2")).toEqual({ tuning: "mandolin", capo: 1 });
  });

  it("다시 실행한 이름 바꾸기 뒤 바꾼 튜닝이 지우기 취소에서 그대로 돌아온다 (#97 점검 재현 B)", () => {
    const h = new History(base());
    h.run(addPlayer("guitar", "기타 1", "트랙 1"));
    tune(h, "p2", "dropD", 2);
    h.run(renamePlayer("p2", "기타"));
    h.run(removeTrack("t2"));
    h.undo();
    h.undo();
    h.redo();
    tune(h, "p2", "bass4", 4);
    h.redo();
    expect(h.song.players.some((p) => p.id === "p2")).toBe(false);
    expect(tabOf(h.undo(), "p2")).toEqual({ tuning: "bass4", capo: 4 });
  });

  it("한 단계에서 음과 튜닝을 함께 바꾸면(타브 그대로 튜닝 바꾸기) 실행 취소·다시 실행이 튜닝도 같이 되돌린다", () => {
    const h = new History(base());
    tune(h, "p1", "standard", 0);
    const both: Command = {
      label: "타브 그대로 튜닝 바꾸기",
      apply: (s) => setPlayerTab("p1", { tuning: "dropD", capo: 1 }).apply(renamePlayer("p1", "기타").apply(s)),
      invert: (before) => replaceSong("되돌리기", before),
    };
    h.run(both);
    expect(tabOf(h.song, "p1")).toEqual({ tuning: "dropD", capo: 1 });
    expect(tabOf(h.undo(), "p1")).toEqual({ tuning: "standard", capo: 0 });
    expect(tabOf(h.redo(), "p1")).toEqual({ tuning: "dropD", capo: 1 });
    // 그 뒤 기록 밖에서 바꾼 튜닝은 앞 편집을 되돌려도 지킨다
    h.run(addTrack("p1", "트랙 2"));
    tune(h, "p1", "bass4", 0);
    expect(tabOf(h.undo(), "p1")).toEqual({ tuning: "bass4", capo: 0 });
    // 튜닝을 함께 바꾼 단계를 되돌리면 그 단계 앞 튜닝으로 돌아간다
    expect(tabOf(h.undo(), "p1")).toEqual({ tuning: "standard", capo: 0 });
  });

  it("같은 값이면 곡을 그대로 둔다", () => {
    const s = setPlayerTab("p1", { tuning: "dropD", capo: 2 }).apply(base());
    expect(setPlayerTab("p1", { tuning: "dropD", capo: 2 }).apply(s)).toBe(s);
  });
});

describe("트랙에서 들을 사운드팩 고르기", () => {
  // 앱이 주는 번호 맞추기 흉내: pack-b.dls는 .2 팩처럼 1000을 더한다
  const programFor = (ref: { canonical: string; packId?: string; program?: number }) =>
    ref.packId === "pack-b.dls" ? 1000 + (ref.program ?? 0) % 1000 : (ref.program ?? 0) % 1000;

  it("트랙 악기가 없으면 악보 악기에 팩을 정하고, 실행 취소로 되돌린다", () => {
    const h = new History(fresh());
    const before = h.song;
    const s = h.run(setTrackPack("t1", "pack-b.dls", programFor));
    expect(s.players[0]!.instrument).toMatchObject({ canonical: "piano", packId: "pack-b.dls" });
    expect(s.tracks[0]!.instrument).toBeUndefined();
    expect(h.undo()).toEqual(before);
    expect(h.redo().players[0]!.instrument.packId).toBe("pack-b.dls");
  });

  it("트랙 악기가 있으면 그 트랙에만 정하고, 자동으로 돌리면 팩 번호를 뗀다", () => {
    const h = new History(fresh());
    h.run(setTrackInstrument("t1", "harp"));
    const s = h.run(setTrackPack("t1", "pack-b.dls", programFor));
    expect(s.tracks[0]!.instrument).toEqual({ canonical: "harp", program: 1024, packId: "pack-b.dls" });
    expect(s.players[0]!.instrument.packId).toBeUndefined();
    const auto = h.run(setTrackPack("t1", undefined, programFor));
    expect(auto.tracks[0]!.instrument).toEqual({ canonical: "harp", program: 24 });
    h.undo();
    expect(h.undo().tracks[0]!.instrument).toEqual({ canonical: "harp", program: 24 });
  });

  it("악기를 바꿔도 고른 팩은 남는다", () => {
    let s = setTrackPack("t1", "pack-b.dls", programFor).apply(fresh());
    s = setPlayerInstrument("p1", "harp", undefined, "악기", undefined, programFor).apply(s);
    expect(s.players[0]!.instrument).toEqual({ canonical: "harp", program: 1024, packId: "pack-b.dls" });
    // 트랙만 다른 악기로 바꿔도 트랙이 듣던 팩을 가져간다
    s = setTrackInstrument("t1", "lute", "트랙 악기", undefined, programFor).apply(s);
    expect(s.tracks[0]!.instrument).toMatchObject({ canonical: "lute", packId: "pack-b.dls" });
    // 악보 악기와 팩까지 같은 악기로 돌리면 악보 악기를 따른다
    expect(setTrackInstrument("t1", "harp", "트랙 악기", undefined, programFor).apply(s).tracks[0]!.instrument).toBeUndefined();
  });

  it("악보 악기와 같은 악기라도 팩이 다르면 트랙 악기로 남는다", () => {
    let s = setTrackInstrument("t1", "harp").apply(fresh());
    s = setTrackPack("t1", "pack-b.dls", programFor).apply(s);
    s = setTrackInstrument("t1", "piano", "트랙 악기", undefined, programFor).apply(s);
    expect(s.tracks[0]!.instrument).toMatchObject({ canonical: "piano", packId: "pack-b.dls" });
  });
});

describe("음 바꾸기 + 트랙 더하기 (아르페지오)", () => {
  it("트랙 추가까지 실행 취소 한 번으로 원래 곡(트랙 수 포함)으로 돌아간다", () => {
    const h = new History(fresh());
    const before = h.song;
    const note = (id: string, at: number) => ({ id, start: rat(at, 16), dur: rat(1, 16), pitch: 60 + at, vol: 10, tie: "none" as const });
    const s = h.run(setNotesAndAddTracks("p1", [{ trackId: "t1", notes: [note("a", 0)] }], [[note("b", 1)], [note("c", 2)]], (n) => `트랙 ${n}`, "아르페지오"));
    expect(s.tracks.map((t) => [t.name, t.notes.map((x) => x.id)])).toEqual([["트랙 1", ["a"]], ["트랙 2", ["b"]], ["트랙 3", ["c"]]]);
    expect(h.undo()).toEqual(before);
    expect(h.redo().tracks).toHaveLength(3);
  });
});

describe("슬라이드 결과를 글로 쓰기", () => {
  it("사슬이 &로 이어지고 & 뒤에 v가 없으며, 타브 배치가 사슬을 같은 줄에 둔다. 실행 취소 한 번으로 원래 곡", () => {
    const note = (id: string, at: number, pitch: number, vol = 10) => ({ id, start: rat(at, 4), dur: rat(1, 4), pitch, vol, tie: "none" as const });
    const base = fresh();
    const s = { ...base, tracks: base.tracks.map((t) => ({ ...t, notes: [note("a", 0, 55, 12), note("b", 1, 59, 5)] })) };
    let k = 0;
    const r = planSlide(s, "t1", s.tracks[0]!.notes, { kind: "between", path: "chromatic", direction: "down", semitones: 2, length: rat(1, 16), instrument: "folk-guitar" }, MOBILE_PROFILE, () => `s${++k}`);
    const text = optimizeMml(r.notes!).text;
    expect(text).toContain("&");
    expect(/&[^,;]*?v\d/.test(text)).toBe(false);
    const slides = new Map<string, string>();
    const sorted = [...r.notes!];
    for (let i = 1; i < sorted.length; i++) slides.set(sorted[i]!.id, sorted[i - 1]!.id);
    const strings = assignTab(r.notes!, undefined, new Map(), slides).flatMap((e) => e.notes.map((x) => x.at?.string));
    expect(new Set(strings).size).toBe(1);
    const h = new History(s);
    h.run(setTracksNotes([{ trackId: "t1", notes: r.notes! }], "슬라이드"));
    expect(h.undo()).toEqual(s);
  });
});
