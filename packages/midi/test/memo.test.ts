import { describe, expect, it } from "vitest";
import { emptySong, rat, type Song } from "@mmlce/core";
import { songToSmf } from "../src/index.js";

describe("MIDI 내보내기와 작업 메모", () => {
  it("구조 마커만 MIDI 마커로 쓰고 작업 메모는 쓰지 않는다", () => {
    const song: Song = {
      ...emptySong({ title: "", author: "", profileId: "mobile" }),
      tempo: [{ at: rat(0), bpm: 120 }],
      markers: [
        { id: "m1", at: rat(0), label: "A" },
        { id: "m2", at: rat(1), label: "노트수정", kind: "memo" },
      ],
    };
    const smf = songToSmf(song);
    expect(smf.tracks[0]!.events.filter((e) => e.type === "marker")).toEqual([{ tick: 0, type: "marker", text: "A" }]);
  });
});
