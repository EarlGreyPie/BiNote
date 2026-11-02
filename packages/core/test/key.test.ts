import { describe, expect, it } from "vitest";
import { applyKeyMove, dragInKey, fitNotesToKey, inKey, keyAt, keyNames, keyStartAt, keyMove, keySteps, moveInKey, rat, snapToKey, stepInKey, type Note } from "../src/index.js";

const note = (id: string, start: number, pitch: number): Note => ({ id, start: rat(Math.round(start * 4), 4), dur: rat(1, 4), pitch, vol: 10, tie: "none" });

describe("조표", () => {
  it("음계와 이름", () => {
    expect(inKey(66, 1)).toBe(true); // G장조 F#
    expect(inKey(65, 1)).toBe(false); // G장조 F
    expect(inKey(70, -1)).toBe(true); // F장조 B♭
    expect(keyNames(1)).toEqual({ major: "G", minor: "e" });
    expect(keyNames(-3)).toEqual({ major: "E♭", minor: "c" });
    expect(keyNames(6)).toEqual({ major: "F#", minor: "d#" });
    expect(keyNames(0)).toEqual({ major: "C", minor: "a" });
  });

  it("흰 건반은 조표의 올림·내림을, 조에 없는 검은 건반은 제자리음으로", () => {
    expect(snapToKey(65, 1)).toBe(66); // G장조 F → F#
    expect(snapToKey(71, -1)).toBe(70); // F장조 B → B♭
    expect(snapToKey(61, 1)).toBe(60); // G장조 C# → C
    expect(snapToKey(63, -1)).toBe(64); // F장조 E♭ → E
    expect(snapToKey(61, 0)).toBe(60); // 다장조 C# → C
    expect(snapToKey(60, 7)).toBe(60); // C#장조 C = B#
    expect(snapToKey(62, 7)).toBe(63); // C#장조 D → D#
    expect(snapToKey(60, -7)).toBe(59); // C♭장조 C → C♭(B)
  });

  it("모든 조에서 맞춘 음은 조 안 음이다", () => {
    for (let f = -7; f <= 7; f++) for (let p = 1; p < 127; p++) expect(inKey(snapToKey(p, f), f)).toBe(true);
  });

  it("조 안에서 음계 칸 단위로 옮긴다", () => {
    expect(stepInKey(64, 0, 1)).toBe(65); // E → F
    expect(stepInKey(65, 0, 1)).toBe(67); // F → G
    expect(stepInKey(67, 1, -1)).toBe(66); // G장조 G → F#
    expect(stepInKey(127, 0, 1)).toBeUndefined();
    expect(keySteps(60, 67, 0)).toBe(4);
    expect(keySteps(67, 60, 0)).toBe(-4);
  });

  it("끌어 옮기면 화음이 조를 벗어나지 않고, 임시표는 같은 반음 수만큼", () => {
    // 다장조 C-E-G를 잡은 C로 D까지 → D-F-A
    expect([60, 64, 67].map((p) => moveInKey(p, 60, 62, 0))).toEqual([62, 65, 69]);
    // 임시표 C#은 잡은 음이 움직인 반음(2)만큼
    expect(moveInKey(61, 60, 62, 0)).toBe(63);
  });

  it("조바꿈을 걸친 선택은 잡은 음의 조로 센 칸 수만큼 음마다 제 조에서 옮긴다", () => {
    // D♭장조(-5)에서 잡은 C를 D♭으로: 음계 한 칸 위
    const move = keyMove(60, 61, -5);
    expect(move).toEqual({ steps: 1, semitones: 1 });
    expect(applyKeyMove(60, move, -5)).toBe(61);
    // 다장조 쪽 C도 한 칸 위 D로 (제 조에서 다시 세면 D♭이 C로 맞춰져 제자리였다)
    expect(applyKeyMove(60, move, 0)).toBe(62);
    expect(moveInKey(60, 60, 61, 0)).toBe(60);
    // 다장조 쪽 임시표 C#은 반음 수만큼
    expect(applyKeyMove(61, move, 0)).toBe(62);
    expect(applyKeyMove(127, move, 0)).toBeUndefined();
  });

  it("조바꿈을 걸친 선택을 끌면 모든 음이 같은 음계 칸 수만큼 움직인다", () => {
    // 1마디 다장조, 2마디부터 D♭장조. 2마디의 C를 잡아 반음 위(D♭)로 끈다
    const keys = [{ at: rat(1), fifths: -5 }];
    const grab = { pitch: 60, at: rat(1) };
    const notes = [{ pitch: 60, at: rat(0) }, { pitch: 61, at: rat(0) }, grab];
    // 다장조 쪽 C는 한 칸 위 D, 임시표 C#은 반음 위 D, 잡은 C는 D♭
    expect(dragInKey(notes, grab, 1, keys)).toEqual([62, 62, 61]);
    // 다장조 쪽 C를 잡아 반음 위로 끌면 C#이 C로 맞춰져 모두 제자리, 온음 위로 끌면 한 칸이라 D♭장조 쪽 C는 D♭
    expect(dragInKey([grab, notes[0]!], notes[0]!, 1, keys)).toEqual([60, 60]);
    expect(dragInKey([grab, notes[0]!], notes[0]!, 2, keys)).toEqual([61, 62]);
    // 건반 밖으로 나가는 음이 있으면 높이는 그대로
    expect(dragInKey([{ pitch: 127, at: rat(0) }, grab], grab, 1, keys)).toBeUndefined();
    // 옆으로만 (dp 0): 그대로
    expect(dragInKey(notes, grab, 0, keys)).toEqual([60, 61, 60]);
  });

  it("자리마다 조표 (곡 중간 조바꿈)", () => {
    const keys = [{ at: rat(0), fifths: 1 }, { at: rat(2), fifths: -1 }];
    expect(keyAt(keys, rat(1))).toBe(1);
    expect(keyAt(keys, rat(2))).toBe(-1);
    expect(keyAt(undefined, rat(5))).toBe(0);
    expect(keyStartAt(keys, rat(3))).toEqual(rat(2));
    expect(keyStartAt([], rat(3))).toEqual(rat(0));
  });

  it("조표에 맞추기는 조 밖 음만, 고른 음만 바꾼다", () => {
    const keys = [{ at: rat(1), fifths: 1 }];
    const notes = [note("a", 0, 65), note("b", 1, 65), note("c", 1.25, 67), note("d", 1.5, 65)];
    const r = fitNotesToKey(notes, keys, new Set(["a", "b", "c"]));
    expect(r.changed).toBe(1);
    expect(r.notes.map((n) => n.pitch)).toEqual([65, 66, 67, 65]); // a는 다장조라 그대로, d는 고르지 않음
    expect(r.notes[0]).toBe(notes[0]);
  });
});
