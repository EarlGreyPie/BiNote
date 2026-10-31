import { add, cmp, eq, fromLength, sub, tempoClock, ZERO, type GameProfile, type Note, type Rat, type Song } from "@mmlce/core";
import { optimizeMml } from "./optimizer.js";
import { canWriteExactly } from "./printer.js";
import { fastRunGapEnough, fastRunMoments, type FastRunMoment, type ValidateSongOptions } from "./validate.js";

/**
 * 실험실 "연주 누락음 검사" 고치기 (고를 때만 쓰는 명령의 계획). 걸린 순간의 착지 음(빠른 음 연속과 같은 샘플 구간에 있어
 * 빠질 위험이 있는 음, fastRunMoments)을 조금 늦춘다. 다른 구간의 착지 음은 빠지지 않으므로 그대로 둔다.
 * 착지 음 끝은 그대로 두고 시작만 늦추므로(시작 += L, 길이 -= L) 다른 음과 곡 길이는 바뀌지 않는다.
 * 늦출 길이 L은 그 자리 템포에서 profile.fastRunDrop.gapMs 이상이 되는 가장 짧은 박 격자 길이다
 * (delayLengths: t116이면 1/64, t200이면 1/32).
 */

export interface FastRunFixOptions extends Pick<ValidateSongOptions, "canonicalOf"> {
  /** 잠근 트랙. 그 트랙 착지 음은 늦추지 않는다 */
  readonly locked?: ReadonlySet<string>;
  /** 주면 이 착지 음(note id)이 든 순간만 고친다. 없으면 모든 순간 */
  readonly only?: ReadonlySet<string>;
  /**
   * true면 늦출 음만 정하고 글자 수·남는 자리는 세지 않는다 (순간마다 미리 보기를 여럿 만들 때. 최적화 출력은 트랙마다 수십 ms,
   * 다시 찾기는 곡 전체를 훑는다)
   */
  readonly quick?: boolean;
  /** 같은 곡에서 이미 찾은 순간 (fastRunMoments 결과). 주면 다시 찾지 않는다 */
  readonly found?: readonly FastRunMoment[];
}

/** 늦추지 못한 착지 음 수 (까닭마다) */
export interface FastRunSkipped {
  /** 잠근 트랙 */
  readonly locked: number;
  /** 늦추면 착지 음(사슬 첫 음) 길이가 0 이하가 됨 */
  readonly short: number;
  /** 남은 길이나 앞 쉼표 길이를 게임 길이로 정확히 쓸 수 없음 */
  readonly unwritable: number;
  /** 그 자리 템포에서 gapMs 이상이 되는 게임 길이가 없음 */
  readonly noLength: number;
}

/** 늦춘 착지 음 하나 */
export interface FastRunDelay {
  readonly trackId: string;
  readonly noteId: string;
  /** 늦춘 길이 (온음표 단위) */
  readonly by: Rat;
  /** 늦춘 시간 (ms, 그 자리 템포로 센 값) */
  readonly ms: number;
}

export interface FastRunFixResult {
  /** 고칠 순간 (only로 고른 것) */
  readonly moments: readonly FastRunMoment[];
  /** 바뀐 트랙과 그 트랙 음 전체. 바뀐 것이 없으면 빈 목록 (setTracksNotes에 그대로 넘겨 실행 취소 한 칸) */
  readonly changes: readonly { readonly trackId: string; readonly notes: readonly Note[] }[];
  /** 늦춘 착지 음 */
  readonly delays: readonly FastRunDelay[];
  readonly skipped: FastRunSkipped;
  /**
   * 글자 수: 바뀐 트랙 글을 고치기 전후로 최적화 출력해 잰 차이(모두 더한 것)와, 고친 뒤 한도를 넘는 트랙이 있는지.
   * 꾸밈음·트릴 창과 같은 기준이다. quick이면 없다
   */
  readonly chars?: { readonly delta: number; readonly over: boolean };
  /** 고친 곡에 남는 연주 누락음 위험 순간 수 (고르지 않은 순간·고치지 못한 순간 포함). quick이면 없다 */
  readonly left?: number;
}

/**
 * 늦출 길이 후보 두 줄: 게임에서 쓸 수 있는 길이(profile.length, 점 profile.length.dots개까지) 가운데
 * 2의 거듭제곱 칸 길이(64·64.·32·32.…: 커뮤니티의 "64.로 밀기"와 같은 칸)와 셋잇단 칸 길이(48·24·12…). 줄마다 짧은 순.
 * 1/37처럼 다른 홀수 칸 길이는 남은 길이를 쓸 수 없어 쓰지 않는다
 */
export function delayLengths(profile: GameProfile): { readonly binary: readonly Rat[]; readonly triplet: readonly Rat[] } {
  const binary: Rat[] = [];
  const triplet: Rat[] = [];
  for (let n = profile.length.min; n <= profile.length.max; n++) {
    let m = n;
    while (m % 2 === 0) m /= 2;
    if (m === 1) for (let dots = 0; dots <= profile.length.dots; dots++) binary.push(fromLength(n, dots));
    // 점 붙은 셋잇단 길이는 2의 거듭제곱 칸 길이와 같다 (48. = 32)
    else if (m === 3) triplet.push(fromLength(n));
  }
  return { binary: binary.sort(cmp), triplet: triplet.sort(cmp) };
}

/**
 * at 자리에서 gapMs 이상 늦추는 길이 후보 (그 자리 템포로 잰다): 2의 거듭제곱 칸에서 가장 짧은 것, 다음에 셋잇단 칸에서 가장 짧은 것.
 * 앞 것으로 남은 길이를 쓸 수 없을 때(셋잇단 길이 음 등)만 뒤 것을 쓴다
 */
export function delayChoices(profile: GameProfile, secondsAt: (pos: Rat) => number, at: Rat): Rat[] {
  const rule = profile.fastRunDrop;
  if (!rule) return [];
  const from = secondsAt(at);
  // 같은 값이 소수 끝자리에서 갈리지 않게 검사와 같은 여유로 잰다
  const enough = (l: Rat) => fastRunGapEnough(secondsAt(add(at, l)) - from, rule.gapMs);
  const { binary, triplet } = delayLengths(profile);
  return [binary.find(enough), triplet.find(enough)].filter((l): l is Rat => l !== undefined);
}

/** at 자리에서 먼저 쓰는 늦출 길이 (2의 거듭제곱 칸에서 gapMs 이상인 가장 짧은 것). 없으면 undefined */
export function delayFor(profile: GameProfile, secondsAt: (pos: Rat) => number, at: Rat): Rat | undefined {
  return delayChoices(profile, secondsAt, at)[0];
}

/** 트랙 음의 최적화 출력 글자 수 (고치기 전 글은 미리 보기마다 같으므로 음 목록마다 한 번만 센다) */
const printedLength = new WeakMap<readonly Note[], { readonly lengths: GameProfile["length"]; readonly n: number }>();
function optimizedLength(notes: readonly Note[], profile: GameProfile): number {
  const hit = printedLength.get(notes);
  if (hit && hit.lengths === profile.length) return hit.n;
  const n = optimizeMml(notes, { lengths: profile.length }).text.length;
  printedLength.set(notes, { lengths: profile.length, n });
  return n;
}

/** 연주 누락음 위험 순간의 착지 음을 늦추는 계획 (곡은 바꾸지 않는다) */
export function planFastRunFix(song: Song, profile: GameProfile, options: FastRunFixOptions = {}): FastRunFixResult {
  const skipped = { locked: 0, short: 0, unwritable: 0, noLength: 0 };
  const all = options.found ?? fastRunMoments(song, profile, options);
  const only = options.only;
  const moments = only ? all.filter((m) => m.landings.some((l) => only.has(l.noteId))) : all;
  const secondsAt = tempoClock(song.tempo);
  const canWrite = (r: Rat) => canWriteExactly(r, profile.length);
  const edits = new Map<string, Note[]>();
  const delays: FastRunDelay[] = [];
  for (const m of moments) {
    for (const landing of m.landings) {
      if (options.locked?.has(landing.trackId)) {
        skipped.locked++;
        continue;
      }
      const track = song.tracks.find((t) => t.id === landing.trackId);
      if (!track) continue;
      const notes = edits.get(track.id) ?? [...track.notes].sort((a, b) => cmp(a.start, b.start));
      const k = notes.findIndex((n) => n.id === landing.noteId);
      const note = notes[k];
      if (!note) continue;
      const choices = delayChoices(profile, secondsAt, note.start);
      if (choices.length === 0) {
        skipped.noLength++;
        continue;
      }
      // 앞 음 끝 (앞 음이 없으면 곡 처음). 새 시작까지가 쉼표가 된다
      const prev = notes[k - 1];
      const prevEnd = prev ? add(prev.start, prev.dur) : ZERO;
      let fit: { by: Rat; start: Rat; dur: Rat } | undefined;
      let positive = false;
      for (const by of choices) {
        const dur = sub(note.dur, by);
        if (dur.n <= 0) continue;
        positive = true;
        const start = add(note.start, by);
        if (canWrite(dur) && canWrite(sub(start, prevEnd))) {
          fit = { by, start, dur };
          break;
        }
      }
      if (!fit) {
        if (positive) skipped.unwritable++;
        else skipped.short++;
        continue;
      }
      const { by, start, dur } = fit;
      const next = [...notes];
      next[k] = { ...note, start, dur };
      // 다른 높이로 이어 다시 치던 &(벤드 한도 밖)가 앞 음에서 걸려 있으면, 틈이 생기므로 끊는다
      if (prev && prev.tie === "next" && eq(add(prev.start, prev.dur), note.start)) next[k - 1] = { ...prev, tie: "none" };
      edits.set(track.id, next);
      delays.push({ trackId: track.id, noteId: note.id, by, ms: Math.round((secondsAt(start) - secondsAt(note.start)) * 1000) });
    }
  }
  const changes = song.tracks.flatMap((t) => {
    const notes = edits.get(t.id);
    return notes ? [{ trackId: t.id, notes }] : [];
  });
  if (options.quick) return { moments, changes, delays, skipped };
  let delta = 0;
  let over = false;
  for (const c of changes) {
    const before = song.tracks.find((t) => t.id === c.trackId)!;
    const after = optimizeMml(c.notes, { lengths: profile.length }).text.length;
    delta += after - optimizedLength(before.notes, profile);
    if (after > profile.charLimitPerScore) over = true;
  }
  const fixed = changes.length === 0 ? song : { ...song, tracks: song.tracks.map((t) => (edits.has(t.id) ? { ...t, notes: edits.get(t.id)! } : t)) };
  const left = changes.length === 0 ? all.length : fastRunMoments(fixed, profile, options).length;
  return { moments, changes, delays, skipped, chars: { delta, over }, left };
}
