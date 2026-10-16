import { describe, expect, it } from "vitest";
import { add, rat } from "@mmlce/core";
import { parseMml } from "../src/index.js";

const pitches = (text: string) => parseMml(text).notes.map((n) => n.pitch);

describe("parseMml", () => {
  it("음 높이: o4c = MIDI 60, 반음 기호, 옥타브 이동", () => {
    expect(pitches("cdefgab")).toEqual([60, 62, 64, 65, 67, 69, 71]);
    expect(pitches("c+d#e-")).toEqual([61, 63, 63]);
    expect(pitches("o5c<c>>c")).toEqual([72, 60, 84]);
    expect(pitches("n48n60")).toEqual([60, 72]);
  });

  it("길이: l 기본값과 점 물려받기", () => {
    const r = parseMml("l8c c4 l8. d d16 d.");
    expect(r.notes.map((n) => n.dur)).toEqual([
      rat(1, 8), rat(1, 4), rat(3, 16), rat(1, 16), rat(3, 16),
    ]);
  });

  it("불규칙 음길이와 64. 48.", () => {
    const r = parseMml("c7c37c64.c48.");
    expect(r.notes.map((n) => n.dur)).toEqual([rat(1, 7), rat(1, 37), rat(3, 128), rat(1, 32)]);
  });

  it("쉼표는 위치만 옮긴다", () => {
    const r = parseMml("c4r4c4");
    expect(r.notes.map((n) => n.start)).toEqual([rat(0), rat(1, 2)]);
    expect(r.end).toEqual(rat(3, 4));
  });

  it("&는 앞 음에 이음 표시, 다른 음 사이도 유지", () => {
    const r = parseMml("c4&c4 c4&d4");
    expect(r.notes.map((n) => n.tie)).toEqual(["next", "none", "next", "none"]);
  });

  it("볼륨과 템포 (템포는 음 경계가 아니어도 됨)", () => {
    const r = parseMml("v12c4t90 c8 t300 c8");
    expect(r.notes.map((n) => n.vol)).toEqual([12, 12, 12]);
    expect(r.tempo).toEqual([
      { at: rat(1, 4), bpm: 90 },
      { at: rat(3, 8), bpm: 300 },
    ]);
  });

  it("3MLE 주석은 건너뛴다", () => {
    expect(pitches("c /* b- 메모 */ d")).toEqual([60, 62]);
  });

  it("알 수 없는 문자는 경고로 남기고 계속 읽는다", () => {
    const r = parseMml("c4 x d4");
    expect(r.notes).toHaveLength(2);
    expect(r.diagnostics).toMatchObject([{ level: "warning", code: "unknown-char", span: [3, 4] }]);
  });

  it("닫히지 않은 주석은 채널 끝까지", () => {
    const r = parseMml("c d /* e f");
    expect(r.notes).toHaveLength(2);
    expect(r.diagnostics).toMatchObject([{ level: "warning", code: "unclosed-comment" }]);
  });

  it("서로소 음길이가 쌓여 분수가 너무 커지면 예외 대신 진단을 남기고 멈춘다", () => {
    const r = parseMml("c7c11c13c17c19c23c29c31c37c41c43c47");
    expect(r.diagnostics).toMatchObject([{ level: "error", code: "length-overflow" }]);
    expect(r.notes.length).toBeGreaterThan(0);
    expect(() => parseMml("c9007199254740992")).not.toThrow();
    // 남은 음은 끝 위치를 셀 수 있어야 뒤 계산(재생·검사)이 다시 넘치지 않는다
    for (const n of r.notes) expect(() => add(n.start, n.dur)).not.toThrow();
  });
});
