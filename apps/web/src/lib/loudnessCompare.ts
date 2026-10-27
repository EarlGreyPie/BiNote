import {
  add,
  chainVolumes,
  cmp,
  dbOfVolume,
  meterGrid,
  positionToSeconds,
  tieChains,
  toFloat,
  volumeForDb,
  ZERO,
  type GameProfile,
  type Rat,
  type Song,
} from "@mmlce/core";

/**
 * 원곡 대조 셈여림 (실험실, 보기만): 마디마다 원곡이 얼마나 큰지와 지금 곡이 게임에서 얼마나 크게 날지를 견주어,
 * 원곡의 부풀고 가라앉는 모양을 따라가려면 몇 dB(몇 v)가 모자라거나 남는지 보여 준다. 곡은 바꾸지 않는다.
 * 섞인 녹음에서는 음 하나하나 세기를 뽑을 수 없어 마디 단위로만 본다
 */

/** 원곡 소리 세기 요약: 1초를 perSecond 칸으로 나눈 칸마다 모노로 섞은 값의 평균 제곱(전력) */
export interface ReferencePower {
  readonly perSecond: number;
  readonly power: Float32Array;
}

/** 계산 크기 모형 (썸데이 게임 녹음과 마디별 r 0.96으로 맞춘 값). 게임 한도가 아니라 추정 모형의 값이다 */
export const DECAY_SECONDS = 0.6;
/** 음(& 사슬) 끝 뒤 이만큼 더 울리고 끊는다 */
export const RELEASE_SECONDS = 0.15;
/** 지금 곡이 거의 평평해(마디별 폭 sd가 이보다 작아) 폭을 맞출 수 없을 때 원곡 폭을 이만큼(dB, sd)으로 줄여 본다 */
export const MIN_SPREAD_DB = 2.5;
/** 이만큼(dB) 이상 차이 나는 마디에만 v 제안을 단다 */
export const SUGGEST_DB = 3;

export interface BarLoudness {
  /** 마디 번호 (1부터) */
  readonly bar: number;
  readonly start: Rat;
  /** 다음 마디 시작 (마지막 마디는 곡 끝) */
  readonly end: Rat;
  /** 마디 시작의 곡 시각(초)과 원곡 시각(초) */
  readonly seconds: number;
  readonly refSeconds: number;
  /** 템포 자동 맞추기로 찾은 원곡 시각 − (곡 시각 + 원곡 어긋남) (초). +면 원곡이 그만큼 늦다. 자동 맞추기를 끄면 0 */
  readonly drift: number;
  /** 지금 곡의 계산 크기 (dB) */
  readonly current: number;
  /** 원곡 크기를 계산 크기와 같은 평균·폭으로 맞춘 값 (dB) = 목표 */
  readonly target: number;
  /** 목표 − 지금 (dB). +면 원곡을 따르려면 더 커야 한다 */
  readonly diff: number;
  /** 제안의 기준 v (그 마디에서 시작하는 멜로디 음의 평균 v, 멜로디 음이 없으면 모든 음) */
  readonly baseVol: number;
  /** |diff| ≥ SUGGEST_DB일 때 기준 v에서 몇 v 바꾸면 되는지 (볼륨 곡선으로 역산) */
  readonly suggest?: number;
}

export interface LoudnessCompare {
  readonly bars: readonly BarLoudness[];
  /** 마디별 / 4마디 묶음 상관 (원곡 대 지금). 셀 수 없으면 undefined */
  readonly corrBar: number | undefined;
  readonly corr4: number | undefined;
  /** 음이 하나도 시작하지 않거나 원곡 밖이라 뺀 마디 수 (구간 안에서) */
  readonly skipped: number;
}

/** 디코딩한 채널들에서 전력 요약을 만든다 (원곡을 불러온 뒤 한 번) */
export function computePower(channels: readonly Float32Array[], sampleRate: number, perSecond = 100): ReferencePower {
  const length = channels[0]?.length ?? 0;
  const span = sampleRate / perSecond;
  const count = Math.ceil(length / span);
  const power = new Float32Array(count);
  const n = Math.max(1, channels.length);
  for (let b = 0; b < count; b++) {
    const from = Math.floor(b * span);
    const to = Math.min(length, Math.floor((b + 1) * span));
    let sum = 0;
    for (let i = from; i < to; i++) {
      let x = 0;
      for (const ch of channels) x += ch[i]!;
      x /= n;
      sum += x * x;
    }
    power[b] = to > from ? sum / (to - from) : 0;
  }
  return { perSecond, power };
}

/** 마디 시작 위치들 (end 앞까지). 곡 중간에 박자가 바뀌면 그 자리에서 새 마디. 박자표가 없으면 4/4 */
export function barStarts(timeSig: Song["timeSig"], end: Rat): Rat[] {
  const sigs = [...timeSig].sort((a, b) => cmp(a.at, b.at));
  const segments = sigs.length === 0 || cmp(sigs[0]!.at, ZERO) > 0 ? [{ at: ZERO, beats: 4, unit: 4 }, ...sigs] : sigs;
  const out: Rat[] = [];
  segments.forEach((sig, i) => {
    const next = segments[i + 1]?.at;
    const { measure } = meterGrid(sig);
    for (let pos = sig.at; (!next || cmp(pos, next) < 0) && cmp(pos, end) < 0; pos = add(pos, measure)) out.push(pos);
  });
  return out;
}

/** 원곡 [from, to)초의 평균 전력. 원곡 밖으로 한 칸 넘게 벗어나면 undefined */
function referenceMean(ref: ReferencePower, from: number, to: number): number | undefined {
  const a = Math.floor(from * ref.perSecond);
  const b = Math.ceil(to * ref.perSecond);
  if (a < -1 || b > ref.power.length + 1 || b <= a) return undefined;
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, a); i < Math.min(ref.power.length, b); i++) {
    sum += ref.power[i]!;
    count++;
  }
  return count > 0 ? sum / count : undefined;
}

function toDb(power: number): number {
  return 10 * Math.log10(Math.max(power, 1e-12));
}

function mean(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sd(xs: readonly number[], m = mean(xs)): number {
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

/** 피어슨 상관. 세 개보다 적거나 폭이 없으면 undefined */
export function correlation(xs: readonly number[], ys: readonly number[]): number | undefined {
  if (xs.length < 3 || xs.length !== ys.length) return undefined;
  const mx = mean(xs);
  const my = mean(ys);
  const sx = sd(xs, mx);
  const sy = sd(ys, my);
  if (sx === 0 || sy === 0) return undefined;
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0) / xs.length / sx / sy;
}

/**
 * 마디별로 원곡과 지금 곡의 크기를 견준다.
 * - offsetSec: 원곡 시각 = 곡 시각 + offsetSec (원곡 동시재생의 어긋남)
 * - range: 이 곡 위치(온음표 단위) 안에서 시작하는 마디만 (반복 구간으로 박수 등을 뺄 때)
 * - warp: 템포 자동 맞추기(tempoAlign)로 찾은 곡 시각 → 원곡 시각. 있으면 offsetSec 대신 이것으로 원곡을 읽는다
 * 모든 트랙을 센다 (듣기 끄기·솔로와 상관없이 게임에서 나는 소리)
 */
export function compareLoudness(
  song: Song,
  ref: ReferencePower,
  offsetSec: number,
  profile: Pick<GameProfile, "volume" | "volumeCurve">,
  range?: readonly [number, number],
  warp?: (songSeconds: number) => number,
): LoudnessCompare {
  const refAt = warp ?? ((t: number) => t + offsetSec);
  // & 사슬 하나를 한 번 치는 소리로: 첫 음 시각에 첫 음 v로 치고 마지막 조각 끝 + 여운에서 끊는다
  interface Hit {
    readonly start: Rat;
    readonly on: number;
    readonly off: number;
    readonly power: number;
    readonly vol: number;
    readonly melody: boolean;
  }
  const melodyId = (song.tracks.find((tr) => tr.role === "melody") ?? song.tracks[0])?.id;
  const hits: Hit[] = [];
  let end: Rat = ZERO;
  for (const track of song.tracks) {
    const vols = chainVolumes(track.notes);
    for (const chain of tieChains(track.notes)) {
      const first = chain[0]!;
      const last = chain[chain.length - 1]!;
      const stop = add(last.start, last.dur);
      if (cmp(stop, end) > 0) end = stop;
      const vol = vols.get(first.id) ?? first.vol;
      const db = dbOfVolume(profile, vol);
      hits.push({
        start: first.start,
        on: positionToSeconds(song.tempo, first.start),
        off: positionToSeconds(song.tempo, stop) + RELEASE_SECONDS,
        power: db === -Infinity ? 0 : 10 ** (db / 10),
        vol,
        melody: track.id === melodyId,
      });
    }
  }
  const starts = barStarts(song.timeSig, end);
  interface Raw {
    readonly bar: number;
    readonly start: Rat;
    readonly end: Rat;
    readonly seconds: number;
    readonly refSeconds: number;
    readonly reference: number;
    readonly current: number;
    readonly baseVol: number;
  }
  const raws: Raw[] = [];
  let skipped = 0;
  starts.forEach((start, i) => {
    const at = toFloat(start);
    if (range && (at < range[0] - 1e-9 || at >= range[1] - 1e-9)) return;
    const t0 = positionToSeconds(song.tempo, start);
    const t1 = positionToSeconds(song.tempo, starts[i + 1] ?? end);
    const next = starts[i + 1] ?? end;
    const inBar = hits.filter((h) => cmp(h.start, start) >= 0 && cmp(h.start, next) < 0);
    const r0 = refAt(t0);
    const r1 = refAt(t1);
    const refPower = t1 > t0 && r1 > r0 ? referenceMean(ref, r0, r1) : undefined;
    if (inBar.length === 0 || refPower === undefined || refPower <= 0) {
      skipped++;
      return;
    }
    // 음마다 시작에서 지수로 줄어드는 전력을 마디 구간에서 적분해 평균
    let energy = 0;
    for (const h of hits) {
      const a = Math.max(t0, h.on);
      const b = Math.min(t1, h.off);
      if (b <= a || h.power === 0) continue;
      energy += h.power * DECAY_SECONDS * (Math.exp(-(a - h.on) / DECAY_SECONDS) - Math.exp(-(b - h.on) / DECAY_SECONDS));
    }
    const melody = inBar.filter((h) => h.melody);
    const base = mean((melody.length > 0 ? melody : inBar).map((h) => h.vol));
    raws.push({ bar: i + 1, start, end: next, seconds: t0, refSeconds: r0, reference: toDb(refPower), current: toDb(energy / (t1 - t0)), baseVol: base });
  });

  // 두 줄의 폭을 맞춘다: 목표 = 계산 평균 + (원곡 − 원곡 평균) / 원곡 sd × 계산 sd
  // (녹음의 믹스·울림으로 원곡 폭은 믿을 수 없어 지금 곡 폭에 맞춘다. 지금 곡이 평평하면 MIN_SPREAD_DB)
  const refs = raws.map((r) => r.reference);
  const curs = raws.map((r) => r.current);
  // 원곡이 마디마다 같은 세기면(sd 0) 목표도 평평하게: 모든 마디를 계산 평균으로 (마디 하나뿐이면 비교할 것이 없어 지금 값)
  const flatRef = raws.length >= 2 && sd(refs) <= 1e-9;
  const scale = raws.length >= 2 && !flatRef ? Math.max(sd(curs), MIN_SPREAD_DB) / sd(refs) : 0;
  const mr = raws.length > 0 ? mean(refs) : 0;
  const mc = raws.length > 0 ? mean(curs) : 0;
  const bars: BarLoudness[] = raws.map((r) => {
    const target = scale > 0 ? mc + (r.reference - mr) * scale : flatRef ? mc : r.current;
    const diff = target - r.current;
    const baseVol = Math.round(r.baseVol);
    let suggest: number | undefined;
    if (Math.abs(diff) >= SUGGEST_DB) {
      const want = volumeForDb(profile, dbOfVolume(profile, baseVol) + diff) - baseVol;
      // 반 칸도 안 되면 적어도 한 칸은 그쪽으로. v 끝(v0·v15)에 막혔으면 0 (더 못 바꿈)
      const step = Math.sign(diff);
      const inRange = baseVol + step >= profile.volume.min && baseVol + step <= profile.volume.max;
      suggest = want !== 0 ? want : inRange ? step : 0;
    }
    return {
      bar: r.bar,
      start: r.start,
      end: r.end,
      seconds: r.seconds,
      refSeconds: r.refSeconds,
      drift: r.refSeconds - (r.seconds + offsetSec),
      current: r.current,
      target,
      diff,
      baseVol,
      ...(suggest !== undefined ? { suggest } : {}),
    };
  });

  // 4마디 묶음: 마디 번호 1~4, 5~8 … 안의 dB 평균끼리
  const groups = new Map<number, { r: number[]; c: number[] }>();
  for (const r of raws) {
    const g = groups.get(Math.floor((r.bar - 1) / 4)) ?? { r: [], c: [] };
    g.r.push(r.reference);
    g.c.push(r.current);
    groups.set(Math.floor((r.bar - 1) / 4), g);
  }
  const g = [...groups.values()];
  return {
    bars,
    corrBar: correlation(refs, curs),
    corr4: correlation(
      g.map((x) => mean(x.r)),
      g.map((x) => mean(x.c)),
    ),
    skipped,
  };
}
