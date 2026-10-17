<script lang="ts">
  import { add, assignTab, cmp, gridLines, rat, sub, toFloat, toggleTie, type Note, type Rat, type Song, type TabTuning } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { Pinch, pinchRatio } from "./pinch";
  import { fretFromKeys, placeTabNote, removeTabNote, type TabEdit } from "./tabInput";
  import { onMount } from "svelte";
  import { fonts } from "./fonts.svelte";
  import { loadStored, saveStored } from "./persist";
  import VolumeBox from "./VolumeBox.svelte";
  import Icon from "./Icon.svelte";
  import { drawVolumeLane } from "./laneDraw";
  import { LaneGesture } from "./laneGesture.svelte";
  import { laneItems, type LaneTrack } from "./volumeLaneEdit";
  import { LANE_MAX, LANE_MIN, laneThickness, saveVolumeLane, volumeLane } from "./volumeLane.svelte";
  import type { RollView } from "./roll";
  import { tabTint } from "./tabTint.svelte";

  interface Props {
    song: Song;
    /** 이 트랙의 연주자가 가진 트랙을 모두 모아 보여 준다 */
    activeTrackId: string | undefined;
    tuning: TabTuning;
    playhead: number | undefined;
    onunplayable?: (count: number) => void;
    /** 격자: 온음표의 1/division. 타브 커서가 이 칸씩 움직인다 */
    division: number;
    /** 넣는 음 길이. 없으면 격자 한 칸 */
    noteDur?: Rat;
    /** 타브에서 음을 넣거나 지울 때 (실행 취소 한 칸) */
    onedit?: (changes: TabEdit["changes"], label: string) => void;
    /** 빈 트랙이 없어 이 악보에 트랙을 더해 음을 넣을 때 (실행 취소 한 칸) */
    onnewtrack?: (track: NonNullable<TabEdit["newTrack"]>, label: string) => void;
    /** 악보 트랙이 한도까지 차서 화음 음을 더 넣지 못했을 때 */
    onfull?: (limit: number) => void;
    /** 이 악보가 가질 수 있는 트랙 수 (게임 한도) */
    maxTracks?: number;
    /** 새로 넣는 음의 v (없으면 이어받기). 숫자판에서 바꾼다 */
    volume?: number | undefined;
    volumeRange: { readonly min: number; readonly max: number };
    /** 넣은 음 높이를 들려준다 */
    onpreview?: (pitch: number) => void;
    /** 트랙 id → 화면 색 (음량 레인) */
    colors?: ReadonlyMap<string, string> | undefined;
    /** 잠근 트랙 (음량 레인에서 바꾸지 않는다) */
    locked?: ReadonlySet<string> | undefined;
    /** 음량 레인에 고른 트랙과 같이 그릴 트랙, 멜로디 트랙 (피아노롤과 같다) */
    laneTrackIds?: readonly string[] | undefined;
    melodyIds?: ReadonlySet<string> | undefined;
  }

  let { song, activeTrackId, tuning, playhead, onunplayable, division, noteDur, onedit, onnewtrack, onfull, maxTracks = Infinity, onpreview, volume = $bindable(), volumeRange, colors, locked, laneTrackIds, melodyIds }: Props = $props();

  // 위쪽에 마디 번호 줄과 변속(템포·박자) 줄을 둔다
  const TOP = 42;
  // 줄 간격(타브 크기). 숫자 글자 크기도 같이 커진다. 이 브라우저에 기억한다
  const GAP_KEY = "mmlce.tabGap";
  let gap = $state(loadStored(GAP_KEY, (raw) => {
    const v = Number(raw);
    return Number.isFinite(v) && v >= 14 && v <= 44 ? v : 18;
  }));
  const fontPx = $derived(Math.round(Math.min(20, Math.max(11, gap * 0.62))));
  /** 줄 이름 칸 너비. 글자가 커져도 맨 앞(0박) 숫자가 줄 이름에 닿지 않게 같이 넓힌다 */
  const LEFT = $derived(Math.max(28, Math.round(fontPx * 2.2) + 6));
  function setGap(next: number) {
    gap = Math.min(44, Math.max(14, Math.round(next)));
    saveStored(GAP_KEY, String(gap));
  }
  /** 가로(시간) 확대·축소. factor > 1이면 확대, 화면 가운데를 기준으로 */
  function zoomTime(factor: number) {
    const mid = start + (width - LEFT) / pxPerWhole / 2;
    pxPerWhole = Math.min(2000, Math.max(40, pxPerWhole * factor));
    start = Math.max(0, mid - (width - LEFT) / pxPerWhole / 2);
  }
  let host: HTMLDivElement;
  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let width = $state(600);
  let start = $state(0);
  let pxPerWhole = $state(220);

  const player = $derived(song.tracks.find((t) => t.id === activeTrackId)?.playerId);
  const tracks = $derived(song.tracks.filter((t) => t.playerId === player && !t.mute));
  // 시간 스크롤바 범위: 곡 끝 뒤로 화면 반 폭만큼 더
  const span = $derived((width - LEFT) / pxPerWhole);
  const songEnd = $derived(Math.max(0, ...tracks.flatMap((tr) => tr.notes.map((n) => toFloat(n.start) + toFloat(n.dur)))));
  const timeMax = $derived(Math.max(span, songEnd + span * 0.5));
  /** 타브에서 넣은 음의 줄 (음 id → 줄). 자동 배정이 이 줄을 먼저 지킨다. 저장하지는 않는다 */
  let prefer = $state.raw<ReadonlyMap<string, number>>(new Map());
  /**
   * &로 이은 음. 같은 높이면 이어 울림(hold: 뒷자리에 괄호 숫자와 호), 다른 높이면 슬라이드(slide: / \ 선).
   * from은 화면에 숫자로 쓰는 앞 음(같은 높이로 여러 번 이었으면 맨 처음 음)
   */
  type TieLink =
    | { readonly kind: "hold"; readonly from: string; readonly prev: Rat; readonly at: Rat }
    | { readonly kind: "slide"; readonly from: string; readonly to: string; readonly up: boolean };
  const links = $derived.by(() => {
    const out: TieLink[] = [];
    for (const track of tracks) {
      const notes = [...track.notes].sort((a, b) => cmp(a.start, b.start));
      let head: string | undefined;
      notes.forEach((n, i) => {
        head ??= n.id;
        const next = notes[i + 1];
        if (n.tie !== "next" || !next || cmp(add(n.start, n.dur), next.start) !== 0) {
          head = undefined;
          return;
        }
        if (next.pitch === n.pitch) out.push({ kind: "hold", from: head, prev: n.start, at: next.start });
        else {
          out.push({ kind: "slide", from: head, to: next.id, up: next.pitch > n.pitch });
          head = next.id;
        }
      });
    }
    return out;
  });
  /** 슬라이드로 닿는 음 → 출발 음 (줄 배정이 같은 줄을 먼저 고른다) */
  const slides = $derived(new Map(links.flatMap((l) => (l.kind === "slide" ? [[l.to, l.from] as const] : []))));
  /** 음 id → 트랙 id (여러 트랙을 모아 보일 때 숫자에 트랙 색을 칠한다) */
  const trackOf = $derived(new Map(tracks.flatMap((t) => t.notes.map((n) => [n.id, t.id] as const))));
  const events = $derived(assignTab(tracks.flatMap((t) => struck(t.notes)), tuning, prefer, slides));

  /** 타브 커서: 시간(격자에 맞춤)과 줄(1 = 가장 높은 줄) */
  let cursor = $state.raw<{ at: Rat; string: number } | undefined>(undefined);
  let digits = "";
  let digitsTimer: ReturnType<typeof setTimeout> | undefined;

  /** 커서 자리에서 그 줄에 놓인 음 */
  function noteAtCursor(): Note | undefined {
    if (!cursor) return undefined;
    const c = cursor;
    const e = events.find((x) => cmp(x.start, c.at) === 0);
    return e?.notes.find((x) => x.at?.string === c.string)?.note;
  }

  function apply(edit: TabEdit, label: string, string?: number) {
    if (edit.full) {
      onfull?.(maxTracks);
      return;
    }
    if (edit.changes.length === 0 && !edit.newTrack) return;
    if (edit.noteId && string !== undefined) prefer = new Map(prefer).set(edit.noteId, string);
    if (edit.newTrack) onnewtrack?.(edit.newTrack, label);
    else onedit?.(edit.changes, label);
  }

  function enterFret(fret: number) {
    if (!cursor || !activeTrackId || fret > tuning.maxFret || cursor.string > tuning.strings.length) return;
    const pitch = tuning.strings[cursor.string - 1]! + tuning.capo + fret;
    // 트랙 수 한도는 음소거한 트랙도 센다 (타브에는 안 보여도 악보 자리는 차지한다)
    const scoreTracks = song.tracks.filter((t) => t.playerId === player).length;
    const room = Math.max(0, maxTracks - (scoreTracks - tracks.length));
    const edit = placeTabNote(song, tracks.map((t) => t.id), activeTrackId, cursor.at, noteDur ?? rat(1, division), pitch, noteAtCursor(), volume, room);
    if (edit.full) {
      apply(edit, "타브 입력");
      return;
    }
    apply(edit, "타브 입력", cursor.string);
    onpreview?.(pitch);
  }

  // 두 손가락 집기(아이패드 등): 가로로 벌리면 확대·축소, 가운데를 따라 옮긴다
  const pinch = new Pinch();
  let pinchStart: { pxPerWhole: number; start: number } | undefined;

  function point(e: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onpointermove(e: PointerEvent) {
    const f = pinch.move(e, point(e));
    const s = pinchStart;
    if (!f || !s) return;
    const midTime = s.start + (f.mid0[0] - LEFT) / s.pxPerWhole;
    pxPerWhole = Math.min(2000, Math.max(40, s.pxPerWhole * pinchRatio(f.gap0[0], f.gap[0])));
    start = Math.max(0, midTime - (f.mid[0] - LEFT) / pxPerWhole);
  }

  function onpointerup(e: PointerEvent) {
    pinch.up(e);
  }

  function onpointerdown(e: PointerEvent) {
    if (pinch.down(e, point(e))) {
      pinchStart = { pxPerWhole, start };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (pinch.active || e.button !== 0) return;
    host.focus();
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < LEFT) return;
    const time = start + (px - LEFT) / pxPerWhole;
    const string = Math.min(tuning.strings.length, Math.max(1, Math.round((py - TOP) / gap) + 1));
    touchPad = e.pointerType === "touch" || e.pointerType === "pen" || touchPad;
    cursor = { at: rat(Math.max(0, Math.floor(time * division + 1e-9)), division), string };
    digits = "";
  }

  /** 커서 음을 다음 음과 &로 잇거나 푼다 (다른 높이면 슬라이드) */
  function tieAtCursor() {
    const note = noteAtCursor();
    const track = note && tracks.find((tr) => tr.notes.some((n) => n.id === note.id));
    if (!note || !track) return;
    const next = toggleTie(track.notes, note.id);
    if (next) onedit?.([{ trackId: track.id, notes: next }], note.tie === "next" ? "이음줄 풀기" : "이음줄");
  }

  /** 커서 음의 v (숫자판 볼륨 칸이 보여 준다) */
  const cursorVolume = $derived.by(() => {
    void events;
    return noteAtCursor()?.vol;
  });

  /** 커서 음의 v 바꾸기 (숫자판 볼륨 칸) */
  function setCursorVolume(vol: number) {
    const note = noteAtCursor();
    const track = note && tracks.find((tr) => tr.notes.some((n) => n.id === note.id));
    if (!note || !track || note.vol === vol) return;
    onedit?.([{ trackId: track.id, notes: track.notes.map((n) => (n.id === note.id ? { ...n, vol } : n)) }], "음 볼륨");
  }

  function deleteAtCursor() {
    const note = noteAtCursor();
    if (note) apply(removeTabNote(song, note), "타브 지우기");
  }

  /** 커서를 격자 한 칸(좌우) 또는 한 줄(위 = 높은 줄) 옮긴다 */
  function moveCursor(dir: "left" | "right" | "up" | "down") {
    if (!cursor) return;
    const step = rat(1, division);
    if (dir === "right") cursor = { ...cursor, at: add(cursor.at, step) };
    else if (dir === "left") cursor = cmp(cursor.at, step) >= 0 ? { ...cursor, at: sub(cursor.at, step) } : cursor;
    else if (dir === "up") cursor = { ...cursor, string: Math.max(1, cursor.string - 1) };
    else cursor = { ...cursor, string: Math.min(tuning.strings.length, cursor.string + 1) };
  }

  /** 터치(아이패드 등)로 커서를 두면 키보드 대신 프렛 숫자판을 띄운다 */
  let touchPad = $state(false);
  /** 숫자판에서 프렛을 누른 뒤 다음 칸으로 넘어갈지 */
  let padAdvance = $state(true);
  /** 화음 입력: 켜 두면 프렛을 눌러도 다음 칸으로 넘어가지 않고 줄만 바꿔 같은 칸에 쌓는다 (→로 넘어간다) */
  let padChord = $state(false);

  const padOpen = $derived(touchPad && cursor !== undefined);

  // 줄 수가 다른 튜닝(베이스 4줄 등)으로 바꾸거나 다른 악보로 옮기면 커서를 마지막 줄 안으로 들인다
  $effect(() => {
    const n = tuning.strings.length;
    if (cursor && cursor.string > n) cursor = { ...cursor, string: n };
  });

  /** 숫자판을 닫는다. 커서도 같이 지워 지판만 남긴다 (다시 누르면 다시 뜬다) */
  function closePad() {
    touchPad = false;
    cursor = undefined;
    digits = "";
  }

  // 숫자판이 지판 칸을 줄이므로, 커서 줄이 칸 밖이면 그 줄이 보이게 지판 칸을 세로로 굴린다
  $effect(() => {
    if (!padOpen || !cursor || !wrap) return;
    const top = TOP + (cursor.string - 1) * gap - fontPx;
    const bottom = top + fontPx * 2;
    if (top < wrap.scrollTop) wrap.scrollTop = Math.max(0, top);
    else if (bottom > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = bottom - wrap.clientHeight;
  });

  function padFret(fret: number) {
    enterFret(fret);
    if (padAdvance && !padChord) moveCursor("right");
  }

  function onkeydown(e: KeyboardEvent) {
    if (!cursor || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    // 숫자판의 볼륨 칸·버튼에서 친 키는 그 칸이 받는다
    if ((e.target as HTMLElement | null)?.closest?.("input, select, textarea, button")) return;
    const key = e.key;
    if (/^[0-9]$/.test(key) || /^Numpad[0-9]$/.test(e.code)) {
      const digit = /^[0-9]$/.test(key) ? key : e.code.slice(6);
      const { fret, buffer } = fretFromKeys(digits, digit, tuning.maxFret);
      digits = buffer;
      clearTimeout(digitsTimer);
      if (buffer) digitsTimer = setTimeout(() => (digits = ""), 700);
      enterFret(fret);
    } else if (key === "Delete" || key === "Backspace") deleteAtCursor();
    else if (key === "l" || key === "L" || key === "&") tieAtCursor();
    else if (key === "ArrowRight") moveCursor("right");
    else if (key === "ArrowLeft") moveCursor("left");
    else if (key === "ArrowUp") moveCursor("up");
    else if (key === "ArrowDown") moveCursor("down");
    else if (key === "Escape") closePad();
    else return;
    // 타브가 처리한 키는 앱 단축키(숫자 = 격자 등)로 넘기지 않는다
    e.preventDefault();
    e.stopPropagation();
    digits = /^[0-9]$/.test(key) || /^Numpad/.test(e.code) ? digits : "";
  }

  /** 같은 음을 &로 이은 뒷부분은 다시 치는 음이 아니라 타브에 숫자를 또 쓰지 않는다 */
  function struck(notes: readonly Note[]): Note[] {
    const out: Note[] = [];
    let prev: Note | undefined;
    for (const n of notes) {
      const held = prev?.tie === "next" && prev.pitch === n.pitch && cmp(add(prev.start, prev.dur), n.start) === 0;
      if (!held) out.push(n);
      prev = n;
    }
    return out;
  }
  const unplayable = $derived(events.reduce((sum, e) => sum + e.notes.filter((x) => !x.at).length, 0));
  const height = $derived(TOP + fontPx + 8 + gap * (tuning.strings.length - 1) + 16);

  $effect(() => onunplayable?.(unplayable));

  $effect(() => {
    if (playhead === undefined) return;
    const span = (width - LEFT) / pxPerWhole;
    if (playhead < start || playhead > start + span * 0.9) start = Math.max(0, playhead - span * 0.1);
  });

  // 음량 레인: 타브 아래 띠. 피아노롤 레인과 같은 그리기·손 동작 (보기 설정도 같이 쓴다)
  let laneCanvas = $state<HTMLCanvasElement | undefined>(undefined);
  const lane = new LaneGesture();
  /** 레인 띠 높이 (값 칸 + 아래 여백 2px, 접으면 0) */
  const laneHeight = $derived.by(() => {
    const size = laneThickness();
    return size > 0 ? size + 2 : 0;
  });
  const laneView = $derived<RollView>({ orientation: "horizontal", width, height: laneHeight, start, pxPerWhole, edgePitch: 0, pxPerKey: 1, keyboard: LEFT, lane: laneHeight, laneGutter: 2 });
  const laneTracks = $derived.by((): LaneTrack[] => {
    const active = song.tracks.find((t) => t.id === activeTrackId);
    if (!active) return [];
    const extra = (laneTrackIds ?? []).filter((id) => id !== active.id).map((id) => song.tracks.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);
    return [active, ...extra].map((t) => ({ id: t.id, notes: t.notes, melody: !!melodyIds?.has(t.id), locked: !!locked?.has(t.id) }));
  });
  const laneList = $derived(laneItems(laneTracks, new Set()));

  function laneXY(e: PointerEvent): [number, number, number] {
    const rect = laneCanvas!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    return [x, e.clientY - rect.top, Math.max(0, start + (x - LEFT) / pxPerWhole)];
  }
  const touchLike = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";

  function onlanedown(e: PointerEvent) {
    if (e.pointerType !== "mouse") e.preventDefault();
    if (e.button !== 0 || !laneCanvas) return;
    const [x, y, t] = laneXY(e);
    if (x < LEFT) return;
    if (lane.start(laneView, x, y, t, laneList, volumeRange, touchLike(e), e.shiftKey)) laneCanvas.setPointerCapture(e.pointerId);
  }

  function onlanemove(e: PointerEvent) {
    if (!laneCanvas) return;
    const [x, y, t] = laneXY(e);
    if (lane.drag) lane.move(laneView, x, y, t, laneList, volumeRange, touchLike(e));
    else if (e.pointerType === "mouse" && e.buttons === 0) {
      if (x < LEFT) lane.hover = undefined;
      else lane.hoverAt(t, laneList, activeTrackId, pxPerWhole);
    }
  }

  let resize: { id: number; y0: number; size: number } | undefined;
  function onresizedown(e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resize = { id: e.pointerId, y0: e.clientY, size: laneThickness() };
  }
  function onresizemove(e: PointerEvent) {
    if (!resize || resize.id !== e.pointerId) return;
    const want = resize.size + resize.y0 - e.clientY;
    if (volumeLane.state !== "expanded") {
      if (want < LANE_MIN) return;
      volumeLane.state = "expanded";
    }
    volumeLane.size = Math.round(Math.min(LANE_MAX, Math.max(LANE_MIN, want)));
  }
  function onresizeup(e: PointerEvent) {
    if (resize?.id !== e.pointerId) return;
    resize = undefined;
    saveVolumeLane({ state: volumeLane.state, size: volumeLane.size });
  }

  function onlaneup() {
    const edits = lane.finish(song.tracks);
    if (edits.length > 0) onedit?.(edits, "음량 레인");
  }

  $effect(() => {
    const c = laneCanvas;
    if (!c || laneHeight <= 0) return;
    void fonts.loaded;
    const ratio = window.devicePixelRatio || 1;
    c.width = width * ratio;
    c.height = laneHeight * ratio;
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    // 그 연주자 트랙만 옅은 선으로 같이 보인다 (타브에 나오는 트랙과 같게)
    drawVolumeLane(g, { view: laneView, song: { ...song, tracks: song.tracks.filter((t) => t.playerId === player || laneTracks.some((l) => l.id === t.id)) }, activeId: activeTrackId, selected: new Set(), colors, range: volumeRange, css }, { ...lane.draw(laneList), label: t("ui.laneName") });
    if (playhead !== undefined) {
      g.fillStyle = css("--accent");
      g.fillRect(LEFT + (playhead - start) * pxPerWhole, 0, 2, laneHeight);
    }
  });

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) width = Math.max(100, Math.floor(entry.contentRect.width));
    });
    observer.observe(wrap);
    // 휠은 타브 줄 칸뿐 아니라 그 아래 빈 곳·음량 레인 위에서도 시간을 굴린다
    // (예전에는 줄 칸 위에서만 받아서, 빈 곳에서 굴리면 아무 일도 없었다)
    const onwheel = (e: WheelEvent) => {
      if (e.target instanceof Element && e.target.closest(".pad, .tools")) return;
      e.preventDefault();
      // 줄 단위(Firefox 등)·쪽 단위로 오는 휠 값도 픽셀로 바꾼다
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? width : 1;
      if (e.ctrlKey || e.metaKey) pxPerWhole = Math.min(2000, Math.max(40, pxPerWhole * (e.deltaY > 0 ? 0.85 : 1.18)));
      else start = Math.min(timeMax, Math.max(0, start + ((e.deltaY + e.deltaX) * unit) / pxPerWhole));
    };
    host.addEventListener("wheel", onwheel, { passive: false });
    return () => {
      observer.disconnect();
      host.removeEventListener("wheel", onwheel);
    };
  });

  function css(name: string): string {
    return getComputedStyle(host).getPropertyValue(name).trim() || "#888";
  }

  $effect(() => {
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    void fonts.loaded;
    g.fillStyle = css("--panel");
    g.fillRect(0, 0, width, height);
    const x = (t: number) => LEFT + (t - start) * pxPerWhole;
    const y = (string: number) => TOP + (string - 1) * gap;
    const end = start + (width - LEFT) / pxPerWhole;

    // 마디선과 마디 번호
    g.font = '10px "D2Coding", ui-monospace, Consolas, monospace';
    for (const gl of gridLines(song.timeSig, start, end)) {
      if (gl.kind !== "measure") continue;
      g.fillStyle = css("--line");
      g.fillRect(x(gl.at), 4, 1, y(tuning.strings.length) - 4);
      g.fillStyle = css("--muted");
      g.fillText(String(gl.bar), x(gl.at) + 3, 12);
    }

    // 변속: 템포·박자가 바뀌는 자리를 위쪽 둘째 줄에 글자로, 타브 전체에 점선으로
    const changes = [
      ...song.tempo.map((e) => ({ at: toFloat(e.at), text: `t${e.bpm}`, color: css("--ev-tempo") })),
      ...song.timeSig.map((e) => ({ at: toFloat(e.at), text: `${e.beats}/${e.unit}`, color: css("--ev-meter") })),
    ].filter((e) => e.at >= start - 0.01 && e.at < end);
    let lastRight = -Infinity;
    for (const e of changes.sort((a, b) => a.at - b.at)) {
      const px = x(e.at);
      g.strokeStyle = e.color;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(px + 0.5, 16);
      g.lineTo(px + 0.5, y(tuning.strings.length));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = e.color;
      // 같은 자리에 템포와 박자가 함께 바뀌면 옆으로 이어 쓴다
      const left = Math.max(px + 3, lastRight + 4);
      g.fillText(e.text, left, 27);
      lastRight = left + g.measureText(e.text).width;
    }

    // 줄과 개방현 이름
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    g.font = `${fontPx}px "D2Coding", ui-monospace, Consolas, monospace`;
    tuning.strings.forEach((open, i) => {
      g.fillStyle = css("--line");
      g.fillRect(LEFT, y(i + 1), width - LEFT, 1);
      g.fillStyle = css("--muted");
      g.fillText(names[(open + tuning.capo) % 12]!, 6, y(i + 1) + fontPx * 0.36);
    });

    // 프렛 숫자·이음·슬라이드는 줄 이름 칸 오른쪽에만 그린다.
    // 왼쪽으로 스크롤되어 나간 음이 줄 이름(A, E…)을 덮어 "8"처럼 보이던 문제를 막는다
    const labelEdge = 8 + Math.max(...tuning.strings.map((open) => g.measureText(names[(open + tuning.capo) % 12]!).width));
    g.save();
    g.beginPath();
    g.rect(labelEdge, 0, width - labelEdge, height);
    g.clip();

    // 프렛 숫자. 칠 수 없는 음은 아래에 ×
    // 같은 줄에서 슬라이드로 이어진 음이 너무 붙어 있으면(48분음표 꾸밈음 등) "7\6\5"처럼 한 덩어리로 쓴다
    const placed = new Map<string, { string: number; fret: number; t: number }>();
    for (const e of events) for (const { note, at } of e.notes) if (at) placed.set(note.id, { ...at, t: toFloat(e.start) });
    const slideFrom = new Map<string, string>();
    for (const l of links) if (l.kind === "slide") slideFrom.set(l.to, l.from);
    const tight = fontPx * 1.4;
    /** 덩어리로 묶여 따로 선을 긋지 않을 슬라이드 (닿는 음 id) */
    const grouped = new Set<string>();
    const byString = new Map<number, { id: string; fret: number; t: number }[]>();
    for (const [id, p] of placed) {
      if (p.t < start - 0.5 || p.t > end) continue;
      const list = byString.get(p.string) ?? [];
      list.push({ id, fret: p.fret, t: p.t });
      byString.set(p.string, list);
    }
    g.textAlign = "left";
    for (const [string, list] of byString) {
      list.sort((a, b) => a.t - b.t);
      let i = 0;
      while (i < list.length) {
        const first = list[i]!;
        let text = String(first.fret);
        let j = i + 1;
        while (j < list.length) {
          const prev = list[j - 1]!;
          const cur = list[j]!;
          if (x(cur.t) - x(prev.t) >= tight || slideFrom.get(cur.id) !== prev.id) break;
          text += (cur.fret > prev.fret ? "/" : "\\") + cur.fret;
          grouped.add(cur.id);
          j++;
        }
        const w = g.measureText(text).width + 4;
        const left = x(first.t) - g.measureText(String(first.fret)).width / 2 - 2;
        g.fillStyle = css("--panel");
        g.fillRect(left, y(string) - fontPx / 2 - 1, w, fontPx + 2);
        // 트랙 색 설정을 켰고 트랙이 둘 이상이면 숫자 칸을 그 트랙 색으로 옅게 칠하고, 고른 트랙이 아닌 숫자는 흐리게 쓴다
        const owner = trackOf.get(first.id);
        const tint = tabTint.on && tracks.length > 1 && owner ? colors?.get(owner) : undefined;
        if (tint) {
          g.globalAlpha = 0.32;
          g.fillStyle = tint;
          g.fillRect(left, y(string) - fontPx / 2 - 1, w, fontPx + 2);
          g.globalAlpha = 1;
        }
        g.fillStyle = css(tint && owner !== activeTrackId ? "--muted" : "--text");
        g.fillText(text, left + 2, y(string) + fontPx * 0.36);
        i = j;
      }
    }
    g.textAlign = "center";
    for (const e of events) {
      const t = toFloat(e.start);
      if (t < start - 0.1 || t > end) continue;
      const missing = e.notes.filter((n) => !n.at).length;
      if (missing > 0) {
        g.fillStyle = css("--danger");
        g.fillText("×".repeat(missing), x(t), y(tuning.strings.length) + fontPx + 4);
      }
    }
    // 이음·슬라이드: 숫자 사이에 표시 (다른 줄로 갈 수밖에 없는 슬라이드는 흐리게). 너무 붙은 것은 덩어리 글자로 이미 썼다
    g.strokeStyle = css("--text");
    g.lineWidth = 1.5;
    for (const l of links) {
      const a = placed.get(l.from);
      if (!a) continue;
      if (l.kind === "hold") {
        const x0 = x(toFloat(l.prev));
        const x1 = x(toFloat(l.at));
        if (x1 < LEFT - 20 || x0 > width + 20 || x1 - x0 < tight) continue;
        const yy = y(a.string) - fontPx / 2 - 2;
        g.beginPath();
        g.moveTo(x0 + 2, yy);
        g.quadraticCurveTo((x0 + x1) / 2, yy - 7, x1 - 2, yy);
        g.stroke();
        const label = `(${a.fret})`;
        const w = g.measureText(label).width + 4;
        g.fillStyle = css("--panel");
        g.fillRect(x1 - w / 2, y(a.string) - fontPx / 2 - 1, w, fontPx + 2);
        g.fillStyle = css("--muted");
        g.fillText(label, x1, y(a.string) + fontPx * 0.36);
      } else {
        if (grouped.has(l.to)) continue;
        const b = placed.get(l.to);
        if (!b || x(b.t) < LEFT - 20 || x(a.t) > width + 20) continue;
        g.globalAlpha = a.string === b.string ? 1 : 0.4;
        const tilt = (l.up ? 1 : -1) * Math.max(4, fontPx * 0.35);
        g.beginPath();
        g.moveTo(x(a.t) + fontPx * 0.7, y(a.string) + tilt);
        g.lineTo(x(b.t) - fontPx * 0.7, y(b.string) - tilt);
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    g.textAlign = "left";
    g.restore();

    // 타브 커서: 그 줄·그 자리에 칸 표시
    if (cursor) {
      const cx = x(toFloat(cursor.at));
      g.strokeStyle = css("--accent");
      g.lineWidth = 2;
      g.strokeRect(cx - fontPx * 0.8, y(cursor.string) - fontPx * 0.7, fontPx * 1.6, fontPx * 1.4);
    }

    if (playhead !== undefined) {
      g.fillStyle = css("--accent");
      g.fillRect(x(playhead), 0, 2, height);
    }
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="tab" bind:this={host} tabindex="0" role="application" {onkeydown}>
  <div class="canvas-wrap" bind:this={wrap} style:min-height={padOpen ? `min(${height}px, 45%)` : undefined}>
    <canvas bind:this={canvas} style:width="{width}px" style:height="{height}px" {onpointerdown} {onpointermove} {onpointerup} onpointercancel={onpointerup}></canvas>
  </div>
  {#if laneHeight > 0 && !padOpen}
    <!-- 높이 손잡이: 위로 끌면 레인이 커진다 (얇은 띠에서 끌어도 크게 펼쳐진다) -->
    <div
      class="lane-resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("ui.laneResize")}
      title={t("ui.laneResize")}
      onpointerdown={onresizedown}
      onpointermove={onresizemove}
      onpointerup={onresizeup}
      onpointercancel={onresizeup}
      ondblclick={() => saveVolumeLane({ state: volumeLane.state === "expanded" ? "compact" : "expanded" })}
    ><span class="grip"></span></div>
    <canvas
      class="lane"
      bind:this={laneCanvas}
      style:width="{width}px"
      style:height="{laneHeight}px"
      title={t("ui.laneHelp")}
      onpointerdown={onlanedown}
      onpointermove={onlanemove}
      onpointerup={onlaneup}
      onpointercancel={() => lane.cancel()}
      onpointerleave={() => {
        if (!lane.drag) lane.hover = undefined;
      }}
    ></canvas>
  {/if}
  {#if padOpen}
    <!-- 프렛 숫자판: 화면 키보드가 없는 터치 기기에서 타브 입력.
         좁은 화면에서도 지판이 보이게 높이를 줄이고, 닫기는 맨 윗줄 오른쪽에 늘 둔다 -->
    <div class="pad" role="group" aria-label={t("ui.fretPad")}>
      <div class="pad-top">
        <div class="moves">
          <button title={t("ui.fretPadLeft")} onclick={() => moveCursor("left")}><Icon name="chevron-left" /></button>
          <button title={t("ui.fretPadRight")} onclick={() => moveCursor("right")}><Icon name="chevron-right" /></button>
          <button title={t("ui.fretPadUp")} onclick={() => moveCursor("up")}><Icon name="chevron-up" /></button>
          <button title={t("ui.fretPadDown")} onclick={() => moveCursor("down")}><Icon name="chevron-down" /></button>
          <button title={t("ui.fretPadTieHelp")} onclick={tieAtCursor}>{t("ui.fretPadTie")}</button>
          <button onclick={deleteAtCursor}>{t("ui.fretPadDelete")}</button>
          <button class:on={padChord} aria-pressed={padChord} title={t("ui.fretPadChordHelp")} onclick={() => (padChord = !padChord)}>{t("ui.fretPadChord")}</button>
          <VolumeBox
            bind:value={volume}
            min={volumeRange.min}
            max={volumeRange.max}
            selected={cursorVolume}
            onselected={setCursorVolume}
            large
          />
          <label class="advance"><input type="checkbox" bind:checked={padAdvance} /> {t("ui.fretPadAdvance")}</label>
        </div>
        <button class="close" title={t("ui.fretPadClose")} aria-label={t("ui.fretPadClose")} onclick={closePad}>×</button>
      </div>
      <div class="frets">
        {#each Array.from({ length: tuning.maxFret + 1 }, (_, i) => i) as fret (fret)}
          <button onclick={() => padFret(fret)}>{fret}</button>
        {/each}
      </div>
    </div>
  {/if}
  <!-- 시간 스크롤 (휠과 같음)과 확대·축소. 숫자판을 띄운 동안은 지판 자리를 위해 숨긴다 -->
  <div class="tools" hidden={padOpen}>
  <input
    class="scroll"
    type="range"
    aria-label={t("ui.rollScrollTime")}
    title={t("ui.rollScrollTime")}
    min="0"
    max={timeMax}
    step="0.0625"
    value={start}
    oninput={(e) => (start = Number(e.currentTarget.value))}
  />
    <span class="zoom lane-tools">
      {#if volumeLane.state === "collapsed"}
        <button class="small" title={t("ui.laneOpen")} onclick={() => saveVolumeLane({ state: "compact" })}>{t("ui.laneName")} ▲</button>
      {:else}
        {#if laneTracks.length > 1}<span class="muted" title={t("ui.laneMultiHelp")}>{t("ui.laneTracks", { n: laneTracks.length })}</span>{/if}
        {#if volumeLane.state === "expanded"}
          <button class="small" class:on={volumeLane.mode === "brush"} onclick={() => saveVolumeLane({ mode: "brush" })}>{t("ui.laneBrush")}</button>
          <button class="small" class:on={volumeLane.mode === "line"} onclick={() => saveVolumeLane({ mode: "line" })}>{t("ui.laneLine")}</button>
          <button class="small" title={t("ui.laneShrink")} onclick={() => saveVolumeLane({ state: "compact" })}>{t("ui.laneName")} ▼</button>
        {:else}
          <button class="small" title={t("ui.laneExpand")} onclick={() => saveVolumeLane({ state: "expanded" })}>{t("ui.laneName")} ▲</button>
        {/if}
        <button class="small" title={t("ui.laneCollapse")} onclick={() => saveVolumeLane({ state: "collapsed" })}>×</button>
      {/if}
    </span>
    <span class="zoom">
      <button class="small" title={t("ui.zoomOutTime")} onclick={() => zoomTime(1 / 1.25)}><Icon name="arrows-h" size={14} /><Icon name="minus" size={12} /></button>
      <button class="small" title={t("ui.zoomInTime")} onclick={() => zoomTime(1.25)}><Icon name="arrows-h" size={14} /><Icon name="plus" size={12} /></button>
      <button class="small" title={t("ui.tabSmaller")} onclick={() => setGap(gap - 3)}>A−</button>
      <button class="small" title={t("ui.tabBigger")} onclick={() => setGap(gap + 3)}>A+</button>
    </span>
  </div>
</div>

<style>
  .tab {
    /* 칸 높이를 다 쓰고, 줄이 많으면 캔버스 칸 안에서 스크롤한다 */
    height: 100%;
    display: flex;
    flex-direction: column;
    outline: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
  }
  .tab:focus-visible,
  .tab:focus-within {
    border-color: var(--accent);
  }
  .lane-resize {
    flex: none;
    height: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-top: 1px solid var(--line);
    cursor: ns-resize;
    touch-action: none;
  }
  .lane-resize:hover {
    background: color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .lane-resize .grip {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--accent);
    opacity: 0.7;
    pointer-events: none;
  }
  canvas.lane {
    flex: none;
    /* 손가락·펜으로 그을 때 화면이 같이 움직이지 않게 */
    touch-action: none;
    cursor: crosshair;
  }
  .lane-tools button.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .canvas-wrap {
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
  }
  canvas {
    display: block;
    /* 세로 페이지 스크롤은 그대로 두고, 집기는 여기서 처리한다 */
    touch-action: pan-y;
  }
  .pad {
    /* 남는 높이만 쓰고, 넘치면 숫자판 안에서 굴린다 (지판 칸은 canvas-wrap의 min-height로 지킨다) */
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 0 8px 6px;
    border-top: 1px solid var(--line);
    background: var(--panel);
    display: grid;
    /* 칸이 내용 폭만큼 늘어나 닫기 버튼이 화면 밖으로 밀리지 않게 */
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  .pad-top {
    /* 숫자판을 굴려도 이동 버튼과 닫기는 늘 위에 보인다 */
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 6px;
    background: var(--panel);
  }
  .moves {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 4px 8px;
    align-items: center;
    /* 좁은 화면에서는 줄을 바꾸지 않고 옆으로 민다 (닫기 버튼 자리를 지킨다) */
    overflow-x: auto;
    scrollbar-width: none;
    white-space: nowrap;
  }
  .moves > * {
    flex: none;
  }
  .moves button.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .close {
    flex: none;
    min-width: 44px;
    min-height: 36px;
    font-size: 20px;
    line-height: 1;
  }
  /* 0~10, 11~20 두 줄: 폰 폭에서도 세 줄 이상 쌓이지 않는다 */
  .frets {
    display: grid;
    grid-template-columns: repeat(11, minmax(0, 1fr));
    gap: 3px;
    max-width: 760px;
  }
  .frets button,
  .moves button {
    min-height: 34px;
    padding-inline: 0;
    font-variant-numeric: tabular-nums;
  }
  .moves button {
    min-width: 44px;
    padding-inline: 8px;
  }
  .tools[hidden] {
    display: none;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 4px;
  }
  .zoom {
    display: inline-flex;
    gap: 2px;
  }
  .zoom button {
    display: inline-flex;
    align-items: center;
  }
  .scroll {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
    opacity: 0.55;
  }
  .scroll:hover,
  .scroll:focus-visible {
    opacity: 1;
  }
</style>
