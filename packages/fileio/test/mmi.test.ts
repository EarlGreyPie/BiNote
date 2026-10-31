import { describe, expect, it } from "vitest";
import { rat } from "@mmlce/core";
import { readMmi, readProject, writeMmi, writeProject } from "../src/index.js";

const SAMPLE = [
  "[mml-score]",
  "version=1",
  "title=연습곡",
  "author=EarlGreyPie",
  "time=4/4",
  "tempo=0T140,384T100",
  "mml-track=MML@l8cdefgab>c,",
  "  o3c1,",
  "  o3g1;",
  "name=피아노",
  "program=21",
  "songProgram=-1",
  "panpot=64",
  "visible=true",
  "mml-track=MML@r1c1,,,;",
  "name=류트",
  "program=0",
  "songProgram=-1",
  "startDelta=96",
  "[marker]",
  "384=B",
].join("\n");

describe("readMmi", () => {
  it("멜로디·화음1·화음2를 화음별 트랙으로 푼다", () => {
    const { song, diagnostics } = readMmi(SAMPLE);
    expect(diagnostics).toEqual([]);
    expect(song.players.map((p) => [p.name, p.instrument.program])).toEqual([
      ["피아노", 21],
      ["류트", 0],
    ]);
    expect(song.tracks.map((t) => t.name)).toEqual([
      "피아노 멜로디", "피아노 화음1", "피아노 화음2", "류트 멜로디",
    ]);
    expect(song.tracks[1]!.notes[0]!.pitch).toBe(48);
  });

  it("tempo= 줄(96TPQN)과 마커, startDelta", () => {
    const { song } = readMmi(SAMPLE);
    expect(song.tempo).toEqual([
      { at: rat(0), bpm: 140 },
      { at: rat(1), bpm: 100 },
    ]);
    expect(song.markers).toEqual([{ id: "m1", at: rat(1), label: "B" }]);
    // startDelta=96 = 4분음표 하나만큼 늦게 시작
    expect(song.tracks[3]!.notes[0]!.start).toEqual(rat(5, 4));
  });

  it("쓰고 다시 읽으면 같은 음과 템포", () => {
    const a = readMmi(SAMPLE).song;
    const { text } = writeMmi(a);
    const b = readMmi(text).song;
    const notes = (s: typeof a) =>
      s.tracks.map((t) => t.notes.map((n) => [n.start, n.dur, n.pitch, n.vol, n.tie]));
    expect(notes(b)).toEqual(notes(a));
    expect(b.tempo).toEqual(a.tempo);
    expect(b.markers).toEqual(a.markers);
  });
});

describe("writeMmi 왕복 보존", () => {
  it("음수 startDelta로 당겨진 음을 잃지 않는다", () => {
    const a = readMmi("[mml-score]\nmml-track=MML@c1,,;\nname=t\nprogram=0\nstartDelta=-96\n").song;
    expect(a.tracks[0]!.notes[0]!.start).toEqual(rat(-1, 4));
    const { text } = writeMmi(a);
    expect(text).toContain("startDelta=-96");
    const b = readMmi(text).song;
    expect(b.tracks[0]!.notes.map((n) => [n.start, n.dur, n.pitch])).toEqual(a.tracks[0]!.notes.map((n) => [n.start, n.dur, n.pitch]));
  });

  it("음수 startDelta로 당겨진 음과 원문 시작 자리는 .mme로 두 번 저장했다 열어도 남는다 (점검 S03)", () => {
    const a = readMmi("[mml-score]\nmml-track=MML@c4d4,,;\nname=t\nprogram=0\nstartDelta=-96\n").song;
    expect(a.tracks[0]!.notes.map((n) => n.start)).toEqual([rat(-1, 4), rat(0)]);
    expect(a.tracks[0]!.mml?.offset).toEqual(rat(-1, 4));
    // 자동 보존과 복구도 같은 writeProject·readProject 길을 쓴다
    const once = readProject(writeProject(a));
    expect(once.diagnostics).toEqual([]);
    const twice = readProject(writeProject(once.song));
    expect(twice.diagnostics).toEqual([]);
    expect(twice.song).toEqual(once.song);
    expect(twice.song.tracks).toEqual(a.tracks);
    // 다시 .mmi로 써도 startDelta로 되돌아간다
    const text = writeMmi(twice.song).text;
    expect(text).toContain("startDelta=-96");
    expect(readMmi(text).song.tracks[0]!.notes.map((n) => [n.start, n.dur, n.pitch])).toEqual(a.tracks[0]!.notes.map((n) => [n.start, n.dur, n.pitch]));
  });

  it("음수 startDelta 트랙 맨 앞의 템포도 .mme로 저장했다 열면 남는다 (점검 S03 재점검)", () => {
    const a = readMmi("[mml-score]\ntempo=0T150\nmml-track=MML@t150c4d4,,;\nname=t\nprogram=0\nstartDelta=-96\n").song;
    expect(a.tempo).toEqual([{ at: rat(-1, 4), bpm: 150 }]);
    const once = readProject(writeProject(a));
    expect(once.diagnostics).toEqual([]);
    expect(once.song.tempo).toEqual(a.tempo);
    expect(readProject(writeProject(once.song)).song.tempo).toEqual(a.tempo);
    expect(writeMmi(once.song).text).toContain("MML@t150");
  });

  it("음수 startDelta를 되돌려 쓸 때 템포 자리도 같이 옮긴다", () => {
    const a = readMmi("[mml-score]\ntime=4/4\ntempo=96T90\nmml-track=MML@c1,,;\nprogram=0\nstartDelta=-96\n").song;
    const b = readMmi(writeMmi(a).text).song;
    expect(b.tempo).toEqual(a.tempo);
  });

  it("곡 중간 박자 변화를 [time-signature]로 남긴다", () => {
    const a = readMmi("[mml-score]\ntime=4/4\nmml-track=MML@c1c1,,;\nname=t\nprogram=0\n[time-signature]\n384=3/4\n").song;
    const b = readMmi(writeMmi(a).text).song;
    expect(b.timeSig).toEqual([
      { at: rat(0), beats: 4, unit: 4 },
      { at: rat(1), beats: 3, unit: 4 },
    ]);
  });
});

describe("writeMmi 격자 경고", () => {
  it("96TPQN에 안 맞는 음이 있으면 경고", () => {
    const a = readMmi("[mml-score]\nmml-track=MML@c7c7,,;\nname=t\nprogram=0\n").song;
    const { diagnostics } = writeMmi(a);
    expect(diagnostics).toMatchObject([{ code: "mmi-off-grid", params: { count: 2 } }]);
  });

  it("마비꼬 추가 팩 번호(팩 × 512 + 번호)는 팩 안 번호로 악기를 찾고, 저장할 때 같은 번호로 쓴다", () => {
    const text = [
      "[mml-score]",
      "mml-track=MML@c4,,;",
      "name=하프",
      "program=1048",
      "mml-track=MML@d4,,;",
      "name=북",
      "program=1090",
      "mml-track=MML@e4,,;",
      "name=기타",
      "program=1566",
    ].join("\n");
    const { song } = readMmi(text);
    // 24.2 하프, 66.2 북. 30.3은 팩마다 다른 모바일 악기라 번호 그대로 둔다
    expect(song.players.map((p) => p.instrument)).toEqual([
      { canonical: "harp", program: 1048 },
      { canonical: "bass-drum", program: 1090 },
      { canonical: "mabi:1566", program: 1566 },
    ]);
    expect([...writeMmi(song).text.matchAll(/^program=(\d+)$/gm)].map((m) => m[1])).toEqual(["1048", "1090", "1566"]);
  });
});

describe("writeMmi 노래 파트·mml-track 설정·원문 보존 (점검 S07)", () => {
  const SONG_PART = [
    "[mml-score]",
    "tempo=0T120",
    "mml-track=MML@t120l8cdef,e,g,o5c;",
    "name=A",
    "program=21",
    "songProgram=5",
    "panpot=20",
    "visible=false",
  ].join("\n");

  it("노래 칸은 같은 mml-track의 4번째 칸으로, songProgram·panpot·visible도 그대로 돌려 쓴다", () => {
    const a = readMmi(SONG_PART).song;
    expect(a.players.map((p) => [p.name, p.instrument.program])).toEqual([
      ["A", 21],
      ["A 노래", 5],
    ]);
    expect(a.tracks.map((t) => [t.name, t.mix, t.mmiSong])).toEqual([
      ["A 멜로디", { pan: 20, visible: false }, undefined],
      ["A 화음1", { pan: 20, visible: false }, undefined],
      ["A 화음2", { pan: 20, visible: false }, undefined],
      ["A 노래", { pan: 20, visible: false }, true],
    ]);
    const { text } = writeMmi(a);
    expect(text.match(/^mml-track=.*$/gm)).toEqual(["mml-track=MML@t120l8cdef,e,g,o5c;"]);
    expect(text).toContain("name=A\nprogram=21\nsongProgram=5\npanpot=20\nvisible=false\n");
    const b = readMmi(text).song;
    expect(b.players).toEqual(a.players);
    expect(b.tracks).toEqual(a.tracks);
  });

  it("노래 악기가 연주 악기와 같으면(songProgram=-1로 읽은 곡) -1로 쓴다", () => {
    const a = readMmi("[mml-score]\nmml-track=MML@c4,,,d4;\nname=A\nprogram=21\nsongProgram=-1\n").song;
    const { text } = writeMmi(a);
    expect(text).toContain("mml-track=MML@c4,,,d4;\nname=A\nprogram=21\nsongProgram=-1\npanpot=64\nvisible=true");
  });

  it("다시 출력할 때도(원문이 없을 때) 노래 칸·노래 시작 자리를 지킨다", () => {
    const a = readMmi("[mml-score]\nmml-track=MML@c4d4,,,e4;\nname=A\nprogram=0\nstartDelta=-96\nstartSongDelta=0\n").song;
    expect(a.tracks.map((t) => t.notes[0]!.start)).toEqual([rat(-1, 4), rat(0)]);
    const edited = { ...a, tracks: a.tracks.map(({ mml: _mml, ...t }) => t) };
    const { text } = writeMmi(edited);
    expect(text.match(/^mml-track=.*$/gm)).toHaveLength(1);
    expect(text).toContain("startDelta=-96\nstartSongDelta=0\n");
    const b = readMmi(text).song;
    const notes = (s: typeof a) => s.tracks.map((t) => [t.mmiSong, t.notes.map((n) => [n.start, n.dur, n.pitch])]);
    expect(notes(b)).toEqual(notes(a));
  });

  it("노래 트랙과 mml-track 설정은 .mme로 저장했다 열어도 남는다", () => {
    const a = readMmi(SONG_PART).song;
    const once = readProject(writeProject(a));
    expect(once.diagnostics).toEqual([]);
    expect(once.song.tracks).toEqual(a.tracks);
    expect(writeMmi(once.song).text).toBe(writeMmi(a).text);
  });

  it("원문이 있으면 l·o 습관을 지켜 그대로 쓰고, 고친 트랙이 있으면 출력기로 새로 쓴다", () => {
    const a = readMmi("[mml-score]\ntempo=0T120\nmml-track=MML@t120l8o5cdef,,;\nname=A\nprogram=0\n").song;
    expect(writeMmi(a).text).toContain("mml-track=MML@t120l8o5cdef,,;");
    const edited = { ...a, tracks: a.tracks.map(({ mml: _mml, ...t }) => t) };
    const text = writeMmi(edited).text;
    expect(text).not.toContain("l8o5cdef");
    expect(readMmi(text).song.tracks[0]!.notes.map((n) => [n.start, n.pitch])).toEqual(a.tracks[0]!.notes.map((n) => [n.start, n.pitch]));
  });

  it("원문에 템포가 없으면(tempo= 줄에만 있는 곡) 첫 파트 원문의 음 경계에 템포를 끼우고, 양수 startDelta도 그대로 쓴다", () => {
    const a = readMmi(SAMPLE).song;
    const { text } = writeMmi(a);
    expect(text).toContain("mml-track=MML@l8t140cdefgab>ct100,o3c1,o3g1;");
    expect(text).toContain("mml-track=MML@r1c1,,;\nname=류트\nprogram=0\nsongProgram=-1\nstartDelta=96\n");
    const b = readMmi(text).song;
    const notes = (s: typeof a) => s.tracks.map((t) => t.notes.map((n) => [n.start, n.dur, n.pitch, n.vol, n.tie]));
    expect(notes(b)).toEqual(notes(a));
    expect(b.tempo).toEqual(a.tempo);
  });

  it("음수 startDelta 원문은 시작 자리와 맨 앞 템포를 그대로 쓰고, tempo= 줄에는 음수 tick을 쓰지 않는다", () => {
    const a = readMmi("[mml-score]\ntempo=0T150\nmml-track=MML@t150o5c4d4,,;\nname=t\nprogram=0\nstartDelta=-96\n").song;
    const { text } = writeMmi(a);
    expect(text).toContain("tempo=0T150\n");
    expect(text).toContain("mml-track=MML@t150o5c4d4,,;\nname=t\nprogram=0\nsongProgram=-1\nstartDelta=-96\n");
    const b = readMmi(text).song;
    expect(b.tempo).toEqual(a.tempo);
    expect(b.tracks[0]!.notes.map((n) => [n.start, n.pitch])).toEqual(a.tracks[0]!.notes.map((n) => [n.start, n.pitch]));
  });

  it("칸 구분자(, ;)나 줄바꿈이 든 원문(3MLE 주석 등), 멜로디·화음의 시작 자리가 다른 mml-track은 출력기로 쓴다", () => {
    const a = readMmi("[mml-score]\nmml-track=MML@l8o5cdef,,;\nname=A\nprogram=0\n").song;
    const commented = { ...a, tracks: a.tracks.map((t) => ({ ...t, mml: { text: "l8o5cd/* 가, 나 */ef" } })) };
    expect(writeMmi(commented).text).not.toContain("/*");
    const b = readMmi("[mml-score]\nmml-track=MML@o5c4,o5e4,;\nname=A\nprogram=0\n").song;
    const shifted = { ...b, tracks: b.tracks.map((t, i) => (i === 1 ? { ...t, mml: { ...t.mml!, offset: rat(1, 4) } } : t)) };
    expect(writeMmi(shifted).text).not.toContain("o5c4");
  });
});

describe("writeMmi 노래 칸만 쓴 mml-track (점검 S07 재점검)", () => {
  const notes = (s: ReturnType<typeof readMmi>["song"]) => s.tracks.map((t) => [t.mmiSong, t.notes.map((n) => [n.start, n.dur, n.pitch])]);

  it("앞 mml-track이 따로 있어도 노래 칸만 쓴 mml-track을 그 앞 mml-track에 붙이지 않고 그대로 쓴다", () => {
    const a = readMmi("[mml-score]\ntempo=0T120\nmml-track=MML@t120c4,,;\nname=B\nprogram=0\nmml-track=MML@,,,d4;\nname=A\nprogram=21\nsongProgram=5\npanpot=10\n").song;
    const { text } = writeMmi(a);
    expect(text.match(/^mml-track=.*$/gm)).toEqual(["mml-track=MML@t120c4,,;", "mml-track=MML@,,,d4;"]);
    expect(text).toContain("name=B\nprogram=0\nsongProgram=-1\npanpot=64\nvisible=true\n");
    expect(text).toContain("name=A\nprogram=21\nsongProgram=5\npanpot=10\nvisible=true\n");
    const b = readMmi(text).song;
    expect(b.players).toEqual(a.players);
    expect(b.tracks).toEqual(a.tracks);
  });

  it("곡 첫 mml-track이 노래 칸만 쓰면 템포를 노래 칸에 끼우고, 시작 자리는 startSongDelta로, 다시 출력할 때도 노래 칸을 지킨다", () => {
    const tempoOnly = readMmi("[mml-score]\ntempo=0T120\nmml-track=MML@,,,d4;\nname=A\nprogram=21\nsongProgram=5\n").song;
    expect(writeMmi(tempoOnly).text).toContain("mml-track=MML@,,,t120d4;\nname=A\nprogram=21\nsongProgram=5\npanpot=64\n");
    const a = readMmi("[mml-score]\nmml-track=MML@,,,d4;\nname=A\nprogram=21\nsongProgram=5\nstartDelta=96\n").song;
    const { text } = writeMmi(a);
    expect(text).toContain("mml-track=MML@,,,d4;\nname=A\nprogram=21\nsongProgram=5\nstartSongDelta=96\n");
    expect(notes(readMmi(text).song)).toEqual(notes(a));
    const edited = { ...a, tracks: a.tracks.map(({ mml: _mml, ...t }) => t) };
    const printed = writeMmi(edited).text;
    expect(printed.match(/^mml-track=MML@,,,[^,]+;$/gm)).toHaveLength(1);
    expect(printed).toContain("name=A\nprogram=21\nsongProgram=5\n");
    expect(notes(readMmi(printed).song)).toEqual(notes(a));
  });

  it("값이 빈 panpot=은 가운데(64)로 본다", () => {
    const a = readMmi("[mml-score]\nmml-track=MML@c4,,;\nname=A\nprogram=0\npanpot=\n").song;
    expect(a.tracks[0]!.mix).toBeUndefined();
    expect(writeMmi(a).text).toContain("panpot=64\n");
  });
});
