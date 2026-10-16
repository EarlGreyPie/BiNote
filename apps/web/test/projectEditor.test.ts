import { describe, expect, it } from "vitest";
import { emptySong, type Song } from "@mmlce/core";
import { parseEditorState, withTrackView } from "../src/lib/projectEditor";

const song: Song = {
  ...emptySong({ title: "", author: "", profileId: "mobile" }),
  tracks: [{ id: "t1", playerId: "p1", name: "", color: "#000", role: "free", mute: false, solo: false, notes: [], spelling: {} }],
};

describe("parseEditorState", () => {
  it("맞는 값만 남긴다", () => {
    const state = parseEditorState(
      {
        activeTrackId: "t1",
        division: 16,
        viewMode: "tab",
        tuning: "dropD",
        capo: 2,
        reference: { name: "a.mp3", offsetMs: -120, volume: 0.8 },
        video: { name: "v.mp4", opacity: 0.5, offset: 1.5, fit: true, low: 21, high: 108, keyLine: 0.85, stretch: 1 },
      },
      song,
    );
    expect(state).toEqual({
      activeTrackId: "t1",
      division: 16,
      viewMode: "tab",
      tuning: "dropD",
      capo: 2,
      reference: { name: "a.mp3", offsetMs: -120, volume: 0.8 },
      video: { name: "v.mp4", opacity: 0.5, offset: 1.5, fit: true, low: 21, high: 108, keyLine: 0.85, stretch: 1 },
    });
  });

  it("없는 트랙·모르는 격자·깨진 맞춤값은 버린다", () => {
    const state = parseEditorState(
      { activeTrackId: "gone", division: 7, viewMode: "staff", tuning: "toString", capo: -1, reference: { name: "a" }, video: { name: "v", high: 1, low: 2 } },
      song,
    );
    expect(state).toEqual({});
  });

  it("트랙 보기 상태는 있는 트랙의 숨김·잠금만 남긴다", () => {
    const state = parseEditorState({ trackView: { t1: { hidden: true, locked: "yes", extra: 1 }, gone: { locked: true } } }, song);
    expect(state).toEqual({ trackView: { t1: { hidden: true } } });
    expect(parseEditorState({ trackView: { t1: { hidden: false } } }, song)).toEqual({});
  });
});

describe("withTrackView", () => {
  it("켜고 끄며, 다 꺼진 트랙은 표에서 뺀다", () => {
    let v = withTrackView({}, "t1", { locked: true });
    expect(v).toEqual({ t1: { locked: true } });
    v = withTrackView(v, "t1", { hidden: true });
    expect(v).toEqual({ t1: { hidden: true, locked: true } });
    v = withTrackView(withTrackView(v, "t1", { locked: false }), "t1", { hidden: false });
    expect(v).toEqual({});
  });
});
