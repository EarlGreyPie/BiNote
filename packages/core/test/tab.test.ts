import { describe, expect, it } from "vitest";
import { assignTab, carryTabStrings, rat, STANDARD_TUNING, type Note } from "../src/index.js";

let id = 0;
const n = (start: number, pitch: number): Note => ({ id: `n${++id}`, start: rat(start, 4), dur: rat(1, 4), pitch, vol: 12, tie: "none" });
const frets = (events: ReturnType<typeof assignTab>) =>
  events.map((e) => e.notes.map((x) => (x.at ? `${x.at.string}:${x.at.fret}` : "x")).join(" "));

describe("타브 배정", () => {
  it("개방현 음은 개방현으로", () => {
    expect(frets(assignTab([n(0, 40), n(1, 64)]))).toEqual(["6:0", "1:0"]);
  });

  it("화음은 서로 다른 줄에, 손 폭 안으로", () => {
    // C 코드: C3 E3 G3 C4 E4
    const chord = [48, 52, 55, 60, 64].map((p) => n(0, p));
    const [event] = assignTab(chord);
    const strings = event!.notes.map((x) => x.at!.string);
    expect(new Set(strings).size).toBe(5);
    const fretted = event!.notes.map((x) => x.at!.fret).filter((f) => f > 0);
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(4);
  });

  it("선율은 손이 크게 뛰지 않게 이어 간다", () => {
    // o5c d e f g a b >c: 한 음씩 갈 때 프렛이 세 칸 넘게 뛰지 않는다
    const melody = [72, 74, 76, 77, 79, 81, 83, 84].map((p, i) => n(i, p));
    const hands = assignTab(melody).map((e) => e.notes[0]!.at!.fret);
    for (let i = 1; i < hands.length; i++) expect(Math.abs(hands[i]! - hands[i - 1]!)).toBeLessThanOrEqual(3);
  });

  it("음역 밖이나 줄보다 많은 음은 칠 수 없는 음으로 표시", () => {
    expect(frets(assignTab([n(0, 30)]))).toEqual(["x"]);
    const seven = [40, 45, 50, 55, 59, 64, 69].map((p) => n(0, p));
    expect(assignTab(seven)[0]!.notes.filter((x) => !x.at)).toHaveLength(1);
  });

  it("아직 울리는 음의 줄은 다음 음에 쓰지 않는다", () => {
    // E4(64)를 온음표로 누른 채 F4(65)를 4분음표 뒤에: 둘 다 1번 줄이면 E가 끊긴다
    const held = { id: "h", start: rat(0), dur: rat(1), pitch: 64, vol: 12, tie: "none" as const };
    const [first, second] = assignTab([held, n(1, 65)]);
    expect(first!.notes[0]!.at!.string).not.toBe(second!.notes[0]!.at!.string);
  });

  it("여러 음 동안 길게 누르는 음의 줄도 지킨다", () => {
    // E4를 온음표로 누른 채 4분음표 셋(F4, G4, A4)
    const held = { id: "h2", start: rat(0), dur: rat(1), pitch: 64, vol: 12, tie: "none" as const };
    const events = assignTab([held, n(1, 65), n(2, 67), n(3, 69)]);
    const heldString = events[0]!.notes[0]!.at!.string;
    for (const e of events.slice(1)) expect(e.notes[0]!.at!.string).not.toBe(heldString);
  });

  it("긴 곡도 곧바로 배정한다 (음 수에 비례)", () => {
    const many = Array.from({ length: 800 }, (_, i) => n(i, 64));
    const t0 = performance.now();
    expect(assignTab(many)).toHaveLength(800);
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it("카포를 쓰면 프렛이 그만큼 줄어든다", () => {
    expect(frets(assignTab([n(0, 42)], { ...STANDARD_TUNING, capo: 2 }))).toEqual(["6:0"]);
  });
});

describe("바리톤 튜닝", () => {
  it("표준 튜닝에서 칠 수 없던 낮은 음도 부분 내슈빌 바리톤(A D g c E A)에서는 자리가 있다", () => {
    const low: Note = { id: "low", start: rat(0), dur: rat(1, 4), pitch: 33, vol: 12, tie: "none" };
    expect(assignTab([low])[0]!.notes[0]!.at).toBeUndefined();
    const nashville = { ...STANDARD_TUNING, strings: [57, 52, 60, 55, 38, 33] };
    expect(assignTab([low], nashville)[0]!.notes[0]!.at).toEqual({ string: 6, fret: 0 });
  });

  it("슬라이드로 이은 두 음은 되도록 같은 줄에 둔다", () => {
    // A3(57) → C4(60): 그냥 두면 C4는 2번 줄 1프렛(손 이동 적음)도 되지만, 슬라이드면 A3과 같은 줄로
    const from = { id: "s1", start: rat(0), dur: rat(1, 4), pitch: 57, vol: 12, tie: "next" as const };
    const to = { id: "s2", start: rat(1, 4), dur: rat(1, 4), pitch: 60, vol: 12, tie: "none" as const };
    const plain = assignTab([{ ...from, tie: "none" }, to]);
    const slid = assignTab([from, to], STANDARD_TUNING, new Map(), new Map([["s2", "s1"]]));
    expect(slid[0]!.notes[0]!.at!.string).toBe(slid[1]!.notes[0]!.at!.string);
    expect(plain[0]!.notes[0]!.at!.string).not.toBe(plain[1]!.notes[0]!.at!.string);
  });

  it("음에 적힌 줄(tabString)을 지킨다: 내슈빌 바리톤 A줄 6프렛이 C줄 3프렛으로 옮겨 가지 않는다 (beta.11)", () => {
    const nashville = { ...STANDARD_TUNING, strings: [57, 52, 60, 55, 38, 33] };
    const three = [0, 1, 2].map((i) => n(i, 63));
    expect(frets(assignTab(three, nashville))).toEqual(["3:3", "3:3", "3:3"]);
    expect(frets(assignTab(three.map((x) => ({ ...x, tabString: 1 })), nashville))).toEqual(["1:6", "1:6", "1:6"]);
  });
});

describe("타브 줄 옮겨 받기 (carryTabStrings)", () => {
  const note = (id: string, start: number, len: number, pitch: number, tabString?: number): Note => ({
    id, start: rat(start, 4), dur: rat(len, 4), pitch, vol: 12, tie: "none", ...(tabString ? { tabString } : {}),
  });

  it("순서가 아니라 시간과 높이로 맞춘다: 나뉜 음은 둘 다, 합친 음은 시작 음의 줄을 받는다", () => {
    expect(carryTabStrings([note("a", 0, 2, 63, 1)], [note("x", 0, 1, 63), note("y", 1, 1, 63)]).map((n) => n.tabString)).toEqual([1, 1]);
    expect(carryTabStrings([note("a", 0, 1, 63, 1), note("b", 1, 1, 63, 3)], [note("x", 0, 2, 63)]).map((n) => n.tabString)).toEqual([1]);
  });

  it("높이가 다르거나 옛 음이 없는 자리는 받지 않는다", () => {
    expect(carryTabStrings([note("a", 0, 1, 63, 1)], [note("x", 0, 1, 64), note("y", 1, 1, 63)]).map((n) => n.tabString)).toEqual([undefined, undefined]);
  });
});

describe("타브에서 고른 줄은 칠 수 있으면 지킨다 (두 자리 프렛 화음 입력)", () => {
  const n = (id: string, pitch: number, tabString?: number): Note => ({ id, start: rat(0), dur: rat(1, 4), pitch, vol: 8, tie: "none", ...(tabString !== undefined ? { tabString } : {}) });
  const at = (events: ReturnType<typeof assignTab>, id: string) => events[0]!.notes.find((x) => x.note.id === id)!.at;

  it("E15(1번 줄)와 B1(2번 줄)을 같은 자리에 쳤으면 손을 넓게 벌려도 B1은 2번 줄 1프렛", () => {
    const events = assignTab([n("e", 79, 1), n("b", 60, 2)], STANDARD_TUNING);
    expect(at(events, "e")).toEqual({ string: 1, fret: 15 });
    expect(at(events, "b")).toEqual({ string: 2, fret: 1 });
  });

  it("고른 줄이 없으면 전처럼 손 벌림이 적은 자리 (E15와 C4는 A줄 15)", () => {
    const events = assignTab([n("e", 79), n("c", 60)], STANDARD_TUNING);
    expect(at(events, "c")).toEqual({ string: 5, fret: 15 });
  });
});
