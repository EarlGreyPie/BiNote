import { describe, expect, it } from "vitest";
import { positionToSeconds, rat, secondsToWhole, toFloat, type Rat, type TempoEvent } from "@mmlce/core";
import {
  applyFrame,
  chooseStripSize,
  createBook,
  frameRows,
  frameSpan,
  reachableRows,
  refillTimes,
  resolveStripSpeed,
  splitByTile,
  STRIP_MAX_WIDTH,
  STRIP_MIN_CACHE_TILES,
  STRIP_RATE_MAX,
  STRIP_RATE_MIN,
  STRIP_TILE_ROWS,
  stripClock,
  stripColumns,
  stripGeometryOk,
  stripHoles,
  stripSlices,
  tilesForRows,
  tileY,
  type StripBook,
  type StripGeometry,
} from "../src/lib/videoStrip";

// 합성 떨어지는 음 영상 (시제품과 같은 꼴): 1280×720, 건반 윗선 612px, 200px/초, 30fps, 20초, 88건반 같은 폭.
// 영상 파일 없이 "프레임 t에서 (건반, 세로 Y)가 켜졌는지" 함수로 흉내 낸다
const KEYS = 88;
const FPS = 30;
const LEN = 20;
const RATE = 120;
const TRUE: StripGeometry = { videoWidth: 1280, videoHeight: 720, keyY: 612, margin: 6, top: 0, speed: 200 };
const ROWS = Math.ceil((LEN + TRUE.keyY / TRUE.speed) * RATE);

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const notes: { k: number; s: number; e: number }[] = [];
for (let i = 0; i < 400; i++) {
  const s = rnd() * LEN;
  notes.push({ k: Math.floor(rnd() * KEYS), s, e: s + 0.03 + rnd() * 0.6 });
}
// 같은 건반 짧은 틈(30ms) 되풀이
for (let i = 0; i < 6; i++) notes.push({ k: 40, s: 15 + i * 0.13, e: 15 + i * 0.13 + 0.1 });
const byKey = Array.from({ length: KEYS }, (_, k) => notes.filter((n) => n.k === k));
const lit = (k: number, tau: number) => byKey[k]!.some((n) => tau >= n.s && tau < n.e);
const edges = notes.flatMap((n) => [n.s, n.e]);

/**
 * 프레임 t를 띠에 붙인다 (drawImage 흉내: 줄 r의 가운데가 덩이 원본 사각형 안 어디서 오는지 계산해, 그 자리 내용의 시각을 적는다).
 * 줄마다 마지막으로 쓴 내용의 시각만 두고 켜짐은 나중에 한 번 읽는다 (덮어쓰기 결과는 같다). NaN은 아직 안 쓴 줄
 */
function stitch(times: readonly number[], est: StripGeometry = TRUE, book: StripBook = createBook(ROWS, RATE), seen = new Float64Array(ROWS).fill(Number.NaN)) {
  for (const t of times) {
    for (const run of applyFrame(book, est, t)) {
      const perRow = run.srcHeight / (run.row1 - run.row0);
      for (let r = run.row0; r < run.row1; r++) {
        const y = run.srcTop + (run.row1 - r - 0.5) * perRow;
        // 영상 속 내용은 참 속도로 움직인다
        seen[r] = t + (TRUE.keyY - y) / TRUE.speed;
      }
    }
  }
  return { book, strip: seen };
}

/** 띠와 정답(줄 가운데 시각)이 다른 줄들 */
function wrongRows(seen: Float64Array, from: number, to: number): number[] {
  const out: number[] = [];
  for (let r = from; r < to; r++) {
    const tau = (r + 0.5) / RATE;
    const got = seen[r]!;
    for (let k = 0; k < KEYS; k++)
      if (Number.isNaN(got) || lit(k, got) !== lit(k, tau)) {
        out.push(r);
        break;
      }
  }
  return out;
}

const frames = (step = 1, from = 0, to = LEN) => {
  const out: number[] = [];
  for (let i = Math.ceil(from * FPS); i / FPS < to; i += step) out.push(i / FPS);
  return out;
};
const lastFrame = (LEN * FPS - 1) / FPS;
const [FIRST, END] = reachableRows(TRUE, RATE, ROWS, lastFrame);

describe("chooseStripSize: 띠 크기", () => {
  it("가로는 영상 가로의 절반, 640px까지", () => {
    expect(chooseStripSize(1280, 60).width).toBe(640);
    expect(chooseStripSize(1920, 60).width).toBe(STRIP_MAX_WIDTH);
    expect(chooseStripSize(854, 60).width).toBe(427);
    expect(chooseStripSize(0, 60).width).toBe(1);
  });
  it("짧은 곡은 120줄/초로 모두 풀어 둔다", () => {
    const s = chooseStripSize(1280, 60);
    expect(s.rate).toBe(STRIP_RATE_MAX);
    expect(s.rows).toBe(7200);
    expect(s.tiles).toBe(Math.ceil(7200 / STRIP_TILE_ROWS));
    expect(s.tileBytes).toBe(640 * STRIP_TILE_ROWS * 4);
    expect(s.resident).toBe(true);
    expect(s.cacheTiles).toBe(s.tiles);
  });
  it("긴 곡은 100줄/초까지 내리고, 그래도 넘으면 압축해 두고 일부만 푼다", () => {
    const three = chooseStripSize(1280, 180);
    expect(three.rate).toBe(STRIP_RATE_MIN);
    expect(three.bytes).toBeGreaterThan(32 * 1024 * 1024);
    expect(three.resident).toBe(false);
    expect(three.cacheTiles).toBe(Math.floor((32 * 1024 * 1024) / three.tileBytes));
    // 1초에 줄 수를 정할 만큼 한도 안이면 그 사이 값
    const mid = chooseStripSize(1280, 120);
    expect(mid.rate).toBeGreaterThanOrEqual(STRIP_RATE_MIN);
    expect(mid.rate).toBeLessThan(STRIP_RATE_MAX);
    // 타일 단위로 올림해도 한도 안이고, 한 줄 더 쌓으면 넘는다
    expect(mid.resident).toBe(true);
    expect(mid.bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(Math.ceil(Math.ceil(120 * (mid.rate + 1)) / STRIP_TILE_ROWS) * mid.tileBytes).toBeGreaterThan(32 * 1024 * 1024);
    // 한도가 아주 작아도 화면 하나와 양옆은 풀어 둔다
    expect(chooseStripSize(1280, 300, 1024).cacheTiles).toBe(STRIP_MIN_CACHE_TILES);
  });
  it("길이 0이면 빈 띠", () => {
    const s = chooseStripSize(1280, 0);
    expect(s.rows).toBe(0);
    expect(s.tiles).toBe(0);
    expect(s.resident).toBe(true);
  });
});

describe("프레임 하나가 덮는 줄", () => {
  it("깨끗한 영역(건반 선 − 여유부터 위 끝까지) 안의 온전한 줄만, 원본 사각형도 그 안", () => {
    expect(stripGeometryOk(TRUE, RATE)).toBe(true);
    const t = 3.3;
    const [lo, hi] = frameSpan(TRUE, t);
    const [first, end] = frameRows(TRUE, RATE, ROWS, t);
    expect(first).toBe(Math.ceil(lo * RATE));
    expect(end).toBe(Math.floor(hi * RATE));
    const book = createBook(ROWS, RATE);
    const runs = applyFrame(book, TRUE, t);
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect([run.row0, run.row1]).toEqual([first, end]);
    expect(run.srcTop).toBeGreaterThanOrEqual(TRUE.top - 1e-9);
    expect(run.srcTop + run.srcHeight).toBeLessThanOrEqual(TRUE.keyY - TRUE.margin + 1e-9);
    // 맨 아래 줄의 아래 끝 = 그 줄 시각이 건반 선에 닿을 자리
    expect(run.srcTop + run.srcHeight).toBeCloseTo(TRUE.keyY - (first / RATE - t) * TRUE.speed, 9);
    // 거리는 깨끗한 영역 아래 끝에서 잰다
    expect(book.dist[first]).toBeCloseTo(first / RATE - lo, 12);
  });
  it("깨끗한 영역이 한 줄도 안 되면 훑을 수 없다", () => {
    expect(stripGeometryOk({ ...TRUE, margin: 612 }, RATE)).toBe(false);
    expect(stripGeometryOk({ ...TRUE, speed: 0 }, RATE)).toBe(false);
    expect(refillTimes([{ row0: 0, row1: 10 }], { ...TRUE, speed: 0 }, RATE, lastFrame)).toEqual([]);
  });
  it("타일 경계에 걸친 덩이는 두 번 그리고, 줄마다 같은 원본 자리를 읽는다", () => {
    const run = applyFrame(createBook(ROWS, RATE), TRUE, 1.9)[0]!;
    const bands = splitByTile(run, STRIP_TILE_ROWS);
    expect(bands.length).toBeGreaterThan(1);
    expect(bands.reduce((s, b) => s + b.h, 0)).toBe(run.row1 - run.row0);
    const perRow = run.srcHeight / (run.row1 - run.row0);
    for (const b of bands) {
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h).toBeLessThanOrEqual(STRIP_TILE_ROWS);
      // 타일 캔버스 y의 줄 = 타일 시작 + 타일 줄 수 − y − 1 (위가 나중 시각)
      const topRow = b.tile * STRIP_TILE_ROWS + STRIP_TILE_ROWS - b.y - 1;
      expect(b.srcTop).toBeCloseTo(run.srcTop + (run.row1 - 1 - topRow) * perRow, 9);
      expect(b.srcHeight).toBeCloseTo(b.h * perRow, 9);
    }
  });
});

describe("띠 이어 붙이기: 합성 프레임", () => {
  it("30fps 모든 프레임, 속도가 맞으면 닿을 수 있는 줄이 정답과 꼭 같고 구멍이 없다", () => {
    const { book, strip } = stitch(frames());
    expect(wrongRows(strip, FIRST, END)).toEqual([]);
    expect(stripHoles(book, FIRST, END)).toEqual([]);
    // 순서대로 받으면 줄마다 마지막으로 쓴 프레임은 한 프레임 간격 안
    let worst = 0;
    for (let r = FIRST; r < Math.floor((lastFrame + TRUE.margin / TRUE.speed) * RATE); r++) worst = Math.max(worst, book.dist[r]!);
    expect(worst).toBeLessThan(1 / FPS + 1e-9);
  });
  it("처음 margin 아래 줄은 어느 프레임도 덮지 못해 구멍으로 세지 않는다", () => {
    expect(FIRST).toBe(Math.ceil((TRUE.margin / TRUE.speed) * RATE));
    const { book } = stitch(frames());
    expect(stripHoles(book, 0, END)).toEqual([{ row0: 0, row1: FIRST }]);
  });
  it("속도를 2% 틀리게 재도 틀린 줄은 음 경계 바로 옆뿐 (마지막 프레임 위쪽 꼬리는 빼고)", () => {
    const est = { ...TRUE, speed: TRUE.speed * 1.02 };
    const { book, strip } = stitch(frames(), est);
    // 마지막 프레임 뒤는 그 프레임 높은 곳에서 온 줄이라 오차가 (거리 × 2%)로 커진다. 영상이 끝난 뒤의 꼬리다
    const tail = frameRows(est, RATE, ROWS, lastFrame)[0];
    const wrong = wrongRows(strip, FIRST, tail);
    expect(wrong.length).toBeGreaterThan(0);
    for (const r of wrong) {
      expect(book.dist[r]).toBeLessThan(1 / FPS + 1e-9);
      expect(edges.some((e) => Math.abs(e * RATE - (r + 0.5)) <= 1.5)).toBe(true);
    }
  });
  it("프레임 30%를 빼거나 8프레임에 1장만 받아도 정답과 같다 (위 영역 전체를 쓰므로)", () => {
    const keep = frames().filter(() => rnd() > 0.3);
    const dropped = stitch(keep);
    const endKeep = reachableRows(TRUE, RATE, ROWS, keep.at(-1)!)[1];
    expect(wrongRows(dropped.strip, FIRST, endKeep)).toEqual([]);
    expect(stripHoles(dropped.book, FIRST, endKeep)).toEqual([]);
    const every8 = frames(8);
    const eighth = stitch(every8);
    const end8 = reachableRows(TRUE, RATE, ROWS, every8.at(-1)!)[1];
    expect(wrongRows(eighth.strip, FIRST, end8)).toEqual([]);
    expect(stripHoles(eighth.book, FIRST, end8)).toEqual([]);
    // 거리 한도를 주면 먼 곳에서 온 줄도 구멍으로 센다 (8프레임 = 0.27초). 마지막 프레임 위쪽 꼬리는 빼고 본다
    const tail8 = frameRows(TRUE, RATE, ROWS, every8.at(-1)!)[0];
    expect(stripHoles(eighth.book, FIRST, tail8, 0.2).length).toBeGreaterThan(0);
    expect(stripHoles(eighth.book, FIRST, tail8, 0.3)).toEqual([]);
  });
  it("늦게 온 앞 프레임은 더 가까운 줄을 덮어쓰지 않는다", () => {
    const book = createBook(ROWS, RATE);
    applyFrame(book, TRUE, 10);
    const runs = applyFrame(book, TRUE, 9.5);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.row0).toBe(frameRows(TRUE, RATE, ROWS, 9.5)[0]);
    expect(runs[0]!.row1).toBe(frameRows(TRUE, RATE, ROWS, 10)[0]);
  });
  it("4초 동안 프레임이 빠지면 그만큼 구멍이 나고, seek로 메우면 정답과 같아진다", () => {
    const kept = frames().filter((t) => t < 5 || t >= 9);
    const { book, strip } = stitch(kept);
    const before = kept.filter((t) => t < 5).at(-1)!;
    const after = kept.find((t) => t >= 9)!;
    const holes = stripHoles(book, FIRST, END);
    expect(holes).toEqual([{ row0: frameRows(TRUE, RATE, ROWS, before)[1], row1: frameRows(TRUE, RATE, ROWS, after)[0] }]);
    // 브라우저는 옮긴 시각 바로 앞 프레임을 보여 준다 (프레임 경계로 내림)
    const seek = (t: number) => Math.floor(t * FPS + 1e-9) / FPS;
    let rounds = 0;
    for (let left = holes; left.length > 0 && rounds < 4; left = stripHoles(book, FIRST, END), rounds++) {
      const times = refillTimes(left, TRUE, RATE, lastFrame);
      expect(times.length).toBeGreaterThan(0);
      for (const t of times) expect(t).toBeGreaterThanOrEqual(0);
      stitch(times.map(seek), TRUE, book, strip);
    }
    expect(stripHoles(book, FIRST, END)).toEqual([]);
    expect(rounds).toBeLessThanOrEqual(2);
    expect(wrongRows(strip, FIRST, END)).toEqual([]);
  });
  it("깨끗한 영역보다 긴 구멍은 여러 번 옮긴다", () => {
    const span = (TRUE.keyY - TRUE.top - TRUE.margin) / TRUE.speed;
    const hole = { row0: 600, row1: 600 + Math.ceil(span * RATE * 2.5) };
    const times = refillTimes([hole], TRUE, RATE, lastFrame);
    expect(times).toHaveLength(3);
    expect(times[0]).toBeCloseTo(600 / RATE - TRUE.margin / TRUE.speed, 12);
    // 끝 너머(마지막 프레임 뒤)는 마지막 프레임까지만
    expect(refillTimes([{ row0: END - 5, row1: END + 500 }], TRUE, RATE, lastFrame).at(-1)).toBe(lastFrame);
  });
});

describe("stripClock: 템포 지도를 한 번 훑는 초 ↔ 곡 위치 시계", () => {
  const maps: [string, TempoEvent[]][] = [
    ["빈 지도", []],
    ["처음 t150", [{ at: rat(0), bpm: 150 }]],
    [
      "세 번 바뀜 + 같은 자리 둘",
      [
        { at: rat(1), bpm: 90 },
        { at: rat(5, 2), bpm: 200 },
        { at: rat(7, 3), bpm: 72 },
        { at: rat(5, 2), bpm: 60 },
      ],
    ],
    ["마디마다", Array.from({ length: 40 }, (_, i) => ({ at: rat(i), bpm: 80 + ((i * 37) % 90) }))],
  ];
  for (const [name, tempo] of maps)
    it(`${name}: core secondsToWhole·positionToSeconds와 같다`, () => {
      const clock = stripClock(tempo);
      for (let s = -1; s < 60; s += 0.0137) expect(clock.toWhole(s)).toBeCloseTo(secondsToWhole(tempo, s), 9);
      for (let n = 0; n <= 2000; n += 7) {
        const p: Rat = rat(n, 48);
        expect(clock.toSeconds(toFloat(p))).toBeCloseTo(positionToSeconds(tempo, p), 9);
        expect(clock.toWhole(clock.toSeconds(toFloat(p)))).toBeCloseTo(toFloat(p), 9);
      }
    });
  it("템포가 바뀌는 초를 오름차순으로 (곡 처음·같은 초는 하나)", () => {
    const tempo = maps[2]![1];
    const clock = stripClock(tempo);
    expect(clock.bounds).toHaveLength(3);
    expect(clock.bounds[0]).toBeCloseTo(positionToSeconds(tempo, rat(1)), 12);
    expect(clock.bounds[1]).toBeCloseTo(positionToSeconds(tempo, rat(7, 3)), 12);
    expect(clock.bounds[2]).toBeCloseTo(positionToSeconds(tempo, rat(5, 2)), 12);
    expect(stripClock([{ at: rat(0), bpm: 90 }]).bounds).toEqual([]);
  });
});

describe("stripSlices: 보이는 곡 위치를 타일 조각으로", () => {
  const tempo: TempoEvent[] = [
    { at: rat(0), bpm: 120 },
    { at: rat(2), bpm: 90 },
    { at: rat(7, 2), bpm: 150 },
    { at: rat(4), bpm: 61 },
  ];
  const clock = stripClock(tempo);
  const size = { rate: RATE, tileRows: STRIP_TILE_ROWS, rows: 120 * 60 };
  /** 조각의 타일 y 범위를 띠 줄로 되돌린다 */
  const rowsOf = (s: { tile: number; y: number; h: number }) => {
    const r1 = s.tile * STRIP_TILE_ROWS + STRIP_TILE_ROWS - s.y;
    return [r1 - s.h, r1] as const;
  };

  it("템포 바뀜을 건너는 범위: 조각이 이어지고, 조각마다 영상 초 → 곡 위치가 core와 같고 1차식이다", () => {
    const offset = 0.7;
    const range = [1.5, 4.5] as const;
    const slices = stripSlices(clock, range, offset, size);
    expect(slices[0]!.whole0).toBeCloseTo(range[0], 9);
    expect(slices.at(-1)!.whole1).toBeCloseTo(range[1], 9);
    for (let i = 0; i + 1 < slices.length; i++) expect(slices[i + 1]!.whole0).toBeCloseTo(slices[i]!.whole1, 9);
    // 템포 경계 셋(2, 3.5, 4) 모두에서 잘린다
    for (const at of [2, 3.5, 4]) expect(slices.some((s) => Math.abs(s.whole0 - at) < 1e-9)).toBe(true);
    for (const s of slices) {
      expect(s.y).toBeGreaterThanOrEqual(-1e-9);
      expect(s.y + s.h).toBeLessThanOrEqual(STRIP_TILE_ROWS + 1e-9);
      const [r0, r1] = rowsOf(s);
      expect(secondsToWhole(tempo, r0 / RATE - offset)).toBeCloseTo(s.whole0, 9);
      expect(secondsToWhole(tempo, r1 / RATE - offset)).toBeCloseTo(s.whole1, 9);
      // 조각 안은 템포가 하나: 가운데 줄 = 가운데 곡 위치
      expect(secondsToWhole(tempo, (r0 + r1) / 2 / RATE - offset)).toBeCloseTo((s.whole0 + s.whole1) / 2, 9);
      expect(positionToSeconds(tempo, rat(Math.round(s.whole0 * 1e6), 1e6)) + offset).toBeCloseTo(r0 / RATE, 5);
    }
  });
  it("타일 경계에서도 잘린다", () => {
    const slices = stripSlices(stripClock([]), [0, 2], 0, size);
    // 120bpm: 온음표 2개 = 4초 = 480줄 → 타일 0(256줄)과 타일 1
    expect(slices.map((s) => s.tile)).toEqual([0, 1]);
    expect(slices[0]).toMatchObject({ y: 0, h: 256 });
    expect(slices[1]!.h).toBeCloseTo(480 - 256, 9);
    expect(slices[1]!.y).toBeCloseTo(256 - (480 - 256), 9);
    expect(slices[0]!.whole1).toBeCloseTo(256 / RATE / 2, 9);
  });
  it("영상 0초 앞과 띠 끝 뒤는 뺀다", () => {
    // 어긋남 −2초: 곡 0-2초는 영상 앞이라 없다
    const late = stripSlices(clock, [0, 3], -2, size);
    expect(late[0]!.whole0).toBeCloseTo(secondsToWhole(tempo, 2), 9);
    expect(rowsOf(late[0]!)[0]).toBeCloseTo(0, 9);
    expect(stripSlices(clock, [0, 0.5], -2, size)).toEqual([]);
    // 띠(60초) 끝 뒤
    const far = clock.toWhole(70);
    expect(stripSlices(clock, [far, far + 1], 0, size)).toEqual([]);
    const tail = stripSlices(clock, [clock.toWhole(59), far], 0, size);
    expect(tail.at(-1)!.whole1).toBeCloseTo(clock.toWhole(60), 9);
    expect(stripSlices(clock, [3, 3], 0, size)).toEqual([]);
  });
});

describe("tilesForRows: 보이는 줄의 타일", () => {
  const N = STRIP_TILE_ROWS;
  it("경계 끝은 들어가지 않는다", () => {
    expect(tilesForRows(0, N, N, 10)).toEqual([0]);
    expect(tilesForRows(N, 2 * N, N, 10)).toEqual([1]);
    expect(tilesForRows(N - 1, N + 1, N, 10)).toEqual([0, 1]);
    expect(tilesForRows(N - 0.5, N, N, 10)).toEqual([0]);
    expect(tilesForRows(0.5, 3.5 * N, N, 10)).toEqual([0, 1, 2, 3]);
  });
  it("띠 밖과 빈 범위", () => {
    expect(tilesForRows(-50, 5, N, 10)).toEqual([0]);
    expect(tilesForRows(-50, 0, N, 10)).toEqual([]);
    expect(tilesForRows(10 * N, 11 * N, N, 10)).toEqual([]);
    expect(tilesForRows(9 * N + 3, 20 * N, N, 10)).toEqual([9]);
    expect(tilesForRows(5, 5, N, 10)).toEqual([]);
    expect(tilesForRows(0, N, N, 0)).toEqual([]);
  });
  it("타일 캔버스 y는 위가 나중 시각", () => {
    expect(tileY(0, N, 0, N)).toEqual({ y: 0, h: N });
    expect(tileY(0, N, 0, 1)).toEqual({ y: N - 1, h: 1 });
    expect(tileY(2, N, 2 * N + N - 1, 3 * N)).toEqual({ y: 0, h: 1 });
  });
});

describe("stripColumns: 띠 가로 → 음 높이", () => {
  it("기본은 영상 왼쪽 끝 low, 오른쪽 끝 high + 1의 한 조각 (videoMatrix와 같은 규칙)", () => {
    expect(stripColumns(640, { low: 21, high: 108 })).toEqual([{ x0: 0, x1: 640, pitch0: 21, pitch1: 109 }]);
  });
  it("건반 모양 보정의 꺾이는 점을 받으면 조각마다 (폭 0은 뺀다)", () => {
    const cols = stripColumns(100, { low: 60, high: 71 }, [
      { x: 0, pitch: 60 },
      { x: 0.25, pitch: 63 },
      { x: 0.25, pitch: 63 },
      { x: 1, pitch: 72 },
    ]);
    expect(cols).toEqual([
      { x0: 0, x1: 25, pitch0: 60, pitch1: 63 },
      { x0: 25, x1: 100, pitch0: 63, pitch1: 72 },
    ]);
  });
});

describe("resolveStripSpeed: 훑는 동안 잰 속도", () => {
  it("잰 값이 넉넉하면 중앙값을 쓰고, 이어 쓴 값이 3% 넘게 다르면 알린다", () => {
    const r = resolveStripSpeed([199, 201, 200, 198, Number.NaN, 202], 300);
    expect(r.source).toBe("measured");
    expect(r.speed).toBe(200);
    expect(r.variable).toBe(false);
    expect(r.hintOff).toBe(true);
    expect(resolveStripSpeed([199, 201, 200], 202).hintOff).toBe(false);
  });
  it("값이 흩어지면 속도가 바뀌는 영상", () => {
    expect(resolveStripSpeed([150, 200, 250, 200, 180]).variable).toBe(true);
  });
  it("잰 값이 모자라면 이어 쓴 값을 hint로, 그것도 없으면 none", () => {
    expect(resolveStripSpeed([200], 210)).toMatchObject({ speed: 210, source: "hint" });
    expect(resolveStripSpeed([], undefined)).toMatchObject({ speed: undefined, source: "none" });
  });
});
