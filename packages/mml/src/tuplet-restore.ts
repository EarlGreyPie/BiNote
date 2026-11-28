import { add, cmp, eq, songProfile, type Command, type LengthLimit, type Note, type Rat, type Song, type Track } from "@mmlce/core";
import { mergeTies } from "./compare.js";
import { keepTextEnd, restoreSong } from "./edit.js";
import { findTrackOffgridMabiicco, OFFGRID_CLEAN, spliceOffgrid } from "./offgrid.js";
import { optimizeMml } from "./optimizer.js";
import { parseMml } from "./parser.js";
import { unwritableNotes } from "./validate.js";

/**
 * 잇단음 되살리기 (설계 2부 "프로필을 오갈 때"). 틱 칸 게임(PC)에서 정수 틱으로 나눠 둔 잇단음(4분 5잇단 = 19·19·20·19·19틱)을
 * 정확한 분수 게임(모바일)으로 옮길 때 고른 잇단음(l20 다섯)으로 되돌린다.
 * 새 규칙을 만들지 않는다: 트랙 음을 마비꼬와 같은 틱 셈(온음표 384틱, 내림)의 글로 적고, 그 글을 #289의 마비꼬 틱 복원
 * (findTrackOffgridMabiicco: tupletNumber·tickConsistent·exactReturn)에 그대로 넣는 얇은 어댑터다.
 * 고친 글을 곡의 길이 셈으로 다시 읽은 음으로 트랙 음을 바꾼다. 음 수·높이·볼륨·&는 그대로이고 자리·길이만 바뀐다.
 * 곡 게임이 틱 칸을 쓰면(PC) 되살릴 것이 없다
 */
export interface TupletRestore {
  readonly song: Song;
  /** 트랙마다 되살린 묶음 수 */
  readonly tracks: readonly { readonly trackId: string; readonly fixes: number }[];
  /** 자리나 길이가 바뀐 음 수 */
  readonly moved: number;
  /** 되살린 뒤에도 곡의 길이 셈으로 정확히 쓸 수 없는 음 수 (되살리기로 돌아오지 않는 자리) */
  readonly left: number;
}

/** 틱 칸으로 읽는 길이 셈 (마비꼬와 같은 셈). 곡의 길이 한도에 틱 규칙만 더한다 */
function tickLimit(limit: LengthLimit): LengthLimit {
  return { ...limit, ticks: { perWhole: OFFGRID_CLEAN, rounding: "floor" } };
}

/** 트랙 하나 되살리기. 바꿀 것이 없거나 안전하게 되돌릴 수 없으면 undefined */
function restoreTrack(track: Track, limit: LengthLimit): { notes: Note[]; fixes: number } | undefined {
  if (track.notes.length === 0 || unwritableNotes(track, limit).length === 0) return undefined;
  const ticks = tickLimit(limit);
  const sorted = [...track.notes].sort((a, b) => cmp(a.start, b.start));
  const text = optimizeMml(sorted, { lengths: ticks }).text;
  const fixes = findTrackOffgridMabiicco(text, limit);
  if (fixes.length === 0) return undefined;
  const fixed = spliceOffgrid(text, fixes.flatMap((f) => f.edits));
  if (fixed === text) return undefined;
  // 고치기 전·뒤를 같은 묶음(& 이은 음 하나)끼리 견준다: 음 수·높이가 같아야 자리·길이만 옮긴다
  const before = mergeTies(parseMml(text, { lengths: ticks }).notes);
  const after = mergeTies(parseMml(fixed, { lengths: limit }).notes);
  const own = mergeTies(sorted);
  if (before.length !== own.length || after.length !== own.length || after.some((n, k) => n.pitch !== own[k]!.pitch)) return undefined;
  // 원래 음(& 이은 토막 포함)을 묶음마다 새 자리·길이로 옮긴다. 묶음 안 토막은 원래 비율 그대로 늘리거나 줄일 수 없으므로 한 음으로 합친다
  const groups = groupTies(sorted);
  if (groups.length !== after.length) return undefined;
  // 틱 셈 글로 적으면서 자리·길이가 바뀐 묶음(틱 칸 밖의 정확한 분수 음)은 되살린 결과를 쓰지 않고 원래 음 그대로 둔다
  const lossy = (k: number) => !eq(before[k]!.start, own[k]!.start) || !eq(before[k]!.dur, own[k]!.dur);
  const notes = groups.flatMap((g, k) => {
    if (lossy(k)) return g;
    const first = g[0]!;
    const last = g[g.length - 1]!;
    return [{ ...first, start: after[k]!.start, dur: after[k]!.dur, tie: last.tie }];
  });
  // 원래 음을 남긴 묶음 곁에서 되살린 음과 겹치게 되면 (원래는 겹치지 않았는데) 이 트랙은 되살리지 않는다
  const overlaps = (list: readonly Note[]) => {
    let n = 0;
    for (let k = 1; k < list.length; k++) if (cmp(add(list[k - 1]!.start, list[k - 1]!.dur), list[k]!.start) > 0) n++;
    return n;
  };
  if (own.some((_, k) => lossy(k)) && overlaps([...notes].sort((a, b) => cmp(a.start, b.start))) > overlaps(sorted)) return undefined;
  if (notes.every((n, k) => n === sorted[k])) return undefined;
  return { notes, fixes: fixes.length };
}

/** &로 바로 이어진 같은 높이·볼륨 음을 묶음으로 (mergeTies와 같은 기준이어야 해서, 묶음 수가 다르면 호출한 쪽이 버린다) */
function groupTies(sorted: readonly Note[]): Note[][] {
  const out: Note[][] = [];
  for (const n of sorted) {
    const group = out[out.length - 1];
    const prev = group?.[group.length - 1];
    if (group && prev && prev.tie === "next" && prev.pitch === n.pitch && prev.vol === n.vol && eq(add(prev.start, prev.dur), n.start)) group.push(n);
    else out.push([n]);
  }
  return out;
}

/** 곡 전체 되살리기 (잠근 트랙은 그대로) */
export function restoreTuplets(song: Song, locked?: ReadonlySet<string>): TupletRestore {
  const limit = songProfile(song).length;
  const changed: { trackId: string; fixes: number }[] = [];
  let moved = 0;
  const tracks = song.tracks.map((t) => {
    if (locked?.has(t.id)) return t;
    const r = restoreTrack(t, limit);
    if (!r) return t;
    changed.push({ trackId: t.id, fixes: r.fixes });
    const was = [...t.notes].sort((a, b) => cmp(a.start, b.start));
    moved += r.notes.filter((n) => !was.some((w) => w.id === n.id && eq(w.start, n.start) && eq(w.dur, n.dur))).length;
    const { mml: _mml, ...rest } = t;
    return { ...rest, notes: r.notes };
  });
  if (changed.length === 0) return { song, tracks: [], moved: 0, left: countLeft(song, limit) };
  const next = keepTextEnd(song, { ...song, tracks }, changed.map((c) => c.trackId));
  return { song: next, tracks: changed, moved, left: countLeft(next, limit) };
}

function countLeft(song: Song, limit: LengthLimit): number {
  return song.tracks.reduce((s, t) => s + unwritableNotes(t, limit).length, 0);
}

/** 잇단음 되살리기 명령 (실행 취소 한 칸) */
export function restoreTupletsSong(locked?: ReadonlySet<string>, label = "잇단음 되살리기"): Command {
  return {
    label,
    apply: (song) => restoreTuplets(song, locked).song,
    invert: (before) => restoreSong(before),
  };
}
