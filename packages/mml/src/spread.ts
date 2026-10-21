import { add, cmp, meterGrid, sub, trackInstrument, ZERO, type Command, type GameProfile, type Note, type Rat, type Song, type Track, type TimeSigEvent } from "@mmlce/core";
import { chordsPerScore, scoreChunks } from "./clipboard.js";
import { compactResult, restoreSong } from "./edit.js";
import { trackEnd } from "./score-end.js";
import { gameTimeline } from "./game-timeline.js";
import { noteChains } from "./merge.js";
import { optimizeMml } from "./optimizer.js";
import { parseMml } from "./parser.js";
import { sameSound } from "./compare.js";
import { placeTempoByScore } from "./tempo-placement.js";

/**
 * 화음 분산 창 (곡 메뉴). 글자 수가 넘치는 트랙(보내는 트랙)의 음을 마디 단위 구간째 다른 트랙(받는 트랙)으로 옮긴다.
 * 사람이 손으로 나누는 방법(MMLCS samples의 Twinkle·Green Tea Farm 파트조정판)과 같다:
 * 받는 트랙이 쉬는 구절을 통째로 옮기고, 그 구간에 받는 트랙 음이 조금 있으면 그 음은 보내는 트랙으로 맞바꾼다.
 *
 * - 구간 경계는 마디선. 두 트랙 모두 그 마디선을 걸치는 음(&로 이은 묶음 포함)이 없어야 자를 수 있다.
 * - 구간 안의 음은 두 트랙이 통째로 맞바꾼다. 같은 악보·같은 악기(끄기·솔로·채널 볼륨·팬도 같음) 트랙끼리만이라 소리는 같다.
 * - 음을 빼지 않는다. 적용할 때 게임 출력을 다시 읽어 소리가 그대로인지 본다 (아니면 곡을 그대로 둔다).
 */

/** 한 구간에 넣을 최대 마디 수 (이보다 긴 빈자리는 이 길이 안쪽으로 나눠 고를 수 있게 한다) */
export const SPREAD_MAX_BARS = 8;

export interface SpreadSpan {
  /** 받는 트랙 id와 시작 위치로 만든 이름 */
  readonly id: string;
  readonly targetId: string;
  readonly from: Rat;
  readonly to: Rat;
  /** 첫 마디·마지막 마디 번호 (1부터, 끝 포함) */
  readonly bars: readonly [number, number];
  /** 보내는 트랙에서 받는 트랙으로 가는 음 수 */
  readonly give: number;
  /** 받는 트랙에서 보내는 트랙으로 돌아오는 음 수 (0이면 받는 트랙이 그 구간에서 쉰다) */
  readonly take: number;
}

/** 받을 수 없는 트랙의 까닭 */
export type SpreadBlock = "locked" | "score" | "sound";

export interface SpreadCandidate {
  readonly trackId: string;
  /** 없으면 받을 수 있다 */
  readonly block?: SpreadBlock;
}

/**
 * 트랙마다 "같은 소리 묶음" 이름: 게임 악보 + 연주자 + 실제 악기 + 끄기·솔로·채널 볼륨·팬.
 * 같은 이름의 트랙끼리는 음을 주고받아도 게임 소리가 같다 (gameTimeline이 묶는 단위와 같다)
 */
export function soundGroups(song: Song, profile: GameProfile): Map<string, string> {
  const scoreOf = new Map<string, number>();
  scoreChunks(song, chordsPerScore(song, profile)).forEach((c, i) => c.trackIds.forEach((id) => scoreOf.set(id, i)));
  return new Map(
    song.tracks.map((t) => {
      const inst = trackInstrument(song, t);
      return [t.id, `${scoreOf.get(t.id) ?? -1}|${t.playerId}|${inst.canonical}|${inst.program ?? ""}|${t.mute}|${t.solo}|${t.mix?.volume ?? ""}|${t.mix?.pan ?? ""}`];
    }),
  );
}

/** 보내는 트랙과 같은 연주자의 다른 트랙마다, 받을 수 있는지와 까닭 */
export function spreadCandidates(song: Song, profile: GameProfile, sourceId: string, locked?: ReadonlySet<string>): SpreadCandidate[] {
  const source = song.tracks.find((t) => t.id === sourceId);
  if (!source) return [];
  const groups = soundGroups(song, profile);
  const score = (id: string) => groups.get(id)!.split("|")[0];
  return song.tracks
    .filter((t) => t.id !== sourceId && t.playerId === source.playerId)
    .map((t) => {
      if (locked?.has(t.id)) return { trackId: t.id, block: "locked" as const };
      if (score(t.id) !== score(sourceId)) return { trackId: t.id, block: "score" as const };
      if (groups.get(t.id) !== groups.get(sourceId)) return { trackId: t.id, block: "sound" as const };
      return { trackId: t.id };
    });
}

/** 곡 처음부터 end까지의 마디 시작 위치 (박자가 바뀌면 그 자리에서 새 마디). 정확한 분수 */
export function barStarts(timeSig: readonly TimeSigEvent[], end: Rat): Rat[] {
  const sigs = [...timeSig].sort((a, b) => cmp(a.at, b.at));
  const segments = sigs.length === 0 || cmp(sigs[0]!.at, ZERO) > 0 ? [{ at: ZERO, beats: 4, unit: 4 }, ...sigs] : sigs;
  const out: Rat[] = [];
  segments.forEach((sig, i) => {
    const next = segments[i + 1]?.at;
    const { measure } = meterGrid(sig);
    for (let at = sig.at; (!next || cmp(at, next) < 0) && cmp(at, end) < 0; at = add(at, measure)) out.push(at);
  });
  return out;
}

const endOf = (n: Note) => add(n.start, n.dur);
const sorted = (notes: readonly Note[]) => [...notes].sort((a, b) => cmp(a.start, b.start));

/** 이 트랙에서 자를 수 없는 마디(그 마디 시작을 걸치는 음이나 & 묶음이 있는 마디)의 번호(0부터) */
function blockedBars(notes: readonly Note[], bars: readonly Rat[]): Set<number> {
  const out = new Set<number>();
  for (const chain of noteChains(sorted(notes))) {
    const start = chain[0]!.start;
    const last = chain[chain.length - 1]!;
    // 앞 음과 이어지지 않은 &(쉼표 앞 &)도 다음 마디의 음과 이어질 수 있으니 끝을 조금 넘겨 본다
    const end = endOf(last);
    for (let k = 0; k < bars.length; k++) {
      const c = cmp(bars[k]!, start);
      if (c <= 0) continue;
      const e = cmp(bars[k]!, end);
      if (e < 0 || (e === 0 && last.tie === "next")) out.add(k);
      else break;
    }
  }
  return out;
}

/**
 * 보내는 트랙에서 받는 트랙들로 옮길 수 있는 구간 ("빈 곳 찾기").
 * 받는 트랙마다 마디선에서 자를 수 있는 가장 작은 조각을 만들고, 받는 트랙 음이 보내는 트랙 음의 절반 이하인 조각을
 * 이어 붙여 SPREAD_MAX_BARS 마디 안쪽 구간으로 낸다. 받는 트랙이 비어 있는 구간(맞바꿀 음 없음)이 앞에 온다
 */
export function findSpreadSpans(song: Song, sourceId: string, targetIds: readonly string[]): SpreadSpan[] {
  const source = song.tracks.find((t) => t.id === sourceId);
  if (!source || source.notes.length === 0) return [];
  const end = song.tracks.reduce((m, t) => t.notes.reduce((e, n) => (cmp(endOf(n), e) > 0 ? endOf(n) : e), m), ZERO);
  const bars = barStarts(song.timeSig, end);
  const sNotes = sorted(source.notes);
  const sBlocked = blockedBars(sNotes, bars);
  const out: SpreadSpan[] = [];
  for (const targetId of targetIds) {
    const target = song.tracks.find((t) => t.id === targetId);
    if (!target) continue;
    const tNotes = sorted(target.notes);
    const blocked = new Set([...sBlocked, ...blockedBars(tNotes, bars)]);
    // 자를 수 있는 마디선 사이 조각
    const cuts = bars.map((_, k) => k).filter((k) => k === 0 || !blocked.has(k));
    const pieces = cuts.map((k, i) => {
      const from = bars[k]!;
      const to = i + 1 < cuts.length ? bars[cuts[i + 1]!]! : end;
      const inside = (n: Note) => cmp(n.start, from) >= 0 && cmp(n.start, to) < 0;
      return { first: k, last: (i + 1 < cuts.length ? cuts[i + 1]! : bars.length) - 1, from, to, give: sNotes.filter(inside).length, take: tNotes.filter(inside).length };
    });
    const useful = (p: (typeof pieces)[number]) => p.give > 0 && p.take * 2 <= p.give;
    let run: typeof pieces = [];
    const flush = () => {
      if (run.length === 0) return;
      // 긴 빈자리는 SPREAD_MAX_BARS 마디 안쪽으로 나눈다 (조각 하나가 그보다 길면 그 조각 하나)
      let group: typeof pieces = [];
      const emit = () => {
        if (group.length === 0) return;
        const first = group[0]!;
        const last = group[group.length - 1]!;
        out.push({
          id: `${targetId}@${first.from.n}/${first.from.d}`,
          targetId,
          from: first.from,
          to: last.to,
          bars: [first.first + 1, last.last + 1],
          give: group.reduce((s, p) => s + p.give, 0),
          take: group.reduce((s, p) => s + p.take, 0),
        });
        group = [];
      };
      for (const p of run) {
        if (group.length > 0 && p.last - group[0]!.first + 1 > SPREAD_MAX_BARS) emit();
        group.push(p);
      }
      emit();
      run = [];
    };
    for (const p of pieces) {
      // 맞바꿀 음이 있는 조각과 없는 조각은 따로 구간을 만든다 (빈자리를 먼저 보여 주려고)
      if (!useful(p) || (run.length > 0 && (run[0]!.take === 0) !== (p.take === 0))) flush();
      if (useful(p)) run.push(p);
    }
    flush();
  }
  return out.sort((a, b) => Number(a.take > 0) - Number(b.take > 0) || cmp(a.from, b.from));
}

/** 두 구간이 시간에서 겹치는지 */
export function spansOverlap(a: Pick<SpreadSpan, "from" | "to">, b: Pick<SpreadSpan, "from" | "to">): boolean {
  return cmp(a.from, b.to) < 0 && cmp(b.from, a.to) < 0;
}

/**
 * 고른 구간의 음을 맞바꾼다 (글은 지우고 출력기가 다시 쓴다. 글자 수 정리는 spreadResult가 한다).
 * 시간이 겹치는 구간은 앞 것만 쓴다
 */
export function swapSpans(song: Song, sourceId: string, spans: readonly SpreadSpan[]): { song: Song; moved: number } {
  const used: SpreadSpan[] = [];
  for (const s of spans) if (!used.some((u) => spansOverlap(u, s))) used.push(s);
  if (used.length === 0) return { song, moved: 0 };
  const notes = new Map(song.tracks.map((t) => [t.id, [...t.notes]]));
  let moved = 0;
  for (const span of used) {
    const inside = (n: Note) => cmp(n.start, span.from) >= 0 && cmp(n.start, span.to) < 0;
    const s = notes.get(sourceId);
    const t = notes.get(span.targetId);
    if (!s || !t) continue;
    const give = s.filter(inside);
    const take = t.filter(inside);
    notes.set(sourceId, sorted([...s.filter((n) => !inside(n)), ...take]));
    notes.set(span.targetId, sorted([...t.filter((n) => !inside(n)), ...give]));
    moved += give.length + take.length;
  }
  const tracks: Track[] = song.tracks.map((t) => {
    const next = notes.get(t.id)!;
    if (next.length === t.notes.length && next.every((n, i) => n === t.notes[i])) return t;
    const { mml: _mml, ...rest } = t;
    return { ...rest, notes: next };
  });
  return { song: { ...song, tracks }, moved };
}

export interface SpreadResult {
  readonly song: Song;
  /** 자리를 바꾼 음 수 (보낸 음 + 돌아온 음) */
  readonly moved: number;
  /** 곡을 그대로 둔 까닭: notes·tempo = 글자 수 정리를 못 함, sound = 게임 소리가 달라짐 */
  readonly kept?: "notes" | "tempo" | "sound";
}

/**
 * 구간을 맞바꾸고 모든 트랙을 최적화 출력기로 다시 쓴 결과 (화음 분산과 같다. 잠근 트랙은 글도 그대로).
 * 게임 출력을 다시 읽은 결과가 맞바꾸기 전과 다르면 곡을 그대로 둔다
 */
export function spreadResult(song: Song, profile: GameProfile, sourceId: string, spans: readonly SpreadSpan[], locked?: ReadonlySet<string>): SpreadResult {
  const swapped = swapSpans(song, sourceId, spans);
  if (swapped.moved === 0) return { song, moved: 0 };
  // 음을 옮긴 트랙은 원문이 지워지므로, 옮기기 전 트랙 길이(원문 끝 쉼표 포함)를 지킬 길이로 넘긴다
  const compact = compactResult(swapped.song, profile, locked, new Map(song.tracks.map((t) => [t.id, trackEnd(t)])));
  if (compact.kept) return { song, moved: 0, kept: compact.kept };
  const player = song.tracks.find((t) => t.id === sourceId)!.playerId;
  if (gameTimeline(compact.song, profile, player) !== gameTimeline(song, profile, player)) return { song, moved: 0, kept: "sound" };
  return { song: compact.song, moved: swapped.moved };
}

/** 화음 분산 창의 명령 (spreadResult). 실행 취소하면 분산 전 곡으로 돌아간다 */
export function spreadSong(profile: GameProfile, sourceId: string, spans: readonly SpreadSpan[], locked?: ReadonlySet<string>, label = "화음 분산"): Command {
  return {
    label,
    apply: (song) => spreadResult(song, profile, sourceId, spans, locked).song,
    invert: (before) => restoreSong(before),
  };
}

/**
 * 넘친 만큼 구간을 고른다 ("자동으로 고르기"). 이미 고른 구간(keep)은 그대로 두고 더 고른다.
 * 음 하나당 글자 수를 보내는 트랙 평균으로 어림해, 넘친 만큼을 한 번에 채우는 구간 중 받는 트랙이 비어 있는(맞바꿀 음이
 * 적은) 가장 작은 구간, 없으면 가장 많이 덜어 내는 구간부터 넣어 본다 (작은 빈자리를 여럿 쓰기보다 구절째 옮긴다).
 * 넣을 때마다 템포 자리까지 정해 출력기로 다시 세고, 받는 트랙이 한도를 넘거나 보내는 트랙이 줄지 않으면 그 구간은 뺀다.
 * 보내는 트랙이 한도 안에 들면 멈춘다
 */
export function autoSpreadSpans(
  song: Song,
  profile: GameProfile,
  sourceId: string,
  spans: readonly SpreadSpan[],
  locked?: ReadonlySet<string>,
  keep: readonly SpreadSpan[] = [],
): SpreadSpan[] {
  const limit = profile.charLimitPerScore;
  const picked = [...keep];
  const tried = new Set<string>();
  // 템포 자리는 처음 곡에서 한 번만 정해 어림한다 (템포가 많은 곡은 자리 정하기가 느리다). 정확한 수는 spreadResult가 센다
  const placed = placeTempoByScore(song, chordsPerScore(song, profile), undefined, locked);
  // 트랙 글자 수 (ids에 든 트랙만 센다: 출력기는 느리다)
  const sizes = (s: Song, ids: readonly string[], known?: ReadonlyMap<string, number>) => {
    const out = new Map(known);
    for (const t of s.tracks) {
      if (!ids.includes(t.id)) continue;
      const text = optimizeMml(t.notes, { tempo: placed.get(t.id) ?? [] }).text;
      // 옮긴 뒤 출력기가 쓰지 못하는 길이(아주 짧은 쉼표 등)가 생기면 그 구간은 쓸 수 없다
      out.set(t.id, sameSound(t.notes, parseMml(text).notes) ? text.length : Infinity);
    }
    return out;
  };
  if ((song.tracks.find((t) => t.id === sourceId)?.notes.length ?? 0) === 0) return picked;
  let current = swapSpans(song, sourceId, picked).song;
  let now = sizes(current, [sourceId, ...new Set(spans.map((s) => s.targetId))]);
  for (let step = 0; step < 24; step++) {
    const have = now.get(sourceId) ?? 0;
    const need = have - limit;
    if (need <= 0) break;
    const perNote = have / Math.max(1, current.tracks.find((t) => t.id === sourceId)!.notes.length);
    const free = spans.filter((s) => !tried.has(s.id) && !picked.some((p) => spansOverlap(p, s)));
    if (free.length === 0) break;
    const gain = (s: SpreadSpan) => (s.give - s.take) * perNote;
    const room = (s: SpreadSpan) => limit - (now.get(s.targetId) ?? 0);
    const enough = free.filter((s) => gain(s) >= need).sort((a, b) => a.take - b.take || gain(a) - gain(b) || room(b) - room(a));
    const empty = enough.filter((s) => s.take === 0);
    const best = empty[0] ?? enough[0] ?? [...free].sort((a, b) => gain(b) - gain(a) || room(b) - room(a))[0]!;
    tried.add(best.id);
    const next = swapSpans(song, sourceId, [...picked, best]).song;
    const after = sizes(next, [sourceId, best.targetId], now);
    if ((after.get(best.targetId) ?? 0) > limit || (after.get(sourceId) ?? 0) >= have) continue;
    picked.push(best);
    current = next;
    now = after;
  }
  return picked;
}

/** 구간의 길이 (온음표) */
export function spanLength(span: Pick<SpreadSpan, "from" | "to">): Rat {
  return sub(span.to, span.from);
}
