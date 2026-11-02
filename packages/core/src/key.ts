import { cmp, ZERO, type Rat } from "./rat.js";
import type { KeyEvent, Note } from "./model.js";

/**
 * 조표. fifths = 올림표 개수(양수)·내림표 개수(음수), -7~7. 0 = 다장조(가단조).
 * 피아노롤 "조표 맞춤" 입력과 이벤트 줄 조표 표시가 쓴다. MML 출력과는 상관없다 (게임 MML에는 조표가 없다)
 */
export const KEY_FIFTHS = [-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7] as const;

/** 다장조 음계 (음 번호 % 12) */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** 흰 건반 음 번호 % 12 */
const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);

/** -7~7 정수로 맞춘다 (틀린 값은 0) */
export function clampFifths(fifths: number): number {
  return Number.isFinite(fifths) ? Math.max(-7, Math.min(7, Math.round(fifths))) : 0;
}

/** 이 조의 으뜸음 (음 번호 % 12, 장조 기준) */
export function keyTonic(fifths: number): number {
  return (((clampFifths(fifths) * 7) % 12) + 12) % 12;
}

/** 이 조 음계에 드는 음 번호 % 12 (오름차순) */
export function keyScale(fifths: number): number[] {
  const tonic = keyTonic(fifths);
  return MAJOR.map((s) => (s + tonic) % 12).sort((a, b) => a - b);
}

/** 음이 이 조 음계에 드는지 */
export function inKey(pitch: number, fifths: number): boolean {
  return keyScale(fifths).includes(((pitch % 12) + 12) % 12);
}

/**
 * 조표대로 음을 맞춘다. 조에 드는 음은 그대로.
 * - 조에 없는 흰 건반: 조표가 그 글자에 붙인 올림·내림을 붙인다 (G장조에서 F → F#, F장조에서 B → B♭)
 * - 조에 없는 검은 건반: 제자리음으로 (올림표 조·다장조는 아래 글자, 내림표 조는 위 글자. G장조 C# → C, F장조 E♭ → E)
 * 장음계는 반음 사이가 둘인 칸이 조 밖 음이라 양쪽이 모두 조 안 음이므로, 어느 쪽으로 가도 조 안 음이 된다
 */
export function snapToKey(pitch: number, fifths: number): number {
  if (inKey(pitch, fifths)) return pitch;
  const f = clampFifths(fifths);
  const white = WHITE.has(((pitch % 12) + 12) % 12);
  const up = white ? f > 0 : f < 0;
  const out = pitch + (up ? 1 : -1);
  return Math.max(0, Math.min(127, out));
}

/**
 * 조 안에서 steps칸(음계 한 칸씩) 옮긴다. 조 밖 음은 먼저 조표대로 맞춘 뒤 옮긴다.
 * 0~127을 넘으면 undefined
 */
export function stepInKey(pitch: number, fifths: number, steps: number): number | undefined {
  let p = snapToKey(pitch, fifths);
  const dir = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps); i++) {
    do p += dir;
    while (p >= 0 && p <= 127 && !inKey(p, fifths));
    if (p < 0 || p > 127) return undefined;
  }
  return p;
}

/** from에서 to까지 조 안 음계로 몇 칸인지 (둘 다 조표대로 맞춘 뒤 센다. 위로 양수) */
export function keySteps(from: number, to: number, fifths: number): number {
  const a = snapToKey(from, fifths);
  const b = snapToKey(to, fifths);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let n = 0;
  for (let p = lo + 1; p <= hi; p++) if (inKey(p, fifths)) n++;
  return b >= a ? n : -n;
}

/** 끌어 옮기기에서 잡은 음이 움직인 거리: 잡은 음의 조로 센 음계 칸 수와 반음 수 */
export interface KeyMove {
  readonly steps: number;
  readonly semitones: number;
}

/** 잡은 음(grab)이 grabTo로 갈 때의 거리. 음계 칸 수는 잡은 음 자리의 조(fifths)로 한 번만 센다 */
export function keyMove(grab: number, grabTo: number, fifths: number): KeyMove {
  return { steps: keySteps(grab, grabTo, fifths), semitones: grabTo - grab };
}

/**
 * 함께 옮기는 음 하나(pitch)를 그 음 자리의 조(fifths)에서 옮긴다.
 * 조 안 음은 잡은 음이 움직인 음계 칸 수만큼 조 안에서 옮겨 화음이 조를 벗어나지 않게 하고,
 * 조 밖 음(임시표)은 잡은 음이 움직인 반음 수만큼 그대로 옮긴다. 0~127을 넘으면 undefined.
 * 칸 수는 잡은 음의 조로 센 값을 그대로 써서, 조바꿈을 걸친 선택에서도 모든 음이 같은 칸 수만큼 움직인다
 */
export function applyKeyMove(pitch: number, move: KeyMove, fifths: number): number | undefined {
  if (!inKey(pitch, fifths)) {
    const out = pitch + move.semitones;
    return out >= 0 && out <= 127 ? out : undefined;
  }
  return stepInKey(pitch, fifths, move.steps);
}

/** 잡은 음과 같은 조에 있는 음 하나를 옮긴다 (keyMove + applyKeyMove) */
export function moveInKey(pitch: number, grab: number, grabTo: number, fifths: number): number | undefined {
  return applyKeyMove(pitch, keyMove(grab, grabTo, fifths), fifths);
}

/**
 * 조표 맞춤 끌기: 잡은 음(grab)을 반음 dp만큼 끌 때 함께 옮기는 음마다의 새 높이 (notes와 같은 차례).
 * 잡은 음은 조표대로 맞춘 줄로 가고, 음계 칸 수는 잡은 음 자리의 조로 한 번만 센다.
 * 음마다 옮긴 뒤 자리(at)의 조에서 그 칸 수만큼 옮긴다 (임시표는 같은 반음 수만큼). 건반 밖으로 나가는 음이 있으면 undefined
 */
export function dragInKey(
  notes: readonly { readonly pitch: number; readonly at: Rat }[],
  grab: { readonly pitch: number; readonly at: Rat },
  dp: number,
  keys: readonly KeyEvent[] | undefined,
): number[] | undefined {
  const grabKey = keyAt(keys, grab.at);
  const move = keyMove(grab.pitch, snapToKey(grab.pitch + dp, grabKey), grabKey);
  const out: number[] = [];
  for (const n of notes) {
    const p = applyKeyMove(n.pitch, move, keyAt(keys, n.at));
    if (p === undefined) return undefined;
    out.push(p);
  }
  return out;
}

/** 이 위치에 걸린 조표 (없으면 0 = 다장조) */
export function keyAt(keys: readonly KeyEvent[] | undefined, at: Rat): number {
  let found = 0;
  for (const k of [...(keys ?? [])].sort((a, b) => cmp(a.at, b.at))) if (cmp(k.at, at) <= 0) found = k.fifths;
  return clampFifths(found);
}

/** 이 위치의 조표가 시작한 자리 (조표가 없으면 곡 처음) */
export function keyStartAt(keys: readonly KeyEvent[] | undefined, at: Rat): Rat {
  let found: Rat = ZERO;
  for (const k of [...(keys ?? [])].sort((a, b) => cmp(a.at, b.at))) if (cmp(k.at, at) <= 0) found = k.at;
  return found;
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/** 조 이름 (장조 / 나란한 단조, 영문 음이름). 예: 1 → { major: "G", minor: "e" }, -3 → { major: "E♭", minor: "c" } */
export function keyNames(fifths: number): { major: string; minor: string } {
  const f = clampFifths(fifths);
  const names = f < 0 ? FLAT_NAMES : SHARP_NAMES;
  const tonic = keyTonic(f);
  // 단조 으뜸음은 장조 으뜸음 단3도 아래. 이름 고르기: 7올림(C#장조)·6올림(F#장조)·-7(C♭장조) 같은 조는 표에 없는 글자라 따로
  const special: Record<number, { major: string; minor: string }> = {
    6: { major: "F#", minor: "d#" },
    7: { major: "C#", minor: "a#" },
    [-6]: { major: "G♭", minor: "e♭" },
    [-7]: { major: "C♭", minor: "a♭" },
  };
  if (special[f]) return special[f]!;
  return { major: names[tonic]!, minor: names[(tonic + 9) % 12]!.toLowerCase() };
}

/** 조표 기호 (예: "#2", "♭3", 다장조는 "") */
export function keySignText(fifths: number): string {
  const f = clampFifths(fifths);
  return f > 0 ? `#${f}` : f < 0 ? `♭${-f}` : "";
}

/** 이벤트 줄에 쓰는 짧은 조 이름 (예: "G/e") */
export function keyShort(fifths: number): string {
  const n = keyNames(fifths);
  return `${n.major}/${n.minor}`;
}

/**
 * 조표에 맞추기: 음마다 그 시작 자리의 조표로 조 밖 음만 snapToKey로 맞춘다 (조 안 음·picked 밖 음은 그대로 같은 객체).
 * picked: 맞출 음 id (없으면 모두). 바꾼 음 수를 함께 돌려준다
 */
export function fitNotesToKey(notes: readonly Note[], keys: readonly KeyEvent[] | undefined, picked?: ReadonlySet<string>): { notes: Note[]; changed: number } {
  let changed = 0;
  const out = notes.map((n) => {
    if (picked && !picked.has(n.id)) return n;
    const pitch = snapToKey(n.pitch, keyAt(keys, n.start));
    if (pitch === n.pitch) return n;
    changed++;
    return { ...n, pitch };
  });
  return { notes: out, changed };
}
