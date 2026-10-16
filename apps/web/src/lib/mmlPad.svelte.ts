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

  insert(text: string): void {
    const view = this.target;
    // 잠근 트랙 편집기에는 넣지 않는다
    if (!view || view.state.readOnly) return;
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
