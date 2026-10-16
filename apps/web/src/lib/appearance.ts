/** 화면 모양 설정: 테마(밝게·어둡게·시스템), 강조색, 피아노롤 음 모양, MML 편집기 글자 */
export type ThemeMode = "system" | "light" | "dark";

/** 강조색. 밝은 테마와 어두운 테마에서 읽기 좋게 두 가지 색을 짝으로 둔다 */
export const ACCENTS = [
  { id: "blue", light: "#3b6fd8", dark: "#7fb4ff" },
  { id: "purple", light: "#7c4ddb", dark: "#b69bff" },
  { id: "green", light: "#1f9d6b", dark: "#5fd6a2" },
  { id: "orange", light: "#d26a12", dark: "#ffae66" },
  { id: "pink", light: "#d64a8a", dark: "#ff8fc0" },
  { id: "teal", light: "#0f8f9a", dark: "#5ad3dc" },
] as const;
export type AccentId = (typeof ACCENTS)[number]["id"];

/** 피아노롤 음 모양 */
export interface NoteLook {
  /** 모서리를 둥글게 */
  readonly round: boolean;
  /** 테두리 */
  readonly border: boolean;
  /** v(볼륨)가 작을수록 옅게 */
  readonly shade: boolean;
  /** 확대해서 칸이 넉넉하면 음 이름 (o4c) */
  readonly names: boolean;
}

/** MML 편집기 글꼴. 화면 나머지 글꼴(Pretendard GOV)은 그대로 둔다 */
export const EDITOR_FONTS = {
  d2coding: '"D2Coding", ui-monospace, Consolas, monospace',
  /** 기기 고정폭 글꼴 (아이패드·맥 SF Mono, 윈도 Consolas) */
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "D2Coding", monospace',
  /** 화면 글꼴과 같은 Pretendard GOV (폭이 고르지 않지만 크게 보기 편하다) */
  pretendard: "var(--ui-font)",
} as const;
export type EditorFont = keyof typeof EDITOR_FONTS;
/** MML 편집기 글자 크기(px) 고를 수 있는 범위 */
export const EDITOR_FONT_SIZES = [12, 13, 14, 15, 16, 18, 20, 22, 24] as const;

export interface Appearance {
  readonly theme: ThemeMode;
  readonly accent: AccentId;
  readonly note: NoteLook;
  readonly editorFont: EditorFont;
  readonly editorFontSize: number;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  accent: "blue",
  // 기본 음 모양 (EarlGreyPie 선택 B): 둥근 모서리 + 테두리 + 확대 시 음 이름. v 진하기는 설정에서 켠다
  note: { round: true, border: true, shade: false, names: true },
  editorFont: "d2coding",
  editorFontSize: 14,
};

export const APPEARANCE_STORAGE = "mmlce.appearance";

/** 저장된 값을 읽는다. 모르는 값은 기본값으로 */
export function parseAppearance(raw: string | null): Appearance {
  let v: unknown;
  try {
    v = raw ? JSON.parse(raw) : undefined;
  } catch {
    v = undefined;
  }
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const n = (o.note && typeof o.note === "object" ? o.note : {}) as Record<string, unknown>;
  const flag = (k: keyof NoteLook) => (typeof n[k] === "boolean" ? (n[k] as boolean) : DEFAULT_APPEARANCE.note[k]);
  return {
    theme: o.theme === "light" || o.theme === "dark" ? o.theme : "system",
    accent: ACCENTS.some((a) => a.id === o.accent) ? (o.accent as AccentId) : DEFAULT_APPEARANCE.accent,
    note: { round: flag("round"), border: flag("border"), shade: flag("shade"), names: flag("names") },
    editorFont: typeof o.editorFont === "string" && Object.hasOwn(EDITOR_FONTS, o.editorFont) ? (o.editorFont as EditorFont) : DEFAULT_APPEARANCE.editorFont,
    editorFontSize: (EDITOR_FONT_SIZES as readonly unknown[]).includes(o.editorFontSize) ? (o.editorFontSize as number) : DEFAULT_APPEARANCE.editorFontSize,
  };
}

/** 문서에 테마와 강조색을 건다 (CSS가 data-theme와 --accent-light·--accent-dark를 읽는다) */
export function applyAppearance(a: Appearance, root: HTMLElement): void {
  if (a.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = a.theme;
  const accent = ACCENTS.find((x) => x.id === a.accent) ?? ACCENTS[0];
  root.style.setProperty("--accent-light", accent.light);
  root.style.setProperty("--accent-dark", accent.dark);
  // MML 편집기 글자 (mml-highlight의 편집기 테마가 읽는다)
  root.style.setProperty("--mml-font", EDITOR_FONTS[a.editorFont]);
  root.style.setProperty("--mml-font-size", `${a.editorFontSize}px`);
}
