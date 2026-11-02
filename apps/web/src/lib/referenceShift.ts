import type { Command, History, Song } from "@mmlce/core";

/**
 * 원곡 대조 위치(어긋남)는 곡 밖 상태라 실행 취소 기록에 들지 않는다. 마디 지우기·마디 빼기처럼 곡과 함께
 * 어긋남도 옮긴 단계는 명령에 옮긴 ms를 붙여 두고, 실행 취소·다시 실행이 그 단계를 지날 때 어긋남도 같이 되돌린다
 */
const shifts = new WeakMap<Command, { readonly ms: number; readonly name: string | undefined }>();

/**
 * 명령에 원곡 어긋남을 옮긴 양(ms)을 붙인다. 0이면 명령 그대로.
 * name: 옮긴 원곡 파일 이름. 실행 취소·다시 실행은 이 이름의 원곡(불러온 것이나 프로젝트 맞춤값)만 옮긴다
 */
export function withReferenceShift(command: Command, ms: number, name?: string): Command {
  if (ms === 0) return command;
  const tagged: Command = { label: command.label, apply: (song) => command.apply(song), invert: (before) => command.invert(before) };
  shifts.set(tagged, { ms, name });
  return tagged;
}

/** 명령에 붙인 원곡 어긋남 옮김(ms). 없으면 0 */
export function referenceShiftOf(command: Command | undefined): number {
  return (command && shifts.get(command)?.ms) ?? 0;
}

/** 명령이 어긋남을 옮긴 원곡 파일 이름 (없으면 undefined) */
export function referenceShiftName(command: Command | undefined): string | undefined {
  return command ? shifts.get(command)?.name : undefined;
}

/** 원곡 어긋남에 더할 ms (초 → 정수 ms). 실행 취소가 같은 값을 빼서 정확히 돌아오게 정수로 맞춘다 */
export function shiftMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

/**
 * 실행 취소·다시 실행 한 칸. 그 단계가 원곡 어긋남도 옮겼으면 이번에 어긋남에 더할 ms를 함께 돌려준다
 * (실행 취소는 뺀다). 되돌릴 단계가 없으면 곡 그대로, 0
 */
export function stepHistory(history: History, way: "undo" | "redo"): { song: Song; referenceShiftMs: number; referenceName: string | undefined } {
  const command = way === "undo" ? history.undoCommand : history.redoCommand;
  if (!command) return { song: history.song, referenceShiftMs: 0, referenceName: undefined };
  const song = way === "undo" ? history.undo() : history.redo();
  const ms = referenceShiftOf(command);
  return { song, referenceShiftMs: way === "undo" ? -ms : ms, referenceName: referenceShiftName(command) };
}
