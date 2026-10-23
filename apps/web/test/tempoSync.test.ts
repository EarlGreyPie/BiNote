import { describe, expect, it } from "vitest";
import { emptySong, History, MOBILE_PROFILE, positionToSeconds, rat, type Command } from "@mmlce/core";
import { alignBarTempo, attackStarts, boundToSong, tempoOutOfRange, barStart, nearestBar, nearestBeat, offIntervals, onsetNear, pairBarTempo, snapTaps, tapMarks, tapTempos } from "../src/lib/tempoSync";
import type { Peaks } from "../src/lib/waveform";

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

  it("정수 템포 반올림 오차가 쌓이지 않는다 (다음 마디가 받는다)", () => {
    // 실제 t120.4: 한 마디 240·1/120.4초. 40마디 찍기
    const per = 240 / 120.4;
    const taps = Array.from({ length: 41 }, (_, i) => i * per);
    const plan = tapTempos([{ at: rat(0), bpm: 100 }], [], rat(0), taps)!;
    const end = positionToSeconds(plan.set, rat(40));
    expect(Math.abs(end - taps[40]!)).toBeLessThan(0.02);
    // 마디마다 따로 반올림했다면 0.26초쯤 어긋났다
    expect(plan.set.some((e) => e.bpm === 121)).toBe(true);
  });
});

describe("튀는 탭 표시", () => {
  const marks = (n: number) => tapMarks([], rat(0), n, "bar");
  it("한 번 빠뜨린 탭(간격 두 배)만 집는다", () => {
    const taps = [0, 2, 4, 8, 10, 12, 14];
    expect(offIntervals(taps, marks(taps.length), 0.2)).toEqual([2]);
  });
  it("조금씩 흔들리는 루바토는 집지 않고, 기준을 낮추면 집는다", () => {
    const taps = [0, 2, 4.2, 6.2, 8.5, 10.5, 12.6];
    expect(offIntervals(taps, marks(taps.length), 0.2)).toEqual([]);
    expect(offIntervals(taps, marks(taps.length), 0.05).length).toBeGreaterThan(0);
  });
  it("끄면 아무것도 안 집는다", () => {
    expect(offIntervals([0, 2, 4, 8, 10], marks(5), 0)).toEqual([]);
  });
});

describe("파형 시작점에 맞추기", () => {
  // 1초에 200칸, 1.03초에 소리가 시작하는 파형
  function wave(onsets: number[]): Peaks {
    const n = 1200;
    const min = new Float32Array(n);
    const max = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let v = 0.01;
      for (const o of onsets) {
        const dt = k / 200 - o;
        if (dt >= 0) v = Math.max(v, 0.8 * Math.exp(-dt * 4));
      }
      max[k] = v;
      min[k] = -v;
    }
    return { perSecond: 200, min, max, peak: 0.8 };
  }
  it("탭 가까이의 소리 시작을 찾는다", () => {
    const peaks = wave([1.03]);
    expect(onsetNear(peaks, 1, 0.06)).toBeCloseTo(1.03, 2);
    // 창 밖이면 못 찾는다
    expect(onsetNear(peaks, 1, 0.02)).toBeUndefined();
  });
  it("악보에 그 자리 첫 음이 있는 탭만 옮긴다", () => {
    const peaks = wave([0.01, 2.04, 4.03]);
    const marks = tapMarks([], rat(0), 3, "bar");
    // 2마디(온음표 1)에는 붙임줄로 이어 받은 음뿐 (새로 치지 않는다)
    const notes = [
      { id: "a", start: rat(0), dur: rat(1), pitch: 60, vol: 8, tie: "next" as const },
      { id: "b", start: rat(1), dur: rat(1), pitch: 60, vol: 8, tie: "none" as const },
      { id: "c", start: rat(2), dur: rat(1), pitch: 62, vol: 8, tie: "none" as const },
    ];
    const attacks = attackStarts([{ notes }]);
    expect([...attacks]).toEqual([0, 2]);
    const r = snapTaps([0, 2, 4], marks, attacks, (t) => onsetNear(peaks, t, 0.06));
    expect(r.moved.map((m) => m.index)).toEqual([0, 2]);
    expect(r.times[1]).toBe(2);
    expect(r.times[2]).toBeCloseTo(4.03, 2);
  });
});

describe("마디선 하나만 끌기", () => {
  it("앞뒤 마디선은 그 자리에 두고 양옆 두 마디 템포만 바꾼다", () => {
    // t120: 마디마다 2초. 3마디 시작(온음표 2, 4초)을 4.4초로 → 2마디 2.4초(t100), 3마디 1.6초(t150)
    const plan = pairBarTempo([{ at: rat(0), bpm: 120 }], [], rat(2), 4.4)!;
    expect(plan.bpms).toEqual([100, 150]);
    const next = [{ at: rat(0), bpm: 120 }, ...plan.set];
    expect(positionToSeconds(next, rat(2))).toBeCloseTo(4.4, 5);
    expect(positionToSeconds(next, rat(3))).toBeCloseTo(6, 5);
    // 그 뒤는 그대로
    expect(positionToSeconds(next, rat(5))).toBeCloseTo(10, 5);
  });
  it("반올림 오차는 다음 마디가 받는다", () => {
    // 3마디를 4.37초로: 2.37초 → t101(2.376초), 그 뒤 1.624초 → t148 → 4마디 끝이 6.0005초쯤 → 다음 마디가 받아 8초에 맞춘다
    const tempo = [{ at: rat(0), bpm: 120 }];
    const plan = pairBarTempo(tempo, [], rat(2), 4.37)!;
    const next = [...tempo.filter((e) => !plan.remove.some((r) => r.n === e.at.n && r.d === e.at.d)), ...plan.set];
    expect(Math.abs(positionToSeconds(next, rat(4)) - 8)).toBeLessThan(Math.abs(positionToSeconds(next, rat(3)) - 6) + 1e-9);
    expect(positionToSeconds(next, rat(4))).toBeCloseTo(8, 2);
  });
  it("앞·뒤 마디선을 넘어 끌면 안 한다", () => {
    expect(pairBarTempo([{ at: rat(0), bpm: 120 }], [], rat(2), 2)).toBeUndefined();
    expect(pairBarTempo([{ at: rat(0), bpm: 120 }], [], rat(2), 6)).toBeUndefined();
  });
  it("양옆 마디 안의 템포는 지운다", () => {
    const tempo = [{ at: rat(0), bpm: 120 }, { at: rat(3, 2), bpm: 90 }, { at: rat(2), bpm: 120 }];
    const plan = pairBarTempo(tempo, [], rat(2), 4.5)!;
    expect(plan.remove.map(String)).toContain(String(rat(3, 2)));
  });
});

describe("마디 번호로 자리 찾기", () => {
  it("박자가 바뀌어도 센다", () => {
    expect(barStart([], 3)).toEqual(rat(2));
    // 3/4 두 마디 뒤 4/4
    const sig = [{ at: rat(0), beats: 3, unit: 4 }, { at: rat(3, 2), beats: 4, unit: 4 }];
    expect(barStart(sig, 2)).toEqual(rat(3, 4));
    expect(barStart(sig, 3)).toEqual(rat(3, 2));
    expect(barStart(sig, 4)).toEqual(rat(5, 2));
  });
});

describe("영상 마디·탭 템포 안전장치 (GPT 검수 B-02·B-03)", () => {
  const bar1 = [{ at: rat(0), bpm: 120 }];
  const sig = [{ at: rat(0), beats: 4, unit: 4 }];
  it("0.5초 간격 마디는 t480, 10초 간격은 t24라 게임 범위(t32~t255) 밖으로 알린다", () => {
    const fast = tapTempos(bar1, sig, rat(0), [0, 0.5, 1.0], { unit: "bar" })!;
    expect(tempoOutOfRange(fast, MOBILE_PROFILE.tempo)).toBe(480);
    const slow = tapTempos(bar1, sig, rat(0), [0, 10, 20], { unit: "bar" })!;
    expect(tempoOutOfRange(slow, MOBILE_PROFILE.tempo)).toBe(24);
    const ok = tapTempos(bar1, sig, rat(0), [0, 2, 4], { unit: "bar" })!;
    expect(tempoOutOfRange(ok, MOBILE_PROFILE.tempo)).toBeUndefined();
  });

  it("파형 맞추기 제안은 만든 때 곡 그대로일 때만 적용하고, 다른 편집·다른 곡이면 버린다", () => {
    const song = emptySong({ title: "", author: "", profileId: "mobile" });
    const h = new History(song);
    let ran = 0;
    let stale = 0;
    const offer = boundToSong(h.song, () => ran++, () => stale++);
    offer(h.song);
    expect([ran, stale]).toEqual([1, 0]);
    const retitle: Command = {
      label: "제목",
      apply: (s) => ({ ...s, meta: { ...s.meta, title: "다른" } }),
      invert: (before) => ({ label: "제목", apply: () => before, invert: () => retitle }),
    };
    h.run(retitle);
    offer(h.song);
    expect([ran, stale]).toEqual([1, 1]);
    // 다른 곡을 연 경우
    offer(emptySong({ title: "B", author: "", profileId: "mobile" }));
    expect([ran, stale]).toEqual([1, 2]);
    // 곡이 없을 때 만든 제안은 언제나 버린다
    boundToSong(undefined, () => ran++, () => stale++)(undefined);
    expect([ran, stale]).toEqual([1, 3]);
  });
});
