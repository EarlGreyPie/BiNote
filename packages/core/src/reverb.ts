import { add, cmp, mul, rat, sub, type Rat } from "./rat.js";
import type { Note, Song } from "./model.js";
import type { GameProfile } from "./profile.js";
import { chainVolumes } from "./note-edit.js";

/**
 * 실험실 울림 (게임에는 이펙트가 없어 음표로 흉내 낸다). 결과는 늘 보통 MML이라 게임과 다른 앱이 그대로 읽는다.
 * - 꼬리 쪼개기(리버브): 긴 음의 뒷부분을 같은 높이의 작은 음으로 쪼개 다시 치고, v를 점점 줄인다 (예: v15 뒤 v6·v3·v2·v1).
 *   조각은 &로 잇지 않는다: 게임은 & 뒤의 v를 무시한다
 * - 빈칸 채우기: 스타카토 음 뒤 쉼표 자리에 같은 높이를 작게 한 번 더 친다 (예: v15 뒤 v4)
 * v 단계는 "가장 큰 v(보통 v15)로 친 음" 기준으로 적고, 실제로는 원래 음 v에 비례해 줄인다 (v9 음이면 6·3·2·1 → 4·2·1·1).
 * 찍기(한 음, 누른 자리부터)와 조건부 일괄(고른 음·트랙에서 조건에 맞는 음만)이 같은 계산을 쓴다. 결과만 계산하고 곡은 바꾸지 않는다
 */

/** 꼬리 조각 v 순서의 기본 (가장 큰 v로 친 음 기준) */
export const REVERB_DEFAULT_LEVELS: readonly number[] = [6, 3, 2, 1];
/** 꼬리 조각을 몇 개까지 */
export const REVERB_LEVELS_MAX = 8;

export interface ReverbTail {
  /** 꼬리 조각 v 순서 (가장 큰 v로 친 음 기준). 조각 수 = 길이 */
  readonly levels: readonly number[];
  /** 조각 하나 길이 (온음표 단위). 마지막 조각은 음 끝까지 남은 길이를 다 가진다 */
  readonly piece: Rat;
}

export interface ReverbBatch extends ReverbTail {
  /** 꼬리를 넣을 음: 이 길이 이상 */
  readonly minLength: Rat;
  /** 앞부분(처음 친 소리)을 이만큼은 그대로 둔다 */
  readonly keep: Rat;
  /** 뒤에 쉼표가 있거나 트랙 끝인 음에만 (프레이즈 끝) */
  readonly beforeRest: boolean;
  /** 스타카토 빈칸 채우기: 켜면 이 v(가장 큰 v 기준)로, 끄면 undefined */
  readonly fillLevel?: number;
  /** 빈칸 채우기: 이 길이 이하인 음 뒤의 쉼표만 */
  readonly fillMaxNote: Rat;
}

export interface ReverbSkipped {
  /** 뒤 음과 &로 이어져 꼬리를 낼 수 없음 */
  readonly tied: number;
  readonly locked: number;
  /** 너무 짧거나(조건에 안 맞음) 꼬리 자리가 없음 */
  readonly short: number;
  /** v0(소리 없는) 음이라 울림을 낼 것이 없음 */
  readonly silent: number;
  /** 조각 길이를 게임 길이로 쓸 수 없음 */
  readonly unwritable: number;
}

export interface ReverbResult {
  readonly changes: readonly { readonly trackId: string; readonly notes: readonly Note[] }[];
  /** 꼬리를 낸 음 수 */
  readonly tails: number;
  /** 빈칸을 채운 음 수 */
  readonly fills: number;
  /** 새로 생긴 음 수 */
  readonly added: number;
  /** 바뀌거나 새로 생긴 음 id (적용 뒤 고른 음으로 쓴다) */
  readonly ids: readonly string[];
  readonly skipped: ReverbSkipped;
}

export interface ReverbContext {
  readonly locked?: ReadonlySet<string>;
  /** 이 길이를 게임 길이로 정확히 쓸 수 있는지 (출력기와 같은 판정) */
  readonly canWrite: (dur: Rat) => boolean;
  readonly newId: () => string;
}

const end = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);

/** 가장 큰 v 기준 단계를 이 음의 v에 맞춘다. 소리가 나게 1 이상, 원래 v는 넘지 않는다 (v0 음은 v0 그대로: 무음에 소리를 만들지 않는다) */
export function reverbLevel(level: number, base: number, profile: GameProfile): number {
  if (base <= 0) return Math.max(0, profile.volume.min);
  const scaled = Math.round((level * base) / profile.volume.max);
  return Math.max(Math.max(1, profile.volume.min), Math.min(base, profile.volume.max, scaled));
}

type Split = { ok: true; notes: Note[] } | { ok: false; why: "short" | "unwritable" };

/** 음을 from에서부터 꼬리 조각으로 쪼갠다. 조각 수는 levels 길이까지 */
function splitTail(n: Note, base: number, from: Rat, tail: ReverbTail, profile: GameProfile, ctx: ReverbContext): Split {
  const stop = end(n);
  if (cmp(from, n.start) <= 0 || cmp(from, stop) >= 0 || tail.levels.length === 0) return { ok: false, why: "short" };
  const head = sub(from, n.start);
  if (!ctx.canWrite(head)) return { ok: false, why: "unwritable" };
  // 조각 길이로 채우고, 남는 자리는 v 단계가 남았으면 짧은 조각 하나 더, 다 썼으면 마지막 조각이 가진다
  const lens: Rat[] = [];
  let at = from;
  while (lens.length < tail.levels.length && cmp(add(at, tail.piece), stop) <= 0) {
    lens.push(tail.piece);
    at = add(at, tail.piece);
  }
  const left = sub(stop, at);
  if (left.n > 0) {
    if (lens.length < tail.levels.length) lens.push(left);
    else lens[lens.length - 1] = add(tail.piece, left);
  }
  if (!lens.every((l) => ctx.canWrite(l))) return { ok: false, why: "unwritable" };
  const notes: Note[] = [{ ...n, dur: head, tie: "none" }];
  at = from;
  lens.forEach((dur, i) => {
    const { lab: _lab, ...plain } = n;
    notes.push({ ...plain, id: ctx.newId(), start: at, dur, tie: "none", vol: reverbLevel(tail.levels[i]!, base, profile) });
    at = add(at, dur);
  });
  return { ok: true, notes };
}

/** 일괄 넣기에서 꼬리가 시작하는 자리: 끝에서 조각 수만큼, 앞부분은 keep 이상 남긴다. 자리가 없으면 undefined */
function autoFrom(n: Note, keep: Rat, tail: ReverbTail): Rat | undefined {
  const stop = end(n);
  let count = 0;
  while (count < tail.levels.length && cmp(sub(stop, mul(tail.piece, rat(count + 1))), add(n.start, keep)) >= 0) count++;
  return count === 0 ? undefined : sub(stop, mul(tail.piece, rat(count)));
}

function sortedTrack(song: Song, trackId: string): Note[] {
  return [...(song.tracks.find((t) => t.id === trackId)?.notes ?? [])].sort((a, b) => cmp(a.start, b.start));
}

function result(song: Song, replaced: ReadonlyMap<string, Map<string, Note[]>>, counts: { tails: number; fills: number; added: number }, ids: string[], skipped: ReverbSkipped): ReverbResult {
  const changes = song.tracks
    .filter((t) => replaced.has(t.id))
    .map((t) => {
      const m = replaced.get(t.id)!;
      const notes = t.notes.flatMap((n) => m.get(n.id) ?? [n]);
      return { trackId: t.id, notes: notes.sort((a, b) => cmp(a.start, b.start)) };
    });
  return { changes, ...counts, ids, skipped };
}

/**
 * 울림 찍기: 한 음을 at 자리부터 꼬리로 쪼갠다 (피아노롤에서 누른 자리, 타브에서는 커서 자리).
 * at이 음 시작이거나 그 앞이면 일괄 넣기처럼 끝에서부터 놓는다 (앞부분은 keep 이상)
 */
export function planReverbStamp(song: Song, trackId: string, noteId: string, at: Rat, tail: ReverbTail & { readonly keep: Rat }, profile: GameProfile, ctx: ReverbContext): ReverbResult {
  const skipped = { tied: 0, locked: 0, short: 0, silent: 0, unwritable: 0 };
  const none = (): ReverbResult => result(song, new Map(), { tails: 0, fills: 0, added: 0 }, [], skipped);
  if (ctx.locked?.has(trackId)) {
    skipped.locked++;
    return none();
  }
  const sorted = sortedTrack(song, trackId);
  const n = sorted.find((x) => x.id === noteId);
  if (!n) return none();
  // & 사슬 뒤 조각은 게임에서 사슬 첫 음 v로 난다 (뒤에 적은 v는 무시): 그 v로 판단하고 줄인다
  const base = chainVolumes(sorted).get(n.id) ?? n.vol;
  if (base <= 0) {
    skipped.silent++;
    return none();
  }
  if (n.tie === "next") {
    skipped.tied++;
    return none();
  }
  const from = cmp(at, n.start) <= 0 ? autoFrom(n, tail.keep, tail) : at;
  const split = from ? splitTail(n, base, from, tail, profile, ctx) : ({ ok: false, why: "short" } as const);
  if (!split.ok) {
    skipped[split.why]++;
    return none();
  }
  const ids = split.notes.map((x) => x.id);
  return result(song, new Map([[trackId, new Map([[n.id, split.notes]])]]), { tails: 1, fills: 0, added: split.notes.length - 1 }, ids, skipped);
}

/**
 * 울림 일괄 넣기: 고른 음 가운데 조건에 맞는 음에 꼬리를 넣고, 켜면 스타카토 음 뒤 빈칸을 채운다.
 * 원래 음은 지우지 않고 길이만 줄인다. 다른 음과 겹치지 않는다 (빈칸 채우기는 다음 음 시작까지만)
 */
export function planReverbBatch(song: Song, picked: readonly Note[], options: ReverbBatch, profile: GameProfile, ctx: ReverbContext): ReverbResult {
  const skipped = { tied: 0, locked: 0, short: 0, silent: 0, unwritable: 0 };
  const ids = new Set(picked.map((n) => n.id));
  const replaced = new Map<string, Map<string, Note[]>>();
  const counts = { tails: 0, fills: 0, added: 0 };
  const changedIds: string[] = [];
  for (const tr of song.tracks) {
    const sorted = sortedTrack(song, tr.id);
    const vols = chainVolumes(sorted);
    sorted.forEach((n, i) => {
      const base = vols.get(n.id) ?? n.vol;
      if (!ids.has(n.id)) return;
      if (ctx.locked?.has(tr.id)) {
        skipped.locked++;
        return;
      }
      const next = sorted[i + 1];
      const gap = next ? sub(next.start, end(n)) : undefined;
      const restAfter = !next || cmp(gap!, rat(0)) > 0;
      const put = (notes: Note[]) => {
        const m = replaced.get(tr.id) ?? new Map<string, Note[]>();
        replaced.set(tr.id, m);
        m.set(n.id, notes);
        changedIds.push(...notes.map((x) => x.id));
        counts.added += notes.length - 1;
      };
      if (n.tie === "next") {
        skipped.tied++;
        return;
      }
      if (base <= 0) {
        skipped.silent++;
        return;
      }
      if (cmp(n.dur, options.minLength) >= 0 && (!options.beforeRest || restAfter)) {
        const from = autoFrom(n, options.keep, options);
        const split = from ? splitTail(n, base, from, options, profile, ctx) : ({ ok: false, why: "short" } as const);
        if (split.ok) {
          put(split.notes);
          counts.tails++;
        } else skipped[split.why]++;
        return;
      }
      // 스타카토 빈칸: 짧은 음 뒤 쉼표 자리에 같은 높이를 작게 (음 길이만큼, 다음 음 시작까지만). 트랙 끝 쉼표는 두지 않는다
      if (options.fillLevel !== undefined && next && gap && gap.n > 0 && cmp(n.dur, options.fillMaxNote) <= 0) {
        const dur = cmp(gap, n.dur) < 0 ? gap : n.dur;
        if (!ctx.canWrite(dur)) {
          skipped.unwritable++;
          return;
        }
        const { lab: _lab, ...plain } = n;
        put([n, { ...plain, id: ctx.newId(), start: end(n), dur, tie: "none", vol: reverbLevel(options.fillLevel, base, profile) }]);
        counts.fills++;
        return;
      }
      skipped.short++;
    });
  }
  return result(song, replaced, counts, changedIds, skipped);
}
