import { DEFAULT_APPEARANCE, type NoteLook } from "./appearance";
import { chainVolumes } from "./scores";
import { drawVolumeLane, type LaneDraw } from "./laneDraw";
import { type Peaks } from "./waveform";
import { drawWaveStrip, noteStarts } from "./waveDraw";
import { trackSoundingInstrument, trackSoundingRange, type CanonicalOf } from "./instrumentRange";
import { zoneRows } from "./timbreZones";
import { labelFits, volumeLabelNotes, type VolumeLabelMode } from "./volumeLabels";
import {
  add,
  cmp,
  crossesTimbre,
  foldPitch,
  gridLines,
  MOBILE_PROFILE,
  PROFILES,
  soundingRangeOf,
  timbreBoundaries,
  toFloat,
  type Note,
  type PlaceLoss,
  type Rat,
  type Song,
} from "@mmlce/core";
import {
  barFontSize,
  barRowSize,
  BLACK_KEY_LENGTH,
  eventFontSize,
  eventLabels,
  eventRowSize,
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

/**
 * 녹음 중 미리 보이는 음 (아직 곡에 넣지 않았다). kind: placed = 넣을 음(color = 들어갈 트랙 색),
 * dropped = 트랙이 모자라 빠질 음, cleared = 바꿔 녹음으로 비울 원래 음. 없으면 placed
 */
export interface GhostNote {
  readonly start: Rat;
  readonly dur: Rat;
  readonly pitch: number;
  readonly kind?: "placed" | "dropped" | "cleared";
  readonly color?: string | undefined;
}

/** 피아노롤 한 장을 그릴 때 필요한 것 (PianoRoll.svelte가 넘긴다) */
export interface RollDrawOptions {
  readonly view: RollView;
  readonly song: Song;
  readonly activeId: string | undefined;
  /** 끌고 있는 음들 (원래 자리 대신 끄는 자리에 그린다) */
  readonly dragNotes: readonly Note[];
  /** 끄는 음을 놓으면 고르는 트랙에서 잘리거나 지워질 음 (placeLoss). 경고 색 사선으로 미리 보여 준다 */
  readonly loss?: PlaceLoss | undefined;
  /** MIDI 건반 녹음 중 친 음 (트랙과 상관없이 높이대로 녹음 색 테두리로) */
  readonly ghost?: readonly GhostNote[] | undefined;
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
  /** 끄는 마디선: 원래 자리, 놓을 자리, 옆에 보여 줄 글 (바뀔 템포) */
  readonly barDrag?: { readonly bar: number; readonly to: number; readonly text?: string | undefined } | undefined;
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
  /** 누르거나 고른 음의 건반 (높이 → 색, selectKeys.ts). 재생 중 울리는 건반이 위에 덮는다 */
  readonly heldKeys?: ReadonlyMap<number, string> | undefined;
  /** 번호로만 아는 악기의 실제 악기 (접힘 표식을 재생과 같은 음역으로) */
  readonly canonicalOf?: CanonicalOf | undefined;
  /** 음표 볼륨 숫자 (설정 → 화면). 고르는 트랙 음 옆에 v12처럼 쓴다. 없으면 끔 */
  readonly volumeLabels?: VolumeLabelMode | undefined;
  /** 음색 경계 표시 (설정 → 화면). 고르는 트랙 악기의 경계선·구간 바탕, 경계를 넘는 & 선을 경고 색으로 */
  readonly timbreZones?: boolean | undefined;
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

  // 음색 경계: 고르는 트랙 악기의 샘플 구간을 한 칸 건너 옅게 칠하고, 바뀌는 자리에 강조색 선을 긋는다 (음보다 아래).
  // 범위 밖 줄은 접혀 나는 높이의 구간을 따르고, 그쪽 경계선은 옅은 점선 (접혀 되풀이되는 경계)
  const profile = PROFILES[s.meta.profileId] ?? MOBILE_PROFILE;
  const activeTrack = activeId ? s.tracks.find((t) => t.id === activeId) : undefined;
  /** 악기 범위 안 음색 경계 (경계 바로 위 음). 건반 띠에도 짧게 표시한다 */
  const zoneEdges: number[] = [];
  if (o.timbreZones && activeTrack) {
    const instrument = trackSoundingInstrument(s, activeTrack, o.canonicalOf);
    const rows = zoneRows(timbreBoundaries(profile, instrument), soundingRangeOf(profile, instrument), low, high);
    const accent = o.css("--accent");
    g.fillStyle = accent;
    g.globalAlpha = 0.06;
    for (const [p, row] of rows) {
      if (row.zone % 2 === 0) continue;
      const r = noteRect(v, from, to - from, p);
      g.fillRect(r.x, r.y, r.w, r.h);
    }
    g.strokeStyle = accent;
    g.lineWidth = 1;
    for (const [p, row] of rows) {
      if (!row.edge) continue;
      if (row.inside) zoneEdges.push(p);
      const r = noteRect(v, from, to - from, p);
      g.globalAlpha = row.inside ? 0.5 : 0.25;
      g.setLineDash(row.inside ? [] : [4, 4]);
      g.beginPath();
      // 아래 줄(한 반음 아래)과의 사이: 가로 롤은 칸 아래 끝, 세로 롤은 칸 왼쪽 끝
      if (horizontal) {
        g.moveTo(r.x, r.y + r.h - 0.5);
        g.lineTo(r.x + r.w, r.y + r.h - 0.5);
      } else {
        g.moveTo(r.x + 0.5, r.y);
        g.lineTo(r.x + 0.5, r.y + r.h);
      }
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
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
    const instrument = o.timbreZones ? trackSoundingInstrument(s, track, o.canonicalOf) : undefined;
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
      // 끄는 음에 먹힐 음: 잘려 나갈 뒷부분(지워질 음은 통째로)에 경고 색 사선과 테두리.
      // 끄는 음은 이 트랙 음 목록 맨 뒤라 그 위에 다시 그려지므로 가리지 않는다
      const loss = isActive ? o.loss : undefined;
      if (loss && (loss.removed.has(n.id) || loss.cut.has(n.id))) {
        const keep = loss.removed.has(n.id) ? 0 : toFloat(loss.cut.get(n.id)!);
        const lost = noteRect(v, st + keep, du - keep, n.pitch);
        const danger = o.css("--danger");
        const p = hatch(danger);
        if (p) {
          g.globalAlpha = 0.9;
          g.fillStyle = p;
          g.fillRect(lost.x, lost.y, lost.w, lost.h);
        }
        g.globalAlpha = 1;
        g.strokeStyle = danger;
        g.lineWidth = 1.5;
        g.strokeRect(lost.x + 0.75, lost.y + 0.75, Math.max(1, lost.w - 1.5), Math.max(1, lost.h - 1.5));
      }
    }
    g.globalAlpha = isActive ? 0.95 : track.mute ? 0.3 : 0.5;
    // &로 이은 음: 앞 음 끝 가운데에서 뒤 음 시작 가운데로 선을 긋는다 (다른 음이면 비스듬히 = 슬라이딩)
    // 음색 경계 표시를 켜면 경계를 넘는 &(게임에서 음색이 튄다)는 경고 색으로, 이음 자리에 작은 점을 찍는다
    const sorted = [...notes].sort((a, b) => cmp(a.start, b.start));
    const tieColor = o.css("--text");
    const warnColor = o.css("--danger");
    sorted.forEach((n, i) => {
      const next = sorted[i + 1];
      if (n.tie !== "next" || !next || cmp(add(n.start, n.dur), next.start) !== 0) return;
      const at = toFloat(next.start);
      if (at < from || at > to) return;
      const a = noteRect(v, toFloat(n.start), toFloat(n.dur), n.pitch);
      const b = noteRect(v, at, toFloat(next.dur), next.pitch);
      const half = Math.min(6, (horizontal ? a.w : a.h) / 2);
      const warn = instrument !== undefined && n.pitch !== next.pitch && crossesTimbre(profile, instrument, n.pitch, next.pitch);
      g.strokeStyle = warn ? warnColor : tieColor;
      g.lineWidth = isActive ? 2 : 1;
      g.beginPath();
      if (horizontal) {
        g.moveTo(a.x + a.w - half, a.y + a.h / 2);
        g.lineTo(b.x + Math.min(6, b.w / 2), b.y + b.h / 2);
      } else {
        g.moveTo(a.x + a.w / 2, a.y + half);
        g.lineTo(b.x + b.w / 2, b.y + b.h - Math.min(6, b.h / 2));
      }
      g.stroke();
      if (warn) {
        g.fillStyle = warnColor;
        g.beginPath();
        if (horizontal) g.arc(b.x, b.y + b.h / 2, isActive ? 3 : 2, 0, Math.PI * 2);
        else g.arc(b.x + b.w / 2, b.y + b.h, isActive ? 3 : 2, 0, Math.PI * 2);
        g.fill();
      }
    });
  }
  g.globalAlpha = 1;

  // 녹음 중 친 음 (곡 음 위에): 넣을 음은 들어갈 트랙 색으로 옅게 채우고 녹음 색 테두리,
  // 빠질 음은 흐린 점선, 바꿔 녹음으로 비울 원래 음은 흐린 점선에 가로줄
  if (o.ghost && o.ghost.length > 0) {
    const rec = o.css("--danger");
    const muted = o.css("--muted");
    for (const n of o.ghost) {
      const st = toFloat(n.start);
      const du = toFloat(n.dur);
      if (st > to || st + du < from || n.pitch < low || n.pitch > high) continue;
      const r = noteRect(v, st, du, n.pitch);
      const kind = n.kind ?? "placed";
      if (kind === "placed") {
        g.fillStyle = n.color ?? rec;
        g.globalAlpha = 0.45;
        g.fillRect(r.x + 0.5, r.y + 0.5, Math.max(2, r.w - 1), Math.max(2, r.h - 1));
        g.globalAlpha = 1;
        g.strokeStyle = rec;
        g.lineWidth = 1.5;
        g.strokeRect(r.x + 1, r.y + 1, Math.max(1, r.w - 2), Math.max(1, r.h - 2));
        continue;
      }
      if (kind === "cleared") {
        // 비울 음은 바탕색으로 덮어 흐리게 (고른 트랙 음 위에서도 보이게)
        g.fillStyle = o.css("--panel");
        g.globalAlpha = 0.6;
        g.fillRect(r.x, r.y, r.w, r.h);
        g.globalAlpha = 1;
      }
      g.strokeStyle = muted;
      g.lineWidth = 1.5;
      g.setLineDash([3, 3]);
      g.strokeRect(r.x + 1, r.y + 1, Math.max(1, r.w - 2), Math.max(1, r.h - 2));
      g.setLineDash([]);
      if (kind === "cleared") {
        g.beginPath();
        g.moveTo(r.x + 1, r.y + r.h / 2);
        g.lineTo(r.x + r.w - 1, r.y + r.h / 2);
        g.stroke();
      }
    }
  }

  // 음표 볼륨 숫자: 고르는 트랙 음을 다 그린 뒤(고른 음 고리 위)에. 가로 롤은 음 시작 위쪽 바깥, 세로 롤은 음 시작(아래 끝) 오른쪽 바깥.
  // 음을 그리는 영역 밖(마디 번호·이벤트 줄·파형 띠·건반·음량 레인)으로 넘어가지 않게 자른다
  const labelMode = o.volumeLabels ?? "off";
  if (labelMode !== "off" && activeTrack && (!horizontal || v.pxPerKey >= 8)) {
    let notes: readonly Note[] = activeTrack.notes;
    if (o.dragNotes.length > 0) {
      const dragged = new Set(o.dragNotes.map((n) => n.id));
      notes = [...notes.filter((n) => !dragged.has(n.id)), ...o.dragNotes];
    }
    const laneSize = v.lane ?? 0;
    // 숫자가 실제로 보이는 음만 "화면에서 처음 보이는 음"으로 친다 (이벤트 줄·마디 번호 뒤에 가린 음은 빼고)
    const labelShown = (n: Note) => {
      if (n.pitch < low || n.pitch > high) return false;
      const r = noteRect(v, toFloat(n.start), toFloat(n.dur), n.pitch);
      if (horizontal) return r.y - 11 >= o.ruler && r.y <= v.height - laneSize;
      // 세로 롤: 숫자는 음 오른쪽에 붙으므로 왼쪽 이벤트 줄(ruler) 뒤나 아래 건반 뒤면 안 보인다
      const x = r.x + r.w + 1;
      return x >= o.ruler && x < v.width - laneSize && r.y + r.h >= 0 && r.y + r.h - 11 < v.height - v.keyboard;
    };
    const labels = volumeLabelNotes(notes, labelMode, from, to, labelShown);
    g.save();
    g.beginPath();
    if (horizontal) g.rect(v.keyboard, o.ruler, v.width - v.keyboard, v.height - o.ruler - laneSize);
    else g.rect(o.ruler, 0, v.width - o.ruler - laneSize, v.height - v.keyboard);
    g.clip();
    g.font = '10px "D2Coding", ui-monospace, monospace';
    g.textAlign = "left";
    const panel = o.css("--panel");
    const text = o.css("--text");
    /** 앞 숫자가 차지한 시간 축 끝 (가로 롤은 x, 세로 롤은 위로 가는 거리) */
    let prevEnd: number | undefined;
    const ordered = notes.filter((n) => labels.has(n.id)).sort((a, b) => cmp(a.start, b.start));
    for (const n of ordered) {
      if (n.pitch < low || n.pitch > high) continue;
      const label = `v${labels.get(n.id)}`;
      const w = g.measureText(label).width;
      const r = noteRect(v, toFloat(n.start), toFloat(n.dur), n.pitch);
      // 글자 상자 (바탕 포함): 가로 롤은 음 칸 위 한 줄, 세로 롤은 음 칸 오른쪽에 아래 끝을 맞춘다
      const box = horizontal ? { x: r.x, y: r.y - 11, w: w + 2, h: 11 } : { x: r.x + r.w + 1, y: r.y + r.h - 11, w: w + 2, h: 11 };
      const along = horizontal ? box.x : v.height - (box.y + box.h);
      if (!labelFits(prevEnd, along)) continue;
      prevEnd = along + (horizontal ? box.w : box.h);
      g.globalAlpha = 0.8;
      g.fillStyle = panel;
      g.fillRect(box.x, box.y, box.w, box.h);
      g.globalAlpha = 1;
      g.fillStyle = text;
      g.fillText(label, box.x + 1, box.y + 9);
    }
    g.restore();
  }

  /** 원곡 파형 띠 (타브와 같은 그리기). 들리는 트랙(뮤트 빼고, 솔로가 있으면 솔로만)의 음 시작 자리를 눈금으로 */
  function drawWave(c: CanvasRenderingContext2D, w: NonNullable<RollDrawOptions["wave"]>) {
    const solo = s.tracks.some((t) => t.solo);
    drawWaveStrip(c, {
      peaks: w.peaks,
      offset: w.offset,
      tempo: s.tempo,
      start: v.start,
      pxPerWhole: v.pxPerWhole,
      // 가로 롤은 건반 오른쪽부터, 세로 롤은 위(0)부터 건반 위까지
      axisStart: horizontal ? v.keyboard : 0,
      length: horizontal ? v.width - v.keyboard : v.height - v.keyboard,
      at: w.at,
      size: w.size,
      horizontal,
      starts: noteStarts(s.tracks.filter((t) => !t.mute && (!solo || t.solo)), from, to),
      screenOf: (at) => timeToScreen(v, at),
      css: o.css,
    });
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
  // 마디 번호: 화면 배율을 따라 줄 두께와 같이 커진다 (기본 10px)
  g.font = `${barFontSize(v)}px "D2Coding", ui-monospace, monospace`;
  for (const gl of gridLines(s.timeSig, from, to)) {
    if (gl.kind !== "measure") continue;
    const p = timeToScreen(v, gl.at);
    g.fillStyle = line;
    if (horizontal) g.fillRect(p, 0, 1, ruler);
    else g.fillRect(0, p, ruler, 1);
    g.fillStyle = o.css("--muted");
    if (horizontal) g.fillText(String(gl.bar), p + 3, barFontSize(v));
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
    // 끄는 동안 바뀔 템포 (파형 띠 위에)
    if (o.barDrag.text && o.wave) {
      g.save();
      g.font = 'bold 11px "D2Coding", ui-monospace, monospace';
      const w = g.measureText(o.barDrag.text).width;
      const x = horizontal ? b + 4 : o.wave.at + 2;
      const y = horizontal ? o.wave.at + 12 : b - 4;
      g.fillStyle = o.css("--bg");
      g.fillRect(x - 2, y - 11, w + 4, 14);
      g.fillStyle = o.css("--accent");
      g.fillText(o.barDrag.text, x, y);
      g.restore();
    }
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
    const row = eventRowSize(v);
    const font = eventFontSize(v);
    if (horizontal) g.fillRect(v.keyboard, barRowSize(v) + row, v.width - v.keyboard, 1);
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
      // 글자 자리: 라벨 자리(겹치면 밀어 쓴 자리)를 지금 그리는 시간 자리 p만큼 옮긴다 (끄는 중이면 p가 놓을 자리)
      const shift = p - timeToScreen(v, toFloat(l.at));
      const top = horizontal ? l.y : l.y + shift;
      const left = horizontal ? l.x + shift : l.x;
      if (!dashed && sameEvent(l, o.pickedEvent)) {
        // 고른 라벨: 바탕을 칠하고 테두리를 둘러 보인다
        g.fillStyle = color;
        g.globalAlpha = 0.22;
        g.fillRect(left, top + 1, l.w + 4, row - 2);
        g.globalAlpha = 1;
        g.lineWidth = 1;
        g.strokeRect(left + 0.5, top + 1.5, l.w + 3, row - 3);
      }
      g.fillStyle = color;
      // 기준선: 칸 위에서 글자 크기만큼 (기본 11px 글자·14px 칸에서 11)
      if (horizontal) g.fillText(l.text, left + 3, top + font);
      else g.fillText(l.text, left + 1, top + font);
    };
    // 라벨 글자는 조금 크고 굵게 (작은 글자에 옅은 색이면 안 읽힌다)
    const saved = g.font;
    g.font = `bold ${font}px "D2Coding", ui-monospace, monospace`;
    for (const l of labels) {
      const moving = dragged && dragged.kind === l.kind && cmp(dragged.at, l.at) === 0 && dragged.id === l.id;
      // 적지 않은 곡 처음 기본 템포는 옅게
      if (moving) g.globalAlpha = 0.35;
      else if (l.implicit) g.globalAlpha = 0.55;
      drawLabel(l, timeToScreen(v, toFloat(l.at)), false);
      g.globalAlpha = 1;
    }
    if (o.eventDrag) drawLabel(o.eventDrag.label, timeToScreen(v, o.eventDrag.to), true);
    g.font = saved;
  }

  // 건반 띠: 실제 피아노처럼 흰건반은 넓게, 검은건반은 짧고 좁게 (롤 쪽에 붙임). 음 칸은 반음마다 같다
  const k = v.pxPerKey;
  const along = (u: number) => (horizontal ? (v.edgePitch + 1 - u) * k : (u - v.edgePitch) * k);
  const strip = horizontal ? { x: 0, y: 0, w: v.keyboard, h: v.height } : { x: 0, y: v.height - v.keyboard, w: v.width, h: v.keyboard };
  g.fillStyle = "#f4f5f7";
  g.fillRect(strip.x, strip.y, strip.w, strip.h);
  // 재생 중 울리는 건반: 높이 → 트랙 색 (음소거 트랙 제외)
  const lit = new Map<number, string>(o.heldKeys);
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
  // 음색 경계: 건반 띠 롤 쪽 끝에 강조색 짧은 선 (흰건반 이름 글자를 가리지 않게 띠 절반만)
  if (zoneEdges.length > 0) {
    g.fillStyle = o.css("--accent");
    for (const p of zoneEdges) {
      const a = along(p);
      if (horizontal) g.fillRect(v.keyboard / 2, a - 1, v.keyboard / 2, 2);
      else g.fillRect(a - 1, strip.y, 2, v.keyboard / 2);
    }
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
