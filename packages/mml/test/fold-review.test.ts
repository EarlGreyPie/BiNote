import { describe, expect, it } from "vitest";
import { emptySong, History, MOBILE_PROFILE, rat, type Note, type Player, type Song, type Track } from "@mmlce/core";
import { applyFoldShifts, instrumentsCovering, reviewFolds } from "../src/index.js";

const piano: Player = { id: "p1", name: "피아노", instrument: { canonical: "piano" } };
const note = (id: string, start: number, pitch: number, tie: Note["tie"] = "none"): Note => ({ id, start: rat(start, 4), dur: rat(1, 4), pitch, vol: 8, tie });
const track = (id: string, notes: Note[]): Track => ({ id, playerId: "p1", name: id, color: "", role: "free", mute: false, solo: false, notes, spelling: {} });
const song = (tracks: Track[]): Song => ({ ...emptySong({ title: "", author: "", profileId: "mobile" }), players: [piano], tracks });
const instrumentOf = () => "piano";
const range = MOBILE_PROFILE.soundingRange;

describe("reviewFolds", () => {
  it("구간 끝 몇 음만 접히면 그대로는 옥타브가 튀고, 구간째 한 옥타브 내리기를 권한다", () => {
    const top = range.high;
    // 범위 끝 아래 두 음, 범위 위 두 음 (게임은 위 두 음만 한 옥타브 내려 낸다)
    const s = song([track("a", [note("1", 0, top - 2), note("2", 1, top), note("3", 2, top + 1), note("4", 3, top + 3)])]);
    const [phrase] = reviewFolds(s, MOBILE_PROFILE, instrumentOf);
    expect(phrase).toBeDefined();
    const asIs = phrase!.options.find((o) => o.shift === 0)!;
    expect(asIs.folds).toBe(2);
    expect(asIs.breaks).toBe(1);
    expect(phrase!.best).toBe(-12);
    expect(phrase!.options.find((o) => o.shift === -12)).toMatchObject({ folds: 0, breaks: 0 });
  });

  it("쉼표로 나뉜 구간은 따로 보고, 접히는 음이 없는 구간은 뺀다", () => {
    const top = range.high;
    const s = song([track("a", [note("1", 0, 60), note("2", 1, 62), note("3", 4, top + 2), note("4", 5, top + 4)])]);
    const list = reviewFolds(s, MOBILE_PROFILE, instrumentOf);
    expect(list.map((p) => p.noteIds)).toEqual([["3", "4"]]);
    // 모두 같은 만큼 접히면 그대로도 튐이 없다: 쓴 대로 남게 옮기는 것(접힘 0)을 권한다 (소리는 같다)
    expect(list[0]!.options[0]).toMatchObject({ shift: 0, folds: 2, breaks: 0 });
    expect(list[0]!.best).toBe(-12);
  });

  it("옮긴 음이 같은 때 다른 트랙 음과 같은 높이가 되면 겹침으로 센다", () => {
    const top = range.high;
    const a = track("a", [note("1", 0, top + 1)]);
    const b = track("b", [note("x", 0, top + 1 - 12)]);
    const [phrase] = reviewFolds(song([a, b]), MOBILE_PROFILE, instrumentOf);
    expect(phrase!.options.find((o) => o.shift === -12)!.doubled).toBe(1);
    // 그대로도 게임이 접어 같은 높이가 된다
    expect(phrase!.options[0]!.doubled).toBe(1);
  });

  it("applyFoldShifts: 고른 구간 음만 옮기고 실행 취소 한 번으로 돌아온다", () => {
    const top = range.high;
    const s = song([track("a", [note("1", 0, 60), note("3", 4, top + 2), note("4", 5, top + 4)])]);
    const [phrase] = reviewFolds(s, MOBILE_PROFILE, instrumentOf);
    const h = new History(s);
    h.run(applyFoldShifts(s, [{ phrase: phrase!, shift: -12 }])!);
    expect(h.song.tracks[0]!.notes.map((n) => n.pitch)).toEqual([60, top - 10, top - 8]);
    h.undo();
    expect(h.song).toBe(s);
    expect(applyFoldShifts(s, [{ phrase: phrase!, shift: 0 }])).toBeUndefined();
  });

  it("applyFoldShifts: 지금 구간 선택지에 없는 옮기기는 하지 않는다 (옛 선택이 남아 다시 옮기기, o0c4c4o5c4)", () => {
    const s = song([track("a", [note("1", 0, 12), note("2", 1, 12), note("3", 2, 72)])]);
    const [phrase] = reviewFolds(s, MOBILE_PROFILE, instrumentOf);
    expect(phrase!.options.some((o) => o.shift === 36)).toBe(true);
    const h = new History(s);
    h.run(applyFoldShifts(s, [{ phrase: phrase!, shift: 36 }])!);
    const [again] = reviewFolds(h.song, MOBILE_PROFILE, instrumentOf);
    expect(again).toBeDefined();
    expect(again!.options.some((o) => o.shift === 36)).toBe(false);
    expect(applyFoldShifts(h.song, [{ phrase: again!, shift: 36 }])).toBeUndefined();
  });

  it("instrumentsCovering: 실측 음역으로 다 낼 수 있는 악기만", () => {
    const low = [note("1", 0, 35)];
    const list = instrumentsCovering(MOBILE_PROFILE, low);
    expect(list).toContain("piano");
    expect(list).not.toContain("flute");
    expect(list).not.toContain("bass-drum");
  });
});
