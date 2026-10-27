import { describe, expect, it } from "vitest";
import { MOBILE_PROFILE, toFloat, type Song } from "@mmlce/core";
import { newSong, parseTrackText } from "@mmlce/mml";
import { compareLoudness, computePower } from "../src/lib/loudnessCompare";
import { alignKey, alignTempo, referenceFeatures, songFeatures } from "../src/lib/tempoAlign";

function song(text: string): Song {
  const s = newSong({ playerName: "피아노", trackName: "트랙 1" });
  return { ...s, tracks: s.tracks.map(({ mml: _mml, ...t }) => ({ ...t, notes: parseTrackText(t.id, { text }).notes })) };
}

const RATE = 22050;

/**
 * 곡 음표를 배음 셋 사인파로 합성한 원곡. 곡 시각 t의 음은 원곡 at(t)초에 친다 (템포 흔들림 흉내).
 * gainOf로 음마다 세기를 정한다
 */
function render(s: Song, at: (t: number) => number, seconds: number, gainOf: (t: number) => number = () => 0.2): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  const spb = 0.5; // t120 4분음표 0.5초
  for (const n of s.tracks[0]!.notes) {
    const t = toFloat(n.start) * 4 * spb;
    const on = at(t);
    const len = Math.max(0.1, at(t + toFloat(n.dur) * 4 * spb) - on);
    const f = 440 * 2 ** ((n.pitch - 69) / 12);
    const g = gainOf(t);
    const a = Math.round(on * RATE);
    for (let i = 0; i < Math.round((len + 0.3) * RATE) && a + i < out.length; i++) {
      const x = i / RATE;
      const env = Math.exp(-x / 0.5) * (x > len ? Math.exp(-(x - len) / 0.05) : 1);
      out[a + i]! += g * env * (Math.sin(2 * Math.PI * f * x) + 0.5 * Math.sin(4 * Math.PI * f * x) + 0.3 * Math.sin(6 * Math.PI * f * x));
    }
  }
  return out;
}

// 높이가 고루 바뀌는 16마디 선율 (t120, 마디 2초)
const melody = "o4 l8 v10 " + "cegb>c<agf edcd efga gfed c4e4 g4>c4 <bagf edc<b> ".repeat(4);

describe("템포 자동 맞추기", () => {
  it("원곡이 중간에 늦어졌다 돌아와도 곡 시각마다 원곡 자리를 찾는다", () => {
    const s = song(melody);
    // 8초까지 그대로, 12초까지 1초 늦어짐, 20초부터 24초까지 0.4초로 돌아옴. 원곡은 1.5초 앞에 빈 소리
    const drift = (t: number) => (t < 8 ? 0 : t < 12 ? (t - 8) / 4 : t < 20 ? 1 : t < 24 ? 1 - ((t - 20) / 4) * 0.6 : 0.4);
    const at = (t: number) => t + 1.5 + drift(t);
    const audio = render(s, at, 36);
    const a = alignTempo(songFeatures(s), referenceFeatures([audio], RATE), 1.5)!;
    expect(a).toBeDefined();
    for (const t of [2, 6, 10, 14, 18, 22, 26, 30]) expect(Math.abs(a.warp(t) - at(t))).toBeLessThan(0.08);
    expect(a.alignedScore).toBeGreaterThan(a.plainScore);
  });

  it("흔들림이 없으면 시작 자리 그대로", () => {
    const s = song(melody);
    const audio = render(s, (t) => t + 0.7, 34);
    const a = alignTempo(songFeatures(s), referenceFeatures([audio], RATE), 0.7)!;
    for (const t of [1, 9, 17, 25]) expect(Math.abs(a.warp(t) - (t + 0.7))).toBeLessThan(0.08);
  });

  it("맞춘 시각으로 원곡 세기를 읽어, 시작 자리만 맞출 때보다 원곡 모양을 잘 찾는다", () => {
    const s = song(melody);
    // 6초부터 원곡이 1.2초 늦고, 8마디(14-16초)만 크게 친다
    const at = (t: number) => t + (t < 6 ? 0 : t < 8 ? ((t - 6) / 2) * 1.2 : 1.2);
    const loud = (t: number) => (t >= 14 && t < 16 ? 0.6 : 0.15);
    const audio = render(s, at, 36, loud);
    const power = computePower([audio], RATE);
    const a = alignTempo(songFeatures(s), referenceFeatures([audio], RATE), 0)!;
    const auto = compareLoudness(s, power, 0, MOBILE_PROFILE, undefined, a.warp);
    const plain = compareLoudness(s, power, 0, MOBILE_PROFILE);
    const bar8 = (r: typeof auto) => r.bars.find((b) => b.bar === 8)!;
    expect(bar8(auto).diff).toBeGreaterThan(3);
    expect(bar8(auto).diff).toBeGreaterThan(bar8(plain).diff);
    // 어긋남: 8마디(14초)에서 원곡이 1.2초 늦다
    expect(bar8(auto).drift).toBeCloseTo(1.2, 0);
    expect(bar8(plain).drift).toBe(0);
  });

  it("v만 고치면 맞춤 열쇠가 같고, 음 자리를 고치면 달라진다", () => {
    const a = song("o4 l4 v8 cdef");
    const b = song("o4 l4 v12 cdef");
    const c = song("o4 l4 v8 cdeg");
    expect(alignKey(a)).toBe(alignKey(b));
    expect(alignKey(a)).not.toBe(alignKey(c));
  });

  it("평평한 소리(어디나 같은 비용)에서는 어긋남 없이 시작 자리 그대로", () => {
    const flat = (frames: number) => {
      const chroma = new Float32Array(frames * 12);
      for (let f = 0; f < frames; f++) chroma[f * 12] = 1;
      return { frames, chroma, onset: new Float32Array(frames) };
    };
    const a = alignTempo(flat(500), flat(500), 0)!;
    expect(a.warp(10)).toBeCloseTo(10, 5);
    expect(a.warp(24.95)).toBeCloseTo(24.95, 5);
  });

  it("소리가 너무 짧으면 맞추지 않는다", () => {
    expect(alignTempo(songFeatures(song("o4 c64")), referenceFeatures([new Float32Array(100)], RATE), 0)).toBeUndefined();
  });
});
