import { add, cmp, rat, sub, ZERO, type Rat } from "./rat.js";
import type { Note, Song, TempoEvent, Track } from "./model.js";
import { songProfile } from "./profile.js";

/**
 * 틱 칸: 길이 숫자를 정수 틱으로 읽는 게임(프로필 length.ticks)의 곡은 음의 시작과 끝, 템포 자리를 늘 온음표 1/perWhole 칸 위에 둔다.
 * 칸 밖 자리는 그 게임에 넣을 글로 쓸 수 없기 때문이다 (l5 다섯 개는 380틱이라 박에서 끝나지 않는다).
 * 맞추는 규칙은 음마다 길이를 반올림하는 것이 아니라 자리(시작·끝)를 각각 가장 가까운 틱으로 옮기는 것이다.
 * 그래야 오차가 쌓이지 않고 잇단음 묶음이 박에서 정확히 끝난다 (4분 5잇단 = 19·19·20·19·19틱).
 * 특정 게임 이름은 보지 않고 프로필의 ticks 값만 본다
 */

/** 이 곡이 틱 칸을 쓰면 온음표 하나의 틱 수, 아니면 undefined */
export function songTicks(song: Song): number | undefined {
  return songProfile(song).length.ticks?.perWhole;
}

/** 자리가 틱 칸 위인지 */
export function onTick(at: Rat, perWhole: number): boolean {
  return perWhole % at.d === 0;
}

/** 가장 가까운 틱 자리 (한가운데면 뒤쪽) */
export function nearestTick(at: Rat, perWhole: number): Rat {
  if (onTick(at, perWhole)) return at;
  return rat(Math.floor((at.n * perWhole) / at.d + 0.5), perWhole);
}

export interface TickSnapReport {
  /** 자리를 옮긴 음 수 */
  readonly moved: number;
  /** 가장 크게 옮긴 양 (온음표 단위, 시작·끝 가운데 큰 쪽) */
  readonly maxShift: Rat;
  /** 맞춘 뒤 이 틱 수보다 짧아진 음 (게임에 쓸 수 없어 고쳐야 한다) */
  readonly short: number;
  /** 옮긴 템포 수 */
  readonly tempoMoved: number;
  /** 음을 옮긴 트랙 id */
  readonly tracks: readonly string[];
}

const NO_SNAP: TickSnapReport = { moved: 0, maxShift: ZERO, short: 0, tempoMoved: 0, tracks: [] };

/**
 * 한 트랙 음을 틱 칸으로. 겹치지 않던 음은 맞춘 뒤에도 겹치지 않는다.
 * 맞추면 길이가 0이 되는 음은 한 틱으로 남긴다. 그 한 틱이 뒤 음 자리를 넘으면 뒤 음을 그만큼 뒤로 민다
 * (음을 빼지 않고, 겹치지 않던 두 음을 겹치게 만들지 않는다). 처음부터 겹친 음끼리는 밀지 않는다. 바뀐 것이 없으면 같은 배열
 */
function snapNotes(notes: readonly Note[], perWhole: number, minTicks: number): { notes: readonly Note[]; moved: number; maxShift: Rat; short: number } {
  if (notes.every((n) => onTick(n.start, perWhole) && onTick(n.dur, perWhole))) {
    return { notes, moved: 0, maxShift: ZERO, short: countShort(notes, perWhole, minTicks) };
  }
  const one = rat(1, perWhole);
  let moved = 0;
  let maxShift: Rat = ZERO;
  const out: Note[] = [...notes];
  // 시작 순서로 보며, 바로 앞 음(원래 끝 ≤ 이 음 시작)의 맞춘 끝보다 앞에서 시작하지 않게 한다
  const order = notes.map((_, k) => k).sort((a, b) => cmp(notes[a]!.start, notes[b]!.start) || a - b);
  let prev: { end: Rat; snappedEnd: Rat } | undefined;
  for (const k of order) {
    const n = notes[k]!;
    const end = add(n.start, n.dur);
    let start = nearestTick(n.start, perWhole);
    if (prev && cmp(prev.end, n.start) <= 0 && cmp(start, prev.snappedEnd) < 0) start = prev.snappedEnd;
    let snappedEnd = nearestTick(end, perWhole);
    if (cmp(snappedEnd, start) <= 0) snappedEnd = add(start, one);
    // 앞 음과 겹친 채 들어온 음은 앞 음 끝을 그대로 둔다 (더 늦게 끝나는 쪽을 기준으로)
    if (!prev || cmp(end, prev.end) >= 0) prev = { end, snappedEnd };
    const shift = maxRat(absRat(sub(start, n.start)), absRat(sub(snappedEnd, end)));
    if (cmp(shift, ZERO) === 0) continue;
    moved++;
    if (cmp(shift, maxShift) > 0) maxShift = shift;
    out[k] = { ...n, start, dur: sub(snappedEnd, start) };
  }
  return { notes: out, moved, maxShift, short: countShort(out, perWhole, minTicks) };
}

function countShort(notes: readonly Note[], perWhole: number, minTicks: number): number {
  const min = rat(minTicks, perWhole);
  // & 로 이은 음은 한 덩어리로 본다 (사슬 안 토막이 짧아도 게임은 이어서 친다)
  let short = 0;
  let chain: Rat = ZERO;
  for (const n of notes) {
    chain = add(chain, n.dur);
    if (n.tie === "next") continue;
    if (cmp(chain, min) < 0) short++;
    chain = ZERO;
  }
  return short;
}

const absRat = (r: Rat): Rat => (r.n < 0 ? { n: -r.n, d: r.d } : r);
const maxRat = (a: Rat, b: Rat): Rat => (cmp(a, b) >= 0 ? a : b);

function snapTempo(tempo: readonly TempoEvent[], perWhole: number): { tempo: readonly TempoEvent[]; moved: number } {
  if (tempo.every((e) => onTick(e.at, perWhole))) return { tempo, moved: 0 };
  let moved = 0;
  const out = tempo.map((e) => {
    if (onTick(e.at, perWhole)) return e;
    moved++;
    return { ...e, at: nearestTick(e.at, perWhole) };
  });
  return { tempo: out, moved };
}

/**
 * 곡의 음 자리와 템포 자리를 틱 칸으로 맞춘다. only를 주면 그 트랙만 본다 (편집이 바꾼 트랙).
 * 음을 옮긴 트랙은 원문(mml)이 더는 음과 같지 않으므로 지운다 (출력기가 다시 쓴다).
 * 틱 칸을 쓰지 않는 곡이거나 바꿀 것이 없으면 같은 곡을 돌려준다
 */
export function snapSongToTicks(song: Song, only?: ReadonlySet<string>, tempoToo = true): { song: Song; report: TickSnapReport } {
  const profile = songProfile(song);
  const perWhole = profile.length.ticks?.perWhole;
  if (perWhole === undefined) return { song, report: NO_SNAP };
  const minTicks = Math.floor(perWhole / profile.length.max);
  let moved = 0;
  let maxShift: Rat = ZERO;
  let short = 0;
  const changed: string[] = [];
  const tracks: Track[] = song.tracks.map((t) => {
    if (only && !only.has(t.id)) return t;
    const r = snapNotes(t.notes, perWhole, minTicks);
    short += r.short;
    if (r.notes === t.notes) return t;
    moved += r.moved;
    if (cmp(r.maxShift, maxShift) > 0) maxShift = r.maxShift;
    changed.push(t.id);
    const { mml: _mml, ...rest } = t;
    return { ...rest, notes: [...r.notes] };
  });
  const tempo = tempoToo ? snapTempo(song.tempo, perWhole) : { tempo: song.tempo, moved: 0 };
  const report: TickSnapReport = { moved, maxShift, short, tempoMoved: tempo.moved, tracks: changed };
  if (changed.length === 0 && tempo.moved === 0) return { song, report };
  return { song: { ...song, tracks, tempo: [...tempo.tempo] }, report };
}

/**
 * 실행 취소 기록이 편집 결과를 받아들이기 전에 부르는 맞춤 (History의 settle): 틱 칸을 쓰는 곡이면
 * 편집이 바꾼 트랙(음 배열이 달라진 트랙)과 바뀐 템포만 틱 칸으로 맞춘다. 넣는 길(롤·타브·MML 글·MIDI·잇단음·아르페지오 등)마다
 * 따로 붙이지 않고 모든 편집이 지나는 한 곳에서 맞춘다. 틱 칸을 쓰지 않는 곡이면 after 그대로
 */
export function settleToTicks(before: Song, after: Song): Song {
  if (songTicks(after) === undefined) return after;
  const old = new Map(before.tracks.map((t) => [t.id, t.notes]));
  const only = new Set(after.tracks.filter((t) => old.get(t.id) !== t.notes).map((t) => t.id));
  const tempoToo = after.tempo !== before.tempo || after.meta.profileId !== before.meta.profileId;
  if (only.size === 0 && !tempoToo) return after;
  return snapSongToTicks(after, only, tempoToo).song;
}
