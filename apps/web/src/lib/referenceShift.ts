import type { Command, History, Song } from "@mmlce/core";

/**
 * 원곡 대조 위치(어긋남)와 배경 영상 어긋남은 곡 밖 상태라 실행 취소 기록에 들지 않는다. 마디 지우기·마디 빼기·마디 넣기처럼
 * 곡과 함께 어긋남도 옮긴 단계는 명령에 옮긴 ms를 붙여 두고, 실행 취소·다시 실행이 그 단계를 지날 때 어긋남도 같이 되돌린다
 */
interface Shift {
  readonly ms: number;
  readonly name: string | undefined;
}
const shifts = new WeakMap<Command, { readonly reference: Shift; readonly video: Shift }>();

/** 옮긴 것이 없는 쪽 */
const NONE: Shift = { ms: 0, name: undefined };

/**
 * 명령에 원곡 어긋남을 옮긴 양(ms)을 붙인다. 둘 다 0이면 명령 그대로.
 * name: 옮긴 원곡 파일 이름. 실행 취소·다시 실행은 이 이름의 원곡(불러온 것이나 프로젝트 맞춤값)만 옮긴다.
 * video: 함께 옮긴 배경 영상 어긋남 (ms와 영상 파일 이름). 원곡과 같은 규칙으로 되돌린다
 */
export function withReferenceShift(command: Command, ms: number, name?: string, video?: { readonly ms: number; readonly name: string | undefined }): Command {
  const v = video && video.ms !== 0 ? { ms: video.ms, name: video.name } : NONE;
  if (ms === 0 && v.ms === 0) return command;
  const tagged: Command = { label: command.label, apply: (song) => command.apply(song), invert: (before) => command.invert(before) };
  shifts.set(tagged, { reference: ms === 0 ? NONE : { ms, name }, video: v });
  return tagged;
}

/** 명령에 붙인 원곡 어긋남 옮김(ms). 없으면 0 */
export function referenceShiftOf(command: Command | undefined): number {
  return (command && shifts.get(command)?.reference.ms) ?? 0;
}

/** 명령이 어긋남을 옮긴 원곡 파일 이름 (없으면 undefined) */
export function referenceShiftName(command: Command | undefined): string | undefined {
  return command ? shifts.get(command)?.reference.name : undefined;
}

/** 명령에 붙인 배경 영상 어긋남 옮김(ms)과 영상 파일 이름. 없으면 0 */
export function videoShiftOf(command: Command | undefined): Shift {
  return (command && shifts.get(command)?.video) ?? NONE;
}

/** 원곡 어긋남에 더할 ms (초 → 정수 ms). 실행 취소가 같은 값을 빼서 정확히 돌아오게 정수로 맞춘다 */
export function shiftMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/**
 * 배경 영상 어긋남(초)을 ms만큼 옮긴다. 영상 어긋남은 초 소수라 더하고 빼면 끝자리가 흔들리므로
 * 마이크로초에서 반올림한다: 같은 ms를 빼면(실행 취소) 옮기기 전 값으로 정확히 돌아온다
 */
export function shiftVideoOffset(offset: number, ms: number): number {
  return Math.round((offset + ms / 1000) * 1e6) / 1e6;
}

/**
 * 실행 취소·다시 실행 한 칸. 그 단계가 원곡·배경 영상 어긋남도 옮겼으면 이번에 어긋남에 더할 ms를 함께 돌려준다
 * (실행 취소는 뺀다). 되돌릴 단계가 없으면 곡 그대로, 0
 */
export function stepHistory(
  history: History,
  way: "undo" | "redo",
): { song: Song; referenceShiftMs: number; referenceName: string | undefined; videoShiftMs: number; videoName: string | undefined } {
  const command = way === "undo" ? history.undoCommand : history.redoCommand;
  if (!command) return { song: history.song, referenceShiftMs: 0, referenceName: undefined, videoShiftMs: 0, videoName: undefined };
  const song = way === "undo" ? history.undo() : history.redo();
  // 실행 취소는 뺀다 (0은 0 그대로)
  const signed = (ms: number) => (way === "undo" && ms !== 0 ? -ms : ms);
  const video = videoShiftOf(command);
  return {
    song,
    referenceShiftMs: signed(referenceShiftOf(command)),
    referenceName: referenceShiftName(command),
    videoShiftMs: signed(video.ms),
    videoName: video.name,
  };
}
