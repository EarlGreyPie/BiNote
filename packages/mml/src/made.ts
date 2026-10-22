import { recordMade, sameNotes, type Command, type MadeInfo, type MadeRestore, type Song } from "@mmlce/core";
import { setTracksNotes } from "./edit.js";

/**
 * 되돌리기 계획(restoreMade)을 곡에 넣는다: 바뀐 트랙 음(원문은 음에서 다시 만든다), 빈 새 트랙 지우기, 남은 기록.
 * 계획을 세운 뒤 음이 바뀐 곡이면 넣지 않고 song 그대로 (옛 트랙 음으로 새 음을 덮지 않게)
 */
export function applyMadeRestore(song: Song, plan: Extract<MadeRestore, { ok: true }>): Song {
  if (!sameNotes(song, plan.from)) return song;
  const next = plan.changes.length > 0 ? setTracksNotes(plan.changes).apply(song) : song;
  const gone = new Set(plan.removeTracks);
  const { made: _made, ...rest } = next;
  return { ...rest, tracks: next.tracks.filter((t) => !gone.has(t.id)), ...(plan.made.length > 0 ? { made: plan.made } : {}) };
}

/** 만든 것 되돌리기 (실행 취소 한 칸) */
export function restoreMadeCommand(plan: Extract<MadeRestore, { ok: true }>, label: string): Command {
  const command: Command = {
    label,
    apply: (song) => applyMadeRestore(song, plan),
    invert: (before) => ({ label, apply: () => before, invert: () => command }),
  };
  return command;
}

/**
 * 창 명령에 만든 기록을 붙인다: 적용 앞뒤 곡을 견주어 만든 음에 표시를 남긴다 (실행 취소 한 칸).
 * base: 다시 고치기면 옛 기록을 되돌린 곡을 만드는 함수 (되돌리기와 새로 만들기가 한 칸이 된다)
 */
export function madeCommand(command: Command, info: MadeInfo, base?: (song: Song) => Song): Command {
  const self: Command = {
    label: command.label,
    apply(song) {
      const from = base ? base(song) : song;
      // 다시 고치기에서 옛 기록을 되돌리지 못했으면(창을 연 사이 곡이 바뀜) 아무것도 바꾸지 않는다
      if (base && from === song) return song;
      return recordMade(from, command.apply(from), info);
    },
    invert: (before) => ({ label: command.label, apply: () => before, invert: () => self }),
  };
  return self;
}
