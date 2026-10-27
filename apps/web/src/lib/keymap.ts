/**
 * 단축키. 명령 이름 → 키 목록으로 들고, 키 설정(MMLCE 기본 / 마비꼬 호환)을 고른 뒤
 * 사용자가 바꾼 것만 덧씌운다. 키 표기는 "Ctrl+Shift+S"처럼 Ctrl, Alt, Shift 순서다.
 * Ctrl은 맥의 Cmd도 함께 뜻한다. 글자 키는 한글 입력 중에도 같게 잡히도록 물리 키(code)로 읽는다.
 */

/** 격자 단축키가 고르는 칸 (온음표의 1/n) */
/**
 * 격자(편집 칸). 게임 음길이 한도(GameProfile.length)와 같을 필요는 없다: 격자가 게임 최단 길이보다 잘게 찍힌 음은
 * 출력할 때 검사(unrepresentable-length)가 알린다
 */
export const GRID_DIVISIONS = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64] as const;
export type GridDivision = (typeof GRID_DIVISIONS)[number];

export const COMMANDS = [
  "file.open",
  "file.save3mle",
  "file.saveMmi",
  "file.saveProject",
  "file.saveProjectAs",
  "edit.undo",
  "edit.redo",
  "edit.selectAll",
  "edit.copy",
  "edit.cut",
  "edit.paste",
  "edit.lengthDouble",
  "edit.lengthHalf",
  "edit.dotToggle",
  "edit.transpose",
  "edit.volume",
  "note.delete",
  "note.octaveUp",
  "note.octaveDown",
  "note.volumeUp",
  "note.volumeDown",
  "note.tie",
  "note.split",
  "note.glue",
  "event.tempo",
  "event.marker",
  "tempo.tap",
  "record.toggle",
  "play.toggle",
  "play.start",
  "play.stop",
  "play.fromEditCursor",
  "track.prev",
  "track.next",
  "track.moveUp",
  "track.moveDown",
  "view.tab",
  "view.orientation",
  "view.keymap",
  "grid.double",
  "grid.half",
  ...GRID_DIVISIONS.map((d) => `grid.${d}` as const),
] as const;
export type CommandId = (typeof COMMANDS)[number];

export type Bindings = Readonly<Partial<Record<CommandId, readonly string[]>>>;

export const PRESETS = ["mmlce", "mabiicco"] as const;
export type PresetId = (typeof PRESETS)[number];

function grid(keys: Partial<Record<GridDivision, readonly string[]>>): Bindings {
  return Object.fromEntries(Object.entries(keys).map(([d, k]) => [`grid.${d}`, k]));
}

const COMMON: Bindings = {
  "file.open": ["Ctrl+O"],
  // Ctrl+S는 BiNote 자기 형식(.mme). 3MLE·마비꼬는 내보내기라 Alt·Shift를 붙인다
  "file.save3mle": ["Ctrl+Alt+S"],
  "file.saveMmi": ["Ctrl+Shift+S"],
  "file.saveProject": ["Ctrl+S"],
  // 다른 이름으로 저장은 기본 키를 비워 둔다 (Ctrl+Shift+S는 마비꼬 저장). 키 설정에서 정할 수 있다
  "edit.undo": ["Ctrl+Z"],
  "edit.redo": ["Ctrl+Y", "Ctrl+Shift+Z"],
  "edit.selectAll": ["Ctrl+A"],
  "edit.copy": ["Ctrl+C"],
  "edit.cut": ["Ctrl+X"],
  "edit.paste": ["Ctrl+V"],
  "edit.lengthDouble": ["Ctrl+]"],
  "edit.lengthHalf": ["Ctrl+["],
  // 점음표 붙이기·떼기 (고른 음, 타브는 커서 음, 없으면 새 음 길이)
  "edit.dotToggle": [".", "Num."],
  "edit.transpose": ["Alt+P"],
  "note.octaveUp": ["Shift+Up"],
  "note.octaveDown": ["Shift+Down"],
  "note.volumeUp": ["Alt+Up"],
  "note.volumeDown": ["Alt+Down"],
  "note.tie": ["Alt+L"],
  "note.split": ["Alt+S"],
  "note.glue": ["Alt+G"],
  "event.tempo": ["Alt+B"],
  "event.marker": ["Alt+M"],
  // 탭 템포를 켰을 때만 쓴다 (꺼져 있으면 키를 그대로 넘긴다)
  "tempo.tap": ["T"],
  // MIDI 건반 녹음 줄(실험실)이 열려 있을 때만 쓴다: 녹음 시작 / 멈추고 넣기
  "record.toggle": ["R"],
  "track.moveUp": ["Alt+Shift+Up"],
  "track.moveDown": ["Alt+Shift+Down"],
  "play.start": ["F5"],
  "play.stop": ["Escape"],
  // 격자 칸 ×2(성기게)·½(촘촘히). 길이 ×2·½(Ctrl+] / Ctrl+[)과 같은 [ ] 자리에 Shift.
  // 숫자 키(격자·MIDI 건반 스텝)·+/−·점 키와 겹치지 않고, Ctrl+Alt+방향키는 윈도우 화면 회전과 겹칠 수 있어 피한다
  "grid.double": ["Shift+]"],
  "grid.half": ["Shift+["],
};

const MMLCE: Bindings = {
  ...COMMON,
  "note.delete": ["Delete", "Backspace"],
  "play.toggle": ["Space"],
  "track.prev": ["PageUp"],
  "track.next": ["PageDown"],
  "view.tab": ["Alt+T"],
  "view.orientation": ["Alt+O"],
  "view.keymap": ["Ctrl+/"],
  // 타브 보기의 +/−와 같게: 고른 음 길이, 고른 음이 없으면 새 음 길이를 ×2 / ½ (Shift를 눌러 치는 +도)
  "edit.lengthDouble": ["Ctrl+]", "=", "Shift+=", "Num+"],
  "edit.lengthHalf": ["Ctrl+[", "-", "Num-"],
  // 숫자 키: 앞쪽은 2의 거듭제곱, 뒤쪽은 셋잇단
  ...grid({ 4: ["1"], 8: ["2"], 16: ["3"], 32: ["4"], 64: ["5"], 12: ["6"], 24: ["7"], 48: ["8"] }),
};

/** 마비꼬에서 쓰던 손에 맞춘 키. 동작만 맞추고 MMLCE에 없는 기능은 비워 둔다 */
const MABIICCO: Bindings = {
  ...COMMON,
  "note.delete": ["Delete"],
  ...grid({
    1: ["1", "Num1"],
    2: ["2", "Num2"],
    4: ["3", "Num3"],
    8: ["4", "Num4"],
    16: ["5", "Num5"],
    32: ["6", "Num6"],
    64: ["7", "Num7"],
    12: ["8", "Num8"],
    24: ["9", "Num9"],
    48: ["0", "Num0"],
  }),
};

export const PRESET_BINDINGS: Readonly<Record<PresetId, Bindings>> = { mmlce: MMLCE, mabiicco: MABIICCO };

export interface KeymapSettings {
  readonly preset: PresetId;
  /** 사용자가 바꾼 명령만. 빈 배열은 "키 없음" */
  readonly overrides: Bindings;
}

export const DEFAULT_SETTINGS: KeymapSettings = { preset: "mmlce", overrides: {} };

export function resolve(settings: KeymapSettings): Bindings {
  return { ...PRESET_BINDINGS[settings.preset], ...settings.overrides };
}

export function keysOf(bindings: Bindings, command: CommandId): readonly string[] {
  return bindings[command] ?? [];
}

export function commandFor(bindings: Bindings, key: string): CommandId | undefined {
  return COMMANDS.find((c) => bindings[c]?.includes(key));
}

/** 키를 명령에 더한다. 그 키를 쓰던 다른 명령에서는 뺀다 */
export function bind(settings: KeymapSettings, command: CommandId, key: string): KeymapSettings {
  const current = resolve(settings);
  const overrides: Partial<Record<CommandId, readonly string[]>> = { ...settings.overrides };
  for (const c of COMMANDS) {
    const keys = keysOf(current, c);
    if (c !== command && keys.includes(key)) overrides[c] = keys.filter((k) => k !== key);
  }
  const mine = keysOf(current, command);
  if (!mine.includes(key)) overrides[command] = [...mine, key];
  return { ...settings, overrides: tidy(settings.preset, overrides) };
}

export function unbind(settings: KeymapSettings, command: CommandId, key: string): KeymapSettings {
  const keys = keysOf(resolve(settings), command).filter((k) => k !== key);
  return { ...settings, overrides: tidy(settings.preset, { ...settings.overrides, [command]: keys }) };
}

/** 키 설정과 같아진 덮어쓰기는 지운다 (키 설정을 바꿔도 따라가도록) */
function tidy(preset: PresetId, overrides: Bindings): Bindings {
  const base = PRESET_BINDINGS[preset];
  const out: Partial<Record<CommandId, readonly string[]>> = {};
  for (const c of COMMANDS) {
    const keys = overrides[c];
    if (keys && !sameKeys(keys, base[c] ?? [])) out[c] = keys;
  }
  return out;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k) => b.includes(k));
}

/** 같은 키가 두 명령에 걸려 있으면 [키, 명령들] */
export function conflicts(bindings: Bindings): [string, CommandId[]][] {
  const seen = new Map<string, CommandId[]>();
  for (const c of COMMANDS) for (const k of keysOf(bindings, c)) seen.set(k, [...(seen.get(k) ?? []), c]);
  return [...seen].filter(([, cs]) => cs.length > 1);
}

/** 저장해 둔 값을 읽는다. 모르는 명령·형식은 버린다 */
export function parseSettings(raw: unknown): KeymapSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const { preset, overrides } = raw as { preset?: unknown; overrides?: unknown };
  const p = PRESETS.includes(preset as PresetId) ? (preset as PresetId) : "mmlce";
  const out: Partial<Record<CommandId, readonly string[]>> = {};
  if (overrides && typeof overrides === "object") {
    for (const [c, keys] of Object.entries(overrides)) {
      if (COMMANDS.includes(c as CommandId) && Array.isArray(keys) && keys.every((k) => typeof k === "string")) {
        out[c as CommandId] = keys;
      }
    }
  }
  return { preset: p, overrides: out };
}

export interface KeyLike {
  readonly code: string;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const NAMED: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Slash: "/",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  NumpadAdd: "Num+",
  NumpadSubtract: "Num-",
  NumpadMultiply: "Num*",
  NumpadDivide: "Num/",
  NumpadDecimal: "Num.",
  NumpadEnter: "Enter",
};

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

/** 키 입력을 키 표기로. 수식 키만 눌렀으면 undefined */
export function keyName(e: KeyLike): string | undefined {
  const code = e.code || e.key;
  if (!code || MODIFIER_CODES.test(code)) return undefined;
  let main = NAMED[code];
  if (!main) {
    const m = /^(?:Key|Digit)(.)$/.exec(code) ?? /^Numpad(\d)$/.exec(code);
    if (m) main = code.startsWith("Numpad") ? `Num${m[1]}` : m[1]!;
    else main = code;
  }
  const mods = [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : ""].filter(Boolean);
  return [...mods, main].join("+");
}

/**
 * 글자를 치는 곳(편집기·입력칸·버튼)에서는 Ctrl·Alt 조합과 F 키, Esc만 단축키로 본다.
 * 그래야 MML을 치거나 버튼을 Space로 누를 때 단축키가 끼어들지 않는다.
 */
export function allowedWhileTyping(key: string): boolean {
  return /^(Ctrl|Alt)\+/.test(key) || /^(Shift\+)?(F\d{1,2}|Escape)$/.test(key);
}

/**
 * Alt+숫자로 넣는 v (EarlGreyPie 배치). 자주 쓰는 v6~15를 숫자 하나로:
 * 6~9 → v6~9, 0 → v10, 1~5 → v11~15. Alt+Shift+숫자는 숫자 그대로(v0~9). v0은 Alt+`로도 (App이 처리).
 * 게임 v 범위 밖이면 undefined
 */
export function volumeForDigit(digit: number, shift: boolean, range: { readonly min: number; readonly max: number }): number | undefined {
  const v = shift ? digit : digit === 0 ? 10 : digit <= 5 ? 10 + digit : digit;
  return v >= range.min && v <= range.max ? v : undefined;
}
