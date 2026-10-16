import { describe, expect, it } from "vitest";
import { rat } from "@mmlce/core";
import { readMmi, writeMmi } from "../src/index.js";

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
