import { describe, expect, it } from "vitest";
import { positionToSeconds, rat } from "@mmlce/core";
import { alignBarTempo, nearestBar, nearestBeat, tapTempos } from "../src/lib/tempoSync";

describe("원곡에 템포 맞추기", () => {
  it("마디선을 끈 자리에 오도록 앞 구간 템포를 바꾸고 뒤는 원래 템포를 잇는다", () => {
    // t120: 한 마디 2초. 3마디 시작(온음표 2)을 5초에 오게 → 앞 두 마디 = 5초 → t96
    const plan = alignBarTempo([{ at: rat(0), bpm: 120 }], rat(2), 5)!;
    expect(plan.set).toEqual([{ at: rat(0), bpm: 96 }, { at: rat(2), bpm: 120 }]);
    expect(positionToSeconds(plan.set, rat(2))).toBeCloseTo(5, 5);
  });

  it("앞 템포 자리부터 바꾼다 (차례로 맞춰 나가기)", () => {
    const tempo = [{ at: rat(0), bpm: 96 }, { at: rat(2), bpm: 120 }];
    // 5마디 시작(온음표 4)을 9.5초에: 2→4 구간 4.5초 → 240·2/4.5 ≈ 107
    const plan = alignBarTempo(tempo, rat(4), 9.5)!;
    expect(plan.set).toEqual([{ at: rat(2), bpm: 107 }, { at: rat(4), bpm: 120 }]);
  });

  it("앞 템포 자리보다 앞으로는 못 끈다", () => {
    expect(alignBarTempo([{ at: rat(0), bpm: 120 }], rat(1), 0)).toBeUndefined();
  });

  it("가장 가까운 마디 시작", () => {
    expect(nearestBar([], rat(9, 8))).toEqual(rat(1));
    expect(nearestBar([], rat(15, 8))).toEqual(rat(2));
  });

  it("탭 간격마다 마디 템포, 마지막 탭 마디부터 원래 템포, 사이 템포는 지운다", () => {
    const tempo = [{ at: rat(0), bpm: 120 }, { at: rat(2), bpm: 90 }];
    // 1마디(0)부터 2초, 2.5초, 2.5초 간격 → t120, t96, t96, 4마디(3)부터 원래 템포 t90
    const plan = tapTempos(tempo, [], rat(0), [0, 2, 4.5, 7])!;
    expect(plan.set).toEqual([{ at: rat(1), bpm: 96 }, { at: rat(3), bpm: 90 }]);
    expect(plan.remove).toEqual([rat(2)]);
  });

  it("손 떨림 정도는 한 템포로 합치고, 묶음 끝은 탭 자리에 맞는다", () => {
    // 2초(t120), 2.02초(t119), 1.98초(t121), 2.5초(t96)
    const taps = [0, 2, 4.02, 6, 8.5];
    expect(tapTempos([{ at: rat(0), bpm: 100 }], [], rat(0), taps)!.set.map((e) => e.bpm)).toEqual([120, 119, 121, 96, 100]);
    const plan = tapTempos([{ at: rat(0), bpm: 100 }], [], rat(0), taps, { slack: 0.06 })!;
    expect(plan.set).toEqual([{ at: rat(0), bpm: 120 }, { at: rat(3), bpm: 96 }, { at: rat(4), bpm: 100 }]);
    expect(positionToSeconds(plan.set, rat(3))).toBeCloseTo(6, 5);
  });

  it("뚜렷하게 빨라지면 합치지 않는다 (연주자가 실제로 바꾼 템포)", () => {
    // 간격 2, 1.9, 1.8, 1.7
    const plan = tapTempos([{ at: rat(0), bpm: 120 }], [], rat(0), [0, 2, 3.9, 5.7, 7.4], { slack: 0.06 })!;
    expect(plan.set.length).toBeGreaterThanOrEqual(3);
  });

  it("박마다 찍기: 4/4에서 4분음표마다 한 칸, 마디 안 rall.도 잡는다", () => {
    // t120 박 0.5초 ×3, 그다음 0.6초 ×2 (느려짐)
    const plan = tapTempos([{ at: rat(0), bpm: 120 }], [], rat(0), [0, 0.5, 1, 1.5, 2.1, 2.7], { unit: "beat", slack: 0.03 })!;
    expect(plan.set).toEqual([{ at: rat(3, 4), bpm: 100 }, { at: rat(5, 4), bpm: 120 }]);
  });

  it("가장 가까운 박 (6/8은 점4분음표가 한 박)", () => {
    expect(nearestBeat([], rat(5, 16))).toEqual(rat(1, 4));
    expect(nearestBeat([{ at: rat(0), beats: 6, unit: 8 }], rat(1, 4))).toEqual(rat(3, 8));
  });

  it("탭이 하나뿐이면 아무것도 안 한다", () => {
    expect(tapTempos([], [], rat(0), [1])).toBeUndefined();
  });
});
