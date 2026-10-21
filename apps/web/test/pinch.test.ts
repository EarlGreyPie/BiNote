import { describe, expect, it } from "vitest";
import { Pinch, pinchRatio } from "../src/lib/pinch";

const touch = (pointerId: number, isPrimary = false) => ({ pointerId, pointerType: "touch", isPrimary }) as PointerEvent;

describe("두 손가락 집기", () => {
  it("두 번째 손가락부터 집기를 시작하고, 모두 뗄 때까지 이어진다", () => {
    const p = new Pinch();
    expect(p.down(touch(1), [100, 100])).toBe(false);
    expect(p.down(touch(2), [200, 100])).toBe(true);
    const f = p.move(touch(2), [300, 100])!;
    expect(f.mid0).toEqual([150, 100]);
    expect(f.mid).toEqual([200, 100]);
    expect(pinchRatio(f.gap0[0], f.gap[0])).toBe(2);
    p.up(touch(2));
    expect(p.active).toBe(true);
    expect(p.move(touch(1), [120, 100])).toBeUndefined();
    p.up(touch(1));
    expect(p.active).toBe(false);
  });

  it("마우스는 집기로 치지 않고, 거의 안 벌린 축은 비율 1", () => {
    const p = new Pinch();
    expect(p.down({ pointerId: 1, pointerType: "mouse" } as PointerEvent, [0, 0])).toBe(false);
    expect(pinchRatio(10, 80)).toBe(1);
  });

  it("떼는 신호를 놓친 손가락이 남아도, 다음 첫 손가락은 집기가 아니라 한 손가락 누르기", () => {
    const p = new Pinch();
    expect(p.down(touch(1, true), [100, 100])).toBe(false);
    // 1번 손가락의 pointerup을 받지 못했다
    expect(p.down(touch(2, true), [200, 100])).toBe(false);
    expect(p.active).toBe(false);
    p.up(touch(2, true));
    expect(p.active).toBe(false);
    // 두 손가락 집기는 그대로 된다
    expect(p.down(touch(3, true), [100, 100])).toBe(false);
    expect(p.down(touch(4), [200, 100])).toBe(true);
  });
});
