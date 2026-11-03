import { cursorCharLeft, cursorCharRight, deleteCharBackward } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";

/**
 * MML 키판(터치 기기용). 켜면 편집기를 눌러도 화면 키보드가 뜨지 않고(inputmode=none),
 * 화면 아래 키판으로 MML 글자를 넣는다. 마지막으로 누른 편집기에 들어간다.
 */
class MmlPad {
  enabled = $state(false);
  /** 마지막으로 포커스를 받은 편집기 */
  target: EditorView | undefined = undefined;
  /**
   * 마지막 편집기의 조표 맞춤 글 입력 (키보드로 칠 때와 같은 길: 음 글자에 올림·내림을 붙이고, 바로 뒤에 누른 +·-·#은 붙인 것을 바꾼다).
   * 처리했으면 true. 편집기가 포커스를 받을 때 넣는다
   */
  typed: ((text: string) => boolean) | undefined = undefined;

  insert(text: string): void {
    const view = this.target;
    // 잠근 트랙 편집기에는 넣지 않는다
    if (!view || view.state.readOnly) return;
    if (this.typed?.(text)) return;
    view.dispatch(view.state.replaceSelection(text));
  }

  key(kind: "backspace" | "left" | "right"): void {
    const view = this.target;
    if (!view) return;
    if (kind === "backspace") deleteCharBackward(view);
    else if (kind === "left") cursorCharLeft(view);
    else cursorCharRight(view);
  }
}

export const mmlPad = new MmlPad();

/** 손가락이 주 입력인 기기(아이패드·폰)인지 */
export const coarsePointer = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
