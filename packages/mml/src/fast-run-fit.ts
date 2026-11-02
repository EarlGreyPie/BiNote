import { maxChordsOf, type Command, type GameProfile, type Note, type Song } from "@mmlce/core";
import { distributeChords } from "./distribute.js";
import { restoreSong, setTracksNotes, settleDistributed } from "./edit.js";
import { planFastRunFix, type FastRunFixOptions, type FastRunFixResult } from "./fast-run.js";
import { gameCharCounts } from "./game-output.js";
import { optimizeMml } from "./optimizer.js";
import { splitSong } from "./split.js";
import { fastRunMoments, type FastRunMoment } from "./validate.js";

/**
 * 실험실 "연주 누락음 고치기"를 글자 수 한도 안에서만 적용하는 계획.
 * 늦춘 음 앞에 쉼표가 생기고 남은 길이를 이어 써야 해서 한 자리에 10자 안팎이 는다. 그래서 고친 뒤 글자 수를
 * 내보내기 글자 수(gameCharCounts, 화면 한도 표시와 같은 수)로 다시 재고, 넘으면 다음 차례로 줄인다.
 *
 * - 한 권 곡(모든 트랙이 한도 안): 모두 고쳐도 한도 안이면 그대로. 넘으면 같은 소리 묶음 트랙으로 화음 분산을 함께 해 보고
 *   (distribute가 false가 아니면), 그래도 넘거나 분산을 쓸 수 없으면 넘치는 트랙의 자리를 빼서 한도 안에 드는 만큼만 고친다.
 * - 이미 악보책으로 나뉘는 곡: 기준은 "권 수가 늘지 않음". 악보책 나누기는 느리므로(곡마다 수 초) 가장 긴 트랙 길이로
 *   어림해 고를 자리를 정하고 나누기로 확인한다 (어림 두 단계, 나누기 최대 세 번). 화음 분산은 하지 않는다 (권 수 줄이기는 따로 있다).
 * - 빼는 차례: 넘치는 트랙에 든 자리 가운데 늦출 음이 적은 자리, 같으면 글자가 많이 드는 자리부터 (같은 글자로 더 많은 음을 살린다).
 *   넘치지 않는 트랙만 건드리는 자리는 모두 고친다.
 */

export interface FastRunFitOptions extends Omit<FastRunFixOptions, "quick" | "only"> {
  /** false면 한도를 보지 않고 모두 고친다 (글자 수만 센다). 기본 true */
  readonly limit?: boolean;
  /** false면 화음 분산을 쓰지 않는다 (트랙 글을 다시 쓰고 싶지 않을 때). 기본 true */
  readonly distribute?: boolean;
  /** 악보마다 트랙 수 (연주자 id → 수). 생략하면 연주자 악기의 화음 한도 */
  readonly maxChords?: number | ((playerId: string) => number);
}

export interface FastRunFitResult {
  /** 계획한 곡 (적용할 때 같은 곡이면 song을 그대로 쓴다) */
  readonly before: Song;
  /** 고친 곡 (고칠 것이 없으면 before 그대로) */
  readonly song: Song;
  /** 고친 자리들의 계획 (늦춘 음·건너뛴 까닭). 글자 수는 chars를 본다 */
  readonly plan: FastRunFixResult;
  /** 고친 자리 */
  readonly fixed: readonly FastRunMoment[];
  /** 글자 수 한도(또는 권 수) 때문에 고치지 않은 자리 */
  readonly overLimit: readonly FastRunMoment[];
  /** 화음 분산으로 옮긴 음 수 (0이면 분산하지 않음) */
  readonly moved: number;
  /** 화음 분산을 해 보았지만 쓸 수 없었던 까닭 (notes·tempo: 다시 쓰면 원문 끝 길이를 잃음, sound: 게임 소리가 달라짐) */
  readonly distributeKept?: "notes" | "tempo" | "sound";
  /** 권 수 (악보책으로 나뉘는 곡만. 한 권 곡은 없다) */
  readonly books?: { readonly from: number; readonly to: number };
  /** 내보내기 글자 수: 모든 트랙 합의 차이, 고친 뒤 가장 긴 트랙 */
  readonly chars: { readonly delta: number; readonly longest: number };
  /** 모두 고쳤을 때 한도를 넘는 트랙 수 (한 권 곡에서 일부만 고쳤을 때. 그 밖에는 0) */
  readonly fullOver: number;
}

/** 어림에 쓰는 몫: 권마다 다시 적는 머리(템포·옥타브·길이)와 끝 쉼표 몫 (books.ts의 fewerBooks와 같은 몫 가운데 가장 작은 것) */
const BOOK_SHARE = 0.88;
/** 넘치는 트랙에서 자리를 빼고 다시 재는 최대 횟수 */
const MAX_ROUNDS = 8;

const sum = (m: ReadonlyMap<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
const longestOf = (m: ReadonlyMap<string, number>) => Math.max(0, ...m.values());

/** 트랙 음의 최적화 출력 글자 수 (자리마다 드는 글자 어림용. 음 목록마다 한 번만 센다) */
const printed = new WeakMap<readonly Note[], number>();
function optimizedLength(notes: readonly Note[], profile: GameProfile): number {
  const hit = printed.get(notes);
  if (hit !== undefined) return hit;
  const n = optimizeMml(notes, { lengths: profile.length }).text.length;
  printed.set(notes, n);
  return n;
}

export function fitFastRunFix(song: Song, profile: GameProfile, options: FastRunFitOptions = {}): FastRunFitResult {
  const limit = profile.charLimitPerScore;
  const maxChords = options.maxChords ?? ((id: string) => maxChordsOf(profile, song.players.find((p) => p.id === id)?.instrument.canonical));
  const counts = (s: Song) => gameCharCounts(s, maxChords, profile.maxChordsPerPlayer, limit);
  const books = (s: Song) => splitSong(s, profile, { maxChords }).parts.length;
  const all = options.found ?? fastRunMoments(song, profile, options);
  const base: FastRunFixOptions = {
    ...(options.canonicalOf ? { canonicalOf: options.canonicalOf } : {}),
    ...(options.locked ? { locked: options.locked } : {}),
    found: all,
    quick: true,
  };
  const planOf = (ms: readonly FastRunMoment[]) =>
    planFastRunFix(song, profile, { ...base, only: new Set(ms.flatMap((m) => m.landings.map((l) => l.noteId))) });
  const applied = (p: FastRunFixResult) => (p.changes.length === 0 ? song : setTracksNotes(p.changes).apply(song));

  const count0 = counts(song);
  const total0 = sum(count0);
  const longest0 = longestOf(count0);
  const result = (s: Song, plan: FastRunFixResult, fixed: readonly FastRunMoment[], c: ReadonlyMap<string, number>, extra: Partial<FastRunFitResult> = {}): FastRunFitResult => ({
    before: song,
    song: s,
    plan,
    fixed,
    overLimit: all.filter((m) => !fixed.includes(m)),
    moved: 0,
    fullOver: 0,
    chars: { delta: sum(c) - total0, longest: longestOf(c) },
    ...extra,
  });

  const fullPlan = planOf(all);
  if (all.length === 0 || fullPlan.changes.length === 0) return result(song, fullPlan, all, count0);
  const full = applied(fullPlan);
  const fullCounts = counts(full);
  const overIn = (c: ReadonlyMap<string, number>, budget: (id: string) => number) => [...c].filter(([id, n]) => n > budget(id)).map(([id]) => id);
  if (options.limit === false) return result(full, fullPlan, all, fullCounts);

  // 자리마다 드는 글자 어림 (트랙마다). 그 자리만 고친 계획의 최적화 출력 차이로 잰다 (넘치는 트랙에 든 자리만, 필요할 때 센다)
  const costs = new Map<FastRunMoment, { readonly byTrack: ReadonlyMap<string, number>; readonly notes: number }>();
  const costOf = (m: FastRunMoment) => {
    let hit = costs.get(m);
    if (!hit) {
      const p = planOf([m]);
      const byTrack = new Map<string, number>();
      for (const c of p.changes) {
        const before = song.tracks.find((t) => t.id === c.trackId)!;
        byTrack.set(c.trackId, optimizedLength(c.notes, profile) - optimizedLength(before.notes, profile));
      }
      hit = { byTrack, notes: p.delays.length };
      costs.set(m, hit);
    }
    return hit;
  };

  /** 트랙마다 한도(budget) 안에 드는 만큼만 고른다. 고른 자리와 그 곡·글자 수 */
  const within = (budget: (id: string) => number) => {
    let chosen = [...all];
    let plan = fullPlan;
    let s = full;
    let c = fullCounts;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const over = overIn(c, budget);
      if (over.length === 0) return { chosen, plan, song: s, counts: c };
      const drop = new Set<FastRunMoment>();
      for (const id of over) {
        let excess = c.get(id)! - budget(id);
        const touching = chosen
          .filter((m) => m.landings.some((l) => l.trackId === id))
          .sort((a, b) => costOf(a).notes - costOf(b).notes || (costOf(b).byTrack.get(id) ?? 0) - (costOf(a).byTrack.get(id) ?? 0));
        // 어림이 모자라 다시 돌 때도 줄어들게, 한 번에 적어도 하나는 뺀다
        for (const m of touching) {
          if (excess <= 0 && drop.size > 0) break;
          drop.add(m);
          excess -= Math.max(1, costOf(m).byTrack.get(id) ?? 0);
        }
      }
      if (drop.size === 0) break;
      chosen = chosen.filter((m) => !drop.has(m));
      plan = planOf(chosen);
      s = applied(plan);
      c = counts(s);
    }
    // 그래도 넘치면 넘치는 트랙에 든 자리를 모두 뺀다
    const over = new Set(overIn(c, budget));
    if (over.size > 0) {
      chosen = chosen.filter((m) => !m.landings.some((l) => over.has(l.trackId)));
      plan = planOf(chosen);
      s = applied(plan);
      c = counts(s);
    }
    return { chosen, plan, song: s, counts: c };
  };

  if (longest0 <= limit) {
    // 한 권 곡
    const fullOver = overIn(fullCounts, () => limit).length;
    if (fullOver === 0) return result(full, fullPlan, all, fullCounts);
    let distributeKept: FastRunFitResult["distributeKept"];
    if (options.distribute !== false) {
      const spread = distributeChords(full, profile, options.locked ? { locked: options.locked } : {});
      if (spread.moved > 0) {
        const settled = settleDistributed(full, spread.song, profile, options.locked);
        if (settled.kept) distributeKept = settled.kept;
        else {
          // 잠근 트랙은 분산이 음 순서만 다시 맞춘 같은 내용이다. 원래 트랙을 그대로 둔다 (잠근 트랙이 바뀌지 않았음을 참조로 알 수 있게)
          const locked = options.locked;
          const moved = locked ? { ...settled.song, tracks: settled.song.tracks.map((t) => (locked.has(t.id) ? (full.tracks.find((f) => f.id === t.id) ?? t) : t)) } : settled.song;
          const c = counts(moved);
          if (overIn(c, () => limit).length === 0) return result(moved, fullPlan, all, c, { moved: spread.moved });
        }
      }
    }
    const part = within(() => limit);
    return result(part.song, part.plan, part.chosen, part.counts, { fullOver, ...(distributeKept ? { distributeKept } : {}) });
  }

  // 악보책으로 나뉘는 곡: 권 수가 늘지 않는 만큼
  const from = books(song);
  const fullBooks = books(full);
  if (fullBooks <= from) return result(full, fullPlan, all, fullCounts, { books: { from, to: fullBooks } });
  const tiers = [...new Set([Math.max(longest0, Math.floor(from * limit * BOOK_SHARE)), longest0])];
  for (const tier of tiers) {
    const part = within((id) => Math.max(tier, count0.get(id) ?? 0));
    if (part.chosen.length === 0) break;
    const to = books(part.song);
    if (to <= from) return result(part.song, part.plan, part.chosen, part.counts, { books: { from, to } });
  }
  return result(song, planOf([]), [], count0, { books: { from, to: from } });
}

/**
 * 한도 안에서 고치기 명령 (실행 취소 한 칸). 계획한 곡 그대로면 계획 결과를 쓰고, 그 사이 곡이 바뀌었으면 같은 기준으로 다시 계획한다
 */
export function fitFastRunCommand(fit: FastRunFitResult, replan: (song: Song) => FastRunFitResult, label = "연주 누락음 고치기"): Command {
  return {
    label,
    apply: (song) => (song === fit.before ? fit.song : replan(song).song),
    invert: (before) => restoreSong(before),
  };
}
