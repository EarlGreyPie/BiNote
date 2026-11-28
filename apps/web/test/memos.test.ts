import { describe, expect, it } from "vitest";
import { rat, type Marker } from "@mmlce/core";
import { memoListOf, memoWhere } from "../src/lib/memos";
import { eventLabels, memoLabelText, type RollView } from "../src/lib/roll";
import { DEFAULT_SETTINGS, keysOf, PRESET_BINDINGS, resolve } from "../src/lib/keymap";

const markers: Marker[] = [
  { id: "m1", at: rat(0), label: "A" },
  { id: "m2", at: rat(1), label: "노트수정", kind: "memo" },
  { id: "m3", at: rat(2), end: rat(9, 4), label: "볼륨 +1", kind: "memo", done: true },
];

describe("작업 메모 목록", () => {
  it("자리순 메모와 개수, 안 끝낸 것만 거르기, 메모로 바꿀 구조 마커", () => {
    const all = memoListOf({ markers }, false);
    expect(all.memos.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect([all.open, all.total]).toEqual([1, 2]);
    expect(all.markers.map((m) => m.id)).toEqual(["m1"]);
    expect(memoListOf({ markers }, true).memos.map((m) => m.id)).toEqual(["m2"]);
  });

  it("자리 글: 한 자리는 마디:박, 범위는 시작 - 끝", () => {
    const sig = [{ at: rat(0), beats: 4, unit: 4 }];
    expect(memoWhere(sig, markers[1]!)).toBe("2:1");
    expect(memoWhere(sig, markers[2]!)).toBe("3:1 - 3:2");
  });
});

describe("이벤트 줄의 작업 메모 라벨", () => {
  const v: RollView = { orientation: "horizontal", width: 600, height: 320, start: 0, pxPerWhole: 160, edgePitch: 84, pxPerKey: 12, keyboard: 44 };
  it("메모는 쪽지 표시와 상태·범위 끝을 달고, 구조 마커는 그대로", () => {
    const labels = eventLabels(v, { tempo: [], timeSig: [], markers }).filter((l) => l.kind === "marker");
    expect(labels.map((l) => [l.id, l.text, l.memo, l.end])).toEqual([
      ["m1", "A", undefined, undefined],
      ["m2", memoLabelText("노트수정", false), "open", undefined],
      ["m3", memoLabelText("볼륨 +1", true), "done", rat(9, 4)],
    ]);
  });
});

describe("작업 메모 넣기 단축키", () => {
  it("Alt+N은 작업 메모 넣기 하나에만 걸려 있다 (두 키 설정 모두)", () => {
    for (const preset of ["mmlce", "mabiicco"] as const) {
      const b = resolve({ ...DEFAULT_SETTINGS, preset });
      expect(keysOf(b, "event.memo")).toEqual(["Alt+N"]);
      expect(Object.entries(b).filter(([, keys]) => keys?.includes("Alt+N")).map(([c]) => c)).toEqual(["event.memo"]);
    }
    expect(PRESET_BINDINGS.mmlce["event.memo"]).toEqual(["Alt+N"]);
  });
});
