<script lang="ts" module>
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
</script>

<script lang="ts">
  import { defaultKeymap } from "@codemirror/commands";
  import { linter, lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
  import { Compartment, EditorState } from "@codemirror/state";
  import { mmlPad } from "./mmlPad.svelte";
  import { EditorView, keymap } from "@codemirror/view";
  import { onMount, untrack } from "svelte";
  import { mmlHighlight, mmlTheme } from "./mml-highlight";

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
  }

  let { text, diagnostics, onedit, onundo, onredo, reveal, playing, follow = false, owner, readonly = false }: Props = $props();
  // 남은 입력을 닫힐 때 저장하므로 주인은 만들 때 값으로 고정한다
  const ownerAtMount = untrack(() => owner);

  const COMMIT_DELAY_MS = 350;
  /** MML 키판을 켜면 화면 키보드를 띄우지 않는다 */
  const inputMode = new Compartment();
  const inputModeFor = (pad: boolean) => EditorView.contentAttributes.of(pad ? { inputmode: "none" } : {});
  const readOnlyMode = new Compartment();

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
            ...defaultKeymap,
          ]),
          EditorView.lineWrapping,
          mmlHighlight,
          mmlTheme,
          pickedNote,
          playingNote,
          linter(null),
          lintGutter(),
          EditorView.updateListener.of((u) => {
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
    return () => {
      flush();
      flushers.delete(flush);
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
