/**
 * 두 손가락 터치(아이패드 등) 추적. 손가락 둘이 닿으면 집기(확대·축소) 시작,
 * 그 뒤 손가락을 모두 뗄 때까지는 한 손가락 동작(음 넣기 등)을 하지 않는다.
 */
export interface PinchFrame {
  /** 시작할 때 두 손가락 가운데 (캔버스 좌표) */
  readonly mid0: readonly [number, number];
  readonly mid: readonly [number, number];
  /** 시작할 때와 지금 두 손가락 사이 (x, y 각각 절댓값) */
  readonly gap0: readonly [number, number];
  readonly gap: readonly [number, number];
}

export class Pinch {
  private readonly touches = new Map<number, [number, number]>();
  private start: { mid: [number, number]; gap: [number, number] } | undefined;
  /** 집기를 시작한 뒤 손가락을 모두 뗄 때까지 true */
  active = false;

  /** 터치가 닿음. 두 번째 손가락이면 true (집기 시작) */
  down(e: PointerEvent, at: [number, number]): boolean {
    if (e.pointerType !== "touch") return false;
    this.touches.set(e.pointerId, at);
    if (this.touches.size === 2) {
      this.active = true;
      this.start = this.measure();
      return true;
    }
    return false;
  }

  /** 집는 중이면 지금 모양, 아니면 undefined */
  move(e: PointerEvent, at: [number, number]): PinchFrame | undefined {
    if (!this.touches.has(e.pointerId)) return undefined;
    this.touches.set(e.pointerId, at);
    if (!this.start || this.touches.size !== 2) return undefined;
    const now = this.measure();
    return { mid0: this.start.mid, mid: now.mid, gap0: this.start.gap, gap: now.gap };
  }

  up(e: PointerEvent): void {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.start = undefined;
    if (this.touches.size === 0) this.active = false;
  }

  private measure(): { mid: [number, number]; gap: [number, number] } {
    const [a, b] = [...this.touches.values()] as [[number, number], [number, number]];
    return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], gap: [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])] };
  }
}

/** 집기 비율. 시작할 때 그 방향으로 손가락이 충분히 벌어져 있지 않으면 1 (그 축은 옮기기만) */
export function pinchRatio(gap0: number, gap: number): number {
  return gap0 < 40 ? 1 : gap / gap0;
}
