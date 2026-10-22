/**
 * 실험실 "단추 이름 펼치기": 아이콘 단추에 마우스나 떠 있는 펜(애플펜슬 호버·S펜 에어 뷰)을 올리거나
 * 키보드로 오면 단추 위에 이름표를 띄운다. 터치는 길게 누르면 띄우고, 그때 뒤따르는 누름(click)은 먹는다.
 * 이름표는 단추 위에 겹쳐 뜨므로(absolute) 옆 단추·롤 그림판의 배치는 바뀌지 않는다
 */

/** 길게 누름으로 보는 시간(ms) */
export const LONG_PRESS_MS = 450;
/** 길게 눌러 띄운 이름표를 떼고 나서 남겨 두는 시간(ms) */
const LINGER_MS = 1200;

/** 이 포인터가 "떠 있는" 상태(누르지 않고 올려 둔 것)인지 */
export function isHover(pointerType: string, buttons: number): boolean {
  return pointerType === "mouse" || (pointerType === "pen" && buttons === 0);
}

/** 이름표를 보이는 클래스. 단추 CSS가 .show-name .btn-name을 보이게 한다 */
const SHOW = "show-name";

export function buttonName(node: HTMLElement, enabled: boolean) {
  let on = enabled;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let linger: ReturnType<typeof setTimeout> | undefined;
  let swallow = false;

  const show = () => on && node.classList.add(SHOW);
  const hide = () => node.classList.remove(SHOW);
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  function enter(e: PointerEvent) {
    if (isHover(e.pointerType, e.buttons)) show();
  }
  function leave(e: PointerEvent) {
    if (isHover(e.pointerType, e.buttons)) hide();
  }
  /** 앞 제스처의 상태(타이머·누름 먹기·이름표)를 모두 버린다 */
  function reset() {
    clear();
    swallow = false;
    if (linger) clearTimeout(linger);
    linger = undefined;
    hide();
  }
  function down(e: PointerEvent) {
    // 새 누름은 새 제스처다: 앞에서 click 없이 끝난 길게 누르기가 이 누름을 먹지 않게 한다.
    // 마우스로 누를 때는 올려 둔 이름표를 그대로 둔다
    if (e.pointerType === "touch") reset();
    else {
      clear();
      swallow = false;
    }
    if (!on || e.pointerType !== "touch") return;
    timer = setTimeout(() => {
      timer = undefined;
      swallow = true;
      show();
    }, LONG_PRESS_MS);
  }
  /** 스크롤 등으로 취소된 제스처는 click이 오지 않으므로 바로 정리한다 */
  function cancel() {
    reset();
  }
  function up() {
    clear();
    if (!swallow) return;
    if (linger) clearTimeout(linger);
    linger = setTimeout(hide, LINGER_MS);
  }
  function click(e: MouseEvent) {
    if (!swallow) return;
    swallow = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function menu(e: Event) {
    if (swallow || timer) e.preventDefault();
  }

  node.addEventListener("pointerenter", enter);
  node.addEventListener("pointerleave", leave);
  node.addEventListener("pointerdown", down);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", cancel);
  node.addEventListener("click", click, true);
  node.addEventListener("contextmenu", menu);
  return {
    update(next: boolean) {
      on = next;
      if (!on) reset();
    },
    destroy() {
      reset();
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
      node.removeEventListener("click", click, true);
      node.removeEventListener("contextmenu", menu);
    },
  };
}
