import { loadStored, saveStored } from "./persist";

/**
 * 음량 레인 보기 설정 (롤·타브가 함께 쓴다). 보기 설정이라 곡 파일에는 넣지 않고 이 브라우저에 기억한다.
 * compact = 얇은 띠에 막대 모양만(평소), expanded = 크게(높이 끌어 조절), collapsed = 접어 단추만
 */
export type LaneState = "collapsed" | "compact" | "expanded";
export type LaneMode = "brush" | "line";

/** 축약 상태 두께 */
export const LANE_COMPACT = 24;
/** 펼친 상태 두께 범위 */
export const LANE_MIN = 48;
/** 펜으로 긋기 편하게 크게 키울 수 있다 (롤에서는 음 칸이 너무 좁아지지 않게 더 줄인다) */
export const LANE_MAX = 360;
export const LANE_DEFAULT = 120;

const KEY = "mmlce.volumeLane";

interface Stored {
  state: LaneState;
  size: number;
  mode: LaneMode;
  /** 여러 트랙에 그릴 때 멜로디 아닌 음의 높이 자리마다 더하는 차이 */
  offsets: { top: number; middle: number; bottom: number };
}

/** EarlGreyPie 악보 습관에서 온 기본값: 화음은 멜로디보다 낮게, 안쪽 성부를 가장 낮게 */
const DEFAULT_OFFSETS = { top: 0, middle: -3, bottom: -1 };

function offsetOf(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.min(15, Math.max(-15, Math.round(raw))) : fallback;
}

function load(): Stored {
  // 폰 폭은 처음에 접어 둔다 (음 칸이 좁아서)
  const phone = typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches;
  const fallback: Stored = { state: phone ? "collapsed" : "compact", size: LANE_DEFAULT, mode: "brush", offsets: { ...DEFAULT_OFFSETS } };
  return loadStored(KEY, (raw) => {
    if (!raw) return fallback;
    try {
      const o = JSON.parse(raw) as Partial<Stored>;
      return {
        state: o.state === "collapsed" || o.state === "expanded" || o.state === "compact" ? o.state : fallback.state,
        size: typeof o.size === "number" ? Math.min(LANE_MAX, Math.max(LANE_MIN, Math.round(o.size))) : LANE_DEFAULT,
        mode: o.mode === "line" ? "line" : "brush",
        offsets: {
          top: offsetOf(o.offsets?.top, DEFAULT_OFFSETS.top),
          middle: offsetOf(o.offsets?.middle, DEFAULT_OFFSETS.middle),
          bottom: offsetOf(o.offsets?.bottom, DEFAULT_OFFSETS.bottom),
        },
      };
    } catch {
      return fallback;
    }
  });
}

export const volumeLane = $state<Stored>(load());

export function saveVolumeLane(change: Partial<Stored>): void {
  Object.assign(volumeLane, change);
  saveStored(KEY, JSON.stringify({ state: volumeLane.state, size: volumeLane.size, mode: volumeLane.mode, offsets: volumeLane.offsets }));
}

/** 지금 상태의 값 칸 두께 (접으면 0) */
export function laneThickness(): number {
  return volumeLane.state === "collapsed" ? 0 : volumeLane.state === "compact" ? LANE_COMPACT : volumeLane.size;
}
