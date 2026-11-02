import { defaultLengthLimit, type Extras, type Song } from "@mmlce/core";
import type { ProjectEditor, ProjectWriteOptions } from "@mmlce/fileio";
import { isTuningName, type ScoreTuning, type TuningName } from "./tunings";
import { NOTE_LENGTHS, type BackgroundVideo, type NoteLength } from "./roll";
import { isGameLengthName, isGridDivision } from "./tuplet";

/**
 * 프로젝트 파일과 자동 보존에 함께 남기는 편집 화면 상태.
 * 원곡·영상 파일 자체는 넣지 않고 이름과 맞춤값만 둔다. 같은 이름 파일을 다시 불러오면 맞춤값을 이어 쓴다.
 */
export interface ReferenceFit {
  readonly name: string;
  readonly offsetMs: number;
  readonly volume: number;
}

export interface VideoFit {
  readonly name: string;
  readonly opacity: number;
  readonly offset: number;
  readonly fit: boolean;
  readonly low: number;
  readonly high: number;
  readonly keyLine: number;
  readonly stretch: number;
  /** 화면 채우기 (없으면 켬). 끈 것만 적는다 */
  readonly fill?: boolean;
  /** 잰 영상 속 음이 떨어지는 속도 (원본 영상 px/초) */
  readonly speed?: number;
  /** 영상 속 건반 모양. 없으면 반음 같은 폭 ("even", 1.0.0-beta.37 전 파일). 피아노 모양만 적는다 */
  readonly keyShape?: "piano";
}

/**
 * 연 배경 영상의 지금 맞춤값 (프로젝트 저장, 영상을 빼거나 바꿀 때 남겨 두기). 기본값과 같은 것(채우기 켬·속도 없음·
 * 반음 같은 폭)은 적지 않는다
 */
export function videoFitOf(name: string, video: Omit<BackgroundVideo, "url" | "sound" | "handles">): VideoFit {
  return {
    name,
    opacity: video.opacity,
    offset: video.offset,
    fit: video.fit,
    low: video.low,
    high: video.high,
    keyLine: video.keyLine,
    stretch: video.stretch,
    ...(video.fill === false ? { fill: false } : {}),
    ...(video.speed ? { speed: video.speed } : {}),
    ...(video.keyShape === "piano" ? { keyShape: "piano" as const } : {}),
  };
}

/**
 * 곡을 열 때 열려 있던 원곡이나 배경 영상(open, 파일 이름)을 그대로 둘지.
 * 새 곡에 같은 이름 파일의 맞춤값이 적혀 있으면(recorded) 두고 그 맞춤값을 쓴다. 원곡을 받아 적어 만든 곡처럼
 * 같은 음원에서 나온 곡(sameSource)도 둔다. 그 밖에는 앞 곡의 것이라 닫는다 (새 곡에 남으면 엉뚱한 원곡·영상과 견주게 된다)
 */
export function keepOpenMedia(open: string | undefined, recorded: { readonly name: string } | undefined, sameSource = false): boolean {
  if (open === undefined) return false;
  return sameSource || recorded?.name === open;
}

/**
 * 원곡·영상을 빼거나 다른 파일로 바꿀 때 곡에 남길 맞춤값(프로젝트에 적힐 값).
 * 남긴 값이 없거나 같은 파일 것이면 방금까지 쓰던 값(live)으로 바꾼다 (같은 파일을 다시 열면 그대로 쓰고, 마디 편집 실행 취소도 맞게 옮긴다).
 * 다른 파일의 남긴 값은 지킨다: 잘못 고른 파일을 뺐다고 곡에 적힌 원래 파일의 맞춤값이 사라지지 않게
 */
export function keptFit<T extends { readonly name: string }>(recorded: T | undefined, live: T | undefined): T | undefined {
  if (!live) return recorded;
  return !recorded || recorded.name === live.name ? live : recorded;
}

/** 열린 배경 영상에 곡에 적힌 맞춤값을 씌운다 (같은 영상이 열린 채 그 곡을 열 때). 파일·소리·손잡이는 그대로 */
export function withVideoFit<V extends BackgroundVideo>(video: V, fit: VideoFit): V {
  const { fill: _fill, speed: _speed, keyShape: _keyShape, ...rest } = video;
  return {
    ...rest,
    opacity: fit.opacity,
    offset: fit.offset,
    fit: fit.fit,
    low: fit.low,
    high: fit.high,
    keyLine: fit.keyLine,
    stretch: fit.stretch,
    ...(fit.fill === false ? { fill: false } : {}),
    ...(fit.speed ? { speed: fit.speed } : {}),
    ...(fit.keyShape === "piano" ? { keyShape: "piano" as const } : {}),
  } as V;
}

/** 트랙 보기 상태: 롤에서 숨김(눈), 편집 막기(잠금). 실행 취소 기록 밖이다 */
export interface TrackViewState {
  readonly hidden?: true;
  readonly locked?: true;
}

export interface EditorState {
  readonly activeTrackId?: string;
  readonly division?: number;
  /** 새 음 길이 (격자와 따로 고를 때) */
  readonly noteLength?: NoteLength;
  readonly viewMode?: "roll" | "tab";
  readonly tuning?: TuningName;
  readonly capo?: number;
  /** 악보(연주자) id → 그 악보의 타브 튜닝. 1.0.0-beta.8 파일만 적었다 (읽기만 한다. 지금은 곡의 Player.tab에 적는다) */
  readonly scoreTunings?: Readonly<Record<string, ScoreTuning>>;
  readonly reference?: ReferenceFit;
  readonly video?: VideoFit;
  /** 트랙 id → 보기 상태 (숨기거나 잠근 트랙만) */
  readonly trackView?: Readonly<Record<string, TrackViewState>>;
}

/** 화면 상태의 아는 칸 이름. EditorState에 칸을 더하면 여기에도 더해야 타입 검사를 지난다 */
const EDITOR_KEYS: ReadonlySet<string> = new Set(
  Object.keys({
    activeTrackId: true,
    division: true,
    noteLength: true,
    viewMode: true,
    tuning: true,
    capo: true,
    scoreTunings: true,
    reference: true,
    video: true,
    trackView: true,
  } satisfies Record<keyof EditorState, true>),
);

/** 연 프로젝트 파일에서 이 판이 모르는 것 (더 새 판이 더한 것): 맨 위 필드와 화면 상태 칸. 저장할 때 그대로 다시 적는다 */
export interface KeptFields {
  readonly file?: Extras;
  readonly editor?: ProjectEditor;
}

/** 읽은 프로젝트에서 다시 적을 모르는 필드를 고른다 (프로젝트가 아닌 파일이면 빈 것) */
export function keptFields(result: { readonly editor?: ProjectEditor; readonly extras?: Extras }): KeptFields {
  const rest = Object.entries(result.editor ?? {}).filter(([k]) => !EDITOR_KEYS.has(k));
  return { ...(result.extras ? { file: result.extras } : {}), ...(rest.length > 0 ? { editor: Object.fromEntries(rest) } : {}) };
}

/** 프로젝트로 쓸 때의 설정: 지금 화면 상태에 연 파일의 모르는 칸을 더한다 (열고 저장만 해도 사라지지 않게) */
export function projectWriteOptions(editor: EditorState, kept: KeptFields, app: string): ProjectWriteOptions {
  return { editor: { ...kept.editor, ...editor }, app, ...(kept.file ? { extras: kept.file } : {}) };
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const validTuning = isTuningName;

const validCapo = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 24;

/** 파일에 적힌 화면 상태를 검사한다. 모르는 값·맞지 않는 값은 버린다 (곡은 그대로 열린다) */
export function parseEditorState(raw: ProjectEditor, song: Song): EditorState {
  const out: { -readonly [K in keyof EditorState]: EditorState[K] } = {};
  if (typeof raw.activeTrackId === "string" && song.tracks.some((tr) => tr.id === raw.activeTrackId)) out.activeTrackId = raw.activeTrackId;
  // 격자: 목록 칸(1/16 등) 말고도 잇단음 칸(1/20 등)일 수 있다. 게임이 받는 길이 숫자면 받는다
  if (isGridDivision(raw.division, defaultLengthLimit())) out.division = raw.division;
  // 새 음 길이: 목록 길이, 또는 게임이 받는 한 토막 (잇단음 "20"·"20." 등)
  if ((NOTE_LENGTHS as readonly unknown[]).includes(raw.noteLength) || isGameLengthName(raw.noteLength, defaultLengthLimit())) out.noteLength = raw.noteLength as NoteLength;
  if (raw.viewMode === "roll" || raw.viewMode === "tab") out.viewMode = raw.viewMode;
  if (validTuning(raw.tuning)) out.tuning = raw.tuning;
  if (validCapo(raw.capo)) out.capo = raw.capo;
  if (isObject(raw.scoreTunings)) {
    const tunings: Record<string, ScoreTuning> = {};
    for (const p of song.players) {
      const v = raw.scoreTunings[p.id];
      if (isObject(v) && validTuning(v.tuning) && validCapo(v.capo)) tunings[p.id] = { tuning: v.tuning, capo: v.capo };
    }
    if (Object.keys(tunings).length > 0) out.scoreTunings = tunings;
  }
  const r = raw.reference;
  if (isObject(r) && typeof r.name === "string" && r.name && finite(r.offsetMs) && finite(r.volume))
    out.reference = { name: r.name, offsetMs: r.offsetMs, volume: Math.min(1.5, Math.max(0, r.volume)) };
  const v = raw.video;
  if (
    isObject(v) &&
    typeof v.name === "string" &&
    v.name &&
    finite(v.opacity) &&
    finite(v.offset) &&
    typeof v.fit === "boolean" &&
    finite(v.low) &&
    finite(v.high) &&
    v.high > v.low &&
    finite(v.keyLine) &&
    finite(v.stretch) &&
    v.stretch > 0
  )
    out.video = {
      name: v.name,
      opacity: Math.min(1, Math.max(0.1, v.opacity)),
      offset: v.offset,
      fit: v.fit,
      low: v.low,
      high: v.high,
      keyLine: Math.min(1, Math.max(0, v.keyLine)),
      stretch: v.stretch,
      ...(v.fill === false ? { fill: false } : {}),
      ...(finite(v.speed) && v.speed > 0 ? { speed: v.speed } : {}),
      ...(v.keyShape === "piano" ? { keyShape: "piano" as const } : {}),
    };
  if (isObject(raw.trackView)) {
    const views: Record<string, TrackViewState> = {};
    for (const tr of song.tracks) {
      const v = raw.trackView[tr.id];
      if (!isObject(v)) continue;
      const view = { ...(v.hidden === true ? { hidden: true as const } : {}), ...(v.locked === true ? { locked: true as const } : {}) };
      if (view.hidden || view.locked) views[tr.id] = view;
    }
    if (Object.keys(views).length > 0) out.trackView = views;
  }
  return out;
}

/** 보기 상태 하나를 바꾼 새 표 (아무것도 안 남은 트랙은 뺀다) */
export function withTrackView(
  views: Readonly<Record<string, TrackViewState>>,
  trackId: string,
  change: { readonly hidden?: boolean; readonly locked?: boolean },
): Readonly<Record<string, TrackViewState>> {
  const now = views[trackId] ?? {};
  const hidden = change.hidden ?? now.hidden === true;
  const locked = change.locked ?? now.locked === true;
  const { [trackId]: _old, ...rest } = views;
  return hidden || locked ? { ...rest, [trackId]: { ...(hidden ? { hidden: true } : {}), ...(locked ? { locked: true } : {}) } } : rest;
}

/**
 * 편집 상태를 비교용 글로 바꾼다. 객체 키는 정렬해 넣으므로, 숨기기·잠그기를 껐다 켜서 키 순서만 바뀐
 * 상태는 같은 글이 된다 (프로젝트 저장 뒤 바뀌었는지 볼 때 쓴다)
 */
export function editorStateKey(state: EditorState): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sorted(obj[k])]));
    }
    return value;
  };
  return JSON.stringify(sorted(state));
}
