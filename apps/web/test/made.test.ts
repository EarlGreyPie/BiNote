import { describe, expect, it } from "vitest";
import {
  defaultLengthLimit,
  History,
  madeOf,
  madeTracks,
  MOBILE_PROFILE,
  planArpeggio,
  planGrace,
  planSlides,
  planTrill,
  pruneMade,
  rat,
  recordMade,
  restoreMade,
  sameNotes,
  clipNotes,
  pasteClip,
  transposeNotes,
  type ArpOptions,
  type Note,
  type Rat,
  type Song,
} from "@mmlce/core";
import {
  addTrack,
  applyMadeRestore,
  canWriteExactly,
  compactSong,
  insertTime,
  madeCommand,
  newSong,
  restoreMadeCommand,
  setNotesAndAddTracks,
  setTrackNotes,
  setTracksNotes,
  setTrackText,
} from "@mmlce/mml";
import { readProject, writeProject } from "@mmlce/fileio";

const limit = defaultLengthLimit();
const canWrite = (r: Rat) => canWriteExactly(r, limit);
/** 8분음표 단위 */
const n = (id: string, start: number, dur: number, pitch: number, vol = 10): Note => ({ id, start: rat(start, 8), dur: rat(dur, 8), pitch, vol, tie: "none" });
/** 연주자 p1에 트랙 t1·t2·t3 */
function songOf(t1: Note[], t2: Note[] = [], t3: Note[] = []): Song {
  let s = addTrack("p1", "트랙 2").apply(newSong({ playerName: "기타", trackName: "트랙 1" }));
  s = addTrack("p1", "트랙 3").apply(s);
  const by: Record<string, Note[]> = { t1, t2, t3 };
  return { ...s, tracks: s.tracks.map((tr) => ({ ...tr, notes: by[tr.id] ?? tr.notes })) };
}
const shape = (s: Song, trackId: string) =>
  (s.tracks.find((t) => t.id === trackId)?.notes ?? []).map((x) => `${x.id}:${x.pitch}@${x.start.n}/${x.start.d}+${x.dur.n}/${x.dur.d}${x.tie === "next" ? "&" : ""}`);
const plain = (s: Song) => s.tracks.map((t) => ({ id: t.id, notes: t.notes.map(({ made: _m, ...x }) => x) }));

const arp: ArpOptions = {
  source: "together", chord: "major", style: "spread", order: "up", step: rat(1, 16), octaves: 1, repeat: true,
  clearChordTracks: true, range: { low: 0, high: 127 }, maxTracks: 6,
};
let k = 0;
const newId = () => `x${++k}`;
const chord = () => songOf([n("c", 0, 2, 60), n("after", 4, 2, 72)], [n("e", 0, 2, 64)], [n("g", 0, 2, 67)]);

/** 아르페지오를 기록과 함께 적용한 History */
function arpeggiate(s: Song, options: Partial<ArpOptions> = {}) {
  const h = new History(s);
  const picked = [s.tracks[0]!.notes[0]!];
  const r = planArpeggio(s, "t1", picked, { ...arp, ...options }, newId);
  h.run(madeCommand(setNotesAndAddTracks("p1", r.changes, r.newTracks, (i) => `트랙 ${i}`, "아르페지오"), { tool: "arpeggio", options: { style: options.style ?? "spread" }, trackId: "t1", picked: picked.map((x) => x.id) }));
  return h;
}
const restore = (h: History, ids: string[]) => {
  const plan = restoreMade(h.song, ids);
  if (!plan.ok) throw new Error(plan.reason);
  h.run(restoreMadeCommand(plan, "되돌리기"));
  return plan;
};

describe("기록 남기기", () => {
  it("펼치기: 새 음과 바뀐 음에만 기록 id, 지운 원래 음은 기록에 그대로", () => {
    const h = arpeggiate(chord());
    const rec = h.song.made![0]!;
    expect(rec).toMatchObject({ id: "mk1", tool: "arpeggio", trackId: "t1", picked: ["c"] });
    expect(rec.before.map((b) => [b.trackId, b.notes.map((x) => x.id)])).toEqual([["t1", ["c"]], ["t2", ["e"]], ["t3", ["g"]]]);
    const t1 = h.song.tracks[0]!.notes;
    expect(t1.filter((x) => x.made === "mk1").length).toBe(4);
    // 고르지 않은 음은 표시 없음
    expect(t1.find((x) => x.id === "after")!.made).toBeUndefined();
    expect(madeOf(h.song, ["after"])).toEqual([]);
    expect(madeOf(h.song, [t1[0]!.id]).map((r) => r.id)).toEqual(["mk1"]);
  });

  it("바뀐 것이 없으면 기록하지 않는다", () => {
    const s = chord();
    expect(recordMade(s, s, { tool: "arpeggio", options: {}, picked: [] })).toBe(s);
  });

  it("실행 취소하면 기록도 사라지고 다시 실행하면 돌아온다", () => {
    const h = arpeggiate(chord());
    h.undo();
    expect(h.song.made).toBeUndefined();
    h.redo();
    expect(h.song.made?.length).toBe(1);
  });
});

describe("원래대로 되돌리기", () => {
  it("펼치기 → 되돌리기: 원래 화음 그대로 (트랙·id·자리), 기록도 없어진다", () => {
    const s = chord();
    const h = arpeggiate(s);
    const plan = restore(h, ["mk1"]);
    expect(plan.edited).toBe(0);
    expect(plain(h.song)).toEqual(plain(s));
    expect(h.song.made).toBeUndefined();
    // 한 번에 되돌린 것은 실행 취소 한 칸
    h.undo();
    expect(h.song.made?.length).toBe(1);
  });

  it("되풀이(깔기)로 더한 트랙은 되돌린 뒤 비면 지운다", () => {
    const s = songOf([n("c", 0, 4, 60)], [n("e", 0, 4, 64)]);
    const solo = { ...s, tracks: s.tracks.filter((t) => t.id !== "t3") };
    const h = new History(solo);
    const picked = [solo.tracks[0]!.notes[0]!];
    const r = planArpeggio(solo, "t1", picked, { ...arp, style: "strum", source: "chord", chord: "7", repeat: false }, newId);
    expect(r.newTracks.length).toBeGreaterThan(0);
    h.run(madeCommand(setNotesAndAddTracks("p1", r.changes, r.newTracks, (i) => `트랙 ${i}`, "아르페지오"), { tool: "arpeggio", options: {}, trackId: "t1", picked: ["c"] }));
    const added = h.song.made![0]!.addedTracks!;
    expect(added.length).toBe(r.newTracks.length);
    restore(h, ["mk1"]);
    expect(h.song.tracks.map((t) => t.id)).toEqual(solo.tracks.map((t) => t.id));
    expect(plain(h.song)).toEqual(plain(solo));
  });

  it("굴려 치기(제자리에서 시작만 늦춤)도 원래대로", () => {
    const s = chord();
    const h = arpeggiate(s, { style: "roll" });
    expect(shape(h.song, "t3")[0]).not.toEqual(shape(s, "t3")[0]);
    restore(h, ["mk1"]);
    expect(plain(h.song)).toEqual(plain(s));
  });

  it("꾸밈음(박 위에서, 화음 음도 늦춤)도 원래대로", () => {
    const s = songOf([n("a", 0, 1, 60)], [n("b", 0, 1, 64)]);
    const h = new History(s);
    const picked = s.tracks.flatMap((t) => t.notes);
    const r = planGrace(s, picked, { offsets: [-2], length: rat(1, 64), timing: "on", tie: false, canWrite }, MOBILE_PROFILE, () => `g${++k}`);
    expect(r.made).toBe(1);
    h.run(madeCommand(setTracksNotes(r.changes, "꾸밈음"), { tool: "grace", options: {}, picked: picked.map((x) => x.id) }));
    expect(h.song.made![0]!.tool).toBe("grace");
    restore(h, ["mk1"]);
    expect(plain(h.song)).toEqual(plain(s));
  });

  it("트릴·트레몰로(긴 음을 짧은 음으로 나눔)도 원래대로, .mme에 기록이 남는다", () => {
    const s = songOf([n("a", 0, 2, 60), n("b", 2, 2, 64)], [n("c", 0, 2, 67)]);
    const h = new History(s);
    const picked = [s.tracks[0]!.notes[0]!, s.tracks[1]!.notes[0]!];
    const base = { offset: 2, length: rat(1, 32), startOther: false, endOnMain: false, tie: false, canWrite };
    const r = planTrill(s, picked, { ...base, kind: "tremolo" }, MOBILE_PROFILE, () => `t${++k}`);
    expect(r.made).toBe(2);
    expect(r.pieces).toBe(16);
    h.run(madeCommand(setTracksNotes(r.changes, "트릴"), { tool: "trill", options: { choice: { kind: "tremolo" } }, picked: picked.map((x) => x.id) }));
    expect(h.song.made![0]!.tool).toBe("trill");
    const back = readProject(writeProject(h.song));
    expect(back.song.made![0]!.tool).toBe("trill");
    restore(h, ["mk1"]);
    expect(plain(h.song)).toEqual(plain(s));
  });

  it("슬라이드(사이 음을 &로 잇기)도 원래대로", () => {
    const s = songOf([n("a", 0, 2, 60), n("b", 2, 2, 64)]);
    const h = new History(s);
    const picked = s.tracks[0]!.notes;
    const r = planSlides(s, picked, { kind: "between", path: "chromatic", direction: "down", semitones: 2, length: rat(1, 16), instrumentOf: () => "folk-guitar" }, MOBILE_PROFILE, (id) => `${id}.s${++k}`);
    expect(r.changes.length).toBe(1);
    h.run(madeCommand(setTracksNotes(r.changes, "슬라이드"), { tool: "slide", options: {}, picked: picked.map((x) => x.id) }));
    restore(h, ["mk1"]);
    expect(plain(h.song)).toEqual(plain(s));
  });

  it("만든 음을 손댔으면 그 수를 세고, 손댄 음까지 지우고 되돌린다", () => {
    const s = chord();
    const h = arpeggiate(s);
    const t1 = h.song.tracks[0]!.notes;
    const made = t1.find((x) => x.made === "mk1" && x.pitch === 64)!;
    h.run(setTrackNotes("t1", t1.map((x) => (x.id === made.id ? { ...x, pitch: 65 } : x))));
    const plan = restore(h, ["mk1"]);
    expect(plan.edited).toBe(1);
    expect(plain(h.song)).toEqual(plain(s));
  });

  it("만든 음 일부를 지웠으면 남은 것만 지우고 되돌린다 (손댄 것으로 세지 않는다)", () => {
    const s = chord();
    const h = arpeggiate(s);
    const t1 = h.song.tracks[0]!.notes;
    h.run(setTrackNotes("t1", t1.filter((x) => !(x.made === "mk1" && x.pitch === 67))));
    expect(restore(h, ["mk1"]).edited).toBe(0);
    expect(plain(h.song)).toEqual(plain(s));
  });

  it("곡 전체 조옮김 뒤: 원래 음도 같은 만큼 옮겨 되돌린다", () => {
    const s = chord();
    const h = arpeggiate(s);
    h.run(setTracksNotes(h.song.tracks.map((t) => ({ trackId: t.id, notes: transposeNotes(t.notes, 2)! }))));
    expect(restore(h, ["mk1"]).edited).toBe(0);
    const t2 = h.song.tracks.find((t) => t.id === "t2")!.notes;
    expect(t2.map((x) => x.pitch)).toEqual([66]);
    expect(h.song.tracks[0]!.notes.map((x) => x.pitch)).toEqual([62, 74]);
  });

  it("원래 음 자리에 나중에 넣은 음이 있으면 되돌리지 않고 그 음을 알린다", () => {
    const h = arpeggiate(chord());
    h.run(setTrackNotes("t2", [n("new", 1, 1, 50)]));
    const plan = restoreMade(h.song, ["mk1"]);
    expect(plan).toEqual({ ok: false, reason: "occupied", blocking: ["new"] });
  });

  it("만든 음 위에 또 만들었으면(아르페지오 음에 꾸밈음) 나중 것부터: 꾸밈음을 되돌리면 아르페지오도 되돌릴 수 있다", () => {
    const s = chord();
    const h = arpeggiate(s);
    const first = h.song.tracks[0]!.notes[0]!;
    const r = planGrace(h.song, [first], { offsets: [-2], length: rat(1, 64), timing: "on", tie: false, canWrite }, MOBILE_PROFILE, () => `g${++k}`);
    h.run(madeCommand(setTracksNotes(r.changes, "꾸밈음"), { tool: "grace", options: {}, picked: [first.id] }));
    expect(h.song.made!.map((x) => x.id)).toEqual(["mk1", "mk2"]);
    const blocked = restoreMade(h.song, ["mk1"]);
    expect(blocked.ok ? "" : blocked.reason).toBe("nested");
    restore(h, ["mk2"]);
    restore(h, ["mk1"]);
    expect(plain(h.song)).toEqual(plain(s));
    // 둘을 함께 고르면 나중 것부터 한 번에
    const h2 = arpeggiate(s);
    const f2 = h2.song.tracks[0]!.notes[0]!;
    const r2 = planGrace(h2.song, [f2], { offsets: [-2], length: rat(1, 64), timing: "on", tie: false, canWrite }, MOBILE_PROFILE, () => `g${++k}`);
    h2.run(madeCommand(setTracksNotes(r2.changes, "꾸밈음"), { tool: "grace", options: {}, picked: [f2.id] }));
    restore(h2, ["mk1", "mk2"]);
    expect(plain(h2.song)).toEqual(plain(s));
  });

  it("되돌릴 원래 음 id를 다른 음이 쓰고 있으면 새 id로", () => {
    const h = arpeggiate(chord());
    // 원래 t2 음 id "e"를 나중에 다른 음이 씀 (겹치지 않는 자리)
    h.run(setTrackNotes("t3", [n("e", 6, 1, 40)]));
    const plan = restoreMade(h.song, ["mk1"]);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.ids.get("e")).toBe("e~2");
  });
});

describe("다시 고치기", () => {
  it("옛 기록을 되돌린 곡에서 새 설정으로 만들고, 한 칸으로 실행 취소", () => {
    const s = chord();
    const h = arpeggiate(s);
    const plan = restoreMade(h.song, ["mk1"]);
    if (!plan.ok) throw new Error();
    const base = applyMadeRestore(h.song, plan);
    const picked = ["c"].map((id) => base.tracks[0]!.notes.find((x) => x.id === (plan.ids.get(id) ?? id))!);
    const r = planArpeggio(base, "t1", picked, { ...arp, order: "down" }, newId);
    h.run(madeCommand(setNotesAndAddTracks("p1", r.changes, r.newTracks, (i) => `트랙 ${i}`, "아르페지오"), { tool: "arpeggio", options: { order: "down" }, trackId: "t1", picked: ["c"] }, (song) => applyMadeRestore(song, plan)));
    expect(h.song.made!.map((x) => x.options)).toEqual([{ order: "down" }]);
    expect(h.song.tracks[0]!.notes.filter((x) => x.made).map((x) => x.pitch)).toEqual([67, 64, 60, 67]);
    // 새 기록의 원래 음도 처음 화음
    restore(h, [h.song.made![0]!.id]);
    expect(plain(h.song)).toEqual(plain(s));
    h.undo();
    h.undo();
    expect(h.song.made![0]!.options).toEqual({ style: "spread" });
  });
});

describe("표시가 따라가거나 떨어지는 편집", () => {
  it("MML 글을 고쳐 다시 읽어도 같은 자리·높이 음에 표시가 남는다", () => {
    const h = arpeggiate(chord());
    h.run(setTrackText("t1", "l16 o4cegc r4 o5c4"));
    const after = h.song.tracks[0]!.notes;
    expect(after.filter((x) => x.made === "mk1").length).toBe(4);
  });

  it("복사해 붙인 음은 보통 음", () => {
    const h = arpeggiate(chord());
    const clip = clipNotes(h.song.tracks[0]!.notes.filter((x) => x.made))!;
    let c = 0;
    expect(pasteClip(clip, rat(2), () => `p${++c}`).every((x) => x.made === undefined)).toBe(true);
  });

  it("붙은 음이 없는 기록은 버리고, 없는 기록을 가리키는 표시는 뗀다", () => {
    const h = arpeggiate(chord());
    h.run(setTrackNotes("t1", [n("z", 0, 1, 50, 10)].map((x) => ({ ...x, made: "mk9" }))));
    const pruned = pruneMade(h.song);
    expect(pruned.made).toBeUndefined();
    expect(pruned.tracks[0]!.notes[0]!.made).toBeUndefined();
  });
});

describe("프로젝트 파일", () => {
  it(".mme에 기록과 표시를 쓰고 그대로 읽는다", () => {
    const h = arpeggiate(chord());
    const back = readProject(writeProject(h.song)).song;
    expect(back.made).toEqual(h.song.made);
    expect(back.tracks.map((t) => t.notes)).toEqual(h.song.tracks.map((t) => t.notes));
    // 읽은 곡에서도 되돌릴 수 있다
    const plan = restoreMade(back, ["mk1"]);
    expect(plan.ok).toBe(true);
  });

  it("모르는 모양의 기록은 버리고 음은 그대로", () => {
    const h = arpeggiate(chord());
    const raw = JSON.parse(writeProject(h.song));
    raw.song.made[0].tool = "unknown";
    const back = readProject(JSON.stringify(raw)).song;
    expect(back.made).toBeUndefined();
    expect(back.tracks[0]!.notes.every((x) => x.made === undefined)).toBe(true);
    expect(back.tracks[0]!.notes.length).toBe(h.song.tracks[0]!.notes.length);
  });
});

describe("트랙 골라 되돌리기 (아르페지오)", () => {
  it("화음 트랙 하나를 빼면 그 트랙 원래 음은 돌아오지 않고 나머지만 원래대로", () => {
    const s = chord();
    const h = arpeggiate(s);
    expect(madeTracks(h.song, ["mk1"])).toEqual(["t1", "t2", "t3"]);
    const plan = restoreMade(h.song, ["mk1"], new Set(["t1", "t3"]));
    if (!plan.ok) throw new Error(plan.reason);
    h.run(restoreMadeCommand(plan, "되돌리기"));
    expect(plain(h.song)[0]).toEqual(plain(s)[0]);
    expect(plain(h.song)[2]).toEqual(plain(s)[2]);
    expect(h.song.tracks[1]!.notes).toEqual([]);
    expect(h.song.made).toBeUndefined();
  });

  it("만든 음이 있는 트랙을 빼면 그 음은 두고 그 몫만 기록에 남아 나중에 되돌릴 수 있다", () => {
    const s = chord();
    const h = arpeggiate(s);
    const made = h.song.tracks[0]!.notes.filter((x) => x.made).length;
    const plan = restoreMade(h.song, ["mk1"], new Set(["t2", "t3"]));
    if (!plan.ok) throw new Error(plan.reason);
    h.run(restoreMadeCommand(plan, "되돌리기"));
    expect(h.song.tracks[0]!.notes.filter((x) => x.made === "mk1").length).toBe(made);
    expect(plain(h.song)[1]).toEqual(plain(s)[1]);
    expect(h.song.made![0]!.before.map((b) => b.trackId)).toEqual(["t1"]);
    restore(h, ["mk1"]);
    expect(plain(h.song)).toEqual(plain(s));
  });

  it("손댄 음 수는 고른 트랙 것만 센다", () => {
    const h = arpeggiate(chord());
    const t1 = h.song.tracks[0]!.notes;
    const one = t1.find((x) => x.made === "mk1")!;
    h.run(setTrackNotes("t1", t1.map((x) => (x.id === one.id ? { ...x, vol: 5 } : x))));
    const without = restoreMade(h.song, ["mk1"], new Set(["t2", "t3"]));
    expect(without.ok && without.edited).toBe(0);
    const all = restoreMade(h.song, ["mk1"]);
    expect(all.ok && all.edited).toBe(1);
  });
});

describe("점검(beta.28) 재현", () => {
  const graceOf = (s: Song, ids: string[], extra: Partial<{ length: Rat; timing: "on" | "before"; offsets: number[] }> = {}) => {
    const all = s.tracks.flatMap((t) => t.notes);
    return planGrace(s, all.filter((x) => ids.includes(x.id)), { offsets: [-2], length: rat(1, 16), timing: "on", tie: false, canWrite, ...extra }, MOBILE_PROFILE, () => `g${++k}`);
  };
  const total = (s: Song, trackId: string) => s.tracks.find((t) => t.id === trackId)!.notes.reduce((sum, x) => sum + x.dur.n / x.dur.d, 0);

  it("M-01: 글자 수 줄이기로 만든 음과 보통 음이 합쳐지면 표시를 옮기지 않아, 되돌리기가 보통 음 꼬리를 지우지 않는다", () => {
    const s = songOf([{ ...n("root", 0, 2, 60), tie: "next" }, n("tail", 2, 2, 60)]);
    const h = new History(s);
    const r = graceOf(s, ["root"], { length: rat(1, 8) });
    h.run(madeCommand(setTracksNotes(r.changes, "꾸밈음"), { tool: "grace", options: {}, picked: ["root"] }));
    h.run(compactSong(MOBILE_PROFILE));
    const merged = h.song.tracks[0]!.notes.find((x) => x.pitch === 60)!;
    expect(merged.made).toBeUndefined();
    const plan = restoreMade(h.song, ["mk1"]);
    // 되돌린다면 총 길이가 그대로여야 하고, 아니면 막고 알린다 (보통 음을 지우지 않는다)
    if (plan.ok) {
      h.run(restoreMadeCommand(plan, "되돌리기"));
      expect(total(h.song, "t1")).toBe(1 / 2);
    } else expect(plan.reason).toBe("occupied");
    expect(total(h.song, "t1")).toBe(1 / 2);
  });

  it("M-02: 기록 한가운데에 마디를 넣어 앞뒤가 따로 움직이면 원래 음을 옮기지 않는다 (앞 음은 0 그대로)", () => {
    const s = songOf([n("pre", 0, 2, 60), n("main", 2, 2, 64)]);
    const h = new History(s);
    const r = graceOf(s, ["main"], { length: rat(1, 64), timing: "before", offsets: [-2, -1] });
    expect(r.made).toBe(1);
    h.run(madeCommand(setTracksNotes(r.changes, "꾸밈음"), { tool: "grace", options: {}, picked: ["main"] }));
    h.run(insertTime(rat(3, 16), rat(1)));
    const plan = restoreMade(h.song, ["mk1"]);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.edited).toBeGreaterThan(0);
    h.run(restoreMadeCommand(plan, "되돌리기"));
    const pre = h.song.tracks[0]!.notes.find((x) => x.id === "pre")!;
    expect(pre.start).toEqual(rat(0));
    expect(pre.dur).toEqual(rat(1, 4));
    expect(h.song.tracks[0]!.notes.find((x) => x.id === "main")!.start).toEqual(rat(5, 4));
  });

  it("M-03: 만든 음을 전부 다시 가공해도 앞 기록을 버리지 않아, 차례로 처음까지 되돌릴 수 있다", () => {
    const s = songOf([n("a", 0, 2, 60)]);
    const h = new History(s);
    const r1 = graceOf(s, ["a"]);
    h.run(madeCommand(setTracksNotes(r1.changes, "꾸밈음"), { tool: "grace", options: {}, picked: ["a"] }));
    const ids = h.song.tracks[0]!.notes.map((x) => x.id);
    const r2 = graceOf(h.song, ids, { length: rat(1, 64) });
    h.run(madeCommand(setTracksNotes(r2.changes, "꾸밈음"), { tool: "grace", options: {}, picked: ids }));
    expect(h.song.tracks[0]!.notes.every((x) => x.made === "mk2")).toBe(true);
    expect(h.song.made!.map((x) => x.id)).toEqual(["mk1", "mk2"]);
    expect(readProject(writeProject(h.song)).song.made!.map((x) => x.id)).toEqual(["mk1", "mk2"]);
    restore(h, ["mk2"]);
    restore(h, ["mk1"]);
    expect(plain(h.song)).toEqual(plain(s));
  });

  it("M-04: 다시 고치기 창을 연 뒤 들어온 음이 있으면 옛 계획을 넣지 않는다", () => {
    const h = arpeggiate(chord());
    const plan = restoreMade(h.song, ["mk1"]);
    if (!plan.ok) throw new Error();
    const base = applyMadeRestore(h.song, plan);
    // 창을 연 사이 MIDI 건반으로 같은 트랙 뒤에 음을 넣음
    const t1 = h.song.tracks[0]!.notes;
    h.run(setTrackNotes("t1", [...t1, n("midi-new", 8, 1, 50)]));
    expect(sameNotes(h.song, plan.from)).toBe(false);
    const picked = [base.tracks[0]!.notes.find((x) => x.id === "c")!];
    const r = planArpeggio(base, "t1", picked, { ...arp, order: "down" }, newId);
    const before = h.song;
    h.run(madeCommand(setNotesAndAddTracks("p1", r.changes, r.newTracks, (i) => `트랙 ${i}`, "아르페지오"), { tool: "arpeggio", options: {}, trackId: "t1", picked: ["c"] }, (song) => applyMadeRestore(song, plan)));
    expect(h.song).toBe(before);
    h.run(restoreMadeCommand(plan, "되돌리기"));
    expect(h.song.tracks[0]!.notes.some((x) => x.id === "midi-new")).toBe(true);
  });
});
