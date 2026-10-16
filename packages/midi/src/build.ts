import {
  cmp,
  emptySong,
  normalizeTempo,
  rat,
  toFloat,
  ZERO,
  type GameProfile,
  type InstrumentRef,
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
import { quantize, tidy, type GridNote, type QuantizeOptions } from "./quantize.js";
import { assignVoices } from "./voices.js";
import { fillRests } from "./fill.js";
import { attenuateChords, fillVolume } from "./attenuate.js";

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
}

export interface ImportResult {
  readonly song: Song;
  readonly grid: number;
  readonly tripletBeats: number;
  /** 계획의 연주자(plan 순번)별로 압축에서 뺀 음 수와 끝을 자른 음 수 */
  readonly compressed: readonly { readonly plan: number; readonly player: string; readonly dropped: number; readonly shortened: number; readonly filled: number }[];
  /** 마비노기 타악기로 바꿀 수 없어 뺀 드럼 음 수 */
  readonly unmappedDrums: number;
}

/**
 * 기본 계획: 드럼이 아닌 파트는 GM 악기 번호가 같으면 한 연주자로 묶고(오른손·왼손 트랙 등),
 * 드럼은 큰북·심벌즈 연주자로 나눈다. 화음 수는 프로필의 연주자당 최대.
 */
export function suggestPlan(analysis: MidiAnalysis, profile: GameProfile): ImportPlan {
  const players: PlayerPlan[] = [];
  const byProgram = new Map<number, MidiPart[]>();
  for (const part of analysis.parts) {
    if (part.drum) continue;
    const list = byProgram.get(part.program) ?? [];
    list.push(part);
    byProgram.set(part.program, list);
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
  const q = quantize(parts, analysis.tempo, plan.quantize);
  const byPart = new Map<string, GridNote[]>();
  for (const n of q.notes) {
    const list = byPart.get(n.part) ?? [];
    list.push(n);
    byPart.set(n.part, list);
  }

  const players: Player[] = [];
  const tracks: Track[] = [];
  const compressed: { plan: number; player: string; dropped: number; shortened: number; filled: number }[] = [];
  let noteId = 0;
  let unmappedDrums = 0;
  const countedDrums = new Set<string>();

  plan.players.forEach((pp, planIndex) => {
    const drumKind = pp.instrument.canonical === "bass-drum" || pp.instrument.canonical === "cymbal" ? pp.instrument.canonical : undefined;
    let notes: GridNote[] = [];
    for (const id of pp.parts) {
      const part = partOf.get(id);
      const list = byPart.get(id) ?? [];
      if (part?.drum) {
        // 드럼 파트: 이 연주자의 타악기에 해당하는 음만 골라 정해진 높이로 친다
        if (!countedDrums.has(id)) {
          countedDrums.add(id);
          unmappedDrums += list.filter((n) => drumInstrument(n.pitch) === undefined).length;
        }
        if (!drumKind) continue;
        notes.push(...list.filter((n) => drumInstrument(n.pitch) === drumKind).map((n) => ({ ...n, pitch: profile.percussionPitch })));
      } else notes.push(...list);
    }
    notes = tidy(notes.map((n) => ({ ...n, part: drumKind ? "drum" : n.part })));
    if (notes.length === 0) return;

    const hands = handsOf(pp.parts.map((id) => partOf.get(id)).filter((p): p is MidiPart => !!p && !p.drum));
    const result = compressChords(notes, {
      max: pp.chords,
      ...(pp.preset ? { preset: pp.preset } : {}),
      ...(pp.dropFirst ? { dropFirst: pp.dropFirst } : {}),
      ...(pp.protect ? { protect: new Set(pp.protect) } : {}),
      ...(hands ? { hands } : {}),
    });
    // 화음감쇠: 손마다 함께 치는 음 수만큼 v를 낮춘다
    const volumeOf = (n: GridNote) => velocityToVolume(n.velocity, profile);
    const volumes = drumKind ? undefined : attenuateChords(result.notes, volumeOf, profile, hands);
    const toNote = (n: GridNote): Note => ({
      id: `n${++noteId}`,
      start: n.start,
      dur: n.dur,
      pitch: n.pitch,
      vol: volumes?.get(n) ?? volumeOf(n),
      tie: "none",
    });
    let voices: Note[][] = assignVoices(result.notes, pp.chords).map((voice) => voice.map(toNote));
    let filled = 0;
    if ((plan.fill ?? true) && !drumKind && result.spare.length > 0) {
      const minLength = later(rat(1, 16), rat(1, q.grid));
      const volumeAt = (n: GridNote, start: Rat, now: readonly (readonly Note[])[]) => fillVolume(volumeOf(n), n.pitch, start, now, profile);
      const f = fillRests(voices, result.spare, volumeAt, () => `n${++noteId}`, {
        minLength,
        charLimit: profile.charLimitPerScore,
      });
      voices = f.tracks;
      filled = f.added;
    }

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
      if (g === 0) compressed.push({ plan: planIndex, player: player.id, dropped: result.dropped.length, shortened: result.shortened, filled });
    }
  });

  const snap = (at: number) => rat(Math.round(at * q.grid), q.grid);
  const tempo: TempoEvent[] = [];
  for (const t of analysis.tempo) {
    const at = snap(toFloat(t.at));
    const bpm = Math.round(t.bpm);
    const prev = tempo.at(-1);
    if (prev && cmp(prev.at, at) === 0) tempo[tempo.length - 1] = { at, bpm };
    else if (!prev || prev.bpm !== bpm) tempo.push({ at, bpm });
  }
  // 박자 변화는 모두 격자에 맞춰 남긴다. 같은 자리면 나중 것, 맨 앞이 0이 아니면 0으로 당긴다
  const timeSig: TimeSigEvent[] = [];
  for (const sig of analysis.timeSig) {
    const at = timeSig.length === 0 ? ZERO : snap(toFloat(sig.at));
    const prev = timeSig.at(-1);
    if (prev && cmp(prev.at, at) === 0) timeSig[timeSig.length - 1] = { at, beats: sig.beats, unit: sig.unit };
    else if (!prev || prev.beats !== sig.beats || prev.unit !== sig.unit) timeSig.push({ at, beats: sig.beats, unit: sig.unit });
  }
  const song: Song = {
    ...emptySong({ title, author: "", profileId: profile.id }),
    tempo: normalizeTempo(tempo),
    timeSig,
    players,
    tracks,
  };
  return { song, grid: q.grid, tripletBeats: q.tripletBeats, compressed, unmappedDrums };
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
