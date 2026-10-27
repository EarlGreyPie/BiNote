import { cmp, DEFAULT_BPM, defaultLengthLimit, isGameLength, mul, normalizeTempo, rat, toFloat, type LengthLimit, type Rat, type TempoEvent } from "@mmlce/core";

/**
 * 피아노롤 좌표 계산. 가로는 시간이 오른쪽으로 흐르고 건반이 왼쪽,
 * 세로는 떨어지는 음 영상처럼 시간이 위로 흐르고 건반이 아래에 있다.
 * 시간 축 값은 온음표 단위 소수, 음 높이는 MIDI 번호다.
 */
export type Orientation = "horizontal" | "vertical";

export interface RollView {
  readonly orientation: Orientation;
  readonly width: number;
  readonly height: number;
  /** 시간 축이 시작하는 곡 위치 */
  readonly start: number;
  readonly pxPerWhole: number;
  /** 가로: 맨 위 음, 세로: 맨 왼쪽 음 */
  readonly edgePitch: number;
  readonly pxPerKey: number;
  /** 건반 띠 두께 */
  readonly keyboard: number;
  /**
   * 음 축 끝에 떼어 둔 음량 레인 두께 (값 칸 + 시간 스크롤바 칸, 없으면 0).
   * 가로 롤은 아래, 세로 롤은 오른쪽이고 음은 그 안쪽까지만 그린다
   */
  readonly lane?: number;
  /** 레인 끝의 스크롤바 칸 (없으면 LANE_GUTTER) */
  readonly laneGutter?: number;
  /** 이벤트 줄 한 칸 두께 (없으면 EVENT_ROW). 설정의 이벤트 줄 글자 크기를 따른다(eventRowFor) */
  readonly eventRow?: number;
  /** 마디 번호 줄 두께 (없으면 BAR_ROW). 화면 배율을 따른다 */
  readonly barRow?: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function noteRect(v: RollView, start: number, dur: number, pitch: number): Rect {
  if (v.orientation === "horizontal") {
    return {
      x: v.keyboard + (start - v.start) * v.pxPerWhole,
      y: (v.edgePitch - pitch) * v.pxPerKey,
      w: dur * v.pxPerWhole,
      h: v.pxPerKey,
    };
  }
  const base = v.height - v.keyboard;
  return {
    x: (pitch - v.edgePitch) * v.pxPerKey,
    y: base - (start + dur - v.start) * v.pxPerWhole,
    w: v.pxPerKey,
    h: dur * v.pxPerWhole,
  };
}

/** 화면 위치를 (시간, 음)으로. 건반 띠 위면 time이 없다 */
export function fromScreen(v: RollView, x: number, y: number): { time?: number; pitch: number } {
  if (v.orientation === "horizontal") {
    const pitch = v.edgePitch - Math.floor(y / v.pxPerKey);
    return x < v.keyboard ? { pitch } : { time: v.start + (x - v.keyboard) / v.pxPerWhole, pitch };
  }
  const pitch = Math.floor(x / v.pxPerKey) + v.edgePitch;
  const base = v.height - v.keyboard;
  return y > base ? { pitch } : { time: v.start + (base - y) / v.pxPerWhole, pitch };
}

/** 곡 위치의 시간 축 화면 좌표 (재생선·마디선 그리기) */
export function timeToScreen(v: RollView, time: number): number {
  return v.orientation === "horizontal"
    ? v.keyboard + (time - v.start) * v.pxPerWhole
    : v.height - v.keyboard - (time - v.start) * v.pxPerWhole;
}

/** 시간 축 길이(px)와 음 축 길이(px) */
export function axes(v: RollView): { time: number; pitch: number } {
  const lane = v.lane ?? 0;
  return v.orientation === "horizontal"
    ? { time: v.width - v.keyboard, pitch: v.height - lane }
    : { time: v.height - v.keyboard, pitch: v.width - lane };
}

/** 보이는 시간 범위 [from, to) */
export function visibleTime(v: RollView): [number, number] {
  return [v.start, v.start + axes(v).time / v.pxPerWhole];
}

/** 보이는 음 범위 [low, high] */
export function visiblePitch(v: RollView): [number, number] {
  const count = Math.ceil(axes(v).pitch / v.pxPerKey);
  return v.orientation === "horizontal" ? [v.edgePitch - count + 1, v.edgePitch] : [v.edgePitch, v.edgePitch + count - 1];
}

/** 격자(온음표의 1/division)에 맞춰 내린 위치 */
export function snapDown(time: number, division: number): Rat {
  return rat(Math.max(0, Math.floor(time * division + 1e-9)), division);
}

/**
 * 화면 위치(소수)를 편집에 쓸 분수로. 격자 칸(1/division) 위에 있으면 그 칸 그대로 (1/28·1/20처럼 1/960에 안 맞는 칸도
 * 반올림하지 않는다), 칸 밖이면 1/960 칸 (예전 동작)
 */
export function exactTime(time: number, division: number): Rat {
  const k = Math.round(time * division);
  if (Math.abs(time * division - k) < 1e-6) return rat(Math.max(0, k), division);
  return rat(Math.max(0, Math.round(time * 960)), 960);
}

/** 가장 가까운 격자 위치 */
export function snapNearest(time: number, division: number): Rat {
  return rat(Math.max(0, Math.round(time * division)), division);
}

const BLACK = new Set([1, 3, 6, 8, 10]);
export function isBlackKey(pitch: number): boolean {
  return BLACK.has(((pitch % 12) + 12) % 12);
}

/**
 * 실제 피아노처럼 그린 건반 띠에서 흰건반 사이 경계 (음 높이 단위, 음 p의 칸은 [p, p+1)).
 * 위로 검은건반이 붙은 흰건반은 그 검은건반 칸 가운데에서, 아니면(E–F, B–C) 칸 경계에서 나뉜다
 */
export function whiteKeyEdges(low: number, high: number): number[] {
  const out: number[] = [];
  for (let p = low; p <= high; p++) {
    if (isBlackKey(p)) continue;
    out.push(isBlackKey(p + 1) ? p + 1.5 : p + 1);
  }
  return out;
}

/** 건반 띠에서 검은건반 길이 (흰건반 길이에 대한 비율) */
export const BLACK_KEY_LENGTH = 0.6;

/** MIDI 번호의 MML 옥타브 (o4c = 60) */
export function octaveOf(pitch: number): number {
  return Math.floor(pitch / 12) - 1;
}

/** 배경에 깔아 둘 로컬 영상 (떨어지는 음 영상을 보고 찍을 때) */
export interface BackgroundVideo {
  readonly url: string;
  readonly opacity: number;
  /** 곡 시간에 더할 영상 시간(초) */
  readonly offset: number;
  readonly sound: boolean;
  /** 영상 속 건반을 롤 건반에 맞춘다. 끄면 롤 크기에 그냥 늘여 깐다 */
  readonly fit: boolean;
  /**
   * 영상 왼쪽 끝 건반과 오른쪽 끝 건반 (MIDI 번호). 롤 위 손잡이로 끌어 맞추면 소수가 된다:
   * 영상 왼쪽 끝이 음 높이 좌표 low, 오른쪽 끝이 high + 1에 온다
   */
  readonly low: number;
  readonly high: number;
  /** 영상 속 건반 윗선 위치 (영상 높이 대비 0~1, 위에서부터) */
  readonly keyLine: number;
  /** 시간 축으로 늘이는 배율. 영상의 음 떨어지는 속도를 롤 확대에 맞출 때 쓴다 */
  readonly stretch: number;
  /** 롤 위에 맞춤 손잡이(왼쪽 끝·오른쪽 끝·건반 윗선)를 보인다 */
  readonly handles?: boolean;
  /**
   * 화면 채우기: stretch를 자동으로 정해 건반 윗선부터 영상 위 끝까지가 롤 시간 축의 보이는 길이 전체를 덮게 한다 (fillStretch).
   * 없으면 켬. 끄면 stretch(시간 늘이기)를 직접 정한다
   */
  readonly fill?: boolean;
  /** 잰 영상 속 음이 떨어지는 속도 (원본 영상 px/초). 있으면 롤 가로 확대를 이 속도에 맞춘다 (matchRollZoom) */
  readonly speed?: number;
}

/** 88건반 떨어지는 음 영상에 흔한 값 */
export const VIDEO_DEFAULTS = { fit: true, low: 21, high: 108, keyLine: 0.85, stretch: 1, fill: true } as const;

/** 시간 늘이기(stretch)로 쓸 수 있는 범위 */
export const STRETCH_MIN = 0.1;
export const STRETCH_MAX = 10;

/**
 * 화면 채우기: 건반 윗선부터 영상 위 끝까지(영상 높이 × keyLine)가 롤 시간 축의 보이는 길이 전체
 * (가로 롤: 건반 띠 오른쪽 끝 ~ 롤 오른쪽 끝, 세로 롤: 건반 띠 위 ~ 롤 위 끝)를 덮게 하는 stretch.
 * 영상의 건반 쪽 끝은 그대로 건반 선에 붙고 위쪽만 늘어난다. STRETCH_MIN ~ STRETCH_MAX로 자른다
 */
export function fillStretch(v: RollView, video: Pick<BackgroundVideo, "low" | "high" | "keyLine">, videoWidth: number, videoHeight: number): number {
  const keys = Math.max(1, video.high + 1 - video.low);
  const along = (keys * v.pxPerKey) / Math.max(1, videoWidth);
  const above = video.keyLine * videoHeight * along;
  if (!(above > 0)) return STRETCH_MAX;
  return Math.min(STRETCH_MAX, Math.max(STRETCH_MIN, axes(v).time / above));
}

/** 영상 원본 px → 롤 화면 px의 시간 축 배율 (videoMatrix의 time) */
export function videoTimeScale(v: RollView, video: Pick<BackgroundVideo, "low" | "high" | "stretch">, videoWidth: number): number {
  const keys = Math.max(1, video.high + 1 - video.low);
  return ((keys * v.pxPerKey) / Math.max(1, videoWidth)) * video.stretch;
}

/**
 * 롤 가로 확대(온음표 하나의 px). 화면에서 영상 속 음이 떨어지는 속도(화면 px/초)가 롤의 px/초가 되게:
 * 온음표 하나 = 240 / bpm초이므로 pxPerWhole = 화면 px/초 × 240 / bpm
 */
export function matchRollZoom(screenPxPerSec: number, bpm: number): number {
  return (screenPxPerSec * 240) / Math.max(1e-6, bpm);
}

/** 곡 위치(온음표 단위)의 템포 (bpm) */
export function bpmAt(tempo: readonly TempoEvent[], whole: number): number {
  let bpm = DEFAULT_BPM;
  for (const e of normalizeTempo(tempo)) {
    if (toFloat(e.at) > whole) break;
    bpm = e.bpm;
  }
  return bpm;
}

/** 곡 안에서 템포가 바뀌는지 (영상 속도 맞추기는 한 템포로만 맞는다) */
export function tempoChanges(tempo: readonly TempoEvent[]): boolean {
  return new Set(normalizeTempo(tempo).map((e) => e.bpm)).size > 1;
}

/**
 * 영상 픽셀(가로 = 음, 세로 = 시간, 아래가 건반)을 롤 화면으로 옮기는 CSS matrix.
 * 영상 요소는 원래 픽셀 크기로 두고 transform-origin 0 0으로 이 행렬을 건다.
 */
export function videoMatrix(
  v: RollView,
  video: Pick<BackgroundVideo, "low" | "high" | "keyLine" | "stretch">,
  videoWidth: number,
  videoHeight: number,
): [number, number, number, number, number, number] {
  const keys = Math.max(1, video.high + 1 - video.low);
  const along = (keys * v.pxPerKey) / videoWidth;
  const time = along * video.stretch;
  const line = video.keyLine * videoHeight * time;
  if (v.orientation === "vertical") {
    return [along, 0, 0, time, (video.low - v.edgePitch) * v.pxPerKey, v.height - v.keyboard - line];
  }
  // 가로: 영상 세로(시간)가 화면 가로로, 영상 가로(음)가 화면 세로로 간다. 높은 음이 위
  return [0, -along, -time, 0, v.keyboard + line, (v.edgePitch - video.low + 1) * v.pxPerKey];
}

/** 음 높이 좌표(칸 경계, 음 p의 칸은 [p, p+1))를 음 축 화면 좌표로 (세로 롤 x, 가로 롤 y) */
export function pitchToScreen(v: RollView, pitch: number): number {
  return v.orientation === "vertical" ? (pitch - v.edgePitch) * v.pxPerKey : (v.edgePitch + 1 - pitch) * v.pxPerKey;
}

/** 음 축 화면 좌표를 음 높이 좌표(소수)로. pitchToScreen의 반대 */
export function screenToPitch(v: RollView, along: number): number {
  return v.orientation === "vertical" ? v.edgePitch + along / v.pxPerKey : v.edgePitch + 1 - along / v.pxPerKey;
}

/**
 * 롤이 보여 줄 음 범위 [low, high] 밖이 화면에 나오지 않게 칸 크기와 기준 음을 고친다.
 * 넓은 화면에서 칸이 너무 작아 범위보다 많은 건반이 보이면 칸을 키워 범위를 꽉 채운다
 */
export function clampPitchView(v: RollView, low: number, high: number): { pxPerKey: number; edgePitch: number } {
  const axis = axes(v).pitch;
  const pxPerKey = Math.max(v.pxPerKey, axis / (high - low + 1));
  // 끝에 반쯤 보이는 칸도 센다 (그 칸도 그려지고 눌린다)
  const count = Math.max(1, Math.ceil(axis / pxPerKey - 1e-6));
  const edgePitch =
    v.orientation === "horizontal"
      ? Math.min(high, Math.max(low + count - 1, Math.round(v.edgePitch)))
      : Math.max(low, Math.min(high - count + 1, Math.round(v.edgePitch)));
  return { pxPerKey, edgePitch };
}

/** 영상 건반 범위(low ~ high)가 음 축을 꽉 채우게 하는 칸 크기와 기준 음 */
export function fitVideoKeys(v: RollView, video: Pick<BackgroundVideo, "low" | "high">): { pxPerKey: number; edgePitch: number } {
  const low = Math.floor(video.low);
  const high = Math.ceil(video.high + 1) - 1;
  const pxPerKey = axes(v).pitch / Math.max(1, high - low + 1);
  return { pxPerKey, edgePitch: v.orientation === "horizontal" ? high : low };
}

/**
 * 건반 윗선 손잡이를 끈 만큼 영상을 옮기는 새 keyLine.
 * away = 건반 띠에서 멀어지는 쪽으로 끈 거리(px, 세로 롤은 위, 가로 롤은 오른쪽)
 */
export function dragKeyLine(
  v: RollView,
  video: Pick<BackgroundVideo, "low" | "high" | "keyLine" | "stretch">,
  videoWidth: number,
  videoHeight: number,
  away: number,
): number {
  const keys = Math.max(1e-3, video.high + 1 - video.low);
  const time = ((keys * v.pxPerKey) / videoWidth) * video.stretch;
  return Math.min(1, Math.max(0, video.keyLine + away / (videoHeight * time)));
}

/**
 * 건반 띠에서 누른 건반. 그린 모양과 같게 판정한다: 롤 쪽 BLACK_KEY_LENGTH 안에서는 검은건반(칸 가운데 80%),
 * 그 밖은 흰건반 (위로 검은건반이 붙은 흰건반은 그 검은건반 칸 가운데까지 넓다)
 */
export function keyAt(v: RollView, x: number, y: number): number {
  const horizontal = v.orientation === "horizontal";
  const u = horizontal ? v.edgePitch + 1 - y / v.pxPerKey : v.edgePitch + x / v.pxPerKey;
  const depth = horizontal ? v.keyboard - x : y - (v.height - v.keyboard);
  const p = Math.floor(u);
  const frac = u - p;
  if (depth <= v.keyboard * BLACK_KEY_LENGTH && isBlackKey(p) && frac >= 0.1 && frac <= 0.9) return p;
  for (const w of [p - 1, p, p + 1]) {
    if (isBlackKey(w)) continue;
    const lower = isBlackKey(w - 1) ? w - 0.5 : w;
    const upper = isBlackKey(w + 1) ? w + 1.5 : w + 1;
    if (u >= lower && u < upper) return w;
  }
  return p;
}

/** 피아노롤 도구: 넣기(펜) · 고르기(상자) · 지우개 · 가위(음 자르기) */
export type RollTool = "pen" | "select" | "eraser" | "split" | "reverb";

/** 음 끝에서 이만큼 안쪽을 잡으면 길이 바꾸기 (손가락·펜은 넓게). 음 폭의 1/3을 넘지 않는다 */
const EDGE_PX = 6;
const EDGE_TOUCH_PX = 10;
/** 이보다 좁게 그려지는 음은 이 폭이 되도록 누를 자리를 넓힌다 (그린 음과 누르는 자리를 맞춘다) */
const TARGET_PX = 8;
const TARGET_TOUCH_PX = 14;

/**
 * 누른 자리(time, pitch)의 음. 정확히 맞은 음이 먼저이고, 없으면 좁게 그려진 음 가운데
 * 넓힌 자리에 든 가장 가까운 음. pxPerWhole = 온음표 하나의 화면 길이
 */
export function noteNear<N extends { start: Rat; dur: Rat; pitch: number }>(
  notes: readonly N[],
  time: number,
  pitch: number,
  pxPerWhole: number,
  touch = false,
): N | undefined {
  const exact = notes.find((n) => n.pitch === pitch && toFloat(n.start) <= time && time < toFloat(n.start) + toFloat(n.dur));
  if (exact) return exact;
  const target = touch ? TARGET_TOUCH_PX : TARGET_PX;
  let best: N | undefined;
  let bestGap = Infinity;
  for (const n of notes) {
    if (n.pitch !== pitch) continue;
    const w = toFloat(n.dur) * pxPerWhole;
    if (w >= target) continue;
    const s = toFloat(n.start);
    const gap = (time < s ? s - time : time - (s + toFloat(n.dur))) * pxPerWhole;
    if (gap <= (target - w) / 2 && gap < bestGap) {
      best = n;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * 음을 잡은 자리가 길이 바꾸기 자리인지. 넉넉한 음은 끝에서 EDGE_PX(음 폭 1/3까지) 안쪽,
 * 좁은 음은 그린 끝 바깥(넓힌 자리)을 잡아야 길이 바꾸기라서 몸통을 잡으면 늘 옮기기다
 */
export function isResizeGrab(n: { start: Rat; dur: Rat }, time: number, pxPerWhole: number, touch = false): boolean {
  const w = toFloat(n.dur) * pxPerWhole;
  const endPx = (toFloat(n.start) + toFloat(n.dur) - time) * pxPerWhole;
  if (w < (touch ? TARGET_TOUCH_PX : TARGET_PX)) return endPx <= 0;
  return endPx <= Math.min(touch ? EDGE_TOUCH_PX : EDGE_PX, w / 3);
}

/**
 * 새로 넣는 음 길이. "grid"면 격자 한 칸(지금까지의 동작), 아니면 MML 길이 표기(l4·l8. 의 숫자 부분).
 * 3·6·12·24·48은 셋잇단(2분·4분·8분·16분·32분 셋잇단). 사람이 고르기 좋은 목록이고, 게임이 받는지는 lengthsFor로 거른다
 * (점은 가장 짧은 길이에도 붙는다: 32. = 3/64, 64. = 3/128. 48.은 32와 같은 길이라 따로 두지 않는다)
 */
export const NOTE_LENGTHS = ["grid", "1", "2", "2.", "4", "4.", "8", "8.", "16", "16.", "32", "32.", "64", "64.", "3", "6", "12", "24", "48"] as const;
/** 목록 길이 + 사용자가 정한 잇단음 길이 ("20" = 4분 5잇단, "20." = 점4분 5잇단, tuplet.ts) */
export type NoteLength = (typeof NOTE_LENGTHS)[number] | `${number}` | `${number}.`;
/** 길이 표기 ("grid", "16", "8." 같은 것). 아르페지오 창처럼 NOTE_LENGTHS 밖 길이(l3·l6)를 쓰는 목록도 받는다 */
export type LengthName = NoteLength | `${number}` | `${number}.`;

export function noteLengthOf(length: LengthName, division: number): Rat {
  if (length === "grid") return rat(1, division);
  const dotted = length.endsWith(".");
  const n = Number(dotted ? length.slice(0, -1) : length);
  return dotted ? rat(3, 2 * n) : rat(1, n);
}

/** 길이 표기의 숫자와 점 수 ("32." → 32, 점 1). grid면 undefined */
export function lengthParts(length: LengthName): { length: number; dots: number } | undefined {
  if (length === "grid") return undefined;
  const dots = length.length - length.replace(/\.+$/, "").length;
  return { length: Number(length.slice(0, length.length - dots)), dots };
}

/** 길이 고르기 목록에서 게임이 받는 길이만 (grid는 늘 남는다). 게임 음길이 한도(GameProfile.length)를 따른다 */
export function lengthsFor<L extends LengthName = NoteLength>(limit: LengthLimit, list: readonly L[] = NOTE_LENGTHS as readonly NoteLength[] as readonly L[]): L[] {
  return list.filter((l) => {
    const p = lengthParts(l);
    return !p || isGameLength(limit, p.length, p.dots);
  });
}

/**
 * +/− 키: 길이 now를 두 배 / 반으로 한 음 길이 (격자 제외, 게임 한도 안 고르기 목록에서: 온음표 ~ 게임 최단 길이). 목록에 없으면 undefined.
 * extra: 고르기 목록에 더 둔 길이 (사용자가 정한 잇단음 등). 게임 한도로 거른다
 */
export function stepNoteLength(now: Rat, factor: 2 | 0.5, limit: LengthLimit = defaultLengthLimit(), extra: readonly NoteLength[] = []): Exclude<NoteLength, "grid"> | undefined {
  const want = mul(now, factor === 2 ? rat(2) : rat(1, 2));
  return [...lengthsFor(limit), ...lengthsFor(limit, extra)].find((l): l is Exclude<NoteLength, "grid"> => l !== "grid" && cmp(noteLengthOf(l, 1), want) === 0);
}

/** 이벤트 줄 라벨 종류 */
export type EventKind = "tempo" | "meter" | "marker";

/** 이벤트 줄에 그리고 누르는 라벨 하나 (화면 좌표) */
export interface EventLabel {
  readonly kind: EventKind;
  /** 곡 위치 (분수) */
  readonly at: Rat;
  /** 마커 id (템포·박자는 위치로 찾는다) */
  readonly id?: string;
  readonly text: string;
  /** 곡 처음에 적은 템포가 없어 기본값(t120)을 보이는 라벨. 고치면 곡 처음에 t를 넣는다 */
  readonly implicit?: boolean;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const ZERO_AT = rat(0);

/** 이벤트 줄에 보일 템포: 곡 처음에 템포가 없으면 게임이 치는 기본값(t120)을 곡 처음 템포로 덧붙인다 (implicit) */
export function shownTempo(tempo: readonly { at: Rat; bpm: number }[]): { at: Rat; bpm: number; implicit?: true }[] {
  return tempo.some((e) => cmp(e.at, ZERO_AT) === 0) ? [...tempo] : [{ at: ZERO_AT, bpm: DEFAULT_BPM, implicit: true }, ...tempo];
}

/** 마디 번호 줄 두께. 이벤트 줄은 그 아래 두 칸(템포 / 박자·마커) */
export const BAR_ROW = 14;
/** 이벤트 줄 한 칸 기본 두께 (글자 굵게 11px) */
export const EVENT_ROW = 14;

/**
 * 설정의 이벤트 줄 글자 크기(타브 기준 px, 기본 13)에 맞춘 롤 이벤트 칸 두께. 롤 글자는 굵게 써서 2px 작게(최소 10px)
 * 쓰고 칸은 글자 + 3px: 기본 13 → 글자 11·칸 14(전과 같다), 16 → 14·17, 20 → 18·21
 */
export function eventRowFor(tabFont: number): number {
  return Math.max(10, tabFont - 2) + 3;
}

/** 마디 번호 줄 두께 */
export function barRowSize(v: RollView): number {
  return v.barRow ?? BAR_ROW;
}

/** 마디 번호 글자 크기 (기본 줄 14px에 10px) */
export function barFontSize(v: RollView): number {
  return barRowSize(v) - 4;
}

/** 이벤트 줄 한 칸 두께 */
export function eventRowSize(v: RollView): number {
  return v.eventRow ?? EVENT_ROW;
}

/** 이벤트 줄 글자 크기 (칸보다 3px 작게) */
export function eventFontSize(v: RollView): number {
  return eventRowSize(v) - 3;
}

/** 마디 번호 줄 + 이벤트 줄 두 칸 두께 */
export function eventsBottom(v: RollView): number {
  return barRowSize(v) + 2 * eventRowSize(v);
}

/**
 * 이벤트 줄 라벨 자리. 가로 롤: 마디 번호 아래 첫 칸에 템포, 둘째 칸에 박자·마커.
 * 세로 롤: 바뀌는 자리 바로 아래에 템포, 그 아래에 박자·마커 (글자는 가로로)
 */
export function eventLabels(
  v: RollView,
  events: { readonly tempo: readonly { at: Rat; bpm: number }[]; readonly timeSig: readonly { at: Rat; beats: number; unit: number }[]; readonly markers: readonly { id: string; at: Rat; label: string }[] },
): EventLabel[] {
  // 글자 폭은 크기에 비례 (11px에서 한 글자 6px)
  const size = eventRowSize(v);
  const char = (eventFontSize(v) * 6) / 11;
  const width = (text: string) => Math.max(20, Math.round(text.length * char + 6));
  const place = (kind: EventKind, at: Rat, text: string, id?: string, implicit?: boolean): EventLabel => {
    const p = timeToScreen(v, toFloat(at));
    const row = kind === "tempo" ? 0 : 1;
    const w = width(text);
    const extra = { ...(id ? { id } : {}), ...(implicit ? { implicit } : {}) };
    return v.orientation === "horizontal"
      ? { kind, at, text, x: p, y: barRowSize(v) + row * size, w, h: size, ...extra }
      : { kind, at, text, x: 2, y: p + row * size, w, h: size, ...extra };
  };
  const labels = [
    ...shownTempo(events.tempo).map((e) => place("tempo", e.at, `t${e.bpm}`, undefined, e.implicit)),
    ...events.timeSig.map((e) => place("meter", e.at, `${e.beats}/${e.unit}`)),
    ...events.markers.map((e) => place("marker", e.at, e.label, e.id)),
  ];
  // 같은 칸에서 앞 라벨과 겹치면 밀어 쓴다 (같은 자리의 박자와 마커 등): 가로 롤은 오른쪽으로, 세로 롤은 아래로 한 칸씩.
  // 그릴 때도 이 자리(x·y)를 쓰고, 바뀌는 자리 점선만 원래 시간 자리에 긋는다
  const horizontal = v.orientation === "horizontal";
  const order = labels.map((l, i) => ({ l, i, row: l.kind === "tempo" ? 0 : 1 })).sort((a, b) => a.row - b.row || cmp(a.l.at, b.l.at) || a.i - b.i);
  const out = [...labels];
  let last: EventLabel | undefined;
  let lastRow = -1;
  /** 이 칸에 이미 놓은 라벨 (세로 롤은 밀어 놓은 라벨이 더 앞 라벨과 다시 겹칠 수 있어 모두 본다) */
  let placed: EventLabel[] = [];
  for (const { l, i, row } of order) {
    let next = l;
    if (row !== lastRow) placed = [];
    if (last && row === lastRow) {
      if (horizontal && next.x < last.x + last.w + 2) next = { ...next, x: last.x + last.w + 2 };
      else if (!horizontal) {
        // 세로 롤은 시간이 위로 가므로 놓은 라벨과 범위가 겹칠 때만 아래로 민다 (셋 이상 모여도 겹치지 않게 되풀이)
        for (let hit = placed.find((o) => next.y < o.y + o.h && next.y + next.h > o.y); hit; hit = placed.find((o) => next.y < o.y + o.h && next.y + next.h > o.y)) {
          next = { ...next, y: hit.y + hit.h };
        }
      }
    }
    out[i] = next;
    placed.push(next);
    last = next;
    lastRow = row;
  }
  return out;
}

/** 화면 점에 걸린 라벨 (터치는 넓게). 여럿이면 나중에 그린 것 */
export function eventAt(labels: readonly EventLabel[], x: number, y: number, touch = false): EventLabel | undefined {
  const pad = touch ? 6 : 1;
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i]!;
    if (x >= l.x - pad && x <= l.x + l.w + pad && y >= l.y - pad && y <= l.y + l.h + pad) return l;
  }
  return undefined;
}

/** 고른 이벤트 (템포·박자는 위치로, 마커는 id로 찾는다) */
export interface EventRef {
  readonly kind: EventKind;
  readonly at: Rat;
  readonly id?: string;
}

export function sameEvent(a: EventRef | undefined, b: EventRef | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && (a.kind === "marker" ? a.id === b.id : cmp(a.at, b.at) === 0);
}

/** 이벤트 줄의 몇째 칸인지 (가로 롤만 칸으로 나뉜다). 0 = 템포 칸, 1 = 박자·마커 칸, undefined = 마디 번호 줄이나 밖 */
export function eventRow(v: RollView, x: number, y: number): 0 | 1 | undefined {
  const along = v.orientation === "horizontal" ? y : x;
  if (along < barRowSize(v) || along >= eventsBottom(v)) return undefined;
  return along < barRowSize(v) + eventRowSize(v) ? 0 : 1;
}

/** 음량 레인 맨 끝의 시간 스크롤바 칸 (값 칸에서 뺀다) */
export const LANE_GUTTER = 18;
/** 값 칸 위아래 여백 (v 최대·최소가 칸 끝에 붙지 않게) */
const LANE_PAD = 3;

/** 음량 레인 값 칸 (화면 좌표). 레인이 없으면 undefined */
export function laneBox(v: RollView): Rect | undefined {
  const lane = v.lane ?? 0;
  const gutter = v.laneGutter ?? LANE_GUTTER;
  if (lane <= gutter) return undefined;
  return v.orientation === "horizontal"
    ? { x: v.keyboard, y: v.height - lane, w: v.width - v.keyboard, h: lane - gutter }
    : { x: v.width - lane, y: 0, w: lane - gutter, h: v.height - v.keyboard };
}

/** 화면 점이 음량 레인(값 칸 + 스크롤바 칸) 안인지. 건반 띠 쪽 모서리는 빼고 */
export function inLane(v: RollView, x: number, y: number): boolean {
  const lane = v.lane ?? 0;
  if (lane <= 0) return false;
  return v.orientation === "horizontal" ? y >= v.height - lane && x >= v.keyboard : x >= v.width - lane && y <= v.height - v.keyboard;
}

/** 레인 화면 점의 v (가로 롤은 위가 크고 세로 롤은 오른쪽이 크다). 범위 안 정수 */
export function laneValueAt(v: RollView, x: number, y: number, range: { readonly min: number; readonly max: number }): number {
  const box = laneBox(v);
  if (!box) return range.min;
  const span = (v.orientation === "horizontal" ? box.h : box.w) - 2 * LANE_PAD;
  const off = v.orientation === "horizontal" ? box.y + box.h - LANE_PAD - y : x - box.x - LANE_PAD;
  const f = span > 0 ? off / span : 0;
  return Math.min(range.max, Math.max(range.min, Math.round(range.min + f * (range.max - range.min))));
}

/** v의 레인 화면 좌표 (가로 롤은 y, 세로 롤은 x). 범위 밖 값은 끝에 자른다 */
export function laneValueToScreen(v: RollView, value: number, range: { readonly min: number; readonly max: number }): number {
  const box = laneBox(v);
  if (!box) return 0;
  const f = range.max > range.min ? Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min))) : 0;
  const span = (v.orientation === "horizontal" ? box.h : box.w) - 2 * LANE_PAD;
  return v.orientation === "horizontal" ? box.y + box.h - LANE_PAD - f * span : box.x + LANE_PAD + f * span;
}

/**
 * 레인에서 누른 시간의 막대 (사슬). 정확히 든 막대가 먼저이고, 없으면 좁게 그려진 막대 가운데
 * 넓힌 자리에 든 가장 가까운 것 (음 고르기의 noteNear와 같은 폭)
 */
export function laneBarAt<B extends { start: Rat; end: Rat }>(bars: readonly B[], time: number, pxPerWhole: number, touch = false): B | undefined {
  const exact = bars.find((b) => toFloat(b.start) <= time && time < toFloat(b.end));
  if (exact) return exact;
  const target = touch ? TARGET_TOUCH_PX : TARGET_PX;
  let best: B | undefined;
  let bestGap = Infinity;
  for (const b of bars) {
    const s = toFloat(b.start);
    const e = toFloat(b.end);
    const w = (e - s) * pxPerWhole;
    if (w >= target) continue;
    const gap = (time < s ? s - time : time - e) * pxPerWhole;
    if (gap <= (target - w) / 2 && gap < bestGap) {
      best = b;
      bestGap = gap;
    }
  }
  return best;
}
