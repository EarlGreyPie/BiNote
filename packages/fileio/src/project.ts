import {
  cmp,
  add,
  getProfile,
  rat,
  ZERO,
  type InstrumentRef,
  type Marker,
  type Note,
  type Player,
  type PlayerTab,
  type Rat,
  type Song,
  type SourceRef,
  type SpellingHints,
  type TempoEvent,
  type TimeSigEvent,
  type Track,
  type TrackRole,
} from "@mmlce/core";
import { trackColor, type FileDiagnostic } from "./common.js";

/**
 * MMLCE 전용 프로젝트 파일 (확장자는 PROJECT_EXTENSION).
 * 호환 형식(3MLE .mml, 마비꼬 .mmi)은 정확한 분수 위치·트랙 구조·편집 화면 상태를 다 담지 못해서
 * 곡(Song)을 그대로 JSON으로 적는다. 사람이 읽고 비교할 수 있게 들여쓰고, 음은 한 줄에 하나씩 쓴다.
 */
export const PROJECT_FORMAT = "mmlce";
/** 지금 쓰는 판. 필드를 더하기만 하면 그대로 두고, 뜻이 바뀌면 올린다 */
export const PROJECT_VERSION = 1;
/**
 * 저장할 때 붙이는 확장자. 출시 이름에 따라 바뀔 수 있어 확장자는 여기서만 정한다.
 * 바꾸면 예전 확장자는 PROJECT_EXTENSIONS에 남겨 계속 읽는다.
 */
export const PROJECT_EXTENSION = ".mme";
/** 프로젝트로 읽는 확장자 (저장 확장자 포함). .mmlce는 처음 쓰던 확장자 */
export const PROJECT_EXTENSIONS: readonly string[] = [PROJECT_EXTENSION, ".mmlce"];

/** 파일 이름이 프로젝트 확장자인지 */
export function isProjectFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return PROJECT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** 편집 화면 상태 (고른 트랙, 격자, 원곡 맞춤 등). 앱이 정하고 앱이 검사한다 */
export type ProjectEditor = Readonly<Record<string, unknown>>;

export interface ProjectWriteOptions {
  readonly editor?: ProjectEditor;
  /** 저장한 앱 판 (예: "1.0.0-beta.1 · c51c7ba") */
  readonly app?: string;
  readonly savedAt?: Date;
}

/** 프로젝트 파일 객체. 자동 보존도 같은 모양을 쓴다 */
export interface ProjectFile {
  readonly format: typeof PROJECT_FORMAT;
  readonly version: number;
  readonly app?: string;
  readonly savedAt?: string;
  readonly song: Song;
  readonly editor?: ProjectEditor;
}

export interface ProjectReadResult {
  readonly song: Song;
  readonly editor: ProjectEditor;
  readonly savedAt?: string;
  readonly diagnostics: FileDiagnostic[];
}

/** 열 수 없는 프로젝트 파일. code는 화면 문구 키(diag.project-*)에 쓴다 */
export class ProjectError extends Error {
  constructor(
    readonly code: "project-json" | "project-format" | "project-newer" | "project-broken",
    readonly params: Readonly<Record<string, string | number>> = {},
  ) {
    super(code);
    this.name = "ProjectError";
  }
}

export function projectObject(song: Song, options: ProjectWriteOptions = {}): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    ...(options.app ? { app: options.app } : {}),
    savedAt: (options.savedAt ?? new Date()).toISOString(),
    song,
    ...(options.editor ? { editor: options.editor } : {}),
  };
}

const NOTES_MARK = "\u0000notes:";

/** 곡을 프로젝트 글로 */
export function writeProject(song: Song, options: ProjectWriteOptions = {}): string {
  // 음 배열은 자리표로 바꿔 두었다가, 들여쓰기에 맞춰 한 줄에 음 하나씩 끼운다
  const noteLists: (readonly Note[])[] = [];
  const text = JSON.stringify(
    projectObject(song, options),
    (key, value: unknown) => {
      if (key === "notes" && Array.isArray(value)) {
        noteLists.push(value as readonly Note[]);
        return `${NOTES_MARK}${noteLists.length - 1}`;
      }
      return value;
    },
    2,
  );
  return (
    text.replace(/^( *)"notes": "\\u0000notes:(\d+)"/gm, (_whole, indent: string, index: string) => {
      const notes = noteLists[Number(index)]!;
      if (notes.length === 0) return `${indent}"notes": []`;
      const inner = `${indent}  `;
      return `${indent}"notes": [\n${notes.map((n) => inner + JSON.stringify(n)).join(",\n")}\n${indent}]`;
    }) + "\n"
  );
}

/**
 * 떼어 낸 악보 표시(splitFrom)는 곡에 있는 다른 악보만 가리키게 한다. 없는 악보·자기 자신·돌고 도는 연결은 지운다
 * (나중에 같은 id로 만든 새 악보를 원래 악보로 잘못 보고 트랙을 합치지 않게)
 */
function cleanSplitFrom(players: Player[]): void {
  const byId = new Map(players.map((p) => [p.id, p]));
  const cyclic = (start: Player): boolean => {
    const seen = new Set<string>([start.id]);
    for (let at = start.splitFrom; at !== undefined; at = byId.get(at)?.splitFrom) {
      if (seen.has(at)) return true;
      seen.add(at);
    }
    return false;
  };
  const drop = new Set(players.filter((p) => p.splitFrom !== undefined && (!byId.has(p.splitFrom) || p.splitFrom === p.id || cyclic(p))).map((p) => p.id));
  for (const [i, p] of players.entries()) {
    if (!drop.has(p.id)) continue;
    const { splitFrom: _from, ...rest } = p;
    players[i] = rest;
  }
}

/** 악보의 타브 튜닝. 이름은 앱이 다시 검사한다(모르는 이름은 기본 튜닝). 카포는 0~24 정수만 */
function readTab(raw: unknown): PlayerTab | undefined {
  if (!isObject(raw) || typeof raw.tuning !== "string" || !raw.tuning) return undefined;
  const capo = raw.capo;
  if (typeof capo !== "number" || !Number.isInteger(capo) || capo < 0 || capo > 24) return undefined;
  return { tuning: raw.tuning, capo };
}

/** 글이 프로젝트 파일로 보이는지 (확장자가 없거나 다를 때). format 값은 이름이 바뀌어도 "mmlce" 그대로 둔다 */
export function looksLikeProject(text: string): boolean {
  return /^\s*\{[\s\S]{0,200}"format"\s*:\s*"mmlce"/.test(text);
}

/** 프로젝트 글을 읽는다. 고칠 수 있는 문제는 고치고 진단으로 남기며, 열 수 없으면 ProjectError */
export function readProject(text: string): ProjectReadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectError("project-json");
  }
  return projectFromObject(raw);
}

/** 이미 JSON으로 풀린 프로젝트 객체를 검사해 곡으로 (자동 보존에서 읽을 때) */
export function projectFromObject(raw: unknown): ProjectReadResult {
  if (!isObject(raw) || raw.format !== PROJECT_FORMAT) throw new ProjectError("project-format");
  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new ProjectError("project-format");
  if (version > PROJECT_VERSION) throw new ProjectError("project-newer", { version });
  if (!isObject(raw.song)) throw new ProjectError("project-broken");
  const diagnostics: FileDiagnostic[] = [];
  const song = readSong(raw.song, diagnostics);
  return {
    song,
    editor: isObject(raw.editor) ? raw.editor : {},
    ...(typeof raw.savedAt === "string" ? { savedAt: raw.savedAt } : {}),
    diagnostics,
  };
}

type Obj = Record<string, unknown>;

function isObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function readRat(v: unknown): Rat | undefined {
  if (!isObject(v)) return undefined;
  const { n, d } = v;
  if (typeof n !== "number" || typeof d !== "number" || !Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0) return undefined;
  return rat(n, d);
}

function warn(out: FileDiagnostic[], code: string, where: string, params?: Record<string, string | number>) {
  out.push({ level: "warning", code, span: [0, 0], where, ...(params ? { params } : {}) });
}

function readInstrument(v: unknown): InstrumentRef | undefined {
  if (!isObject(v) || typeof v.canonical !== "string" || v.canonical === "") return undefined;
  return {
    canonical: v.canonical,
    ...(typeof v.packId === "string" ? { packId: v.packId } : {}),
    ...(typeof v.program === "number" && Number.isInteger(v.program) ? { program: v.program } : {}),
  };
}

const ROLES: readonly TrackRole[] = ["melody", "harmony", "bass", "free"];

function readSong(raw: Obj, diagnostics: FileDiagnostic[]): Song {
  const metaRaw = isObject(raw.meta) ? raw.meta : {};
  // 모르는 게임 프로필(더 새 판에서 더한 것 등)이면 모바일로 연다
  let profileId = str(metaRaw.profileId, "mobile") || "mobile";
  let profile;
  try {
    profile = getProfile(profileId);
  } catch {
    warn(diagnostics, "project-unknown-profile", "meta", { profile: profileId });
    profileId = "mobile";
    profile = getProfile(profileId);
  }
  const meta = {
    title: str(metaRaw.title),
    author: str(metaRaw.author),
    profileId,
    ...(typeof metaRaw.memo === "string" ? { memo: metaRaw.memo } : {}),
  };

  const tempo: TempoEvent[] = [];
  for (const e of list(raw.tempo)) {
    const at = isObject(e) ? readRat(e.at) : undefined;
    const bpm = isObject(e) ? e.bpm : undefined;
    if (at && cmp(at, ZERO) >= 0 && typeof bpm === "number" && Number.isFinite(bpm) && bpm > 0) tempo.push({ at, bpm });
    else warn(diagnostics, "project-dropped", "tempo");
  }
  tempo.sort((a, b) => cmp(a.at, b.at));

  const timeSig: TimeSigEvent[] = [];
  for (const e of list(raw.timeSig)) {
    const at = isObject(e) ? readRat(e.at) : undefined;
    const beats = isObject(e) ? e.beats : undefined;
    const unit = isObject(e) ? e.unit : undefined;
    if (at && cmp(at, ZERO) >= 0 && Number.isInteger(beats) && Number.isInteger(unit) && (beats as number) >= 1 && (unit as number) >= 1)
      timeSig.push({ at, beats: beats as number, unit: unit as number });
    else warn(diagnostics, "project-dropped", "timeSig");
  }
  timeSig.sort((a, b) => cmp(a.at, b.at));

  const markers: Marker[] = [];
  for (const [i, e] of list(raw.markers).entries()) {
    const at = isObject(e) ? readRat(e.at) : undefined;
    if (isObject(e) && at && cmp(at, ZERO) >= 0) markers.push({ id: str(e.id, `m${i + 1}`) || `m${i + 1}`, at, label: str(e.label) });
    else warn(diagnostics, "project-dropped", "markers");
  }

  const players: Player[] = [];
  const playerIds = new Set<string>();
  for (const [i, p] of list(raw.players).entries()) {
    if (!isObject(p)) {
      warn(diagnostics, "project-dropped", "players");
      continue;
    }
    let id = str(p.id);
    if (!id || playerIds.has(id)) id = freshId(`p${i + 1}`, playerIds);
    playerIds.add(id);
    const splitFrom = str(p.splitFrom);
    const tab = readTab(p.tab);
    players.push({
      id,
      name: str(p.name),
      instrument: readInstrument(p.instrument) ?? { canonical: "piano" },
      ...(splitFrom ? { splitFrom } : {}),
      ...(tab ? { tab } : {}),
    });
  }

  cleanSplitFrom(players);

  const tracks: Track[] = [];
  const trackIds = new Set<string>();
  const noteIds = new Set<string>();
  for (const [i, tr] of list(raw.tracks).entries()) {
    if (!isObject(tr)) {
      warn(diagnostics, "project-dropped", "tracks");
      continue;
    }
    let id = str(tr.id);
    if (!id || trackIds.has(id)) id = freshId(`t${i + 1}`, trackIds);
    trackIds.add(id);
    const name = str(tr.name);
    const where = name || id;
    // 연주자가 없는 트랙은 첫 연주자에게 (없으면 피아노 연주자를 만든다)
    let playerId = str(tr.playerId);
    if (!playerIds.has(playerId)) {
      if (players.length === 0) {
        const pid = freshId("p1", playerIds);
        playerIds.add(pid);
        players.push({ id: pid, name: "", instrument: { canonical: "piano" } });
      }
      playerId = players[0]!.id;
      warn(diagnostics, "project-player-missing", where);
    }
    tracks.push({
      id,
      playerId,
      name,
      color: str(tr.color) || trackColor(i),
      role: ROLES.includes(tr.role as TrackRole) ? (tr.role as TrackRole) : "free",
      mute: tr.mute === true,
      solo: tr.solo === true,
      notes: readNotes(tr.notes, id, where, noteIds, profile.volume, diagnostics),
      spelling: readSpelling(tr.spelling),
      ...readTrackText(tr.mml),
      ...(readInstrument(tr.instrument) ? { instrument: readInstrument(tr.instrument)! } : {}),
      ...readMix(tr.mix),
    });
  }

  const sources: SourceRef[] = [];
  for (const [i, s] of list(raw.sources).entries()) {
    if (isObject(s) && (s.kind === "audio" || s.kind === "midi") && typeof s.offsetSec === "number" && Number.isFinite(s.offsetSec))
      sources.push({ id: str(s.id, `s${i + 1}`) || `s${i + 1}`, kind: s.kind, fileName: str(s.fileName), offsetSec: s.offsetSec });
    else warn(diagnostics, "project-dropped", "sources");
  }

  return { meta, tempo, timeSig, markers, players, tracks, sources };
}

function freshId(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  for (let k = 2; ; k++) if (!used.has(`${base}_${k}`)) return `${base}_${k}`;
}

function readNotes(
  raw: unknown,
  trackId: string,
  where: string,
  usedIds: Set<string>,
  volume: { readonly min: number; readonly max: number },
  diagnostics: FileDiagnostic[],
): Note[] {
  const notes: Note[] = [];
  let bad = 0;
  let clamped = 0;
  for (const n of list(raw)) {
    const start = isObject(n) ? readRat(n.start) : undefined;
    const dur = isObject(n) ? readRat(n.dur) : undefined;
    const pitch = isObject(n) ? n.pitch : undefined;
    const vol = isObject(n) ? n.vol : undefined;
    if (
      !isObject(n) ||
      !start ||
      !dur ||
      cmp(start, ZERO) < 0 ||
      cmp(dur, ZERO) <= 0 ||
      !Number.isInteger(pitch) ||
      (pitch as number) < 0 ||
      (pitch as number) > 127 ||
      typeof vol !== "number" ||
      !Number.isFinite(vol)
    ) {
      bad++;
      continue;
    }
    const v = Math.min(volume.max, Math.max(volume.min, Math.round(vol)));
    if (v !== vol) clamped++;
    let id = str(n.id);
    if (!id || usedIds.has(id)) id = freshId(`${trackId}.n${notes.length + 1}`, usedIds);
    usedIds.add(id);
    const tabString = Number.isInteger(n.tabString) && (n.tabString as number) >= 1 && (n.tabString as number) <= 12 ? (n.tabString as number) : undefined;
    notes.push({ id, start, dur, pitch: pitch as number, vol: v, tie: n.tie === "next" ? "next" : "none", ...(tabString ? { tabString } : {}) });
  }
  // 한 트랙은 한 번에 한 음: 시작 순으로 두고 앞 음과 겹치는 음은 뺀다
  notes.sort((a, b) => cmp(a.start, b.start));
  const out: Note[] = [];
  let overlap = 0;
  for (const n of notes) {
    const prev = out[out.length - 1];
    if (prev && cmp(n.start, add(prev.start, prev.dur)) < 0) {
      overlap++;
      continue;
    }
    out.push(n);
  }
  if (bad > 0) warn(diagnostics, "project-bad-notes", where, { count: bad });
  if (overlap > 0) warn(diagnostics, "project-overlap", where, { count: overlap });
  if (clamped > 0) warn(diagnostics, "project-volume-clamped", where, { count: clamped });
  // 마지막 음의 &는 이을 음이 없으므로 풀지 않고 그대로 둔다 (편집기에서 보이는 그대로)
  return out;
}

function readSpelling(v: unknown): SpellingHints {
  if (!isObject(v)) return {};
  return {
    ...(typeof v.preferRelativeOctave === "boolean" ? { preferRelativeOctave: v.preferRelativeOctave } : {}),
    ...(typeof v.defaultLength === "number" && Number.isInteger(v.defaultLength) && v.defaultLength > 0 ? { defaultLength: v.defaultLength } : {}),
  };
}

function readTrackText(v: unknown): { mml?: NonNullable<Track["mml"]> } {
  if (!isObject(v) || typeof v.text !== "string") return {};
  const offset = readRat(v.offset);
  return { mml: offset && cmp(offset, ZERO) >= 0 ? { text: v.text, offset } : { text: v.text } };
}

function readMix(v: unknown): { mix?: NonNullable<Track["mix"]> } {
  if (!isObject(v)) return {};
  const ok = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 127;
  const mix = { ...(ok(v.volume) ? { volume: v.volume } : {}), ...(ok(v.pan) ? { pan: v.pan } : {}) };
  return Object.keys(mix).length > 0 ? { mix } : {};
}
