import {
  add,
  cmp,
  sub,
  emptySong,
  normalizeTempo,
  shortestLength,
  rat,
  toFloat,
  ZERO,
  type GameProfile,
  type InstrumentRef,
  type LengthLimit,
  type Note,
  type Player,
  type Rat,
  type Song,
  type TempoEvent,
  type TimeSigEvent,
  type Track,
} from "@mmlce/core";
import { INSTRUMENTS } from "@mmlce/core";
import { trackColor } from "@mmlce/fileio";
import type { MidiAnalysis, MidiPart } from "./analyze.js";
import { compressChords, type CompressPreset } from "./compress.js";
import { drumInstrument } from "./gm.js";
import { prepareQuantize, tidy, type GridNote, type PreparedQuantize, type QuantizeOptions, type QuantizeResult } from "./quantize.js";
import { assignVoices } from "./voices.js";
import { fillRests } from "./fill.js";
import { attenuateChords, fillVolume } from "./attenuate.js";
import { canWriteExactly, gameTimeline, gameTimelineOf, mergeVoices, timelineCovers, timelineText } from "@mmlce/mml";

/** 악기 지정 화면에서 정한 연주자 하나 */
export interface PlayerPlan {
  readonly name: string;
  readonly instrument: InstrumentRef;
  /** 이 연주자에게 모을 MIDI 파트 id. 드럼 파트는 타악기 연주자로만 넣는다 */
  readonly parts: readonly string[];
  /** 목표 화음 수 (트랙 수). maxChordsPerPlayer보다 크면 같은 악기 연주자를 여럿 만든다 */
  readonly chords: number;
  readonly preset?: CompressPreset;
  /** 먼저 뺄 손의 화음음 (outer 프리셋) */
  readonly dropFirst?: "both" | "right" | "left";
  /** 빼지 않을 파트 (멜로디 보호) */
  readonly protect?: readonly string[];
}

export interface ImportPlan {
  readonly players: readonly PlayerPlan[];
  readonly quantize?: QuantizeOptions;
  /** 압축으로 빠진 소리를 쉬는 채널에 다시 넣는다 (기본 켬) */
  readonly fill?: boolean;
  /** 화음 병합: 잠깐 늘어난 화음 음만 든 드문 트랙의 음을 쉬는 트랙으로 옮기고 빈 트랙은 뺀다 (기본 켬) */
  readonly merge?: boolean;
  /** 화음감쇠: 손마다 함께 치는 음 수만큼 v를 낮춘다 (기본 켬). 이미 감쇠한 v가 적힌 파일(BiNote가 쓴 MusicXML)은 끈다 */
  readonly attenuate?: boolean;
}

export interface ImportResult {
  readonly song: Song;
  readonly grid: number;
  readonly tripletBeats: number;
  /**
   * 같은 자리의 같은 음이 되어 하나로 합쳐진 음 수. 칸에 맞추며 모인 음과,
   * 연주자 악기로 바꾼 뒤(드럼의 여러 높이를 타악기 한 높이로 등) 모인 음을 함께 센다
   */
  readonly merged: number;
  /** 계획의 연주자(plan 순번)별로 압축에서 뺀 음 수와 끝을 자른 음 수 */
  readonly compressed: readonly { readonly plan: number; readonly player: string; readonly dropped: number; readonly shortened: number; readonly filled: number; readonly merged: number }[];
  /** 마비노기 타악기로 바꿀 수 없어 뺀 드럼 음 수 */
  readonly unmappedDrums: number;
  /** 칸 맞춤 없이(exact) 가져올 때 게임 길이로 적을 수 없어 자리·길이를 가장 가까운 적을 수 있는 값으로 맞춘 음 수 */
  readonly fitted?: number;
  /** exact로 가져올 때 프로필 옥타브 범위 밖이라 옥타브째 접어 넣은 음 수 */
  readonly folded?: number;
  /** exact로 가져올 때 소수라 반올림한 템포 수와 게임 범위 밖이라 범위 끝으로 맞춘 템포 수 */
  readonly tempoFixed?: { readonly rounded: number; readonly clamped: number };
}

/**
 * 기본 계획: 드럼이 아닌 파트는 GM 악기 번호와 추천 악기가 같으면 한 연주자로 묶고(MIDI 오른손·왼손 트랙 등),
 * MusicXML 파트(group)는 같은 파트의 보표끼리만 묶는다. 드럼은 큰북·심벌즈 연주자로 나눈다. 화음 수는 프로필의 연주자당 최대.
 */
export function suggestPlan(analysis: MidiAnalysis, profile: GameProfile): ImportPlan {
  const players: PlayerPlan[] = [];
  // MIDI: 악기 번호와 추천 악기가 모두 같은 파트끼리. MusicXML: 같은 파트(큰보표 두 손)끼리만 (group)
  const byProgram = new Map<string, MidiPart[]>();
  for (const part of analysis.parts) {
    if (part.drum) continue;
    const key = part.group !== undefined ? `g:${part.group}` : `${part.program}:${part.suggestion.canonical}`;
    const list = byProgram.get(key) ?? [];
    list.push(part);
    byProgram.set(key, list);
  }
  for (const parts of byProgram.values()) {
    const s = parts[0]!.suggestion;
    players.push({
      name: parts.map((p) => p.name).filter((v, i, a) => a.indexOf(v) === i).join(" + "),
      instrument: instrumentRef(s.canonical),
      parts: parts.map((p) => p.id),
      chords: profile.maxChordsPerPlayer,
    });
  }
  const drums = analysis.parts.filter((p) => p.drum).map((p) => p.id);
  if (drums.length > 0) {
    for (const canonical of ["bass-drum", "cymbal"] as const) {
      players.push({ name: canonical, instrument: instrumentRef(canonical), parts: drums, chords: 1 });
    }
  }
  return { players };
}

export function instrumentRef(canonical: string): InstrumentRef {
  const info = INSTRUMENTS.find((i) => i.id === canonical);
  return info?.program !== undefined ? { canonical, program: info.program } : { canonical };
}

/** MIDI 세기 → v. 재생에 쓰는 v→음량 곡선의 역으로, 세기의 음량(DLS 기본 곡선)에 가장 가까운 v */
export function velocityToVolume(velocity: number, profile: GameProfile): number {
  const db = 40 * Math.log10(Math.max(1, velocity) / 127);
  let best = profile.volume.max;
  let gap = Infinity;
  profile.volumeCurve.forEach((v, i) => {
    const vol = i + profile.volume.min;
    if (vol === 0) return;
    const d = Math.abs(v - db);
    if (d < gap) {
      gap = d;
      best = vol;
    }
  });
  return best;
}

export function midiToSong(analysis: MidiAnalysis, plan: ImportPlan, profile: GameProfile, title = ""): ImportResult {
  const used = new Set(plan.players.flatMap((p) => p.parts));
  const parts = analysis.parts.filter((p) => used.has(p.id));
  const partOf = new Map(parts.map((p) => [p.id, p]));
  if (plan.quantize?.exact) {
    // 프로필 옥타브(o0~o9 등)로 적을 수 없는 높이는 옥타브째 접는다 (o-1로 잘못 쓰이거나 버려지지 않게). 드럼은 타악기 높이로 바뀌니 그대로
    const low = (profile.octave.min + 1) * 12;
    const high = Math.min(127, (profile.octave.max + 1) * 12 + 11);
    let folded = 0;
    const fold = (pitch: number) => {
      let p = pitch;
      while (p < low) p += 12;
      while (p > high) p -= 12;
      if (p !== pitch) folded++;
      return p;
    };
    const inRange = parts.map((p) => (p.drum ? p : { ...p, notes: p.notes.map((n) => (n.pitch < low || n.pitch > high ? { ...n, pitch: fold(n.pitch) } : n)) }));
    const exactPartOf = new Map(inRange.map((p) => [p.id, p]));
    const result = assemble(analysis, plan, profile, title, exactPartOf, exactPlace(inRange), true);
    let fitted = 0;
    const tracks = result.song.tracks.map((t) => {
      const f = fitWritable(t.notes, profile.length);
      fitted += f.moved;
      return f.moved > 0 ? { ...t, notes: f.notes } : t;
    });
    return { ...result, song: { ...result.song, tracks }, fitted, folded };
  }
  const prepared = prepareQuantize(parts, analysis.tempo, plan.quantize);
  const build = (q: QuantizeResult) => assemble(analysis, plan, profile, title, partOf, q);
  if (!plan.quantize?.straighten || prepared.suspect.length === 0) return build(prepared.place());
  return straighten(prepared, build);
}

/**
 * 칸에 맞추지 않고 적힌 위치·길이 그대로 (MusicXML). 같은 파트의 같은 음 겹침만 정리한다.
 * grid는 빈 채널 채우기의 가장 짧은 길이(16분음표)에만 쓰인다
 */
function exactPlace(parts: readonly MidiPart[]): QuantizeResult {
  const notes = parts.flatMap((p) =>
    p.notes.map(
      (n): GridNote => ({
        start: n.start,
        dur: n.dur,
        pitch: n.pitch,
        velocity: n.velocity,
        part: p.id,
        ...(n.string !== undefined ? { string: n.string } : {}),
        ...(n.voice !== undefined ? { voice: n.voice } : {}),
      }),
    ),
  );
  const out = tidy(notes);
  return { notes: out, grid: 16, tripletBeats: 0, merged: notes.length - out.length, suspect: [] };
}

/**
 * x에 가장 가까운, 그 길이 한도로 적을 수 있는 값: 가장 짧은 음표(지금 1/64)의 배수, 또는 그 셋잇단(지금 1/48)의 배수 가운데
 * 실제로 적을 수 있는 것 (가장 짧은 음표의 배수는 늘 적을 수 있다)
 */
function nearestWritable(x: Rat, limit: LengthLimit): Rat {
  const max = limit.max;
  const a = rat(Math.round(toFloat(x) * max), max);
  const tri = (max * 3) / 4;
  if (!Number.isInteger(tri)) return a;
  const b = rat(Math.round(toFloat(x) * tri), tri);
  const gap = (y: Rat) => Math.abs(toFloat(sub(y, x)));
  return gap(b) < gap(a) && canWriteExactly(b, limit) ? b : a;
}

/**
 * 한 트랙 음의 자리·길이를 게임 MML로 정확히 적을 수 있게 맞춘다 (칸 맞춤 없이 가져온 악보용).
 * 앞 음 끝에서 이 음까지의 쉼과 음 길이를 적을 수 없으면(1/128 같은 길이) 가장 가까운 가장 짧은 음표(1/64)·그 셋잇단(1/48) 배수로 옮긴다.
 * 그대로 두면 출력기가 그 음을 쓰지 못해 음과 자리가 사라진다. 음은 빼지 않는다. moved: 자리나 길이가 바뀐 음 수
 */
export function fitWritable(notes: readonly Note[], limit: LengthLimit): { notes: Note[]; moved: number } {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
  const out: Note[] = [];
  const shortest = shortestLength(limit);
  let at: Rat = ZERO;
  let moved = 0;
  sorted.forEach((n, i) => {
    const end = add(n.start, n.dur);
    let start = cmp(n.start, at) < 0 ? at : n.start;
    const gap = sub(start, at);
    if (gap.n > 0 && !canWriteExactly(gap, limit)) start = add(at, nearestWritable(gap, limit));
    let dur = sub(end, start);
    if (dur.n <= 0 || !canWriteExactly(dur, limit)) {
      dur = nearestWritable(dur, limit);
      if (cmp(dur, shortest) < 0) dur = shortest;
    }
    // 늘린 끝이 다음 음을 덮으면 다음 음 시작까지만 (그것도 적을 수 없으면 다음 음을 뒤로 민다)
    const next = sorted[i + 1];
    if (next && cmp(next.start, start) > 0 && cmp(add(start, dur), next.start) > 0) {
      const room = sub(next.start, start);
      if (canWriteExactly(room, limit)) dur = room;
    }
    if (cmp(start, n.start) !== 0 || cmp(dur, n.dur) !== 0) {
      moved++;
      out.push({ ...n, start, dur });
    } else out.push(n);
    at = add(start, dur);
  });
  return { notes: out, moved };
}

/** 곡 전체를 다시 만들어 맞대 보는 횟수의 한도. 넘으면 main 판정으로 둔다 */
const STRAIGHTEN_ROUNDS = 8;

/**
 * 밀린 음 곧게 맞추기: 셋잇단이 의심스러운 박을 정규 칸으로 맞춘다. 정규 칸으로 맞추면 글자가 준다. 다만 음 시작·끝이
 * 바뀌어 다른 음과 합쳐지거나 화음 한도·채우기·음량이 달라질 수 있으니, 바꾼 곡을 끝까지(압축·성부·채우기·음량) 만든 뒤
 * main 판정으로 만든 곡과 음 하나하나 맞대어(noteChanges) 하나도 달라지지 않을 때만 받아들인다.
 * 박마다 그 둘레만 먼저 만들어 거르고, 남은 박을 모두 바꾼 곡을 맞대어 달라진 음 둘레의 박을 빼고 다시 맞댄다.
 * 정해진 횟수 안에 맞지 않으면 main 판정 그대로 둔다
 */
function straighten(prepared: PreparedQuantize, build: (q: QuantizeResult) => ImportResult): ImportResult {
  const grid = prepared.grid;
  const main = build(prepared.place());
  const beats = new Set(
    prepared.suspect.filter((beat) => {
      const window = [(beat - 1) / 4, (beat + 2) / 4] as const;
      return noteChanges(build(prepared.place(new Set([beat]), window)), build(prepared.place(undefined, window)), grid)?.length === 0;
    }),
  );
  for (let round = 0; round < STRAIGHTEN_ROUNDS && beats.size > 0; round++) {
    const next = build(prepared.place(beats));
    const changed = noteChanges(next, main, grid);
    if (changed === undefined) break;
    if (changed.length === 0) return next;
    const before = beats.size;
    for (const beat of changed) for (const b of [beat - 1, beat, beat + 1]) beats.delete(b);
    if (beats.size === before) break;
  }
  return main;
}

/**
 * next가 main과 달라진 음이 있는 박(4분음표 순번) 목록. 연주자·트랙 구성이나 연주자별 음 수가 다르면 undefined.
 * 연주자마다 모든 트랙의 음을 시작·높이·트랙 순으로 맞대어 트랙·높이·v·붙임이 같고, 시작은 격자 한 칸 안에서만 옮겨졌고,
 * 바로 앞 음과의 앞뒤·같은 자리 관계가 같고, 끝도 격자 한 칸 안에서만 옮겨져야 한다(같은 트랙 다음 음에 바로 이어지던 음이
 * 계속 이어지면 더 앞당겨져도 괜찮다). 따로 치던 음이 한 자리 화음으로 모이거나, 다른 음으로 바뀌거나, 다른 트랙으로 옮겨 가거나,
 * 짧아지거나 음량이 바뀌면 그 음이 걸린다
 */
export function noteChanges(next: ImportResult, main: ImportResult, grid: number): number[] | undefined {
  const a = main.song;
  const b = next.song;
  if (a.tracks.length !== b.tracks.length || a.players.length !== b.players.length) return undefined;
  if (a.players.some((p, i) => p.id !== b.players[i]!.id || p.name !== b.players[i]!.name)) return undefined;
  if (a.tracks.some((t, i) => t.playerId !== b.tracks[i]!.playerId)) return undefined;
  const cell = rat(1, grid);
  const notesOf = (song: Song, playerId: string) =>
    song.tracks
      .flatMap((t, track) => (t.playerId === playerId ? t.notes.map((note) => ({ note, track })) : []))
      .sort((x, y) => cmp(x.note.start, y.note.start) || x.note.pitch - y.note.pitch || x.track - y.track);
  const changed: number[] = [];
  const beatsOf = (n: Note) => [Math.floor(toFloat(n.start) * 4 + 1e-9), Math.floor(toFloat(add(n.start, n.dur)) * 4 + 1e-9)];
  for (const player of a.players) {
    const na = notesOf(a, player.id);
    const nb = notesOf(b, player.id);
    if (na.length !== nb.length) return undefined;
    // 같은 트랙의 다음 음에 바로 이어지던 음은, 다음 음이 앞당겨진 만큼 끝이 당겨져도 소리가 끊기지 않는다
    const legatoBoth = (i: number) => {
      let j = i + 1;
      while (j < na.length && na[j]!.track !== na[i]!.track) j++;
      if (j >= na.length) return false;
      const meets = (list: typeof na) => cmp(add(list[i]!.note.start, list[i]!.note.dur), list[j]!.note.start) === 0;
      return meets(na) && meets(nb);
    };
    for (let i = 0; i < na.length; i++) {
      const { note: x, track: tx } = na[i]!;
      const { note: y, track: ty } = nb[i]!;
      const same =
        tx === ty &&
        x.pitch === y.pitch &&
        x.vol === y.vol &&
        x.tie === y.tie &&
        cmp(sub(y.start, x.start), cell) < 0 &&
        cmp(sub(x.start, y.start), cell) < 0 &&
        (cmp(sub(add(x.start, x.dur), add(y.start, y.dur)), cell) < 0 || legatoBoth(i)) &&
        cmp(sub(add(y.start, y.dur), add(x.start, x.dur)), cell) < 0 &&
        (i === 0 || cmp(na[i - 1]!.note.start, x.start) === cmp(nb[i - 1]!.note.start, y.start));
      if (!same) changed.push(...beatsOf(x), ...beatsOf(y), ...(i > 0 ? beatsOf(nb[i - 1]!.note) : []));
    }
  }
  return changed;
}

function groupByPart(notes: readonly GridNote[]): Map<string, GridNote[]> {
  const byPart = new Map<string, GridNote[]>();
  for (const n of notes) {
    const list = byPart.get(n.part);
    if (list) list.push(n);
    else byPart.set(n.part, [n]);
  }
  return byPart;
}

const drumKindOf = (pp: PlayerPlan) => (pp.instrument.canonical === "bass-drum" || pp.instrument.canonical === "cymbal" ? pp.instrument.canonical : undefined);

/**
 * 연주자에게 모을 음. 드럼 파트는 이 연주자의 타악기에 해당하는 음만 골라 정해진 높이로 친다.
 * merged: 그렇게 바꾼 뒤 같은 자리의 같은 음이 되어 하나로 합쳐진 음 수 (tidy는 같은 자리 음만 빼고, 겹친 음은 끝만 자른다)
 */
function playerNotes(pp: PlayerPlan, byPart: ReadonlyMap<string, GridNote[]>, partOf: ReadonlyMap<string, MidiPart>, profile: GameProfile): { notes: GridNote[]; merged: number } {
  const drumKind = drumKindOf(pp);
  const notes: GridNote[] = [];
  for (const id of pp.parts) {
    const list = byPart.get(id) ?? [];
    if (partOf.get(id)?.drum) {
      if (!drumKind) continue;
      // 음이 아주 많은 파트(받아 적기 결과 등)도 되게 펼치기(push(...)) 대신 하나씩 넣는다
      for (const n of list) if (drumInstrument(n.pitch) === drumKind) notes.push({ ...n, pitch: profile.percussionPitch });
    } else for (const n of list) notes.push(n);
  }
  const out = tidy(notes.map((n) => ({ ...n, part: drumKind ? "drum" : n.part })));
  return { notes: out, merged: notes.length - out.length };
}

function compressOptions(pp: PlayerPlan, partOf: ReadonlyMap<string, MidiPart>) {
  const hands = handsOf(pp.parts.map((id) => partOf.get(id)).filter((p): p is MidiPart => !!p && !p.drum));
  return {
    max: pp.chords,
    ...(pp.preset ? { preset: pp.preset } : {}),
    ...(pp.dropFirst ? { dropFirst: pp.dropFirst } : {}),
    ...(pp.protect ? { protect: new Set(pp.protect) } : {}),
    ...(hands ? { hands } : {}),
  };
}

function assemble(
  analysis: MidiAnalysis,
  plan: ImportPlan,
  profile: GameProfile,
  title: string,
  partOf: ReadonlyMap<string, MidiPart>,
  q: QuantizeResult,
  exact = false,
): ImportResult {
  const byPart = groupByPart(q.notes);

  // exact(MusicXML)·keepTiming(받아 적기, 곡에서 온 템포·박자)은 분수 위치를 그대로 둔다
  const snap = (at: Rat) => (exact || analysis.keepTiming ? at : rat(Math.round(toFloat(at) * q.grid), q.grid));
  const tempo: TempoEvent[] = [];
  const tempoFixed = { rounded: 0, clamped: 0 };
  for (const t of analysis.tempo) {
    const at = snap(t.at);
    let bpm = analysis.keepTiming ? t.bpm : Math.round(t.bpm);
    if (exact) {
      // 악보 템포는 소수일 수 있고 게임 범위(t32~t255 등)를 넘을 수 있다: 맞추고 알린다
      if (bpm !== t.bpm) tempoFixed.rounded++;
      const clamped = Math.max(profile.tempo.min, Math.min(profile.tempo.max, bpm));
      if (clamped !== bpm) tempoFixed.clamped++;
      bpm = clamped;
    }
    const prev = tempo.at(-1);
    if (prev && cmp(prev.at, at) === 0) tempo[tempo.length - 1] = { at, bpm };
    else if (!prev || prev.bpm !== bpm) tempo.push({ at, bpm });
  }
  const songTempo = normalizeTempo(tempo);
  const players: Player[] = [];
  const tracks: Track[] = [];
  const compressed: { plan: number; player: string; dropped: number; shortened: number; filled: number; merged: number }[] = [];
  let noteId = 0;
  let unmappedDrums = 0;
  const countedDrums = new Set<string>();

  // 연주자 악기로 바꾼 뒤 합쳐진 음 (드럼 높이를 타악기 한 높이로 바꾼 뒤 등)
  let instrumentMerged = 0;
  plan.players.forEach((pp, planIndex) => {
    const drumKind = drumKindOf(pp);
    for (const id of pp.parts) {
      if (!partOf.get(id)?.drum || countedDrums.has(id)) continue;
      countedDrums.add(id);
      unmappedDrums += (byPart.get(id) ?? []).filter((n) => drumInstrument(n.pitch) === undefined).length;
    }
    const { notes, merged: mergedHere } = playerNotes(pp, byPart, partOf, profile);
    instrumentMerged += mergedHere;
    if (notes.length === 0) return;

    const hands = handsOf(pp.parts.map((id) => partOf.get(id)).filter((p): p is MidiPart => !!p && !p.drum));
    const result = compressChords(notes, compressOptions(pp, partOf));
    // 화음감쇠: 손마다 함께 치는 음 수만큼 v를 낮춘다
    const volumeOf = (n: GridNote) => velocityToVolume(n.velocity, profile);
    const volumes = drumKind || plan.attenuate === false ? undefined : attenuateChords(result.notes, volumeOf, profile, hands);
    const toNote = (n: GridNote): Note => ({
      id: `n${++noteId}`,
      start: n.start,
      dur: n.dur,
      pitch: n.pitch,
      vol: volumes?.get(n) ?? volumeOf(n),
      tie: "none",
      ...(n.string !== undefined ? { tabString: n.string } : {}),
    });
    let voices: Note[][] = assignVoices(result.notes, pp.chords).map((voice) => voice.map(toNote));
    /** 이 연주자의 트랙만 든 곡 (아래에서 실제로 만드는 것과 같게 maxChordsPerPlayer 트랙마다 연주자를 나눈다) */
    const alone = (list: readonly Note[][]): Song => {
      const size = profile.maxChordsPerPlayer;
      const ps: Player[] = [];
      const ts: Track[] = [];
      list.forEach((notes, k) => {
        if (k % size === 0) ps.push({ id: `q${ps.length + 1}`, name: "", instrument: pp.instrument });
        ts.push({ id: `v${k + 1}`, playerId: ps.at(-1)!.id, name: "", color: "", role: "free", mute: false, solo: false, notes, spelling: {} });
      });
      return { ...emptySong({ title: "", author: "", profileId: profile.id }), tempo: songTempo, players: ps, tracks: ts };
    };
    const fill = (list: Note[][]): { tracks: Note[][]; added: number } => {
      if (!(plan.fill ?? true) || drumKind || result.spare.length === 0) return { tracks: list, added: 0 };
      const minLength = later(rat(1, 16), rat(1, q.grid));
      const volumeAt = (n: GridNote, start: Rat, now: readonly (readonly Note[])[]) => fillVolume(volumeOf(n), n.pitch, start, now, profile);
      return fillRests(list, result.spare, volumeAt, () => `n${++noteId}`, { minLength, charLimit: profile.charLimitPerScore });
    };
    // 화음 병합은 빈 채널 채우기보다 먼저: 드문 트랙을 비운 뒤 남은 트랙의 쉼을 채운다
    let merged = 0;
    let filled = 0;
    let done: Note[][] | undefined;
    if ((plan.merge ?? true) && voices.length > 1) {
      const m = mergeVoices(voices, { limit: profile.charLimitPerScore, tempo: songTempo.map((e) => e.at) });
      const next = m.tracks.filter((v) => v.length > 0);
      // 받아들이는 기준: 이 연주자만 든 곡을 게임 출력으로 다시 읽은 결과가 병합 전과 같아야 한다 (곡 메뉴 화음 병합과 같다)
      if (m.moved > 0) {
        const mergedLine = gameTimelineOf(alone(next), profile);
        if (timelineText(mergedLine) === gameTimeline(alone(voices), profile)) {
          // 채우기 뒤 최종 곡에서도 병합한 음이 그대로 울려야 한다 (채운 음만 더해짐). 아니면 병합 없이 채운다
          const f = fill(next);
          if (timelineCovers(gameTimelineOf(alone(f.tracks), profile), mergedLine)) {
            done = f.tracks;
            filled = f.added;
            merged = m.moved;
          }
        }
      }
    }
    if (!done) {
      const f = fill(voices);
      done = f.tracks;
      filled = f.added;
    }
    voices = done;

    // 한 연주자는 maxChordsPerPlayer 트랙까지. 그보다 많이 주면 같은 악기 연주자를 더 만든다
    const size = profile.maxChordsPerPlayer;
    const groups = Math.ceil(voices.length / size);
    for (let g = 0; g < groups; g++) {
      const name = groups > 1 ? `${pp.name} (${g + 1})` : pp.name;
      const player: Player = { id: `p${players.length + 1}`, name, instrument: pp.instrument };
      players.push(player);
      const mine = voices.slice(g * size, (g + 1) * size);
      mine.forEach((voice, v) => {
        tracks.push({
          id: `t${tracks.length + 1}`,
          playerId: player.id,
          name: mine.length > 1 ? `${name} ${v + 1}` : name,
          color: trackColor(tracks.length),
          role: "free",
          mute: false,
          solo: false,
          notes: voice,
          spelling: {},
        });
      });
      if (g === 0) compressed.push({ plan: planIndex, player: player.id, dropped: result.dropped.length, shortened: result.shortened, filled, merged });
    }
  });

  // 박자 변화는 모두 남긴다: 보통은 격자에 맞추고, keepTiming·exact면 자리 그대로. 같은 자리면 나중 것, 맨 앞이 0이 아니면 0으로 당긴다
  const timeSig: TimeSigEvent[] = [];
  for (const sig of analysis.timeSig) {
    const at = timeSig.length === 0 ? ZERO : snap(sig.at);
    const prev = timeSig.at(-1);
    if (prev && cmp(prev.at, at) === 0) timeSig[timeSig.length - 1] = { at, beats: sig.beats, unit: sig.unit };
    else if (!prev || prev.beats !== sig.beats || prev.unit !== sig.unit) timeSig.push({ at, beats: sig.beats, unit: sig.unit });
  }
  const song: Song = {
    ...emptySong({ title, author: "", profileId: profile.id }),
    tempo: songTempo,
    timeSig,
    players,
    tracks,
  };
  return {
    song,
    grid: q.grid,
    tripletBeats: q.tripletBeats,
    merged: q.merged + instrumentMerged,
    compressed,
    unmappedDrums,
    ...(exact ? { tempoFixed } : {}),
  };
}

/** 파트가 둘 이상이면 평균 음높이가 가장 높은 파트를 오른손, 나머지를 왼손으로 본다 */
function handsOf(parts: readonly MidiPart[]): Map<string, "right" | "left"> | undefined {
  if (parts.length < 2) return undefined;
  const mean = (p: MidiPart) => p.notes.reduce((s, n) => s + n.pitch, 0) / p.notes.length;
  const top = [...parts].sort((a, b) => mean(b) - mean(a))[0]!;
  return new Map(parts.map((p) => [p.id, p === top ? "right" : "left"]));
}

const later = (a: Rat, b: Rat) => (cmp(a, b) >= 0 ? a : b);

/**
 * 곡 전체 화음 예산(예: 12)을 연주자마다 나눈다. 모두 1부터 시작해, 남은 예산을 한 칸씩
 * "음 수 × 아직 못 낸 동시음 비율"이 가장 큰 연주자에게 준다. 자동으로는 악기당 maxChordsPerPlayer까지.
 */
export function allocateChords(analysis: MidiAnalysis, plan: ImportPlan, total: number, profile: GameProfile): ImportPlan {
  const partOf = new Map(analysis.parts.map((p) => [p.id, p]));
  const demand = plan.players.map((pp) => {
    const parts = pp.parts.map((id) => partOf.get(id)).filter((p): p is MidiPart => !!p);
    const isDrum = pp.instrument.canonical === "bass-drum" || pp.instrument.canonical === "cymbal";
    const notes = parts.reduce((s, p) => s + p.notes.length, 0);
    const poly = isDrum ? 1 : Math.max(1, ...parts.map((p) => p.polyphony), parts.reduce((s, p) => s + Math.min(p.polyphony, 2), 0));
    return { notes, poly: Math.min(poly, profile.maxChordsPerPlayer) };
  });
  const given = demand.map(() => 1);
  let left = total - given.length;
  while (left > 0) {
    let best = -1;
    let score = 0;
    demand.forEach((d, k) => {
      if (given[k]! >= d.poly) return;
      const s = d.notes * (1 - given[k]! / d.poly);
      if (s > score) {
        score = s;
        best = k;
      }
    });
    if (best < 0) break;
    given[best]!++;
    left--;
  }
  return { ...plan, players: plan.players.map((pp, k) => ({ ...pp, chords: given[k]! })) };
}
