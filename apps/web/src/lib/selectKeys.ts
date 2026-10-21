/**
 * 고른 음 건반 불 켜기 (설정 → 재생). 재생 중 건반 불(lightKeys)과 같은 트랙 색으로 피아노롤 건반을 칠한다
 * - off: 끔
 * - press: 음이나 건반을 누르고 있는 동안만 (손을 떼면 꺼진다)
 * - select: 누르는 동안 + 고른 음이 고른 채로 있는 동안 계속 (기본)
 */
export type SelectKeysMode = "off" | "press" | "select";

export const SELECT_KEYS_MODES: readonly SelectKeysMode[] = ["off", "press", "select"];

export function parseSelectKeys(raw: string | null): SelectKeysMode {
  return raw === "off" || raw === "press" ? raw : "select";
}

/**
 * 불 켤 건반: 높이 → 색. pressed = 지금 누르고 있는 음 높이(미리듣기 중인 음),
 * pitches = 고른 음 높이(끄는 중이면 끄는 자리 높이). press 모드는 pitches를 쓰지 않는다
 */
export function heldKeys(mode: SelectKeysMode, pressed: number | undefined, pitches: Iterable<number>, color: string): Map<number, string> {
  const lit = new Map<number, string>();
  if (mode === "off") return lit;
  if (mode === "select") for (const p of pitches) lit.set(p, color);
  if (pressed !== undefined) lit.set(pressed, color);
  return lit;
}
