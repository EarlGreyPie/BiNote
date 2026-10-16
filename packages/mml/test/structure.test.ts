import { describe, expect, it } from "vitest";
import { History, rat, trackInstrument } from "@mmlce/core";
import { addPlayer, addTrack, duplicateTrack, duplicateTrackToNewPlayer, moveTrack, moveTrackToNewPlayer, newSong, shiftTrack, trackMoveBlock, planMergeTracks, planMoveNotes, planVoiceByPitch, removeTrack, renamePlayer, renameTrack, setMeter, setPlayerInstrument, setTrackInstrument } from "../src/index.js";

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
