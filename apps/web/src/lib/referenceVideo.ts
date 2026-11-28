/**
 * 원곡 영상 띄우기: 원곡을 영상 파일로 불러왔을 때 그 화면을 떠 있는 작은 창(PC는 PiP도)으로 보여 준다.
 * 원곡 소리는 그대로 엔진이 내고, 영상은 소리 없이 원곡과 같은 자리를 따라간다.
 */

/** 영상으로 볼 만한 원곡 파일인지 (형식이 비어 있으면 확장자로 본다) */
const VIDEO_EXT = [".mp4", ".m4v", ".mov", ".webm", ".mkv", ".ogv", ".avi"];
export function isVideoFile(file: { name: string; type: string }): boolean {
  if (file.type) return file.type.startsWith("video/");
  const lower = file.name.toLowerCase();
  return VIDEO_EXT.some((ext) => lower.endsWith(ext));
}

/**
 * 곡 시간(초)에 맞는 원곡 영상의 시간(초). 엔진이 원곡 소리를 트는 자리(곡 시간 + 어긋남)와 같다.
 * 원곡이 아직 시작 전이면 음수가 나온다 (영상은 첫 장면에 멈춰 기다린다)
 */
export function referenceVideoTime(songSeconds: number, offsetMs: number): number {
  return songSeconds + offsetMs / 1000;
}

/** 떠 있는 창의 자리·크기 (화면 픽셀) */
export interface FloatBox {
  x: number;
  y: number;
  width: number;
}

export const FLOAT_MIN_WIDTH = 160;
/** 머리줄이 화면 안에 남아야 할 최소 픽셀 (다시 잡아 끌 수 있게) */
const KEEP_VISIBLE = 48;

/** 기본 자리: 오른쪽 아래, 화면 폭의 1/3 (240~480px) */
export function defaultFloatBox(viewW: number, viewH: number): FloatBox {
  const width = Math.round(Math.min(480, Math.max(240, viewW / 3)));
  const height = Math.round((width * 9) / 16) + 32;
  return clampFloatBox({ x: viewW - width - 16, y: viewH - height - 64, width }, viewW, viewH);
}

/** 창이 화면 밖으로 사라지지 않게 자리와 폭을 줄인다 (화면을 돌리거나 창 크기를 바꿨을 때) */
export function clampFloatBox(box: FloatBox, viewW: number, viewH: number): FloatBox {
  const width = Math.max(FLOAT_MIN_WIDTH, Math.min(box.width, Math.max(FLOAT_MIN_WIDTH, viewW - 16)));
  const x = Math.min(Math.max(box.x, KEEP_VISIBLE - width), Math.max(0, viewW - KEEP_VISIBLE));
  const y = Math.min(Math.max(box.y, 0), Math.max(0, viewH - KEEP_VISIBLE));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width) };
}

/** 저장해 둔 자리 글을 읽는다 (틀리면 undefined) */
export function parseFloatBox(text: string | null | undefined): FloatBox | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text) as Partial<FloatBox>;
    if ([v.x, v.y, v.width].every((n) => typeof n === "number" && Number.isFinite(n))) return { x: v.x!, y: v.y!, width: v.width! };
  } catch {
    // 깨진 값은 버린다
  }
  return undefined;
}
