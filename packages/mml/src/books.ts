import { add, cmp, eq, type GameProfile, type Note, type Song } from "@mmlce/core";
import { distributeChords } from "./distribute.js";
import { settleDistributed } from "./edit.js";
import { splitSong, type SplitResult } from "./split.js";

/**
 * 악보책 권 수 줄이기. 권 수는 가장 긴 채널이 정하므로, 같은 악기 트랙끼리 음을 옮겨
 * 채널 길이를 고르게 하면 권이 줄 수 있다. 한 권 적게 나눌 수 있는 채널 길이를 몇 가지 시도해,
 * 실제로 나눠 봐서 줄어들면 그 길이를 알려 준다 (적용은 distributeSong(profile, label, limit)).
 */
export interface FewerBooks {
  /** 지금 권 수 */
  readonly from: number;
  /** 음을 옮긴 뒤 권 수 */
  readonly to: number;
  /** distributeChords에 줄 채널 글자 수 */
  readonly limit: number;
  /** 옮기는 음 수 */
  readonly moved: number;
}

/** 권마다 다시 적는 머리(템포·옥타브·길이)와 끝 쉼표 몫을 어림해 한도에서 뺀다 */
const SHARES = [0.95, 0.88, 0.8];

export function fewerBooks(song: Song, profile: GameProfile, books: number, locked?: ReadonlySet<string>): FewerBooks | undefined {
  if (books < 2) return undefined;
  const target = books - 1;
  for (const share of SHARES) {
    const limit = Math.floor(profile.charLimitPerScore * target * share);
    const spread = distributeChords(song, profile, { limit, ...(locked ? { locked } : {}) });
    if (spread.moved === 0) continue;
    // 글자 수 줄이기가 곡을 그대로 두면(kept) 옮긴 곡은 원문이 지워져 끝 길이를 잃으므로 이 옮기기는 버린다.
    // 게임 소리가 달라져도 버린다 (적용하는 distributeSong과 같은 확인)
    const compacted = settleDistributed(song, spread.song, profile, locked);
    if (compacted.kept) continue;
    const next = compacted.song;
    const parts = splitSong(next, profile).parts.length;
    if (parts <= target) return { from: books, to: parts, limit, moved: spread.moved };
  }
  return undefined;
}

/** 악보책 나누기 단계: 화음 고르게 나누기 → 악보책 나누기 → 꼼꼼히 찾기 */
export type BookStage = "spread" | "split" | "thorough";

export interface BookProgress {
  readonly stage: BookStage;
  /** 그 단계 안에서 어디까지 왔는지 (0~1) */
  readonly fraction: number;
}

export interface PlanOptions {
  /** 나누기 전에 같은 악기 트랙끼리 음을 옮겨 채널 길이를 고르게 한다 (기본 켬) */
  readonly spread?: boolean;
  /** 꼼꼼히 나누기: 큰 곡도 권이 줄어드는 자리를 더 찾아본다 (오래 걸린다) */
  readonly thorough?: boolean;
  /** 잠근 트랙 id: 화음 분산에서 음을 빼지도 넣지도 않는다 */
  readonly locked?: ReadonlySet<string>;
  readonly onProgress?: (progress: BookProgress) => void;
}

/** 음을 옮겨 권을 줄인 내용. from이 없으면 옮기기 전 권 수는 세지 않았다 (옮겨서 한 권에 들어간 경우) */
export interface BookSpread {
  readonly from?: number;
  readonly to: number;
  /** distributeChords에 준 채널 글자 수 (곡에도 적용할 때 같은 값으로) */
  readonly limit: number;
  readonly moved: number;
}

export interface BookPlan {
  /** 실제로 나눈 곡: 음을 옮겼으면 옮긴 곡, 아니면 받은 곡 그대로 */
  readonly song: Song;
  readonly result: SplitResult;
  readonly spread?: BookSpread;
}

/**
 * 악보책 나누기 전체 순서. 권 수는 가장 긴 채널이 정하므로 먼저 화음을 고르게 나눠 보고(spread),
 * 그래서 모든 채널이 한도 안이면 나누지 않는다. 아니면 나누고, 음을 옮겨 권이 줄면 옮긴 곡을 쓴다.
 * 받은 곡은 바꾸지 않는다 (옮긴 곡은 결과에만 쓴다. 편집 중인 곡에 적용할지는 사용자가 고른다).
 * thorough면 마지막에 고른 곡을 꼼꼼히 다시 나눈다 (화음 나누기 시도는 빠른 나누기로 센다)
 */
export function planBooks(song: Song, profile: GameProfile, options: PlanOptions = {}): BookPlan {
  const spread = options.spread ?? true;
  const report = (stage: BookStage) => (fraction: number) => options.onProgress?.({ stage, fraction });
  const limit = profile.charLimitPerScore;
  const locked = options.locked;
  const room = spread ? roomFor(song, locked) : undefined;
  const distribute = (channel?: number) => distributeChords(song, profile, { ...(channel === undefined ? {} : { limit: channel }), ...(locked ? { locked } : {}) });
  // 음을 옮긴 곡을 글자 수 줄이기로 다시 쓰고 게임 소리를 확인한다 (화음 분산 명령과 같게, settleDistributed).
  // 그대로 두면(kept) undefined: 옮긴 곡은 원문이 지워져 끝 길이를 잃거나 소리가 달라지므로 그 옮기기는 버린다
  const compact = {
    apply: (moved: Song): Song | undefined => {
      const r = settleDistributed(song, moved, profile, locked);
      return r.kept ? undefined : r.song;
    },
  };

  // 1) 음을 옮겨 한 권에 들어가면 나누지 않는다. 옮긴 뒤 모든 채널이 한도 안인지는 실제로 옮겨 본 글자 수로 판단한다
  //    (음을 옮기면 옥타브·볼륨 명령과 쉼표가 줄어 글자 수 합이 줄 수 있다)
  if (room && room(1, limit)) {
    report("spread")(0);
    const one = distribute();
    if (one.moved > 0 && one.over.length === 0) {
      const next = compact.apply(one.song);
      const result = next && splitSong(next, profile);
      if (next && result && !result.needed) return { song: next, result, spread: { to: 1, limit, moved: one.moved } };
    }
  }

  // 2) 그대로 나눠 권 수를 센다 (꼼꼼히는 마지막에 고른 곡에만)
  let plan: BookPlan = { song, result: splitSong(song, profile, { onProgress: report("split") }) };
  const books = plan.result.parts.length;

  // 3) 음을 옮겨 권이 줄면 옮긴 곡을 쓴다. 2권부터 한 권 적게까지 차례로 해 본다 (한 권은 1)에서 해 봤다)
  if (spread && books > 2) {
    const progress = report("spread");
    const targets = Array.from({ length: books - 2 }, (_, k) => k + 2);
    const steps = targets.length * SHARES.length;
    let step = 0;
    search: for (const target of targets) {
      // 글자 수 합으로 보아 이 권 수에는 못 넣으면 나눠 보지 않는다
      if (!room!(target, limit)) {
        step += SHARES.length;
        continue;
      }
      for (const share of SHARES) {
        progress(step++ / steps);
        const channel = Math.floor(limit * target * share);
        const moved = distribute(channel);
        if (moved.moved === 0) continue;
        // 한 권 적게보다 더 줄이려는 시도는, 옮겨도 채널이 넘치면 나눠 보지 않는다 (오래 걸린다)
        if (target < books - 1 && moved.over.length > 0) continue;
        const next = compact.apply(moved.song);
        if (!next) continue;
        const result = splitSong(next, profile);
        if (result.parts.length < plan.result.parts.length) {
          plan = { song: next, result, spread: { from: books, to: result.parts.length, limit: channel, moved: moved.moved } };
        }
        if (result.parts.length <= target) break search;
      }
    }
    progress(1);
  }

  // 4) 꼼꼼히: 고른 곡을 꼼꼼히 다시 나눈다 (권이 줄어드는 자리를 더 찾아본다)
  if (options.thorough && plan.result.parts.length > 1) {
    const result = splitSong(plan.song, profile, { thorough: true, onProgress: report("thorough") });
    if (result.parts.length <= plan.result.parts.length) {
      plan = { ...plan, result, ...(plan.spread ? { spread: { ...plan.spread, to: result.parts.length } } : {}) };
    }
  }
  return plan;
}

/**
 * 화음을 아무리 고르게 나눠도 books권에 못 넣는 곡을 미리 거른다 (분산은 오래 걸린다).
 * &로 이어진 음(같은 높이면 출력기가 한 음으로 합친다)은 함께 옮기므로, 이어진 묶음 하나는 적어도 한 글자(음 이름)를 쓴다.
 * 음은 같은 연주자의 잠그지 않은 트랙끼리만 옮기므로, 그 트랙들의 묶음 수 합이 "트랙 수 × 권 수 × 한도"를 넘으면
 * 어떻게 옮겨도 못 넣는다.
 * 글자 수 합으로 거르면 안 된다: 옮기면 옥타브·볼륨 명령과 쉼표가 줄어 합이 줄 수 있다 (PR #86 점검 2번).
 * 음 수로 세어도 안 된다: c64&c64&… 처럼 이어진 음 여럿이 한 글자가 될 수 있다 (PR #88 점검 1번)
 */
function roomFor(song: Song, locked: ReadonlySet<string> | undefined): (books: number, limit: number) => boolean {
  const byPlayer = new Map<string, { notes: number; tracks: number }>();
  for (const track of song.tracks) {
    if (locked?.has(track.id)) continue;
    const entry = byPlayer.get(track.playerId) ?? { notes: 0, tracks: 0 };
    entry.notes += chains(track.notes);
    entry.tracks += 1;
    byPlayer.set(track.playerId, entry);
  }
  return (books, limit) => [...byPlayer.values()].every((p) => p.notes <= p.tracks * books * limit);
}

/** &로 바로 이어진 음을 하나로 센 음 수 (freeRuns가 함께 옮기는 묶음과 같은 기준) */
function chains(notes: readonly Note[]): number {
  const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
  let count = 0;
  sorted.forEach((n, k) => {
    const prev = sorted[k - 1];
    if (!(prev && prev.tie === "next" && eq(add(prev.start, prev.dur), n.start))) count++;
  });
  return count;
}
