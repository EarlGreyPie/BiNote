import { describe, expect, it } from "vitest";
import { rat, type Song } from "@mmlce/core";
import { hexColor, isProjectFileName, looksLikeProject, PROJECT_EXTENSION, PROJECT_VERSION, ProjectError, readMmlAt, readProject, writeProject } from "../src/index.js";

function sample(): Song {
  // l7·l37처럼 tick으로 떨어지지 않는 길이와 & 이음, 트랙 원문, 트랙별 악기를 함께 둔다
  const { song } = readMmlAt("MML@t120l7cdl37e&e,o3c1,;");
  return {
    ...song,
    meta: { ...song.meta, title: "연습곡", author: "EarlGreyPie", memo: "메모" },
    markers: [{ id: "m1", at: rat(1, 7), label: "A" }],
    timeSig: [{ at: rat(0), beats: 3, unit: 4 }],
    // 오르골에서 떼어 낸 악보 표시와 악보 타브 튜닝도 왕복한다
    players: [...song.players, { id: "p9", name: "류트 1", instrument: { canonical: "lute", program: 0 }, splitFrom: song.players[0]!.id, tab: { tuning: "dropD", capo: 2 } }],
    tracks: song.tracks.map((tr, i) => (i === 1 ? { ...tr, instrument: { canonical: "lute", program: 0 }, mute: true, mix: { volume: 100, pan: 30 } } : tr)),
    sources: [{ id: "s1", kind: "audio", fileName: "원곡.mp3", offsetSec: 0.25 }],
  };
}

describe("writeProject / readProject", () => {
  it("트랙 색 고정은 저장했다 다시 열어도 남고, 예전 파일(표시 없음)은 고정이 아니다", () => {
    const song = sample();
    const tracks = song.tracks.map((t, i) => (i === 1 ? { ...t, color: "#e04a8a", colorPinned: true } : t));
    const back = readProject(writeProject({ ...song, tracks })).song;
    expect(back.tracks.map((t) => t.colorPinned)).toEqual([undefined, true, undefined]);
    expect(back.tracks[1]!.color).toBe("#e04a8a");
  });

  it("읽을 수 없는 트랙 색은 차례대로 주는 색으로 바꾸고 고정도 켜지 않는다 (알림을 남김)", () => {
    const song = sample();
    const tracks = song.tracks.map((t, i) => (i === 0 ? { ...t, color: "not-a-color", colorPinned: true } : i === 1 ? { ...t, color: " ", colorPinned: true } : { ...t, color: "rgb(255, 0, 0)" }));
    const read = readProject(writeProject({ ...song, tracks }));
    expect(read.song.tracks.map((t) => t.colorPinned)).toEqual([undefined, undefined, undefined]);
    expect(read.song.tracks[0]!.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(read.song.tracks[2]!.color).toBe("rgb(255, 0, 0)");
    expect(read.diagnostics.filter((d) => d.code === "project-track-color")).toHaveLength(1);
  });

  it("hexColor: #rgb·rgb()·hsl()을 색 고르기 칸 값으로, 모르는 꼴은 undefined", () => {
    expect(hexColor("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(hexColor("rgb(0 128 255)")).toBe("#0080ff");
    expect(hexColor("Red")).toBe("#ff0000");
    expect(hexColor("rebeccapurple")).toBe("#663399");
    expect(hexColor(" ")).toBeUndefined();
    // 숫자가 아닌 숫자 자리는 받지 않는다 (NaN 색이 되지 않게)
    expect(hexColor("rgb(1..2, 0, 0)")).toBeUndefined();
    expect(hexColor("hsl(.., 20%, 30%)")).toBeUndefined();
    expect(hexColor("redd")).toBeUndefined();
    // 쉼표와 빈칸을 섞은 꼴, 아주 긴 숫자도 받지 않는다
    expect(hexColor("rgb(1,2 3)")).toBeUndefined();
    expect(hexColor("hsl(120 50%, 50%)")).toBeUndefined();
    expect(hexColor(`rgb(${"9".repeat(400)}, 0, 0)`)).toBeUndefined();
    expect(hexColor("hsl(120, 100%, 25%)")).toBe("#008000");
    expect(hexColor("hsl(120deg 100% 25%)")).toBe("#008000");
  });

  it("예전 파일의 CSS 색 이름(red)은 그대로 읽고 고정도 남긴다", () => {
    const song = sample();
    const tracks = song.tracks.map((t, i) => (i === 0 ? { ...t, color: "red", colorPinned: true } : i === 1 ? { ...t, color: "rgb(1..2,0,0)", colorPinned: true } : t));
    const read = readProject(writeProject({ ...song, tracks }));
    expect(read.song.tracks[0]).toMatchObject({ color: "red", colorPinned: true });
    expect(read.song.tracks[1]!.colorPinned).toBeUndefined();
    expect(read.song.tracks[1]!.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("떼어 낸 악보 표시는 없는 악보·자기 자신·돌고 도는 연결이면 버린다 (#96 점검 2번)", () => {
    const song = sample();
    const base = song.players[0]!;
    const players = [
      { ...base, id: "a", splitFrom: "gone" },
      { ...base, id: "b", splitFrom: "b" },
      { ...base, id: "c", splitFrom: "d" },
      { ...base, id: "d", splitFrom: "c" },
      { ...base, id: "e", splitFrom: "a" },
    ];
    const back = readProject(writeProject({ ...song, players, tracks: song.tracks.map((t) => ({ ...t, playerId: "a" })) })).song;
    expect(back.players.map((p) => [p.id, p.splitFrom])).toEqual([["a", undefined], ["b", undefined], ["c", undefined], ["d", undefined], ["e", "a"]]);
  });

  it("타브에서 고른 줄(tabString)은 저장했다 다시 열어도 남고, 1~12 정수가 아니면 버린다", () => {
    const song = sample();
    const tracks = song.tracks.map((t, i) => ({ ...t, notes: t.notes.map((x, j) => ({ ...x, tabString: i === 0 && j === 0 ? 1 : 99 })) }));
    const back = readProject(writeProject({ ...song, tracks })).song;
    const all = back.tracks.flatMap((t) => t.notes);
    expect(all.length).toBeGreaterThan(1);
    expect(back.tracks[0]!.notes[0]!.tabString).toBe(1);
    expect(all.slice(1).every((x) => x.tabString === undefined)).toBe(true);
  });

  it("실험실 표시(lab)는 저장했다 다시 열어도 남고, 모르는 모양이면 버린다 (음은 그대로)", () => {
    const song = sample();
    const labs: unknown[] = [
      { kind: "ghost", vol: 9 },
      { kind: "harmonic", type: "natural", pitch: 47, vol: 10, string: 6, fret: 7 },
      { kind: "harmonic", type: "weird", pitch: 47, vol: 10 },
      { kind: "ghost", vol: 99 },
    ];
    const tracks = song.tracks.map((t, i) => (i === 0 ? { ...t, notes: t.notes.map((x, j) => ({ ...x, lab: labs[j] as never })) } : t));
    const back = readProject(writeProject({ ...song, tracks })).song.tracks[0]!.notes;
    expect(back.map((x) => x.lab)).toEqual([labs[0], labs[1], undefined, undefined].slice(0, back.length));
    expect(back.length).toBe(song.tracks[0]!.notes.length);
  });

  it("직접 입력 튜닝은 줄 높이째 저장했다 다시 열고, 줄 높이가 맞지 않으면 튜닝을 버린다", () => {
    const song = sample();
    const custom = { tuning: "custom", capo: 1, strings: [56, 51, 59, 54, 37, 32] };
    const back = readProject(writeProject({ ...song, players: song.players.map((p) => ({ ...p, tab: custom })) })).song;
    expect(back.players.every((p) => JSON.stringify(p.tab) === JSON.stringify(custom))).toBe(true);
    for (const strings of [undefined, [], [60, 128], [60.5], Array.from({ length: 13 }, () => 40), "E A D"]) {
      const bad = writeProject({ ...song, players: song.players.map((p) => ({ ...p, tab: { tuning: "custom", capo: 0, strings } as never })) });
      expect(readProject(bad).song.players.every((p) => p.tab === undefined), JSON.stringify(strings)).toBe(true);
    }
  });

  it("악보 타브 튜닝은 카포가 0~24 정수일 때만 읽는다", () => {
    const song = sample();
    const bad = writeProject({ ...song, players: song.players.map((p) => ({ ...p, tab: { tuning: "dropD", capo: 30 } })) });
    expect(readProject(bad).song.players.every((p) => p.tab === undefined)).toBe(true);
  });

  it("곡을 그대로 왕복한다 (분수 위치·이음·원문·악기·메모)", () => {
    const song = sample();
    const text = writeProject(song, { editor: { activeTrackId: song.tracks[1]!.id, division: 16 }, app: "test" });
    const back = readProject(text);
    expect(back.diagnostics).toEqual([]);
    expect(back.song).toEqual(song);
    expect(back.editor).toEqual({ activeTrackId: song.tracks[1]!.id, division: 16 });
    expect(back.savedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    // 1/7 + 1/7 = 2/7 같은 분수가 반올림 없이 남는다
    expect(back.song.tracks[0]!.notes[1]!.start).toEqual(rat(1, 7));
  });

  it("음은 한 줄에 하나씩 써서 비교하기 쉽다", () => {
    const text = writeProject(sample());
    const lines = text.split("\n");
    const noteLines = lines.filter((l) => /^\s+\{"id":/.test(l));
    expect(noteLines.length).toBe(sample().tracks.reduce((s, tr) => s + tr.notes.length, 0));
    expect(text).toContain('"format": "mmlce"');
    expect(text).toContain(`"version": ${PROJECT_VERSION}`);
    expect(text.endsWith("\n")).toBe(true);
    expect(looksLikeProject(text)).toBe(true);
    expect(looksLikeProject("MML@cde;")).toBe(false);
  });

  it("프로젝트 확장자는 한 곳에서 정하고 대소문자를 가리지 않는다", () => {
    expect(isProjectFileName(`곡${PROJECT_EXTENSION}`)).toBe(true);
    expect(isProjectFileName(`곡${PROJECT_EXTENSION.toUpperCase()}`)).toBe(true);
    expect(isProjectFileName("예전.mmlce")).toBe(true);
    expect(isProjectFileName("곡.mml")).toBe(false);
  });

  it("트랙에서 고른 사운드팩(packId)은 저장했다 다시 열어도 남는다", () => {
    const song = sample();
    const picked: Song = {
      ...song,
      players: song.players.map((p, i) => (i === 0 ? { ...p, instrument: { ...p.instrument, packId: "pack-a.dls" } } : p)),
      tracks: song.tracks.map((tr, i) => (i === 1 ? { ...tr, instrument: { canonical: "harp", program: 1048, packId: "pack-b.dls" } } : tr)),
    };
    const back = readProject(writeProject(picked)).song;
    expect(back.players[0]!.instrument.packId).toBe("pack-a.dls");
    expect(back.tracks[1]!.instrument).toEqual({ canonical: "harp", program: 1048, packId: "pack-b.dls" });
  });

  it("빈 트랙도 왕복한다", () => {
    const song = sample();
    const empty = { ...song, tracks: [{ ...song.tracks[0]!, notes: [] }] };
    expect(readProject(writeProject(empty)).song).toEqual(empty);
  });

  it("JSON이 아니거나 형식이 다르면 열지 않는다", () => {
    expect(() => readProject("{")).toThrow(ProjectError);
    expect(() => readProject('{"format":"other","version":1,"song":{}}')).toThrowError(expect.objectContaining({ code: "project-format" }));
    expect(() => readProject('{"format":"mmlce","version":1}')).toThrowError(expect.objectContaining({ code: "project-broken" }));
  });

  it("더 새 판 파일은 이유를 알려 주고 열지 않는다", () => {
    const text = writeProject(sample()).replace(`"version": ${PROJECT_VERSION}`, `"version": ${PROJECT_VERSION + 1}`);
    expect(() => readProject(text)).toThrowError(expect.objectContaining({ code: "project-newer" }));
  });

  it("깨진 음·겹친 음·범위 밖 v는 고치거나 빼고 진단을 남긴다", () => {
    const raw = JSON.parse(writeProject(sample()));
    const notes = raw.song.tracks[0].notes;
    notes.push({ id: "bad", start: { n: 1, d: 0 }, dur: { n: 1, d: 4 }, pitch: 60, vol: 8, tie: "none" });
    notes.push({ ...notes[0], id: "dup-overlap" });
    notes[1].vol = 99;
    notes.reverse(); // 순서가 뒤섞여도 시작 순으로 다시 놓는다
    const back = readProject(JSON.stringify(raw));
    const codes = back.diagnostics.map((d) => d.code).sort();
    expect(codes).toEqual(["project-bad-notes", "project-overlap", "project-volume-clamped"]);
    const starts = back.song.tracks[0]!.notes.map((n) => n.start);
    expect(starts).toEqual(sample().tracks[0]!.notes.map((n) => n.start));
    expect(back.song.tracks[0]!.notes.find((n) => n.vol > 15)).toBeUndefined();
  });

  it("겹치는 id는 새로 붙이고, 연주자가 없는 트랙은 첫 연주자에게 붙인다", () => {
    const raw = JSON.parse(writeProject(sample()));
    raw.song.tracks[1].notes[0].id = raw.song.tracks[0].notes[0].id;
    raw.song.tracks[1].playerId = "nobody";
    const back = readProject(JSON.stringify(raw));
    const ids = back.song.tracks.flatMap((tr) => tr.notes.map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(back.song.tracks[1]!.playerId).toBe(back.song.players[0]!.id);
    expect(back.diagnostics.map((d) => d.code)).toEqual(["project-player-missing"]);
  });

  it("모르는 게임 프로필은 모바일로 연다", () => {
    const raw = JSON.parse(writeProject(sample()));
    raw.song.meta.profileId = "future";
    const back = readProject(JSON.stringify(raw));
    expect(back.song.meta.profileId).toBe("mobile");
    expect(back.diagnostics.map((d) => d.code)).toEqual(["project-unknown-profile"]);
  });
});
