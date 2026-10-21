import { add, cmp, mul, rat, sub, ZERO, type Rat } from "./rat.js";
import type { Note, Song } from "./model.js";
import { foldPitch, soundingRangeOf, TIE_BEND_LIMIT, type GameProfile } from "./profile.js";
import { shortestLength } from "./note-length.js";
import { replaceNotes } from "./note-edit.js";

/**
 * 꾸밈음: 고른 음(본음) 앞에 짧은 음을 몇 개 붙인다. MML에는 길이 없는 꾸밈음이 없으므로 어느 한쪽 길이를 실제로 깎는다.
 * - 박 위에서(on): 꾸밈음이 본음 자리에서 시작하고 본음은 그만큼 늦게 시작한다. 본음이 화음이면(같은 연주자의 다른 트랙에서
 *   같은 때 시작하는 음) 화음 음도 함께 늦게 시작한다.
 * - 박 앞에서(before): 본음은 제자리. 꾸밈음이 바로 앞 음(또는 앞 쉼표)의 꼬리를 깎아 들어간다. 화음의 다른 음은 그대로.
 * 깎고 남는 길이는 게임 최단 길이 이상이고 정확히 쓸 수 있어야 한다 (반올림하지 않는다). 결과만 계산하고 곡은 바꾸지 않는다
 */

export type GraceTiming = "on" | "before";

export interface GraceOptions {
  /** 꾸밈음 높이: 본음 기준 반음 수, 치는 순서대로. 개수 = 길이 */
  readonly offsets: readonly number[];
  /** 꾸밈음 하나 길이 (온음표 단위) */
  readonly length: Rat;
  readonly timing: GraceTiming;
  /** 꾸밈음과 본음을 &로 이어 다시 치지 않게 한다 */
  readonly tie: boolean;
  /** 이 길이를 게임 길이로 정확히 쓸 수 있는지 (출력기와 같은 판정) */
  readonly canWrite: (dur: Rat) => boolean;
  readonly locked?: ReadonlySet<string>;
  /** 트랙이 실제로 소리 내는 악기 (& 사슬 높이 차를 재생과 같이 접어 잰다) */
  readonly instrumentOf?: (trackId: string) => string | undefined;
  /** 꾸밈음을 놓을 타브 줄 (본음이 보이는 줄). 없으면 본음에 적어 둔 줄 */
  readonly stringOf?: (note: Note) => number | undefined;
}

export interface GraceSkipped {
  /** &로 이어 받은 음이라 새로 치지 않음 */
  readonly tied: number;
  /** 깎을 길이가 모자람 (본음·화음 음·앞 음이 최단 길이보다 짧아지거나, 곡 처음보다 앞) */
  readonly short: number;
  /** 남는 길이를 정확히 쓸 수 없음 */
  readonly unwritable: number;
  /** 잠근 트랙이 낌 */
  readonly locked: number;
  /** & 사슬 높이 차가 너무 큼 */
  readonly bend: number;
  /** 꾸밈음 높이가 MIDI 범위(0~127) 밖 */
  readonly range: number;
}

export interface GraceResult {
  /** 바뀐 트랙과 그 트랙 음 전체. 바뀐 것이 없으면 빈 목록 */
  readonly changes: readonly { readonly trackId: string; readonly notes: readonly Note[] }[];
  /** 꾸밈음을 붙인 본음(화음은 하나로 셈) 수 */
  readonly made: number;
  /** 만든 꾸밈음과 본음 (적용 뒤 고른 음으로 쓴다) */
  readonly ids: readonly string[];
  readonly skipped: GraceSkipped;
  /** 이 길이·방식으로 고른 모든 본음에 붙일 수 있는 최대 개수 (본음이 하나도 없으면 0) */
  readonly max: number;
  /** 개수가 최대를 넘어 아무것도 바꾸지 않음 */
  readonly tooMany: boolean;
}

/** 한 번에 붙일 수 있는 꾸밈음 수 상한 (창의 입력 상한. 실제 상한은 본음 길이가 정한다) */
export const GRACE_MAX = 32;

const end = (n: { start: Rat; dur: Rat }) => add(n.start, n.dur);

interface Target {
  readonly trackId: string;
  readonly id: string;
  /**
   * 박 위에서 함께 늦출 화음 음 (같은 연주자의 다른 트랙에서 본음과 같은 때 새로 치는 음). 편집 전 곡에서 한 번 정한다:
   * 앞 본음을 늦춘 뒤의 곡에서 다시 찾으면, 늦춰진 음이 뒤 본음 시작과 겹쳐 그 화음으로 잘못 잡혀 두 번 늦춰진다
   */
  readonly voices: readonly { readonly trackId: string; readonly id: string }[];
}

/**
 * 고른 음을 본음 목록으로. 같은 연주자·같은 시작인 고른 음은 화음 하나로 보고 가장 높은 음에 꾸밈음을 붙인다
 * (나머지는 박 위에서일 때 화음 음으로 함께 늦어진다). 시작 순
 */
function targetsOf(song: Song, picked: readonly Note[]): Target[] {
  const ids = new Set(picked.map((n) => n.id));
  const groups = new Map<string, { trackId: string; note: Note }>();
  for (const tr of song.tracks) {
    for (const n of tr.notes) {
      if (!ids.has(n.id)) continue;
      const key = `${tr.playerId}|${n.start.n}/${n.start.d}`;
      const was = groups.get(key);
      if (!was || n.pitch > was.note.pitch) groups.set(key, { trackId: tr.id, note: n });
    }
  }
  const sortedOf = new Map(song.tracks.map((t) => [t.id, [...t.notes].sort((a, b) => cmp(a.start, b.start))] as const));
  return [...groups.values()]
    .sort((a, b) => cmp(a.note.start, b.note.start))
    .map((g) => {
      const playerId = song.tracks.find((t) => t.id === g.trackId)?.playerId;
      const voices = song.tracks
        .filter((t) => t.id !== g.trackId && t.playerId === playerId)
        .flatMap((t) => {
          const sorted = sortedOf.get(t.id)!;
          return sorted.filter((n) => cmp(n.start, g.note.start) === 0 && !isHeld(sorted, n)).map((n) => ({ trackId: t.id, id: n.id }));
        });
      return { trackId: g.trackId, id: g.note.id, voices };
    });
}

/** 시작 순으로 놓은 트랙 음에서 n 바로 앞 음 (n보다 먼저 시작하는 마지막 음) */
function before(sorted: readonly Note[], n: Note): Note | undefined {
  let prev: Note | undefined;
  for (const x of sorted) {
    if (x.id === n.id || cmp(x.start, n.start) >= 0) break;
    prev = x;
  }
  return prev;
}

/** 바로 앞 음이 &로 이어 주는 음인지 (새로 치지 않는 음) */
function isHeld(sorted: readonly Note[], n: Note): boolean {
  const prev = before(sorted, n);
  return !!prev && prev.tie === "next" && cmp(end(prev), n.start) === 0;
}

type Fit = { ok: true } | { ok: false; why: keyof GraceSkipped };

/** 지금 곡(tracks)에서 본음 하나에 길이 total(= 개수 × 길이)의 꾸밈음 자리가 나는지. 바꿀 음을 함께 돌려준다 */
function room(
  tracks: ReadonlyMap<string, readonly Note[]>,
  target: Target,
  total: Rat,
  options: Pick<GraceOptions, "timing" | "canWrite" | "locked">,
  shortest: Rat,
): Fit & { edits?: { trackId: string; note: Note }[]; main?: Note } {
  const own = [...(tracks.get(target.trackId) ?? [])].sort((a, b) => cmp(a.start, b.start));
  const main = own.find((n) => n.id === target.id);
  if (!main) return { ok: false, why: "short" };
  if (options.locked?.has(target.trackId)) return { ok: false, why: "locked" };
  if (isHeld(own, main)) return { ok: false, why: "tied" };
  /** 길이가 최단 이상이고 정확히 써지는지 */
  const keep = (dur: Rat): Fit => (cmp(dur, shortest) < 0 ? { ok: false, why: "short" } : options.canWrite(dur) ? { ok: true } : { ok: false, why: "unwritable" });
  if (options.timing === "on") {
    // 본음과 편집 전에 정한 화음 음이 함께 늦게 시작한다 (지금 곡에서 그 음을 id로 찾는다. 이미 옮겨졌으면 자리가 달라 건너뜀)
    const voices: { trackId: string; note: Note }[] = [{ trackId: target.trackId, note: main }];
    for (const v of target.voices) {
      const note = tracks.get(v.trackId)?.find((n) => n.id === v.id);
      if (note && cmp(note.start, main.start) === 0) voices.push({ trackId: v.trackId, note });
    }
    for (const v of voices) {
      if (options.locked?.has(v.trackId)) return { ok: false, why: "locked" };
      const fit = keep(sub(v.note.dur, total));
      if (!fit.ok) return fit;
      // 화음 음 앞 쉼표는 늦춘 만큼 길어진다 (본음 앞은 꾸밈음이 채운다). 길어진 쉼표도 정확히 써져야 한다
      if (v.note.id === main.id) continue;
      const sorted = [...(tracks.get(v.trackId) ?? [])].sort((a, b) => cmp(a.start, b.start));
      const prev = before(sorted, v.note);
      const gap = sub(add(v.note.start, total), prev ? end(prev) : ZERO);
      if (!options.canWrite(gap)) return { ok: false, why: "unwritable" };
    }
    return { ok: true, main, edits: voices.map((v) => ({ trackId: v.trackId, note: { ...v.note, start: add(v.note.start, total), dur: sub(v.note.dur, total) } })) };
  }
  // 박 앞에서: 꾸밈음이 [본음 시작 − total, 본음 시작)을 차지한다
  const fit = roomBefore(own, main, total, options.canWrite, shortest);
  if (!fit.ok) return fit;
  return { ok: true, main, edits: fit.prev ? [{ trackId: target.trackId, note: fit.prev }] : [] };
}

/**
 * 박 앞 자리: 음 main 바로 앞 [main 시작 − total, main 시작)을 비운다 (꾸밈음·슬라이드가 함께 쓴다). 그 자리의 앞 음은 꼬리를 깎고,
 * 쉼표는 줄어든다. 깎고 남는 앞 음은 최단 길이 이상이고, 남는 앞 음·쉼표는 정확히 써져야 한다. own은 시작 순으로 놓은 트랙 음.
 * prev는 꼬리를 깎은 앞 음 (쉼표에서 가져오면 없음)
 */
export function roomBefore(
  own: readonly Note[],
  main: Note,
  total: Rat,
  canWrite: (dur: Rat) => boolean,
  shortest: Rat,
): { ok: true; prev?: Note } | { ok: false; why: "short" | "unwritable" } {
  const from = sub(main.start, total);
  if (cmp(from, ZERO) < 0) return { ok: false, why: "short" };
  const prev = before(own, main);
  if (!prev || cmp(end(prev), from) <= 0) {
    // 앞이 쉼표: 남는 쉼표도 정확히 써져야 한다 (0이면 쉼표가 없어진다)
    const gap = sub(from, prev ? end(prev) : ZERO);
    if (gap.n !== 0 && !canWrite(gap)) return { ok: false, why: "unwritable" };
    return { ok: true };
  }
  // 앞 음이 자리에 걸친다. 그 앞 음보다 더 앞까지 먹으면(앞 음 시작이 자리 안) 모자람
  if (cmp(prev.start, from) >= 0) return { ok: false, why: "short" };
  const left = sub(from, prev.start);
  if (cmp(left, shortest) < 0) return { ok: false, why: "short" };
  if (!canWrite(left)) return { ok: false, why: "unwritable" };
  // 앞 음은 이제 뒤와 붙지 않으므로 &를 풀지 않아도 되지만(& 뒤가 떨어지면 잇지 않는다), 이어지는 오해가 없게 푼다
  return { ok: true, prev: { ...prev, dur: left, tie: "none" } };
}

/**
 * 본음 하나에 붙일 수 있는 최대 개수 (자리 판정만. 높이·& 높이 차는 보지 않는다). 남는 길이가 써지지 않는 개수는 건너뛴다.
 * 새로 치지 않는 음이나 잠근 트랙이 낀 본음은 어차피 건너뛰므로 undefined (최대 개수를 정하지 않는다)
 */
function maxFor(tracks: ReadonlyMap<string, readonly Note[]>, target: Target, length: Rat, options: Pick<GraceOptions, "timing" | "canWrite" | "locked">, shortest: Rat): number | undefined {
  let best = 0;
  for (let k = 1; k <= GRACE_MAX; k++) {
    const r = room(tracks, target, mul(length, rat(k)), options, shortest);
    if (r.ok) best = k;
    else if (r.why === "tied" || r.why === "locked") return undefined;
    else if (r.why === "short") break;
  }
  return best;
}

/** 고른 음 모두에 붙일 수 있는 최대 개수 (본음마다 잰 값 중 가장 작은 것). 잴 본음이 없으면 undefined */
export function graceMax(song: Song, picked: readonly Note[], options: Pick<GraceOptions, "length" | "timing" | "canWrite" | "locked">, profile: GameProfile): number | undefined {
  const shortest = shortestLength(profile.length);
  const tracks = new Map<string, readonly Note[]>(song.tracks.map((t) => [t.id, t.notes]));
  const each = targetsOf(song, picked)
    .map((tg) => maxFor(tracks, tg, options.length, options, shortest))
    .filter((m): m is number => m !== undefined);
  return each.length === 0 ? undefined : Math.min(...each);
}

export function planGrace(song: Song, picked: readonly Note[], options: GraceOptions, profile: GameProfile, newId: () => string): GraceResult {
  const skipped = { tied: 0, short: 0, unwritable: 0, locked: 0, bend: 0, range: 0 };
  const shortest = shortestLength(profile.length);
  const targets = targetsOf(song, picked);
  const tracks = new Map<string, readonly Note[]>(song.tracks.map((t) => [t.id, t.notes]));
  // 최대 개수: 처음 곡 기준. 넘으면 아무것도 바꾸지 않는다 (일부 본음에만 붙지 않게)
  const measured = graceMax(song, picked, options, profile);
  const max = measured ?? 0;
  const k = options.offsets.length;
  const none = { changes: [], made: 0, ids: [], skipped, max };
  if (k === 0 || targets.length === 0) return { ...none, tooMany: false };
  if (measured !== undefined && k > measured) return { ...none, tooMany: true };
  const total = mul(options.length, rat(k));
  const touched = new Set<string>();
  const ids: string[] = [];
  let made = 0;
  for (const tg of targets) {
    const fit = room(tracks, tg, total, options, shortest);
    if (!fit.ok) {
      skipped[fit.why]++;
      continue;
    }
    const main = fit.main!;
    const pitches = options.offsets.map((o) => main.pitch + o);
    if (pitches.some((p) => p < 0 || p > 127)) {
      skipped.range++;
      continue;
    }
    const own = [...(tracks.get(tg.trackId) ?? [])].sort((a, b) => cmp(a.start, b.start));
    if (options.tie) {
      // & 사슬: 첫 꾸밈음부터 본음과 본음에 이어진 음까지. 재생처럼 접은 높이로 첫 음과의 차를 잰다
      const range = soundingRangeOf(profile, options.instrumentOf?.(tg.trackId));
      const chain: number[] = [...pitches, main.pitch];
      let at = own.findIndex((n) => n.id === main.id);
      while (own[at]?.tie === "next" && own[at + 1] && cmp(end(own[at]!), own[at + 1]!.start) === 0) chain.push(own[++at]!.pitch);
      const head = foldPitch(pitches[0]!, range);
      if (chain.some((p) => Math.abs(foldPitch(p, range) - head) > TIE_BEND_LIMIT)) {
        skipped.bend++;
        continue;
      }
    }
    const from = options.timing === "on" ? main.start : sub(main.start, total);
    const tabString = options.stringOf?.(main) ?? main.tabString;
    const graces: Note[] = pitches.map((pitch, i) => ({
      id: newId(),
      start: add(from, mul(options.length, rat(i))),
      dur: options.length,
      pitch,
      vol: main.vol,
      tie: options.tie ? "next" : "none",
      ...(tabString !== undefined ? { tabString } : {}),
    }));
    const byTrack = new Map<string, Map<string, Note>>();
    const put = (trackId: string, n: Note) => {
      let m = byTrack.get(trackId);
      if (!m) byTrack.set(trackId, (m = new Map()));
      m.set(n.id, n);
    };
    for (const e of fit.edits ?? []) put(e.trackId, e.note);
    for (const g of graces) put(tg.trackId, g);
    for (const [trackId, changes] of byTrack) {
      tracks.set(trackId, replaceNotes(tracks.get(trackId) ?? [], changes, new Set(changes.keys())));
      touched.add(trackId);
    }
    ids.push(...graces.map((g) => g.id), main.id, ...(fit.edits ?? []).filter((e) => e.note.id !== main.id && options.timing === "on").map((e) => e.note.id));
    made++;
  }
  const changes = song.tracks.filter((t) => touched.has(t.id)).map((t) => ({ trackId: t.id, notes: tracks.get(t.id)! }));
  return { changes, made, ids, skipped, max, tooMany: false };
}
