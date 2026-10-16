import { describe, expect, it } from "vitest";
import { rat, type Song } from "@mmlce/core";
import { isProjectFileName, looksLikeProject, PROJECT_EXTENSION, PROJECT_VERSION, ProjectError, readMmlAt, readProject, writeProject } from "../src/index.js";

function sample(): Song {
  // l7·l37처럼 tick으로 떨어지지 않는 길이와 & 이음, 트랙 원문, 트랙별 악기를 함께 둔다
  const { song } = readMmlAt("MML@t120l7cdl37e&e,o3c1,;");
  return {
    ...song,
    meta: { ...song.meta, title: "연습곡", author: "EarlGreyPie", memo: "메모" },
    markers: [{ id: "m1", at: rat(1, 7), label: "A" }],
    timeSig: [{ at: rat(0), beats: 3, unit: 4 }],
    tracks: song.tracks.map((tr, i) => (i === 1 ? { ...tr, instrument: { canonical: "lute", program: 0 }, mute: true, mix: { volume: 100, pan: 30 } } : tr)),
    sources: [{ id: "s1", kind: "audio", fileName: "원곡.mp3", offsetSec: 0.25 }],
  };
}

describe("writeProject / readProject", () => {
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
