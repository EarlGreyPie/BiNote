import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, type Song } from "@mmlce/core";
import { newSong, parseTrackText } from "@mmlce/mml";
import { computePower } from "../src/lib/loudnessCompare";
import { fitGuide, guideOnsets } from "../src/lib/loudnessGuide";
import { computePeaks } from "../src/lib/waveform";

/** 피아노 한 트랙 곡 (t120이라 4분음표 = 0.5초) */
function song(text: string): Song {
  const s = newSong({ playerName: "피아노", trackName: "트랙 1" });
  return { ...s, tracks: s.tracks.map(({ mml: _mml, ...t }) => ({ ...t, notes: parseTrackText(t.id, { text }).notes })) };
}

const RATE = 8000;

/** 세기를 아는 클릭 열: at초마다 amp 크기로 시작해 줄어드는 사인 (원곡 대신 쓰는 합성 독주 녹음) */
function clicks(hits: readonly { at: number; amp: number }[], seconds: number, lead = 0): Float32Array {
  const x = new Float32Array(Math.round(seconds * RATE));
  for (const h of hits) {
    const from = Math.round((h.at + lead) * RATE);
    for (let i = 0; i < 0.3 * RATE && from + i < x.length; i++) x[from + i]! += h.amp * Math.exp(-i / (0.08 * RATE)) * Math.sin((2 * Math.PI * 440 * i) / RATE);
  }
  return x;
}

function analyse(s: Song, signal: Float32Array, offset = 0) {
  return guideOnsets(s, computePower([signal], RATE), computePeaks([signal], RATE), offset, MOBILE_PROFILE);
}

describe("음량 레인 원곡 세기 안내선", () => {
  // 평평한 v8 여덟 음, 원곡은 점점 세게
  const flat = song("o4 l4 v8 cdefgabc");
  // 가장 여린 음도 곡에서 가장 센 소리의 8% 넘게 (onsetNear가 시작점으로 보는 문턱)
  const amps = [0.2, 0.25, 0.3, 0.38, 0.47, 0.58, 0.72, 0.9];
  const rising = clicks(
    amps.map((amp, i) => ({ at: i * 0.5, amp })),
    5,
  );

  it("원곡이 점점 세지면 목표 v도 순서대로 커진다", () => {
    const onsets = analyse(flat, rising);
    expect(onsets).toHaveLength(8);
    for (let i = 1; i < onsets.length; i++) expect(onsets[i]!.refDb).toBeGreaterThan(onsets[i - 1]!.refDb);
    const fit = fitGuide(onsets, MOBILE_PROFILE, [0, 100]);
    expect(fit.count).toBe(8);
    const ids = flat.tracks[0]!.notes.map((n) => n.id);
    const v = ids.map((id) => fit.targets.get(id)!);
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeGreaterThanOrEqual(v[i - 1]!);
    expect(v[0]!).toBeLessThan(8);
    expect(v[7]!).toBeGreaterThan(8);
  });

  it("원곡을 그대로 따르는 곡은 목표가 지금 v와 거의 같다", () => {
    // v를 원곡 세기 순서대로 이미 키워 둔 곡: 목표와 지금 차가 작다
    const shaped = song("o4 l4 v4 c v5 d v6 e v7 f v8 g v9 a v10 b v11 c");
    const fit = fitGuide(analyse(shaped, rising), MOBILE_PROFILE, [0, 100]);
    expect(fit.corr).toBeGreaterThan(0.9);
    shaped.tracks[0]!.notes.forEach((n) => expect(Math.abs(fit.targets.get(n.id)! - n.vol)).toBeLessThanOrEqual(2));
  });

  it("원곡 시작점이 없는 음은 빼고, 붙임줄로 이어 받은 음은 세지 않는다", () => {
    const s = song("o4 l4 v8 cdef&fgab");
    // 넷째·다섯째 자리(& 로 이어진 f)에만 클릭이 없다고 해도 이어 받은 음은 원래 자리가 없다
    const hits = [0, 1, 2, 3, 5, 6, 7].map((i) => ({ at: i * 0.5, amp: 0.2 }));
    const sig = clicks(hits, 5);
    const onsets = analyse(s, sig);
    // 음 시작 자리 7곳 (f&f는 한 번), 모두 클릭이 있다
    expect(onsets).toHaveLength(7);
    // 클릭 하나를 지우면 그 자리는 빠진다
    const fewer = clicks(hits.filter((_, i) => i !== 2), 5);
    expect(analyse(s, fewer)).toHaveLength(6);
  });

  it("원곡 어긋남만큼 옮겨 찾고, 어긋남이 틀리면 찾지 못한다", () => {
    const late = clicks(
      amps.map((amp, i) => ({ at: i * 0.5, amp })),
      6,
      0.7,
    );
    expect(analyse(flat, late, 0.7)).toHaveLength(8);
    expect(analyse(flat, late, 0)).toHaveLength(0);
  });

  it("구간 안 음 시작이 셋보다 적으면 안내선이 없다", () => {
    const fit = fitGuide(analyse(flat, rising), MOBILE_PROFILE, [0, 0.5]);
    expect(fit.count).toBe(2);
    expect(fit.targets.size).toBe(0);
  });

  it("구간 밖 음에는 목표를 달지 않는다 (보이는 범위 / 반복 구간마다 따로 맞춘다)", () => {
    const fit = fitGuide(analyse(flat, rising), MOBILE_PROFILE, [1, 2]);
    expect(fit.count).toBe(4);
    const ids = flat.tracks[0]!.notes.map((n) => n.id);
    expect(fit.targets.has(ids[0]!)).toBe(false);
    expect(fit.targets.has(ids[4]!)).toBe(true);
  });
});
