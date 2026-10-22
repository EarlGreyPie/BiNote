import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buttonName, isHover, LONG_PRESS_MS } from "../src/lib/buttonName";

describe("단추 이름 펼치기: 떠 있는 포인터", () => {
  it("마우스는 늘 떠 있는 것으로 본다", () => {
    expect(isHover("mouse", 0)).toBe(true);
    expect(isHover("mouse", 1)).toBe(true);
  });

  it("펜은 화면에 닿지 않았을 때(호버)만", () => {
    expect(isHover("pen", 0)).toBe(true);
    expect(isHover("pen", 1)).toBe(false);
  });

  it("손가락은 올려 둘 수 없다 (길게 누르기로만)", () => {
    expect(isHover("touch", 0)).toBe(false);
  });
});

/** 테스트용 단추: 이벤트를 받고 클래스만 흉내 낸다 (node 환경에는 DOM이 없다) */
function fakeButton() {
  const target = new EventTarget();
  const classes = new Set<string>();
  const node = Object.assign(target, {
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
  }) as unknown as HTMLElement;
  const fire = (type: string, init: { pointerType?: string; buttons?: number } = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), { pointerType: "touch", buttons: 1, ...init });
    node.dispatchEvent(e);
    return e;
  };
  return { node, classes, fire };
}

describe("단추 이름 펼치기: 길게 누르기", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("길게 누르면 이름표가 뜨고 뒤따르는 누름(click)은 먹는다", () => {
    const { node, classes, fire } = fakeButton();
    buttonName(node, true);
    fire("pointerdown");
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(classes.has("show-name")).toBe(true);
    fire("pointerup");
    expect(fire("click").defaultPrevented).toBe(true);
  });

  it("취소된 길게 누르기(pointercancel)는 다음 정상 탭을 먹지 않는다", () => {
    const { node, classes, fire } = fakeButton();
    buttonName(node, true);
    fire("pointerdown");
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    fire("pointercancel");
    expect(classes.has("show-name")).toBe(false);
    fire("pointerdown");
    fire("pointerup");
    expect(fire("click").defaultPrevented).toBe(false);
  });

  it("click 없이 끝난 길게 누르기 뒤에도 새 누름은 그대로 눌린다", () => {
    const { node, fire } = fakeButton();
    buttonName(node, true);
    fire("pointerdown");
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    fire("pointerup");
    fire("pointerdown");
    fire("pointerup");
    expect(fire("click").defaultPrevented).toBe(false);
  });

  it("누르는 중에 기능을 끄면 타이머가 남아 다음 누름을 먹지 않는다", () => {
    const { node, classes, fire } = fakeButton();
    const action = buttonName(node, true);
    fire("pointerdown");
    action.update(false);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    fire("pointerup");
    expect(classes.has("show-name")).toBe(false);
    expect(fire("click").defaultPrevented).toBe(false);
  });
});
