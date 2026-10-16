import { applyVolumes, rat, toFloat, type Note, type Rat } from "@mmlce/core";
import { laneBarAt, laneValueAt, type RollView } from "./roll";
import { volumeLane } from "./volumeLane.svelte";
import { brushStroke, copyChanges, lineEnd, lineStroke, type LaneChanges, type LaneItem } from "./volumeLaneEdit";
import type { LaneDraw } from "./laneDraw";

type Range = { readonly min: number; readonly max: number };

/** 끄는 중인 레인 획. changes = 트랙 → 사슬 첫 음 id → v (떼면 한 번에 반영) */
interface LaneDrag {
  readonly mode: "brush" | "line";
  readonly changes: LaneChanges;
  /** 붓: 마지막 손 자리. 직선: 누른 자리 */
  readonly t0: number;
  readonly v0: number;
  /** 직선 시작 위치 (분수, 누른 막대 시작이면 그대로) */
  readonly from: Rat;
  readonly t1: number;
  readonly v1: number;
}

/**
 * 음량 레인 손 동작 (피아노롤·타브가 함께 쓴다): 누르기 → 끌기(미리보기) → 떼기(바뀐 트랙 음).
 * 화면 좌표 → 곡 시간은 부르는 쪽이 계산해 넘긴다
 */
export class LaneGesture {
  drag = $state.raw<LaneDrag | undefined>(undefined);
  /** 마우스를 올린 자리의 읽기 표시 */
  hover = $state.raw<{ at: number; text: string } | undefined>(undefined);

  /** 누르기. 바꿀 수 있는 막대가 없으면 false (부르는 쪽이 다른 동작으로 넘긴다) */
  start(view: RollView, x: number, y: number, t: number, items: readonly LaneItem[], range: Range, touch: boolean, line: boolean): boolean {
    if (!items.some((it) => it.editable)) return false;
    const value = laneValueAt(view, x, y, range);
    const offsets = volumeLane.offsets;
    if (line || volumeLane.mode === "line") {
      const from = lineEnd(items, t, view.pxPerWhole, touch);
      const t0 = toFloat(from);
      this.drag = { mode: "line", changes: lineStroke(items, from, from, value, value, offsets, range), t0, v0: value, from, t1: t0, v1: value };
    } else {
      const changes = new Map<string, Map<string, number>>();
      brushStroke(items, changes, t, value, t, value, view.pxPerWhole, touch, offsets, range);
      this.drag = { mode: "brush", changes, t0: t, v0: value, from: rat(0), t1: t, v1: value };
    }
    this.hover = { at: t, text: `v${value}` };
    return true;
  }

  move(view: RollView, x: number, y: number, t: number, items: readonly LaneItem[], range: Range, touch: boolean): void {
    const d = this.drag;
    if (!d) return;
    const value = laneValueAt(view, x, y, range);
    const offsets = volumeLane.offsets;
    if (d.mode === "brush") {
      const changes = copyChanges(d.changes);
      brushStroke(items, changes, d.t0, d.v0, t, value, view.pxPerWhole, touch, offsets, range);
      this.drag = { ...d, changes, t0: t, v0: value, t1: t, v1: value };
    } else {
      const to = lineEnd(items, t, view.pxPerWhole, touch);
      this.drag = { ...d, changes: lineStroke(items, d.from, to, d.v0, value, offsets, range), t1: toFloat(to), v1: value };
    }
    this.hover = { at: t, text: `v${value}` };
  }

  /** 떼기: 실제로 바뀐 트랙만 새 음으로 돌려준다 */
  finish(tracks: readonly { readonly id: string; readonly notes: readonly Note[] }[]): { trackId: string; notes: Note[] }[] {
    const d = this.drag;
    this.drag = undefined;
    if (!d) return [];
    const edits: { trackId: string; notes: Note[] }[] = [];
    for (const [trackId, byHead] of d.changes) {
      const track = tracks.find((t) => t.id === trackId);
      if (!track) continue;
      const next = applyVolumes(track.notes, byHead);
      if (next.some((n, i) => n !== track.notes[i])) edits.push({ trackId, notes: next });
    }
    return edits;
  }

  cancel(): void {
    this.drag = undefined;
  }

  /** 마우스를 올린 자리: 고른 트랙 막대의 실제 v (범위 밖 값도 그대로) */
  hoverAt(t: number, items: readonly LaneItem[], activeId: string | undefined, pxPerWhole: number): void {
    const own = items.filter((it) => it.trackId === activeId).map((it) => ({ start: it.bar.start, end: it.bar.end, vol: it.bar.vol }));
    const hit = laneBarAt(own, t, pxPerWhole, false);
    this.hover = hit ? { at: t, text: `v${hit.vol}` } : undefined;
  }

  /** 그리기에 넘길 것 */
  draw(items: readonly LaneItem[]): LaneDraw {
    const d = this.drag;
    return {
      items,
      changes: d?.changes,
      line: d?.mode === "line" ? { t0: d.t0, v0: d.v0, t1: d.t1, v1: d.v1 } : undefined,
      readout: this.hover,
    };
  }
}
