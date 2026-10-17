import { describe, expect, it } from "vitest";
import { emptySong, rat, type Player, type Song, type Track } from "@mmlce/core";
import { mmlAt, pasteTrackIds, playerScores, scoreChunks } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };
const flute: Player = { id: "p2", name: "플루트", instrument: { canonical: "flute" } };

function track(id: string, playerId: string): Track {
  return { id, playerId, name: id, color: "#000", role: "free", mute: false, solo: false, notes: [], spelling: {} };
}

describe("mmlAt", () => {
  it("MML@ 뒤에 트랙을 콤마로 잇고 ; 로 끝낸다", () => {
    expect(mmlAt(["cde", "", "o3c"])).toBe("MML@cde,,o3c;");
  });
});

describe("playerScores", () => {
  it("연주자마다 악보 하나로 묶고, 한도보다 많은 트랙은 악보를 더 만든다", () => {
    const tracks = [track("a", "p1"), track("x", "p2"), track("b", "p1"), track("c", "p1")];
    const song: Song = { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [piano, flute], tracks };
    const texts = tracks.map((t) => ({ trackId: t.id, text: t.id.toUpperCase() }));
    expect(playerScores(song, texts, 6).map((s) => s.text)).toEqual(["MML@A,B,C;", "MML@X;"]);
    // 악기마다 다르게: 연주자 p1만 2개씩
    expect(playerScores(song, texts, (id) => (id === song.players[0]!.id ? 2 : 6)).length).toBe(3);
    const split = playerScores(song, texts, 2);
    expect(split.map((s) => [s.playerId, s.index, s.text])).toEqual([
      ["p1", 0, "MML@A,B;"],
      ["p1", 1, "MML@C;"],
      ["p2", 0, "MML@X;"],
    ]);
  });
});

describe("playerScores 오르골", () => {
  it("오르골 악보에는 소리 없는 나머지 트랙을 붙이고 그 수를 알려 준다", () => {
    const box: Player = { id: "p1", name: "오르골", instrument: { canonical: "music-box" } };
    const tracks = ["a", "b", "c", "d"].map((id) => track(id, "p1"));
    const song: Song = { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [box], tracks };
    const texts = tracks.map((t) => ({ trackId: t.id, text: t.id.toUpperCase() }));
    expect(playerScores(song, texts, 3, 6).map((s) => [s.trackIds, s.text, s.silent])).toEqual([
      [["a", "b", "c"], "MML@A,B,C,D;", 1],
      // 소리 칸(앞 3)에 다른 악보 트랙을 넣지 않는다: 두 대에서 겹쳐 나므로 빈 채널로 둔다
      [["d"], "MML@D,,,A,B,C;", 3],
    ]);
  });
});

describe("오르골 6트랙 넘는 입력 (beta.8 점검)", () => {
  it("가장 늦게 끝나는 트랙이 빠진 악보는 마지막 붙임 자리를 그 트랙으로 바꿔 반복 길이를 맞춘다", () => {
    const box: Player = { id: "p1", name: "오르골", instrument: { canonical: "music-box" } };
    // 트랙 1만 온음표, 나머지는 4분음표 (점검 재현: 9트랙)
    const tracks = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => ({
      ...track(`t${k}`, "p1"),
      notes: [{ id: `n${k}`, start: rat(0), dur: k === 1 ? rat(1) : rat(1, 4), pitch: 60, vol: 8, tie: "none" as const }],
    }));
    const song: Song = { ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [box], tracks };
    const pasted = scoreChunks(song, 3).map((c) => pasteTrackIds(song, c, 3, 6));
    expect(pasted).toEqual([
      ["t1", "t2", "t3", "t4", "t5", "t6"],
      ["t4", "t5", "t6", "t7", "t8", "t1"],
      ["t7", "t8", "t9", "t1", "t2", "t3"],
    ]);
    // 소리 칸(앞 3)은 그대로라 빠지는 음이 없다
    expect(pasted.flatMap((p) => p.slice(0, 3))).toEqual(tracks.map((t) => t.id));
  });
});
