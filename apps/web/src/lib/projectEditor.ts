import type { Song } from "@mmlce/core";
import type { ProjectEditor } from "@mmlce/fileio";
import { GRID_DIVISIONS } from "./keymap";
import { isTuningName, type ScoreTuning, type TuningName } from "./tunings";
import { NOTE_LENGTHS, type NoteLength } from "./roll";

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

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const validTuning = isTuningName;
const validCapo = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 24;

/** 파일에 적힌 화면 상태를 검사한다. 모르는 값·맞지 않는 값은 버린다 (곡은 그대로 열린다) */
export function parseEditorState(raw: ProjectEditor, song: Song): EditorState {
  const out: { -readonly [K in keyof EditorState]: EditorState[K] } = {};
  if (typeof raw.activeTrackId === "string" && song.tracks.some((tr) => tr.id === raw.activeTrackId)) out.activeTrackId = raw.activeTrackId;
  if ((GRID_DIVISIONS as readonly unknown[]).includes(raw.division)) out.division = raw.division as number;
  if ((NOTE_LENGTHS as readonly unknown[]).includes(raw.noteLength)) out.noteLength = raw.noteLength as NoteLength;
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
