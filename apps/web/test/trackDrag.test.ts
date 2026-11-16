import { describe, expect, it } from "vitest";
import { emptySong, History, type Song, type Track } from "@mmlce/core";
import { moveTrack } from "@mmlce/mml";
import { scoreGroups } from "../src/lib/scores";
import { DRAG_START_PX, dragStarted, dropSpot, type DropTarget } from "../src/lib/trackDrag";

// 트랙 끌어 옮기기: 포인터 아래 줄에서 놓을 자리를 정하고, 놓으면 moveTrack 한 번으로 옮긴다

function track(id: string, playerId: string, more: Partial<Track> = {}): Track {
  return { id, playerId, name: id, color: "#000000", role: "free", mute: false, solo: false, notes: [], spelling: {}, ...more };
}

/** 악보 둘: p1에 a·b·c, p2에 d */
function sample(): Song {
  return {
    ...emptySong({ title: "", author: "", profileId: "mabinogi-mobile" }),
    players: [
      { id: "p1", name: "하나", instrument: { canonical: "piano" } },
      { id: "p2", name: "둘", instrument: { canonical: "lute" } },
    ],
    tracks: [
      track("a", "p1", { mute: true }),
      track("b", "p1", { solo: true, instrument: { canonical: "flute", packId: "pack.dls" } }),
      track("c", "p1", { colorPinned: true, color: "#123456" }),
      track("d", "p2"),
    ],
  };
}

const order = (song: Song) => song.tracks.map((t) => `${t.playerId}:${t.id}`).join(" ");

/** 끌어 놓기 한 번: 놓을 자리를 정해 옮긴 곡 */
function drop(song: Song, dragId: string, target: DropTarget): Song {
  const spot = dropSpot(song.tracks, scoreGroups(song, 3), dragId, target);
  return moveTrack(dragId, spot.playerId, spot.index).apply(song);
}

describe("dragStarted", () => {
  it("조금 흔들린 것은 누르기, 넘게 움직이면 끌기", () => {
    const from = { clientX: 100, clientY: 100 };
    expect(dragStarted(from, { clientX: 100 + DRAG_START_PX, clientY: 100 })).toBe(false);
    expect(dragStarted(from, { clientX: 100, clientY: 100 + DRAG_START_PX + 1 })).toBe(true);
  });
});

describe("dropSpot", () => {
  it("다른 트랙의 앞·뒤에 놓으면 그 자리로", () => {
    const song = sample();
    expect(order(drop(song, "a", { kind: "track", playerId: "p1", trackId: "c", after: true }))).toBe("p1:b p1:c p1:a p2:d");
    expect(order(drop(song, "a", { kind: "track", playerId: "p1", trackId: "c", after: false }))).toBe("p1:b p1:a p1:c p2:d");
    expect(order(drop(song, "c", { kind: "track", playerId: "p1", trackId: "a", after: false }))).toBe("p1:c p1:a p1:b p2:d");
    expect(order(drop(song, "c", { kind: "track", playerId: "p1", trackId: "a", after: true }))).toBe("p1:a p1:c p1:b p2:d");
  });

  it("제자리(자기 위, 바로 앞 트랙의 뒤, 바로 뒤 트랙의 앞)에 놓으면 곡이 그대로", () => {
    const song = sample();
    expect(drop(song, "b", { kind: "track", playerId: "p1", trackId: "b", after: false })).toBe(song);
    expect(drop(song, "b", { kind: "track", playerId: "p1", trackId: "b", after: true })).toBe(song);
    expect(drop(song, "b", { kind: "track", playerId: "p1", trackId: "a", after: true })).toBe(song);
    expect(drop(song, "b", { kind: "track", playerId: "p1", trackId: "c", after: false })).toBe(song);
  });

  it("다른 악보의 트랙 줄·악보 줄에 놓으면 그 악보로", () => {
    const song = sample();
    expect(order(drop(song, "a", { kind: "track", playerId: "p2", trackId: "d", after: false }))).toBe("p1:b p1:c p2:a p2:d");
    expect(order(drop(song, "a", { kind: "score", playerId: "p2", score: 2 }))).toBe("p1:b p1:c p2:d p2:a");
    // 자기 악보 줄: 그 악보 끝으로
    expect(order(drop(song, "a", { kind: "score", playerId: "p1", score: 1 }))).toBe("p1:b p1:c p1:a p2:d");
  });

  it("한 연주자의 트랙이 여러 게임 악보로 나뉘면 악보 줄은 그 묶음의 끝", () => {
    const song: Song = { ...sample(), tracks: ["a", "b", "c", "d", "e"].map((id) => track(id, "p1")), players: sample().players.slice(0, 1) };
    const groups = scoreGroups(song, 3);
    expect(groups.map((g) => g.trackIds.join(""))).toEqual(["abc", "de"]);
    // e를 첫 묶음(a·b·c) 끝에: c 뒤
    expect(dropSpot(song.tracks, groups, "e", { kind: "score", playerId: "p1", score: 1 })).toMatchObject({ playerId: "p1", index: 3 });
    // a를 둘째 묶음(d·e) 끝에: 맨 뒤
    expect(dropSpot(song.tracks, groups, "a", { kind: "score", playerId: "p1", score: 2 })).toMatchObject({ playerId: "p1", index: 4 });
    // c를 자기 묶음 끝에: 제자리
    const spot = dropSpot(song.tracks, groups, "c", { kind: "score", playerId: "p1", score: 1 });
    expect(moveTrack("c", spot.playerId, spot.index).apply(song)).toBe(song);
  });
});

describe("끌어 옮긴 뒤", () => {
  it("트랙에 딸린 것(끄기·솔로·악기·팩·색 고정·음)이 트랙을 따라가고, 실행 취소 한 번에 돌아온다", () => {
    const song = sample();
    const history = new History(song);
    const spot = dropSpot(song.tracks, scoreGroups(song, 3), "a", { kind: "track", playerId: "p1", trackId: "c", after: true });
    const after = history.run(moveTrack("a", spot.playerId, spot.index));
    expect(order(after)).toBe("p1:b p1:c p1:a p2:d");
    for (const before of song.tracks) expect(after.tracks.find((t) => t.id === before.id)).toEqual(before);
    expect(history.undo()).toEqual(song);
    expect(history.canUndo).toBe(false);
    expect(order(history.redo())).toBe("p1:b p1:c p1:a p2:d");
  });
});
