import { INSTRUMENTS, add, chainFadeEnd, chainSampleEnd, cmp, crossesTimbre, dbOfVolume, decayDbAt, eq, foldPitch, isSoloInstrument, soundingRangeOf, tempoClock, timbreBoundaries, trackInstrument, volumeForDb, type GameProfile, type Note, type Rat, type Song, type Track } from "@mmlce/core";
import { chordsPerScore } from "./clipboard.js";
import { type Diagnostic, type ParseResult } from "./parser.js";
import { mmlPitchRange } from "./printer.js";
import { scoreTrackIds } from "./tempo-placement.js";
import { tempoMismatch } from "./tempo-text.js";

const NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];

/** MIDI 번호를 MML 표기로 (60 → o4c) */
function noteName(midi: number): string {
  return `o${Math.floor(midi / 12) - 1}${NAMES[midi % 12]}`;
}

/**
 * 채널 하나를 프로필 한도로 검사한다. 문법 오류는 파서가 이미 냈으므로 여기서는
 * 게임 한도(글자 수, 값 범위, MML로 쓸 수 있는 음 높이)만 본다. 범위 밖 값은 편집기 안에서는 쓸 수 있으므로 경고다.
 */
export function validateChannel(text: string, parsed: ParseResult, profile: GameProfile): Diagnostic[] {
  const out: Diagnostic[] = [];
  const limit = profile.charLimitPerScore;
  if (text.length > limit) {
    out.push({ level: "error", code: "char-limit", params: { count: text.length, limit }, span: [limit, text.length] });
  }

  for (const v of parsed.values) {
    const range =
      v.kind === "tempo"
        ? profile.tempo
        : v.kind === "length"
          ? profile.length
          : v.kind === "dots"
            ? { min: 0, max: profile.length.dots }
            : v.kind === "octave"
              ? profile.octave
              : profile.volume;
    // 길이 0은 파서가 오류로 냈다
    if (v.kind === "length" && v.value < 1) continue;
    if (v.value < range.min || v.value > range.max) {
      out.push({
        level: "warning",
        code: `${v.kind}-range`,
        params: { value: v.value, min: range.min, max: range.max },
        span: v.span,
      });
    }
  }

  // o0<c처럼 <·>나 n으로 닿은 높이는 o 범위 안에서 c-·b+로도 쓸 수 없으면 다시 쓸 때 옥타브가 옮겨진다
  const writable = mmlPitchRange(profile.octave);
  for (const n of parsed.notes) {
    if (n.pitch >= writable.low && n.pitch <= writable.high) continue;
    out.push({ level: "warning", code: "pitch-unwritable", params: { min: profile.octave.min, max: profile.octave.max }, span: n.span });
  }

  return out;
}

/** 곡 단위 검사 결과. 어느 트랙(또는 연주자)의 어느 음인지 함께 준다 */
export interface SongDiagnostic {
  readonly level: Diagnostic["level"];
  readonly code: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly trackId?: string;
  readonly playerId?: string;
  readonly noteId?: string;
}

function end(n: Note): Rat {
  return add(n.start, n.dur);
}

/** 이만큼(초) 이상 울리는 음만 묻힘을 본다 */
const BURIED_MIN_SECONDS = 1;
/** 다른 트랙이 새로 치는 음보다 평균 이만큼(dB) 작으면 묻혔다고 본다 */
const BURIED_GAP_DB = 12;
/** 제안 v는 이만큼(dB) 작은 데까지 올린다 */
const BURIED_TARGET_DB = 6;

interface Chain {
  readonly first: Note;
  /** 사슬의 마지막 음 */
  readonly last: Note;
  /** 음마다 시작 시각(초)과 접은 뒤 높이. 같은 음 붙임은 한 음 */
  readonly steps: readonly { readonly at: number; readonly pitch: number }[];
  readonly startAt: number;
  readonly length: number;
}

/** 트랙의 붙임 사슬(첫 음부터 &로 이은 음들). 재생과 같이 높이가 bendLimit(profile.tieBendLimit)보다 멀면 새로 친다 */
function chainsOf(song: Song, track: Track, range: { readonly low: number; readonly high: number }, bendLimit: number): Chain[] {
  const out: Chain[] = [];
  const notes = [...track.notes].sort((a, b) => cmp(a.start, b.start));
  const secondsAt = tempoClock(song.tempo);
  const timeOf = (n: Note) => secondsAt(n.start);
  for (let i = 0; i < notes.length; ) {
    let j = i;
    while (
      j + 1 < notes.length &&
      notes[j]!.tie === "next" &&
      eq(end(notes[j]!), notes[j + 1]!.start) &&
      Math.abs(foldPitch(notes[j + 1]!.pitch, range) - foldPitch(notes[i]!.pitch, range)) <= bendLimit
    )
      j++;
    const steps: { at: number; pitch: number }[] = [];
    for (let k = i; k <= j; k++) {
      const pitch = foldPitch(notes[k]!.pitch, range);
      if (steps.at(-1)?.pitch !== pitch) steps.push({ at: timeOf(notes[k]!), pitch });
    }
    const startAt = timeOf(notes[i]!);
    out.push({ first: notes[i]!, last: notes[j]!, steps, startAt, length: secondsAt(end(notes[j]!)) - startAt });
    i = j + 1;
  }
  return out;
}

export interface ValidateSongOptions {
  /**
   * 번호로만 아는 악기(추가 사운드팩의 #42.3 등)의 실제 악기를 알려 준다(재생의 buildSchedule과 같은 모양).
   * pack은 트랙에서 고른 사운드팩(파일 이름, 없으면 자동)이다. 같은 번호도 팩마다 다른 악기일 수 있다.
   * 주면 음역·샘플 길이를 그 악기로 잰다. 모르면 undefined를 돌려주고, 그때는 원래 ID로 잰다
   */
  readonly canonicalOf?: (instrument: string, program: number | undefined, pack?: string) => string | undefined;
  /**
   * 주면 붙임 사슬이 가장 클 때보다 이만큼(dB) 작아진 뒤에도 이어지는 음을 알린다 (sample-faded, 실험실 "소리 줄어듦").
   * 샘플이 먼저 끝나는 음은 sample-cut만 낸다
   */
  readonly fadeDb?: number;
  /** true면 실험실 "연주 누락음 검사"(fast-run-drop)을 본다. 기준은 profile.fastRunDrop (실측 전, pending fastRunDrop) */
  readonly fastRunDrop?: boolean;
}

/** 트랙이 실제로 소리 내는 악기 (재생과 같이 트랙에서 고른 팩의 실제 악기) */
function instrumentResolver(song: Song, options: Pick<ValidateSongOptions, "canonicalOf">): (track: Track) => string {
  return (track) => {
    const ref = trackInstrument(song, track);
    return options.canonicalOf?.(ref.canonical, ref.program, ref.packId) ?? ref.canonical;
  };
}

/** 연주 누락음 위험의 착지 음 하나 */
export interface FastRunLanding {
  readonly trackId: string;
  /** 착지 음(붙임 사슬의 첫 음) */
  readonly noteId: string;
  readonly start: Rat;
  /** 앞의 빠른 음 수 (구간과 상관없이 잇단 빠른 음 전체). 빠른 음 연속 없이 같은 순간 시작한 음이면 0 */
  readonly run: number;
  /** 착지 음(접은 뒤 높이)이 든 샘플 구간 (MIDI 번호, 양 끝 포함. 그 악기가 내는 범위로 자름) */
  readonly zone: { readonly low: number; readonly high: number };
}

/** 연주 누락음 위험 순간 하나: 같은 악보에서 트랙 여럿이 같은 샘플 구간에서 빠른 음 연속 뒤 같은 순간 착지한 곳 */
export interface FastRunMoment {
  readonly playerId: string;
  /** 그 악보 트랙 (게임 악보 하나, scoreTrackIds) */
  readonly trackIds: readonly string[];
  /** 가장 이른 착지 음 자리 */
  readonly at: Rat;
  /** 빠질 위험이 있는 음들 (빠른 음 연속과 같은 샘플 구간에서 그 순간 시작하는 음 가운데 maxStarts를 넘는 것, 빠른 음이 없던 트랙 음 포함). 시각 순, 같은 시각이면 악보 안 트랙 순 */
  readonly landings: readonly FastRunLanding[];
}

/**
 * 실험실 연주 누락음 위험: 게임 악보(scoreTrackIds 묶음)마다, 같은 샘플 구간 Z에서 빠른 음 연속을 친 트랙 rule.minTracks개 이상이
 * 같은 순간 쉼 없이 착지하는 곳에서, 구간 Z의 그 빠른 음 수 F에 그 순간 구간 Z에서 시작하는 음(착지 음과, 빠른 음 연속 없이 같은 순간
 * 시작한 다른 트랙 음)을 시각·악보 트랙 순으로 하나씩 더해 rule.maxStarts를 넘는 음.
 * (실측 2026-10-31: 다른 구간의 음은 빠지지 않았다. 빠른 음 4 + C4 = 5는 나고 + G3 = 6은 빠졌다, 빠른 음 5 + 첫 음 = 6은 빠졌다).
 * - 음은 붙임 사슬 단위로 본다(곡 검사의 다른 진단과 같이, 다시 치지 않는 &는 한 음). 시각은 곡 템포 지도로 센 초.
 * - 빠른 음: 사슬 길이 < maxNoteMs (fastRunShort, 소수 오차 여유). 그런 음이 음 사이 틈 < gapMs로 잇달고, 마지막 빠른 음 뒤 틈 < gapMs로
 *   빠르지 않은 음이 오면 그 음이 착지 음이다 (착지 음 자체가 빠르면 연속의 일부로 보고 다음 음을 본다).
 *   그 연속 가운데 구간 Z에 든 음이 minRun개 이상이면 그 트랙을 구간 Z에서 센다 (트랙 수는 구간마다 센다).
 * - 샘플 구간: 그 트랙 악기의 음색 경계(timbreBoundaries: sampleBoundaries와 샘플 길이 구간)로 나누고, 높이는 재생처럼
 *   악기 범위로 접은 뒤 높이로 본다. 경계를 모르는 악기는 전체를 한 구간으로 본다(보수적으로 알림). 악기가 다르면 다른 구간이다.
 * - v0으로 시작한 사슬은 소리가 없으므로 음으로 치지 않는다(쉼표처럼 틈이 된다). 끄기·솔로는 BiNote에서 듣는 것만 바꾸고
 *   게임은 그대로 치므로 상관없다. 오르골·축음기처럼 악보 하나에 덜 치는 악기는 소리 나는 트랙끼리만 묶인다 (scoreTrackIds).
 * - 같은 순간: 착지 시각 차가 gapMs보다 짧음 (fastRunGapEnough). 구간이 달라도 같은 순간이면 한 순간으로 묶는다.
 * 규칙이 없는 프로필(rule null)이면 빈 목록
 */
/**
 * 연주 누락음 검사의 틈이 gapMs 이상인지 (초). 템포 지도로 센 초는 소수 오차가 있어, 수학적으로 정확히 gapMs인 틈
 * (예: t125의 1/48 = 40ms)이 조금 짧게 나와도 충분한 틈으로 본다. 검사·같은 순간 묶기·고치기의 늦출 길이 고르기가 모두 이 함수를 쓴다
 */
export function fastRunGapEnough(seconds: number, gapMs: number): boolean {
  return seconds * 1000 >= gapMs - FAST_RUN_TOLERANCE_MS;
}

/** 템포 지도로 센 시각의 소수 오차 여유 (ms). 틈(gapMs)과 빠른 음 길이(maxNoteMs) 비교에 같이 쓴다 */
const FAST_RUN_TOLERANCE_MS = 1e-6;

/** 이 길이(초)가 빠른 음(maxNoteMs보다 짧음)인지. 수학적으로 정확히 maxNoteMs인 음(예: t100의 16분음표 150ms)은 빠르지 않다 */
export function fastRunShort(seconds: number, maxNoteMs: number): boolean {
  return seconds * 1000 < maxNoteMs - FAST_RUN_TOLERANCE_MS;
}

export function fastRunMoments(song: Song, profile: GameProfile, options: Pick<ValidateSongOptions, "canonicalOf"> = {}): FastRunMoment[] {
  const rule = profile.fastRunDrop;
  if (!rule) return [];
  const instrumentOf = instrumentResolver(song, options);
  const out: FastRunMoment[] = [];
  for (const ids of scoreTrackIds(song, chordsPerScore(song, profile))) {
    const tracks = ids.map((id) => song.tracks.find((t) => t.id === id)).filter((t): t is Track => t !== undefined);
    if (tracks.length < rule.minTracks) continue;
    interface Found extends FastRunLanding {
      readonly time: number;
      readonly order: number;
      /** 착지 음 구간 이름 (악기|구간 번호) */
      readonly key: string;
      /** 빠른 음 연속의 구간마다 음 수 */
      readonly runZones: ReadonlyMap<string, number>;
    }
    const landings: Found[] = [];
    tracks.forEach((track, order) => {
      const instrument = instrumentOf(track);
      // 타악기(큰북·심벌즈)는 높이와 상관없이 한 소리라, 빠른 음 6개 뒤 착지도 빠지지 않았다 (실측 2026-10-31, 큰북). 세지 않는다
      if (INSTRUMENTS.some((i) => i.id === instrument && i.percussion)) return;
      const range = soundingRangeOf(profile, instrument);
      const bounds = timbreBoundaries(profile, instrument);
      /** 접은 높이가 든 구간 번호 (경계 수로 센다) */
      const zoneOf = (pitch: number) => bounds.filter((x) => x <= pitch).length;
      const zoneRange = (z: number) => ({ low: Math.max(range.low, bounds[z - 1] ?? range.low), high: Math.min(range.high, (bounds[z] ?? range.high + 1) - 1) });
      const chains = chainsOf(song, track, range, profile.tieBendLimit).filter((c) => c.first.vol > 0);
      let run: number[] = [];
      for (let k = 0; k < chains.length; k++) {
        const c = chains[k]!;
        const prev = chains[k - 1];
        const zone = zoneOf(c.steps[0]!.pitch);
        // 앞 음과 쉼 없이 이어졌는지 (틈 < gapMs). 첫 음이면 앞 음이 없다
        const joined = prev !== undefined && !fastRunGapEnough(c.startAt - (prev.startAt + prev.length), rule.gapMs);
        if (!joined) run = [];
        if (fastRunShort(c.length, rule.maxNoteMs)) {
          run.push(zone);
          continue;
        }
        const runZones = new Map<string, number>();
        if (joined && run.length >= rule.minRun) for (const z of run) runZones.set(`${instrument}|${z}`, (runZones.get(`${instrument}|${z}`) ?? 0) + 1);
        // 빠른 음 연속 없이 시작한 음도 그 순간 같은 구간이면 함께 빠진다 (run 0, 세지는 않는다)
        landings.push({ trackId: track.id, noteId: c.first.id, start: c.first.start, run: runZones.size > 0 ? run.length : 0, zone: zoneRange(zone), time: c.startAt, order, key: `${instrument}|${zone}`, runZones });
        run = [];
      }
    });
    if (new Set(landings.filter((l) => l.runZones.size > 0).map((l) => l.trackId)).size < rule.minTracks) continue;
    landings.sort((a, b) => a.time - b.time || a.order - b.order);
    // 구간마다, 착지 시각 차가 gapMs 이내인 창에서 그 구간에 빠른 음 연속을 친 트랙을 센다. 넘으면 그 창에서 같은 구간에 착지한 음이 빠진다.
    // 같은 순간(gapMs 이내) 빠지는 음끼리는 구간이 달라도 한 순간으로 잇는다
    const keys = new Set(landings.flatMap((l) => [...l.runZones.keys()]));
    const dropped = new Set<number>();
    for (const key of keys) {
      for (let i = 0; i < landings.length; i++) {
        let j = i;
        while (j + 1 < landings.length && !fastRunGapEnough(landings[j + 1]!.time - landings[i]!.time, rule.gapMs)) j++;
        const window = landings.slice(i, j + 1).map((l, x) => ({ l, k: i + x }));
        const counted = window.filter(({ l }) => (l.runZones.get(key) ?? 0) >= rule.minRun);
        if (new Set(counted.map(({ l }) => l.trackId)).size < rule.minTracks) continue;
        // 빠른 음 수에 그 순간 같은 구간에서 시작하는 음을 차례로 더해 maxStarts를 넘는 음부터 빠진다
        let starts = counted.reduce((sum, { l }) => sum + (l.runZones.get(key) ?? 0), 0);
        for (const { l, k } of window) if (l.key === key && ++starts > rule.maxStarts) dropped.add(k);
      }
    }
    let group: number[] = [];
    const flush = () => {
      if (group.length === 0) return;
      const list = group.map((k) => {
        const { time: _time, order: _order, key: _key, runZones: _zones, ...landing } = landings[k]!;
        return landing;
      });
      out.push({ playerId: tracks[0]!.playerId, trackIds: ids, at: list[0]!.start, landings: list });
      group = [];
    };
    for (const k of [...dropped].sort((a, b) => a - b)) {
      if (group.length > 0 && fastRunGapEnough(landings[k]!.time - landings[group[0]!]!.time, rule.gapMs)) flush();
      group.push(k);
    }
    flush();
  }
  return out.sort((a, b) => cmp(a.at, b.at));
}

/**
 * 곡 전체 검사: 연주자별 채널 수, 악기 범위 밖이라 접혀 나는 음, 음색 경계를 넘는 &, 같은 연주자 트랙끼리 같은 음 겹침.
 */
export function validateSong(song: Song, profile: GameProfile, options: ValidateSongOptions = {}): SongDiagnostic[] {
  const out: SongDiagnostic[] = [];

  for (const player of song.players) {
    const tracks = song.tracks.filter((t) => t.playerId === player.id);
    if (tracks.length > profile.maxChordsPerPlayer) {
      out.push({
        level: "error",
        code: "player-channel-limit",
        params: { count: tracks.length, limit: profile.maxChordsPerPlayer },
        playerId: player.id,
      });
    }

    // 오르골·축음기는 장식품이 악보의 모든 트랙을 그 악기 하나로 친다. 다른 트랙 악기는 게임에서 그 소리가 나지 않는다
    for (const track of tracks) {
      const own = track.instrument?.canonical;
      if (own === undefined || own === player.instrument.canonical) continue;
      if (isSoloInstrument(profile, player.instrument.canonical)) {
        out.push({ level: "warning", code: "solo-score-own-instrument", trackId: track.id, playerId: player.id });
      } else if (isSoloInstrument(profile, own)) {
        out.push({ level: "warning", code: "solo-instrument-track", trackId: track.id, playerId: player.id });
      }
    }

    // 범위 밖 음도 게임은 받아 주지만 옥타브째 접어 다른 높이로 낸다 (악기는 트랙마다).
    // 재생과 같이 음역·샘플 길이는 트랙에서 고른 팩의 실제 악기로 정한다
    const instrumentOf = instrumentResolver(song, options);
    const rangeOf = (track: Track) => soundingRangeOf(profile, instrumentOf(track));
    for (const track of tracks) {
      const range = rangeOf(track);
      for (const n of track.notes) {
        const folded = foldPitch(n.pitch, range);
        if (folded === n.pitch) continue;
        out.push({
          level: "info",
          code: "pitch-fold",
          params: { octaves: (folded - n.pitch) / 12, sounds: noteName(folded), min: noteName(range.low), max: noteName(range.high) },
          trackId: track.id,
          noteId: n.id,
        });
      }
    }

    // 샘플은 반복 없이 끝나므로, 붙임 사슬이 샘플 끝보다 길면 뒷부분이 안 들린다.
    // 다른 음 붙임은 샘플 위치를 이어 가므로 재생과 같은 식(chainSampleEnd)으로 잰다
    const chainsByTrack = new Map(tracks.map((track) => [track.id, chainsOf(song, track, rangeOf(track), profile.tieBendLimit)]));
    for (const track of tracks) {
      for (const { first, steps, startAt, length } of chainsByTrack.get(track.id)!) {
        const soundEnd = chainSampleEnd(profile, instrumentOf(track), steps);
        const heard = soundEnd - startAt;
        if (Number.isFinite(heard) && length > heard + 0.05) {
          out.push({
            level: "info",
            code: "sample-cut",
            params: { seconds: Math.round(heard * 10) / 10, length: Math.round(length * 10) / 10 },
            trackId: track.id,
            noteId: first.id,
          });
        } else if (options.fadeDb !== undefined) {
          const faded = chainFadeEnd(profile, instrumentOf(track), steps, options.fadeDb) - startAt;
          if (faded < heard && length > faded + 0.05) {
            out.push({
              level: "info",
              code: "sample-faded",
              params: { seconds: Math.round(faded * 10) / 10, length: Math.round(length * 10) / 10, db: options.fadeDb },
              trackId: track.id,
              noteId: first.id,
            });
          }
        }
      }
    }

    // 실험실 소리 줄어듦: 긴 음이 울리는 동안 같은 악보의 다른 트랙이 새로 치는 음보다 한참 작아져 묻히면 알린다
    if (options.fadeDb !== undefined) {
      const fadeDb = options.fadeDb;
      for (const track of tracks) {
        const instrument = instrumentOf(track);
        for (const chain of chainsByTrack.get(track.id)!) {
          // v0으로 시작한 사슬은 소리가 없다 (묻힐 것도 없다)
          if (chain.length < BURIED_MIN_SECONDS || chain.first.vol <= 0) continue;
          const pitch = chain.steps[0]!.pitch;
          const own = dbOfVolume(profile, chain.first.vol);
          const gaps: number[] = [];
          for (const other of tracks) {
            if (other.id === track.id) continue;
            for (const o of chainsByTrack.get(other.id)!) {
              const after = o.startAt - chain.startAt;
              // 다른 트랙의 무음(v0) 음은 덮지 않는다
              if (after <= 0 || after >= chain.length || o.first.vol <= 0) continue;
              const fade = decayDbAt(profile, instrument, pitch, after);
              // 이미 거의 안 들리는 때는 sample-faded가 알린다
              if (fade <= -fadeDb) continue;
              gaps.push(dbOfVolume(profile, o.first.vol) - (own + fade));
            }
          }
          if (gaps.length < 2) continue;
          const gap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
          if (gap < BURIED_GAP_DB) continue;
          const vol = volumeForDb(profile, own + gap - BURIED_TARGET_DB);
          // 이미 가장 큰 v라 더 올릴 수 없으면 올리라고 하지 않는다 (다른 트랙을 줄이라고 알린다)
          out.push({
            level: "info",
            code: vol > chain.first.vol ? "fade-buried" : "fade-buried-max",
            params: { db: Math.round(gap), up: Math.max(0, vol - chain.first.vol), vol },
            trackId: track.id,
            noteId: chain.first.id,
          });
        }
      }
    }

    for (const track of tracks) {
      const instrument = instrumentOf(track);
      const notes = [...track.notes].sort((a, b) => cmp(a.start, b.start));
      for (let i = 0; i + 1 < notes.length; i++) {
        const a = notes[i]!;
        const b = notes[i + 1]!;
        if (a.tie !== "next" || a.pitch === b.pitch || cmp(end(a), b.start) !== 0) continue;
        if (crossesTimbre(profile, instrument, a.pitch, b.pitch)) {
          out.push({
            level: "warning",
            code: "tie-across-boundary",
            params: { from: a.pitch, to: b.pitch },
            trackId: track.id,
            noteId: a.id,
          });
        }
      }
    }

    // 같은 음을 두 채널이 동시에 내면 게임에서 한쪽이 묻히거나 끊길 수 있다
    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        const other = tracks[j]!;
        for (const a of sameNoteOverlaps(tracks[i]!.notes, other.notes)) {
          out.push({
            level: "info",
            code: "same-note-overlap",
            params: { track: other.name },
            trackId: tracks[i]!.id,
            noteId: a.id,
          });
        }
      }
    }
  }
  // 실험실 연주 누락음 위험: 순간마다 하나, 가장 이른 착지 음을 짚는다 (곡 검사 목록에 남겨 그 자리로 가고 고치기를 붙인다)
  const rule = profile.fastRunDrop;
  if (options.fastRunDrop && rule) {
    for (const m of fastRunMoments(song, profile, options)) {
      const first = m.landings[0]!;
      out.push({
        level: "warning",
        code: "fast-run-drop",
        params: { tracks: rule.minTracks, notes: rule.maxStarts, ms: rule.maxNoteMs, run: rule.minRun, gap: rule.gapMs },
        trackId: first.trackId,
        playerId: m.playerId,
        noteId: first.noteId,
      });
    }
  }
  // 원문의 t와 곡 템포가 어긋나면 3MLE 저장 때 원문 대신 다시 쓴 글이 나간다
  if (tempoMismatch(song)) out.push({ level: "warning", code: "tempo-mismatch" });

  return out;
}

/** a의 음 중 b에서 같은 높이 음과 시간이 겹치는 것. 두 트랙 모두 음이 겹치지 않으므로 한 번 훑으면 된다 */
function sameNoteOverlaps(aNotes: readonly Note[], bNotes: readonly Note[]): Note[] {
  const a = [...aNotes].sort((x, y) => cmp(x.start, y.start));
  const b = [...bNotes].sort((x, y) => cmp(x.start, y.start));
  const hits: Note[] = [];
  let j = 0;
  for (const n of a) {
    while (j < b.length && cmp(end(b[j]!), n.start) <= 0) j++;
    for (let k = j; k < b.length && cmp(b[k]!.start, end(n)) < 0; k++) {
      if (b[k]!.pitch === n.pitch) {
        hits.push(n);
        break;
      }
    }
  }
  return hits;
}
