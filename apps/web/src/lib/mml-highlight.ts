import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/**
 * MML 글자 색. 파서와 같은 규칙으로 토막을 나눠 종류별 class를 붙인다.
 * v·l·t·o처럼 상태를 바꾸는 기호는 눈에 띄게, 음표는 차분하게 칠한다.
 */
const TOKEN = /\/\*[\s\S]*?(?:\*\/|$)|[a-g][+#-]*\d*\.*|n\d*|r\d*\.*|o\d*|[<>]|l\d*\.*|v\d*|t\d*|&/gi;

function kindOf(token: string): string {
  const c = token[0]!.toLowerCase();
  if (c === "/") return "comment";
  if (c === "r") return "rest";
  if (c === "o" || c === "<" || c === ">") return "octave";
  if (c === "l") return "length";
  if (c === "v") return "volume";
  if (c === "t") return "tempo";
  if (c === "&") return "tie";
  return "note";
}

const marks = new Map<string, Decoration>();
function mark(kind: string): Decoration {
  let m = marks.get(kind);
  if (!m) {
    m = Decoration.mark({ class: `mml-${kind}` });
    marks.set(kind, m);
  }
  return m;
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const m of text.matchAll(TOKEN)) {
      const start = from + m.index;
      builder.add(start, start + m[0].length, mark(kindOf(m[0])));
    }
  }
  return builder.finish();
}

export const mmlHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export const mmlTheme = EditorView.theme({
  // 글자 크기·글꼴은 설정(화면 모양)에서 고른다
  "&": { fontSize: "var(--mml-font-size, 14px)", background: "transparent" },
  // 글 커서는 글자색을 따른다 (CodeMirror 기본은 검정이라 어두운 테마에서 안 보인다)
  ".cm-content": { fontFamily: 'var(--mml-font, "D2Coding", ui-monospace, Consolas, monospace)', padding: "4px 0", caretColor: "var(--text)" },
  ".cm-scroller": { maxHeight: "9.5em", overflow: "auto" },
  "&.cm-focused": { outline: "1px solid var(--accent)" },
  // 피아노롤에서 고른 음
  ".cm-playing-note": { background: "color-mix(in srgb, #f2b705 40%, transparent)", borderRadius: "2px", outline: "1px solid #f2b705" },
  ".cm-picked-note": { background: "color-mix(in srgb, var(--accent) 30%, transparent)", borderRadius: "2px" },
  ".mml-note": { color: "var(--text)" },
  ".mml-rest": { color: "var(--muted)" },
  ".mml-octave": { color: "#2bb673", fontWeight: "600" },
  ".mml-length": { color: "#3b82f6", fontWeight: "600" },
  // v·&는 자주 나와서 눈이 덜 피곤한 색으로 (굵게 하지 않음)
  ".mml-volume": { color: "#c9a96e" },
  ".mml-tempo": { color: "var(--ev-tempo)", fontWeight: "600" },
  ".mml-tie": { color: "#8fa9d6" },
  ".mml-comment": { color: "var(--muted)", fontStyle: "italic" },
  // 찾기·바꾸기 칸: CodeMirror 기본은 밝은 회색이라 앱 테마 색을 쓴다
  ".cm-panels": { background: "var(--panel)", color: "var(--text)" },
  ".cm-panels-top": { borderBottom: "1px solid var(--line)" },
  ".cm-textfield": { background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "4px" },
  ".cm-button": { backgroundImage: "none", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: "4px" },
  ".cm-search label": { color: "var(--muted)" },
  ".cm-searchMatch": { background: "color-mix(in srgb, #f2b705 25%, transparent)", outline: "1px solid color-mix(in srgb, #f2b705 60%, transparent)" },
  ".cm-searchMatch-selected": { background: "color-mix(in srgb, var(--accent) 35%, transparent)" },
});
