import { cmp, dbOfVolume, positionToSeconds, tieChains, toFloat, volumeForDb, type GameProfile, type Rat, type Song } from "@mmlce/core";
import { correlation, MIN_SPREAD_DB, type ReferencePower } from "./loudnessCompare";
import { onsetNear } from "./tempoSync";
import type { Peaks } from "./waveform";

/**
 * 음량 레인의 원곡 세기 안내선 (실험실, 보기만): 독주 녹음에서 음 시작마다 원곡이 얼마나 세게 쳤는지 재어,
 * 그 세기를 따라가려면 각 음의 v가 얼마쯤이면 되는지 막대 위에 작은 표시로 보인다. 곡은 바꾸지 않는다.
 * 섞인 녹음(반주·여러 악기)에서는 음 하나의 세기를 뽑을 수 없어 뜻이 없다. 정답이 아니라 안내다
 */

/** 원곡 시작점을 찾는 범위: 악보 음 시작(+ 원곡 어긋남)의 앞뒤 이만큼(초) 안에 시작점이 있어야 믿는다 */
export const GUIDE_ONSET_WINDOW = 0.03;
/** 원곡 세기를 재는 구간: 시작점 뒤 [이만큼, 이만큼]초의 평균 전력 (치는 순간의 잡음을 피하고 첫 울림을 잰다) */
export const GUIDE_MEASURE_FROM = 0.005;
export const GUIDE_MEASURE_TO = 0.085;

/** 음 시작 한 자리: 그 자리에서 새로 치는(& 로 이어 받지 않은) 모든 트랙 음 */
export interface GuideOnset {
  /** 곡 위치 (온음표 단위 소수, 그리기·구간 거르기용) */
  readonly at: number;
  /** 원곡에서 찾은 시작점의 세기 (dB) */
  readonly refDb: number;
  /** 그 자리에서 시작하는 모든 트랙 음의 계산 세기 합 (dB) */
  readonly scoreDb: number;
  /** 그 자리에서 시작하는 사슬 첫 음들 (트랙, 음 id, 지금 v) */
  readonly heads: readonly { readonly trackId: string; readonly id: string; readonly vol: number }[];
}

function toDb(power: number): number {
  return 10 * Math.log10(Math.max(power, 1e-12));
}

/** 원곡 [from, to)초의 평균 전력. 원곡 밖이면 undefined */
function powerMean(ref: ReferencePower, from: number, to: number): number | undefined {
  const a = Math.max(0, Math.floor(from * ref.perSecond));
  const b = Math.min(ref.power.length, Math.max(a + 1, Math.ceil(to * ref.perSecond)));
  if (from < 0 || a >= ref.power.length || b <= a) return undefined;
  let sum = 0;
  for (let i = a; i < b; i++) sum += ref.power[i]!;
  return sum / (b - a);
}

/**
 * 음 시작마다 원곡 세기와 악보 세기를 잰다 (원곡·곡·어긋남이 바뀔 때만 다시).
 * 원곡 시각 = 곡 시각 + offsetSec. 그 가까이(±GUIDE_ONSET_WINDOW)에서 onsetNear가 시작점을 못 찾은 자리,
 * 원곡 밖인 자리, 모든 음이 v0(소리 없음)인 자리는 뺀다. 템포 자동 맞추기(warp)는 쓰지 않는다.
 * 모든 트랙을 센다 (듣기 끄기·솔로와 상관없이 게임에서 나는 소리)
 */
export function guideOnsets(
  song: Song,
  power: ReferencePower,
  peaks: Peaks,
  offsetSec: number,
  profile: Pick<GameProfile, "volume" | "volumeCurve">,
): GuideOnset[] {
  // 곡 위치가 같은 사슬 첫 음끼리 모은다 (분수로 견준다)
  const groups: { start: Rat; heads: { trackId: string; id: string; vol: number }[] }[] = [];
  for (const track of song.tracks) {
    for (const chain of tieChains(track.notes)) {
      const head = chain[0]!;
      groups.push({ start: head.start, heads: [{ trackId: track.id, id: head.id, vol: head.vol }] });
    }
  }
  groups.sort((a, b) => cmp(a.start, b.start));
  const merged: typeof groups = [];
  for (const g of groups) {
    const last = merged[merged.length - 1];
    if (last && cmp(last.start, g.start) === 0) last.heads.push(...g.heads);
    else merged.push({ start: g.start, heads: [...g.heads] });
  }
  const out: GuideOnset[] = [];
  for (const g of merged) {
    let sum = 0;
    for (const h of g.heads) {
      const db = dbOfVolume(profile, h.vol);
      if (db !== -Infinity) sum += 10 ** (db / 10);
    }
    if (sum <= 0) continue;
    const at = positionToSeconds(song.tempo, g.start) + offsetSec;
    const onset = onsetNear(peaks, at, GUIDE_ONSET_WINDOW);
    if (onset === undefined) continue;
    const p = powerMean(power, onset + GUIDE_MEASURE_FROM, onset + GUIDE_MEASURE_TO);
    if (p === undefined || p <= 0) continue;
    out.push({ at: toFloat(g.start), refDb: toDb(p), scoreDb: toDb(sum), heads: g.heads });
  }
  return out;
}

function mean(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sd(xs: readonly number[], m = mean(xs)): number {
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

export interface GuideFit {
  /** 사슬 첫 음 id → 원곡 세기를 따르는 v (지금 v와 같아도 넣는다) */
  readonly targets: ReadonlyMap<string, number>;
  /** 맞추는 데 쓴 음 시작 수 */
  readonly count: number;
  /** 원곡 세기와 지금 악보 세기의 상관 (셀 수 없으면 undefined) */
  readonly corr: number | undefined;
}

/** 이보다 적은 음 시작으로는 평균·폭을 맞추지 않는다 (안내선을 그리지 않는다) */
export const GUIDE_MIN_ONSETS = 3;

/**
 * 구간 [from, to) 안 음 시작들로 원곡 세기의 평균·폭을 악보 세기의 평균·폭에 맞추고 (원곡 대조 셈여림과 같은 생각),
 * 자리마다 목표 − 지금(dB)을 그 자리 음들의 v에 똑같이 더해 v로 바꾼다 (같이 치는 음의 비율은 그대로).
 * 악보가 거의 평평하면 폭을 MIN_SPREAD_DB로 본다. 원곡이 모두 같은 세기면 목표는 악보 평균
 */
export function fitGuide(
  onsets: readonly GuideOnset[],
  profile: Pick<GameProfile, "volume" | "volumeCurve">,
  range: readonly [number, number],
): GuideFit {
  const inRange = onsets.filter((o) => o.at >= range[0] - 1e-9 && o.at < range[1] - 1e-9);
  const targets = new Map<string, number>();
  if (inRange.length < GUIDE_MIN_ONSETS) return { targets, count: inRange.length, corr: undefined };
  const refs = inRange.map((o) => o.refDb);
  const scores = inRange.map((o) => o.scoreDb);
  const mr = mean(refs);
  const ms = mean(scores);
  const sr = sd(refs, mr);
  const scale = sr > 1e-9 ? Math.max(sd(scores, ms), MIN_SPREAD_DB) / sr : 0;
  for (const o of inRange) {
    const target = ms + (o.refDb - mr) * scale;
    const diff = target - o.scoreDb;
    for (const h of o.heads) {
      const db = dbOfVolume(profile, h.vol);
      // 소리 없는 음(v0)은 그대로 둔다 (얼마나 올릴지 셈할 바탕이 없다)
      targets.set(h.id, db === -Infinity ? h.vol : volumeForDb(profile, db + diff));
    }
  }
  return { targets, count: inRange.length, corr: correlation(refs, scores) };
}
