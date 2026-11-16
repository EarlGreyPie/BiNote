import { describe, expect, it } from "vitest";
import type { Track } from "@mmlce/core";
import { canListenAll, listenAllTracks } from "../src/lib/listenAll";

const track = (id: string, mute = false, solo = false) => ({ id, mute, solo }) as unknown as Track;

describe("listenAllTracks", () => {
  const tracks = [track("a"), track("b", true), track("c", false, true)];

  it("모든 트랙 끄기는 끄기만 켜고 솔로는 그대로 둔다", () => {
    const out = listenAllTracks(tracks, { kind: "mute" });
    expect(out.map((t) => [t.mute, t.solo])).toEqual([
      [true, false],
      [true, false],
      [true, true],
    ]);
  });

  it("모든 트랙 켜기는 끄기와 솔로를 모두 푼다", () => {
    const out = listenAllTracks(tracks, { kind: "unmute" });
    expect(out.every((t) => !t.mute && !t.solo)).toBe(true);
  });

  it("이 트랙만 켜기는 나머지를 끄고 솔로를 푼다", () => {
    const out = listenAllTracks(tracks, { kind: "only", trackId: "b" });
    expect(out.map((t) => [t.id, t.mute, t.solo])).toEqual([
      ["a", true, false],
      ["b", false, false],
      ["c", true, false],
    ]);
  });

  it("바꿀 것이 없으면 같은 배열을 돌려준다", () => {
    const quiet = [track("a", true), track("b", true)];
    expect(listenAllTracks(quiet, { kind: "mute" })).toBe(quiet);
    expect(canListenAll(quiet, { kind: "mute" })).toBe(false);
    expect(canListenAll(quiet, { kind: "unmute" })).toBe(true);
    const one = [track("a"), track("b", true)];
    expect(canListenAll(one, { kind: "only", trackId: "a" })).toBe(false);
  });
});
