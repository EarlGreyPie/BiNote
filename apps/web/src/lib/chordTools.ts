import { add, barAt, barBounds, cmp, positionToSeconds, toFloat, ZERO, type GameProfile, type Note, type Rat, type Song, type Track } from "@mmlce/core";
import { soundGroups, trackSource, type MergeLevel, type MergeTracksPlan } from "@mmlce/mml";

/**
 * 화음 분산·병합 창(곡 메뉴)이 함께 쓰는 계산. 곡을 바꾸지 않는다 (바꾸는 명령은 @mmlce/mml spread·merge-tracks).
 */

/** 트랙 글자 수 (화면에 보이는 글 그대로) */
export function trackChars(song: Song, id: string): number {
  const track = song.tracks.find((t) => t.id === id);
  return track ? trackSource(song, track).text.length : 0;
}

/** 분산 창이 처음 고를 보내는 트랙: 주면 그 트랙, 아니면 한도를 가장 많이 넘는 잠그지 않은 트랙, 없으면 가장 긴 트랙 */
export function defaultSpreadSource(song: Song, limit: number, locked: ReadonlySet<string>, wanted?: string): string | undefined {
  const open = song.tracks.filter((t) => !locked.has(t.id));
  if (wanted && open.some((t) => t.id === wanted)) return wanted;
  const sized = open.map((t) => ({ id: t.id, chars: trackChars(song, t.id) })).sort((a, b) => b.chars - a.chars);
  return sized.find((x) => x.chars > limit)?.id ?? sized[0]?.id;
}

/** 병합할 수 있는 트랙 묶음: 같은 악보·같은 악기(끄기·솔로·채널 볼륨·팬도 같음)인 잠그지 않은 트랙이 둘 이상 */
export function mergeGroups(song: Song, profile: GameProfile, locked: ReadonlySet<string>): string[][] {
  const groups = soundGroups(song, profile);
  const byKey = new Map<string, string[]>();
  for (const t of song.tracks) {
    if (locked.has(t.id)) continue;
    const key = groups.get(t.id)!;
    byKey.set(key, [...(byKey.get(key) ?? []), t.id]);
  }
  return [...byKey.values()].filter((ids) => ids.length > 1);
}

export type MergeRole = "keep" | "remove" | "skip";

/** 처음 역할: 음이 가장 적은 트랙 하나를 비우고 나머지는 남긴다 */
export function defaultMergeRoles(song: Song, ids: readonly string[]): Record<string, MergeRole> {
  const count = (id: string) => song.tracks.find((t) => t.id === id)?.notes.length ?? 0;
  const sparse = [...ids].sort((a, b) => count(a) - count(b) || ids.indexOf(b) - ids.indexOf(a))[0];
  return Object.fromEntries(ids.map((id) => [id, id === sparse ? "remove" : "keep"]));
}

/** 처음 우선 트랙: 그 묶음에서 "멜로디"로 표시한 트랙 */
export function defaultPriority(song: Song, ids: readonly string[]): string | undefined {
  return ids.find((id) => song.tracks.find((t) => t.id === id)?.role === "melody");
}

export const MERGE_LEVELS: readonly MergeLevel[] = [1, 2, 3];

/** 화음 병합 단계 기억 */
export const MERGE_LEVEL_KEY = "mmlce.mergeLevel";

/** 화음 병합 "트랙은 남기고 옮길 수 있는 음만 몰기" 기억 (기본 꺼짐) */
export const MERGE_PARTIAL_KEY = "mmlce.mergePartial";

export function parseMergePartial(raw: string | null): boolean {
  return raw === "1";
}

export function parseMergeLevel(raw: string | null): MergeLevel {
  return raw === "2" ? 2 : raw === "3" ? 3 : 1;
}

const NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];

/** 음 높이를 MML 이름으로 (o4c = 60) */
export function pitchLabel(pitch: number): string {
  return `o${Math.floor(pitch / 12) - 1}${NAMES[((pitch % 12) + 12) % 12]}`;
}

/** 곡 끝 (가장 늦게 끝나는 음) */
export function songEnd(song: Song): Rat {
  let end = ZERO;
  for (const t of song.tracks) for (const n of t.notes) if (cmp(add(n.start, n.dur), end) > 0) end = add(n.start, n.dur);
  return end;
}

/** 미리보기 띠의 가로 위치 (0~1) */
export function spanX(at: Rat, end: Rat): number {
  const e = toFloat(end);
  return e > 0 ? Math.min(1, Math.max(0, toFloat(at) / e)) : 0;
}

/** 병합 칸 "들어 보기": 병합 전(지금 곡) · 병합 후(적용하면 될 곡) · 빠지는 음만 */
export type MergeListenMode = "before" | "after" | "dropped";

/** 끄기·솔로를 풀어 꼭 들리게 한다 (안 들리는 것을 판단하게 두지 않는다) */
const audible = (t: Track): Track => (t.mute || t.solo ? { ...t, mute: false, solo: false } : t);

/**
 * 병합 칸에서 들을 곡. 곡은 바꾸지 않고 새 곡을 만든다 (음 객체와 시간은 그대로 쓴다, 다시 셈하거나 반올림하지 않는다).
 * - before: 지금 곡, after: 병합 결과 곡 (빠진 음과 v를 올린 음이 함께 들린다)
 * - dropped: 묶음 트랙마다 빠지는 음만 남긴 지금 곡 (원래 트랙의 악기·v 그대로)
 * groupOnly(이 트랙들만)거나 dropped면 묶음 밖 트랙은 빼고 묶음 트랙은 끄기·솔로를 푼다. 템포·박자·연주자는 그대로
 */
export function mergeListenSong(song: Song, result: Pick<MergeTracksPlan, "song" | "dropped">, ids: readonly string[], mode: MergeListenMode, groupOnly: boolean): Song {
  const group = new Set(ids);
  if (mode === "dropped") {
    const gone = new Set(result.dropped.map((d) => d.note));
    const tracks = song.tracks
      .filter((t) => group.has(t.id))
      .map((t) => {
        const { mml: _mml, ...rest } = t;
        return audible({ ...rest, notes: t.notes.filter((n) => gone.has(n)) });
      });
    return { ...song, tracks };
  }
  const base = mode === "before" ? song : result.song;
  if (!groupOnly) return base;
  return { ...base, tracks: base.tracks.filter((t) => group.has(t.id)).map(audible) };
}

/** 마디로 듣기 한 구간: bar~lastBar 마디 (빠지는 음이 마디선을 넘으면 끝나는 마디까지). from은 짧으면 앞 마디를 붙인 시작 */
export interface ListenBar {
  readonly bar: number;
  readonly lastBar: number;
  readonly from: Rat;
  readonly to: Rat;
}

/**
 * 빠지는 음이 있는 마디 구간 (마디 순). 같은 마디에서 시작하는 음은 한 구간이고, 마디선을 넘는 음은 끝나는 마디까지 넣는다.
 * 구간이 minSeconds보다 짧으면(짧은 마디·빠른 곡) 앞 마디 하나를 더 붙여 되풀이 사이가 숨 가쁘지 않게 한다
 */
export function droppedBars(song: Song, notes: readonly Note[], minSeconds = 2): ListenBar[] {
  const last = new Map<number, number>();
  for (const n of notes) {
    const first = barAt(song.timeSig, n.start);
    const end = add(n.start, n.dur);
    let to = barAt(song.timeSig, end);
    // 마디선에서 끝나는 음은 그 마디까지 (다음 마디는 넣지 않는다)
    if (to > first && cmp(barBounds(song.timeSig, to)[0], end) >= 0) to--;
    last.set(first, Math.max(last.get(first) ?? first, to));
  }
  return [...last]
    .sort((a, b) => a[0] - b[0])
    .map(([bar, lastBar]) => {
      let from = barBounds(song.timeSig, bar)[0];
      const to = barBounds(song.timeSig, lastBar)[1];
      if (bar > 1 && positionToSeconds(song.tempo, to) - positionToSeconds(song.tempo, from) < minSeconds) from = barBounds(song.timeSig, bar - 1)[0];
      return { bar, lastBar, from, to };
    });
}

/** 그 음이 든 마디 구간 번호 (droppedBars 안). 없으면 -1 */
export function listenBarOf(bars: readonly ListenBar[], song: Song, note: Note): number {
  const bar = barAt(song.timeSig, note.start);
  return bars.findIndex((b) => b.bar === bar);
}

/** "빠지는 음만" 시작 자리: 커서 뒤 첫 빠지는 음이 있는 마디 첫머리 (없으면 첫 빠지는 음의 마디) */
export function droppedListenStart(song: Song, notes: readonly Note[], cursor: Rat | undefined): Rat | undefined {
  const starts = [...notes].map((n) => n.start).sort(cmp);
  const first = (cursor ? starts.find((s) => cmp(s, cursor) >= 0) : undefined) ?? starts[0];
  return first ? barBounds(song.timeSig, barAt(song.timeSig, first))[0] : undefined;
}
