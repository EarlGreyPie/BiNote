import { describe, expect, it } from "vitest";
import { emptySong, eq, getProfile, History, rat, type Song } from "@mmlce/core";
import { cleanPieces, findOffgrid, findTrackOffgrid, fixOffgrid, parseTrackText } from "../src/index.js";

const limit = getProfile("mobile").length;
const find = (text: string) => findTrackOffgrid(text, limit).map((f) => f.edits.map((e) => `${e.from}→${e.to}`).join(" "));

function song(...texts: string[]): Song {
  const tracks = texts.map((text, k) => {
    const id = `t${k + 1}`;
    const parsed = parseTrackText(id, { text });
    return { id, playerId: "p1", name: id, color: "#000", role: "free" as const, mute: false, solo: false, notes: parsed.notes, spelling: {}, mml: { text } };
  });
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: texts.flatMap((text, k) => parseTrackText(`t${k + 1}`, { text }).tempo),
    players: [{ id: "p1", name: "피아노", instrument: { canonical: "piano" } }],
    tracks,
  };
}

describe("깔끔한 길이 토막", () => {
  it("한 토막이 있으면 그것, 없으면 두 토막", () => {
    expect(cleanPieces(rat(3, 64), limit)).toEqual(["32."]);
    expect(cleanPieces(rat(5, 64), limit)).toEqual(["16", "64"]);
    expect(cleanPieces(rat(1, 4), limit)).toEqual(["4"]);
    expect(cleanPieces(rat(1, 21), limit)).toBeUndefined();
  });
});

describe("어긋난 길이 찾기", () => {
  it("r21 + l64 슬라이드 → r32.", () => {
    expect(find("l64c4r21cdefgg8")).toEqual(["r21→r32."]);
  });

  it("b19. + l64 세 개 → b16&b64", () => {
    expect(find("l64b+4b19.abcd4")).toEqual(["b19.→b16&b64"]);
  });

  it("l28 여섯 + l27 → 7잇단 (d27 → d28)", () => {
    expect(find("t90l28a>cev12gfed27 c4")).toEqual(["d27→d28"]);
  });

  it("l56 여섯 + l53·l54 묶음 셋을 차례로 고친다", () => {
    expect(find("l8gv10e l56ega>v13cdee53 ga>t70cdeeg54 ab->cdeea53 b+8")).toEqual(["e53→e56", "g54→g56", "a53→a56"]);
  });

  it("앞 자리를 고쳤다고 치고 뒤를 찾는다", () => {
    expect(find("l64c4r21cdefgg8 b+4b19.abcd4")).toEqual(["r21→r32.", "b19.→b16&b64"]);
  });

  it("쉼표는 두 토막을 r로 잇는다", () => {
    expect(find("l64c4r19.abcd4")).toEqual(["r19.→r16r64"]);
  });

  it("l 기본값으로 쓴 음은 숫자를 붙여 고친다", () => {
    expect(find("c4l21rl64cdefg8")).toEqual(["r→r32."]);
  });
});

describe("건드리지 않는 곳", () => {
  it.each([
    ["5잇단", "l20ccccc c4"],
    ["7잇단", "l28ccccccc c4"],
    ["10·20·40 섞인 잇단", "l40cc+d20l10fgf c4"],
    ["셋잇단·스윙·점음표", "l12ccc l6c c12 c8.c16 l24cccccc c4"],
    ["박 근처에 안 닿는 자유 리듬", "l7ccc l11cc c4"],
    ["처음부터 칸에 맞는 곡", "t120 o4 l8 cdefgab>c4 r2"],
  ])("%s", (_name, text) => {
    expect(find(text)).toEqual([]);
  });

  it("n 음표는 길이를 붙일 수 없어 고치자고 하지 않는다", () => {
    expect(find("l21n60l64cdefg8")).toEqual([]);
  });

  it("박이 크게 밀린 뒤(l7 하나)에는 짐작해서 고치지 않는다", () => {
    expect(find("l7c l64c4r21cdefgg8")).toEqual([]);
  });
});

describe("고치기", () => {
  it("고른 자리만 고치고 실행 취소 한 번에 돌아간다", () => {
    const s = song("l64c4r21cdefgg8b+4b19.abcd4", "c1");
    const fixes = findOffgrid(s);
    expect(fixes.map((f) => f.trackId)).toEqual(["t1", "t1"]);
    const h = new History(s);
    h.run(fixOffgrid([fixes[0]!]));
    expect(h.song.tracks[0]!.mml!.text).toBe("l64c4r32.cdefgg8b+4b19.abcd4");
    // 남은 자리는 다시 찾으면 그대로 나온다
    expect(findOffgrid(h.song).map((f) => f.edits[0]!.to)).toEqual(["b16&b64"]);
    h.run(fixOffgrid(findOffgrid(h.song)));
    expect(h.song.tracks[0]!.mml!.text).toBe("l64c4r32.cdefgg8b+4b16&b64abcd4");
    expect(findOffgrid(h.song)).toEqual([]);
    // 음은 지우지 않는다 (b19. 하나가 b16&b64 두 토막으로 이어질 뿐)
    expect(h.song.tracks[0]!.notes.length).toBe(s.tracks[0]!.notes.length + 1);
    h.undo();
    h.undo();
    expect(h.song).toBe(s);
  });

  it("모두 고치면 뒤 음이 다시 칸에 맞는다", () => {
    const s = song("l64c4r21cdefgg8 c4 d4");
    const h = new History(s);
    h.run(fixOffgrid(findOffgrid(s)));
    const last = h.song.tracks[0]!.notes.at(-1)!;
    expect(eq(last.start, rat(3, 4))).toBe(true);
  });

  it("트랙 원문의 템포도 고친 자리를 따라간다", () => {
    const s = song("l64c4r21cdefg t90 g8");
    const h = new History(s);
    h.run(fixOffgrid(findOffgrid(s)));
    expect(h.song.tempo.some((e) => e.bpm === 90 && eq(e.at, rat(3, 8)))).toBe(true);
  });

  it("원문이 바뀌어 맞지 않는 고침은 그 트랙을 그대로 둔다", () => {
    const s = song("l64c4r21cdefgg8");
    const fixes = findOffgrid(s);
    const changed = song("l64c4r20cdefgg8");
    expect(fixOffgrid(fixes).apply(changed)).toBe(changed);
  });
});
