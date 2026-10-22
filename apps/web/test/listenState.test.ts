import { describe, expect, it } from "vitest";
import { buildSchedule } from "@mmlce/audio";
import { emptySong, getProfile, type Song } from "@mmlce/core";
import { parseTrackText } from "@mmlce/mml";
import { audible, listenState } from "../src/lib/listenState";

function song(...tracks: { name: string; mute?: boolean; solo?: boolean }[]): Song {
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    players: [{ id: "p1", name: "피아노", instrument: { canonical: "piano" } }],
    tracks: tracks.map((tr, k) => {
      const id = `t${k + 1}`;
      return { id, playerId: "p1", name: tr.name, color: "#000", role: "free" as const, mute: tr.mute ?? false, solo: tr.solo ?? false, notes: parseTrackText(id, { text: "cde" }).notes, spelling: {}, mml: { text: "cde" } };
    }),
  };
}
const unnamed = (n: number) => `트랙 ${n}`;
/** 재생 일정에서 실제로 소리 나는 트랙 */
const sounding = (s: Song) => new Set(buildSchedule(s, getProfile("mobile")).events.map((e) => e.trackId));

describe("듣기 상태 (끄기·솔로)", () => {
  it("아무것도 안 눌렀으면 빈 목록, 모두 들림", () => {
    const s = song({ name: "멜로디" }, { name: "반주" });
    expect(listenState(s, unnamed)).toEqual({ solo: [], muted: [] });
    expect(["t1", "t2"].map((id) => audible(s, id))).toEqual([true, true]);
  });

  it("솔로·끄기 트랙 이름을 모으고, 이름이 없으면 순서 번호", () => {
    const s = song({ name: "멜로디", solo: true }, { name: "", mute: true }, { name: "베이스" });
    expect(listenState(s, unnamed)).toEqual({ solo: ["멜로디"], muted: ["트랙 2"] });
  });

  it("audible은 재생 일정과 같은 규칙", () => {
    const cases = [
      song({ name: "a", solo: true }, { name: "b" }, { name: "c", mute: true }),
      song({ name: "a", solo: true, mute: true }, { name: "b", solo: true }, { name: "c" }),
      song({ name: "a", mute: true }, { name: "b" }, { name: "c" }),
      song({ name: "a" }, { name: "b" }, { name: "c" }),
    ];
    for (const s of cases) {
      const heard = sounding(s);
      for (const tr of s.tracks) expect(audible(s, tr.id)).toBe(heard.has(tr.id));
    }
  });

  it("없는 트랙은 안 들림", () => {
    expect(audible(song({ name: "a" }), "zz")).toBe(false);
  });
});
