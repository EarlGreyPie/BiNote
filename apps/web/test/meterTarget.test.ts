import { describe, expect, it } from "vitest";
import { emptySong, rat, type Song } from "@mmlce/core";
import { meterEditAt, meterTarget } from "../src/lib/meterTarget";

const fourFour = [{ at: rat(0), beats: 4, unit: 4 }];
// 4/4 두 마디 뒤 3/4
const changed = [...fourFour, { at: rat(2), beats: 3, unit: 4 }];

describe("박자를 바꿀 자리", () => {
  it("타브 보기에 타브 커서가 있으면 그 커서가 든 마디 처음", () => {
    expect(meterTarget(fourFour, "tab", rat(5, 4), rat(1, 4))).toEqual(rat(1));
  });
  it("타브 보기에 타브 커서가 없으면 재생 커서가 든 마디", () => {
    expect(meterTarget(fourFour, "tab", undefined, rat(9, 4))).toEqual(rat(2));
  });
  it("피아노롤에서는 타브 커서를 보지 않는다", () => {
    expect(meterTarget(fourFour, "roll", rat(5, 4), rat(1, 4))).toEqual(rat(0));
    expect(meterTarget(fourFour, "roll", rat(5, 4), undefined)).toEqual(rat(0));
  });
  it("커서가 다 없으면 곡 처음", () => {
    expect(meterTarget(fourFour, "tab", undefined, undefined)).toEqual(rat(0));
  });
  it("박자가 바뀐 뒤 마디에서도 마디 처음을 센다", () => {
    // 3/4 마디는 2, 11/4, 7/2 ... 에서 시작한다
    expect(meterTarget(changed, "tab", rat(3), undefined)).toEqual(rat(11, 4));
    expect(meterTarget(changed, "tab", rat(7, 2), undefined)).toEqual(rat(7, 2));
    expect(meterTarget(changed, "roll", undefined, rat(9, 4))).toEqual(rat(2));
  });
});

describe("이벤트 창에서 박자로 바꿔 넣기", () => {
  it("빈 자리에서 연 창에서 박자를 넣으면 그 자리가 든 마디 처음부터 바꾼다", () => {
    const song: Song = { ...emptySong({ title: "", author: "", profileId: "mobile" }), timeSig: fourFour };
    const next = meterEditAt(song.timeSig, rat(11, 8), 3, 4).apply(song);
    expect(next.timeSig).toEqual([
      { at: rat(0), beats: 4, unit: 4 },
      { at: rat(1), beats: 3, unit: 4 },
    ]);
  });
});
