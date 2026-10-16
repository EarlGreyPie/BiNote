import {
  add,
  cmp,
  eq,
  sub,
  ZERO,
  normalizeTempo,
  getProfile,
  PROFILES,
  type Command,
  type GameProfile,
  type Note,
  type Rat,
  type Song,
  type TempoEvent,
  type Track,
  type TrackText,
} from "@mmlce/core";
import { parseMml, type ParseResult } from "./parser.js";
import { optimizeMml } from "./optimizer.js";
import { placeTempo, placeTempoByScore, scoreTrackIds } from "./tempo-placement.js";
import { chordsPerScore } from "./clipboard.js";
import { distributeChords } from "./distribute.js";
import { sameSound } from "./compare.js";
import { audibleTempo, localAt, spliceText, surgicalSource, tempoInsertOffset, tempoTokens, type TempoToken } from "./tempo-text.js";

/** 곡 프로필로 연주자마다 악보 하나에 담는 트랙 수 (모르는 프로필이면 모바일) */
export function songChordsPerScore(song: Song): (playerId: string) => number {
  return chordsPerScore(song, PROFILES[song.meta.profileId] ?? getProfile("mobile"));
}

/** 곡의 게임 악보마다 트랙 id (출력·악보책 나누기와 같은 묶음) */
export function songScores(song: Song): string[][] {
  return scoreTrackIds(song, songChordsPerScore(song));
}

/** 들리는 템포마다 그 빠르기가 이어지는 구간 [event.at, next) */
interface TempoWindow {
  readonly event: TempoEvent;
  readonly next: Rat | undefined;
}

function tempoWindows(map: readonly TempoEvent[]): TempoWindow[] {
  const audible = audibleTempo(map);
  return audible.map((event, k) => ({ event, next: audible[k + 1]?.at }));
}

/** 원문의 t가 이 템포를 나타내는지: 같은 빠르기이고 그 구간 안 (음 경계로 옮겨 적은 t도 여기 든다) */
function inWindow(token: { readonly at: Rat; readonly bpm: number }, w: TempoWindow): boolean {
  return token.bpm === w.event.bpm && cmp(token.at, w.event.at) >= 0 && (w.next === undefined || cmp(token.at, w.next) < 0);
}

/**
 * 악보 하나의 글 템포. 게임은 악보마다 템포를 따로 읽으므로 악보마다 들리는 곡 템포가 모두 있어야 한다.
 * 원문(mml)에 이미 적힌 템포는 그대로 두고, 나머지는 원문 없는 첫 트랙에 출력기가 쓴다.
 * 원문 없는 트랙이 없으면 나머지는 빠진 템포다.
 */
function scoreTempo(song: Song, ids: readonly string[]): { generated: Map<string, TempoEvent[]>; missing: TempoEvent[] } {
  const tracks = ids.map((id) => song.tracks.find((t) => t.id === id)!);
  const declared = tracks.flatMap((t) => (t.mml ? tempoTokens(t.mml) : []));
  const open = tempoWindows(song.tempo).filter((w) => !declared.some((d) => inWindow(d, w)));
  const free = tracks.filter((t) => !t.mml);
  const generated = new Map<string, TempoEvent[]>();
  if (free.length === 0) return { generated, missing: open.map((w) => w.event) };
  // 원문 없는 첫 트랙에 모두 넣는다 (음 가운데면 출력기가 &로 나누고, 그럴 수 없으면 뒤쪽 음 경계로 옮긴다)
  const [placed] = placeTempo(
    [free[0]!.notes],
    open.map((w) => w.event),
    undefined,
    (e) => open.find((w) => eq(w.event.at, e.at))?.next,
  );
  generated.set(free[0]!.id, placed ?? []);
  return { generated, missing: [] };
}

/**
 * 트랙을 화면에 보여 줄 MML. 원문이 있으면 원문, 없으면 출력기로 쓴다.
 * 출력할 때는 그 악보 원문에 적히지 않은 곡 템포를 원문 없는 트랙에 넣는다 (scoreTempo).
 */
export function trackSource(song: Song, track: Track): TrackText {
  if (track.mml) return track.mml;
  const score = songScores(song).find((ids) => ids.includes(track.id)) ?? [track.id];
  return { text: optimizeMml(track.notes, { tempo: scoreTempo(song, score).generated.get(track.id) ?? [] }).text };
}

export interface ParsedTrackText {
  readonly parsed: ParseResult;
  readonly notes: Note[];
  /** 곡 위치로 옮긴 템포 */
  readonly tempo: TempoEvent[];
}

/** 원문을 읽어 트랙 음과 템포로. 음 id는 트랙 id + 순번이라 같은 글이면 같은 id가 나온다 */
export function parseTrackText(trackId: string, source: TrackText): ParsedTrackText {
  const parsed = parseMml(source.text);
  const shift = (r: Rat) => (source.offset ? add(r, source.offset) : r);
  const notes = parsed.notes.map((n, k) => ({
    id: `${trackId}.${k + 1}`,
    start: shift(n.start),
    dur: n.dur,
    pitch: n.pitch,
    vol: n.vol,
    tie: n.tie,
  }));
  return { parsed, notes, tempo: parsed.tempo.map((t) => ({ at: shift(t.at), bpm: t.bpm })) };
}

/** 템포 목록에서 지울 것들을 하나씩만 뺀다 (같은 위치·같은 빠르기가 여러 트랙에 있을 수 있음) */
function removeEach(from: readonly TempoEvent[], remove: readonly TempoEvent[]): TempoEvent[] {
  const out = [...from];
  for (const r of remove) {
    const i = out.findIndex((e) => e.bpm === r.bpm && cmp(e.at, r.at) === 0);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}

/**
 * 트랙 MML 원문을 바꾸는 명령. 음은 새 원문에서 다시 읽고, 곡 템포 지도는
 * 옛 원문이 넣었던 템포를 빼고 새 원문의 템포를 더한다(다른 트랙의 템포는 그대로).
 */
export function setTrackText(trackId: string, text: string): Command {
  return {
    label: "MML 입력",
    apply(song) {
      const track = song.tracks.find((t) => t.id === trackId);
      if (!track) return song;
      const before = trackSource(song, track);
      const next: TrackText = before.offset ? { text, offset: before.offset } : { text };
      const old = parseTrackText(trackId, before);
      const now = parseTrackText(trackId, next);
      // 읽을 때 여러 트랙에 같이 적힌 템포는 하나로 합쳐졌으므로, 다른 트랙 원문에 아직 적혀 있는 템포는 빼지 않는다
      const others = song.tracks.filter((t) => t.id !== trackId && t.mml).flatMap((t) => parseTrackText(t.id, t.mml!).tempo);
      const stillDeclared = (e: TempoEvent) => others.some((o) => o.bpm === e.bpm && cmp(o.at, e.at) === 0);
      // 지도에 없던 옛 원문의 t(다른 악보 때문에 음 경계로 옮겨 적은 t)가 그대로 남아 있으면 지도에 더하지 않는다
      const mirror = (e: TempoEvent) =>
        old.tempo.some((o) => o.bpm === e.bpm && eq(o.at, e.at)) && !song.tempo.some((m) => m.bpm === e.bpm && eq(m.at, e.at));
      return {
        ...song,
        tempo: normalizeTempo([...removeEach(song.tempo, old.tempo.filter((e) => !stillDeclared(e))), ...now.tempo.filter((e) => !mirror(e))]),
        tracks: song.tracks.map((t) => (t.id === trackId ? { ...t, notes: now.notes, mml: next } : t)),
      };
    },
    invert(before) {
      const track = before.tracks.find((t) => t.id === trackId);
      return restoreTrack(trackId, track, before.tempo);
    },
  };
}

/** 트랙과 템포 지도를 이전 상태로 되돌리는 명령 */
function restoreTrack(trackId: string, track: Track | undefined, tempo: readonly TempoEvent[]): Command {
  return {
    label: "MML 입력 되돌리기",
    apply(song) {
      if (!track) return song;
      return { ...song, tempo, tracks: song.tracks.map((t) => (t.id === trackId ? track : t)) };
    },
    invert(before) {
      return restoreTrack(trackId, before.tracks.find((t) => t.id === trackId), before.tempo);
    },
  };
}

/**
 * 피아노롤처럼 음을 직접 고치는 명령. 원문은 지우고, 그때부터 화면 글은 출력기가 쓴다.
 * 곡 템포 지도는 건드리지 않는다.
 */
export function setTrackNotes(trackId: string, notes: readonly Note[], label = "음 편집"): Command {
  return {
    label,
    apply(song) {
      return {
        ...song,
        tracks: song.tracks.map((t) => {
          if (t.id !== trackId) return t;
          const { mml: _mml, ...rest } = t;
          return { ...rest, notes };
        }),
      };
    },
    invert(before) {
      const track = before.tracks.find((t) => t.id === trackId);
      return restoreTrack(trackId, track, before.tempo);
    },
  };
}

/**
 * 모든 트랙을 최적화 출력기로 다시 쓰는 명령 (소리는 같고 글자 수만 준다).
 * 게임은 악보마다 템포를 따로 읽으므로 곡 템포를 악보마다 모두 넣는다 (profile이 없으면 곡 프로필로 악보를 묶는다).
 * 사용자가 쓴 원문 표기는 바뀐다.
 */
export function compactSong(profile?: GameProfile, label = "글자 수 줄이기"): Command {
  return {
    label,
    apply(song) {
      const placed = placeTempoByScore(song, profile ? chordsPerScore(song, profile) : songChordsPerScore(song));
      const tracks: Track[] = [];
      for (const t of song.tracks) {
        const mml: TrackText = { text: optimizeMml(t.notes, { tempo: placed.get(t.id) ?? [] }).text };
        const notes = parseTrackText(t.id, mml).notes;
        // 출력기가 쓸 수 없는 길이(아주 짧은 셋잇단 등)는 버려지므로, 다시 읽은 음이 원래 음과 다르면
        // 곡을 그대로 둔다 (글자 수를 줄이려다 음을 잃지 않게)
        if (!sameSound(t.notes, notes)) return song;
        tracks.push({ ...t, notes, mml });
      }
      return {
        ...song,
        // 채널마다 같은 템포가 적혀 있던 것은 하나로 합치고, 들리지 않는 같은 빠르기 템포는 쓰지 않으므로 지도에서도 뺀다
        tempo: audibleTempo(song.tempo),
        tracks,
      };
    },
    invert(before) {
      return restoreSong(before);
    },
  };
}

function restoreSong(song: Song): Command {
  return {
    label: "되돌리기",
    apply: () => song,
    invert: (before) => restoreSong(before),
  };
}

/**
 * 화음 분산 명령. 음을 옮긴 뒤 모든 트랙을 최적화 출력기로 다시 쓴다
 * (곡 템포를 채널마다 다시 나눠 넣어야 하므로 옮기지 않은 트랙의 표기도 바뀐다).
 */
export function distributeSong(profile: GameProfile, label = "화음 분산", limit?: number): Command {
  return {
    label,
    apply: (song) => compactSong(profile).apply(distributeChords(song, profile, limit === undefined ? {} : { limit }).song),
    invert: (before) => restoreSong(before),
  };
}

/**
 * 다른 곡의 연주자·트랙을 지금 곡 뒤에 더하는 명령 (MML@ 붙여넣기 등).
 * id가 겹치지 않게 연주자·트랙 id를 새로 매기고, 템포 지도는 합친다.
 */
export function appendSong(other: Song, label = "악보 더하기"): Command {
  return {
    label,
    apply(song) {
      const next = (ids: readonly string[], prefix: string) => {
        let n = Math.max(0, ...ids.map((id) => Number(id.slice(prefix.length)) || 0));
        return () => `${prefix}${++n}`;
      };
      const playerId = next(
        song.players.map((p) => p.id).filter((id) => id.startsWith("p")),
        "p",
      );
      const trackId = next(
        song.tracks.map((t) => t.id).filter((id) => id.startsWith("t")),
        "t",
      );
      const players = new Map(other.players.map((p) => [p.id, { ...p, id: playerId() }]));
      const tracks = other.tracks.map((t) => {
        const id = trackId();
        const notes = t.mml ? parseTrackText(id, t.mml).notes : t.notes.map((n, k) => ({ ...n, id: `${id}.${k + 1}` }));
        return { ...t, id, playerId: players.get(t.playerId)?.id ?? t.playerId, notes };
      });
      return {
        ...song,
        tempo: normalizeTempo([...song.tempo, ...other.tempo]),
        players: [...song.players, ...players.values()],
        tracks: [...song.tracks, ...tracks],
      };
    },
    invert: (before) => restoreSong(before),
  };
}

/**
 * 마디 넣기: at 자리에 length만큼 빈 시간을 넣는다. at 뒤에서 시작하는 음·템포·마커를 모두 민다.
 * at에 걸쳐 있는 음은 그대로 둔다(길이 유지). 바뀐 트랙은 원문 대신 출력기로 다시 쓴다.
 */
export function insertTime(at: Rat, length: Rat, label = "마디 넣기"): Command {
  const shift = (r: Rat) => (cmp(r, at) >= 0 ? add(r, length) : r);
  return {
    label,
    apply(song) {
      return {
        ...song,
        tempo: song.tempo.map((t) => ({ ...t, at: shift(t.at) })),
        // 첫 박자(0)는 그대로, 넣는 자리 뒤의 박자 변화는 함께 민다
        timeSig: song.timeSig.map((s) => (cmp(s.at, ZERO) === 0 ? s : { ...s, at: shift(s.at) })),
        markers: song.markers.map((m) => ({ ...m, at: shift(m.at) })),
        tracks: song.tracks.map((t) => {
          if (!t.notes.some((n) => cmp(n.start, at) >= 0)) return t;
          const { mml: _mml, ...rest } = t;
          const sorted = [...t.notes].sort((a, b) => cmp(a.start, b.start));
          const notes = sorted.map((n, i) => {
            const next = sorted[i + 1];
            // 넣는 자리 앞 음이 뒤로 밀린 음과 &로 이어져 있었으면 사이가 벌어지므로 &를 푼다
            const split = n.tie === "next" && next && cmp(n.start, at) < 0 && cmp(next.start, at) >= 0;
            return { ...n, start: shift(n.start), ...(split ? { tie: "none" as const } : {}) };
          });
          return { ...rest, notes };
        }),
      };
    },
    invert: (before) => restoreSong(before),
  };
}

/** 구간 [at, end) 안의 변화(템포·박자)를 빼고 뒤를 당긴다. 구간 안 마지막 값은 at에 남긴다 */
function removeSpan<T extends { readonly at: Rat }>(events: readonly T[], at: Rat, end: Rat, length: Rat): T[] {
  const inside = events.filter((e) => cmp(e.at, at) >= 0 && cmp(e.at, end) < 0);
  const kept = events
    .filter((e) => cmp(e.at, at) < 0 || cmp(e.at, end) >= 0)
    .map((e) => (cmp(e.at, end) >= 0 ? { ...e, at: sub(e.at, length) } : e));
  const last = inside[inside.length - 1];
  const out = last && !kept.some((e) => cmp(e.at, at) === 0) ? [...kept, { ...last, at }] : kept;
  return out.sort((a, b) => cmp(a.at, b.at));
}

/**
 * 마디 빼기: [at, at+length) 구간을 지우고 뒤를 당긴다. 구간 안의 음은 지우고,
 * 구간에 걸친 음은 구간 밖 부분만 남긴다. 구간 안의 템포·박자는 마지막 값을 at에 남긴다.
 * &로 이어 주던 다음 음이 지워졌거나 더 이상 바로 붙지 않으면 &를 푼다.
 */
export function deleteTime(at: Rat, length: Rat, label = "마디 빼기"): Command {
  const end = add(at, length);
  const back = (r: Rat) => (cmp(r, end) >= 0 ? sub(r, length) : r);
  return {
    label,
    apply(song) {
      return {
        ...song,
        tempo: removeSpan(song.tempo, at, end, length),
        timeSig: removeSpan(song.timeSig, at, end, length),
        markers: song.markers.filter((m) => cmp(m.at, at) < 0 || cmp(m.at, end) >= 0).map((m) => ({ ...m, at: back(m.at) })),
        tracks: song.tracks.map((t) => {
          const touched = t.notes.some((n) => cmp(add(n.start, n.dur), at) > 0);
          if (!touched) return t;
          const sorted = [...t.notes].sort((a, b) => cmp(a.start, b.start));
          // 원래 음 → 남은 음 (지워졌으면 없음)
          const kept = new Map<Note, Note>();
          for (const n of sorted) {
            const nEnd = add(n.start, n.dur);
            if (cmp(nEnd, at) <= 0) kept.set(n, n);
            else if (cmp(n.start, end) >= 0) kept.set(n, { ...n, start: sub(n.start, length) });
            else if (cmp(n.start, at) < 0) {
              // 구간 앞에서 시작: 앞부분 + (구간 뒤로 넘친 부분)
              const tail = cmp(nEnd, end) > 0 ? sub(nEnd, end) : undefined;
              kept.set(n, { ...n, dur: tail ? add(sub(at, n.start), tail) : sub(at, n.start) });
            } else if (cmp(nEnd, end) > 0) {
              // 구간 안에서 시작해 밖으로 넘침: 넘친 부분만 at에서
              kept.set(n, { ...n, start: at, dur: sub(nEnd, end) });
            }
          }
          const notes: Note[] = [];
          sorted.forEach((n, k) => {
            const now = kept.get(n);
            if (!now) return;
            if (now.tie !== "next") return void notes.push(now);
            // 원래 &로 이어 주던 음(바로 붙은 다음 음)이 남아 있고 여전히 바로 붙어야 &를 둔다
            const target = sorted[k + 1];
            const targetNow = target && eq(add(n.start, n.dur), target.start) ? kept.get(target) : undefined;
            const joined = targetNow && eq(add(now.start, now.dur), targetNow.start);
            notes.push(joined ? now : { ...now, tie: "none" });
          });
          const { mml: _mml, ...rest } = t;
          return { ...rest, notes };
        }),
      };
    },
    invert: (before) => restoreSong(before),
  };
}

/** 여러 트랙의 음을 한 번에 바꾸는 명령 (MIDI 건반 화음 입력 등). 실행 취소 한 칸 */
export function setTracksNotes(changes: readonly { trackId: string; notes: readonly Note[] }[], label = "음 넣기"): Command {
  const byId = new Map(changes.map((c) => [c.trackId, c.notes]));
  return {
    label,
    apply(song) {
      return {
        ...song,
        tracks: song.tracks.map((t) => {
          const notes = byId.get(t.id);
          if (!notes) return t;
          const { mml: _mml, ...rest } = t;
          return { ...rest, notes };
        }),
      };
    },
    invert: (before) => restoreSong(before),
  };
}

/** 곡 전체를 바꾸고 되돌릴 때 통째로 돌려놓는 명령 */
function songCommand(label: string, change: (song: Song) => Song): Command {
  return { label, apply: change, invert: (before) => restoreSong(before) };
}

/**
 * at 위치 템포를 bpm으로 (없으면 넣는다). 곡 템포 지도를 고치고 원문에 쓴 t도 함께 고친다:
 * 그 템포를 나타내던 원문의 t(그 자리 t, 음 경계로 옮겨 적은 t)는 숫자만 바꾸고, 그 템포가 없는 악보는 음·쉼표 경계가 있는
 * 원문 하나에 끼운다 (이미 t를 쓴 트랙 먼저. 원문 없는 트랙이 있으면 출력기가 넣으므로 끼우지 않는다).
 * 끼울 경계가 그 악보 어느 원문에도 없으면 그 악보 첫 원문을 버려 출력기가 쓰게 한다.
 * 문법 오류가 있는 원문은 손대지 않는다 (검사의 tempo-mismatch 경고가 알려 준다)
 */
export function setTempoAt(at: Rat, bpm: number, label = "템포"): Command {
  return tempoCommand(label, (song) => withTempo(song, at, bpm));
}

/** 화면 글(원문 또는 출력)에 곡 템포가 다 적혀 있지 않은 악보 (악보마다 트랙 id). 게임은 악보마다 템포를 따로 읽는다 */
export function scoresMissingTempo(song: Song): string[][] {
  if (song.tempo.length === 0) return [];
  return songScores(song).filter((ids) => scoreTempo(song, ids).missing.length > 0);
}

/** 곡 템포를 모든 악보의 글에 적는다 (악보 1에만 템포를 적은 곡 등). 실행 취소 한 칸 */
export function fillScoreTempo(label = "악보마다 템포 넣기"): Command {
  return songCommand(label, (song) => songScores(song).reduce((next, ids) => fillScore(next, ids, scoreTempo(next, ids).missing), song));
}

/** at 위치 템포를 지운다. 그 템포를 나타내던 원문의 t도 모두 지운다 */
export function removeTempoAt(at: Rat, label = "템포 지우기"): Command {
  return tempoCommand(label, (song) => withoutTempo(song, at));
}

/** 템포를 다른 위치로 옮긴다 (가는 자리에 있던 템포는 덮는다). 실행 취소 한 칸 */
export function moveTempo(from: Rat, to: Rat, label = "템포 옮기기"): Command {
  return tempoCommand(label, (song) => {
    const event = song.tempo.find((e) => eq(e.at, from));
    if (!event || eq(from, to)) return song;
    return withTempo(withoutTempo(song, from), to, event.bpm);
  });
}

/** 템포 여러 개를 한 번에 지우고 넣는다 (원곡에 템포 맞추기). 실행 취소 한 칸 */
export function setTempos(set: readonly TempoEvent[], remove: readonly Rat[], label = "템포 맞추기"): Command {
  return tempoCommand(label, (song) => {
    let next = song;
    for (const at of remove) next = withoutTempo(next, at);
    for (const e of set) next = withTempo(next, e.at, e.bpm);
    return next;
  });
}

/**
 * 템포를 고치는 명령. 고친 뒤 새로 빠진 템포(고친 템포, 또는 뒤 템포가 사라져 다시 들리게 된 앞 템포)는
 * 그 악보 원문에도 적는다. 고치기 전부터 빠져 있던 것은 그대로 둔다 (곡 메뉴 "악보마다 템포 넣기"가 따로 채운다)
 */
function tempoCommand(label: string, change: (song: Song) => Song): Command {
  return songCommand(label, (song) => {
    const next = change(song);
    if (next === song) return song;
    const key = (ids: readonly string[], e: TempoEvent) => `${ids[0]}|${e.bpm}@${e.at.n}/${e.at.d}`;
    const before = new Set(songScores(song).flatMap((ids) => scoreTempo(song, ids).missing.map((e) => key(ids, e))));
    return songScores(next).reduce((out, ids) => {
      const fresh = scoreTempo(out, ids).missing.filter((e) => !before.has(key(ids, e)));
      return fresh.length > 0 ? fillScore(out, ids, fresh) : out;
    }, next);
  });
}

/** 지도 템포 at을 나타내는 원문의 t: 그 자리 t와, 같은 빠르기로 그 구간 안에 옮겨 적힌 t (그 자리에 다른 지도 템포가 있으면 빼고) */
function tokensFor(song: Song, at: Rat): (token: TempoToken) => boolean {
  const window = tempoWindows(song.tempo).find((w) => eq(w.event.at, at));
  return (token) =>
    eq(token.at, at) || (window !== undefined && inWindow(token, window) && !song.tempo.some((e) => eq(e.at, token.at)));
}

function withTempo(song: Song, at: Rat, bpm: number): Song {
  const represents = tokensFor(song, at);
  const tracks = song.tracks.map((t) => {
    const hits = (t.mml ? surgicalSource(t.mml)?.tokens : undefined)?.filter(represents) ?? [];
    if (!t.mml || hits.length === 0) return t;
    return { ...t, mml: { ...t.mml, text: spliceText(t.mml.text, hits.map((h) => ({ span: h.span, text: `t${bpm}` }))) } };
  });
  return { ...song, tempo: normalizeTempo([...song.tempo.filter((e) => !eq(e.at, at)), { at, bpm }]), tracks };
}

function withoutTempo(song: Song, at: Rat): Song {
  const represents = tokensFor(song, at);
  const tracks = song.tracks.map((t) => {
    if (!t.mml) return t;
    const hits = surgicalSource(t.mml)?.tokens.filter(represents) ?? [];
    if (hits.length === 0) return t;
    const text = t.mml.text;
    // 앞뒤가 모두 빈칸이면 빈칸 하나도 같이 지워 두 칸이 남지 않게 한다
    const spans = hits.map((h): [number, number] => {
      const [a, b] = h.span;
      const spaceBefore = a === 0 || /\s/.test(text[a - 1]!);
      return spaceBefore && /\s/.test(text[b] ?? "") ? [a, b + 1] : [a, b];
    });
    return { ...t, mml: { ...t.mml, text: spliceText(text, spans.map((span) => ({ span, text: "" }))) } };
  });
  return { ...song, tempo: song.tempo.filter((e) => !eq(e.at, at)), tracks };
}

/**
 * 악보 하나에 빠진 템포를 원문에 적는다: 음·쉼표 경계가 있는 원문 하나에 끼우고 (이미 t를 쓴 원문 먼저, 그다음 트랙 순서),
 * 끼울 곳이 없으면 그 악보 첫 원문을 버려 출력기가 쓰게 한다 (음 가운데면 출력기가 &로 나누거나 뒤쪽 음 경계로 옮긴다)
 */
function fillScore(song: Song, ids: readonly string[], missing: readonly TempoEvent[]): Song {
  let out = song;
  for (const e of missing) {
    const tracks = ids.map((id) => out.tracks.find((t) => t.id === id)!);
    if (tracks.some((t) => !t.mml)) break;
    const sources = tracks.map((t) => surgicalSource(t.mml!));
    const order = tracks.map((_, k) => k).filter((k) => sources[k]);
    order.sort((a, b) => Number(sources[b]!.tokens.length > 0) - Number(sources[a]!.tokens.length > 0));
    let done = false;
    for (const k of order) {
      const mml = tracks[k]!.mml!;
      const local = localAt(mml, e.at);
      const offset = local && tempoInsertOffset(mml.text, sources[k]!.parsed, local);
      if (offset === undefined || offset === null) continue;
      const id = tracks[k]!.id;
      out = { ...out, tracks: out.tracks.map((t) => (t.id === id ? { ...t, mml: { ...mml, text: spliceText(mml.text, [{ span: [offset, offset], text: `t${e.bpm}` }]) } } : t)) };
      done = true;
      break;
    }
    if (done) continue;
    // 경계가 없다: 첫 원문을 버리면 출력기가 그 트랙을 쓰며 남은 템포를 모두 넣는다
    const first = order[0];
    if (first === undefined) break;
    const id = tracks[first]!.id;
    out = {
      ...out,
      tracks: out.tracks.map((t) => {
        if (t.id !== id) return t;
        const { mml: _mml, ...rest } = t;
        return rest;
      }),
    };
    break;
  }
  return out;
}

