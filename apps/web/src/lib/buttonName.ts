/**
 * 실험실 "단추 이름 펼치기": 아이콘 단추에 마우스나 떠 있는 펜(애플펜슬 호버·S펜 에어 뷰)을 올리거나
 * 키보드로 오면 단추 곁에 이름표를 띄운다. 터치는 길게 누르면 띄우고, 그때 뒤따르는 누름(click)은 먹는다.
 * 이름표는 앱 맨 바깥(#app)에 fixed로 하나만 띄우므로, 가로 스크롤 도구줄 안 단추여도 잘리지 않고
 * 옆 단추·롤 그림판의 배치는 바뀌지 않는다. 화면 위쪽 단추는 아래에, 아래쪽 단추는 위에 띄운다
 */

/** 길게 누름으로 보는 시간(ms) */
export const LONG_PRESS_MS = 450;
/** 길게 눌러 띄운 이름표를 떼고 나서 남겨 두는 시간(ms) */
const LINGER_MS = 1200;

/** 이 포인터가 "떠 있는" 상태(누르지 않고 올려 둔 것)인지 */
export function isHover(pointerType: string, buttons: number): boolean {
  return pointerType === "mouse" || (pointerType === "pen" && buttons === 0);
}

/** 이름표를 띄운 단추에 붙는 클래스 (모서리 단추 묶음을 또렷하게 하는 데 쓴다) */
const SHOW = "show-name";

export interface ButtonNameOptions {
  /** 쓰는지 (실험실과 설정을 모두 켰을 때) */
  readonly on: boolean;
  /** 이름표 글자. 단축키 설명 없이 짧게 */
  readonly name: string;
}

/** 화면에 하나만 띄우는 이름표와 지금 그 주인 단추 */
let label: HTMLDivElement | undefined;
let owner: HTMLElement | undefined;

/** 이름표를 주인 단추 곁에 둔다. 단추가 화면 아래 절반이면 위에, 아니면 아래에 */
export function labelPosition(
  button: { left: number; right: number; top: number; bottom: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const gap = 6;
  const center = (button.left + button.right) / 2;
  const left = Math.min(Math.max(4, center - size.width / 2), Math.max(4, viewport.width - size.width - 4));
  const above = button.top > viewport.height / 2;
  const top = above ? button.top - size.height - gap : button.bottom + gap;
  return { left, top: Math.max(4, top) };
}

function floatLabel(node: HTMLElement, name: string) {
  if (typeof document === "undefined") return;
  if (!label) {
    label = document.createElement("div");
    label.className = "btn-name-float";
    label.setAttribute("aria-hidden", "true");
  }
  if (!label.isConnected) (document.getElementById("app") ?? document.body).appendChild(label);
  owner = node;
  label.textContent = name;
  const r = node.getBoundingClientRect();
  const at = labelPosition(r, { width: label.offsetWidth, height: label.offsetHeight }, { width: innerWidth, height: innerHeight });
  label.style.left = `${at.left}px`;
  label.style.top = `${at.top}px`;
  label.classList.add("on");
}

function sinkLabel(node: HTMLElement) {
  if (owner !== node || !label) return;
  owner = undefined;
  label.classList.remove("on");
}

export function buttonName(node: HTMLElement, options: ButtonNameOptions) {
  let on = options.on;
  let name = options.name;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let linger: ReturnType<typeof setTimeout> | undefined;
  let swallow = false;

  const show = () => {
    if (!on) return;
    node.classList.add(SHOW);
    floatLabel(node, name);
  };
  const hide = () => {
    node.classList.remove(SHOW);
    sinkLabel(node);
  };
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
  /** 키보드로 왔을 때만 (마우스로 눌러 생긴 초점에는 띄우지 않는다) */
  function focus() {
    if (node.matches(":focus-visible")) show();
  }

  node.addEventListener("pointerenter", enter);
  node.addEventListener("pointerleave", leave);
  node.addEventListener("pointerdown", down);
  node.addEventListener("pointerup", up);
  node.addEventListener("pointercancel", cancel);
  node.addEventListener("click", click, true);
  node.addEventListener("contextmenu", menu);
  node.addEventListener("focus", focus);
  node.addEventListener("blur", hide);
  return {
    update(next: ButtonNameOptions) {
      on = next.on;
      name = next.name;
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
      node.removeEventListener("focus", focus);
      node.removeEventListener("blur", hide);
    },
  };
}
