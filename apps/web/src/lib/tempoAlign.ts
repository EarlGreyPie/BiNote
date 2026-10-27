import { add, positionToSeconds, tieChains, type Song } from "@mmlce/core";

/**
 * 원곡 대조의 템포 자동 맞추기: 곡 시각마다 원곡에서 같은 자리가 몇 초인지 찾는다.
 * 원곡 소리에서 뽑은 음이름 세기(크로마)·소리 시작 세기(온셋)와 곡 음표로 만든 같은 모양을 DTW로 맞춘다.
 * 원곡 어긋남(시작 자리) 둘레 ±MAX_DRIFT_SECONDS 띠 안에서만 찾고, 한 자리에서 원곡이 곡보다 두 배 넘게 빠르거나 느려지지는 않는다고 본다.
 * 소리를 다시 만들지 않고 음표에서 바로 모양을 만들어서 곡을 고칠 때마다 다시 맞춰도 가볍다
 */

/** 한 칸 길이 (초). 20칸/초 */
export const HOP_SECONDS = 0.05;
/** 원곡 어긋남 둘레로 이만큼(초)까지 앞뒤로 흔들려도 따라간다 */
export const MAX_DRIFT_SECONDS = 10;
/** 맞춘 길을 이만큼(초) 창으로 고르게 편다 (한두 칸 튀는 것 막기) */
export const SMOOTH_SECONDS = 1;
/** 크로마 차이에 더하는 온셋 차이의 무게 */
const ONSET_WEIGHT = 0.5;
/** 곡 음표로 크로마를 만들 때 음이 줄어드는 빠르기 (초) */
const NOTE_DECAY_SECONDS = 1;
/**
 * 빨라짐·느려짐 걸음과 시작 자리를 시작 자리(어긋남 0)에서 옮길 때마다 더하는 작은 값.
 * 비용이 같은 길(일정한 음·되풀이 구간·소리 없는 곳)에서는 어긋남 없이 곧게 가게 한다
 */
const STEP_PENALTY = 0.01;
/** 원곡을 이 빠르기 가까이로 줄여 FFT한다 (Hz) */
const ANALYSIS_RATE = 11025;
const FFT_SIZE = 2048;
/** 크로마에 넣는 주파수 범위 (Hz) */
const MIN_HZ = 70;
const MAX_HZ = 4200;

/** 칸마다 12음이름 세기(길이 1로 맞춤)와 소리 시작 세기(0-1) */
export interface AlignFeatures {
  readonly frames: number;
  /** frames × 12 */
  readonly chroma: Float32Array;
  readonly onset: Float32Array;
}

export interface TempoAlignment {
  /** 곡 시각(초) → 원곡 시각(초) */
  readonly warp: (songSeconds: number) => number;
  /** 맞는 정도 (칸 평균 1 − 차이, 높을수록 잘 맞음): 시작 자리만 맞췄을 때와 자동 맞춤 뒤 */
  readonly plainScore: number;
  readonly alignedScore: number;
}

/** 크기 n(2의 거듭제곱)인 복소 FFT (제자리) */
function fft(re: Float32Array, im: Float32Array, cos: Float32Array, sin: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step]!;
        const s = sin[k * step]!;
        const a = i + k;
        const b = a + half;
        const tr = re[b]! * c + im[b]! * s;
        const ti = im[b]! * c - re[b]! * s;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

/** 칸마다 크로마를 길이 1로, 온셋을 0-1로 맞춘다 */
function normalize(chroma: Float32Array, onset: Float32Array): void {
  const frames = onset.length;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let p = 0; p < 12; p++) sum += chroma[f * 12 + p]! ** 2;
    const norm = Math.sqrt(sum);
    if (norm > 1e-9) for (let p = 0; p < 12; p++) chroma[f * 12 + p]! /= norm;
  }
  // 크게 튄 몇 칸에 끌려가지 않게 95번째 백분위로 나누고 1에서 자른다
  const sorted = Float32Array.from(onset).sort();
  const top = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  for (let f = 0; f < frames; f++) onset[f] = top > 0 ? Math.min(1, onset[f]! / top) : 0;
}

/** 원곡 소리에서 크로마·온셋을 뽑는다 (원곡을 불러온 뒤 한 번) */
export function referenceFeatures(channels: readonly Float32Array[], sampleRate: number): AlignFeatures {
  const factor = Math.max(1, Math.round(sampleRate / ANALYSIS_RATE));
  const rate = sampleRate / factor;
  const length = Math.floor((channels[0]?.length ?? 0) / factor);
  // 모노로 섞으며 factor칸씩 평균 내어 줄인다
  const mono = new Float32Array(length);
  const n = Math.max(1, channels.length);
  for (let i = 0; i < length; i++) {
    let x = 0;
    for (const ch of channels) for (let k = 0; k < factor; k++) x += ch[i * factor + k]!;
    mono[i] = x / n / factor;
  }
  const hop = rate * HOP_SECONDS;
  const frames = Math.max(0, Math.ceil(length / hop));
  const chroma = new Float32Array(frames * 12);
  const onset = new Float32Array(frames);
  const cos = new Float32Array(FFT_SIZE / 2);
  const sin = new Float32Array(FFT_SIZE / 2);
  for (let k = 0; k < FFT_SIZE / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / FFT_SIZE);
    sin[k] = Math.sin((2 * Math.PI * k) / FFT_SIZE);
  }
  const window = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
  const lo = Math.max(1, Math.floor((MIN_HZ * FFT_SIZE) / rate));
  const hi = Math.min(FFT_SIZE / 2 - 1, Math.ceil((MAX_HZ * FFT_SIZE) / rate));
  const pcOf = new Int8Array(hi + 1);
  for (let k = lo; k <= hi; k++) pcOf[k] = ((Math.round(69 + 12 * Math.log2((k * rate) / FFT_SIZE / 440)) % 12) + 12) % 12;
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  let prev = new Float32Array(hi + 1);
  let cur = new Float32Array(hi + 1);
  const flux = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    // 칸 f의 가운데가 f × HOP_SECONDS가 되게 창을 놓는다
    const from = Math.round(f * hop) - FFT_SIZE / 2;
    for (let i = 0; i < FFT_SIZE; i++) {
      const at = from + i;
      re[i] = at >= 0 && at < length ? mono[at]! * window[i]! : 0;
      im[i] = 0;
    }
    fft(re, im, cos, sin);
    let rise = 0;
    for (let k = lo; k <= hi; k++) {
      const mag = Math.sqrt(re[k]! ** 2 + im[k]! ** 2);
      chroma[f * 12 + pcOf[k]!]! += mag;
      cur[k] = Math.log1p(mag);
      if (f > 0) rise += Math.max(0, cur[k]! - prev[k]!);
    }
    flux[f] = rise;
    [prev, cur] = [cur, prev];
  }
  // 소리 시작 세기: 둘레 0.5초 평균보다 솟은 만큼
  const half = Math.round(0.25 / HOP_SECONDS);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    let count = 0;
    for (let g = Math.max(0, f - half); g <= Math.min(frames - 1, f + half); g++, count++) sum += flux[g]!;
    onset[f] = Math.max(0, flux[f]! - sum / count);
  }
  normalize(chroma, onset);
  return { frames, chroma, onset };
}

/**
 * 곡 음표로 같은 모양을 만든다. 음마다 음이름(배음 2·4배는 같은 음이름, 3배는 완전5도, 5배는 장3도로 조금)에 세기를 주고 줄어들게 한다.
 * v는 보지 않는다 (볼륨을 고쳐도 맞춤이 그대로이게)
 */
export function songFeatures(song: Song): AlignFeatures {
  const hits: { on: number; off: number; pc: number }[] = [];
  let end = 0;
  for (const track of song.tracks) {
    for (const chain of tieChains(track.notes)) {
      const first = chain[0]!;
      const last = chain[chain.length - 1]!;
      const on = positionToSeconds(song.tempo, first.start);
      const off = positionToSeconds(song.tempo, add(last.start, last.dur));
      hits.push({ on, off, pc: ((first.pitch % 12) + 12) % 12 });
      if (off > end) end = off;
    }
  }
  const frames = Math.ceil(end / HOP_SECONDS) + 1;
  const chroma = new Float32Array(frames * 12);
  const onset = new Float32Array(frames);
  const partials: readonly (readonly [number, number])[] = [
    [0, 1.75],
    [7, 0.33],
    [4, 0.2],
  ];
  for (const h of hits) {
    const a = Math.max(0, Math.round(h.on / HOP_SECONDS));
    const b = Math.min(frames - 1, Math.round(h.off / HOP_SECONDS));
    for (let f = a; f <= b; f++) {
      const w = Math.exp(-(f * HOP_SECONDS - h.on) / NOTE_DECAY_SECONDS);
      for (const [shift, gain] of partials) chroma[f * 12 + ((h.pc + shift) % 12)]! += w * gain;
    }
    // 한 칸 앞뒤로 조금 퍼뜨려 원곡의 칸 어긋남을 견딘다
    if (a < frames) onset[a]! += 1;
    if (a + 1 < frames) onset[a + 1]! += 0.5;
    if (a > 0) onset[a - 1]! += 0.5;
  }
  for (let f = 0; f < frames; f++) onset[f] = Math.sqrt(onset[f]!);
  normalize(chroma, onset);
  return { frames, chroma, onset };
}

function cost(s: AlignFeatures, r: AlignFeatures, i: number, j: number): number {
  let dot = 0;
  for (let p = 0; p < 12; p++) dot += s.chroma[i * 12 + p]! * r.chroma[j * 12 + p]!;
  return 1 - dot + ONSET_WEIGHT * Math.abs(s.onset[i]! - r.onset[j]!);
}

/**
 * 곡과 원곡을 맞춘다. offsetSec: 원곡 시각 = 곡 시각 + offsetSec (지금 맞춰 둔 시작 자리).
 * 맞출 칸이 모자라면 undefined (그때는 시작 자리만 쓴다)
 */
export function alignTempo(song: AlignFeatures, ref: AlignFeatures, offsetSec: number): TempoAlignment | undefined {
  const n = song.frames;
  const m = ref.frames;
  const off = Math.round(offsetSec / HOP_SECONDS);
  const band = Math.round(MAX_DRIFT_SECONDS / HOP_SECONDS);
  const width = 2 * band + 1;
  if (n < 3 || m < 3) return undefined;
  // 칸 (i, j)는 줄 i의 band + j − (i + off) 자리. 띠 밖·원곡 밖은 Infinity
  const total = new Float32Array(n * width).fill(Infinity);
  // 0: (i−1, j−1), 1: (i−1, j−2) 원곡이 빨라짐, 2: (i−2, j−1) 원곡이 느려짐
  const from = new Uint8Array(n * width);
  const cell = (i: number, d: number) => i * width + d;
  const local = new Float32Array(width);
  const prevLocal = new Float32Array(width);
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < width; d++) {
      const j = i + off + d - band;
      local[d] = j >= 0 && j < m ? cost(song, ref, i, j) : Infinity;
    }
    for (let d = 0; d < width; d++) {
      const c = local[d]!;
      if (c === Infinity) continue;
      if (i === 0) {
        // 시작은 띠 안 어디서나 (시작 자리에서 멀수록 조금 비싸게)
        total[cell(0, d)] = c + STEP_PENALTY * Math.abs(d - band);
        continue;
      }
      let best = total[cell(i - 1, d)]! + c;
      let how = 0;
      if (d > 0 && local[d - 1]! < Infinity) {
        const v = total[cell(i - 1, d - 1)]! + local[d - 1]! + c + STEP_PENALTY;
        if (v < best) [best, how] = [v, 1];
      }
      if (i >= 2 && d + 1 < width) {
        const v = total[cell(i - 2, d + 1)]! + prevLocal[d + 1]! + c + STEP_PENALTY;
        if (v < best) [best, how] = [v, 2];
      }
      total[cell(i, d)] = best;
      from[cell(i, d)] = how;
    }
    prevLocal.set(local);
  }
  // 끝도 띠 안 어디서나 가장 싼 곳
  let d = -1;
  let bestEnd = Infinity;
  for (let k = 0; k < width; k++) {
    const v = total[cell(n - 1, k)]!;
    if (v < bestEnd) [bestEnd, d] = [v, k];
  }
  if (d < 0) return undefined;
  // 거슬러 올라가며 칸마다 어긋남(칸) 기록. (i−2, j−1) 걸음은 사이 칸을 반 칸으로 메운다
  const drift = new Float32Array(n);
  let alignedCost = 0;
  for (let i = n - 1; i >= 0; ) {
    drift[i] = d - band;
    alignedCost += cost(song, ref, i, i + off + d - band);
    if (i === 0) break;
    const how = from[cell(i, d)]!;
    if (how === 0) i -= 1;
    else if (how === 1) {
      i -= 1;
      d -= 1;
    } else {
      drift[i - 1] = d - band + 0.5;
      alignedCost += cost(song, ref, i - 1, Math.min(m - 1, i - 1 + off + d - band + 1));
      i -= 2;
      d += 1;
    }
  }
  let plainCost = 0;
  let plainCount = 0;
  for (let i = 0; i < n; i++) {
    const j = i + off;
    if (j < 0 || j >= m) continue;
    plainCost += cost(song, ref, i, j);
    plainCount++;
  }
  // 고르게 펴기 (이동 평균)
  const half = Math.round(SMOOTH_SECONDS / 2 / HOP_SECONDS);
  const smooth = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < Math.min(n, half); i++) sum += drift[i]!;
  for (let i = 0; i < n; i++) {
    if (i + half < n) sum += drift[i + half]!;
    if (i - half - 1 >= 0) sum -= drift[i - half - 1]!;
    const count = Math.min(n - 1, i + half) - Math.max(0, i - half) + 1;
    smooth[i] = sum / count;
  }
  const warp = (t: number): number => {
    const x = t / HOP_SECONDS;
    const i = Math.max(0, Math.min(n - 1, Math.floor(x)));
    const k = Math.min(n - 1, i + 1);
    const frac = Math.max(0, Math.min(1, x - i));
    const dr = smooth[i]! + (smooth[k]! - smooth[i]!) * frac;
    return t + offsetSec + dr * HOP_SECONDS;
  };
  // 비용 한 칸은 0(꼭 같음)-1.5. 1 − 평균을 맞는 정도로 본다
  return { warp, plainScore: plainCount > 0 ? 1 - plainCost / plainCount : 0, alignedScore: 1 - alignedCost / n };
}

/** 맞춤에 쓰는 것(템포·음 높이·자리·길이·&)만 담은 열쇠. v만 고쳤으면 같아서 다시 맞추지 않는다 */
export function alignKey(song: Song): string {
  return JSON.stringify([song.tempo, song.tracks.map((tr) => tr.notes.map((n) => [n.start, n.dur, n.pitch, n.tie]))]);
}
