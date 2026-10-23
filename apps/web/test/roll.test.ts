import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, rat } from "@mmlce/core";
import { describeDiagnostic } from "@mmlce/i18n";
import {
  lengthsFor,
  NOTE_LENGTHS,
  stepNoteLength,
  clampPitchView,
  dragKeyLine,
  fitVideoKeys,
  keyAt,
  noteRect,
  pitchToScreen,
  screenToPitch,
  videoMatrix,
  whiteKeyEdges,
  type RollView,
  noteNear,
  isResizeGrab,
  noteLengthOf,
  eventLabels,
  eventAt,
  eventRow,
  eventRowFor,
  eventFontSize,
  eventsBottom,
  BAR_ROW,
  barFontSize,
  barRowSize,
  EVENT_ROW,
  axes,
  inLane,
  laneBarAt,
  laneValueAt,
  laneValueToScreen,
  LANE_GUTTER,
} from "../src/lib/roll";

const apply = (m: number[], x: number, y: number) => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!];

describe("videoMatrix", () => {
  const video = { low: 48, high: 71, keyLine: 0.75, stretch: 2 };
  // 24건반 영상, 가로 240px(건반 하나 10px), 세로 100px, 건반 윗선 y=75

  it("세로 롤: 영상 건반이 롤 건반 칸과 겹치고 건반 윗선이 롤 바닥선에 온다", () => {
    const v: RollView = { orientation: "vertical", width: 600, height: 400, start: 0, pxPerWhole: 100, edgePitch: 40, pxPerKey: 12, keyboard: 40 };
    const m = videoMatrix(v, video, 240, 100);
    const c4 = noteRect(v, 0, 1, 60);
    // 영상에서 C4(60) 건반 왼쪽 = (60-48)*10
    expect(apply(m, 120, 75)).toEqual([c4.x, 400 - 40]);
    // 위로 25px(영상) → 시간 축으로 25 * (12/10) * 2
    expect(apply(m, 120, 50)[1]).toBeCloseTo(360 - 60);
  });

  it("가로 롤: 높은 음이 위, 건반 윗선이 건반 띠 오른쪽에 온다", () => {
    const v: RollView = { orientation: "horizontal", width: 600, height: 400, start: 0, pxPerWhole: 100, edgePitch: 84, pxPerKey: 12, keyboard: 44 };
    const m = videoMatrix(v, video, 240, 100);
    const c4 = noteRect(v, 0, 1, 60);
    // C4 건반의 오른쪽 끝(영상 x=130)이 롤 C4 줄 윗변
    const [x, y] = apply(m, 130, 75);
    expect(x).toBeCloseTo(44);
    expect(y).toBeCloseTo(c4.y);
    expect(apply(m, 130, 50)[0]).toBeCloseTo(44 + 60);
  });
});

describe("whiteKeyEdges", () => {
  it("검은건반이 위에 붙은 흰건반은 그 칸 가운데, E–F·B–C는 칸 경계에서 나뉜다", () => {
    // o4c(60)~o4b(71): C|D 60+1.5, D|E 62+1.5, E|F 65, F|G 66+1.5, G|A 68+1.5, A|B 70+1.5, B|C 72
    expect(whiteKeyEdges(60, 71)).toEqual([61.5, 63.5, 65, 66.5, 68.5, 70.5, 72]);
  });
});

describe("건반 띠 판정", () => {
  const v: RollView = { orientation: "horizontal", width: 600, height: 320, start: 0, pxPerWhole: 160, edgePitch: 84, pxPerKey: 12, keyboard: 44 };
  // 가로 롤에서 높이 p의 칸은 y ∈ [(84 - p) * 12, (84 - p + 1) * 12). C#4(61) 칸은 [276, 288)
  it("흰건반은 그려진 대로 검은건반 옆 넓은 자리까지, 검은건반은 롤 쪽 짧은 부분만", () => {
    // C#4 칸이라도 바깥쪽(왼쪽 끝)은 흰건반: 칸 아래 반은 C4, 위 반은 D4
    expect(keyAt(v, 5, 285)).toBe(60);
    expect(keyAt(v, 5, 279)).toBe(62);
    // 롤 쪽(검은건반 길이 안)은 C#4
    expect(keyAt(v, 40, 282)).toBe(61);
    // E4(64)와 F4(65)는 칸 경계(y = 240)에서 나뉜다
    expect(keyAt(v, 5, 241)).toBe(64);
    expect(keyAt(v, 5, 239)).toBe(65);
  });
});

describe("음 높이 범위 제한", () => {
  // 넓은 세로 롤: 2400px에 칸 12px이면 200건반이 보여 o19까지 나왔다
  const wide: RollView = { orientation: "vertical", width: 2400, height: 400, start: 0, pxPerWhole: 100, edgePitch: 36, pxPerKey: 12, keyboard: 44 };

  it("범위보다 많은 건반이 보이면 칸을 키워 C0~B8을 꽉 채운다", () => {
    const c = clampPitchView(wide, 12, 119);
    expect(c.pxPerKey).toBeCloseTo(2400 / 108);
    expect(c.edgePitch).toBe(12);
  });

  it("칸이 충분히 크면 그대로 두고, 범위 끝을 넘으면 기준 음을 안으로 당긴다", () => {
    expect(clampPitchView({ ...wide, width: 600, edgePitch: 60 }, 12, 119)).toEqual({ pxPerKey: 12, edgePitch: 60 });
    // 600px / 12 = 50건반 → 맨 왼쪽은 119 - 49 = 70까지
    expect(clampPitchView({ ...wide, width: 600, edgePitch: 100 }, 12, 119).edgePitch).toBe(70);
    const h: RollView = { ...wide, orientation: "horizontal", height: 240, edgePitch: 20 };
    // 가로 롤: 240 / 12 = 20건반 → 맨 위 음은 12 + 19 = 31 이상
    expect(clampPitchView(h, 12, 119).edgePitch).toBe(31);
    // 320 / 12 = 26.7건반: 반쯤 보이는 27번째 칸도 범위 안이어야 → 맨 위 음은 12 + 26 = 38 이상
    expect(clampPitchView({ ...h, height: 320 }, 12, 119).edgePitch).toBe(38);
  });
});

describe("영상 건반 맞춤", () => {
  const v: RollView = { orientation: "vertical", width: 880, height: 400, start: 0, pxPerWhole: 100, edgePitch: 36, pxPerKey: 12, keyboard: 44 };

  it("롤 맞추기: 88건반 영상이면 A0이 왼쪽 끝, 칸 = 폭 / 88", () => {
    expect(fitVideoKeys(v, { low: 21, high: 108 })).toEqual({ pxPerKey: 10, edgePitch: 21 });
    expect(fitVideoKeys({ ...v, orientation: "horizontal", height: 880 }, { low: 21, high: 108 })).toEqual({ pxPerKey: 10, edgePitch: 108 });
  });

  it("음 높이 좌표 ↔ 화면 좌표", () => {
    expect(pitchToScreen(v, 37.5)).toBe(18);
    expect(screenToPitch(v, 18)).toBe(37.5);
    const h: RollView = { ...v, orientation: "horizontal", edgePitch: 84 };
    expect(pitchToScreen(h, 85)).toBe(0);
    expect(screenToPitch(h, pitchToScreen(h, 60.25))).toBeCloseTo(60.25);
  });

  it("건반 윗선 막대를 끈 만큼 영상이 따라 움직인다", () => {
    const video = { low: 48, high: 71, keyLine: 0.75, stretch: 2 };
    // 영상 240×100, 칸 12px → 영상 1px = 시간 축 1.2 * 2 = 2.4px
    const keyLine = dragKeyLine(v, video, 240, 100, 24);
    expect(keyLine).toBeCloseTo(0.85);
    const before = videoMatrix(v, video, 240, 100);
    const after = videoMatrix(v, { ...video, keyLine }, 240, 100);
    // 영상의 같은 점이 화면에서 24px 위로
    expect(after[5] - before[5]).toBeCloseTo(-24);
  });
});

describe("작은 음 누르기", () => {
  const n = (s: number, d: number, pitch = 60) => ({ start: rat(s, 64), dur: rat(d, 64), pitch });

  it("정확히 맞은 음이 먼저, 좁은 음은 넓힌 자리에서도 잡힌다", () => {
    // 온음표 64px → 1/64 음은 1px. 넓힌 자리는 8px
    const tiny = n(10, 1);
    expect(noteNear([tiny], 10.5 / 64, 60, 64)).toBe(tiny);
    expect(noteNear([tiny], 7.6 / 64, 60, 64)).toBe(tiny); // 시작보다 2.4px 앞
    expect(noteNear([tiny], 6 / 64, 60, 64)).toBeUndefined(); // 4px 앞
    expect(noteNear([tiny], 7.6 / 64, 61, 64)).toBeUndefined(); // 다른 높이
    // 손가락은 14px까지
    expect(noteNear([tiny], 5.5 / 64, 60, 64, true)).toBe(tiny);
  });

  it("넉넉한 음은 넓히지 않아 바로 옆에 새 음을 넣을 수 있다", () => {
    const wide = n(0, 16); // 16px
    expect(noteNear([wide], 16.5 / 64, 60, 64)).toBeUndefined();
  });

  it("넉넉한 음은 끝 6px(폭 1/3까지)이 길이 바꾸기, 좁은 음은 몸통이 늘 옮기기", () => {
    const wide = n(0, 64); // 64px
    expect(isResizeGrab(wide, 60 / 64, 64)).toBe(true);
    expect(isResizeGrab(wide, 50 / 64, 64)).toBe(false);
    const mid = n(0, 12); // 12px: 끝 4px만
    expect(isResizeGrab(mid, 9 / 64, 64)).toBe(true);
    expect(isResizeGrab(mid, 7 / 64, 64)).toBe(false);
    const tiny = n(10, 4); // 4px: 몸통은 옮기기, 끝 바깥은 길이
    expect(isResizeGrab(tiny, 13.9 / 64, 64)).toBe(false);
    expect(isResizeGrab(tiny, 14.5 / 64, 64)).toBe(true);
  });
});

describe("noteLengthOf", () => {
  it("격자대로면 격자 한 칸, 아니면 MML 길이 (점·셋잇단 포함)", () => {
    expect(noteLengthOf("grid", 16)).toEqual(rat(1, 16));
    expect(noteLengthOf("4", 16)).toEqual(rat(1, 4));
    expect(noteLengthOf("8.", 16)).toEqual(rat(3, 16));
    expect(noteLengthOf("2.", 64)).toEqual(rat(3, 4));
    expect(noteLengthOf("12", 16)).toEqual(rat(1, 12));
  });
});

describe("eventLabels / eventAt", () => {
  const events = { tempo: [{ at: rat(0), bpm: 120 }, { at: rat(1), bpm: 90 }], timeSig: [{ at: rat(0), beats: 4, unit: 4 }], markers: [{ id: "m1", at: rat(1), label: "A" }] };
  it("가로 롤: 템포는 첫 칸, 박자·마커는 둘째 칸", () => {
    const v: RollView = { orientation: "horizontal", width: 800, height: 400, start: 0, pxPerWhole: 100, edgePitch: 84, pxPerKey: 12, keyboard: 44 };
    const labels = eventLabels(v, events);
    const t90 = labels.find((l) => l.text === "t90")!;
    expect([t90.x, t90.y]).toEqual([144, 14]);
    expect(eventAt(labels, 150, 20)?.text).toBe("t90");
    expect(eventAt(labels, 150, 34)?.id).toBe("m1");
    expect(eventAt(labels, 300, 20)).toBeUndefined();
  });
  it("세로 롤: 바뀌는 자리 아래에 템포, 그 아래 마커", () => {
    const v: RollView = { orientation: "vertical", width: 400, height: 800, start: 0, pxPerWhole: 100, edgePitch: 36, pxPerKey: 12, keyboard: 44 };
    const labels = eventLabels(v, events);
    const t90 = labels.find((l) => l.text === "t90")!;
    expect([t90.x, t90.y]).toEqual([2, 656]);
    expect(eventAt(labels, 10, 660)?.text).toBe("t90");
    expect(eventAt(labels, 10, 674)?.id).toBe("m1");
  });
  it("같은 자리의 박자와 마커는 겹치지 않게 밀어 쓴다 (가로는 오른쪽, 세로는 아래)", () => {
    const same = { tempo: [{ at: rat(1), bpm: 90 }], timeSig: [{ at: rat(1), beats: 3, unit: 4 }], markers: [{ id: "m1", at: rat(1), label: "Chorus" }] };
    const h: RollView = { orientation: "horizontal", width: 800, height: 400, start: 0, pxPerWhole: 100, edgePitch: 84, pxPerKey: 12, keyboard: 44 };
    const hl = eventLabels(h, same);
    const meter = hl.find((l) => l.kind === "meter")!;
    const marker = hl.find((l) => l.kind === "marker")!;
    expect(meter.x).toBe(144);
    expect(marker.x).toBe(meter.x + meter.w + 2);
    expect(marker.y).toBe(meter.y);
    expect(hl.find((l) => l.text === "t90")!.x).toBe(144);
    expect(eventAt(hl, marker.x + 5, marker.y + 5)?.id).toBe("m1");
    const vt: RollView = { ...h, orientation: "vertical", width: 400, height: 800, edgePitch: 36 };
    const vl = eventLabels(vt, same);
    const vm = vl.find((l) => l.kind === "meter")!;
    expect(vl.find((l) => l.kind === "marker")!.y).toBe(vm.y + vm.h);
  });
  it("설정의 글자 크기를 따라 칸이 두꺼워지고, 누르는 칸도 그 자리를 따른다", () => {
    // 기본(타브 13px)은 전과 같은 14px 칸
    expect(eventRowFor(13)).toBe(EVENT_ROW);
    expect(eventRowFor(10)).toBe(13);
    expect(eventRowFor(20)).toBe(21);
    const base: RollView = { orientation: "horizontal", width: 800, height: 400, start: 0, pxPerWhole: 100, edgePitch: 84, pxPerKey: 12, keyboard: 44 };
    const v: RollView = { ...base, eventRow: eventRowFor(20) };
    expect(eventFontSize(v)).toBe(18);
    expect(eventsBottom(v)).toBe(BAR_ROW + 42);
    const t90 = eventLabels(v, events).find((l) => l.text === "t90")!;
    expect([t90.y, t90.h]).toEqual([14, 21]);
    expect(t90.w).toBeGreaterThan(eventLabels(base, events).find((l) => l.text === "t90")!.w);
    expect(eventRow(v, 300, 30)).toBe(0);
    expect(eventRow(v, 300, 40)).toBe(1);
    expect(eventRow(v, 300, BAR_ROW + 42)).toBeUndefined();
    expect(eventRow(base, 300, 45)).toBeUndefined();
    expect(eventRow(v, 300, 45)).toBe(1);
  });
  it("화면 배율로 마디 번호 줄이 두꺼워지면 이벤트 줄과 누르는 칸도 그만큼 아래로", () => {
    const base: RollView = { orientation: "horizontal", width: 800, height: 400, start: 0, pxPerWhole: 100, edgePitch: 84, pxPerKey: 12, keyboard: 44 };
    const v: RollView = { ...base, barRow: 21, eventRow: eventRowFor(20) };
    expect(barRowSize(base)).toBe(BAR_ROW);
    expect(barFontSize(base)).toBe(10);
    expect(barFontSize(v)).toBe(17);
    expect(eventsBottom(v)).toBe(21 + 42);
    expect(eventLabels(v, events).find((l) => l.text === "t90")!.y).toBe(21);
    expect(eventRow(v, 300, 20)).toBeUndefined();
    expect(eventRow(v, 300, 21)).toBe(0);
    expect(eventRow(v, 300, 42)).toBe(1);
  });
  it("곡 처음에 템포가 없으면 기본값 t120을 옅은 곡 처음 라벨로 보인다", () => {
    const v: RollView = { orientation: "horizontal", width: 800, height: 400, start: 0, pxPerWhole: 100, edgePitch: 84, pxPerKey: 12, keyboard: 44 };
    const labels = eventLabels(v, { ...events, tempo: [{ at: rat(1), bpm: 90 }] }).filter((l) => l.kind === "tempo");
    expect(labels.map((l) => [l.text, l.implicit ?? false])).toEqual([["t120", true], ["t90", false]]);
    expect(eventLabels(v, events).some((l) => l.implicit)).toBe(false);
  });
});

describe("음량 레인", () => {
  const range = { min: 0, max: 15 };
  const h: RollView = { orientation: "horizontal", width: 600, height: 400, start: 0, pxPerWhole: 100, edgePitch: 84, pxPerKey: 12, keyboard: 44, lane: 96 + LANE_GUTTER };
  const vt: RollView = { ...h, orientation: "vertical", edgePitch: 36 };

  it("레인 두께만큼 음 축이 줄고, 레인 안팎을 가른다", () => {
    expect(axes(h).pitch).toBe(400 - 96 - LANE_GUTTER);
    expect(axes(vt).pitch).toBe(600 - 96 - LANE_GUTTER);
    expect(inLane(h, 100, 390)).toBe(true);
    expect(inLane(h, 100, 200)).toBe(false);
    // 건반 띠 쪽 모서리는 레인이 아니다
    expect(inLane(h, 20, 390)).toBe(false);
    expect(inLane(vt, 590, 100)).toBe(true);
    expect(inLane(vt, 590, 380)).toBe(false);
  });

  it("값과 화면 좌표가 두 방향 모두 왕복한다 (가로는 위, 세로는 오른쪽이 크다)", () => {
    for (const v of [h, vt]) {
      for (let vol = 0; vol <= 15; vol++) {
        const p = laneValueToScreen(v, vol, range);
        const [x, y] = v.orientation === "horizontal" ? [200, p] : [p, 100];
        expect(laneValueAt(v, x, y, range)).toBe(vol);
      }
      expect(laneValueToScreen(v, 15, range) < laneValueToScreen(v, 0, range)).toBe(v.orientation === "horizontal");
    }
    // 칸 밖은 끝값으로
    expect(laneValueAt(h, 200, 0, range)).toBe(15);
    expect(laneValueAt(h, 200, 399, range)).toBe(0);
  });

  it("좁은 막대는 누를 자리를 넓혀 찾는다", () => {
    const bars = [{ start: rat(0), end: rat(1, 4) }, { start: rat(1, 2), end: rat(33, 64) }];
    expect(laneBarAt(bars, 0.1, 100)).toBe(bars[0]);
    // 1/64 = 1.6px 막대: 2px 옆도 잡힌다
    expect(laneBarAt(bars, 0.49, 100)).toBe(bars[1]);
    expect(laneBarAt(bars, 0.4, 100)).toBeUndefined();
  });
});

describe("stepNoteLength: +/− 키 길이", () => {
  it("1/8 → 1/4, 1/4 → 1/8, 64분음표의 ½과 온음표의 ×2는 목록 밖이라 undefined", () => {
    expect(stepNoteLength(rat(1, 8), 2)).toBe("4");
    expect(stepNoteLength(rat(1, 4), 0.5)).toBe("8");
    expect(stepNoteLength(rat(1, 64), 0.5)).toBeUndefined();
    expect(stepNoteLength(rat(1), 2)).toBeUndefined();
    expect(stepNoteLength(rat(3, 16), 2)).toBe("4.");
  });

  it("격자에서 출발하면 격자 한 칸 길이를 바꾼다", () => {
    expect(stepNoteLength(noteLengthOf("grid", 16), 2)).toBe("8");
    expect(stepNoteLength(noteLengthOf("grid", 12), 0.5)).toBe("24");
  });

  it("셋잇단은 12 → 6 → 3, 3 → 6 → 12", () => {
    expect(stepNoteLength(rat(1, 12), 2)).toBe("6");
    expect(stepNoteLength(rat(1, 6), 2)).toBe("3");
    expect(stepNoteLength(rat(1, 3), 0.5)).toBe("6");
    expect(stepNoteLength(rat(1, 6), 0.5)).toBe("12");
  });

  it("고르기 목록에 더 둔 길이(사용자가 정한 잇단음)로도 옮긴다. 게임 한도 밖이면 아니다", () => {
    expect(stepNoteLength(rat(1, 20), 2)).toBeUndefined();
    expect(stepNoteLength(rat(1, 20), 2, undefined, ["10"])).toBe("10");
    expect(stepNoteLength(rat(1, 10), 0.5, undefined, ["20"])).toBe("20");
    expect(stepNoteLength(rat(1, 20), 0.5, { min: 1, max: 32, dots: 1 }, ["40"])).toBeUndefined();
  });
});

describe("길이 고르기 목록을 게임 음길이 한도로 거르기", () => {
  it("지금 한도에서는 32.·64.이 들어 있고, grid는 늘 남는다", () => {
    const now = lengthsFor(MOBILE_PROFILE.length);
    expect(now).toContain("32.");
    expect(now).toContain("64.");
    expect(now).toEqual([...NOTE_LENGTHS]);
    const narrow = lengthsFor({ min: 1, max: 32, dots: 0 });
    expect(narrow).not.toContain("64");
    expect(narrow).not.toContain("16.");
    expect(narrow[0]).toBe("grid");
  });

  it("+/− 키도 거른 목록에서 찾는다 (점 붙은 짧은 길이 포함)", () => {
    expect(stepNoteLength(rat(3, 32), 0.5, MOBILE_PROFILE.length)).toBe("32.");
    expect(stepNoteLength(rat(3, 64), 0.5, MOBILE_PROFILE.length)).toBe("64.");
    expect(stepNoteLength(rat(3, 64), 0.5, { min: 1, max: 32, dots: 1 })).toBeUndefined();
  });

  it("진단 문구에 한도가 들어간다", () => {
    expect(describeDiagnostic("ko", { code: "unrepresentable-length", params: { min: 1, max: 64 } })).toContain("1~64");
  });
});
