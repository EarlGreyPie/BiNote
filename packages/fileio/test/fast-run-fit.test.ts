import { describe, expect, it } from "vitest";
import { add, maxChordsOf, MOBILE_PROFILE, rat, type GameProfile, type Song } from "@mmlce/core";
import { fitFastRunCommand, fitFastRunFix, gameCharCounts, gameTimeline } from "@mmlce/mml";
import { readMmlAt } from "../src/index.js";

/*
 * 실험실 연주 누락음 고치기를 글자 수 한도 안에서만 적용하기 (fitFastRunFix). 한도는 프로필 값이라
 * 짧은 시험 곡에 맞춰 한도를 줄인 프로필로 경우마다 확인한다 (한 권 곡·화음 분산·일부만·악보책 곡·잠금·한도 끄기)
 */
// 연주 누락음 검사 시험의 A판 (G선상의 아리아 38~40마디 조각, 트랙 1·5의 착지 음이 빠질 위험)
const A =
  "MML@t116r2r6<v12a24v11b24v10b+2v11b2v12ag,t116,t116v14c2&c6v12c24v11d24v10e2v11d2v12c<ba,t116<v12a2&a6,t116<v12e2&e6v9e24f+24g2f+2edc,t116o1v13b>a<a&a6>l24agl2f+v15dv14g;";
const one = readMmlAt(A).song;
/** 같은 조각을 4온음표 뒤에 한 번 더 (위험 자리 둘) */
const two: Song = {
  ...one,
  tracks: one.tracks.map(({ mml: _mml, ...t }) => ({ ...t, notes: [...t.notes, ...t.notes.map((n) => ({ ...n, id: `${n.id}b`, start: add(n.start, rat(4)) }))] })),
};
const limited = (charLimitPerScore: number): GameProfile => ({ ...MOBILE_PROFILE, charLimitPerScore });
const counts = (song: Song, profile: GameProfile) =>
  [...gameCharCounts(song, (id) => maxChordsOf(profile, song.players.find((p) => p.id === id)?.instrument.canonical), profile.maxChordsPerPlayer, profile.charLimitPerScore).values()];
const noteCount = (song: Song) => song.tracks.reduce((n, t) => n + t.notes.length, 0);
/** 게임에서 나는 소리 (연주자마다 게임 출력을 다시 읽은 것). 화음 분산은 음을 다른 트랙으로 옮기고 길이를 이어 쓰기로 나누지만 소리는 같다 */
const sound = (song: Song, profile: GameProfile) => song.players.map((p) => gameTimeline(song, profile, p.id)).join("\n");

describe("연주 누락음 고치기: 글자 수 한도 안에서만", () => {
  it("한 권 곡이 고친 뒤에도 한도 안이면 모두 고친다", () => {
    const fit = fitFastRunFix(one, MOBILE_PROFILE);
    expect(fit.fixed).toHaveLength(1);
    expect(fit.overLimit).toEqual([]);
    expect(fit.plan.delays).toHaveLength(2);
    expect(fit.moved).toBe(0);
    expect(fit.books).toBeUndefined();
    expect(fit.chars.delta).toBeGreaterThan(0);
    expect(noteCount(fit.song)).toBe(noteCount(one));
  });

  it("한도를 넘으면 같은 악기 트랙으로 화음 분산을 함께 해서 모두 고친다", () => {
    const profile = limited(80);
    const fit = fitFastRunFix(two, profile);
    expect(fit.fixed).toHaveLength(2);
    expect(fit.overLimit).toEqual([]);
    expect(fit.moved).toBeGreaterThan(0);
    expect(Math.max(...counts(fit.song, profile))).toBeLessThanOrEqual(80);
    // 모두 고친 곡(한도 끔)과 게임 소리가 같다
    expect(sound(fit.song, profile)).toBe(sound(fitFastRunFix(two, profile, { limit: false }).song, profile));
  });

  it("화음 분산을 쓰지 않으면 들어가는 만큼만 고치고 나머지는 건너뛴다", () => {
    const profile = limited(80);
    const fit = fitFastRunFix(two, profile, { distribute: false });
    expect(fit.fixed).toHaveLength(1);
    expect(fit.overLimit).toHaveLength(1);
    expect(fit.moved).toBe(0);
    expect(fit.fullOver).toBeGreaterThan(0);
    expect(Math.max(...counts(fit.song, profile))).toBeLessThanOrEqual(80);
    expect(noteCount(fit.song)).toBe(noteCount(two));
  });

  it("하나도 들어가지 않으면 곡을 그대로 둔다", () => {
    const fit = fitFastRunFix(one, limited(45));
    expect(fit.fixed).toEqual([]);
    expect(fit.overLimit).toHaveLength(1);
    expect(fit.song).toBe(one);
    expect(fit.chars.delta).toBe(0);
  });

  it("이미 악보책으로 나뉘는 곡은 권 수가 늘지 않는 만큼 고친다", () => {
    for (const limit of [30, 45, 60]) {
      const fit = fitFastRunFix(two, limited(limit));
      expect(fit.books).toBeDefined();
      expect(fit.books!.to).toBeLessThanOrEqual(fit.books!.from);
      expect(fit.fixed.length + fit.overLimit.length).toBe(2);
      expect(noteCount(fit.song)).toBe(noteCount(two));
    }
  });

  it("한도를 끄면 넘어도 모두 고친다", () => {
    const fit = fitFastRunFix(one, limited(45), { limit: false });
    expect(fit.fixed).toHaveLength(1);
    expect(fit.chars.longest).toBeGreaterThan(45);
  });

  it("잠근 트랙은 늦추지도, 화음 분산으로 음을 주고받지도 않는다", () => {
    const profile = limited(80);
    for (const k of [0, 1]) {
      const id = two.tracks[k]!.id;
      const fit = fitFastRunFix(two, profile, { locked: new Set([id]) });
      expect(fit.song.tracks[k]!.notes).toBe(two.tracks[k]!.notes);
      expect(Math.max(...counts(fit.song, profile))).toBeLessThanOrEqual(80);
      if (k === 0) expect(fit.plan.skipped.locked).toBeGreaterThan(0);
    }
  });

  it("명령은 계획한 곡이면 그 결과를, 그 사이 곡이 바뀌었으면 다시 계획해 적용한다", () => {
    const profile = limited(80);
    const fit = fitFastRunFix(two, profile);
    const replan = (song: Song) => fitFastRunFix(song, profile);
    const command = fitFastRunCommand(fit, replan);
    expect(command.apply(two)).toBe(fit.song);
    const changed = { ...two, meta: { ...two.meta } };
    expect(sound(command.apply(changed), profile)).toBe(sound(fit.song, profile));
    expect(command.invert(two).apply(fit.song)).toBe(two);
  });
});
