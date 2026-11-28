import { cmp, eq, nearestTick, PROFILES, snapSongToTicks, songProfile, songTicks, type Command, type Song, type TickSnapReport, type Track } from "@mmlce/core";
import { mergeTies, sameSound } from "./compare.js";
import { restoreTuplets } from "./tuplet-restore.js";
import { keepMovedEnd, parseTrackText, restoreSong } from "./edit.js";

/** 곡의 게임을 바꾼 결과 */
export interface ProfileChangeResult {
  readonly song: Song;
  /** 틱 칸으로 맞춘 결과 (틱 칸을 쓰지 않는 게임이면 옮긴 것 없음) */
  readonly snap: TickSnapReport;
  /** 원문(MML 글)을 새 게임의 셈으로 읽으면 소리가 달라져 원문을 지운 트랙 id (출력기가 새 게임에 맞게 다시 쓴다) */
  readonly rewritten: readonly string[];
}

/**
 * 곡의 게임(프로필)을 바꾼다. 곡의 음(분수 자리)이 기준이다:
 * 1. 원문이 있는 트랙은 원문을 새 게임의 길이 셈으로 다시 읽어 음과 템포 자리가 그대로면 원문을 두고, 다르면 지운다.
 *    (같은 글도 게임마다 길이 셈이 다르면 다른 소리가 난다: l5 다섯 개는 정확한 분수면 온음표, 384틱 내림이면 380틱)
 * 2. 새 게임이 틱 칸을 쓰면 모든 음과 템포 자리를 가장 가까운 틱으로 맞춘다 (틱에 맞추기, snapSongToTicks).
 * 모르는 게임이거나 지금과 같은 게임이면 곡을 그대로 둔다
 */
export function songProfileChange(song: Song, profileId: string): ProfileChangeResult {
  const none: ProfileChangeResult = { song, snap: { moved: 0, maxShift: { n: 0, d: 1 }, short: 0, tempoMoved: 0, tracks: [] }, rewritten: [] };
  const to = PROFILES[profileId];
  if (!to || songProfile(song).id === to.id) return none;
  const from = songProfile(song);
  const rewritten: string[] = [];
  const tracks: Track[] = song.tracks.map((t) => {
    if (!t.mml) return t;
    const was = parseTrackText(t.id, t.mml, from.length);
    const now = parseTrackText(t.id, t.mml, to.length);
    const sameTempo = was.tempo.length === now.tempo.length && was.tempo.every((e, k) => eq(e.at, now.tempo[k]!.at) && e.bpm === now.tempo[k]!.bpm);
    if (sameTempo && cmp(was.parsed.gameEnd, now.parsed.gameEnd) === 0 && sameSound(now.notes, t.notes)) return t;
    rewritten.push(t.id);
    const { mml: _mml, ...rest } = t;
    return rest;
  });
  const switched: Song = { ...song, meta: { ...song.meta, profileId: to.id }, tracks };
  const { song: kept, report } = snapKeepingEnd(song, switched, rewritten.length > 0);
  return { song: kept, snap: report, rewritten };
}

/**
 * 곡을 틱 칸에 맞추고(snapSongToTicks), 원문을 지운 트랙도 원문 끝 쉼표로 지키던 길이(악보 끝)를 칸에 맞춰 남긴다 (쉼표만 있는 트랙 포함).
 * before는 원문을 읽을 곡(게임 셈), song은 맞출 곡. dropped면 맞추기 전에 이미 원문을 지운 트랙이 있다.
 * 틱 칸을 쓰지 않는 곡이거나 바꿀 것이 없으면 같은 곡
 */
export function snapKeepingEnd(before: Song, song: Song, dropped = false): { song: Song; report: TickSnapReport } {
  const { song: snapped, report } = snapSongToTicks(song);
  const ticks = songTicks(snapped);
  // 틱에 맞추면서 원문을 지운 트랙(원문은 같은 셈이지만 자리가 칸 밖)도 같다
  const lost = dropped || snapped.tracks.some((t, k) => !!song.tracks[k]?.mml && !t.mml);
  if (!lost) return { song: snapped, report };
  return { song: keepMovedEnd(before, snapped, (r) => (ticks ? nearestTick(r, ticks) : r)), report };
}

/** 여는 곡을 그 게임의 틱 칸에 맞춘다 (원문 끝 쉼표로 지키던 길이도 남긴다). 틱 칸을 쓰지 않거나 칸 위 곡이면 같은 곡 */
export function songOnTicks(song: Song): Song {
  return snapKeepingEnd(song, song).song;
}

/** 곡의 게임을 바꾸는 명령 (실행 취소 한 칸). 결과 알림은 songProfileChange로 미리 센다 */
export function setSongProfile(profileId: string, label = "게임 바꾸기"): Command {
  return {
    label,
    apply: (song) => songProfileChange(song, profileId).song,
    invert: (before) => restoreSong(before),
  };
}

/**
 * 틱 칸 게임으로 바꿀 때 되돌릴 수 없는 음 수 (확인 창). 바꾼 곡을 다시 지금 게임으로 돌리고 잇단음을 되살려도(restoreTuplets)
 * 처음 자리·길이로 돌아오지 않는 음. 트랙마다 & 이은 음을 하나로 견준다
 */
export function lostOnReturn(song: Song, profileId: string): number {
  const from = songProfile(song);
  const there = songProfileChange(song, profileId);
  if (there.snap.moved === 0) return 0;
  const back = restoreTuplets(songProfileChange(there.song, from.id).song).song;
  const key = (n: { start: { n: number; d: number }; dur: { n: number; d: number }; pitch: number }) => `${n.start.n}/${n.start.d}|${n.dur.n}/${n.dur.d}|${n.pitch}`;
  let lost = 0;
  for (const track of song.tracks) {
    const now = new Map<string, number>();
    for (const n of mergeTies(sorted(back.tracks.find((t) => t.id === track.id)?.notes ?? []))) now.set(key(n), (now.get(key(n)) ?? 0) + 1);
    for (const n of mergeTies(sorted(track.notes))) {
      const left = now.get(key(n)) ?? 0;
      if (left > 0) now.set(key(n), left - 1);
      else lost++;
    }
  }
  return lost;
}

const sorted = (notes: readonly Track["notes"][number][]) => [...notes].sort((a, b) => cmp(a.start, b.start));
