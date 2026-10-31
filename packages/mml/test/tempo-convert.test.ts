import { describe, expect, it } from "vitest";
import { add, barAt, cmp, emptySong, measureStart, mul, normalizeTempo, rat, type Rat, type Song } from "@mmlce/core";
import { convertTempo, convertTempoResult, gameScores, mergeTies, parseMml, parseTrackText, songChordsPerScore, textEnd, trackSource } from "../src/index.js";

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

describe("convertTempoResult: 실제 시간 유지 템포 변환", () => {
  it("곡 전체 t300을 t150으로 고치고 음 길이를 반으로 줄인다. 실제 시간은 그대로다", () => {
    const song = songOf(["t300 c4d4e4f4 g2"]);
    const r = convertTempoResult(song, rat(1, 2));
    expect(r.failed).toEqual([]);
    expect(r.rounded).toEqual([]);
    expect(r.song.tempo).toEqual([{ at: rat(0), bpm: 150 }]);
    expect(r.song.tracks[0]!.notes.map((n) => n.dur)).toEqual([rat(1, 8), rat(1, 8), rat(1, 8), rat(1, 8), rat(1, 4)]);
    // 원문은 지우고 출력기로 다시 쓴다. 음 id는 그대로
    expect(r.song.tracks[0]!.mml).toBeUndefined();
    expect(r.song.tracks[0]!.notes.map((n) => n.id)).toEqual(song.tracks[0]!.notes.map((n) => n.id));
    expect(trackSource(r.song, r.song.tracks[0]!).text).toContain("t150");
    // 마디선이 음과 맞게 박자표도 4/4 → 4/8
    expect(r.song.timeSig).toEqual([{ at: rat(0), beats: 4, unit: 8 }]);
    expect(heard(r.song)).toEqual(heard(song));
  });

  it("느린 템포는 두 배로 하고 음 길이를 두 배로 늘인다", () => {
    const song = songOf(["t20 c8d8e4"]);
    const r = convertTempoResult(song, rat(2));
    expect(r.failed).toEqual([]);
    expect(r.song.tempo).toEqual([{ at: rat(0), bpm: 40 }]);
    expect(r.song.tracks[0]!.notes.map((n) => n.dur)).toEqual([rat(1, 4), rat(1, 4), rat(1, 2)]);
    expect(r.song.timeSig).toEqual([{ at: rat(0), beats: 4, unit: 2 }]);
    expect(heard(r.song)).toEqual(heard(song));
  });

  it("구간만 바꾸면 구간 처음·끝에 템포와 박자표를 넣고, 뒤의 음·템포·마커를 함께 당긴다", () => {
    const song = { ...songOf(["t120 c4d4 t300 e4f4g4a4 t120 b4"]), markers: [{ id: "m1", at: rat(3, 2), label: "끝" }] };
    const r = convertTempoResult(song, rat(1, 2), rat(1, 2), rat(3, 2));
    expect(r.failed).toEqual([]);
    expect(r.song.tempo).toEqual([{ at: rat(0), bpm: 120 }, { at: rat(1, 2), bpm: 150 }, { at: rat(1), bpm: 120 }]);
    expect(r.song.tracks[0]!.notes.map((n) => n.start)).toEqual([rat(0), rat(1, 4), rat(1, 2), rat(5, 8), rat(3, 4), rat(7, 8), rat(1)]);
    // 구간 처음·끝이 마디 가운데라 걸친 마디는 옮긴 길이(3/4)로 쓰고, 원래 다음 마디선(2 → 3/2)에서 4/4로 돌아온다
    expect(r.song.timeSig).toEqual([{ at: rat(0), beats: 3, unit: 4 }, { at: rat(3, 2), beats: 4, unit: 4 }]);
    expect(r.song.markers.map((m) => m.at)).toEqual([rat(1)]);
    expect(heard(r.song)).toEqual(heard(song));
  });

  it("구간 처음·끝이 마디 가운데여도 구간 안과 뒤의 마디선이 옮긴 음과 맞는다", () => {
    const song = songOf(["t300 c4d4e4f4 g4a4b4c4 d4e4f4g4"]);
    // 1마디의 둘째 박부터 2마디 둘째 박 앞까지
    const r = convertTempoResult(song, rat(1, 2), rat(1, 4), rat(5, 4));
    expect(r.failed).toEqual([]);
    // 걸친 두 마디는 옮긴 길이(1/4 + 3/8 = 5/8, 1/8 + 3/4 = 7/8)로 쓰고 원래 3마디(2 → 3/2)에서 4/4로 돌아온다
    expect(r.song.timeSig).toEqual([
      { at: rat(0), beats: 5, unit: 8 },
      { at: rat(5, 8), beats: 7, unit: 8 },
      { at: rat(3, 2), beats: 4, unit: 4 },
    ]);
    const bars = (s: Song) => s.tracks[0]!.notes.map((n) => [barAt(s.timeSig, n.start), cmp(measureStart(s.timeSig, n.start), n.start) === 0]);
    expect(bars(r.song)).toEqual(bars(song));
    expect(heard(r.song)).toEqual(heard(song));
  });

  it("걸친 마디 길이를 박자표로 쓸 수 없으면 그 자리에서 마디를 끊고 다음 마디선부터 다시 맞춘다", () => {
    // 구간 [1/64, 65/64): 1마디는 1/64 + 63/128, 2마디는 1/128 + 63/64가 되어 박자표로 쓸 수 없다. 거절하지 않는다
    const song = songOf(["t300 c64 d32e2f4g8a16b32 r2r4r8r16r32r64 c1"]);
    const r = convertTempoResult(song, rat(1, 2), rat(1, 64), rat(65, 64));
    expect(r.failed).toEqual([]);
    // 구간 처음·끝(1/64 → 1/64, 65/64 → 33/64)에서 마디를 끊고, 원래 마디선(1 → 65/128, 2 → 3/2)에서 다시 맞춘다
    expect(r.song.timeSig).toEqual([
      { at: rat(1, 64), beats: 4, unit: 8 },
      { at: rat(65, 128), beats: 4, unit: 8 },
      { at: rat(33, 64), beats: 4, unit: 4 },
      { at: rat(3, 2), beats: 4, unit: 4 },
    ]);
    // 원래 3마디 첫 음(2 → 3/2)이 다시 마디선 위에 온다 (끊은 두 자리만큼 마디 수가 늘었다)
    const last = r.song.tracks[0]!.notes.at(-1)!;
    expect(last.start).toEqual(rat(3, 2));
    expect(measureStart(r.song.timeSig, last.start)).toEqual(last.start);
    expect(barAt(r.song.timeSig, last.start)).toBe(barAt(song.timeSig, rat(2)) + 2);
    expect(heard(r.song)).toEqual(heard(song));
  });

  it("구간에 걸친 음은 구간 안 부분만 줄인다", () => {
    const song = songOf(["t120 c2 t300 d2"]);
    // c2의 뒤 반(1/4)만 구간 안: 1/4 + 1/8 = 점4분음표
    const r = convertTempoResult(song, rat(1, 2), rat(1, 4));
    expect(r.failed).toEqual([]);
    expect(r.song.tracks[0]!.notes.map((n) => [n.start, n.dur])).toEqual([
      [rat(0), rat(3, 8)],
      [rat(3, 8), rat(1, 4)],
    ]);
    expect(r.song.tempo).toEqual([{ at: rat(0), bpm: 120 }, { at: rat(1, 4), bpm: 60 }, { at: rat(3, 8), bpm: 150 }]);
    expect(heard(r.song)).toEqual(heard(song));
  });

  it("줄인 길이를 게임 음길이로 쓸 수 없으면(l64의 반) 곡을 바꾸지 않고 그 자리를 알린다", () => {
    const song = songOf(["t300 c4d64e4"]);
    const r = convertTempoResult(song, rat(1, 2));
    expect(r.song).toBe(song);
    expect(r.failed).toEqual([{ kind: "length", trackId: "t1", at: rat(1, 4), length: rat(1, 128), rest: false }]);
  });

  it("음 사이 쉼표도 쓸 수 있는지 본다", () => {
    const song = songOf(["t300 c4r64d4"]);
    const r = convertTempoResult(song, rat(1, 2));
    expect(r.failed).toEqual([{ kind: "length", trackId: "t1", at: rat(1, 4), length: rat(1, 128), rest: true }]);
  });

  it("바꾼 템포 자리가 쪼갤 수 없는 음 가운데라 게임 출력이 옮겨 쓰면 거절한다", () => {
    // c2를 1/96에서 나누면 앞 토막(l96)을 쓸 수 없다. 줄인 음 길이(49/192)는 & 이음으로 쓸 수 있다
    const song = songOf(["t300 c2"]);
    const r = convertTempoResult(song, rat(1, 2), rat(1, 96));
    expect(r.song).toBe(song);
    expect(r.failed).toEqual([{ kind: "tempo", at: rat(1, 96), bpm: 150 }]);
  });

  it("템포 × 배율이 정수가 아니면 반올림하고 알린다", () => {
    const r = convertTempoResult(songOf(["t301 c4"]), rat(1, 2));
    expect(r.failed).toEqual([]);
    expect(r.song.tempo).toEqual([{ at: rat(0), bpm: 151 }]);
    expect(r.rounded).toEqual([{ at: rat(0), bpm: 301, to: 151 }]);
  });

  it("구간 앞에서 끝난 트랙의 원문은 그대로 둔다", () => {
    const song = songOf(["t120 c4", "t120 c4d4 t300 e4f4"]);
    const r = convertTempoResult(song, rat(1, 2), rat(1, 2));
    expect(r.failed).toEqual([]);
    expect(r.song.tracks[0]).toBe(song.tracks[0]);
    expect(r.song.tracks[1]!.mml).toBeUndefined();
    expect(heard(r.song)).toEqual(heard(song));
  });

  it("원문 끝 쉼표로 지키던 트랙 길이도 함께 줄여 지킨다", () => {
    const song = songOf(["t300 c4d4", "c4r1r1"]);
    expect(textEnd(song.tracks[1]!.mml!)).toEqual(rat(5, 4));
    const r = convertTempoResult(song, rat(1, 2));
    expect(r.failed).toEqual([]);
    expect(textEnd(r.song.tracks[1]!.mml!)).toEqual(rat(5, 8));
  });

  it("구간 끝을 넘는 원문 끝 쉼표도 옮긴 자리까지 지키고, 새로 넣은 구간 끝 템포를 그 쉼표 사이에 적는다", () => {
    // t2는 템포를 적지 않고 끝 쉼표로 5/4까지 간다. 구간 [0, 1/2)만 반으로 줄이면 끝은 1이고, 1/4에 t300이 새로 생긴다
    const song = songOf(["t300 c4d4", "c4r1r1"]);
    const r = convertTempoResult(song, rat(1, 2), rat(0), rat(1, 2));
    expect(r.failed).toEqual([]);
    expect(textEnd(r.song.tracks[1]!.mml!)).toEqual(rat(1));
    expect(parseMml(r.song.tracks[1]!.mml!.text).tempo.map((e) => [e.at, e.bpm])).toContainEqual([rat(1, 4), 300]);
    expect(heard(r.song)).toEqual(heard(song));
  });

  it("마디 길이를 바꿔 쓸 수 없는 박자표면 거절한다 (3/32의 반)", () => {
    const song = { ...songOf(["t300 c4"]), timeSig: [{ at: rat(0), beats: 3, unit: 32 }] };
    const r = convertTempoResult(song, rat(1, 2));
    expect(r.song).toBe(song);
    expect(r.failed).toEqual([{ kind: "meter", at: rat(0), beats: 3, unit: 32 }]);
    // 분모를 못 바꾸면 분자를 바꾼다: 4/32의 반 = 2/32
    const ok = convertTempoResult({ ...song, timeSig: [{ at: rat(0), beats: 4, unit: 32 }] }, rat(1, 2));
    expect(ok.song.timeSig).toEqual([{ at: rat(0), beats: 2, unit: 32 }]);
  });

  it("만든 기록의 음도 같은 자리로 옮긴다", () => {
    const base = songOf(["t300 c4d4"]);
    const [c, d] = base.tracks[0]!.notes;
    const song: Song = { ...base, made: [{ id: "r1", tool: "trill", options: {}, picked: [d!.id], before: [{ trackId: "t1", notes: [d!] }], after: [{ trackId: "t1", notes: [c!, d!] }] }] };
    const r = convertTempoResult(song, rat(1, 2));
    expect(r.song.made![0]!.before[0]!.notes.map((n) => [n.start, n.dur])).toEqual([[rat(1, 8), rat(1, 8)]]);
    expect(r.song.made![0]!.after[0]!.notes.map((n) => n.start)).toEqual([rat(0), rat(1, 8)]);
  });

  it("배율 1이거나 바꿀 음이 없으면 곡을 그대로 돌려준다", () => {
    const song = songOf(["t300 c4"]);
    expect(convertTempoResult(song, rat(1)).song).toBe(song);
    expect(convertTempoResult(song, rat(1, 2), rat(1)).song).toBe(song);
  });

  it("명령은 실행 취소 한 칸으로 되돌린다", () => {
    const song = songOf(["t300 c4d4"]);
    const command = convertTempo(rat(1, 2));
    const next = command.apply(song);
    expect(next.tempo).toEqual([{ at: rat(0), bpm: 150 }]);
    expect(command.invert(song).apply(next)).toEqual(song);
  });

  it("바꾼 뒤 게임 출력이 쓰지 못하고 버리는 템포가 새로 생기면 거절한다 (Codex 지적)", () => {
    // c32 가운데(1/64)의 t120은 지금 c를 &로 쪼개 쓰지만, 앞 구간을 반으로 줄이면 1/128 자리라 쪼갤 수 없고
    // 옮길 자리(c 끝)에 t240이 와서 출력이 t120을 버린다. 첫 음이 짧게 들리므로 바꾸지 않는다
    const song = { ...songOf(["c32d64"]), tempo: [{ at: rat(0), bpm: 300 }, { at: rat(1, 64), bpm: 120 }, { at: rat(1, 32), bpm: 240 }] };
    expect(gameScores(song, songChordsPerScore(song))[0]!.text).toContain("t120");
    const r = convertTempoResult(song, rat(1, 2), rat(0), rat(1, 64));
    expect(r.failed).toEqual([{ kind: "tempo", at: rat(1, 64), bpm: 120 }]);
    expect(r.song).toBe(song);
  });

  it("한 음 안에 붙은 템포 둘 사이 틈을 출력이 쓰지 못하면 거절한다 (Codex 두 번째 지적)", () => {
    // c16 안 1/64 t300·1/32 t120: 그 구간을 반으로 줄이면 두 템포 사이가 1/128이라 출력이 t를 이어 써 틈을 잃고
    // 뒤 d가 늦게(3/32초가 아니라 17/160초에) 들려야 할 것이 일찍 들린다
    const song = { ...songOf(["c16d16"]), tempo: [{ at: rat(0), bpm: 120 }, { at: rat(1, 64), bpm: 300 }, { at: rat(1, 32), bpm: 120 }] };
    const r = convertTempoResult(song, rat(1, 2), rat(1, 64), rat(1, 32));
    expect(r.failed).toEqual([{ kind: "tempo", at: rat(1, 64), bpm: 150 }]);
    expect(r.song).toBe(song);
  });

  it("거절하지 않은 변환은 게임 출력을 다시 읽은 시각이 바꾸기 전과 같다", () => {
    const song = songOf(["t300l8cdefgab>c<b"]);
    const r = convertTempoResult(song, rat(1, 2));
    expect(r.failed).toEqual([]);
    expect(heard(r.song)).toEqual(heard(song));
  });

  it("다른 트랙에 이미 있던 출력 어긋남이 새로 어긋난 음을 가리지 않는다 (Codex 다섯 번째 지적)", () => {
    // 첫 연주자 트랙은 MML로 쓸 수 없는 높이(MIDI 0)라 바꾸기 전부터 같은 자리에서 어긋난다
    const base = songOf(["c16d16", "c16d16"]);
    const { mml: _mml, ...first } = base.tracks[0]!;
    const low = { ...first, notes: first.notes.map((n) => ({ ...n, pitch: 0 })) };
    const song = { ...base, tracks: [low, base.tracks[1]!], tempo: [{ at: rat(0), bpm: 120 }, { at: rat(1, 64), bpm: 300 }, { at: rat(1, 32), bpm: 120 }] };
    const r = convertTempoResult(song, rat(1, 2), rat(1, 64), rat(1, 32));
    expect(r.failed).toEqual([{ kind: "tempo", at: rat(1, 64), bpm: 150 }]);
    expect(r.song).toBe(song);
  });
});
