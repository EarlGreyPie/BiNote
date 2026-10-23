import { describe, expect, it } from "vitest";
import { emptySong, History, MOBILE_PROFILE, normalizeTempo, rat, type Song } from "@mmlce/core";
import { gameScores, parseMml, parseTrackText, rampSteps, rampTempos, rampTemposResult, tempoMismatch, type TempoRamp } from "../src/index.js";

/** 원문마다 연주자를 따로 둔 곡 (같은 연주자로 묶으려면 players에 같은 번호) */
function songOf(texts: string[], players: number[] = texts.map((_, k) => k)): Song {
  const tracks = texts.map((text, k) => {
    const parsed = parseTrackText(`t${k + 1}`, { text });
    return {
      id: `t${k + 1}`,
      playerId: `p${players[k]! + 1}`,
      name: `t${k + 1}`,
      color: "#000",
      role: "free" as const,
      mute: false,
      solo: false,
      notes: parsed.notes,
      spelling: {},
      mml: { text },
      tempo: parsed.tempo,
    };
  });
  return {
    ...emptySong({ title: "", author: "", profileId: "mobile" }),
    tempo: normalizeTempo(tracks.flatMap((t) => t.tempo)),
    players: [...new Set(players)].map((p) => ({ id: `p${p + 1}`, name: "피아노", instrument: { canonical: "piano" as const } })),
    tracks: tracks.map(({ tempo: _t, ...t }) => t),
  };
}
const texts = (s: Song) => s.tracks.map((t) => t.mml?.text);
const range = MOBILE_PROFILE.tempo;
const ramp = (r: Partial<TempoRamp>): TempoRamp => ({ startBpm: 120, endBpm: 60, step: rat(1, 4), curve: "linear", restore: true, ...r });

describe("rampSteps: 계단 템포", () => {
  it("첫 계단은 시작 값, 마지막 계단은 끝 값이고 사이는 고르게", () => {
    expect(rampSteps(rat(0), rat(1), ramp({ startBpm: 120, endBpm: 90 }), range).map((e) => e.bpm)).toEqual([120, 110, 100, 90]);
    expect(rampSteps(rat(0), rat(1), ramp({ startBpm: 120, endBpm: 90 }), range).map((e) => e.at)).toEqual([rat(0), rat(1, 4), rat(1, 2), rat(3, 4)]);
  });

  it("곡선: in은 처음에 조금, out은 처음에 크게 바꾼다", () => {
    const at = (curve: TempoRamp["curve"]) => rampSteps(rat(0), rat(5, 4), ramp({ startBpm: 100, endBpm: 60, curve }), range).map((e) => e.bpm);
    expect(at("linear")).toEqual([100, 90, 80, 70, 60]);
    expect(at("in")).toEqual([100, 98, 90, 78, 60]);
    expect(at("out")).toEqual([100, 83, 70, 63, 60]);
  });

  it("게임 템포 범위 안으로 맞추고, 앞 계단과 같은 값은 뺀다", () => {
    const steps = rampSteps(rat(0), rat(1), ramp({ startBpm: 40, endBpm: 10 }), range);
    expect(steps).toEqual([{ at: rat(0), bpm: 40 }, { at: rat(1, 4), bpm: 32 }]);
    expect(rampSteps(rat(0), rat(1), ramp({ startBpm: 100, endBpm: 102, step: rat(1, 8) }), range).map((e) => e.bpm)).toEqual([100, 101, 102]);
  });

  it("빈 구간·0 길이 계단은 아무것도 없다", () => {
    expect(rampSteps(rat(1), rat(1), ramp({}), range)).toEqual([]);
    expect(rampSteps(rat(0), rat(1), ramp({ step: rat(0) }), range)).toEqual([]);
  });
});

describe("rampTempos: 점점 느리게·빠르게", () => {
  it("구간에 계단 t를 적고 구간 끝에 원래 템포를 다시 적는다", () => {
    const song = songOf(["t120 c4d4e4f4 g4a4b4>c4"]);
    const s = rampTempos(ramp({ startBpm: 120, endBpm: 90 }), rat(0), rat(1)).apply(song);
    expect(texts(s)).toEqual(["t120 c4t110d4t100e4t90f4 t120g4a4b4>c4"]);
    expect(s.tempo.map((e) => e.bpm)).toEqual([120, 110, 100, 90, 120]);
    expect(tempoMismatch(s)).toBe(false);
    // 음과 길이는 그대로
    expect(parseMml(texts(s)[0]!).gameEnd).toEqual(parseMml(song.tracks[0]!.mml!.text).gameEnd);
  });

  it("원래 템포로 돌아가지 않기를 고르면 마지막 계단 템포가 이어진다", () => {
    const s = rampTempos(ramp({ startBpm: 120, endBpm: 90, restore: false }), rat(0), rat(1)).apply(songOf(["t120 c4d4e4f4 g4a4"]));
    expect(texts(s)).toEqual(["t120 c4t110d4t100e4t90f4 g4a4"]);
  });

  it("구간 안에 있던 템포는 지우고 계단으로 바꾸며, 구간 끝 자리 템포는 그대로 둔다", () => {
    const song = songOf(["t100 c4 t140 d4 e4 f4 t80 g4"]);
    const r = rampTemposResult(song, ramp({ startBpm: 100, endBpm: 70 }), rat(1, 4), rat(1));
    expect(r.replaced).toBe(1);
    expect(texts(r.song)).toEqual(["t100 c4 d4 t85e4 t70f4 t80 g4"]);
    expect(r.song.tempo).toEqual([{ at: rat(0), bpm: 100 }, { at: rat(1, 4), bpm: 100 }, { at: rat(1, 2), bpm: 85 }, { at: rat(3, 4), bpm: 70 }, { at: rat(1), bpm: 80 }]);
    expect(tempoMismatch(r.song)).toBe(false);
  });

  it("계단 자리가 음 가운데면 &로 나눠 적는다 (소리는 같다)", () => {
    const song = songOf(["t120 c1 d4"]);
    const s = rampTempos(ramp({ startBpm: 120, endBpm: 60, step: rat(1, 2) }), rat(0), rat(1)).apply(song);
    expect(texts(s)).toEqual(["t120 c2&t60c2 t120d4"]);
    expect(parseMml(texts(s)[0]!).gameEnd).toEqual(parseMml("t120 c1 d4").gameEnd);
  });

  it("악보마다 원문에 적고, 먼저 끝난 악보와 마지막 쉼표는 늘이지 않는다", () => {
    const song = songOf(["t120 c4", "t120 c4d4e4f4r4r4", "t120 c1d1"]);
    const s = rampTempos(ramp({ startBpm: 120, endBpm: 90 }), rat(0), rat(1)).apply(song);
    expect(texts(s)[0]).toBe("t120 c4");
    // 끝 쉼표 앞에 돌아가는 템포를 적어도 게임 길이는 같다 (마지막 쉼표는 나누지 않는다)
    expect(texts(s)[1]).toBe("t120 c4t110d4t100e4t90f4t120r4r4");
    for (const k of [0, 1, 2]) expect(parseMml(texts(s)[k]!).gameEnd).toEqual(parseMml(texts(song)[k]!).gameEnd);
    expect(parseMml(texts(s)[2]!).tempo.map((e) => e.bpm)).toEqual([120, 110, 100, 90, 120]);
  });

  it("여러 악보에 따로 적힌 구간 안 t도 모두 계단으로 바꾸고, 지도와 원문이 맞는다", () => {
    const song = songOf(["t100 c4 t140 d4 e4 f4 g4", "t100 e4 t140 f4 g4 a4 b4"]);
    const s = rampTempos(ramp({ startBpm: 100, endBpm: 70 }), rat(0), rat(1)).apply(song);
    for (const text of texts(s)) expect(parseMml(text!).tempo.map((e) => e.bpm)).toEqual([100, 90, 80, 70, 140]);
    expect(texts(s)).toEqual(["t100 c4 t90d4 t80e4 t70f4 t140g4", "t100 e4 t90f4 t80g4 t70a4 t140b4"]);
    expect(tempoMismatch(s)).toBe(false);
  });

  it("음이 모두 끝난 뒤 구간은 바꾸지 않는다", () => {
    const song = songOf(["t120 c1"]);
    expect(rampTempos(ramp({}), rat(2), rat(3)).apply(song)).toBe(song);
  });

  it("실행 취소 한 번에 원래대로", () => {
    const song = songOf(["t120 c4d4e4f4 g4"]);
    const h = new History(song);
    h.run(rampTempos(ramp({ startBpm: 120, endBpm: 60 }), rat(0), rat(1)));
    expect(texts(h.song)).not.toEqual(texts(song));
    h.undo();
    expect(texts(h.song)).toEqual(texts(song));
    expect(h.song.tempo).toEqual(song.tempo);
  });

  it("끝 쉼표를 지키던 t는 지우지 않고 새 값으로 바꿔 먼저 끝난 악보 길이를 그대로 둔다 (GPT 검수 B-01)", () => {
    const song = songOf(["c4r4t90", "c1"]);
    const gameEnd = (s: Song) => parseMml(s.tracks[0]!.mml!.text).gameEnd;
    expect(gameEnd(song)).toEqual(rat(1, 2));
    const h = new History(song);
    h.run(rampTempos(ramp({ startBpm: 120, endBpm: 60 }), rat(0), rat(1)));
    expect(gameEnd(h.song)).toEqual(rat(1, 2));
    expect(texts(h.song)[0]).toMatch(/r4t\d+$/);
    // 정식 게임 출력도 첫 악보가 끝 쉼표까지 이어진다
    const out = gameScores(h.song, 3);
    expect(parseMml(out[0]!.texts[0]!.text).gameEnd).toEqual(rat(1, 2));
    h.undo();
    expect(texts(h.song)).toEqual(texts(song));
    expect(h.song.tempo).toEqual(song.tempo);
  });
});
