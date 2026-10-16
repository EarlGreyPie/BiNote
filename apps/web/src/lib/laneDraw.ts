import { gridLines, toFloat, volumeBars, type Song } from "@mmlce/core";
import { laneBox, laneValueToScreen, timeToScreen, visibleTime, type RollView } from "./roll";
import type { LaneChanges, LaneItem } from "./volumeLaneEdit";

/** 음량 레인 한 장 그리기 (피아노롤 캔버스 안, 타브 아래 띠가 함께 쓴다) */
export interface LaneDraw {
  /** 레인에 그리는 막대 (고른 트랙 + 여러 트랙 그리기로 고른 트랙) */
  readonly items: readonly LaneItem[];
  /** 끄는 중 미리보기 */
  readonly changes?: LaneChanges | undefined;
  /** 직선 긋는 중: (시작 시간, v) → (끝 시간, v) */
  readonly line?: { readonly t0: number; readonly v0: number; readonly t1: number; readonly v1: number } | undefined;
  /** 읽기 표시: 이 시간 자리에 글자 */
  readonly readout?: { readonly at: number; readonly text: string } | undefined;
  /** 띠 이름 ("음량"). 칸 안 왼쪽 위에 옅게 적어 음 칸과 다른 곳이라는 걸 알린다 */
  readonly label?: string | undefined;
}

export interface LaneDrawContext {
  readonly view: RollView;
  readonly song: Song;
  readonly activeId: string | undefined;
  readonly selected: ReadonlySet<string>;
  readonly colors: ReadonlyMap<string, string> | undefined;
  readonly range: { readonly min: number; readonly max: number };
  readonly css: (name: string) => string;
}

/**
 * 음량 레인: 레인 트랙은 사슬마다 막대(높이 = 첫 음 v. 고른 트랙은 진하게, 같이 그리는 트랙은 옅은 막대 + 머리 선),
 * 나머지 트랙은 같은 자리에 옅은 선만. 건반 띠 모서리까지 바탕을 덮어 음 칸과 다른 띠라는 걸 보이게 한다
 */
export function drawVolumeLane(g: CanvasRenderingContext2D, c: LaneDrawContext, l: LaneDraw): void {
  const v = c.view;
  const horizontal = v.orientation === "horizontal";
  const reserved = v.lane ?? 0;
  if (reserved <= 0) return;
  g.fillStyle = c.css("--bg");
  if (horizontal) g.fillRect(0, v.height - reserved, v.width, reserved);
  else g.fillRect(v.width - reserved, 0, reserved, v.height);
  const box = laneBox(v);
  if (!box) return;
  const vr = c.range;
  const [from, to] = visibleTime(v);
  const line = c.css("--line");
  const accent = c.css("--accent");
  g.fillStyle = c.css("--panel");
  g.fillRect(box.x, box.y, box.w, box.h);
  // 강조색을 옅게 깔고 경계선을 굵게: 음 칸과 다른 "음량 그리는 곳"으로 보이게
  g.fillStyle = accent;
  g.globalAlpha = 0.07;
  g.fillRect(box.x, box.y, box.w, box.h);
  g.globalAlpha = 0.8;
  if (horizontal) g.fillRect(0, box.y, v.width, 2);
  else g.fillRect(box.x, 0, 2, v.height);
  g.globalAlpha = 1;
  g.fillStyle = line;
  // 마디선과 v 가운데 안내선
  for (const gl of gridLines(c.song.timeSig, from, to)) {
    if (gl.kind !== "measure") continue;
    const p = timeToScreen(v, gl.at);
    if (horizontal) g.fillRect(p, box.y, 1, box.h);
    else g.fillRect(box.x, p, box.w, 1);
  }
  g.globalAlpha = 0.5;
  const mid = laneValueToScreen(v, (vr.min + vr.max) / 2, vr);
  if (horizontal) g.fillRect(box.x, mid, box.w, 1);
  else g.fillRect(mid, box.y, 1, box.h);
  g.globalAlpha = 1;
  drawLaneLegend(g, c, l.label, box, horizontal);
  const base = laneValueToScreen(v, vr.min, vr);
  const span = (a: number, b: number) => {
    const p0 = timeToScreen(v, a);
    const p1 = timeToScreen(v, b);
    return [Math.min(p0, p1), Math.abs(p1 - p0)] as const;
  };
  const colorOf = (id: string) => c.colors?.get(id) ?? c.song.tracks.find((t) => t.id === id)?.color ?? "#888";
  const inLane = new Set(l.items.map((it) => it.trackId));
  // 레인 밖 트랙: 막대 머리 높이에 옅은 선 (끈 트랙은 빼고)
  for (const track of c.song.tracks) {
    if (inLane.has(track.id) || track.id === c.activeId || track.mute) continue;
    g.fillStyle = colorOf(track.id);
    g.globalAlpha = 0.5;
    for (const bar of volumeBars(track.notes)) {
      const a = toFloat(bar.start);
      const b = toFloat(bar.end);
      if (b < from || a > to) continue;
      const [p, len] = span(a, b);
      const at = laneValueToScreen(v, bar.vol, vr);
      if (horizontal) g.fillRect(p, at - 1, Math.max(2, len - 1), 2);
      else g.fillRect(at - 1, p, 2, Math.max(2, len - 1));
    }
  }
  g.globalAlpha = 1;
  // 같이 그리는 트랙 먼저, 고른 트랙은 맨 위에
  const items = [...l.items].sort((a, b) => Number(a.trackId === c.activeId) - Number(b.trackId === c.activeId));
  for (const it of items) {
    const a = toFloat(it.bar.start);
    const b = toFloat(it.bar.end);
    if (b < from || a > to) continue;
    const own = it.trackId === c.activeId;
    const [p, len] = span(a, b);
    const vol = l.changes?.get(it.trackId)?.get(it.bar.head.id) ?? it.bar.vol;
    const color = colorOf(it.trackId);
    const top = laneValueToScreen(v, vol, vr);
    // v0도 잡을 수 있게 바닥에 3px 턱을 남기고, 아주 짧은 사슬도 3px 폭으로
    const h = Math.max(3, Math.abs(base - top));
    const w = Math.max(3, len - 1);
    g.fillStyle = color;
    // 고칠 수 없는 막대(잠금, 고른 음 밖)는 옅게
    g.globalAlpha = (own ? 0.85 : 0.3) * (it.editable ? 1 : 0.4);
    if (horizontal) g.fillRect(p, base - h, w, h);
    else g.fillRect(base, p, h, w);
    if (!own) {
      // 같이 그리는 트랙: 머리 선을 또렷이 (막대가 겹쳐도 트랙마다 높이가 보이게)
      g.globalAlpha = it.editable ? 0.95 : 0.4;
      if (horizontal) g.fillRect(p, base - h - 1, w, 2);
      else g.fillRect(base + h - 1, p, 2, w);
    }
    if (own && it.bar.ids.some((id) => c.selected.has(id))) {
      g.globalAlpha = 1;
      g.strokeStyle = c.css("--text");
      g.lineWidth = 1.5;
      if (horizontal) g.strokeRect(p - 1, base - h - 1, w + 2, h + 2);
      else g.strokeRect(base - 1, p - 1, h + 2, w + 2);
    }
  }
  g.globalAlpha = 1;
  if (l.line) {
    // 직선 긋는 중: 누른 자리에서 손까지
    const a = { t: timeToScreen(v, l.line.t0), v: laneValueToScreen(v, l.line.v0, vr) };
    const b = { t: timeToScreen(v, l.line.t1), v: laneValueToScreen(v, l.line.v1, vr) };
    g.strokeStyle = c.css("--accent");
    g.lineWidth = 2;
    g.beginPath();
    if (horizontal) {
      g.moveTo(a.t, a.v);
      g.lineTo(b.t, b.v);
    } else {
      g.moveTo(a.v, a.t);
      g.lineTo(b.v, b.t);
    }
    g.stroke();
  }
  if (l.readout) {
    const p = timeToScreen(v, l.readout.at);
    const font = g.font;
    g.font = 'bold 11px "D2Coding", ui-monospace, monospace';
    g.fillStyle = c.css("--text");
    if (horizontal) g.fillText(l.readout.text, Math.min(p + 6, v.width - 30), box.y + 11);
    else g.fillText(l.readout.text, box.x + 3, Math.max(12, p - 6));
    g.font = font;
  }
}

/** 띠 이름과 v 눈금 (막대 아래에 깔린다). 얇은 띠는 모서리 이름표로 충분해 그리지 않고, 넓으면 맨 위·가운데·맨 아래 v 숫자까지 */
function drawLaneLegend(g: CanvasRenderingContext2D, c: LaneDrawContext, label: string | undefined, box: { x: number; y: number; w: number; h: number }, horizontal: boolean): void {
  const thick = horizontal ? box.h : box.w;
  if (thick < 30) return;
  const vr = c.range;
  g.save();
  g.beginPath();
  g.rect(box.x, box.y, box.w, box.h);
  g.clip();
  g.fillStyle = c.css("--muted");
  g.globalAlpha = 0.85;
  g.font = `bold 11px ${c.css("--ui-font") || "system-ui, sans-serif"}`;
  g.fillText(label ? `${label} (v)` : "v", box.x + 4, box.y + 13);
  if (thick >= 40) {
    g.font = '10px "D2Coding", ui-monospace, monospace';
    const mid = Math.round((vr.min + vr.max) / 2);
    for (const value of [vr.max, mid, vr.min]) {
      const at = laneValueToScreen(c.view, value, vr);
      const text = String(value);
      if (horizontal) {
        const w = g.measureText(text).width;
        g.fillText(text, box.x + box.w - w - 4, Math.min(box.y + box.h - 2, Math.max(box.y + 10, at + 4)));
      } else {
        g.fillText(text, Math.min(box.x + box.w - 14, Math.max(box.x + 2, at - 3)), box.y + box.h - 4);
      }
    }
  }
  g.restore();
}
