import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, rat, staffBars, staffGrand, staffKindOf, staffOctaveOf, staffTrack, staffVoices, type Note, type Rat } from "../src/index.js";

const VOL = { min: 0, max: 15 };
let id = 0;
function note(start: Rat, dur: Rat, pitch: number, o: Partial<Note> = {}): Note {
  return { id: `g${id++}`, start, dur, pitch, vol: 10, tie: "none", ...o };
}
const barsOf = (notes: Note[]) => staffBars({ tracks: [{ notes } as never], timeSig: [], tempo: [] });

describe("악기별 오선보 모양", () => {
  it("건반·하프 계열은 큰보표, 타악기는 타악기 단, 나머지는 한 단", () => {
    expect(["piano", "harp", "music-box", "gramophone"].map(staffKindOf)).toEqual(["grand", "grand", "grand", "grand"]);
    expect(["bass-drum", "cymbal"].map(staffKindOf)).toEqual(["percussion", "percussion"]);
    expect(["lute", "flute", "violin", "xylophone", "folk-guitar"].map(staffKindOf)).toEqual(["single", "single", "single", "single", "single"]);
  });
});

describe("음자리표 옥타브 표시", () => {
  it("기타는 한 옥타브 높여 적고 8vb 높은음자리표, 게임에서 한 옥타브 높게 나는 실로폰·오르골은 그대로 적고 8va", () => {
    const up = MOBILE_PROFILE.soundingOctave;
    expect(staffOctaveOf("folk-guitar", up)).toEqual({ mark: "8vb", shift: 12, clef: "treble" });
    expect(staffOctaveOf("xylophone", up)).toEqual({ mark: "8va", shift: 0 });
    expect(staffOctaveOf("music-box", up)).toEqual({ mark: "8va", shift: 0 });
    for (const id of ["piano", "lute", "mandolin", "flute", "violin", "harp", "gramophone"]) expect(staffOctaveOf(id, up)).toEqual({ shift: 0 });
    // 프로필에 적히지 않은 게임이면 표시하지 않는다
    expect(staffOctaveOf("xylophone", {})).toEqual({ shift: 0 });
  });
});

describe("한 단의 성부 나누기", () => {
  it("같은 자리·길이 음은 화음 하나 (대표는 가장 높은 음)", () => {
    const a = note(rat(0), rat(1, 4), 64);
    const b = note(rat(0), rat(1, 4), 67);
    const c = note(rat(0), rat(1, 4), 60);
    const voices = staffVoices([a, b, c]);
    expect(voices).toHaveLength(1);
    expect(voices[0]!.notes.map((n) => n.pitch)).toEqual([67]);
    expect(voices[0]!.chords.get(b.id)!.map((n) => n.pitch)).toEqual([64, 60]);
  });

  it("길이가 다르게 겹치면 둘째 성부로", () => {
    const long = note(rat(0), rat(1, 2), 64);
    const s1 = note(rat(0), rat(1, 4), 72);
    const s2 = note(rat(1, 4), rat(1, 4), 74);
    const voices = staffVoices([long, s1, s2]);
    expect(voices).toHaveLength(2);
    expect(voices[0]!.notes.map((n) => n.pitch)).toEqual([72, 74]);
    expect(voices[1]!.notes.map((n) => n.pitch)).toEqual([64]);
  });

  it("셋째 성부는 만들지 않고 가장 일찍 끝나는 성부에 넣는다", () => {
    const voices = staffVoices([note(rat(0), rat(1), 60), note(rat(0), rat(1, 2), 64), note(rat(0), rat(1, 4), 67)]);
    expect(voices).toHaveLength(2);
    expect(voices.flatMap((v) => v.notes)).toHaveLength(3);
  });
});

describe("큰보표", () => {
  it("가온 도부터 위 단, 아래는 낮은음자리표 단. 여러 트랙에 흩어진 화음이 한 음표로 모인다", () => {
    // 화음 압축으로 세 트랙에 나뉜 C 장화음 + 왼손 베이스
    const notes = [note(rat(0), rat(1, 2), 60), note(rat(0), rat(1, 2), 64), note(rat(0), rat(1, 2), 67), note(rat(0), rat(1), 48)];
    const bars = barsOf(notes);
    const g = staffGrand(notes, bars, VOL);
    expect(g.upper.voices[0]!.clef).toBe("treble");
    expect(g.lower.voices[0]!.clef).toBe("bass");
    const head = g.upper.voices[0]!.measures[0]!.items[0]!;
    expect(head.pitch).toBe(67);
    expect(head.chord!.map((c) => c.pitch)).toEqual([64, 60]);
    expect(g.lower.voices[0]!.measures[0]!.items[0]!.pitch).toBe(48);
  });

  it("셈여림은 한 단에만: 위 단이 두 성부면 아래 단에", () => {
    const one = [note(rat(0), rat(1, 4), 72), note(rat(0), rat(1, 4), 48)];
    const g1 = staffGrand(one, barsOf(one), VOL);
    expect(g1.upper.voices[0]!.measures[0]!.items[0]!.dynamic).toBe("f");
    expect(g1.lower.voices[0]!.measures[0]!.items[0]!.dynamic).toBeUndefined();
    const two = [note(rat(0), rat(1, 2), 64), note(rat(0), rat(1, 4), 72), note(rat(0), rat(1, 4), 48)];
    const g2 = staffGrand(two, barsOf(two), VOL);
    expect(g2.upper.voices.flatMap((v) => v.measures[0]!.items).some((i) => i.dynamic)).toBe(false);
    expect(g2.lower.voices[0]!.measures[0]!.items[0]!.dynamic).toBe("f");
  });

  it("한 단의 두 성부는 임시표를 함께 쓴다: 앞 성부의 F#4 뒤에 겹치는 F4는 제자리표", () => {
    const notes = [note(rat(0), rat(1, 2), 66), note(rat(1, 4), rat(1, 4), 65)];
    const g = staffGrand(notes, barsOf(notes), VOL);
    const items = g.upper.voices.flatMap((v) => v.measures[0]!.items).filter((i) => i.pitch !== undefined);
    expect(items.find((i) => i.pitch === 66)!.accidental).toBe("#");
    expect(items.find((i) => i.pitch === 65)!.accidental).toBe("n");
  });

  it("한쪽 단이 비어도 쉼 마디로 그린다", () => {
    const notes = [note(rat(0), rat(1, 4), 72)];
    const g = staffGrand(notes, barsOf(notes), VOL);
    expect(g.lower.voices).toHaveLength(1);
    expect(g.lower.voices[0]!.measures[0]!.fullRest).toBe(true);
  });

  it("화음 음에도 임시표가 붙는다", () => {
    const notes = [note(rat(0), rat(1, 4), 61), note(rat(0), rat(1, 4), 66)];
    const g = staffGrand(notes, barsOf(notes), VOL);
    const head = g.upper.voices[0]!.measures[0]!.items[0]!;
    expect(head.accidental).toBe("#");
    expect(head.chord![0]!.accidental).toBe("#");
  });
});

describe("타악기 단", () => {
  it("음자리표는 타악기, 임시표는 쓰지 않는다", () => {
    const notes = [note(rat(0), rat(1, 4), 61)];
    const t = staffTrack(notes, barsOf(notes), VOL, { clef: "percussion" });
    expect(t.clef).toBe("percussion");
    expect(t.measures[0]!.items[0]!.accidental).toBeUndefined();
  });
});
