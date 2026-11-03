/**
 * 떨어지는 음 영상의 속도 재기. 같은 크기로 줄인 회색조 프레임 두 장(앞, dt초 뒤)에서
 * 건반 윗선 위쪽 구간이 세로로 몇 px 내려왔는지 상호상관으로 찾는다. 화면·캔버스와 상관없는 계산만 둔다
 */

/** 줄인 프레임 가로 폭(px). 64~128 사이 (넓을수록 이동을 곱게 잰다) */
export const SPEED_FRAME_WIDTH = 128;
/** 두 프레임 사이 시간(초) */
export const SPEED_FRAME_GAP = 0.25;
/** 이보다 상관이 낮으면 실패로 본다 (장면 전환, 무늬가 없는 화면 등) */
export const SPEED_MIN_SCORE = 0.6;

/** RGBA 바이트를 회색조(0~1)로 */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = (0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!) / 255;
  return out;
}

/** 앞 프레임 a의 줄 y - shift와 뒤 프레임 b의 줄 y를 맞댄 정규화 상관 (겹치는 줄 [shift, rows)). 무늬가 없으면 0 */
function correlation(a: Float32Array, b: Float32Array, width: number, rows: number, shift: number): number {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let y = shift; y < rows; y++)
    for (let x = 0; x < width; x++) {
      sa += a[(y - shift) * width + x]!;
      sb += b[y * width + x]!;
      n++;
    }
  if (n === 0) return 0;
  const ma = sa / n;
  const mb = sb / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let y = shift; y < rows; y++)
    for (let x = 0; x < width; x++) {
      const da = a[(y - shift) * width + x]! - ma;
      const db = b[y * width + x]! - mb;
      ab += da * db;
      aa += da * da;
      bb += db * db;
    }
  if (aa < 1e-6 || bb < 1e-6) return 0;
  return ab / Math.sqrt(aa * bb);
}

/**
 * 앞 프레임 a에서 뒤 프레임 b로 무늬가 아래로 내려온 줄 수 (소수, 이웃 상관으로 다듬음).
 * rows: 맞댈 줄 수 (건반 윗선 위쪽 구간). maxShift: 찾을 가장 큰 이동 (rows의 절반을 넘지 않게).
 * 움직임이 없거나(0이 가장 잘 맞음) 상관이 낮으면 undefined
 */
export function fallShift(a: Float32Array, b: Float32Array, width: number, rows: number, maxShift = Math.floor(rows / 2)): { shift: number; score: number } | undefined {
  const most = Math.max(0, Math.min(maxShift, Math.floor(rows / 2)));
  const scores: number[] = [];
  for (let s = 0; s <= most; s++) scores.push(correlation(a, b, width, rows, s));
  let best = 0;
  for (let s = 1; s < scores.length; s++) if (scores[s]! > scores[best]!) best = s;
  const score = scores[best]!;
  if (best === 0 || score < SPEED_MIN_SCORE) return undefined;
  // 이웃 셋으로 포물선 꼭짓점 (한 칸 안에서 다듬는다)
  let shift = best;
  const l = scores[best - 1];
  const r = scores[best + 1];
  if (l !== undefined && r !== undefined) {
    const den = l - 2 * score + r;
    if (den < 0) shift = best + Math.max(-0.5, Math.min(0.5, (l - r) / (2 * den)));
  }
  return { shift, score };
}

/** 줄인 프레임에서 잰 이동(줄)을 원본 영상 px/초로. scale = 원본 세로 / 줄인 세로 (가로·세로를 같은 비율로 줄였으면 원본 가로 / 줄인 가로) */
export function fallSpeed(shift: number, scale: number, seconds = SPEED_FRAME_GAP): number {
  return (shift * scale) / seconds;
}

/*
 * 실제 영상에서 재기 (2026-11-02, 떨어지는 음 영상 3개로 시험: 프로젝트 파일 mmlce/research/배경영상/실영상_측정.md).
 * 건반 윗선 위 전체를 한 번만 맞대면, 위쪽 제목 글자처럼 안 움직이는 그림이 있는 영상은 늘 실패하고(0px가 가장 잘 맞음),
 * 안개·빛 효과가 있는 영상은 6-12% 작게 나왔다. 그래서 위쪽과 건반 선 바로 위를 빼고, 밝기 대신 세로 밝기 차(막대의 위아래 끝)를
 * 맞대고, 여러 쌍을 재서 값이 모일 때만 받는다. 30fps를 60fps로 담은 영상은 같은 그림이 두 번씩 나오므로 그림이 처음 나온 시각을 쓴다
 */

/** 속도 재기에서 빼는 위쪽 비율 (영상 높이 기준. 제목·워터마크) */
export const SPEED_TOP = 0.15;
/** 건반 윗선 위쪽 구간 가운데 아래에서 빼는 비율 (건반 선 바로 위 불꽃·안개·빛 효과) */
export const SPEED_EFFECT_CUT = 0.2;
/** 한 자리에서 잴 프레임 쌍 수와 쌍 사이 간격(초) */
export const SPEED_PAIRS = 5;
export const SPEED_PAIR_STEP = 0.75;
/** 쌍마다 잰 값 가운데 중앙값에서 SPEED_TOLERANCE 비율 안에 SPEED_AGREE개 이상 모여야 받는다 */
export const SPEED_AGREE = 4;
export const SPEED_TOLERANCE = 0.02;
/**
 * 속도를 잴 때 세로를 가로(SPEED_FRAME_WIDTH)보다 이만큼 촘촘히 줄인다. 0.25초 이동이 5줄 남짓이면 이웃 상관 포물선이 정수 쪽으로
 * 쏠려 쌍마다 ±4%까지 흩어졌다(합성 영상). 4배면 실영상 3개에서 받은 값 오차가 1% 안이었다
 */
export const SPEED_ROW_SCALE = 4;
/** 첫 자리에서 못 재면 이만큼(초) 뒤에서 한 번 더 잰다 */
export const SPEED_RETRY_AFTER = 5;
/**
 * 두 회색조 그림의 칸마다 차가 모두 이보다 작으면 같은 그림으로 본다. 실영상에서 같은 그림 두 장은 0.008 안,
 * 다른 그림은 거의 늘 0.1 넘게 다른 칸이 있었다 (평균 차는 음이 드문 화면에서 너무 작아 쓰지 않는다)
 */
export const SPEED_SAME_FRAME = 0.03;

/**
 * 줄인 프레임(세로 height줄)에서 속도를 잴 줄 범위 [top, top + rows).
 * keyLine: 건반 윗선 자리(영상 높이 비율). 남는 줄이 8줄보다 적으면 undefined (건반 선이 너무 위에 있음)
 */
export function speedBand(height: number, keyLine: number): { top: number; rows: number } | undefined {
  const top = Math.floor(height * SPEED_TOP);
  const bottom = Math.floor(height * keyLine * (1 - SPEED_EFFECT_CUT));
  const rows = bottom - top;
  return rows >= 8 ? { top, rows } : undefined;
}

/** 회색조 그림의 세로 밝기 차 (줄 y = 원래 줄 y+1 − 줄 y, rows − 1줄). 안개처럼 넓게 번지는 밝기는 거의 0이 되고 막대 끝만 남는다 */
export function rowDiff(gray: Float32Array, width: number, rows: number): Float32Array {
  const out = new Float32Array(Math.max(0, rows - 1) * width);
  for (let y = 0; y + 1 < rows; y++)
    for (let x = 0; x < width; x++) out[y * width + x] = gray[(y + 1) * width + x]! - gray[y * width + x]!;
  return out;
}

/** 두 회색조 그림이 같은 그림인지 (칸마다 차가 모두 SPEED_SAME_FRAME보다 작음) */
export function sameFrame(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) >= SPEED_SAME_FRAME) return false;
  return true;
}

/** 한 자리(from초)에서 잴 프레임 쌍의 앞 시각들. 뒤 프레임(+SPEED_FRAME_GAP)이 영상 끝을 넘는 쌍은 뺀다 (길이를 모르면 다 둔다) */
export function speedPairTimes(from: number, duration: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < SPEED_PAIRS; k++) {
    const t = Math.max(0, from) + k * SPEED_PAIR_STEP;
    if (Number.isFinite(duration) && t + SPEED_FRAME_GAP > duration) break;
    out.push(t);
  }
  return out;
}

/**
 * 쌍마다 잰 속도들에서 하나 고르기: 중앙값에서 SPEED_TOLERANCE 안에 든 값이 SPEED_AGREE개 이상이면 그 값들의 평균, 아니면 undefined.
 * 효과·자막 때문에 쌍마다 값이 흩어지는 자리에서 틀린 값을 조용히 넣지 않고 직접 재기로 넘기기 위한 것.
 * frameTimes = false: 브라우저가 프레임 시각을 알려 주지 않아(requestVideoFrameCallback 없음) 옮겨 달라고 한 시각으로 나눈 값들.
 * 그러면 프레임 간격만큼 늘 흩어지므로 모이기를 따지지 않고 3개 이상의 중앙값을 쓴다 (전과 같은 정도의 정확도)
 */
export function agreeSpeed(values: readonly number[], frameTimes = true): number | undefined {
  const ok = values.filter((v) => Number.isFinite(v) && v > 0);
  const sorted = [...ok].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  if (!frameTimes) return ok.length >= 3 ? median : undefined;
  if (ok.length < SPEED_AGREE) return undefined;
  const close = ok.filter((v) => Math.abs(v - median) <= SPEED_TOLERANCE * median);
  if (close.length < SPEED_AGREE) return undefined;
  return close.reduce((s, v) => s + v, 0) / close.length;
}

/** 직접 재기 단계: 0 아님, 1 첫 점 누르기, 2 "0.5초 앞으로" 기다리기, 3 같은 음 다시 누르기 */
export type SpeedStep = 0 | 1 | 2 | 3;
/** 직접 재기에서 "0.5초 앞으로" 옮기는 시간(초) */
export const SPEED_PICK_GAP = 0.5;

/**
 * 직접 재기 중 롤을 눌렀을 때. y: 누른 자리의 영상 원본 세로 좌표(모르면 undefined), firstY: 첫 점.
 * 재는 중(1·2·3단계)이면 누름은 늘 재기가 가져가고(consumed) 보통 편집으로 가지 않는다.
 * 2단계("0.5초 앞으로"를 기다림)의 누름은 아무것도 바꾸지 않는다. 3단계에서 두 점이 모이면 done과 속도(아래로 내려왔을 때만)
 */
export function speedPickPress(
  step: SpeedStep,
  firstY: number | undefined,
  y: number | undefined,
): { consumed: boolean; step: SpeedStep; firstY: number | undefined; done?: { speed: number | undefined } } {
  if (step === 0) return { consumed: false, step, firstY };
  if (step === 1 && y !== undefined) return { consumed: true, step: 2, firstY: y };
  if (step === 3 && y !== undefined && firstY !== undefined) {
    const speed = (y - firstY) / SPEED_PICK_GAP;
    return { consumed: true, step: 0, firstY: undefined, done: { speed: speed > 0 ? speed : undefined } };
  }
  return { consumed: true, step, firstY };
}

/**
 * 재는 중에 영상이 없어지거나, 다른 영상으로 바뀌거나, 건반 맞춤이 꺼졌으면 재기를 그만둬야 한다.
 * 곡이 바뀌어도(막지 못한 다른 길로 고쳤거나 다른 곡을 열었으면) 그만둔다: 재기는 시작할 때의 곡 위에서만 이어 간다
 */
export function speedPickLost<S>(
  step: SpeedStep,
  pick: { readonly url: string; readonly song: S } | undefined,
  video: { readonly url: string; readonly fit: boolean } | undefined,
  song: S,
): boolean {
  return step !== 0 && (!pick || !video?.fit || video.url !== pick.url || song !== pick.song);
}

/**
 * 재는 동안(1·2·3단계)의 규칙 하나: 곡을 바꾸는 입구는 모두 닫는다 (단축키·메뉴·휠·더블클릭·롤 키·MIDI 건반·글 입력).
 * 그동안에도 받는 명령은 곡도 화면도 바꾸지 않는 저장뿐이다. 그만두기는 Esc나 도구줄의 취소
 */
export function speedPickAllows(step: SpeedStep, command: string): boolean {
  return step === 0 || command.startsWith("file.save");
}

/**
 * 재는 중 휠: 볼륨·템포는 바꾸지 않는다. 첫 점을 고르기 전(1단계)에만 화면을 굴리거나 확대해 영상 속 음을 찾을 수 있고,
 * 첫 점을 고른 뒤(2·3단계)에는 화면 자리 자체가 재는 값(0.5초)이라 휠을 버린다
 */
export function speedPickWheel(step: SpeedStep): "edit" | "view" | "none" {
  return step === 0 ? "edit" : step === 1 ? "view" : "none";
}
