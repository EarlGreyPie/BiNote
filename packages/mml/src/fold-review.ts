import { add, cmp, crossesTimbre, foldPitch, INSTRUMENTS, rat, soundingRangeOf, sub, type Command, type GameProfile, type Note, type Rat, type Song, type Track } from "@mmlce/core";
import { setTracksNotes } from "./edit.js";

/**
 * 접힘 검토: 악기가 그 높이로 낼 수 없는 음은 게임이 음마다 옥타브째 접어 내므로(실측 음역, profile.instrumentRanges),
 * 한 구간 안에서 몇 음만 접히면 선율이 중간에 옥타브째 튄다. 쉼표로 나뉜 구간마다 구간째 옥타브를 옮기는
 * 방법을 견주어 보여 준다. 옮긴 뒤 접히는 음 수, 구간 안 옥타브 튐, 다른 트랙과 같은 높이로 겹치는 음,
 * 음색 경계를 넘는 &(실측 샘플 구역)를 센다. 음을 저절로 바꾸지 않는다.
 */

/** 구간째 옮기는 방법 하나 */
export interface FoldOption {
  /** 반음 수 (12의 배수, 0은 그대로 = 게임이 음마다 접음) */
  readonly shift: number;
  /** 옮긴 뒤에도 접히는 음 수 */
  readonly folds: number;
  /** 게임에서 나는 높이로 볼 때 구간 안에서 이웃 음 사이가 쓴 것과 옥타브째 달라지는 곳 수 */
  readonly breaks: number;
  /** 게임에서 나는 높이가 같은 때 울리는 다른 트랙 음과 같아지는 음 수 (같은 소리가 겹쳐 하나가 묻힘) */
  readonly doubled: number;
  /** 음색 경계를 넘는 & 수 (넘는 순간 샘플이 바뀌어 음색이 튐) */
  readonly timbre: number;
}

/** 접히는 음이 있는 구간 하나 */
export interface FoldPhrase {
  readonly trackId: string;
  readonly start: Rat;
  readonly end: Rat;
  readonly noteIds: readonly string[];
  /** 구간에서 쓴 가장 낮은·높은 음 */
  readonly low: number;
  readonly high: number;
  /** 0(그대로)이 처음, 나머지는 접힘이 줄어드는 옮기기 */
  readonly options: readonly FoldOption[];
  /** 권하는 옮기기 (그대로가 가장 나으면 0) */
  readonly best: number;
}

/** 트랙 악기 (재생·곡 검사와 같은 해석: 번호로만 아는 악기는 실제 악기로) */
export type FoldInstrumentOf = (track: Track) => string | undefined;

export interface FoldReviewOptions {
  /** 이만큼 이상 쉬면 다른 구간으로 본다 (기본 8분쉼표 = 온음표 1/8) */
  readonly gap?: Rat;
}

const end = (n: Note): Rat => add(n.start, n.dur);

/** 트랙 음을 쉼표로 나눈 구간들. & 사슬과 겹친 음은 한 구간 */
function phrasesOf(notes: readonly Note[], gap: Rat): Note[][] {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start) || a.pitch - b.pitch);
  const out: Note[][] = [];
  let cur: Note[] = [];
  let reach: Rat | undefined;
  let tied = false;
  for (const n of sorted) {
    if (cur.length > 0 && reach && !tied && cmp(sub(n.start, reach), gap) >= 0) {
      out.push(cur);
      cur = [];
    }
    cur.push(n);
    reach = reach && cmp(reach, end(n)) > 0 ? reach : end(n);
    tied = n.tie === "next";
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** 접히는 음이 있는 구간마다 옮기기 방법을 견준다 */
export function reviewFolds(song: Song, profile: GameProfile, instrumentOf: FoldInstrumentOf, options: FoldReviewOptions = {}): FoldPhrase[] {
  const gap = options.gap ?? rat(1, 8);
  const sounding = song.tracks.map((track) => {
    const range = soundingRangeOf(profile, instrumentOf(track));
    return { track, notes: track.notes.map((n) => ({ start: n.start, end: end(n), pitch: foldPitch(n.pitch, range) })) };
  });
  const out: FoldPhrase[] = [];
  for (const track of song.tracks) {
    const instrument = instrumentOf(track);
    const range = soundingRangeOf(profile, instrument);
    const others = sounding.filter((x) => x.track.id !== track.id).flatMap((x) => x.notes);
    for (const phrase of phrasesOf(track.notes, gap)) {
      if (!phrase.some((n) => foldPitch(n.pitch, range) !== n.pitch)) continue;
      const evaluate = (shift: number): FoldOption => {
        const heard = phrase.map((n) => foldPitch(n.pitch + shift, range));
        let breaks = 0;
        for (let k = 1; k < phrase.length; k++) {
          const written = phrase[k]!.pitch - phrase[k - 1]!.pitch;
          if (heard[k]! - heard[k - 1]! !== written) breaks++;
        }
        let doubled = 0;
        phrase.forEach((n, k) => {
          const e = end(n);
          if (others.some((o) => o.pitch === heard[k] && cmp(o.start, e) < 0 && cmp(n.start, o.end) < 0)) doubled++;
        });
        let timbre = 0;
        for (const n of phrase) {
          if (n.tie !== "next") continue;
          const next = phrase.find((m) => m !== n && cmp(m.start, end(n)) === 0);
          if (next && next.pitch !== n.pitch && crossesTimbre(profile, instrument, n.pitch + shift, next.pitch + shift)) timbre++;
        }
        return { shift, folds: phrase.filter((n) => foldPitch(n.pitch + shift, range) !== n.pitch + shift).length, breaks, doubled, timbre };
      };
      const asIs = evaluate(0);
      // 게임이 받는 옥타브(o0-o8) 안에서만 옮긴다
      const fits = (shift: number) => phrase.every((n) => n.pitch + shift >= 12 && n.pitch + shift <= 119);
      const moves = [-36, -24, -12, 12, 24, 36].filter(fits).map(evaluate).filter((o) => o.folds < asIs.folds);
      const all = [asIs, ...moves];
      // 선율 모양(튐 없음) → 쓴 대로 남(접힘 없음) → 겹침 → 음색 튐 → 덜 옮김
      const rank = (o: FoldOption) => [o.breaks, o.folds, o.doubled, o.timbre, Math.abs(o.shift)];
      const best = [...all].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
        return 0;
      })[0]!;
      const reach = phrase.reduce((r, n) => (cmp(end(n), r) > 0 ? end(n) : r), phrase[0]!.start);
      out.push({
        trackId: track.id,
        start: phrase[0]!.start,
        end: reach,
        noteIds: phrase.map((n) => n.id),
        low: Math.min(...phrase.map((n) => n.pitch)),
        high: Math.max(...phrase.map((n) => n.pitch)),
        options: all,
        best: best.shift,
      });
    }
  }
  return out.sort((a, b) => cmp(a.start, b.start));
}

/** 음을 모두 접지 않고 낼 수 있는 악기들 (실측 음역 기준, 타악기 빼고) */
export function instrumentsCovering(profile: GameProfile, notes: readonly Note[]): string[] {
  if (notes.length === 0) return [];
  const low = Math.min(...notes.map((n) => n.pitch));
  const high = Math.max(...notes.map((n) => n.pitch));
  return INSTRUMENTS.filter((i) => !i.percussion)
    .map((i) => i.id)
    .filter((id) => {
      const r = soundingRangeOf(profile, id);
      return r.low <= low && high <= r.high;
    });
}

/** 고른 구간을 옮긴다 (실행 취소 한 번). 0이 아니고 그 구간 선택지에 있는 것만 (옛 선택이 남아 다시 옮기지 않게) */
export function applyFoldShifts(song: Song, picks: readonly { readonly phrase: FoldPhrase; readonly shift: number }[], label = "접힘 검토"): Command | undefined {
  const byTrack = new Map<string, Map<string, number>>();
  for (const { phrase, shift } of picks) {
    if (shift === 0 || !phrase.options.some((o) => o.shift === shift)) continue;
    const m = byTrack.get(phrase.trackId) ?? new Map<string, number>();
    for (const id of phrase.noteIds) m.set(id, shift);
    byTrack.set(phrase.trackId, m);
  }
  if (byTrack.size === 0) return undefined;
  const changes = [...byTrack].flatMap(([trackId, shifts]) => {
    const track = song.tracks.find((t) => t.id === trackId);
    return track ? [{ trackId, notes: track.notes.map((n) => (shifts.has(n.id) ? { ...n, pitch: n.pitch + shifts.get(n.id)! } : n)) }] : [];
  });
  return setTracksNotes(changes, label);
}
