import { describe, expect, it } from "vitest";
import { add, emptySong, MOBILE_PROFILE, rat, type Note, type Rat, type Song } from "@mmlce/core";
import { optimizeMml } from "@mmlce/mml";
import {
  attenuateChords,
  chordVolume,
  fillVolume,
  allocateChords,
  analyzeMidi,
  fillRests,
  assignVoices,
  compressChords,
  gapSplit,
  midiToSong,
  noteChanges,
  quantize,
  readSmf,
  songToSmf,
  suggestPlan,
  velocityToVolume,
  writeSmf,
  type GridNote,
  type SmfEvent,
} from "../src/index.js";

const PPQ = 480;
const on = (tick: number, pitch: number, velocity = 100, channel = 0): SmfEvent => ({ tick, type: "noteOn", channel, pitch, velocity });
const off = (tick: number, pitch: number, channel = 0): SmfEvent => ({ tick, type: "noteOff", channel, pitch });
const key = (r: Rat) => `${r.n}/${r.d}`;

function smf(...tracks: SmfEvent[][]) {
  return readSmf(writeSmf({ format: 1, ppq: PPQ, tracks: tracks.map((events) => ({ events })) }));
}

describe("SMF 읽기·쓰기", () => {
  it("쓴 이벤트를 그대로 읽는다", () => {
    const file = smf([{ tick: 0, type: "tempo", usPerQuarter: 500_000 }, { tick: 0, type: "name", text: "피아노" }, on(0, 60), off(480, 60)]);
    expect(file.ppq).toBe(PPQ);
    expect(file.tracks[0]!.events.map((e) => e.type)).toEqual(["name", "tempo", "noteOn", "noteOff"]);
  });

  it("SysEx 뒤 이벤트 위치를 바로 읽고, 트랙 끝(EOT) tick을 남긴다", () => {
    // 00 F0 03 7D 01 F7 | 00 90 3C 64 | 83 60 80 3C 00 | 00 FF 2F 00
    const body = [0x00, 0xf0, 0x03, 0x7d, 0x01, 0xf7, 0x00, 0x90, 0x3c, 0x64, 0x83, 0x60, 0x80, 0x3c, 0x00, 0x8e, 0x00, 0xff, 0x2f, 0x00];
    const file = readSmf(raw(body));
    expect(file.tracks[0]!.events.map((e) => [e.type, e.tick])).toEqual([["noteOn", 0], ["noteOff", 480]]);
    expect(file.tracks[0]!.endTick).toBe(480 + 1792);
  });

  it("MIDI가 아니면 오류", () => {
    expect(() => readSmf(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

function raw(body: number[]): Uint8Array {
  const n = body.length;
  return Uint8Array.from([
    ..."MThd".split("").map((c) => c.charCodeAt(0)), 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255,
    ..."MTrk".split("").map((c) => c.charCodeAt(0)), (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...body,
  ]);
}

describe("analyzeMidi", () => {
  it("서스테인 페달을 밟은 동안 뗀 음은 페달을 뗄 때까지 늘린다", () => {
    const pedal = (tick: number, value: number): SmfEvent => ({ tick, type: "control", channel: 0, control: 64, value });
    const a = analyzeMidi(smf([pedal(0, 127), on(0, 60), off(240, 60), on(480, 64), off(600, 64), pedal(960, 0)]));
    const notes = a.parts[0]!.notes;
    expect(notes.map((n) => [n.pitch, key(n.start), key(n.dur)])).toEqual([
      [60, "0/1", "1/2"],
      [64, "1/4", "1/4"],
    ]);
    expect(a.parts[0]!.polyphony).toBe(2);
  });

  it("끝까지 페달로 늘린 음은 트랙 끝(EOT)까지 간다", () => {
    // tick 0 페달·켜기, 480 끄기, 1920 EOT
    const body = [0x00, 0xb0, 0x40, 0x7f, 0x00, 0x90, 0x3c, 0x64, 0x83, 0x60, 0x80, 0x3c, 0x00, 0x8b, 0x20, 0xff, 0x2f, 0x00];
    const notes = analyzeMidi(readSmf(raw(body))).parts[0]!.notes;
    expect(notes.map((n) => key(n.dur))).toEqual(["1/1"]);
  });

  it("10번 채널은 드럼, 프로그램 번호로 악기를 추천한다", () => {
    const a = analyzeMidi(
      smf([{ tick: 0, type: "program", channel: 0, program: 25 }, on(0, 60), off(480, 60), on(0, 36, 100, 9), off(120, 36, 9)]),
    );
    expect(a.parts.map((p) => [p.drum, p.suggestion.canonical])).toEqual([
      [false, "lute"],
      [true, "bass-drum"],
    ]);
  });
});

describe("quantize", () => {
  const raw = (tick: number, len: number, pitch = 60) => ({
    start: rat(tick, PPQ * 4),
    dur: rat(len, PPQ * 4),
    seconds: tick / PPQ / 2,
    pitch,
    velocity: 100,
  });
  const tempo = [{ at: rat(0), bpm: 120 }];

  it("흔들린 16분음표를 16분 격자로 맞추고, 화음은 같은 자리로 모은다", () => {
    const jitter = [0, 12, -10, 8, -6, 10, -12, 4];
    const notes = jitter.map((j, i) => raw(i * 120 + j + 8, 110));
    notes.push(raw(14, 400, 64)); // 첫 음과 화음
    const q = quantize([{ id: "a", notes }], tempo);
    expect(q.grid).toBe(16);
    const starts = q.notes.map((n) => key(n.start));
    expect(starts.slice(0, 3)).toEqual(["0/1", "0/1", "1/16"]);
  });

  it("셋잇단 박은 셋잇단으로 맞춘다", () => {
    const notes = [0, 160, 320, 480, 600, 720, 840].map((t) => raw(t + 5, 100));
    const q = quantize([{ id: "a", notes }], tempo, { grid: 16 });
    expect(q.tripletBeats).toBe(1);
    expect(q.notes.map((n) => key(n.start))).toEqual(["0/1", "1/12", "1/6", "1/4", "5/16", "3/8", "7/16"]);
  });

  it("32분·64분 셋잇단은 셋잇단으로 맞춰 음을 잃지 않는다", () => {
    // 120 BPM, 32분 셋잇단 12음 (40tick 간격)
    const fast = Array.from({ length: 12 }, (_, i) => raw(i * 40, 40));
    const q = quantize([{ id: "a", notes: fast }], tempo);
    expect(q.notes).toHaveLength(12);
    expect(new Set(q.notes.map((n) => key(n.start))).size).toBe(12);
    // 60 BPM, 64분 셋잇단 24음 (20tick 간격)
    const slow = Array.from({ length: 24 }, (_, i) => ({ ...raw(i * 20, 20), seconds: (i * 20) / PPQ }));
    const q2 = quantize([{ id: "a", notes: slow }], [{ at: rat(0), bpm: 60 }]);
    expect(q2.notes).toHaveLength(24);
    expect(new Set(q2.notes.map((n) => key(n.start))).size).toBe(24);
  });

  it("시작이 다른 같은 음이 한 칸에 모여 합쳐지면 그 수를 센다", () => {
    // 16분 격자로 고정하면 30tick 간격 두 음이 같은 칸에 모인다. 원래 같은 자리에 겹친 음은 세지 않는다
    const q = quantize([{ id: "a", notes: [raw(0, 30), raw(30, 30), raw(240, 60), raw(240, 60)] }], tempo, { grid: 16, triplets: false });
    expect(q.notes).toHaveLength(2);
    expect(q.merged).toBe(1);
  });

  it("짧게 끊은 16분 셋잇단은 길이를 그대로 두고, 같은 박에 섞인 곧은 16분도 셋잇단 박으로 맞춘다", () => {
    const staccato = Array.from({ length: 6 }, (_, i) => raw(480 + 80 * i, 40));
    const straight = Array.from({ length: 8 }, (_, i) => raw(60 * i, 60, 72));
    const q = quantize([{ id: "a", notes: staccato }, { id: "b", notes: straight }], tempo);
    expect(q.notes.filter((n) => n.part === "a").map((n) => key(n.dur))).toEqual(Array(6).fill("1/48"));
    const mixed = [0, 80, 120, 160, 240, 320, 360, 400].map((t) => raw(t, 40));
    const m = quantize([{ id: "a", notes: mixed }], tempo);
    expect(m.tripletBeats).toBe(1);
    expect(m.notes.map((n) => key(n.start))).toEqual(["0/1", "1/24", "1/16", "1/12", "1/8", "1/6", "3/16", "5/24"]);
  });
});

describe("compressChords", () => {
  const note = (pitch: number, start = 0, len = 4, part = "a"): GridNote => ({
    start: rat(start, 16),
    dur: rat(len, 16),
    pitch,
    velocity: 100,
    part,
  });

  it("EarlGreyPie 방식: 오른손 맨위·왼손 맨아래부터 남기고 가운데를 뺀다", () => {
    const chord = [84, 79, 76, 72, 67, 55, 48, 43, 36].map((p) => note(p));
    const r = compressChords(chord, { max: 6 });
    expect(r.notes.map((n) => n.pitch).sort((a, b) => b - a)).toEqual([84, 79, 76, 48, 43, 36]);
    expect(r.dropped.map((n) => n.pitch)).toEqual([72, 67, 55]);
    // 오른손 화음 먼저 버리기: 오른손은 맨위음만, 나머지는 왼손
    const right = compressChords(chord, { max: 6, dropFirst: "right" });
    expect(right.notes.map((n) => n.pitch).sort((a, b) => b - a)).toEqual([84, 79, 55, 48, 43, 36]);
    const left = compressChords(chord, { max: 6, dropFirst: "left" });
    expect(left.notes.map((n) => n.pitch).sort((a, b) => b - a)).toEqual([84, 79, 76, 72, 67, 36]);
  });

  it("이어지던 음은 새 화음 자리에서 끊고, 보호한 파트는 빼지 않는다", () => {
    const held = note(72, 0, 16, "melody");
    const r = compressChords([held, note(60, 4), note(64, 4), note(67, 4)], { max: 2, protect: new Set(["melody"]) });
    const out = r.notes.map((n) => `${n.pitch}@${key(n.start)}+${key(n.dur)}`);
    expect(out).toContain("72@0/1+1/1");
    expect(r.notes.length).toBe(2);
    const r2 = compressChords([note(72, 0, 16), note(60, 4), note(64, 4), note(67, 4)], { max: 2, preset: "bottom" });
    expect(r2.shortened).toBe(1);
    expect(r2.notes.find((n) => n.pitch === 72)!.dur).toEqual(rat(1, 4));
  });
});

describe("손 경계", () => {
  it("파트로 손을 모르면 화음에서 가장 넓게 벌어진 자리를 경계로 본다", () => {
    expect(gapSplit([84, 79, 76, 72, 67, 55, 48, 43, 36], 60)).toBe(61);
    // 오른손이 가운데 도 아래까지 내려온 화음: 고정 경계(60)라면 57·59를 왼손으로 잘못 본다
    expect(gapSplit([79, 76, 72, 59, 57, 43, 38, 33], 60)).toBe(50);
    expect(gapSplit([60, 62, 64], 60)).toBe(60);
  });
});

describe("assignVoices", () => {
  it("베이스는 맨아래 트랙에 머물고 트랙끼리 겹치지 않는다", () => {
    const n = (pitch: number, start: number, len = 1) => ({ start: rat(start, 4), dur: rat(len, 4), pitch });
    const voices = assignVoices([n(36, 0, 4), n(72, 0), n(67, 0), n(74, 1), n(69, 1), n(38, 4), n(76, 4)], 3);
    expect(voices.length).toBe(3);
    expect(voices[2]!.map((x) => x.pitch)).toEqual([36, 38]);
    expect(voices[0]!.map((x) => x.pitch)).toEqual([72, 74, 76]);
  });
});

describe("fillRests", () => {
  const note = (id: string, pitch: number, start: number, len: number, vol = 10) => ({ id, start: rat(start, 8), dur: rat(len, 8), pitch, vol, tie: "none" as const });
  const spare = (pitch: number, start: number, len: number): GridNote => ({ start: rat(start, 8), dur: rat(len, 8), pitch, velocity: 100, part: "a" });
  let id = 0;
  const next = () => `f${++id}`;

  it("쉬는 채널에 빠진 음을 넣고, v는 volumeOf가 정한다", () => {
    const tracks = [[note("a", 72, 0, 1), note("b", 74, 4, 1)], [note("c", 48, 0, 8, 7)]];
    const r = fillRests(tracks, [spare(64, 0, 8), spare(60, 0, 8)], () => 15, next, { minLength: rat(1, 16), charLimit: 2400 });
    expect(r.added).toBe(1);
    const filled = r.tracks[0]!.find((n) => n.id.startsWith("f"))!;
    // 앞 음(72)과 가까운 64를 고르고, 쉬는 동안(1/8~1/2)만 넣는다
    expect([filled.pitch, filled.start, filled.dur, filled.vol]).toEqual([64, rat(1, 8), rat(3, 8), 15]);
  });

  it("채워 넣는 음은 그 자리 같은 손 음 수로 화음감쇠한다", () => {
    const tracks = [[note("a", 72, 0, 8)], [note("b", 67, 0, 8)], [note("c", 36, 0, 8)]];
    // 오른손 72·67이 울리는 자리에 64를 넣으면 오른손 3화음: 12 → 9. 왼손(36)과 합친 2화음은 10
    expect(fillVolume(12, 64, rat(1, 8), tracks, MOBILE_PROFILE)).toBe(9);
    expect(fillVolume(6, 64, rat(1, 8), tracks, MOBILE_PROFILE)).toBe(5);
    expect(fillVolume(12, 40, rat(1, 8), tracks, MOBILE_PROFILE)).toBe(10);
  });

  it("다른 채널에서 같은 음이 울리면 넣지 않고, 글자 수 한도를 넘으면 뺀다", () => {
    const tracks = [[note("a", 72, 0, 1), note("b", 74, 4, 1)], [note("c", 64, 0, 8)]];
    expect(fillRests(tracks, [spare(64, 0, 8)], () => 15, next, { minLength: rat(1, 16), charLimit: 2400 }).added).toBe(0);
    const tight = fillRests([[note("a", 72, 0, 1), note("b", 74, 4, 1)]], [spare(60, 0, 8)], () => 15, next, { minLength: rat(1, 16), charLimit: 8 });
    expect(tight.added).toBe(0);
  });
});

describe("allocateChords", () => {
  it("곡 전체 예산을 음 수와 동시음 수에 따라 나눈다", () => {
    const t = (events: SmfEvent[]) => events;
    const chord = (pitches: number[], channel: number) =>
      t([...pitches.map((p) => on(0, p, 100, channel)), ...pitches.map((p) => off(480, p, channel))]);
    const a = analyzeMidi(smf(chord([60, 64, 67, 72, 76, 79, 84], 0), [{ tick: 0, type: "program", channel: 1, program: 73 }, ...chord([72], 1)]));
    const plan = suggestPlan(a, MOBILE_PROFILE);
    expect(allocateChords(a, plan, 4, MOBILE_PROFILE).players.map((p) => p.chords)).toEqual([3, 1]);
    expect(allocateChords(a, plan, 12, MOBILE_PROFILE).players.map((p) => p.chords)).toEqual([6, 1]);
  });
});

describe("midiToSong", () => {
  /** 파트마다 [높이, 시작tick, 길이tick] 목록. 연주자는 players에 파트 번호와 화음 수로 준다 */
  type Who = { parts: number[]; chords: number; preset?: "bottom" };
  const song = (bpm: number, parts: [number, number, number][][], players: Who[], quantize: { grid?: number; straighten?: boolean } = { straighten: true }) => {
    const tracks: SmfEvent[][] = [[{ tick: 0, type: "tempo", usPerQuarter: Math.round(60_000_000 / bpm) }]];
    parts.forEach((list, c) => tracks.push(list.flatMap(([pitch, start, len]) => [on(start, pitch, 100, c), off(start + len, pitch, c)])));
    const a = analyzeMidi(smf(...tracks));
    const instrument = suggestPlan(a, MOBILE_PROFILE).players[0]!.instrument;
    const ids = a.parts.map((p) => p.id);
    return midiToSong(a, { players: players.map((p, i) => ({ name: `P${i}`, instrument, parts: p.parts.map((k) => ids[k]!), chords: p.chords, ...(p.preset ? { preset: p.preset } : {}) })), quantize }, MOBILE_PROFILE);
  };
  const count = (r: ReturnType<typeof midiToSong>) => r.song.tracks.reduce((s, t) => s + t.notes.length, 0);
  const dropped = (r: ReturnType<typeof midiToSong>) => r.compressed.reduce((s, c) => s + c.dropped, 0);

  it("밀린 음 곧게 맞추기를 켜면 64분 격자에서 조금씩 밀어 친 정규 음을 셋잇단으로 맞추지 않는다", () => {
    // 점16분음표를 줄곧 41tick(약 40ms) 늦게 친다. 96분 칸에 1tick 차로 맞아 셋잇단으로 고른다
    const notes = [Array.from({ length: 32 }, (_, i): [number, number, number] => [60, i * 180 + 41, 170])];
    const r = song(120, notes, [{ parts: [0], chords: 1 }], { grid: 64, straighten: true });
    expect(r.tripletBeats).toBe(0);
    expect(count(r)).toBe(32);
    // 끄면(기본) 박 판정은 그대로
    expect(song(120, notes, [{ parts: [0], chords: 1 }], { grid: 64 }).tripletBeats).toBeGreaterThan(0);
  });

  it("곧게 맞춘 곡은 main 판정과 음 하나하나가 같다 (남는 음·따로 치던 시작·끝·채운 음)", () => {
    // 트랙마다 (높이, v, 트랙) 묶음과 서로 다른 시작 수
    const shape = (r: ReturnType<typeof midiToSong>) =>
      r.song.tracks.map((t) => [t.notes.map((n) => `${n.pitch}:${n.vol}`).sort().join(","), new Set(t.notes.map((n) => key(n.start))).size]);
    const ends = (r: ReturnType<typeof midiToSong>) => r.song.tracks.map((t) => t.notes.map((n) => (n.start.n / n.start.d + n.dur.n / n.dur.d)));
    const cases: [number, [number, number, number][][], Who[], number | undefined][] = [
      // 남는 음이 다른 음으로 바뀌던 경우
      [120, [[[48, 0, 80], [52, 40, 120], [56, 120, 320], [64, 240, 120]]], [{ parts: [0], chords: 1 }], 32],
      // 따로 치던 음이 동시 화음으로 모이던 경우
      [60, [[...[46, 73, 166, 193, 286, 313, 406, 433].map((t, i): [number, number, number] => [i % 2 ? 62 : 60, t, 20]), [72, 960, 240]]], [{ parts: [0], chords: 2 }], undefined],
      // 박을 넘는 긴 음의 끝이 당겨지던 경우
      [120, [[[72, 0, 920], [72, 960, 480]], [[60, 520, 40], [60, 600, 40]]], [{ parts: [0, 1], chords: 2 }], 32],
      // 채우기에서 main이 다시 넣던 음이 빠지던 경우
      [120, [[[48, 0, 240], [52, 40, 320], [56, 120, 800], [64, 240, 640], [72, 360, 80], [76, 400, 320], [40, 960, 240]]], [{ parts: [0], chords: 2, preset: "bottom" }], 32],
    ];
    for (const [bpm, parts, who, grid] of cases) {
      const straight = song(bpm, parts, who, { straighten: true, ...(grid ? { grid } : {}) });
      const off = song(bpm, parts, who, grid ? { grid } : {});
      expect(shape(straight)).toEqual(shape(off));
      ends(straight).forEach((list, t) => list.forEach((end, i) => expect(Math.abs(end - ends(off)[t]![i]!)).toBeLessThan(1 / (grid ?? 32))));
    }
  });

  it("음량·트랙·화음 모양이 달라지면 noteChanges가 잡는다", () => {
    const base = song(120, [[[60, 0, 240], [64, 240, 240]]], [{ parts: [0], chords: 2 }], {});
    const edit = (f: (n: Note, i: number) => Partial<Note>) => ({
      ...base,
      song: { ...base.song, tracks: base.song.tracks.map((t) => ({ ...t, notes: t.notes.map((n, i) => ({ ...n, ...f(n, i) })) })) },
    });
    expect(noteChanges(base, base, 16)).toEqual([]);
    expect(noteChanges(edit((n, i) => (i === 1 ? { vol: n.vol - 1 } : {})), base, 16)!.length).toBeGreaterThan(0);
    expect(noteChanges(edit((_, i) => (i === 1 ? { start: rat(0) } : {})), base, 16)!.length).toBeGreaterThan(0);
    expect(noteChanges(edit((n) => ({ dur: add(n.dur, rat(1, 4)) })), base, 16)!.length).toBeGreaterThan(0);
  });

  it("정규 칸으로 바꾸면 음이 합쳐지거나 화음 한도에 걸리는 박은 셋잇단으로 둔다", () => {
    // 여러 파트가 같은 리듬: A는 32분 셋잇단 12음
    const a: [number, number, number][] = Array.from({ length: 12 }, (_, i) => [60, i * 40, 40]);
    const bc = (pitch: number): [number, number, number][] => [60, 180, 300].map((t) => [pitch, t, 60]);
    const r1 = song(120, [a, bc(72), bc(48)], [{ parts: [0], chords: 1 }, { parts: [1], chords: 1 }, { parts: [2], chords: 1 }]);
    expect(count(r1)).toBe(18);
    // 60 BPM 64분 셋잇단 24음과 다른 두 파트
    const a2: [number, number, number][] = Array.from({ length: 24 }, (_, i) => [60, i * 20, 20]);
    const others = (pitch: number): [number, number, number][] => [30, 90, 150, 210, 270, 330, 390].map((t) => [pitch, t, 30]);
    expect(count(song(60, [a2, others(72), others(48)], [{ parts: [0], chords: 1 }, { parts: [1], chords: 1 }, { parts: [2], chords: 1 }]))).toBe(38);
    // 칸 반보다 가까운 두 음: 같은 높이, 번갈아 다른 높이(화음 1), 번갈아 다른 화음(화음 3)
    const starts = [46, 73, 166, 193, 286, 313, 406, 433];
    for (const pitches of [[[60]], [[60], [62]], [[60, 64, 67], [62, 66, 69]]]) {
      const notes = starts.flatMap((t, i) => pitches[i % pitches.length]!.map((p): [number, number, number] => [p, t, 20]));
      const r = song(60, [notes], [{ parts: [0], chords: pitches[0]!.length }]);
      expect([count(r), dropped(r)]).toEqual([notes.length, 0]);
    }
    // 박을 넘는 긴 음의 끝이 바뀌어 다음 음과 겹치지 않게 (한 연주자, 화음 1)
    const long = song(120, [[[72, 0, 530]], [505, 560, 720, 800].map((t): [number, number, number] => [60, t, 40])], [{ parts: [0, 1], chords: 1 }], { grid: 32, straighten: true });
    expect([count(long), dropped(long)]).toEqual([5, 0]);
  });

  it("화음 수를 6보다 크게 주면 같은 악기 연주자를 더 만든다", () => {
    const pitches = [48, 52, 55, 60, 64, 67, 72, 76];
    const a = analyzeMidi(smf([...pitches.map((p) => on(0, p)), ...pitches.map((p) => off(480, p))]));
    const plan = suggestPlan(a, MOBILE_PROFILE);
    const r = midiToSong(a, { players: plan.players.map((p) => ({ ...p, chords: 12 })) }, MOBILE_PROFILE);
    expect(r.song.players.map((p) => p.name)).toEqual(["Track 1 (1)", "Track 1 (2)"]);
    expect(r.song.tracks.length).toBe(8);
  });

  it("기본 계획: 같은 악기 번호의 오른손·왼손 트랙을 한 연주자로 묶어 6화음 이내로 넣는다", () => {
    const right = [on(0, 72, 127), on(0, 76), on(0, 79), on(0, 84), off(960, 72), off(960, 76), off(960, 79), off(960, 84)];
    const left = [on(0, 36), on(0, 43), on(0, 48), on(0, 52), off(960, 36), off(960, 43), off(960, 48), off(960, 52)];
    const a = analyzeMidi(smf([{ tick: 0, type: "tempo", usPerQuarter: 400_000 }], right, left.map((e) => ({ ...e, channel: 1 }) as SmfEvent)));
    const plan = suggestPlan(a, MOBILE_PROFILE);
    expect(plan.players.length).toBe(1);
    const r = midiToSong(a, plan, MOBILE_PROFILE);
    expect(r.song.tracks.length).toBe(6);
    expect(r.compressed[0]!.dropped).toBe(2);
    expect(r.song.tempo).toEqual([{ at: rat(0), bpm: 150 }]);
    const pitches = r.song.tracks.flatMap((t) => t.notes.map((n) => n.pitch)).sort((x, y) => y - x);
    expect(pitches).toEqual([84, 79, 76, 43, 36, 48].sort((x, y) => y - x));
  });

  it("화음 병합: 잠깐 열린 셋째 트랙의 조각을 쉬는 트랙으로 옮기고, 글자 수가 늘면 옮기지 않는다", () => {
    // 첫 박에만 3음(g가 셋째 트랙을 연다). 그 뒤 홀수 마디 3·4박의 조각 a·b가 셋째 트랙에 들어간다
    const piece = (velocity: number) => {
      const ev: SmfEvent[] = [];
      for (let bar = 0; bar < 8; bar++) {
        const t = bar * 4 * PPQ;
        ev.push(on(t, 48), off(t + 4 * PPQ, 48), on(t, 72), off(t + PPQ, 72), on(t + PPQ, 74), off(t + 2 * PPQ, 74));
        if (bar === 0) ev.push(on(t, 67), off(t + PPQ, 67));
        if (bar % 2 === 1) ev.push(on(t + 2 * PPQ, 69, velocity), off(t + 3 * PPQ, 69), on(t + 3 * PPQ, 71, velocity), off(t + 4 * PPQ, 71));
      }
      return analyzeMidi(smf(ev));
    };
    const notesOf = (s: Song) => s.tracks.flatMap((t) => t.notes.map((n) => `${key(n.start)}:${n.pitch}:${key(n.dur)}:${n.vol}`)).sort();
    const a = piece(100);
    const plan = suggestPlan(a, MOBILE_PROFILE);
    const off_ = midiToSong(a, { ...plan, merge: false }, MOBILE_PROFILE);
    const on_ = midiToSong(a, plan, MOBILE_PROFILE);
    expect(on_.compressed[0]!.merged).toBe(8);
    expect(notesOf(on_.song)).toEqual(notesOf(off_.song));
    // 셋째 트랙에는 다른 트랙과 겹치는 첫 g만 남는다
    expect(on_.song.tracks.map((t) => t.notes.length)).toEqual([24, 1, 8]);
    const chars = (s: Song) => s.tracks.reduce((sum, t) => sum + optimizeMml(t.notes).text.length, 0);
    expect(chars(on_.song)).toBeLessThan(chars(off_.song));
    // 조각이 여려(v가 달라) 받는 트랙에 v 명령이 붙어 글자 수 합이 늘면 옮기지 않는다
    expect(midiToSong(piece(80), plan, MOBILE_PROFILE).compressed[0]!.merged).toBe(0);
  });

  it("세기 → v는 v→음량 곡선의 역", () => {
    expect(velocityToVolume(127, MOBILE_PROFILE)).toBe(15);
    expect(velocityToVolume(64, MOBILE_PROFILE)).toBe(8);
    expect(velocityToVolume(1, MOBILE_PROFILE)).toBe(1);
  });
});

describe("화음감쇠", () => {
  it("화음이 커지는 만큼(2배마다 3dB) 볼륨 곡선에서 낮춘다", () => {
    expect(chordVolume(12, 1, MOBILE_PROFILE)).toBe(12);
    expect(chordVolume(12, 3, MOBILE_PROFILE)).toBe(9);
    expect(chordVolume(10, 2, MOBILE_PROFILE)).toBe(8);
    expect(chordVolume(10, 4, MOBILE_PROFILE)).toBe(7);
    expect(chordVolume(12, 6, MOBILE_PROFILE)).toBe(8);
    expect(chordVolume(6, 2, MOBILE_PROFILE)).toBe(5);
  });
  it("낮은 v에서도 1 아래로는 내리지 않는다", () => {
    expect(chordVolume(1, 6, MOBILE_PROFILE)).toBe(1);
    expect(chordVolume(2, 6, MOBILE_PROFILE)).toBe(1);
  });
  it("압축 뒤 음마다 오른손·왼손을 따로 감쇠한다", () => {
    const g = (pitch: number, velocity: number): GridNote => ({ part: "p", pitch, velocity, start: rat(0), dur: rat(1, 4) });
    const notes = [g(84, 100), g(79, 100), g(76, 100), g(43, 80), g(36, 80)];
    const v = attenuateChords(notes, (n) => velocityToVolume(n.velocity, MOBILE_PROFILE), MOBILE_PROFILE);
    const right = chordVolume(velocityToVolume(100, MOBILE_PROFILE), 3, MOBILE_PROFILE);
    const left = chordVolume(velocityToVolume(80, MOBILE_PROFILE), 2, MOBILE_PROFILE);
    expect(notes.map((n) => v.get(n))).toEqual([right, right, right, left, left]);
  });
});

describe("songToSmf", () => {
  const playerSong = (instruments: string[]): Song => {
    const base = emptySong({ title: "", author: "", profileId: "mobile" });
    const players = instruments.map((canonical, i) => ({ id: `p${i}`, name: `P${i}`, instrument: { canonical, program: 21 } }));
    const tracks = players.map((p, i) => ({
      id: `t${i}`, playerId: p.id, name: "", color: "", role: "free" as const, mute: false, solo: false, spelling: {},
      notes: [{ id: `n${i}`, start: rat(0), dur: rat(1, 4), pitch: 60, vol: 15, tie: "none" as const }],
    }));
    return { ...base, players, tracks, timeSig: [{ at: rat(0), beats: 4, unit: 4 }, { at: rat(1), beats: 3, unit: 4 }] };
  };
  /** 연주자 트랙마다 [첫 program 또는 noteOn 종류, 채널, 번호 또는 건반] */
  const programs = (smf: ReturnType<typeof songToSmf>) =>
    smf.tracks.slice(1).map((t) => {
      const e = t.events.find((x) => x.type === "program" || x.type === "noteOn")!;
      if (e.type === "program") return { type: e.type, channel: e.channel, value: e.program };
      if (e.type === "noteOn") return { type: e.type, channel: e.channel, value: e.pitch };
      throw new Error("없음");
    });

  it("GM 번호로 쓰고, 다시 가져오면 같은 악기를 추천한다", () => {
    const smf = songToSmf(playerSong(["piano", "violin", "bass-drum"]));
    expect(programs(smf).map((e) => [e.type, e.channel, e.value])).toEqual([
      ["program", 0, 0],
      ["program", 1, 40],
      ["noteOn", 9, 36],
    ]);
    const parts = analyzeMidi(readSmf(writeSmf(smf))).parts;
    expect(parts.map((p) => p.suggestion.canonical)).toEqual(["piano", "violin", "bass-drum"]);
  });

  it("마비노기 번호로 쓸 때 마비꼬 추가 팩 번호(1048 = 24.2)는 팩 안 번호만 쓴다", () => {
    const s = playerSong(["harp"]);
    const song = { ...s, players: s.players.map((p) => ({ ...p, instrument: { canonical: "harp", program: 1048 } })) };
    expect(programs(songToSmf(song, 480, 15, "mabinogi")).map((e) => e.value)).toEqual([24]);
  });

  it("번호로만 아는 추가 팩 악기는 canonicalOf로 찾은 실제 악기의 GM 번호로 쓰고, 높이는 적힌 그대로 둔다", () => {
    const s = playerSong(["piano", "piano"]);
    const song = {
      ...s,
      players: [
        { ...s.players[0]!, instrument: { canonical: "mabi:1578", program: 1578 } },
        { ...s.players[1]!, instrument: { canonical: "mabi:1579", program: 1579 } },
      ],
      tracks: s.tracks.map((t) => ({ ...t, notes: [{ ...t.notes[0]!, pitch: 48 }] })),
    };
    const canonicalOf = (instrument: string) => ({ "mabi:1578": "cat-harmonica", "mabi:1579": "bass-drum" })[instrument];
    const smf = songToSmf(song, 480, 15, "gm", { canonicalOf });
    expect(programs(smf).map((e) => [e.type, e.channel, e.value])).toEqual([
      ["program", 0, 22],
      ["noteOn", 9, 36],
    ]);
    const notes = smf.tracks[1]!.events.filter((e) => e.type === "noteOn");
    expect(notes.map((e) => (e.type === "noteOn" ? e.pitch : 0))).toEqual([48]);
    // 팩이 없어 모르면 지금처럼 피아노, 마비노기 번호는 원래 팩 안 번호
    expect(programs(songToSmf(song)).map((e) => e.value)).toEqual([0, 0]);
    expect(programs(songToSmf(song, 480, 15, "mabinogi", { canonicalOf })).map((e) => e.value)).toEqual([42, 43]);
  });

  it("같은 악기 연주자는 채널을 함께 써서 16명이 넘어도 다른 악기와 섞이지 않는다", () => {
    // 겹치는 같은 높이가 없게 연주자마다 다른 음
    const s = playerSong([...Array(16).fill("piano"), "flute"]);
    const smf = songToSmf({ ...s, tracks: s.tracks.map((t, i) => ({ ...t, notes: [{ ...t.notes[0]!, pitch: 48 + i }] })) });
    const channels = programs(smf).map((e) => e.channel);
    expect(new Set(channels.slice(0, 16))).toEqual(new Set([0]));
    expect(channels[16]).toBe(1);
  });

  it("같은 악기라도 같은 높이 음이 겹치면 다른 채널로 보낸다", () => {
    const s = playerSong(["piano", "piano"]);
    const song = { ...s, tracks: s.tracks.map((t, i) => ({ ...t, notes: [{ ...t.notes[0]!, dur: i === 0 ? rat(1) : rat(1, 4) }] })) };
    const channels = programs(songToSmf(song)).map((e) => e.channel);
    expect(channels[0]).not.toBe(channels[1]);
  });

  it("같은 악기 겹침을 나누느라 채널이 모자라도 다른 악기는 자기 채널을 지킨다", () => {
    const s = playerSong([...Array(15).fill("piano"), "flute"]);
    const channels = programs(songToSmf(s));
    const flute = channels[15]!;
    expect(flute.value).toBe(73);
    expect(channels.slice(0, 15).every((c) => c.channel !== flute.channel)).toBe(true);
  });

  it("볼륨이 다른 같은 음 &도 첫 음 볼륨으로 한 번만 친다", () => {
    const s = playerSong(["piano"]);
    const t = s.tracks[0]!;
    const notes = [
      { ...t.notes[0]!, id: "a", vol: 15, tie: "next" as const },
      { ...t.notes[0]!, id: "b", start: rat(1, 4), vol: 5 },
    ];
    const events = songToSmf({ ...s, tracks: [{ ...t, notes }] }).tracks[1]!.events;
    const ons = events.filter((e) => e.type === "noteOn");
    const offs = events.filter((e) => e.type === "noteOff");
    expect(ons).toHaveLength(1);
    expect(offs.map((e) => e.tick)).toEqual([960]);
  });

  it("곡 중간 박자 변화도 쓴다", () => {
    const sigs = songToSmf(playerSong(["piano"])).tracks[0]!.events.filter((e) => e.type === "timeSig");
    expect(sigs.map((e) => [e.tick, "beats" in e ? e.beats : 0])).toEqual([[0, 4], [1920, 3]]);
  });
});
