import type { Command, Song, SongMeta } from "@mmlce/core";

/** 곡 정보 창에서 고치는 칸. 모델(SongMeta)에 이미 있는 것만 둔다 */
export interface SongInfo {
  readonly title: string;
  readonly author: string;
  readonly memo: string;
}

/**
 * 한 줄로 맞춘다: 줄바꿈은 빈칸으로 바꾸고 앞뒤 빈칸을 뗀다.
 * 3MLE(Title=·Source=·Memo=)와 마비꼬(title=·author=) 파일은 한 줄에 칸 하나라, 줄바꿈이 들어가면 다음 줄이 깨진다
 */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * 곡에서 창에 띄울 값 (메모가 없으면 빈 글). 한 줄로 맞춰 띄운다:
 * 한 줄 입력 칸은 줄바꿈을 빈칸 없이 지워 버려서, 여러 줄 메모를 고치면 "첫 줄둘째 줄"처럼 낱말이 붙기 때문이다
 */
export function songInfoOf(meta: SongMeta): SongInfo {
  return { title: oneLine(meta.title), author: oneLine(meta.author), memo: oneLine(meta.memo ?? "") };
}

/**
 * 곡 제목·지은이·메모를 바꾸는 명령 (실행 취소 한 칸). 트랙·악보 이름 바꾸기처럼 곡을 고친 것으로 친다.
 * 한 줄로 맞춘 값이 지금과 같은 칸은 건드리지 않고, 셋 다 같으면 곡을 그대로 돌려준다.
 * 메모를 비우면 memo 칸을 뺀다 (3MLE 파일을 읽을 때 빈 메모를 넣지 않는 것과 같게)
 */
export function setSongInfo(info: SongInfo, label = "곡 정보"): Command {
  return {
    label,
    apply: (song) => withInfo(song, info),
    invert: (before) => restoreMeta(label, before.meta),
  };
}

function withInfo(song: Song, info: SongInfo): Song {
  const old = song.meta;
  const pick = (next: string, now: string) => (oneLine(next) === oneLine(now) ? now : oneLine(next));
  const title = pick(info.title, old.title);
  const author = pick(info.author, old.author);
  const memo = pick(info.memo, old.memo ?? "");
  if (title === old.title && author === old.author && memo === (old.memo ?? "")) return song;
  const { memo: _memo, ...rest } = old;
  return { ...song, meta: { ...rest, title, author, ...(memo ? { memo } : {}) } };
}

/** 되돌리기: 바꾸기 전 meta를 그대로 다시 얹는다 (프로필 등 다른 칸도 그때 것) */
function restoreMeta(label: string, meta: SongMeta): Command {
  return {
    label,
    apply: (song) => (song.meta === meta ? song : { ...song, meta }),
    invert: (before) => restoreMeta(label, before.meta),
  };
}
