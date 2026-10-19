import { describe, expect, it } from "vitest";
import { axes, fillStretch, matchRollZoom, videoMatrix, type RollView } from "../src/lib/roll";
import { fallShift, fallSpeed, speedPickAllows, speedPickLost, speedPickPress, speedPickWheel, toGray } from "../src/lib/videoSpeed";

/** 롤: 가로·세로, 건반 띠 44px */
const roll = (orientation: "horizontal" | "vertical", width = 1000, height = 600): RollView => ({
  orientation, width, height, start: 0, pxPerWhole: 160, edgePitch: orientation === "horizontal" ? 108 : 21, pxPerKey: (orientation === "horizontal" ? height : width) / 88, keyboard: 44,
});

describe("fillStretch: 화면 채우기 (지시서 26)", () => {
  const sizes: [string, number, number][] = [["16:9", 1920, 1080], ["4:3", 1440, 1080], ["세로", 1080, 1920]];
  for (const orientation of ["horizontal", "vertical"] as const)
    for (const [name, w, h] of sizes)
      for (const keyLine of [0.85, 0.6])
        it(`${orientation === "horizontal" ? "가로" : "세로"} 롤 · ${name} · keyLine ${keyLine}: 덮는 길이 = 보이는 시간 축`, () => {
          const v = roll(orientation);
          const video = { low: 21, high: 108, keyLine };
          const stretch = fillStretch(v, video, w, h);
          const m = videoMatrix(v, { ...video, stretch }, w, h);
          // 영상 맨 위(y = 0)가 롤 시간 축 끝에, 건반 윗선(y = keyLine × h)이 건반 선에 온다
          if (orientation === "horizontal") {
            const top = m[2] * 0 + m[4];
            const line = m[2] * keyLine * h + m[4];
            expect(Math.abs(line - v.keyboard)).toBeLessThanOrEqual(1);
            expect(Math.abs(top - v.width)).toBeLessThanOrEqual(1);
            expect(Math.abs(top - line - axes(v).time)).toBeLessThanOrEqual(1);
          } else {
            const top = m[3] * 0 + m[5];
            const line = m[3] * keyLine * h + m[5];
            expect(Math.abs(line - (v.height - v.keyboard))).toBeLessThanOrEqual(1);
            expect(Math.abs(top)).toBeLessThanOrEqual(1);
          }
        });
  it("0.1~10으로 자른다", () => {
    expect(fillStretch(roll("horizontal"), { low: 21, high: 108, keyLine: 0 }, 1920, 1080)).toBe(10);
    expect(fillStretch(roll("horizontal", 50, 4000), { low: 21, high: 108, keyLine: 1 }, 100, 100000)).toBe(0.1);
  });
});

describe("matchRollZoom: 롤 가로 확대 맞추기", () => {
  it("bpm 120에서 화면 400px/초 → 온음표 800px", () => {
    expect(matchRollZoom(400, 120)).toBe(800);
  });
  it("bpm 60이면 온음표가 4초라 1600px", () => {
    expect(matchRollZoom(400, 60)).toBe(1600);
  });
});

/** 가로 width, 세로 rows의 합성 프레임: 높이 bar인 밝은 가로 막대들이 top에서 시작 */
function frame(width: number, rows: number, bars: number[], bar = 3): Float32Array {
  const out = new Float32Array(width * rows);
  for (const top of bars)
    for (let y = top; y < top + bar; y++)
      if (y >= 0 && y < rows) for (let x = 10; x < width - 10; x++) out[y * width + x] = 1;
  // 가로 무늬 (막대마다 다른 너비로 구별되게)
  for (let i = 0; i < out.length; i++) out[i]! += ((i % width) % 7) * 0.01;
  return out;
}

describe("떨어지는 속도 재기: 세로 상호상관", () => {
  it("막대가 6px 내려온 두 장에서 이동량 6", () => {
    const a = frame(96, 48, [2, 15, 30]);
    const b = frame(96, 48, [8, 21, 36]);
    const r = fallShift(a, b, 96, 48);
    expect(r).toBeDefined();
    expect(r!.shift).toBeCloseTo(6, 0);
  });
  it("움직임 없는 두 장은 실패", () => {
    const a = frame(96, 48, [5, 20]);
    expect(fallShift(a, a, 96, 48)).toBeUndefined();
  });
  it("무늬가 없는 화면은 실패", () => {
    const flat = new Float32Array(96 * 48).fill(0.3);
    expect(fallShift(flat, flat, 96, 48)).toBeUndefined();
  });
  it("줄인 프레임 이동을 원본 px/초로: 6줄 × 20배 / 0.25초 = 480", () => {
    expect(fallSpeed(6, 20)).toBe(480);
  });
  it("RGBA를 회색조로", () => {
    expect([...toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1)]).toEqual([1, 0]);
  });
});

describe("직접 재기 누름 판단 (PR #152 점검: 재기 중 누름이 음을 넣지 않게)", () => {
  it("1·2·3단계의 누름은 모두 재기가 가져간다 (보통 편집으로 가지 않는다)", () => {
    for (const step of [1, 2, 3] as const) expect(speedPickPress(step, step === 1 ? undefined : 100, 120).consumed).toBe(true);
    expect(speedPickPress(0, undefined, 120).consumed).toBe(false);
  });
  it("2단계 누름은 단계·첫 점을 바꾸지 않는다", () => {
    expect(speedPickPress(2, 100, 140)).toEqual({ consumed: true, step: 2, firstY: 100 });
  });
  it("첫 점을 빠르게 두 번 눌러도 음이 들어가지 않고 첫 점이 그대로 (회귀)", () => {
    const first = speedPickPress(1, undefined, 100);
    expect(first).toEqual({ consumed: true, step: 2, firstY: 100 });
    const again = speedPickPress(first.step, first.firstY, 101);
    expect(again.consumed).toBe(true);
    expect([again.step, again.firstY, again.done]).toEqual([2, 100, undefined]);
  });
  it("3단계에서 같은 음이 내려온 자리를 누르면 속도, 위로 누르면 잴 수 없음", () => {
    expect(speedPickPress(3, 100, 160).done).toEqual({ speed: 120 });
    expect(speedPickPress(3, 100, 160).step).toBe(0);
    expect(speedPickPress(3, 100, 90).done).toEqual({ speed: undefined });
  });
  it("영상 밖이라 자리를 모르면 단계는 그대로 (그래도 편집으로 가지 않는다)", () => {
    expect(speedPickPress(1, undefined, undefined)).toEqual({ consumed: true, step: 1, firstY: undefined });
  });
});

describe("재는 중 영상이 없어지거나 바뀌면 그만두기", () => {
  const video = { url: "blob:a", fit: true };
  const song = { id: "곡" };
  const pick = { url: "blob:a", song };
  it("영상 지우기·다른 영상·건반 맞춤 끄기 → 그만둔다", () => {
    expect(speedPickLost(2, pick, undefined, song)).toBe(true);
    expect(speedPickLost(1, pick, { url: "blob:b", fit: true }, song)).toBe(true);
    expect(speedPickLost(3, pick, { ...video, fit: false }, song)).toBe(true);
  });
  it("같은 영상이면 이어 간다. 재고 있지 않으면 상관없다", () => {
    expect(speedPickLost(2, pick, video, song)).toBe(false);
    expect(speedPickLost(0, undefined, undefined, song)).toBe(false);
  });
  it("곡이 바뀌면(다른 길로 고침·다른 곡 열기) 그만둔다. 시작 기록이 없는 단계(롤을 새로 만든 뒤)도 그만둔다", () => {
    expect(speedPickLost(2, pick, video, { id: "곡" })).toBe(true);
    expect(speedPickLost(1, undefined, video, song)).toBe(true);
  });
  it("그만둔 뒤(0단계)의 누름은 보통 편집으로 간다", () => {
    expect(speedPickPress(0, undefined, 50).consumed).toBe(false);
  });
});

describe("직접 재기 중 곡을 바꾸는 입구 닫기 (지시서 34)", () => {
  const commands = ["edit.paste", "edit.undo", "edit.redo", "note.delete", "note.volumeUp", "note.octaveUp", "edit.transpose", "event.tempo", "track.moveUp", "play.toggle", "view.tab", "view.orientation", "grid.16"];
  it("재는 중(1·2·3단계)에는 저장 말고 어떤 명령도 받지 않는다", () => {
    for (const step of [1, 2, 3] as const) {
      for (const c of commands) expect(speedPickAllows(step, c), `${step}단계 ${c}`).toBe(false);
      for (const c of ["file.saveProject", "file.saveProjectAs", "file.save3mle", "file.saveMmi"]) expect(speedPickAllows(step, c)).toBe(true);
    }
  });
  it("재고 있지 않으면 모든 명령을 받는다", () => {
    for (const c of commands) expect(speedPickAllows(0, c)).toBe(true);
  });
  it("휠: 재는 중에는 볼륨·템포를 바꾸지 않고, 첫 점 전에만 화면을 움직인다", () => {
    expect(speedPickWheel(0)).toBe("edit");
    expect(speedPickWheel(1)).toBe("view");
    expect(speedPickWheel(2)).toBe("none");
    expect(speedPickWheel(3)).toBe("none");
  });
});
