import { add, cmp, mul, rat, DEFAULT_BPM, measureStart, meterAt, meterGrid, normalizeTempo, positionToSeconds, sub, toFloat, ZERO, type Note, type Rat, type TempoEvent, type TimeSigEvent } from "@mmlce/core";
import type { Peaks } from "./waveform";

/**
 * 원곡에 템포 맞추기. 템포를 짐작하지 않고, 사람이 정해 준 자리(마디선을 파형 위 박으로 끌기, 마디마다 탭)를
 * 곡 템포로 옮긴다. 게임 템포는 정수라 bpm은 반올림한다.
 */

/** bpm은 4분음표 기준: 온음표 길이 L이 d초면 bpm = 240·L/d */
function bpmFor(length: Rat, seconds: number): number {
  return Math.max(1, Math.round((240 * toFloat(length)) / seconds));
}

/** 위치에서 쓰는 템포 */
export function bpmAt(tempo: readonly TempoEvent[], at: Rat): number {
  let bpm = DEFAULT_BPM;
  for (const e of normalizeTempo(tempo)) if (cmp(e.at, at) <= 0) bpm = e.bpm;
  return bpm;
}

export interface TempoPlan {
  /** 넣거나 고칠 템포 */
  readonly set: readonly TempoEvent[];
  /** 지울 템포 위치 (탭 구간 안에 있던 것) */
  readonly remove: readonly Rat[];
}

/**
 * 나중에 누르는 제안(파형 맞추기 등)을 만든 때의 곡에 묶는다. 누를 때 곡이 그 곡 그대로(같은 객체)일 때만 run,
 * 그 사이 다른 편집·실행 취소·다른 곡 열기로 곡이 바뀌었으면 stale (옛 자료로 지금 곡을 바꾸지 않는다)
 */
export function boundToSong<S>(base: S | undefined, run: () => void, stale: () => void): (now: S | undefined) => void {
  return (now) => (base !== undefined && now === base ? run() : stale());
}

/** 계획한 템포 중 게임 템포 범위(GameProfile.tempo) 밖인 첫 값. 모두 범위 안이면 undefined (넣지 않고 알릴 때 쓴다) */
export function tempoOutOfRange(plan: TempoPlan, range: { readonly min: number; readonly max: number }): number | undefined {
  return plan.set.find((e) => e.bpm < range.min || e.bpm > range.max)?.bpm;
}

/**
 * 마디선 bar를 곡 시각 targetSeconds(지금 템포로 잰 초, 파형에서 그 박이 보이는 자리)에 오게 한다.
 * bar 앞의 마지막 템포 자리(없으면 곡 처음)부터 bar까지의 템포를 바꾸고, bar 뒤는 원래 템포를 이어 간다
 * (bar에 원래 템포를 하나 넣는다). 앞 자리보다 앞으로 끌면 undefined
 */
export function alignBarTempo(tempo: readonly TempoEvent[], bar: Rat, targetSeconds: number): TempoPlan | undefined {
  const events = normalizeTempo(tempo);
  const anchor = events.filter((e) => cmp(e.at, bar) < 0).at(-1)?.at ?? ZERO;
  if (cmp(anchor, bar) >= 0) return undefined;
  const seconds = targetSeconds - positionToSeconds(events, anchor);
  if (!(seconds > 0.01)) return undefined;
  const bpm = bpmFor(sub(bar, anchor), seconds);
  const after = bpmAt(events, bar);
  const atBar = events.some((e) => cmp(e.at, bar) === 0);
  const set: TempoEvent[] = [{ at: anchor, bpm }];
  if (!atBar && after !== bpm) set.push({ at: bar, bpm: after });
  return { set, remove: [] };
}

/** 위치에서 가장 가까운 마디 시작 */
export function nearestBar(timeSig: readonly TimeSigEvent[], at: Rat): Rat {
  const start = measureStart(timeSig, at);
  const next = add(start, meterGrid(meterAt(timeSig, start)).measure);
  return toFloat(sub(at, start)) <= toFloat(sub(next, at)) ? start : next;
}

/** 파형 띠 마디선 끌기: 앞에서부터(앞 템포 자리부터 이 마디선까지, 뒤는 밀린다) · 양옆 마디만 */
export type BarDragMode = "chain" | "pair";

/** 탭을 넣은 뒤 다시 볼 것: 간격이 튀는 자리(at: 온음표), 파형 시작점 맞추기 제안 (count 0 = 못 찾음) */
export interface TapReview {
  readonly flags: readonly { readonly at: number; readonly label: string }[];
  readonly snap?: { readonly count: number; readonly ms: number; readonly apply: () => void } | undefined;
}

/** 탭 단위: 마디 첫 박마다, 또는 박마다 (붙임줄로 첫 박이 안 들리는 곡) */
export type TapUnit = "bar" | "beat";

/** 위치에서 가장 가까운 박 (마디 시작부터 박 길이로 센다) */
export function nearestBeat(timeSig: readonly TimeSigEvent[], at: Rat): Rat {
  const start = measureStart(timeSig, at);
  const grid = meterGrid(meterAt(timeSig, start));
  const k = Math.round(toFloat(sub(at, start)) / toFloat(grid.beat));
  const beat = add(start, rat(grid.beat.n * k, grid.beat.d));
  return cmp(beat, add(start, grid.measure)) > 0 ? add(start, grid.measure) : beat;
}

/** 다음 탭 자리: 다음 마디, 또는 다음 박 (마디 끝을 넘지 않는다) */
function nextStep(timeSig: readonly TimeSigEvent[], at: Rat, unit: TapUnit): Rat {
  const start = measureStart(timeSig, at);
  const grid = meterGrid(meterAt(timeSig, start));
  const end = add(start, grid.measure);
  if (unit === "bar") return end;
  const next = add(at, grid.beat);
  return cmp(next, end) > 0 ? end : next;
}

/**
 * 묶음(points: 묶음 시작부터 길이·초)에 다음 간격을 더해도 되는지: 합친 평균 템포로 쳐도 묶음 안 모든 탭 자리가
 * slack(초) 안에 들면 손 떨림으로 보고 합친다. 그보다 쌓이면 연주자가 실제로 템포를 바꾼 것으로 본다
 */
function fits(points: readonly [number, number][], length: number, seconds: number, slack: number): boolean {
  if (!(slack > 0)) return false;
  const [l, t] = points.at(-1)!;
  const perWhole = (t + seconds) / (l + length);
  return [...points, [l + length, t + seconds] as [number, number]].every(([pl, pt]) => Math.abs(pl * perWhole - pt) <= slack + 1e-9);
}

/** 탭 자리: 첫 탭은 first, 다음 탭은 그다음 마디(또는 박)들 */
export function tapMarks(timeSig: readonly TimeSigEvent[], first: Rat, count: number, unit: TapUnit): Rat[] {
  const marks: Rat[] = [first];
  for (let i = 1; i < count; i++) marks.push(nextStep(timeSig, marks[i - 1]!, unit));
  return marks;
}

/**
 * 탭한 시각(곡 시각, 초)으로 템포를 정한다. 첫 탭은 first(자리는 그대로 둔다), 다음 탭은 그다음 마디(또는 박)들.
 * 간격마다 템포를 재고, 합쳐도 탭 자리가 slack(초) 안이면 한 묶음으로 합친다. 묶음 템포는 묶음 전체 길이 ÷ 전체 시간이다.
 * 게임 템포는 정수라 반올림하는데, 그 오차는 다음 묶음이 받는다 (묶음마다 실제로 닿은 시각부터 다음 탭 자리까지로 잰다).
 * 그래서 마디가 많아도 어긋남이 쌓이지 않는다. 앞과 같은 템포는 생략하고, 마지막 탭 자리부터는 원래 템포로 돌아간다.
 * 그 사이에 있던 템포는 지운다. 탭이 둘보다 적으면 undefined
 */
export function tapTempos(
  tempo: readonly TempoEvent[],
  timeSig: readonly TimeSigEvent[],
  first: Rat,
  taps: readonly number[],
  options: { readonly slack?: number; readonly unit?: TapUnit } = {},
): TempoPlan | undefined {
  const { slack = 0, unit = "bar" } = options;
  if (taps.length < 2) return undefined;
  const marks = tapMarks(timeSig, first, taps.length, unit);
  const last = marks.at(-1)!;
  // 묶음: 시작 자리, 끝 탭 번호, 시작 자리부터 탭마다 [묶음 시작부터 길이, 걸린 초]
  type Group = { start: Rat; end: number; points: [number, number][] };
  const groups: Group[] = [];
  for (let i = 0; i + 1 < taps.length; i++) {
    const seconds = taps[i + 1]! - taps[i]!;
    if (!(seconds > 0.05)) return undefined;
    const length = toFloat(sub(marks[i + 1]!, marks[i]!));
    const g = groups.at(-1);
    if (g && fits(g.points, length, seconds, slack)) {
      const [l, t] = g.points.at(-1)!;
      g.points.push([l + length, t + seconds]);
      g.end = i + 1;
    } else groups.push({ start: marks[i]!, end: i + 1, points: [[length, seconds]] });
  }
  const set: TempoEvent[] = [];
  let current = bpmAt(tempo, first);
  let reached = taps[0]!;
  for (const g of groups) {
    const [length] = g.points.at(-1)!;
    const bpm = Math.max(1, Math.round((240 * length) / Math.max(0.05, taps[g.end]! - reached)));
    if (bpm !== current) set.push({ at: g.start, bpm });
    current = bpm;
    reached += (240 * length) / bpm;
  }
  const after = bpmAt(tempo, last);
  if (after !== current) set.push({ at: last, bpm: after });
  const remove = normalizeTempo(tempo)
    .map((e) => e.at)
    .filter((at) => cmp(at, first) > 0 && cmp(at, last) <= 0 && !set.some((s) => cmp(s.at, at) === 0));
  return { set, remove };
}

/**
 * 간격이 튀는 탭: 탭 간격(온음표 하나에 걸린 초)을 앞뒤 세 간격의 가운데 값과 견주어 threshold(비율, 0.2 = 20%)보다
 * 다르면 그 간격 번호(i = taps[i]→taps[i+1])를 돌려준다. 고치지는 않는다 (재즈·루바토·빠른 곡은 일부러 다를 수 있다).
 * 견줄 간격이 둘보다 적으면 보지 않는다. threshold가 0 이하이면 끔
 */
export function offIntervals(taps: readonly number[], marks: readonly Rat[], threshold: number): number[] {
  if (!(threshold > 0) || taps.length < 4) return [];
  const rates: number[] = [];
  for (let i = 0; i + 1 < taps.length; i++) rates.push((taps[i + 1]! - taps[i]!) / Math.max(1e-9, toFloat(sub(marks[i + 1]!, marks[i]!))));
  const out: number[] = [];
  rates.forEach((r, i) => {
    const near = rates.filter((_, j) => j !== i && Math.abs(j - i) <= 3).sort((a, b) => a - b);
    if (near.length < 2) return;
    const mid = near.length % 2 ? near[(near.length - 1) / 2]! : (near[near.length / 2 - 1]! + near[near.length / 2]!) / 2;
    if (Math.abs(r / mid - 1) > threshold) out.push(i);
  });
  return out;
}

/**
 * 원곡 파형에서 time초(원곡 시각) 가까이(±window초) 소리가 시작하는 자리. 칸마다 크기(가장 큰 절댓값)가
 * 바로 앞 20ms 평균보다 가장 크게 뛰는 칸을 고르고, 그 오름이 시작한 칸까지 거슬러 간다.
 * 뚜렷한 오름(곡 전체 가장 큰 소리의 8% 이상, 앞보다 1.5배 이상)이 없으면 undefined
 */
export function onsetNear(peaks: Peaks, time: number, window: number): number | undefined {
  const per = peaks.perSecond;
  const count = peaks.max.length;
  const level = (k: number) => (k >= 0 && k < count ? Math.max(peaks.max[k]!, -peaks.min[k]!) : 0);
  const look = Math.max(2, Math.round(0.02 * per));
  const rise = (k: number) => {
    let sum = 0;
    for (let j = 1; j <= look; j++) sum += level(k - j);
    const before = sum / look;
    const now = level(k);
    return now >= before * 1.5 ? now - before : 0;
  };
  const from = Math.max(0, Math.floor((time - window) * per));
  const to = Math.min(count - 1, Math.ceil((time + window) * per));
  let best = -1;
  let bestRise = 0;
  for (let k = from; k <= to; k++) {
    const r = rise(k);
    if (r > bestRise) {
      best = k;
      bestRise = r;
    }
  }
  if (best < 0 || bestRise < 0.08 * peaks.peak) return undefined;
  while (best > from && rise(best - 1) >= bestRise * 0.5) best--;
  return best / per;
}

/** 악보에 쓰여 있는 소리 시작 자리 (& 로 같은 음을 이어 받은 음은 새로 치는 게 아니라 뺀다) */
export function attackStarts(tracks: readonly { readonly notes: readonly Note[] }[]): Set<number> {
  const out = new Set<number>();
  for (const t of tracks) {
    let prev: Note | undefined;
    for (const n of t.notes) {
      const held = prev && prev.tie === "next" && prev.pitch === n.pitch && cmp(add(prev.start, prev.dur), n.start) === 0;
      if (!held) out.add(toFloat(n.start));
      prev = n;
    }
  }
  return out;
}

/**
 * 탭을 원곡 소리 시작점에 맞춘 시각. 악보에 그 자리 첫 음이 쓰여 있는 탭만 (그 박에 소리가 안 나는 곳은 원곡 시작점이 박과 다르다),
 * onset(탭 시각) → 가까운 시작점(곡 시각)을 찾은 것만 옮긴다. moved: 옮긴 탭 번호와 옮긴 거리(초)
 */
export function snapTaps(
  taps: readonly number[],
  marks: readonly Rat[],
  attacks: ReadonlySet<number>,
  onset: (time: number) => number | undefined,
): { times: number[]; moved: { index: number; shift: number }[] } {
  const times = [...taps];
  const moved: { index: number; shift: number }[] = [];
  taps.forEach((time, i) => {
    const mark = marks[i];
    if (!mark || !attacks.has(toFloat(mark))) return;
    const to = onset(time);
    if (to === undefined || Math.abs(to - time) < 0.002) return;
    // 앞뒤 탭 순서를 넘지 않는다
    if ((i > 0 && to <= times[i - 1]! + 0.05) || (i + 1 < taps.length && to >= taps[i + 1]! - 0.05)) return;
    times[i] = to;
    moved.push({ index: i, shift: to - time });
  });
  return { times, moved };
}

/** 앞 마디 시작 (곡 처음이면 처음). 이어 찍기는 고른 마디 한 마디 앞부터 재생한다 */
export function previousBar(timeSig: readonly TimeSigEvent[], at: Rat): Rat {
  return cmp(at, ZERO) > 0 ? measureStart(timeSig, sub(at, rat(1, 3840 * 64))) : ZERO;
}

/** 마디 번호(1부터)의 시작 자리 (박자 바뀜을 따라 센다) */
export function barStart(timeSig: readonly TimeSigEvent[], bar: number): Rat {
  const sigs = [...timeSig].sort((a, b) => cmp(a.at, b.at));
  const segments = sigs.length === 0 || cmp(sigs[0]!.at, ZERO) > 0 ? [{ at: ZERO, beats: 4, unit: 4 }, ...sigs] : sigs;
  let first = 1;
  for (let i = 0; i < segments.length; i++) {
    const sig = segments[i]!;
    const next = segments[i + 1];
    const { measure } = meterGrid(sig);
    const at = add(sig.at, mul(measure, rat(Math.max(0, Math.floor(bar) - first))));
    if (!next || cmp(at, next.at) < 0) return at;
    first += Math.ceil((toFloat(next.at) - toFloat(sig.at)) / toFloat(measure) - 1e-9);
  }
  return ZERO;
}

/**
 * 마디선 하나만 끌기: 앞 마디선과 뒤 마디선은 그 자리(지금 시각)에 두고, bar가 targetSeconds에 오게 양옆 두 마디의 템포를 다시 잰다.
 * 정수 템포 반올림 오차는 그다음 마디가 받는다 (그 마디 안에 다른 템포가 없을 때). 그 뒤는 원래 템포 그대로.
 * 양옆 마디 안에 있던 템포는 지운다. 앞·뒤 마디선을 넘어 끌면 undefined. bpms: 양옆 두 마디 템포 (끄는 동안 보여 준다)
 */
export function pairBarTempo(
  tempo: readonly TempoEvent[],
  timeSig: readonly TimeSigEvent[],
  bar: Rat,
  targetSeconds: number,
): (TempoPlan & { readonly bpms: readonly [number, number] }) | undefined {
  if (cmp(bar, ZERO) <= 0) return undefined;
  const events = normalizeTempo(tempo);
  const left = previousBar(timeSig, bar);
  const right = add(bar, meterGrid(meterAt(timeSig, bar)).measure);
  const carry = add(right, meterGrid(meterAt(timeSig, right)).measure);
  const tLeft = positionToSeconds(events, left);
  const tRight = positionToSeconds(events, right);
  if (!(targetSeconds - tLeft > 0.05) || !(tRight - targetSeconds > 0.05)) return undefined;
  const before = cmp(left, ZERO) > 0 ? bpmAt(events, sub(left, rat(1, 3840 * 64))) : undefined;
  const lenA = toFloat(sub(bar, left));
  const lenB = toFloat(sub(right, bar));
  const bpmA = Math.max(1, Math.round((240 * lenA) / (targetSeconds - tLeft)));
  const reachedBar = tLeft + (240 * lenA) / bpmA;
  const bpmB = Math.max(1, Math.round((240 * lenB) / Math.max(0.05, tRight - reachedBar)));
  const reachedRight = reachedBar + (240 * lenB) / bpmB;
  const inside = (from: Rat, to: Rat) => events.filter((e) => cmp(e.at, from) > 0 && cmp(e.at, to) < 0);
  // 반올림 오차를 받을 다음 마디 (그 안에 다른 템포가 없을 때만)
  const takesCarry = inside(right, carry).length === 0;
  const end = takesCarry ? carry : right;
  const want: TempoEvent[] = [
    { at: left, bpm: bpmA },
    { at: bar, bpm: bpmB },
  ];
  if (takesCarry) {
    const lenC = toFloat(sub(carry, right));
    const tCarry = positionToSeconds(events, carry);
    want.push({ at: right, bpm: Math.max(1, Math.round((240 * lenC) / Math.max(0.05, tCarry - reachedRight))) });
  }
  want.push({ at: end, bpm: bpmAt(events, end) });
  // 앞과 같은 템포는 생략 (그 자리에 다른 값의 템포가 있으면 고친다)
  const set: TempoEvent[] = [];
  let current = before ?? DEFAULT_BPM;
  for (const w of want) {
    const here = events.find((e) => cmp(e.at, w.at) === 0);
    if (w.bpm !== current || (here && here.bpm !== w.bpm)) set.push(w);
    current = w.bpm;
  }
  const remove = inside(left, end)
    .map((e) => e.at)
    .filter((at) => !set.some((s) => cmp(s.at, at) === 0));
  return { set, remove, bpms: [bpmA, bpmB] };
}
