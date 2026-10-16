import { describe, expect, it } from "vitest";
import { emptySong, type Player, type Song, type Track } from "@mmlce/core";
import { mmlAt, playerScores } from "../src/index.js";

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
