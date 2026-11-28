import { DEFAULT_BPM, normalizeTempo, toFloat, type TempoEvent } from "@mmlce/core";

/**
 * 실험실(1.1 후보) 영상 펼쳐 깔기의 순수 계산. 화면·캔버스·영상 요소와 상관없는 계산만 둔다.
 *
 * 숨긴 영상을 한 번 재생하며 프레임마다 건반 윗선 위 깨끗한 영역을 줄여 "띠"에 이어 붙인다.
 * 띠의 줄 r은 영상 초 τ ∈ [r / rate, (r + 1) / rate)에 건반 윗선에 닿는 내용이다 (줄 번호는 시간 순).
 * 띠는 곡 위치(온음표)가 아니라 영상 초로 두고, 그릴 때 템포 지도로 곡 위치에 놓는다 (정수 tick으로 굽지 않는다).
 *
 * 영상 세로 좌표는 연속 좌표다: 픽셀 줄 y는 [y, y + 1)을 덮고, drawImage의 원본 사각형도 같은 좌표를 쓴다.
 * 프레임 시각 t에서 세로 Y의 내용은 τ = t + (keyY − Y) / speed에 건반 윗선에 닿는다.
 */

/** 띠 가로 폭 상한 (px). 영상 가로의 절반을 쓰되 이보다 넓게 하지 않는다 */
export const STRIP_MAX_WIDTH = 640;
/** 1초에 쌓는 줄 수. 기본은 높은 쪽, 메모리가 모자라면 낮은 쪽까지 내린다 */
export const STRIP_RATE_MAX = 120;
export const STRIP_RATE_MIN = 100;
/** 타일 한 장의 줄 수 (120줄/초면 약 2.1초) */
export const STRIP_TILE_ROWS = 256;
/** 풀어 둔 타일(RGBA)에 쓸 메모리 한도 (바이트). 넘으면 타일을 압축해 두고 화면 근처만 푼다 */
export const STRIP_BUDGET_BYTES = 32 * 1024 * 1024;
/** 압축해 둘 때도 풀어 두는 타일 수의 하한 (화면 하나와 양옆) */
export const STRIP_MIN_CACHE_TILES = 8;

export interface StripSize {
  /** 띠 가로 (px) */
  readonly width: number;
  /** 1초에 쌓는 줄 수 */
  readonly rate: number;
  readonly tileRows: number;
  /** 띠 전체 줄 수 */
  readonly rows: number;
  /** 타일 수 */
  readonly tiles: number;
  /** 타일 한 장 RGBA 바이트 */
  readonly tileBytes: number;
  /** 띠 전체를 RGBA로 풀어 두면 드는 바이트 */
  readonly bytes: number;
  /** 한도 안이라 모든 타일을 풀어 둘 수 있는지. 아니면 압축해 두고 cacheTiles장만 푼다 */
  readonly resident: boolean;
  /** 한 번에 풀어 둘 타일 수 */
  readonly cacheTiles: number;
}

/**
 * 띠 크기 정하기. seconds: 띠가 덮을 영상 초 (영상 길이 + 마지막 프레임이 보여 주는 위 영역).
 * 가로는 영상 가로의 1/2 (최대 STRIP_MAX_WIDTH), 세로는 STRIP_RATE_MAX줄/초에서 시작해 한도를 넘으면 STRIP_RATE_MIN까지 내린다
 */
export function chooseStripSize(videoWidth: number, seconds: number, budget = STRIP_BUDGET_BYTES): StripSize {
  const width = Math.max(1, Math.min(STRIP_MAX_WIDTH, Math.round(videoWidth / 2)));
  const secs = Math.max(0, seconds);
  const tileRows = STRIP_TILE_ROWS;
  const tileBytes = width * tileRows * 4;
  // 타일 단위로 올림한 크기가 한도 안에 드는 가장 높은 줄 수 (안 되면 가장 낮은 값)
  const bytesAt = (rate: number) => Math.ceil(Math.ceil(secs * rate) / tileRows) * tileBytes;
  let rate = STRIP_RATE_MAX;
  while (rate > STRIP_RATE_MIN && bytesAt(rate) > budget) rate--;
  const rows = Math.ceil(secs * rate);
  const tiles = Math.ceil(rows / tileRows);
  const bytes = tiles * tileBytes;
  const resident = bytes <= budget;
  const cacheTiles = resident ? tiles : Math.max(STRIP_MIN_CACHE_TILES, Math.floor(budget / tileBytes));
  return { width, rate, tileRows, rows, tiles, tileBytes, bytes, resident, cacheTiles };
}

/** 훑을 영상의 모양 (원본 영상 px) */
export interface StripGeometry {
  readonly videoWidth: number;
  readonly videoHeight: number;
  /** 건반 윗선 (위에서부터, 연속 좌표) = BackgroundVideo.keyLine × 영상 높이 */
  readonly keyY: number;
  /** 건반 윗선 바로 위에서 쓰지 않는 높이. 빛·불꽃·손 가림을 피한다. 사용자가 맞추는 값 */
  readonly margin: number;
  /** 깨끗한 영역 위 끝 (기본 0). 영상 위쪽 글자·제목 띠를 잘라 낼 때 */
  readonly top: number;
  /** 음이 떨어지는 속도 (원본 px/초) */
  readonly speed: number;
}

/** 프레임 하나가 띠에 쓸 수 있는 영상 초 범위 [lo, hi]: 깨끗한 영역 아래 끝(keyY − margin)부터 위 끝(top)까지 */
export function frameSpan(g: StripGeometry, t: number): [number, number] {
  return [t + g.margin / g.speed, t + (g.keyY - g.top) / g.speed];
}

/** 깨끗한 영역이 한 줄 이상 남는지 (아니면 훑을 수 없다) */
export function stripGeometryOk(g: StripGeometry, rate: number): boolean {
  return g.speed > 0 && rate > 0 && g.keyY > 0 && g.keyY <= g.videoHeight && g.top >= 0 && g.margin >= 0 && ((g.keyY - g.top - g.margin) / g.speed) * rate >= 1;
}

const EPS = 1e-9;

/** 프레임 t가 줄 전체를 덮는 줄 [first, end). 띠 밖은 잘라 낸다 */
export function frameRows(g: StripGeometry, rate: number, rows: number, t: number): [number, number] {
  const [lo, hi] = frameSpan(g, t);
  const first = Math.max(0, Math.ceil(lo * rate - EPS));
  const end = Math.min(rows, Math.floor(hi * rate + EPS));
  return [first, Math.max(first, end)];
}

/**
 * 줄마다 "마지막으로 쓴 프레임 거리" 장부. 거리 = 그 줄이 깨끗한 영역 아래 끝에서 몇 초 위에서 왔는지
 * (τ − t − margin / speed). 작을수록 건반 선 가까이에서 와서 속도 오차의 영향이 작다. Infinity는 아직 빈 줄
 */
export interface StripBook {
  readonly rate: number;
  readonly dist: Float64Array;
}

export function createBook(rows: number, rate: number): StripBook {
  return { rate, dist: new Float64Array(Math.max(0, rows)).fill(Infinity) };
}

/**
 * 띠에 그릴 한 덩이: 줄 [row0, row1)을 영상 원본 세로 [srcTop, srcTop + srcHeight)에서 가져온다.
 * srcTop 쪽이 나중 시각(row1)이다. 영상 방향 그대로라 뒤집지 않는다
 */
export interface BandRun {
  readonly row0: number;
  readonly row1: number;
  readonly srcTop: number;
  readonly srcHeight: number;
}

function bandRun(g: StripGeometry, rate: number, t: number, row0: number, row1: number): BandRun {
  return { row0, row1, srcTop: g.keyY - (row1 / rate - t) * g.speed, srcHeight: ((row1 - row0) / rate) * g.speed };
}

/**
 * 프레임 t(영상 mediaTime)를 받았을 때: 이 프레임이 더 가까운(거리가 작은) 줄만 장부에 적고, 그릴 덩이를 돌려준다.
 * 순서대로 재생하면 늘 나중 프레임이 이기므로 덩이는 하나다. seek로 메우는 프레임은 빈 줄과 더 나은 줄만 쓴다
 */
export function applyFrame(book: StripBook, g: StripGeometry, t: number): BandRun[] {
  const rate = book.rate;
  const [first, end] = frameRows(g, rate, book.dist.length, t);
  const base = t + g.margin / g.speed;
  const runs: BandRun[] = [];
  let start = -1;
  for (let r = first; r < end; r++) {
    const d = r / rate - base;
    const better = d < book.dist[r]! - EPS;
    if (better) {
      book.dist[r] = d;
      if (start < 0) start = r;
    } else if (start >= 0) {
      runs.push(bandRun(g, rate, t, start, r));
      start = -1;
    }
  }
  if (start >= 0) runs.push(bandRun(g, rate, t, start, end));
  return runs;
}

/** 타일 하나에 그릴 조각. y·h는 타일 캔버스 세로 (위가 나중 시각), srcTop·srcHeight는 영상 원본 세로 */
export interface TileBand {
  readonly tile: number;
  readonly y: number;
  readonly h: number;
  readonly srcTop: number;
  readonly srcHeight: number;
}

/** 타일 안 줄 [row0, row1)의 타일 캔버스 세로 범위 [y, y + h) (위가 나중 시각) */
export function tileY(tile: number, tileRows: number, row0: number, row1: number): { y: number; h: number } {
  const base = tile * tileRows;
  return { y: tileRows - (row1 - base), h: row1 - row0 };
}

/** 덩이를 타일 경계에서 나눈다 (두 타일에 걸치면 두 번 그린다) */
export function splitByTile(run: BandRun, tileRows: number): TileBand[] {
  const out: TileBand[] = [];
  const perRow = run.srcHeight / Math.max(1, run.row1 - run.row0);
  for (let r0 = run.row0; r0 < run.row1; ) {
    const tile = Math.floor(r0 / tileRows);
    const r1 = Math.min(run.row1, (tile + 1) * tileRows);
    const { y, h } = tileY(tile, tileRows, r0, r1);
    out.push({ tile, y, h, srcTop: run.srcTop + (run.row1 - r1) * perRow, srcHeight: (r1 - r0) * perRow });
    r0 = r1;
  }
  return out;
}

/** 줄 범위 [row0, row1) */
export interface RowRange {
  readonly row0: number;
  readonly row1: number;
}

/**
 * 빈 줄(구멍) 목록. [from, to)에서 아직 아무 프레임도 쓰지 않은 줄, maxDistance를 주면 그보다 먼 곳에서 온 줄까지.
 * from·to는 reachableRows로 고른다 (영상 처음 margin 아래 줄처럼 어느 프레임도 덮을 수 없는 줄은 구멍이 아니다)
 */
export function stripHoles(book: StripBook, from = 0, to = book.dist.length, maxDistance = Infinity): RowRange[] {
  const out: RowRange[] = [];
  let start = -1;
  const end = Math.min(to, book.dist.length);
  for (let r = Math.max(0, from); r < end; r++) {
    const d = book.dist[r]!;
    const hole = d === Infinity || d > maxDistance;
    if (hole && start < 0) start = r;
    else if (!hole && start >= 0) {
      out.push({ row0: start, row1: r });
      start = -1;
    }
  }
  if (start >= 0) out.push({ row0: start, row1: end });
  return out;
}

/** 프레임 [0, lastFrame] 중 어느 것이든 덮을 수 있는 줄 [first, end) */
export function reachableRows(g: StripGeometry, rate: number, rows: number, lastFrame: number): [number, number] {
  const first = frameRows(g, rate, rows, 0)[0];
  const end = frameRows(g, rate, rows, Math.max(0, lastFrame))[1];
  return [first, Math.max(first, end)];
}

/**
 * 구멍을 메울 seek 시각들 (영상 초, [0, lastFrame]). 구멍 첫 줄이 깨끗한 영역 아래 끝에 오게 옮기고,
 * 한 프레임이 덮는 길이(깨끗한 영역)보다 긴 구멍은 여러 번 옮긴다.
 * 실제로 보이는 프레임은 옮긴 시각보다 조금 앞일 수 있으므로, 받은 프레임을 applyFrame에 넣은 뒤 구멍을 다시 세어 한 번 더 부른다
 */
export function refillTimes(holes: readonly RowRange[], g: StripGeometry, rate: number, lastFrame: number): number[] {
  const out: number[] = [];
  if (!stripGeometryOk(g, rate)) return out;
  const last = Math.max(0, lastFrame);
  for (const hole of holes) {
    let row = hole.row0;
    while (row < hole.row1) {
      const t = Math.max(0, Math.min(last, row / rate - g.margin / g.speed));
      if (out.length === 0 || Math.abs(out[out.length - 1]! - t) > EPS) out.push(t);
      const [, covered] = frameRows(g, rate, Number.MAX_SAFE_INTEGER, t);
      // 덮지 못하면(영상 끝 너머) 그만둔다
      if (covered <= row) break;
      row = covered;
    }
  }
  return out;
}

/**
 * 띠 그리기에 쓰는 템포 시계. 템포 지도를 한 번만 훑어 두고 초 ↔ 곡 위치(온음표, 화면 전용 소수)를 이진 탐색으로 바꾼다.
 * secondsToWhole(@mmlce/core)은 부를 때마다 지도를 다시 정렬하므로, 화면에 템포 경계가 많을 때 이것을 쓴다.
 * 값은 core의 secondsToWhole·positionToSeconds와 같은 규칙이다
 */
export interface StripClock {
  /** 곡 초 → 곡 위치 (secondsToWhole과 같은 값) */
  toWhole(seconds: number): number;
  /** 곡 위치 → 곡 초 (positionToSeconds와 같은 값, 소수 위치) */
  toSeconds(whole: number): number;
  /** 템포가 바뀌는 곡 초 (오름차순, 곡 처음 0은 뺀다) */
  readonly bounds: readonly number[];
}

const wholeNoteSeconds = (bpm: number) => (4 * 60) / bpm;

export function stripClock(tempo: readonly TempoEvent[]): StripClock {
  // marks[i]: 템포 i개를 지난 자리(온음표)·그때까지의 초·그 뒤 빠르기. marks[0]은 곡 처음 기본 빠르기
  const marks: { at: number; sec: number; bpm: number }[] = [{ at: 0, sec: 0, bpm: DEFAULT_BPM }];
  for (const e of normalizeTempo(tempo)) {
    const last = marks[marks.length - 1]!;
    const at = toFloat(e.at);
    marks.push({ at, sec: last.sec + (at - last.at) * wholeNoteSeconds(last.bpm), bpm: e.bpm });
  }
  // 초가 이 값 이하인 마지막 칸 (같은 초에 칸이 여럿이면 나중 것, secondsToWhole과 같다)
  const bySeconds = (seconds: number) => {
    let lo = 0;
    let hi = marks.length - 1;
    if (!(marks[0]!.sec <= seconds)) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (marks[mid]!.sec <= seconds) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  // 위치보다 앞(같은 자리는 아직 안 지남)에 있는 마지막 칸 (tempoClock과 같다)
  const byWhole = (whole: number) => {
    let lo = 0;
    let hi = marks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (marks[mid]!.at < whole) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const bounds = marks
    .slice(1)
    .map((m) => m.sec)
    .filter((s, i, a) => s > 0 && (i === 0 || s > a[i - 1]!));
  return {
    toWhole(seconds) {
      const m = marks[bySeconds(seconds)]!;
      return m.at + (seconds - m.sec) / wholeNoteSeconds(m.bpm);
    },
    toSeconds(whole) {
      const m = marks[byWhole(whole)]!;
      return m.sec + (whole - m.at) * wholeNoteSeconds(m.bpm);
    },
    bounds,
  };
}

/** 그릴 조각 하나: 타일 캔버스 세로 [y, y + h)를 곡 위치 [whole0, whole1)에 놓는다 (조각 안은 템포가 하나라 1차식) */
export interface StripSlice {
  readonly tile: number;
  readonly y: number;
  readonly h: number;
  readonly whole0: number;
  readonly whole1: number;
}

/** 줄 범위 [row0, row1)이 걸치는 타일 번호들 (띠 밖은 뺀다) */
export function tilesForRows(row0: number, row1: number, tileRows: number, tiles: number): number[] {
  const lo = Math.max(0, row0);
  const hi = Math.min(tiles * tileRows, row1);
  if (!(hi > lo)) return [];
  const first = Math.floor(lo / tileRows);
  const last = Math.min(tiles - 1, Math.ceil(hi / tileRows) - 1);
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(i);
  return out;
}

/**
 * 보이는 곡 위치 [from, to)(온음표)를 그릴 조각들로. offset은 BackgroundVideo.offset (영상 초 = 곡 초 + offset).
 * 템포 경계와 타일 경계에서 자르고, 띠 밖(영상 0초 앞, 띠 끝 뒤)은 뺀다. 조각은 시간 순이다
 */
export function stripSlices(
  clock: StripClock,
  range: readonly [number, number],
  offset: number,
  size: Pick<StripSize, "rate" | "tileRows" | "rows">,
): StripSlice[] {
  const { rate, tileRows, rows } = size;
  const s0 = Math.max(0, clock.toSeconds(range[0]) + offset);
  const s1 = Math.min(rows / rate, clock.toSeconds(range[1]) + offset);
  if (!(s1 > s0)) return [];
  const cuts = [s0];
  for (const b of clock.bounds) {
    const s = b + offset;
    if (s > s0 && s < s1) cuts.push(s);
  }
  for (const tile of tilesForRows(s0 * rate, s1 * rate, tileRows, Math.ceil(rows / tileRows)).slice(1)) cuts.push((tile * tileRows) / rate);
  cuts.push(s1);
  cuts.sort((a, b) => a - b);
  const out: StripSlice[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    if (!(b - a > EPS)) continue;
    const tile = Math.min(Math.ceil(rows / tileRows) - 1, Math.floor(((a + b) / 2) * rate / tileRows));
    // 타일 경계에 붙은 끝은 소수 오차로 타일 밖에 나가지 않게 자른다
    const r0 = Math.max(tile * tileRows, a * rate);
    const r1 = Math.min((tile + 1) * tileRows, b * rate);
    const { y, h } = tileY(tile, tileRows, r0, r1);
    out.push({ tile, y, h, whole0: clock.toWhole(a - offset), whole1: clock.toWhole(b - offset) });
  }
  return out;
}

/**
 * 띠 가로(영상 x)를 음 높이 좌표로 놓는 조각. 지금은 BackgroundVideo처럼 영상 왼쪽 끝 = low, 오른쪽 끝 = high + 1의 1차식 하나다.
 * 건반 모양(흰건반 7칸이 반음 12개) 보정이 roll.ts에 생기면, 그 보정이 내는 꺾이는 점(영상 가로 비율 0-1 → 음 높이 좌표)을 breaks로 넘긴다
 */
export interface StripColumn {
  /** 띠 가로 [x0, x1) (px) */
  readonly x0: number;
  readonly x1: number;
  /** 음 높이 좌표 [pitch0, pitch1) (칸 경계, 음 p의 칸은 [p, p + 1)) */
  readonly pitch0: number;
  readonly pitch1: number;
}

export function stripColumns(
  width: number,
  video: { readonly low: number; readonly high: number },
  breaks: readonly { readonly x: number; readonly pitch: number }[] = [
    { x: 0, pitch: video.low },
    { x: 1, pitch: video.high + 1 },
  ],
): StripColumn[] {
  const out: StripColumn[] = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const a = breaks[i]!;
    const b = breaks[i + 1]!;
    if (!(b.x > a.x)) continue;
    out.push({ x0: a.x * width, x1: b.x * width, pitch0: a.pitch, pitch1: b.pitch });
  }
  return out;
}

/** 훑는 동안 잰 속도가 이만큼(비율) 넘게 흩어지면 속도가 바뀌는 영상으로 본다 */
export const STRIP_SPEED_SPREAD = 0.05;
/** 이어 쓴 속도(video.speed)가 잰 값과 이만큼(비율) 넘게 다르면 잰 값으로 바꾼다 */
export const STRIP_SPEED_TOLERANCE = 0.03;
/** 잰 값으로 믿으려면 성공한 재기가 이만큼 있어야 한다 */
export const STRIP_SPEED_MIN_SAMPLES = 3;

/**
 * 띠에 쓸 속도 정하기. measured: 훑는 동안 fallShift로 잰 속도들 (원본 px/초, 실패는 뺀 것).
 * hint: 이어 쓴 video.speed. 다른 영상에서 넘어온 값일 수 있어(해상도가 다르면 배율도 틀림) 잰 값과 맞춰 보는 데만 쓰고,
 * 잰 값이 모자라면 "hint"로 돌려줘서 화면이 이 영상에서 잰 값인지 따로 확인하게 한다.
 * spread: 10%·90% 지점 차이 ÷ 중앙값
 */
export function resolveStripSpeed(
  measured: readonly number[],
  hint?: number,
): { speed: number | undefined; source: "measured" | "hint" | "none"; spread: number; variable: boolean; hintOff: boolean } {
  const ok = measured.filter((s) => Number.isFinite(s) && s > 0).sort((a, b) => a - b);
  if (ok.length < STRIP_SPEED_MIN_SAMPLES) {
    const has = hint !== undefined && hint > 0;
    return { speed: has ? hint : undefined, source: has ? "hint" : "none", spread: 0, variable: false, hintOff: false };
  }
  const at = (q: number) => {
    const i = (ok.length - 1) * q;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return ok[lo]! + (ok[hi]! - ok[lo]!) * (i - lo);
  };
  const speed = at(0.5);
  const spread = (at(0.9) - at(0.1)) / speed;
  const hintOff = hint !== undefined && hint > 0 && Math.abs(hint - speed) / speed > STRIP_SPEED_TOLERANCE;
  return { speed, source: "measured", spread, variable: spread > STRIP_SPEED_SPREAD, hintOff };
}
