<script lang="ts" module>
  import { findNext, findPrevious, openSearchPanel } from "@codemirror/search";
  import { Annotation, StateEffect, StateField } from "@codemirror/state";
  import { Decoration, EditorView as View, type DecorationSet } from "@codemirror/view";
  /** 바깥에서 넣은 변경 표시. 이건 다시 명령으로 돌려보내지 않는다 */
  const external = Annotation.define<boolean>();

  /** 피아노롤에서 고른 음의 글 자리 표시. 글을 고치면 같이 움직이고, 빈 범위면 지운다 */
  const markNote = StateEffect.define<{ from: number; to: number } | null>();
  const noteMark = Decoration.mark({ class: "cm-picked-note" });
  const pickedNote = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(marks, tr) {
      marks = marks.map(tr.changes);
      for (const e of tr.effects) {
        if (!e.is(markNote)) continue;
        marks = e.value && e.value.to > e.value.from ? Decoration.set([noteMark.range(e.value.from, e.value.to)]) : Decoration.none;
      }
      return marks;
    },
    provide: (f) => View.decorations.from(f),
  });

  /** 재생 중 지금 울리는 음 표시 (3MLE처럼 글에서 재생 자리를 따라간다) */
  const markPlaying = StateEffect.define<{ from: number; to: number } | null>();
  const playingMark = Decoration.mark({ class: "cm-playing-note" });
  const playingNote = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(marks, tr) {
      marks = marks.map(tr.changes);
      for (const e of tr.effects) {
        if (!e.is(markPlaying)) continue;
        marks = e.value && e.value.to > e.value.from ? Decoration.set([playingMark.range(e.value.from, e.value.to)]) : Decoration.none;
      }
      return marks;
    },
    provide: (f) => View.decorations.from(f),
  });

  const flushers = new Set<() => void>();

  /** 열려 있는 편집기들이 기다리던 입력을 모두 곡에 반영한다 (저장·재생 단축키 전에) */
  export function flushAllEditors(): void {
    for (const flush of flushers) flush();
  }

  /** 열려 있는 편집기와 그 주인 트랙 id (찾기 단축키가 갈 곳) */
  const views = new Map<View, string | undefined>();

  export type EditorSearch = "find" | "replace" | "next" | "prev";

  /**
   * 찾기·바꾸기 단축키(Ctrl+F·Ctrl+H·F3·Shift+F3). 초점이 든 편집기, 없으면 owner(고른 트랙) 편집기에서 한다.
   * 잠근 트랙은 바꾸기 칸이 없어 찾기만 열린다. 열린 편집기가 없으면 false (키를 브라우저에 그대로 넘긴다)
   */
  export function searchEditor(mode: EditorSearch, owner: string | undefined): boolean {
    const active = document.activeElement;
    const list = [...views];
    const view = list.find(([v]) => active && v.dom.contains(active))?.[0] ?? list.find(([, o]) => o === owner)?.[0];
    if (!view) return false;
    if (mode === "next") return findNext(view);
    if (mode === "prev") return findPrevious(view);
    openSearchPanel(view);
    if (mode === "replace") {
      const field = view.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]");
      field?.focus();
      field?.select();
    }
    return true;
  }
</script>

<script lang="ts">
  import { defaultKeymap } from "@codemirror/commands";
  import { linter, lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
  import { closeSearchPanel, search } from "@codemirror/search";
  import { Compartment, EditorState } from "@codemirror/state";
  import { mmlPad } from "./mmlPad.svelte";
  import { EditorView, keymap } from "@codemirror/view";
  import { onMount, untrack } from "svelte";
  import { i18n, t } from "./i18n.svelte";
  import { mmlHighlight, mmlTheme } from "./mml-highlight";
  import { searchPhrases } from "./mmlSearch";

  interface Props {
    text: string;
    diagnostics: readonly Diagnostic[];
    /**
     * 입력이 잠깐 멈추면 부른다. 한 번 부를 때마다 실행 취소 한 칸이 된다.
     * owner는 이 편집기를 만들 때의 owner 값 그대로 (그 사이 부모가 다른 트랙으로 바뀌어도 원래 주인에게 저장)
     */
    onedit: (text: string, owner: string | undefined) => void;
    /** 이 편집기 글의 주인 (트랙 id). 만들 때 한 번만 읽는다 */
    owner?: string | undefined;
    onundo: () => void;
    onredo: () => void;
    /** 피아노롤에서 고른 음의 글 자리. 그 자리를 표시하고 커서를 옮긴다. focus면 바로 입력할 수 있게 편집기로 간다 */
    reveal?: { readonly from: number; readonly to: number; readonly focus: boolean; readonly nonce: number } | undefined;
    /** 재생 중 지금 울리는 음의 글 자리 */
    playing?: readonly [number, number] | undefined;
    /** 재생 자리가 보이게 스크롤을 따라갈지 */
    follow?: boolean;
    /** 잠근 트랙: 글을 고칠 수 없다 (고르기·복사는 된다) */
    readonly?: boolean;
    /**
     * 사용자가 글 커서를 옮기면 그 글 자리 (누르기·방향키·찾기). 글을 치는 중이거나 아직 곡에 반영 안 된 글이면 부르지 않는다.
     * 롤에서 고른 음으로 커서가 옮겨 간 것(reveal)과 실행 취소로 바뀐 글은 알리지 않는다 (서로 되부르지 않게)
     */
    oncursor?: ((pos: number, owner: string | undefined) => void) | undefined;
  }

  let { text, diagnostics, onedit, onundo, onredo, reveal, playing, follow = false, owner, readonly = false, oncursor }: Props = $props();
  // 남은 입력을 닫힐 때 저장하므로 주인은 만들 때 값으로 고정한다
  const ownerAtMount = untrack(() => owner);

  const COMMIT_DELAY_MS = 350;
  /** MML 키판을 켜면 화면 키보드를 띄우지 않는다 */
  const inputMode = new Compartment();
  const inputModeFor = (pad: boolean) => EditorView.contentAttributes.of(pad ? { inputmode: "none" } : {});
  const readOnlyMode = new Compartment();
  /** 찾기 칸 문구 (CodeMirror 영어 문구를 화면 언어로). 언어를 바꾸면 다시 넣는다 */
  const phrases = new Compartment();
  const phrasesNow = () => EditorState.phrases.of(searchPhrases(t));

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** 기다리던 입력을 바로 반영한다 (실행 취소 전, 포커스를 잃을 때) */
  function flush() {
    if (timer === undefined || !view) return;
    clearTimeout(timer);
    timer = undefined;
    onedit(view.state.doc.toString(), ownerAtMount);
  }

  onMount(() => {
    flushers.add(flush);
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        extensions: [
          // 실행 취소는 편집기 하나가 아니라 곡 전체 기록으로 간다 (피아노롤과 같은 스택)
          keymap.of([
            { key: "Mod-z", run: () => (flush(), onundo(), true) },
            { key: "Mod-y", run: () => (flush(), onredo(), true) },
            { key: "Mod-Shift-z", run: () => (flush(), onredo(), true) },
            // 찾기 칸은 Esc로 닫는다 (닫혀 있으면 Esc는 앱의 재생 멈춤으로 간다). Ctrl+F·H·F3은 앱 단축키(keymap.ts)가 searchEditor로 연다
            { key: "Escape", run: closeSearchPanel, scope: "editor search-panel" },
            ...defaultKeymap,
          ]),
          // 바꾸기는 글 고치기와 같아서, 잠깐 멈춘 뒤 실행 취소 한 칸으로 곡에 들어간다 (모두 바꾸기도 한 칸)
          search({ top: true }),
          phrases.of(phrasesNow()),
          EditorView.lineWrapping,
          mmlHighlight,
          mmlTheme,
          pickedNote,
          playingNote,
          linter(null),
          lintGutter(),
          EditorView.updateListener.of((u) => {
            // 글을 고치지 않고 커서만 옮겼으면 알린다. 곡에 반영 안 된 글이면 글 자리가 곡과 어긋나므로 알리지 않는다
            if (u.selectionSet && !u.docChanged && timer === undefined && oncursor && !u.transactions.some((tr) => tr.annotation(external))) {
              if (u.state.doc.toString() === text) oncursor(u.state.selection.main.head, ownerAtMount);
            }
            if (!u.docChanged || u.transactions.every((tr) => tr.annotation(external))) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
              timer = undefined;
              onedit(u.state.doc.toString(), ownerAtMount);
            }, COMMIT_DELAY_MS);
          }),
          EditorView.domEventHandlers({
            blur: () => flush(),
            focus: (_e, v) => {
              mmlPad.target = v;
            },
            pointerdown: (_e, v) => {
              mmlPad.target = v;
            },
          }),
          inputMode.of(inputModeFor(mmlPad.enabled)),
          readOnlyMode.of(EditorState.readOnly.of(untrack(() => readonly))),
        ],
      }),
    });
    views.set(view, ownerAtMount);
    return () => {
      flush();
      flushers.delete(flush);
      if (view) views.delete(view);
      if (mmlPad.target === view) mmlPad.target = undefined;
      view?.destroy();
    };
  });

  // 재생 자리 표시. 입력 중(포커스)에는 스크롤을 건드리지 않는다
  $effect(() => {
    const at = playing;
    if (!view) return;
    if (!at) {
      if (view.state.field(playingNote).size > 0) view.dispatch({ effects: markPlaying.of(null) });
      return;
    }
    const length = view.state.doc.length;
    const from = Math.min(at[0], length);
    const to = Math.min(at[1], length);
    const effects = [markPlaying.of({ from, to })];
    view.dispatch({ effects: follow && !view.hasFocus ? [...effects, View.scrollIntoView(from, { y: "nearest", yMargin: 24 })] : effects });
  });

  $effect(() => {
    const ro = readonly;
    view?.dispatch({ effects: readOnlyMode.reconfigure(EditorState.readOnly.of(ro)) });
  });

  $effect(() => {
    void i18n.locale;
    view?.dispatch({ effects: phrases.reconfigure(phrasesNow()) });
  });

  $effect(() => {
    const pad = mmlPad.enabled;
    view?.dispatch({ effects: inputMode.reconfigure(inputModeFor(pad)) });
  });

  // 실행 취소 등으로 바깥에서 글이 바뀌면 편집기에 넣는다. 입력 중인 글은 덮지 않는다
  $effect(() => {
    const next = text;
    if (!view || timer !== undefined || view.state.doc.toString() === next) return;
    const head = Math.min(view.state.selection.main.head, next.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: head },
      annotations: external.of(true),
    });
  });

  $effect(() => {
    const at = reveal;
    if (!view) return;
    if (!at) {
      // 다른 트랙의 음을 골랐으면 이 편집기의 표시는 지운다
      if (view.state.field(pickedNote).size > 0) view.dispatch({ effects: markNote.of(null) });
      return;
    }
    const length = view.state.doc.length;
    const from = Math.min(at.from, length);
    const to = Math.min(at.to, length);
    view.dispatch({
      selection: { anchor: from },
      effects: [markNote.of({ from, to }), View.scrollIntoView(from, { y: "nearest" })],
      // 롤에서 고른 음을 보여 주는 것이라 다시 롤로 알리지 않는다
      annotations: external.of(true),
    });
    if (at.focus) view.focus();
  });

  $effect(() => {
    const list = diagnostics;
    if (!view) return;
    const length = view.state.doc.length;
    view.dispatch(
      setDiagnostics(
        view.state,
        list.filter((d) => d.from <= length).map((d) => ({ ...d, to: Math.min(d.to, length) })),
      ),
    );
  });
</script>

<div class="mml-editor" bind:this={host}></div>
