import { describe, expect, it } from "vitest";
import { eventChanges } from "../src/lib/eventChanges";

const none = { tempo: { bpm: 120, here: false }, meter: { beats: 4, unit: 4, here: false }, marker: { text: "", here: false } };
const value = { bpm: 120, beats: 4, unit: 4, text: "" };

describe("템포·박자·마커 창의 바뀐 것", () => {
  it("빈 자리에 셋을 함께 켜면 셋 다 넣는다", () => {
    expect(eventChanges(none, { tempo: true, meter: true, marker: true }, { bpm: 90, beats: 3, unit: 4, text: " 후렴 " })).toEqual({ tempo: 90, meter: { beats: 3, unit: 4 }, marker: "후렴" });
  });
  it("그 자리에 없는 템포·박자는 지금 값 그대로면 넣지 않는다 (곡 처음 옅은 t120을 열고 그대로 적용)", () => {
    expect(eventChanges(none, { tempo: true, meter: true, marker: false }, value)).toEqual({});
    expect(eventChanges(none, { tempo: true, meter: false, marker: false }, { ...value, bpm: 96 })).toEqual({ tempo: 96 });
  });
  it("켜지 않은 칸은 건드리지 않는다", () => {
    expect(eventChanges(none, { tempo: false, meter: false, marker: true }, { ...value, text: "A" })).toEqual({ marker: "A" });
    expect(eventChanges(none, { tempo: false, meter: false, marker: false }, value)).toEqual({});
  });
  it("이미 있는 것은 값이 바뀔 때만 고치고, 끄면 지운다", () => {
    const here = { tempo: { bpm: 100, here: true }, meter: { beats: 3, unit: 4, here: true }, marker: { text: "A", here: true } };
    expect(eventChanges(here, { tempo: true, meter: true, marker: true }, { bpm: 100, beats: 3, unit: 4, text: "A" })).toEqual({});
    expect(eventChanges(here, { tempo: true, meter: true, marker: true }, { bpm: 110, beats: 3, unit: 8, text: "B" })).toEqual({ tempo: 110, meter: { beats: 3, unit: 8 }, marker: "B" });
    expect(eventChanges(here, { tempo: false, meter: false, marker: false }, { bpm: 100, beats: 3, unit: 4, text: "A" })).toEqual({ tempo: null, meter: null, marker: null });
  });
});
