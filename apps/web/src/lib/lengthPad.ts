import type { NoteLength } from "./roll";

/** 음표 입력판(타브 숫자판 위 한 줄)에 놓는 길이: 격자대로, 온음표~64분음표, 켜면 셋잇단과 사용자가 정한 잇단음 */
const BASE = ["grid", "1", "2", "4", "8", "16", "32", "64"] as const;
const TRIPLETS = ["12", "24", "48"] as const;

/**
 * 게임이 받는 길이(noteLengths, lengthsFor로 거른 목록) 가운데 입력판에 놓을 단추.
 * tuplet: 잇단음 단추를 켰을 때 그 길이 ("20"). 목록에 있고 다른 단추와 겹치지 않을 때만 맨 끝에 붙는다
 */
export function padLengths(noteLengths: readonly NoteLength[], triplets: boolean, tuplet?: NoteLength): NoteLength[] {
  const wanted: NoteLength[] = triplets ? [...BASE, ...TRIPLETS] : [...BASE];
  if (tuplet !== undefined && !wanted.includes(tuplet)) wanted.push(tuplet);
  return wanted.filter((l) => noteLengths.includes(l));
}

/** 지금 새 음 길이가 이 단추인지 (점 붙은 길이는 점 없는 단추를 눌린 것으로 본다) */
export function padPressed(button: NoteLength, now: NoteLength): boolean {
  return now === button || now === `${button}.`;
}

/** 숫자판에서 숫자를 누른 뒤 커서가 갈 곳: 옆 칸(넣은 음 길이만큼, 기본) / 같은 자리 아래 줄(화음 쌓기) */
export type PadAdvanceDir = "right" | "down";

/** 저장해 둔 값을 읽는다. "down"일 때만 아래 줄, 없거나 모르는 값이면 옆 칸 */
export function parseAdvanceDir(raw: string | null): PadAdvanceDir {
  return raw === "down" ? "down" : "right";
}
