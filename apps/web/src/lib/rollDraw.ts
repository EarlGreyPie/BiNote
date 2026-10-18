import { DEFAULT_APPEARANCE, type NoteLook } from "./appearance";
import { chainVolumes } from "./scores";
import { drawVolumeLane, type LaneDraw } from "./laneDraw";
import { peakRange, wholeToSecondsFn, type Peaks } from "./waveform";
import { trackSoundingRange, type CanonicalOf } from "./instrumentRange";
import {
  add,
  cmp,
  foldPitch,
  gridLines,
  MOBILE_PROFILE,
  PROFILES,
  toFloat,
  type Note,
  type Song,
} from "@mmlce/core";
import {
  BAR_ROW,
  BLACK_KEY_LENGTH,
  EVENT_ROW,
  eventLabels,
  isBlackKey,
  noteRect,
  octaveOf,
  timeToScreen,
  visiblePitch,
  visibleTime,
  whiteKeyEdges,
  sameEvent,
  type EventLabel,
  type EventRef,
  type RollView,
} from "./roll";

/** 피아노롤 한 장을 그릴 때 필요한 것 (PianoRoll.svelte가 넘긴다) */
export interface RollDrawOptions {
  readonly view: RollView;
  readonly song: Song;
  readonly activeId: string | undefined;
  /** 끌고 있는 음들 (원래 자리 대신 끄는 자리에 그린다) */
  readonly dragNotes: readonly Note[];
  readonly selected: ReadonlySet<string>;
  /** Ctrl+끌기 고르기 상자 (시간·높이) */
  readonly box: { readonly t0: number; readonly p0: number; readonly t1: number; readonly p1: number } | undefined;
  readonly head: number | undefined;
  readonly division: number;
  /** 배경 영상이 있으면 바탕을 비운다 */
  readonly overVideo: boolean;
  readonly cursorAt: number | undefined;
  readonly range: readonly [number, number] | undefined;
  readonly colors: ReadonlyMap<string, string> | undefined;
  /** 마디 번호 줄 두께 */
  readonly ruler: number;
  readonly showEvents: boolean;
  /** 파형 띠에서 끄는 마디선: 원래 자리와 놓을 자리(온음표 단위) */
  readonly barDrag?: { readonly bar: number; readonly to: number } | undefined;
  /** 끌어서 옮기는 중인 이벤트 라벨과 갈 자리(온음표 단위) */
  readonly eventDrag?: { readonly label: EventLabel; readonly to: number } | undefined;
  /** 고른 이벤트 라벨 (휠로 템포 바꾸기·Del로 지우기) */
  readonly pickedEvent?: EventRef | undefined;
  /** 음 모양 (둥근 모서리·테두리·v 진하기·음 이름) */
  readonly look?: NoteLook | undefined;
  /**
   * 원곡 파형 띠: 마디 줄 안 [at, at + size) 자리에 그린다. offset = 원곡 어긋남(초, 원곡이 늦으면 양수):
   * 곡 시간 s초에 원곡 s + offset초가 들린다
   */
  readonly wave?: { readonly peaks: Peaks; readonly offset: number; readonly at: number; readonly size: number } | undefined;
  /** 음량 레인 (view.lane이 있을 때 그린다) */
  readonly lane?: LaneDraw | undefined;
  /** 재생 중 지금 울리는 음의 건반에 트랙 색 불 켜기 */
  readonly lightKeys?: boolean;
  /** 번호로만 아는 악기의 실제 악기 (접힘 표식을 재생과 같은 음역으로) */
  readonly canonicalOf?: CanonicalOf | undefined;
  /** CSS 변수 값 (테마 색) */
  readonly css: (name: string) => string;
}

/** 음량 레인 그리기 */
const NOTE_NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];
/** MML 이름 (o4c = 60). octave를 빼면 c+만 */
function noteName(pitch: number, octave: boolean): string {
  const name = NOTE_NAMES[((pitch % 12) + 12) % 12]!;
  return octave ? `o${Math.floor(pitch / 12) - 1}${name}` : name;
}

/** 격자·마디선·음·이음 선·건반 띠·마디 줄·이벤트·커서·재생선을 그린다 */
export function drawRoll(canvas: HTMLCanvasElement, o: RollDrawOptions): void {
  const v = o.view;
  const s = o.song;
  const activeId = o.activeId;
  const selected = o.selected;
  const head = o.head;
  const div = o.division;
  const overVideo = o.overVideo;
  const cursorAt = o.cursorAt;
  const range = o.range;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = v.width * ratio;
  canvas.height = v.height * ratio;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  const bg = o.css("--panel");
  const line = o.css("--line");
  // 배경 영상이 있으면 바탕을 비워 영상이 비치게 한다
  if (overVideo) g.clearRect(0, 0, v.width, v.height);
  else {
    g.fillStyle = bg;
    g.fillRect(0, 0, v.width, v.height);
  }

  const horizontal = v.orientation === "horizontal";
  const [low, high] = visiblePitch(v);
  const [from, to] = visibleTime(v);

  // 검은건반 줄은 살짝 어둡게, 도(C) 줄에는 선
  for (let p = low; p <= high; p++) {
    const r = noteRect(v, from, to - from, p);
    if (isBlackKey(p)) {
      g.fillStyle = "rgba(127,127,127,0.10)";
      g.fillRect(r.x, r.y, r.w, r.h);
    }
    if (p % 12 === 0) {
      g.fillStyle = line;
      if (horizontal) g.fillRect(r.x, r.y + r.h - 1, r.w, 1);
      else g.fillRect(r.x, r.y, 1, r.h);
    }
  }

  // 격자·박·마디선 (박자표를 따르고, 곡 중간 박자 바뀜도 그 자리부터)
  const step = 1 / div;
  const drawTimeLine = (t: number, color: string, w: number) => {
    const p = timeToScreen(v, t);
    g.fillStyle = color;
    if (horizontal) g.fillRect(p, 0, w, v.height);
    else g.fillRect(0, p, v.width, w);
  };
  if (step * v.pxPerWhole >= 6) {
    for (let t = Math.ceil(from / step) * step; t < to; t += step) drawTimeLine(t, "rgba(127,127,127,0.12)", 1);
  }
  g.font = '10px "D2Coding", ui-monospace, monospace';
  for (const gl of gridLines(s.timeSig, from, to)) {
    if (gl.kind === "unit") drawTimeLine(gl.at, "rgba(127,127,127,0.18)", 1);
    else if (gl.kind === "beat") drawTimeLine(gl.at, "rgba(127,127,127,0.32)", 1);
    else drawTimeLine(gl.at, line, 2);
  }

  // 음: 고르는 트랙은 진하게(맨 위), 다른 트랙은 채움만 옅게 하고 테두리는 남긴다.
  // 끈 트랙은 사선, v0(이음 사슬은 첫 음 v)은 테두리만, 악기 범위 밖이라 접혀 나는 음은 트랙 색 위에 회색 사선
  const profile = PROFILES[s.meta.profileId] ?? MOBILE_PROFILE;
  // 접힘 표식은 회색 사선. 어두운 바탕에서도 보이게 글자 보조색(--muted)으로 긋는다
  const folded = o.css("--muted");
  const look = o.look ?? DEFAULT_APPEARANCE.note;
  // 이름 글자는 음 색 위에서 읽히게 흰 글자 + 어두운 그림자
  const noteText = "#fff";
  /** 사선 무늬: 색마다 한 번 만든다 */
  const hatches = new Map<string, CanvasPattern | null>();
  const hatch = (color: string): CanvasPattern | null => {
    if (!hatches.has(color)) {
      const tile = document.createElement("canvas");
      tile.width = tile.height = 6;
      const c = tile.getContext("2d");
      if (c) {
        c.strokeStyle = color;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(-1, 7);
        c.lineTo(7, -1);
        c.moveTo(-1, 1);
        c.lineTo(1, -1);
        c.moveTo(5, 7);
        c.lineTo(7, 5);
        c.stroke();
      }
      hatches.set(color, c ? g.createPattern(tile, "repeat") : null);
    }
    return hatches.get(color) ?? null;
  };
  const tracks = [...s.tracks].sort((a, b) => Number(a.id === activeId) - Number(b.id === activeId));
  for (const track of tracks) {
    const range = trackSoundingRange(profile, s, track, o.canonicalOf);
    const isActive = track.id === activeId;
    let notes: readonly Note[] = track.notes;
    if (isActive && o.dragNotes.length > 0) {
      const dragged = new Set(o.dragNotes.map((n) => n.id));
      notes = [...notes.filter((n) => !dragged.has(n.id)), ...o.dragNotes];
    }
    const color = o.colors?.get(track.id) ?? track.color;
    const vols = chainVolumes(notes);
    // 채움 농도와 테두리 농도를 따로: 다른 트랙도 테두리는 또렷하게 남겨 겹친 음을 셀 수 있게
    const fillAlpha = track.mute ? 0 : isActive ? 0.95 : 0.28;
    const edgeAlpha = track.mute ? 0.45 : isActive ? 1 : 0.7;
    for (const n of notes) {
      const st = toFloat(n.start);
      const du = toFloat(n.dur);
      if (st > to || st + du < from || n.pitch < low || n.pitch > high) continue;
      const r = noteRect(v, st, du, n.pitch);
      const vol = vols.get(n.id) ?? n.vol;
      const silent = vol <= 0;
      const box = { x: r.x + 0.5, y: r.y + 0.5, w: Math.max(2, r.w - 1), h: Math.max(2, r.h - 1) };
      const radius = look.round ? Math.min(2, box.w / 3, box.h / 3) : 0;
      const shape = (inset: number) => {
        g.beginPath();
        if (radius > 0.5) g.roundRect(box.x + inset, box.y + inset, box.w - 2 * inset, box.h - 2 * inset, Math.max(0, radius - inset / 2));
        else g.rect(box.x + inset, box.y + inset, box.w - 2 * inset, box.h - 2 * inset);
      };
      // 채움 (v0은 채우지 않는다). v 진하기: v가 클수록 진하게, 작아도 바닥은 남긴다
      if (!silent && fillAlpha > 0) {
        g.globalAlpha = look.shade ? fillAlpha * (0.3 + 0.7 * Math.min(1, vol / profile.volume.max)) : fillAlpha;
        g.fillStyle = color;
        shape(0);
        g.fill();
      }
      // 끈 트랙: 트랙 색 사선
      if (track.mute) {
        const p = hatch(color);
        if (p) {
          g.globalAlpha = 0.4;
          g.fillStyle = p;
          shape(0);
          g.fill();
        }
      }
      // 접혀 나는 음: 트랙 색은 두고 회색 사선을 덮는다
      if (foldPitch(n.pitch, range) !== n.pitch) {
        const p = hatch(folded);
        if (p) {
          g.globalAlpha = isActive ? 0.95 : 0.75;
          g.fillStyle = p;
          shape(0);
          g.fill();
        }
      }
      // 테두리: 고르는 트랙은 "테두리" 모양을 켰을 때만 어두운 선, 다른 트랙·v0·끈 트랙은 늘 트랙 색 선
      const ownEdge = isActive && !silent && !track.mute;
      if (!ownEdge || look.border) {
        g.globalAlpha = edgeAlpha;
        g.strokeStyle = ownEdge ? "rgba(0,0,0,0.45)" : color;
        g.lineWidth = silent && isActive ? 1.5 : 1;
        // 끈 트랙은 점선 테두리 (접힌 음의 회색 사선과 헷갈리지 않게)
        if (track.mute) g.setLineDash([3, 2]);
        shape(0.5);
        g.stroke();
        g.setLineDash([]);
      }
      g.globalAlpha = 1;
      // 음 이름: 칸이 넉넉할 때만 (가로 롤은 칸 높이, 세로 롤은 칸 폭을 본다)
      if (look.names && isActive && (horizontal ? r.h >= 11 && r.w >= 26 : r.w >= 22 && r.h >= 12)) {
        const label = noteName(n.pitch, horizontal ? r.w >= 34 : r.w >= 30);
        g.fillStyle = silent ? color : noteText;
        if (horizontal) g.fillText(label, r.x + 3, r.y + r.h / 2 + 3.5);
        else g.fillText(label, r.x + 2, r.y + r.h - 3);
      }
      // 고른 음: 음 색은 그대로 두고, 음 밖으로 2px 띄운 얇은 둥근 고리 (글자색이라 어느 트랙 색에서나 보인다)
      if (isActive && selected.has(n.id)) {
        const pad = 2;
        g.lineWidth = 1.5;
        g.strokeStyle = o.css("--text");
        g.beginPath();
        g.roundRect(box.x - pad, box.y - pad, box.w + 2 * pad, box.h + 2 * pad, Math.max(radius, 2) + pad);
        g.stroke();
      }
    }
    g.globalAlpha = isActive ? 0.95 : track.mute ? 0.3 : 0.5;
    // &로 이은 음: 앞 음 끝 가운데에서 뒤 음 시작 가운데로 선을 긋는다 (다른 음이면 비스듬히 = 슬라이딩)
    const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
    g.strokeStyle = o.css("--text");
    g.lineWidth = isActive ? 2 : 1;
    sorted.forEach((n, i) => {
      const next = sorted[i + 1];
      if (n.tie !== "next" || !next || cmp(add(n.start, n.dur), next.start) !== 0) return;
      const at = toFloat(next.start);
      if (at < from || at > to) return;
      const a = noteRect(v, toFloat(n.start), toFloat(n.dur), n.pitch);
      const b = noteRect(v, at, toFloat(next.dur), next.pitch);
      const half = Math.min(6, (horizontal ? a.w : a.h) / 2);
      g.beginPath();
      if (horizontal) {
        g.moveTo(a.x + a.w - half, a.y + a.h / 2);
        g.lineTo(b.x + Math.min(6, b.w / 2), b.y + b.h / 2);
      } else {
        g.moveTo(a.x + a.w / 2, a.y + half);
        g.lineTo(b.x + b.w / 2, b.y + b.h - Math.min(6, b.h / 2));
      }
      g.stroke();
    });
  }
  g.globalAlpha = 1;

  /** 원곡 파형 띠: 시간 축 한 픽셀마다 그 사이 원곡의 가장 낮은·높은 값을 막대로 */
  function drawWave(c: CanvasRenderingContext2D, w: NonNullable<RollDrawOptions["wave"]>) {
    const seconds = wholeToSecondsFn(s.tempo);
    const axis = horizontal ? v.width - v.keyboard : v.height - v.keyboard;
    const mid = w.at + w.size / 2;
    // 원곡에서 가장 큰 소리가 띠 끝에 닿게 (조용하게 녹음한 원곡도 보이게)
    const half = (w.size / 2 - 1) / Math.max(1e-3, w.peaks.peak);
    c.fillStyle = o.css("--line");
    if (horizontal) c.fillRect(v.keyboard, w.at + w.size - 1, axis, 1);
    else c.fillRect(w.at + w.size - 1, 0, 1, axis);
    c.fillStyle = o.css("--accent");
    c.globalAlpha = 0.75;
    for (let px = 0; px < axis; px++) {
      const t0 = v.start + px / v.pxPerWhole;
      const r = peakRange(w.peaks, seconds(t0) + w.offset, seconds(t0 + 1 / v.pxPerWhole) + w.offset);
      if (!r) continue;
      const a = mid - r[1] * half;
      const len = Math.max(1, (r[1] - r[0]) * half);
      // 가로 롤은 시간이 오른쪽, 세로 롤은 위로 흐른다
      if (horizontal) c.fillRect(v.keyboard + px, a, 1, len);
      else c.fillRect(a, v.height - v.keyboard - px - 1, len, 1);
    }
    // 내 곡 음이 시작하는 자리를 띠 아래쪽 눈금으로 (원곡 박과 한 줄에서 견주게). 들리는 트랙만, 여러 음이 같이 시작하면 길게
    const solo = s.tracks.some((t) => t.solo);
    const starts = new Map<number, number>();
    for (const t of s.tracks) {
      if (t.mute || (solo && !t.solo)) continue;
      for (const n of t.notes) {
        const at = toFloat(n.start);
        if (at >= from && at <= to) starts.set(at, (starts.get(at) ?? 0) + 1);
      }
    }
    c.fillStyle = o.css("--text");
    c.globalAlpha = 0.6;
    for (const [at, count] of starts) {
      const p = timeToScreen(v, at);
      const len = count >= 3 ? 9 : 6;
      if (horizontal) c.fillRect(p, w.at + w.size - 1 - len, 1, len);
      else c.fillRect(w.at + w.size - 1 - len, p, len, 1);
    }
    c.globalAlpha = 1;
  }

  // 마디 번호 줄 (누르면 그 자리로). 이벤트를 켜면 그 아래에 템포·박자·마커
  const ruler = o.ruler;
  // 음 위에 불투명하게 덮어, 음을 찍는 칸이 아니라는 걸 보이게 한다 (아래 경계선 + 마디 눈금)
  g.fillStyle = o.css("--bg");
  if (horizontal) g.fillRect(v.keyboard, 0, v.width - v.keyboard, ruler);
  else g.fillRect(0, 0, ruler, v.height - v.keyboard);
  g.fillStyle = line;
  if (horizontal) g.fillRect(v.keyboard, ruler - 1, v.width - v.keyboard, 1);
  else g.fillRect(ruler - 1, 0, 1, v.height - v.keyboard);
  for (const gl of gridLines(s.timeSig, from, to)) {
    if (gl.kind !== "measure") continue;
    const p = timeToScreen(v, gl.at);
    g.fillStyle = line;
    if (horizontal) g.fillRect(p, 0, 1, ruler);
    else g.fillRect(0, p, ruler, 1);
    g.fillStyle = o.css("--muted");
    if (horizontal) g.fillText(String(gl.bar), p + 3, 10);
    else g.fillText(String(gl.bar), 3, p - 3);
  }
  if (o.wave) drawWave(g, o.wave);
  if (o.barDrag) {
    // 마디선을 끄는 중: 원래 마디선(흐리게)에서 놓을 자리(진하게)까지
    const a = timeToScreen(v, o.barDrag.bar);
    const b = timeToScreen(v, o.barDrag.to);
    g.fillStyle = o.css("--accent");
    g.globalAlpha = 0.25;
    if (horizontal) g.fillRect(Math.min(a, b), 0, Math.abs(b - a), v.height);
    else g.fillRect(0, Math.min(a, b), v.width, Math.abs(b - a));
    g.globalAlpha = 1;
    if (horizontal) g.fillRect(b - 1, 0, 2, v.height);
    else g.fillRect(0, b - 1, v.width, 2);
  }
  if (o.showEvents) {
    const colorOf = { tempo: o.css("--ev-tempo"), meter: o.css("--ev-meter"), marker: o.css("--ev-marker") };
    const dragged = o.eventDrag?.label;
    const labels = eventLabels(v, s).filter((l) => {
      const at = toFloat(l.at);
      return at >= from && at < to;
    });
    // 이벤트 줄 칸 경계 (가로 롤만 칸이 나뉜다)
    g.fillStyle = line;
    if (horizontal) g.fillRect(v.keyboard, BAR_ROW + EVENT_ROW, v.width - v.keyboard, 1);
    const drawLabel = (l: EventLabel, p: number, dashed: boolean) => {
      const color = colorOf[l.kind];
      // 바뀌는 자리를 롤 전체에 점선으로
      g.strokeStyle = color;
      g.lineWidth = dashed ? 2 : 1;
      // 롤 전체를 가로지르는 선은 옅게 (글자만 또렷이)
      const alpha = g.globalAlpha;
      if (!dashed) g.globalAlpha = alpha * 0.5;
      g.setLineDash([3, 3]);
      g.beginPath();
      if (horizontal) {
        g.moveTo(p + 0.5, l.y);
        g.lineTo(p + 0.5, v.height);
      } else {
        g.moveTo(ruler, p + 0.5);
        g.lineTo(v.width, p + 0.5);
      }
      g.stroke();
      g.globalAlpha = alpha;
      g.setLineDash([]);
      if (!dashed && sameEvent(l, o.pickedEvent)) {
        // 고른 라벨: 바탕을 칠하고 테두리를 둘러 보인다
        const top = horizontal ? l.y : p + (l.y - timeToScreen(v, toFloat(l.at)));
        const left = horizontal ? p : l.x;
        g.fillStyle = color;
        g.globalAlpha = 0.22;
        g.fillRect(left, top + 1, l.w + 4, EVENT_ROW - 2);
        g.globalAlpha = 1;
        g.lineWidth = 1;
        g.strokeRect(left + 0.5, top + 1.5, l.w + 3, EVENT_ROW - 3);
      }
      g.fillStyle = color;
      if (horizontal) g.fillText(l.text, p + 3, l.y + 11);
      else g.fillText(l.text, l.x + 1, p + (l.y - timeToScreen(v, toFloat(l.at))) + 11);
    };
    // 라벨 글자는 조금 크고 굵게 (작은 글자에 옅은 색이면 안 읽힌다)
    const font = g.font;
    g.font = 'bold 11px "D2Coding", ui-monospace, monospace';
    for (const l of labels) {
      const moving = dragged && dragged.kind === l.kind && cmp(dragged.at, l.at) === 0 && dragged.id === l.id;
      if (moving) g.globalAlpha = 0.35;
      drawLabel(l, timeToScreen(v, toFloat(l.at)), false);
      g.globalAlpha = 1;
    }
    if (o.eventDrag) drawLabel(o.eventDrag.label, timeToScreen(v, o.eventDrag.to), true);
    g.font = font;
  }

  // 건반 띠: 실제 피아노처럼 흰건반은 넓게, 검은건반은 짧고 좁게 (롤 쪽에 붙임). 음 칸은 반음마다 같다
  const k = v.pxPerKey;
  const along = (u: number) => (horizontal ? (v.edgePitch + 1 - u) * k : (u - v.edgePitch) * k);
  const strip = horizontal ? { x: 0, y: 0, w: v.keyboard, h: v.height } : { x: 0, y: v.height - v.keyboard, w: v.width, h: v.keyboard };
  g.fillStyle = "#f4f5f7";
  g.fillRect(strip.x, strip.y, strip.w, strip.h);
  // 재생 중 울리는 건반: 높이 → 트랙 색 (음소거 트랙 제외)
  const lit = new Map<number, string>();
  if (o.lightKeys && head !== undefined) {
    // 솔로가 있으면 솔로 트랙만, 끄기 트랙과 v0 음은 빼고 (실제로 들리는 음만)
    const solo = s.tracks.some((tr) => tr.solo);
    for (const track of s.tracks) {
      if (track.mute || (solo && !track.solo)) continue;
      for (const n of track.notes) {
        const st = toFloat(n.start);
        if (n.vol > 0 && st <= head && head < st + toFloat(n.dur)) lit.set(n.pitch, o.colors?.get(track.id) ?? track.color);
      }
    }
  }
  for (const [p, color] of lit) {
    if (isBlackKey(p) || p < low - 1 || p > high + 1) continue;
    // 흰건반 칸: 옆이 검은건반이면 그 반 칸까지
    const a = along(isBlackKey(p - 1) ? p - 0.5 : p);
    const b = along(isBlackKey(p + 1) ? p + 1.5 : p + 1);
    g.fillStyle = color;
    if (horizontal) g.fillRect(0, Math.min(a, b), v.keyboard, Math.abs(b - a));
    else g.fillRect(Math.min(a, b), strip.y, Math.abs(b - a), v.keyboard);
  }
  g.fillStyle = "#b9bec7";
  for (const u of whiteKeyEdges(low - 1, high)) {
    const a = along(u);
    if (horizontal) g.fillRect(0, a, v.keyboard, 1);
    else g.fillRect(a, strip.y, 1, v.keyboard);
  }
  const blackLen = v.keyboard * BLACK_KEY_LENGTH;
  g.fillStyle = "#2a2f3a";
  for (let p = low; p <= high; p++) {
    if (!isBlackKey(p)) continue;
    // 검은건반 폭은 칸의 80%, 칸 가운데에
    const a = Math.min(along(p), along(p + 1)) + k * 0.1;
    g.fillStyle = lit.get(p) ?? "#2a2f3a";
    if (horizontal) g.fillRect(v.keyboard - blackLen, a, blackLen, k * 0.8);
    else g.fillRect(a, strip.y, k * 0.8, blackLen);
  }
  g.fillStyle = line;
  if (horizontal) g.fillRect(v.keyboard - 1, 0, 1, v.height);
  else g.fillRect(0, strip.y, v.width, 1);
  g.fillStyle = "#555";
  g.font = '10px "Pretendard GOV", system-ui, sans-serif';
  for (let p = low; p <= high; p++) {
    if (p % 12 !== 0) continue;
    if (horizontal) g.fillText(`o${octaveOf(p)}c`, 4, along(p) - 2);
    else g.fillText(`o${octaveOf(p)}`, along(p) + 1, v.height - 4);
  }

  if (o.lane) drawVolumeLane(g, { view: v, song: s, activeId, selected, colors: o.colors, range: profile.volume, css: o.css }, o.lane);

  // 반복 구간은 시간 축을 따라 옅게 칠하고, 커서는 점선
  if (o.box) {
    // 고르기 상자: 두 모서리 음 칸을 감싸는 네모
    const b = o.box;
    const t0 = Math.min(b.t0, b.t1);
    const t1 = Math.max(b.t0, b.t1);
    const r0 = noteRect(v, t0, t1 - t0, b.p0);
    const r1 = noteRect(v, t0, t1 - t0, b.p1);
    const x = Math.min(r0.x, r1.x);
    const y = Math.min(r0.y, r1.y);
    const w = Math.max(r0.x + r0.w, r1.x + r1.w) - x;
    const h = Math.max(r0.y + r0.h, r1.y + r1.h) - y;
    g.fillStyle = o.css("--accent");
    g.globalAlpha = 0.12;
    g.fillRect(x, y, w, h);
    g.globalAlpha = 1;
    g.strokeStyle = o.css("--accent");
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.setLineDash([]);
  }
  if (range) {
    const a = timeToScreen(v, range[0]);
    const b = timeToScreen(v, range[1]);
    g.fillStyle = "rgba(127,127,255,0.14)";
    if (horizontal) g.fillRect(Math.min(a, b), 0, Math.abs(b - a), v.height);
    else g.fillRect(0, Math.min(a, b), v.width, Math.abs(b - a));
  }
  if (cursorAt !== undefined) {
    const p = timeToScreen(v, cursorAt);
    g.strokeStyle = o.css("--accent");
    g.lineWidth = 1.5;
    g.setLineDash([5, 4]);
    g.beginPath();
    if (horizontal) {
      g.moveTo(p, 0);
      g.lineTo(p, v.height);
    } else {
      g.moveTo(0, p);
      g.lineTo(v.width, p);
    }
    g.stroke();
    g.setLineDash([]);
  }
  if (head !== undefined) drawTimeLine(head, o.css("--accent"), 2);
}
