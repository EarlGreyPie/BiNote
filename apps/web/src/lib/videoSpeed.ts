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

/** 줄인 프레임에서 잰 이동(줄)을 원본 영상 px/초로. scale = 원본 가로 / 줄인 가로 */
export function fallSpeed(shift: number, scale: number, seconds = SPEED_FRAME_GAP): number {
  return (shift * scale) / seconds;
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
