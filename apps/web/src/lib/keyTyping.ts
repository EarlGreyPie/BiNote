import { add, inKey, keyAt, ZERO, type KeyEvent, type Rat } from "@mmlce/core";
import { parseMml } from "@mmlce/mml";

/** MML 음 글자 → 음 번호 % 12 (제자리음) */
const LETTER_PC: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * 조표 맞춤 글 입력: 음 글자 하나를 칠 때 뒤에 붙일 올림·내림.
 * 제자리음이 조에 들면 붙이지 않고, 조 밖이면 조표 쪽으로 (올림표 조는 "+", 내림표 조는 "-": G장조 f → f+, F장조 b → b-).
 * 피아노롤 조표 맞춤에서 흰 건반 줄을 누를 때(snapToKey)와 같은 규칙이다
 */
export function accidentalFor(letter: string, fifths: number): "" | "+" | "-" {
  const pc = LETTER_PC[letter];
  if (pc === undefined || inKey(pc, fifths)) return "";
  return fifths > 0 ? "+" : "-";
}

/**
 * 편집기에서 커서 앞 글(before) 뒤에 음 글자를 칠 때 붙일 올림·내림. 커서 자리의 곡 위치는 앞 글을 읽어 잰다
 * (offset = 트랙 원문 시작 자리). 주석 안이면 붙이지 않는다
 */
export function typedAccidental(before: string, letter: string, offset: Rat | undefined, keys: readonly KeyEvent[] | undefined): "" | "+" | "-" {
  if (LETTER_PC[letter] === undefined) return "";
  const parsed = parseMml(before);
  if (parsed.diagnostics.some((d) => d.code === "unclosed-comment")) return "";
  return accidentalFor(letter, keyAt(keys, add(offset ?? ZERO, parsed.end)));
}
