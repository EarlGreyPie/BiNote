import { describe, expect, it } from "vitest";
import { rat, type Note } from "@mmlce/core";
import { labelFits, parseVolumeLabels, volumeLabelNotes } from "../src/lib/volumeLabels";

/** 4분음표 음. at은 4분음표 몇째 자리 */
function note(id: string, at: number, vol: number, tie: "none" | "next" = "none", len = 1): Note {
  return { id, start: rat(at, 4), dur: rat(len, 4), pitch: 60, vol, tie };
}
const ids = (m: Map<string, number>) => [...m.entries()];

describe("음표 볼륨 숫자 설정 읽기", () => {
  it("모르는 값·없는 값은 끔", () => {
    expect(parseVolumeLabels(null)).toBe("off");
    expect(parseVolumeLabels("on")).toBe("off");
    expect(parseVolumeLabels("changes")).toBe("changes");
    expect(parseVolumeLabels("all")).toBe("all");
  });
});

describe("볼륨 숫자를 쓸 음", () => {
  const notes = [note("a", 0, 8), note("b", 1, 8), note("c", 2, 10), note("d", 3, 10)];

  it("끔이면 아무것도 쓰지 않는다", () => {
    expect(volumeLabelNotes(notes, "off").size).toBe(0);
  });

  it("바뀌는 곳만: 같은 v가 이어지면 첫 음만", () => {
    expect(ids(volumeLabelNotes(notes, "changes"))).toEqual([["a", 8], ["c", 10]]);
  });

  it("모든 음", () => {
    expect(ids(volumeLabelNotes(notes, "all"))).toEqual([["a", 8], ["b", 8], ["c", 10], ["d", 10]]);
  });

  it("& 사슬 뒤 조각은 쓰지 않고, 사슬 첫 음 v로 쓴다 (뒤 조각 v가 달라도)", () => {
    const chain = [note("a", 0, 8, "next"), note("b", 1, 12), note("c", 2, 8)];
    expect(ids(volumeLabelNotes(chain, "all"))).toEqual([["a", 8], ["c", 8]]);
    // 뒤 조각의 12는 소리 나지 않으므로 c(8)는 앞 사슬(8)과 같아 바뀐 곳이 아니다
    expect(ids(volumeLabelNotes(chain, "changes"))).toEqual([["a", 8]]);
  });

  it("쉼표는 비교에 끼지 않는다: 쉼표 뒤 음은 쉼표 앞 음과 비교", () => {
    // 0 자리 v8, 1~2 쉼표, 3 자리 v8 → 바뀌지 않음, 5 자리 v9 → 바뀜
    const rests = [note("a", 0, 8), note("b", 3, 8), note("c", 5, 9)];
    expect(ids(volumeLabelNotes(rests, "changes"))).toEqual([["a", 8], ["c", 9]]);
  });

  it("화면에서 처음 보이는 음에는 바뀌지 않았어도 쓴다 (곡 중간부터 볼 때)", () => {
    // 화면이 0.5(2번째 4분음표)부터: b·d는 앞과 같지만 c가 바뀌고, 처음 보이는 c는 원래도 쓴다
    expect(ids(volumeLabelNotes(notes, "changes", 0.25))).toEqual([["b", 8], ["c", 10]]);
    expect(ids(volumeLabelNotes(notes, "changes", 0.75))).toEqual([["d", 10]]);
    // 화면 밖 음은 돌려주지 않는다
    expect(ids(volumeLabelNotes(notes, "all", 0, 0.5))).toEqual([["a", 8], ["b", 8]]);
  });

  it("음 높이가 화면 밖인 음은 처음 보이는 음 자리를 차지하지 않는다 (Codex PR152 재현)", () => {
    const low: Note = { ...note("low", 0, 8), pitch: 40 };
    const high: Note = { ...note("high", 2, 8), pitch: 72 };
    const inView = (n: Note) => n.pitch >= 60 && n.pitch <= 84;
    expect(ids(volumeLabelNotes([low, high], "changes", -Infinity, Infinity, inView))).toEqual([["high", 8]]);
  });

  it("v0도 바뀌었으면 쓴다", () => {
    const zero = [note("a", 0, 8), note("b", 1, 0), note("c", 2, 0)];
    expect(ids(volumeLabelNotes(zero, "changes"))).toEqual([["a", 8], ["b", 0]]);
  });

  it("빈 트랙", () => {
    expect(volumeLabelNotes([], "all").size).toBe(0);
    expect(volumeLabelNotes([], "changes").size).toBe(0);
  });

  it("시간 순서는 분수 그대로 (셋잇단도 순서대로)", () => {
    const triplet = [
      { ...note("b", 0, 9), start: rat(1, 3) },
      { ...note("a", 0, 8), start: rat(0, 1), dur: rat(1, 3) },
    ];
    expect(ids(volumeLabelNotes(triplet, "changes"))).toEqual([["a", 8], ["b", 9]]);
  });
});

describe("겹치면 건너뛰기", () => {
  it("앞 숫자가 없으면 쓴다", () => {
    expect(labelFits(undefined, 0)).toBe(true);
  });
  it("앞 숫자 끝(+ 틈) 뒤에서 시작하면 쓰고, 그 앞이면 건너뛴다", () => {
    expect(labelFits(20, 21)).toBe(true);
    expect(labelFits(20, 20.5)).toBe(false);
    expect(labelFits(20, 10)).toBe(false);
    expect(labelFits(20, 22, 2)).toBe(true);
  });
});
