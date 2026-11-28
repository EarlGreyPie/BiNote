import { describe, expect, it } from "vitest";
import { add, cmp, emptySong, eq, mul, normalizeTempo, rat, tempoClock, type Rat, type Song } from "@mmlce/core";
import { foldTempoRange, foldTempoRangeResult, gameScores, mergeTies, parseMml, parseTrackText, songChordsPerScore, tempoFoldScale } from "../src/index.js";

/** 원문마다 연주자를 따로 둔 곡 */
function songOf(texts: string[]): Song {
  const tracks = texts.map((text, k) => {
    const parsed = parseTrackText(`t${k + 1}`, { text });
    return {
      id: `t${k + 1}`,
      playerId: `p${k + 1}`,
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
    players: texts.map((_, k) => ({ id: `p${k + 1}`, name: "피아노", instrument: { canonical: "piano" as const } })),
    tracks: tracks.map(({ tempo: _t, ...t }) => t),
  };
}

/**
 * 게임에 붙여넣는 글을 다시 읽어 음마다 실제 시각(초, 분수 그대로)을 센다. 악보마다 그 악보 채널에 적힌 템포로 센다.
 * &로 이은 음은 하나로 본다. 같은 소리면 템포·길이를 어떻게 적었든 같은 글이 나온다
 */
function heard(song: Song): string[] {
  const out: string[] = [];
  for (const score of gameScores(song, songChordsPerScore(song))) {
    const channels = score.text.replace(/^MML@/, "").replace(/;$/, "").split(",").map((text) => parseMml(text));
    const tempo = normalizeTempo(channels.flatMap((c) => c.tempo));
    const seconds = (at: Rat): Rat => {
      let sec: Rat = rat(0);
      let pos: Rat = rat(0);
      let bpm = 120;
      for (const e of tempo) {
        if (cmp(e.at, at) >= 0) break;
        sec = add(sec, mul(add(e.at, { n: -pos.n, d: pos.d }), rat(240, bpm)));
        pos = e.at;
        bpm = e.bpm;
      }
      return add(sec, mul(add(at, { n: -pos.n, d: pos.d }), rat(240, bpm)));
    };
    const s = (r: Rat) => `${seconds(r).n}/${seconds(r).d}`;
    channels.forEach((c, k) => {
      for (const n of mergeTies(c.notes)) out.push(`${score.playerId}.${k}|${s(n.start)}|${s(add(n.start, n.dur))}|${n.pitch}`);
    });
  }
  return out.sort();
}

const RANGE = { min: 32, max: 255 };
const bpms = (song: Song) => normalizeTempo(song.tempo).map((e) => `${e.at.n}/${e.at.d}:${e.bpm}`);
const meters = (song: Song) => song.timeSig.map((e) => `${e.at.n}/${e.at.d}:${e.beats}/${e.unit}`);

describe("tempoFoldScale: 범위에 드는 가장 작은 변화", () => {
  it("느리면 2배, 그래도 모자라면 4배. 빠르면 반, 그래도 넘으면 4분의 1", () => {
    expect(tempoFoldScale(20, RANGE)).toEqual(rat(2));
    expect(tempoFoldScale(10, RANGE)).toEqual(rat(4));
    expect(tempoFoldScale(300, RANGE)).toEqual(rat(1, 2));
    expect(tempoFoldScale(600, RANGE)).toEqual(rat(1, 4));
  });
  it("범위 안이거나 4배로도 못 닿으면 없다", () => {
    expect(tempoFoldScale(120, RANGE)).toBeUndefined();
    expect(tempoFoldScale(7, RANGE)).toBeUndefined();
    expect(tempoFoldScale(1100, RANGE)).toBeUndefined();
  });
});

describe("foldTempoRangeResult: 범위 밖 템포를 음 길이로 풀기", () => {
  it("빠른 템포: 그 조각의 길이를 반으로, 템포도 반으로. 들리는 시각은 그대로, 마디가 4/4 → 4/8", () => {
    const song = songOf(["t120l4cdeft300cdeft120cdef"]);
    const r = foldTempoRangeResult(song, RANGE);
    expect(r.failed).toEqual([]);
    expect(r.folded).toEqual([{ at: rat(1), bpm: 300, scale: rat(1, 2), to: 150 }]);
    expect(bpms(r.song)).toEqual(["0/1:120", "1/1:150", "3/2:120"]);
    expect(meters(r.song)).toEqual(["1/1:4/8", "3/2:4/4"]);
    expect(heard(r.song)).toEqual(heard(song));
    expect(r.move(rat(2))).toEqual(rat(3, 2));
    expect(r.move(rat(5, 4))).toEqual(rat(9, 8));
    expect(r.move(rat(1, 2))).toEqual(rat(1, 2));
  });

  it("느린 템포: 길이를 2배로, 템포도 2배로 (t20 → t40)", () => {
    const song = songOf(["t120l4cdeft20cdeft120cdef"]);
    const r = foldTempoRangeResult(song, RANGE);
    expect(r.folded.map((f) => f.to)).toEqual([40]);
    expect(bpms(r.song)).toEqual(["0/1:120", "1/1:40", "3/1:120"]);
    expect(heard(r.song)).toEqual(heard(song));
  });

  it("여러 곳은 뒤에서부터: 앞 변환이 뒤 자리를 밀어도 둘 다 들리는 시각 그대로", () => {
    const song = songOf(["t120l4cdeft300cdeft120cdeft20cdeft120c"]);
    const r = foldTempoRangeResult(song, RANGE);
    expect(r.failed).toEqual([]);
    expect(r.folded.map((f) => [f.at, f.to])).toEqual([
      [rat(1), 150],
      [rat(3), 40],
    ]);
    expect(normalizeTempo(r.song.tempo).every((e) => e.bpm >= 32 && e.bpm <= 255)).toBe(true);
    expect(heard(r.song)).toEqual(heard(song));
    // 3마디 첫 박(바꾸기 전 2)은 반 마디 당겨지고, 4마디(바꾸기 전 3)의 t20 조각은 2배로 늘어난다
    expect(r.move(rat(3))).toEqual(rat(5, 2));
    expect(r.move(rat(4))).toEqual(rat(9, 2));
  });

  it("같은 배율로 풀 조각이 이어지면 한 구간으로 (박자표가 조각마다 끊기지 않는다)", () => {
    const song = songOf(["t120l4cdeft300cdt280eft120cdef"]);
    const r = foldTempoRangeResult(song, RANGE);
    expect(r.folded.map((f) => f.to)).toEqual([150, 140]);
    expect(meters(r.song)).toEqual(["1/1:4/8", "3/2:4/4"]);
    expect(heard(r.song)).toEqual(heard(song));
  });

  it("only를 주면 그 자리 템포만 푼다", () => {
    const song = songOf(["t120l4cdeft300cdeft120cdeft20cdeft120c"]);
    const r = foldTempoRangeResult(song, RANGE, [rat(3)]);
    expect(r.folded.map((f) => f.bpm)).toEqual([20]);
    expect(normalizeTempo(r.song.tempo).some((e) => e.bpm === 300)).toBe(true);
  });

  it("4배로도 범위에 안 들면 곡을 바꾸지 않고 그 자리를 알린다", () => {
    const song = songOf(["t120l4cdeft7cdeft120cdef"]);
    const r = foldTempoRangeResult(song, RANGE);
    expect(r.song).toBe(song);
    expect(r.failed).toEqual([{ kind: "tempo", at: rat(1), bpm: 7 }]);
    expect(r.move(rat(2))).toEqual(rat(2));
  });

  it("길이를 반으로 하면 쓸 수 없는 길이(l128)가 되면 곡을 바꾸지 않는다", () => {
    const song = songOf(["t120l4cdeft300l64cccccccct120cdef"]);
    const r = foldTempoRangeResult(song, RANGE);
    expect(r.song).toBe(song);
    expect(r.failed.some((f) => f.kind === "length")).toBe(true);
    expect(r.folded).toEqual([]);
  });

  it("홀수 템포를 반으로 하면 반올림한 곳을 알린다 (t301 → t151)", () => {
    const song = songOf(["t120l4cdeft301cdeft120cdef"]);
    const r = foldTempoRangeResult(song, RANGE);
    expect(r.folded.map((f) => f.to)).toEqual([151]);
    expect(r.rounded.map((x) => [x.bpm, x.to])).toEqual([[301, 151]]);
  });

  it("홀수 템포 조각이 여럿 이어져도 올림·내림을 골라 끝 시각 차이가 한 조각의 반올림 오차 안에 머문다", () => {
    // 마디마다 t301, t303, t305, t307 (모두 반으로 → 150.5, 151.5 ...): 늘 반올림하면 조각마다 같은 쪽으로 쌓인다
    // (조각을 더 늘리면 변환의 게임 출력 확인이 분수 범위를 넘는다: 그때는 앱이 못 푼 까닭으로 알린다)
    const odd = Array.from({ length: 4 }, (_, k) => `t${301 + 2 * k}cdef`).join("");
    const song = songOf([`t120l4cdef${odd}t120cdef`]);
    const r = foldTempoRangeResult(song, RANGE);
    expect(r.failed).toEqual([]);
    expect(r.folded).toHaveLength(4);
    const tos = r.folded.map((f) => f.to);
    // 올림과 내림이 섞인다
    expect(tos.some((to, k) => to * 2 > r.folded[k]!.bpm)).toBe(true);
    expect(tos.some((to, k) => to * 2 < r.folded[k]!.bpm)).toBe(true);
    // 끝(6마디 시작) 시각: 풀기 전후 차이가 한 조각 반올림 오차(4분음표 넷을 t150 대 t150.5로 친 차이) 안
    const end = (s: Song, at: Rat) => tempoClock(s.tempo)(at);
    const oneStep = 240 * 0.5 * (1 / 150 - 1 / 150.5);
    const diff = end(r.song, r.move(rat(5))) - end(song, rat(5));
    expect(Math.abs(diff)).toBeLessThanOrEqual(oneStep + 1e-12);
    expect(r.shift).toBeCloseTo(diff, 9);
    // 늘 반올림했다면 쌓였을 양보다 작다
    const always = r.folded.reduce((sum, f) => sum + 240 * 0.5 * (1 / Math.round(f.bpm / 2) - 2 / f.bpm), 0);
    expect(Math.abs(diff)).toBeLessThan(Math.abs(always));
  });

  it("범위 안 곡은 그대로", () => {
    const song = songOf(["t120l4cdeft200cdef"]);
    const r = foldTempoRangeResult(song, RANGE);
    expect(r.song).toBe(song);
    expect(r.folded).toEqual([]);
  });

  it("명령: 실행 한 번에 다 바꾸고, 실패하면 곡 그대로", () => {
    const song = songOf(["t120l4cdeft300cdeft120cdef"]);
    const next = foldTempoRange(RANGE).apply(song);
    expect(next).not.toBe(song);
    expect(eq(normalizeTempo(next.tempo)[1]!.at, rat(1))).toBe(true);
    const bad = songOf(["t120l4cdeft7cdef"]);
    expect(foldTempoRange(RANGE).apply(bad)).toBe(bad);
  });
});

describe("곡 검사: 게임 템포 끝값에 닿은 템포 (실험실)", () => {
  it("t32·t255와 같은 템포를 마디와 함께 정보로 알린다. 곡 끝 뒤 템포와 옵션을 끈 때는 보지 않는다", async () => {
    const { validateSong } = await import("../src/index.js");
    const { MOBILE_PROFILE } = await import("@mmlce/core");
    const song = songOf(["t120l4cdeft255cdeft32cdeft120cdeft255"]);
    const on = validateSong(song, MOBILE_PROFILE, { tempoAtLimit: true }).filter((d) => d.code === "tempo-at-limit");
    expect(on).toEqual([{ level: "info", code: "tempo-at-limit", params: { count: 2, min: 32, max: 255, bars: "2, 3" } }]);
    expect(validateSong(song, MOBILE_PROFILE).some((d) => d.code === "tempo-at-limit")).toBe(false);
  });
});
