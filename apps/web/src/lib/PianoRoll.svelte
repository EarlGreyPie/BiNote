<script lang="ts">
  import {
    add,
    scaleNotesIn,
    gridLines,
    MOBILE_PROFILE,
    PROFILES,
    clipNotes,
    cmp,
    glueNotes,
    noteBefore,
    pasteClip,
    positionToSeconds,
    placeNote,
    rat,
    removeNotes,
    secondsToWhole,
    splitNote,
    replaceNotes,
    sub,
    toFloat,
    toggleTie,
    type Note,
    type Rat,
    type Song,
  } from "@mmlce/core";
  import { onMount, untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import { volumeLabels } from "./volumeLabels.svelte";
  import { fonts } from "./fonts.svelte";
  import { noteClipboard } from "./noteClipboard.svelte";
  import { rollFlow } from "./rollFlow.svelte";
  import { t } from "./i18n.svelte";
  import { drawRoll } from "./rollDraw";
  import type { CanonicalOf } from "./instrumentRange";
  import { carryViewStart, type ViewMemory } from "./viewCarry";
  import { Pinch, pinchRatio, type PinchFrame } from "./pinch";
  import { wholeToSecondsFn, type Peaks } from "./waveform";
  import type { NoteLook } from "./appearance";
  import { LANE_MAX, LANE_MIN, laneThickness, saveVolumeLane, volumeLane } from "./volumeLane.svelte";
  import LaneTrackPicker from "./LaneTrackPicker.svelte";
  import { laneItems, type LaneTrack } from "./volumeLaneEdit";
  import { LaneGesture } from "./laneGesture.svelte";
  import { tabEventPrefs } from "./tabEventPrefs.svelte";
  import { fallShift, fallSpeed, SPEED_FRAME_GAP, SPEED_FRAME_WIDTH, SPEED_PICK_GAP, speedPickLost, speedPickPress, speedPickWheel, toGray } from "./videoSpeed";
  import {
    bpmAt,
    clampPitchView,
    dragKeyLine,
    fillStretch,
    matchRollZoom,
    fitVideoKeys,
    fromScreen,
    keyAt,
    pitchToScreen,
    snapDown,
    snapNearest,
    visiblePitch,
    visibleTime,
    videoMatrix,
    type BackgroundVideo,
    type Orientation,
    type RollView,
    type RollTool,
    noteNear,
    isResizeGrab,
    BAR_ROW,
    eventRowFor,
    eventsBottom,
    eventAt,
    eventLabels,
    eventRow,
    sameEvent,
    type EventKind,
    type EventLabel,
    type EventRef,
    axes,
    inLane,
    LANE_GUTTER,
  } from "./roll";

  interface Props {
    /** 재생 시작 커서(온음표 단위). Shift+클릭으로 정한다 */
    cursor?: number | undefined;
    /** 반복 구간 [시작, 끝] (온음표 단위). Shift+끌기로 정한다 */
    loop?: readonly [number, number] | undefined;
    oncursor?: (time: number | undefined) => void;
    onloop?: (range: readonly [number, number] | undefined) => void;
    /** 트랙 id → 화면 색. 없으면 트랙에 저장된 색 */
    colors?: ReadonlyMap<string, string>;
    song: Song;
    activeTrackId: string | undefined;
    orientation: Orientation;
    /** 격자: 온음표의 1/division */
    division: number;
    /** 재생 위치(온음표 단위). 재생 중이 아니면 undefined */
    playhead: number | undefined;
    /** 한 번 부를 때마다 실행 취소 한 칸 */
    onnotes: (trackId: string, notes: Note[], label: string) => void;
    onselecttrack: (trackId: string) => void;
    /** 음을 눌러 골랐을 때 (MML 글에서 그 자리를 보여 준다). 두 번 누르면 focus = true */
    onpicknote?: (trackId: string, note: Note, focus: boolean) => void;
    /** 건반 띠를 누르거나 음을 누르는 동안 그 높이를 미리 들려준다 (on = false면 끈다) */
    onpreview?: (pitch: number, on: boolean) => void;
    /** 마디 번호 줄을 누르면 그 자리로 (3MLE처럼 원하는 곳부터 재생) */
    onseek?: (time: number) => void;
    /** 템포·박자·마커 바뀜을 마디 번호 줄 아래에 표시 */
    showEvents?: boolean;
    /** 배경에 깔아 둘 로컬 영상 (떨어지는 음 영상을 보고 찍을 때). 맞춤 손잡이를 끌면 바뀐다 */
    video?: BackgroundVideo | undefined;
    /** 곡 없이 영상만 재생 중 (음이 없어도 영상을 보며 찍을 때). 영상이 끝나면 false로 돌아온다 */
    videoPlay?: boolean;
    /** 영상 속도 직접 재기 단계: 0 아님, 1 첫 점 누르기, 2 "0.5초 앞으로" 누르기, 3 같은 음 다시 누르기 */
    speedStep?: 0 | 1 | 2 | 3;
    /** 직접 재기가 끝났을 때: 잰 속도(원본 영상 px/초), 두 점이 맞지 않으면 undefined */
    onspeedpicked?: ((speed: number | undefined) => void) | undefined;
    /** 원곡 파형 (마디 줄 아래 띠). offset = 원곡 어긋남(초, 원곡이 늦으면 양수) */
    wave?: { readonly peaks: Peaks; readonly offset: number } | undefined;
    /** 음 모양 */
    look?: NoteLook;
    /** 테마가 바뀔 때마다 달라지는 값 (색을 다시 읽어 그리게) */
    themeKey?: string;
    /** 롤에 보일 음 높이 범위 [낮은 음, 높은 음] (MIDI 번호) */
    pitchRange?: readonly [number, number];
    /** 재생 중 곡 시간(초). 배경 영상을 맞춘다 */
    seconds?: number | undefined;
    /**
     * 도구. pen = 빈 곳을 눌러 음 넣기(음을 누르면 고르고 옮김), select = 빈 곳을 끌어 상자로 고르기(음은 안 넣음),
     * eraser = 누르거나 문지르는 음 지우기 (터치·펜에서 오른쪽 클릭 대신), split = 누른 자리(격자)에서 음 자르기
     */
    tool?: RollTool;
    /** 누르기만 해서 넣는 음 길이. 없으면 격자 한 칸 (끌면 끈 만큼) */
    noteDur?: Rat;
    /** 새로 넣는 음의 v. 없으면 앞 음 v를 이어받는다 */
    volume?: number | undefined;
    /** Alt+휠: 고른 음 v를 delta만큼 */
    onvolume?: (delta: number) => void;
    /** 재생 중 울리는 건반에 불 켜기 */
    lightKeys?: boolean;
    /** 번호로만 아는 악기의 실제 악기 (올린 팩이 바뀌면 새 함수를 넘겨 다시 그린다) */
    canonicalOf?: CanonicalOf | undefined;
    /** 보기를 바꾸기 전에 보던 자리와 지난번 롤 확대 (만들 때 한 번만 읽는다) */
    memory?: ViewMemory | undefined;
    /** 보던 자리·확대가 바뀔 때 (보기를 바꿨다 돌아와도 이어 보게 앱이 기억한다) */
    onmemory?: ((place: NonNullable<ViewMemory["place"]>, zoom: NonNullable<ViewMemory["roll"]>, work: number | undefined) => void) | undefined;
    /** 이 보기를 만든 보기 세대(곡을 열 때마다 늘어나는 번호). 만들 때 한 번 읽어 onmemory에 함께 돌려준다 (곡을 연 뒤 옛 보기의 알림을 앱이 버리게) */
    work?: number | undefined;
    /** 롤에 그릴 트랙 id. 없으면 곡의 모든 트랙. 고른 트랙은 항상 그린다 */
    visibleTrackIds?: readonly string[] | undefined;
    /** 고르기 도구에서 음을 끌어 옮길 수 있는지 (자물쇠 풀림). 길이 바꾸기·음 넣기는 여전히 안 한다 */
    selectMove?: boolean;
    /** 잠근 트랙: 음을 고칠 수 없고(고르기만 된다), 그 트랙 음을 눌러 트랙을 바꾸지도 않는다 */
    locked?: ReadonlySet<string> | undefined;
    /** 다른 트랙 음을 누르면 그 트랙으로 바꾼다 (보기 메뉴에서 끌 수 있다) */
    pickOthers?: boolean;
    /**
     * 이벤트 줄에서 템포·마커·박자를 고치려 할 때 (두 번 누르기·길게 누르기·오른쪽 클릭).
     * label이 있으면 그 라벨을 고치고, 없으면 kind를 at에 새로 넣는다
     */
    /** 템포·마커 창 열기. work는 이 보기를 만든 보기 세대 (곡을 다시 연 뒤 옛 보기가 늦게 보낸 요청을 앱이 버리게) */
    onevent?: (request: { label?: EventLabel; kind: EventKind; at: Rat; work?: number | undefined }) => void;
    /** 이벤트 라벨을 끌어 옮겼을 때 (템포·마커만) */
    oneventmove?: (label: EventLabel, to: Rat) => void;
    /** 원곡 파형 띠에서 마디선을 끌어 놓았을 때: 그 마디(bar)가 곡 위치 to(지금 템포로, 파형의 그 박 자리)에 오게 */
    onalignbar?: (bar: Rat, to: number) => void;
    /** 고른 이벤트 라벨. 누르면 고르고(onpickevent), 이벤트 줄에서 휠을 굴리면 그 템포를 바꾼다(ontempowheel, ±1·Shift ±10) */
    pickedEvent?: EventRef | undefined;
    onpickevent?: (event: EventRef | undefined) => void;
    ontempowheel?: (at: Rat, step: number) => void;
    /** 파형 띠를 끌어 원곡 어긋남(초)을 바꾼다 */
    onwaveoffset?: (seconds: number) => void;
    /** 음량 레인에 고른 트랙과 같이 그릴 트랙 (트랙 목록 Ctrl+클릭) */
    laneTrackIds?: readonly string[] | undefined;
    /** 멜로디 트랙 (여러 트랙에 그릴 때 그은 값을 그대로 받는다) */
    melodyIds?: ReadonlySet<string> | undefined;
    /** 음량 레인 한 획이 여러 트랙을 바꿀 때 (실행 취소 한 칸) */
    onvolumes?: (changes: { trackId: string; notes: Note[] }[], label: string) => void;
    /** 같이 그리던 트랙을 모두 뺀다 */
    onclearlane?: () => void;
    /** 음량 레인에 같이 그릴 트랙 넣고 빼기 (레인의 트랙 고르기 판) */
    onlanetoggle?: ((trackId: string) => void) | undefined;
  }

  let { cursor, loop, oncursor, onloop, song: fullSong, activeTrackId, orientation, division, playhead, onnotes, onselecttrack, onpicknote, onpreview, onseek, showEvents = false, video = $bindable(), videoPlay = $bindable(false), speedStep = $bindable(0), onspeedpicked, pitchRange = [12, 119], wave, look, themeKey = "", seconds, colors, tool = "pen", noteDur, volume, onvolume, lightKeys = false, canonicalOf, memory, onmemory, work, visibleTrackIds, selectMove = false, locked, pickOthers = true, onevent, oneventmove, onalignbar, onwaveoffset, pickedEvent, onpickevent, ontempowheel, laneTrackIds, melodyIds, onvolumes, onclearlane, onlanetoggle }: Props =
    $props();

  /** 레이어: 고른 트랙이 든 보기만 그리고 다루는 곡 (나머지 트랙은 롤에서 보이지도 눌리지도 않는다) */
  const song = $derived.by(() => {
    if (!visibleTrackIds) return fullSong;
    const keep = new Set(visibleTrackIds);
    if (activeTrackId) keep.add(activeTrackId);
    return { ...fullSong, tracks: fullSong.tracks.filter((tr) => keep.has(tr.id)) };
  });

  let videoEl = $state<HTMLVideoElement | undefined>(undefined);
  let videoSize = $state<[number, number] | undefined>(undefined);

  /**
   * 배경 영상 맞추기: 곡 재생 중이면 곡 시간 + 어긋남, 영상만 재생 중이면 영상이 제 시계로 돌고
   * 롤이 따라간다, 멈춰 있으면 화면 시작 위치의 장면을 보여 준다
   */
  $effect(() => {
    const el = videoEl;
    if (!el || !video) return;
    if (seconds !== undefined) {
      const want = seconds + video.offset;
      if (Math.abs(el.currentTime - want) > 0.15) el.currentTime = Math.max(0, want);
      if (el.paused) void el.play().catch(() => {});
    } else if (videoPlay) {
      if (el.paused) void el.play().catch(() => (videoPlay = false));
    } else {
      if (!el.paused) el.pause();
      const at = positionToSeconds(song.tempo, rat(Math.round(start * 960), 960)) + video.offset;
      if (Math.abs(el.currentTime - at) > 0.05) el.currentTime = Math.max(0, at);
    }
  });

  /** 영상만 재생할 때의 재생 위치 (온음표 단위, 영상 시간 − 어긋남) */
  let videoHead = $state<number | undefined>(undefined);
  $effect(() => {
    const el = videoEl;
    if (!el || !video || !videoPlay || seconds !== undefined) {
      videoHead = undefined;
      return;
    }
    const offset = video.offset;
    const tempo = song.tempo;
    let frame = 0;
    const tick = () => {
      videoHead = Math.max(0, secondsToWhole(tempo, Math.max(0, el.currentTime - offset)));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  });
  /** 그릴 재생선: 곡 재생 위치, 없으면 영상만 재생할 때의 위치 */
  const head = $derived(playhead ?? videoHead);

  const KEYBOARD = 44;
  const eraser = $derived(tool === "eraser");
  const DEFAULT_VOLUME = 8;

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let width = $state(600);
  let height = $state(320);

  // 보기를 바꾸기 전 자리에서 시작한다 (만들 때 한 번만 읽는다). 시작 시간은 화면 크기를 안 뒤 재생 위치가 보이게 다시 맞춘다
  const carry = untrack(() => ({ place: memory?.place, zoom: memory?.roll, cursor, work }));
  let carryPending = !!carry.place;
  let start = $state(carry.place?.start ?? 0);
  let pxPerWhole = $state(carry.zoom?.pxPerWhole ?? 160);
  let pxPerKey = $state(carry.zoom?.pxPerKey ?? 12);
  let edgePitch = $state(carry.zoom?.edgePitch ?? 84);
  /** 고른 음 id. 고른 트랙의 음만 쓴다 (다른 트랙 id는 걸러진다) */
  let selected = $state.raw<ReadonlySet<string>>(new Set());
  /** Ctrl+끌기로 그리는 고르기 상자 (시간·높이) */
  /** 상자 고르기. from이 있으면 음 위에서 시작한 것: 문턱(x0·y0에서 8px)을 넘게 끌기 전에는 그 음 고르기를 지킨다 */
  let boxing = $state.raw<{ t0: number; p0: number; t1: number; p1: number; from?: { id: string; x0: number; y0: number } } | undefined>(undefined);

  function selectOnly(id: string | undefined) {
    selected = new Set(id ? [id] : []);
  }

  // 스크롤바: 음 높이(옥타브 이동)와 시간. 휠·Shift+휠과 같은 값을 움직인다
  const pitchSpan = $derived.by(() => {
    const [low, high] = visiblePitch(view);
    return high - low;
  });
  const timeSpan = $derived.by(() => {
    const [from, to] = visibleTime(view);
    return to - from;
  });
  const songEnd = $derived(
    Math.max(0, ...song.tracks.flatMap((tr) => tr.notes.map((n) => toFloat(n.start) + toFloat(n.dur)))),
  );
  const timeMax = $derived(Math.max(timeSpan, songEnd + timeSpan * 0.5));

  /**
   * 잡은 음 끌기. 누른 자리(t0·p0·화면 x0·y0)에서 얼마나 움직였는지로만 바꾼다: 격자에 안 맞는 음(셋잇단 등)을
   * 누르기만 해도 격자로 끌려가거나, 넓힌 누름 자리 때문에 다른 높이로 바뀌지 않게.
   * live는 손이 문턱(마우스 3px, 손가락·펜 8px)을 넘게 움직였는지. 넘기 전에는 아무것도 바꾸지 않는다
   */
  type Grab = { t0: number; p0: number; x0: number; y0: number; slop: number; live: boolean };
  type Drag =
    | ({ mode: "create"; note: Note } & Grab)
    | ({ mode: "move"; note: Note; original: Note; group: readonly Note[]; moved: readonly Note[] } & Grab)
    | ({ mode: "resize"; note: Note; original: Note } & Grab);
  let drag = $state.raw<Drag | undefined>(undefined);
  let newId = 0;
  /** 곡에 없는 새 음 id. 저장·복구한 곡은 이전 id를 그대로 가지고 오고 롤을 다시 만들면 카운터가 처음부터 시작하므로, 곡에 이미 있는 id는 건너뛴다 */
  function freshIds(kind: string): () => string {
    const used = new Set(fullSong.tracks.flatMap((tr) => tr.notes.map((n) => n.id)));
    return () => {
      let id: string;
      do id = `${active!.id}.${kind}${++newId}`;
      while (used.has(id));
      used.add(id);
      return id;
    };
  }

  /** 음량 레인이 차지하는 두께 (값 칸 + 시간 스크롤바 칸, 접으면 0) */
  const laneReserved = $derived.by(() => {
    let size = laneThickness();
    if (size <= 0) return 0;
    // 크게 키워도 음 칸이 120px은 남게 (설정에서 고른 높이가 이 화면에 너무 크면 줄여 보인다)
    if (volumeLane.state === "expanded") size = Math.max(LANE_MIN, Math.min(size, laneRoom()));
    return size + LANE_GUTTER;
  });
  /**
   * 확대 단추 자리. 가로 롤은 오른쪽 아래(음 높이 스크롤바 왼쪽, 시간 스크롤바 위), 세로 롤은 건반 띠 위 오른쪽(시간 스크롤바 왼쪽).
   * 음량 레인이 열려 있으면 레인과 높이 손잡이(레인 끝 ±6px) 바깥으로 비킨다
   */
  const zoomCornerStyle = $derived(
    orientation === "horizontal"
      ? `right:20px;bottom:${laneReserved > 0 ? laneReserved + 10 : 20}px`
      : `right:${laneReserved > 0 ? laneReserved + 10 : 20}px;bottom:${KEYBOARD + 4}px`,
  );
  /** 롤이 아주 좁으면(작은 휴대폰 세로 롤 등) 건반 높이 −/+는 접는다 (도구줄·더 보기 메뉴에 그대로 있다) */
  const cornerNarrow = $derived((orientation === "horizontal" ? width - KEYBOARD : width - laneReserved) < 260);

  /** 이 화면에서 레인이 가질 수 있는 가장 큰 두께 */
  function laneRoom(): number {
    return Math.min(LANE_MAX, (orientation === "horizontal" ? height : width) - LANE_GUTTER - 120);
  }
  const view = $derived<RollView>({
    orientation,
    width,
    height,
    start,
    pxPerWhole,
    edgePitch,
    pxPerKey,
    keyboard: KEYBOARD,
    lane: laneReserved,
    // 이벤트 줄 글자 크기 (설정 → 화면, 타브 변속 줄과 같은 설정)
    eventRow: eventRowFor(tabEventPrefs.font),
  });

  // 음 높이 범위 밖(o19 같은)이 보이지 않게: 넓은 화면이면 칸을 키워 범위를 꽉 채운다
  $effect(() => {
    const c = clampPitchView(view, pitchRange[0], pitchRange[1]);
    if (c.pxPerKey !== pxPerKey) pxPerKey = c.pxPerKey;
    if (c.edgePitch !== edgePitch) edgePitch = c.edgePitch;
  });

  /** 롤을 영상 건반 범위(왼쪽 끝 ~ 오른쪽 끝 건반)에 맞춰 옮기고 확대한다 */
  export function fitVideo() {
    if (!video) return;
    const f = fitVideoKeys(view, video);
    pxPerKey = f.pxPerKey;
    edgePitch = f.edgePitch;
  }

  /**
   * 영상을 처음 읽었을 때 세로 롤이고 건반 맞춤이 켜져 있으면 롤을 영상 건반에 맞춘다
   * (가로 롤은 음 축이 짧아 88건반을 다 넣으면 칸이 너무 작다. 롤 맞추기 단추로는 맞출 수 있다)
   */
  function onVideoLoaded(el: HTMLVideoElement) {
    videoSize = [el.videoWidth, el.videoHeight];
    if (video?.fit && orientation === "vertical") fitVideo();
  }

  // 맞춤 손잡이: 왼쪽·오른쪽 끝은 그 끝 건반 자리를, 건반 윗선 막대는 영상 전체를 (음 축·시간 축으로) 옮긴다
  type HandleKind = "low" | "high" | "move";
  let handleDrag:
    | { kind: HandleKind; id: number; x: number; y: number; video: BackgroundVideo }
    | undefined;
  const handles = $derived.by(() => {
    if (!video?.fit || !video.handles || !videoSize) return undefined;
    const a = pitchToScreen(view, video.low);
    const b = pitchToScreen(view, video.high + 1);
    return { low: a, high: b, from: Math.min(a, b), to: Math.max(a, b) };
  });

  function onHandleDown(e: PointerEvent, kind: HandleKind) {
    if (!video) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    handleDrag = { kind, id: e.pointerId, x: e.clientX, y: e.clientY, video: { ...video } };
  }

  function onHandleMove(e: PointerEvent) {
    const d = handleDrag;
    if (!d || e.pointerId !== d.id || !video || !videoSize) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const vertical = orientation === "vertical";
    // 음 축으로 끈 거리(음 단위, 높은 음 쪽이 +)
    const dp = (vertical ? dx : -dy) / pxPerKey;
    const v0 = d.video;
    if (d.kind === "low") video = { ...video, low: Math.min(v0.low + dp, v0.high + 0.5) };
    else if (d.kind === "high") video = { ...video, high: Math.max(v0.high + dp, v0.low - 0.5) };
    else {
      const away = vertical ? -dy : dx;
      const keyLine = dragKeyLine(view, v0, videoSize[0], videoSize[1], away);
      video = { ...video, low: v0.low + dp, high: v0.high + dp, keyLine };
    }
  }

  function onHandleUp(e: PointerEvent) {
    if (handleDrag?.id === e.pointerId) handleDrag = undefined;
  }

  // 화면 채우기: 건반 윗선부터 영상 위 끝까지가 롤 시간 축의 보이는 길이 전체를 덮게 시간 늘이기를 자동으로 정한다.
  // 롤 크기·방향·건반 맞춤 범위가 바뀌면 다시 계산한다 (늘이기 칸은 이 값을 보여 준다)
  $effect(() => {
    if (!video?.fit || video.fill === false || !videoSize) return;
    const stretch = fillStretch(view, video, videoSize[0], videoSize[1]);
    if (Math.abs(stretch - video.stretch) > 1e-6) untrack(() => video && (video = { ...video, stretch }));
  });

  /** 롤 가로 확대 한도 (휠·핀치와 같다) */
  const clampZoom = (z: number) => Math.min(2000, Math.max(5, z));

  // 속도 맞추기: 잰 영상 속도(원본 px/초) × 시간 축 배율 = 화면에서 떨어지는 속도가 롤의 px/초가 되게 롤 가로 확대를 둔다.
  // 롤 크기(건반 칸)나 늘이기 배율이 바뀌면 다시 맞춘다 (가로 확대·화면 자리가 바뀐 것으로는 돌지 않는다). 템포는 지금 화면 시작 자리의 것
  $effect(() => {
    if (!video?.fit || !video.speed || !videoSize) return;
    const keys = Math.max(1, video.high + 1 - video.low);
    const time = ((keys * pxPerKey) / videoSize[0]) * video.stretch;
    const speed = video.speed;
    untrack(() => {
      const zoom = clampZoom(matchRollZoom(speed * time, bpmAt(song.tempo, start)));
      if (Math.abs(zoom - pxPerWhole) > 1e-6) pxPerWhole = zoom;
    });
  });

  /**
   * 영상을 seconds초로 옮기고 그 프레임이 준비될 때까지 기다린다 (오래 걸리면 그냥 넘어간다).
   * 실제로 보이는 프레임의 시각을 돌려준다: 옮긴 시각은 프레임 사이일 수 있어(30fps면 0.25초 = 7.5프레임)
   * 브라우저가 알려 주면(requestVideoFrameCallback) 그 프레임 시각, 아니면 옮긴 시각
   */
  function seekVideo(el: HTMLVideoElement, seconds: number): Promise<number> {
    const want = Math.max(0, seconds);
    return new Promise((resolve) => {
      let shown: number | undefined;
      const frames = el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number };
      const done = () => {
        clearTimeout(timer);
        el.removeEventListener("seeked", onseeked);
        resolve(shown ?? want);
      };
      // 프레임 시각을 기다리되, 안 오면 seeked 뒤 잠깐만 기다린다
      const onseeked = () => {
        if (!frames.requestVideoFrameCallback || shown !== undefined) done();
        else setTimeout(done, 300);
      };
      const timer = setTimeout(done, 2000);
      frames.requestVideoFrameCallback?.((_, meta) => {
        shown = meta.mediaTime;
        done();
      });
      el.addEventListener("seeked", onseeked);
      el.currentTime = want;
    });
  }

  /**
   * 속도 맞추기(자동): 멈춘 영상의 지금 프레임과 SPEED_FRAME_GAP초 뒤 프레임을 줄인 회색조로 그려, 건반 윗선 위쪽 구간이
   * 몇 px 내려왔는지 상호상관으로 찾는다. 찾으면 영상 설정에 속도를 적고(롤 확대는 위 효과가 맞춘다) true.
   * 움직임이 없거나 상관이 낮으면 false (직접 재기로 넘어간다). 다 재면 원래 장면으로 되돌린다
   */
  export async function measureVideoSpeed(): Promise<boolean> {
    const el = videoEl;
    if (!el || !video?.fit || !videoSize || seconds !== undefined) return false;
    videoPlay = false;
    const [vw, vh] = videoSize;
    const w = SPEED_FRAME_WIDTH;
    const h = Math.max(8, Math.round((w * vh) / vw));
    const rows = Math.max(4, Math.floor(h * video.keyLine));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return false;
    const grab = () => {
      g.drawImage(el, 0, 0, w, h);
      return toGray(g.getImageData(0, 0, w, rows).data, w, rows);
    };
    const t0 = el.currentTime;
    try {
      if (!el.paused) el.pause();
      // 두 프레임 모두 옮긴 뒤 그 프레임 시각을 받아, 실제 두 프레임 사이 시간으로 나눈다
      const at0 = await seekVideo(el, t0);
      const a = grab();
      const at1 = await seekVideo(el, t0 + SPEED_FRAME_GAP);
      const b = grab();
      const found = fallShift(a, b, w, rows);
      if (!found || !video || !(at1 > at0)) return false;
      video = { ...video, speed: fallSpeed(found.shift, vw / w, at1 - at0) };
      return true;
    } catch {
      return false;
    } finally {
      await seekVideo(el, t0);
    }
  }

  /** 직접 재기: 누른 화면 자리를 영상 원본의 세로 좌표(px, 위가 0)로 */
  function videoYAt(e: PointerEvent): number | undefined {
    if (!video || !videoSize) return undefined;
    const m = videoMatrix(view, video, videoSize[0], videoSize[1]);
    const rect = canvas.getBoundingClientRect();
    if (orientation === "horizontal") return m[2] === 0 ? undefined : (e.clientX - rect.left - m[4]) / m[2];
    return m[3] === 0 ? undefined : (e.clientY - rect.top - m[5]) / m[3];
  }
  /** 직접 재기를 시작한 화면 자리(끝나면 되돌린다)와 그때의 영상·곡, 첫 점 */
  let pickFrom: { start: number; url: string; song: Song; y?: number } | undefined;
  /** 직접 재기 시작: 멈춘 화면에서 영상 속 한 음의 앞 끝을 누른다 */
  export function startSpeedPick() {
    if (!video?.fit || !videoSize) return;
    // 하던 편집 동작(끌기·고르기 상자 등)은 끝내고 재기로 들어간다
    cancelGesture();
    videoPlay = false;
    pickFrom = { start, url: video.url, song: fullSong };
    speedStep = 1;
  }
  // 재는 중에 영상을 지우거나 다른 영상으로 바꾸거나 건반 맞춤을 끄면 재기를 그만둔다 (한 곳에서 지킨다).
  // 그러지 않으면 단계가 남아 롤 누르기가 계속 재기로만 가고, 취소 단추도 영상 칸과 함께 사라진다.
  // 곡이 바뀌어도 그만둔다: 곡을 바꾸는 입구는 재는 동안 닫지만, 닫지 못한 길로 바뀌었으면 재기를 남기지 않는다
  $effect(() => {
    if (speedPickLost(speedStep, pickFrom, video, fullSong)) untrack(() => cancelSpeedPick());
  });
  /** 직접 재기: 영상(과 롤)을 0.5초 앞으로 */
  export function speedPickForward() {
    if (speedStep !== 2) return;
    start = Math.max(0, secondsToWhole(song.tempo, positionToSeconds(song.tempo, rat(Math.round(start * 960), 960)) + SPEED_PICK_GAP));
    speedStep = 3;
  }
  export function cancelSpeedPick() {
    if (pickFrom) start = pickFrom.start;
    pickFrom = undefined;
    speedStep = 0;
  }
  /** 직접 재기 누름을 받은 때 (뒤따르는 두 번 누름을 편집으로 보내지 않게) */
  let lastPickPress = -Infinity;
  /** 직접 재기 중 롤을 누름: 첫 점, 0.5초 뒤 같은 음의 점 ("0.5초 앞으로"를 기다리는 동안의 누름은 아무것도 하지 않는다) */
  function speedPickDown(e: PointerEvent) {
    if (!pickFrom) return;
    const r = speedPickPress(speedStep, pickFrom.y, videoYAt(e));
    if (r.done) {
      cancelSpeedPick();
      const speed = r.done.speed;
      if (speed !== undefined && video) video = { ...video, speed };
      onspeedpicked?.(speed);
      return;
    }
    if (r.step !== speedStep) {
      pickFrom = { ...pickFrom, ...(r.firstY !== undefined ? { y: r.firstY } : {}) };
      speedStep = r.step;
    }
  }

  /** 건반 맞춤이 켜져 있고 영상 크기를 알면 원래 크기 + 행렬로 깐다 */
  const videoStyle = $derived.by(() => {
    if (!video?.fit || !videoSize) return undefined;
    const [w, h] = videoSize;
    return { width: `${w}px`, height: `${h}px`, transform: `matrix(${videoMatrix(view, video, w, h).join(",")})` };
  });

  const active = $derived(song.tracks.find((t) => t.id === activeTrackId));
  const activeLocked = $derived(!!active && !!locked?.has(active.id));
  // 트랙을 바꾸면 그 트랙에 없는 고르기(앞 트랙의 숨은 고르기)를 버린다
  let selectionTrack: string | undefined;
  $effect(() => {
    const id = activeTrackId;
    if (id === selectionTrack) return;
    selectionTrack = id;
    const own = new Set(active?.notes.map((n) => n.id) ?? []);
    const kept = [...selected].filter((x) => own.has(x));
    if (kept.length !== selected.size) selected = new Set(kept);
  });
  /** 고른 트랙에서 고른 음들 (시작 순) */
  const selectedNotes = $derived(active ? active.notes.filter((n) => selected.has(n.id)) : []);

  // 음량 레인: 레인 트랙의 이음 사슬마다 막대 하나. 붓은 손이 지나간 막대마다 그 높이 값, 직선은 누른 자리에서 뗀 자리까지.
  // 여러 트랙을 같이 고르면(트랙 목록 Ctrl+클릭) 멜로디 트랙은 그은 값, 나머지는 그 순간 높이 자리마다 차이를 더한다
  const volumeRange = $derived((PROFILES[song.meta.profileId] ?? MOBILE_PROFILE).volume);
  /** 레인에 그리는 트랙: 고른 트랙이 먼저, 같이 고른 트랙(보이는 것만)이 뒤에 */
  const laneTracks = $derived.by((): LaneTrack[] => {
    if (!active) return [];
    const extra = (laneTrackIds ?? []).filter((id) => id !== active.id);
    const tracks = [active, ...extra.map((id) => song.tracks.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t)];
    return tracks.map((t) => ({ id: t.id, notes: t.notes, melody: !!melodyIds?.has(t.id), locked: !!locked?.has(t.id) }));
  });
  const laneList = $derived(laneItems(laneTracks, selected));
  const lane = new LaneGesture();
  /** 펼친 레인 높이 끌기 */
  let laneResize: { id: number; x0: number; y0: number; size: number } | undefined;

  function laneTime(x: number, y: number): number {
    const along = orientation === "horizontal" ? x - KEYBOARD : height - KEYBOARD - y;
    return Math.max(0, start + along / pxPerWhole);
  }

  function laneDown(e: PointerEvent, x: number, y: number) {
    if (e.button !== 0) return;
    if (!lane.start(view, x, y, laneTime(x, y), laneList, volumeRange, touchLike(e), e.shiftKey)) return;
    host.focus();
    canvas.setPointerCapture(e.pointerId);
  }

  function laneMove(e: PointerEvent) {
    const [x, y] = canvasXY(e);
    lane.move(view, x, y, laneTime(x, y), laneList, volumeRange, touchLike(e));
  }

  function laneUp() {
    const edits = lane.finish(song.tracks);
    if (edits.length === 0) return;
    if (edits.length === 1 && !onvolumes) onnotes(edits[0]!.trackId, edits[0]!.notes, "음량 레인");
    else onvolumes?.(edits, "음량 레인");
  }

  function laneHoverAt(e: PointerEvent, x: number, y: number) {
    lane.hoverAt(laneTime(x, y), laneList, activeTrackId, pxPerWhole);
    const shape = laneList.some((it) => it.editable) ? "crosshair" : "not-allowed";
    if (e.pointerType === "mouse" && canvas.style.cursor !== shape) canvas.style.cursor = shape;
  }

  function onLaneResizeDown(e: PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // 얇은 띠에서 끌기 시작해도 그대로 크게 펼쳐진다
    laneResize = { id: e.pointerId, x0: e.clientX, y0: e.clientY, size: volumeLane.state === "expanded" ? laneReserved - LANE_GUTTER : laneThickness() };
  }

  function onLaneResizeMove(e: PointerEvent) {
    const r = laneResize;
    if (!r || r.id !== e.pointerId) return;
    // 음 칸 쪽으로 끌면 커진다 (가로 롤은 위, 세로 롤은 왼쪽)
    const grow = orientation === "horizontal" ? r.y0 - e.clientY : r.x0 - e.clientX;
    const want = r.size + grow;
    if (volumeLane.state !== "expanded") {
      if (want < LANE_MIN) return;
      volumeLane.state = "expanded";
    }
    volumeLane.size = Math.round(Math.min(Math.max(LANE_MIN, laneRoom()), Math.max(LANE_MIN, want)));
  }

  function onLaneResizeUp(e: PointerEvent) {
    if (laneResize?.id !== e.pointerId) return;
    laneResize = undefined;
    saveVolumeLane({ state: volumeLane.state, size: volumeLane.size });
  }

  // 방향을 바꾸면 음 축의 기준을 그 방향에 맞는 자리로 옮긴다. 실제로 바뀔 때만
  // (기억한 확대로 다시 만들었으면 그때 방향에서 시작해, 같은 방향이면 기억한 음 자리를 덮지 않는다)
  let lastOrientation: Orientation | undefined = carry.zoom?.orientation;
  $effect(() => {
    if (orientation === lastOrientation) return;
    lastOrientation = orientation;
    edgePitch = orientation === "horizontal" ? 84 : 36;
    // 떨어지는 음 영상은 세로 롤에서 본다: 세로로 바꾸면 롤을 영상 건반에 맞춘다
    if (orientation === "vertical" && video?.fit && videoSize) fitVideo();
  });

  // 보던 자리·확대를 앱에 알린다 (휠·스크롤바·확대·따라가기·reveal·fitAll 등 어느 길로 바뀌어도)
  $effect(() => {
    const [from, to] = visibleTime(view);
    const place = { start, span: to - from };
    const zoom = { pxPerWhole, pxPerKey, edgePitch, orientation };
    untrack(() => onmemory?.(place, zoom, carry.work));
  });

  // 재생 위치가 화면 밖으로 나가면 따라간다
  // 건반에 맞춘 배경 영상이 있거나 "계속 흐르기"를 골랐으면 계속 흘려 건반 선 = 지금 재생 위치로 둔다 (영상 속 음과 롤 음이 겹친다)
  $effect(() => {
    if (head === undefined) return;
    if (videoStyle || rollFlow.mode === "flow") {
      start = Math.max(0, head);
      return;
    }
    const [from, to] = visibleTime(view);
    if (head < from || head > to - (to - from) * 0.1) start = Math.max(0, head - (to - from) * 0.1);
  });

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      width = Math.max(100, Math.floor(entry.contentRect.width));
      height = Math.max(100, Math.floor(entry.contentRect.height));
      // 처음 크기를 알았을 때: 앞 보기에서 보이던 재생 위치가 이 화면에서도 보이게
      if (carryPending) {
        carryPending = false;
        const [from, to] = visibleTime(view);
        start = carryViewStart(carry.place, to - from, carry.cursor);
      }
    });
    observer.observe(host);
    // 휠로 화면을 움직일 때 페이지가 같이 스크롤되지 않게 (passive가 아닌 리스너가 필요)
    canvas.addEventListener("wheel", onwheel, { passive: false });
    return () => {
      observer.disconnect();
      canvas.removeEventListener("wheel", onwheel);
      // 사라질 때(곡을 다시 열거나 타브로 바꿀 때) 이벤트 줄 길게 누르기 타이머를 지운다 (옛 곡 자리로 창이 열리지 않게)
      endEventPress();
    };
  });

  function cssVar(name: string): string {
    return getComputedStyle(host).getPropertyValue(name).trim() || "#888";
  }

  $effect(() => {
    void fonts.loaded;
    void showEvents;
    void themeKey;
    if (!canvas) return;
    drawRoll(canvas, {
      view,
      song,
      activeId: active?.id,
      dragNotes: drag ? (drag.mode === "move" ? [drag.note, ...drag.moved] : [drag.note]) : [],
      selected,
      box: boxing?.from ? undefined : boxing,
      head,
      division,
      overVideo: !!video,
      cursorAt: cursor,
      range: marking ?? loop,
      colors,
      ruler: rulerSize(),
      look,
      wave: wave ? { ...wave, offset: waveDrag?.live ? waveDrag.offset : wave.offset, at: eventsSize(), size: WAVE } : undefined,
      showEvents,
      barDrag: barDrag?.live ? { bar: barDrag.bar, to: barDrag.to } : undefined,
      pickedEvent,
      eventDrag: eventPress?.live && eventPress.label && movable(eventPress.label) ? { label: eventPress.label, to: eventPress.to } : undefined,
      lightKeys,
      canonicalOf,
      volumeLabels: volumeLabels.mode,
      lane: laneReserved > 0 ? { ...lane.draw(laneList), label: t("ui.laneName") } : undefined,
      css: cssVar,
    });
  });


  // Shift+클릭 = 재생 커서, Shift+끌기 = 반복 구간
  let marking = $state.raw<[number, number] | undefined>(undefined);

  function pointer(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const at = fromScreen(view, e.clientX - rect.left, e.clientY - rect.top);
    // 화면 끝에 반쯤 보이는 칸이 있어도 음 높이 범위 밖에는 음을 만들지 않는다
    return { ...at, pitch: Math.max(pitchRange[0], Math.min(pitchRange[1], at.pitch)) };
  }

  /** 원곡 파형 띠 두께 */
  const WAVE = 32;
  /** 마디 번호 줄 두께 (이벤트를 켜면 두 줄) */
  function eventsSize(): number {
    return showEvents ? eventsBottom(view) : BAR_ROW;
  }

  // 이벤트 줄 누르기: 라벨을 끌면 옮기고, 길게 누르면(터치·펜) 고치기 창, 그냥 떼면 그 자리로 커서
  type EventPress = { label?: EventLabel; row: 0 | 1; at: number; x0: number; y0: number; slop: number; live: boolean; to: number; timer?: ReturnType<typeof setTimeout> };
  let eventPress = $state.raw<EventPress | undefined>(undefined);
  const LONG_PRESS_MS = 500;

  function canvasXY(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function labelUnder(e: PointerEvent | MouseEvent): EventLabel | undefined {
    if (!showEvents) return undefined;
    const [x, y] = canvasXY(e);
    return eventAt(eventLabels(view, song), x, y, "pointerType" in e && touchLike(e as PointerEvent));
  }

  /** 라벨 하나를 끌어 옮길 수 있는지: 템포(곡 처음 것은 빼고)와 마커 */
  function movable(l: EventLabel): boolean {
    return (l.kind === "tempo" && cmp(l.at, rat(0)) > 0) || l.kind === "marker";
  }

  function openEvent(label: EventLabel | undefined, row: 0 | 1, at: number) {
    onevent?.(label ? { label, kind: label.kind, at: label.at, work: carry.work } : { kind: row === 0 ? "tempo" : "marker", at: snapNearest(at, division), work: carry.work });
  }

  // 파형 띠에서 마디선 끌기: 놓은 자리의 원곡 박에 그 마디가 오도록 템포를 맞춘다
  /** 파형 띠에서 마디선 끌기. grab: 누른 곡 위치 (잡은 자리와 마디선의 차이를 지킨다) */
  type BarDrag = { bar: number; grab: number; x0: number; y0: number; slop: number; live: boolean; to: number };
  let barDrag = $state.raw<BarDrag | undefined>(undefined);
  /** 파형 띠의 빈 곳을 끌어 원곡을 앞뒤로 옮기기 (영상 편집처럼). offset: 끄는 동안의 어긋남(초) */
  type WaveDrag = { grab: number; x0: number; y0: number; slop: number; live: boolean; offset: number };
  let waveDrag = $state.raw<WaveDrag | undefined>(undefined);

  /** 파형 띠 안인지 */
  function inWave(e: PointerEvent): boolean {
    if (!wave) return false;
    const [x, y] = canvasXY(e);
    const along = orientation === "horizontal" ? y : x;
    return along >= eventsSize() && along < eventsSize() + WAVE;
  }

  /** 누른 자리 가까이의 마디선 (곡 처음 마디선은 빼고) */
  function barNear(e: PointerEvent, time: number): number | undefined {
    const [from, to] = visibleTime(view);
    const reach = (touchLike(e) ? 14 : 8) / pxPerWhole;
    let best: number | undefined;
    for (const gl of gridLines(song.timeSig, from, to)) {
      if (gl.kind !== "measure" || gl.at <= 0) continue;
      if (Math.abs(gl.at - time) <= reach && (best === undefined || Math.abs(gl.at - time) < Math.abs(best - time))) best = gl.at;
    }
    return best;
  }

  function endEventPress() {
    if (eventPress?.timer) clearTimeout(eventPress.timer);
    eventPress = undefined;
  }
  /** 누르면 그 자리로 가는 줄 전체: 마디 번호(+ 이벤트) + 원곡 파형 */
  function rulerSize(): number {
    return eventsSize() + (wave ? WAVE : 0);
  }

  function stripKey(e: PointerEvent): number {
    const rect = canvas.getBoundingClientRect();
    return keyAt(view, e.clientX - rect.left, e.clientY - rect.top);
  }

  function inRuler(e: PointerEvent): boolean {
    const rect = canvas.getBoundingClientRect();
    return orientation === "horizontal" ? e.clientY - rect.top < rulerSize() : e.clientX - rect.left < rulerSize();
  }

  function hit(notes: readonly Note[], time: number, pitch: number): Note | undefined {
    return notes.find((n) => n.pitch === pitch && toFloat(n.start) <= time && time < toFloat(n.start) + toFloat(n.dur));
  }

  const touchLike = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";

  /** 누른 자리의 음 (아주 짧아 좁게 그려진 음은 누를 자리를 넓혀 찾는다) */
  function hitNear(notes: readonly Note[], time: number, pitch: number, e: PointerEvent): Note | undefined {
    return noteNear(notes, time, pitch, pxPerWhole, touchLike(e));
  }

  /** 음을 잡은 자리가 길이 바꾸기 자리인지 */
  function onResizeEdge(n: Note, time: number, e: PointerEvent): boolean {
    return isResizeGrab(n, time, pxPerWhole, touchLike(e));
  }

  // 롤이 사라질 때(타브 보기로 바꾸기 등) 울리던 미리듣기를 끈다
  $effect(() => () => {
    if (sounding !== undefined) onpreview?.(sounding, false);
    sounding = undefined;
  });

  /** 지금 미리듣기로 울리는 높이. 떼거나 다른 건반으로 옮기면 끈다 */
  let sounding: number | undefined;
  /** 건반 띠를 누르고 있는지 (끌면 건반을 따라 소리를 바꾼다) */
  let onKeys = false;

  function preview(pitch: number | undefined) {
    if (pitch === sounding) return;
    if (sounding !== undefined) onpreview?.(sounding, false);
    sounding = pitch;
    if (pitch !== undefined) onpreview?.(pitch, true);
  }

  // 두 손가락 집기(아이패드 등): 시간 축·음 축을 손가락 벌린 방향대로 확대·축소하고, 가운데를 따라 옮긴다
  const pinch = new Pinch();
  let pinchStart: { pxPerWhole: number; pxPerKey: number; start: number; edgePitch: number } | undefined;

  function canvasPoint(e: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  /** 하던 한 손가락 동작을 끝낸다 (음을 넣거나 옮기던 것은 반영하지 않는다) */
  function cancelGesture() {
    endEventPress();
    lane.cancel();
    barDrag = undefined;
    waveDrag = undefined;
    erasing = false;
    drag = undefined;
    marking = undefined;
    boxing = undefined;
    onKeys = false;
    preview(undefined);
  }

  function applyPinch(f: PinchFrame) {
    const s = pinchStart;
    if (!s) return;
    const horizontal = orientation === "horizontal";
    const [ti, pi] = horizontal ? [0, 1] : [1, 0];
    // 시간 축: 화면 시작에서 그 점까지 거리(px)
    const along = (pt: readonly [number, number]) => (horizontal ? pt[0] - KEYBOARD : height - KEYBOARD - pt[1]);
    const midTime = s.start + along(f.mid0) / s.pxPerWhole;
    pxPerWhole = Math.min(2000, Math.max(5, s.pxPerWhole * pinchRatio(f.gap0[ti]!, f.gap[ti]!)));
    start = Math.max(0, midTime - along(f.mid) / pxPerWhole);
    const k = Math.min(40, Math.max(4, Math.round(s.pxPerKey * pinchRatio(f.gap0[pi]!, f.gap[pi]!))));
    const next = horizontal
      ? s.edgePitch - f.mid0[1] / s.pxPerKey + f.mid[1] / k
      : s.edgePitch + f.mid0[0] / s.pxPerKey - f.mid[0] / k;
    pxPerKey = k;
    edgePitch = Math.min(127, Math.max(0, Math.round(next)));
  }

  /** 지우개로 문지르는 중 */
  let erasing = false;

  /** 지우개: 고른 트랙에서 그 자리의 음을 지운다 */
  function eraseAt(e: PointerEvent) {
    const at = pointer(e);
    if (!active || activeLocked || at.time === undefined) return;
    const own = hitNear(active.notes, at.time, at.pitch, e);
    if (!own) return;
    onnotes(active.id, removeNotes(active.notes, new Set([own.id])), "음 지우기");
    if (selected.has(own.id)) selected = new Set([...selected].filter((id) => id !== own.id));
  }

  function onpointerdown(e: PointerEvent) {
    // 펜·터치: 길게 누르거나 끌 때 브라우저가 글자 고르기·복사를 하지 않게
    if (e.pointerType !== "mouse") e.preventDefault();
    // 영상 속도 직접 재기 중이면 누른 자리는 음을 찍지 않고 재기에 쓴다
    // 재는 중이면 어느 단계든 보통 편집(음 넣기·고르기)으로 가지 않는다
    if (speedStep !== 0) {
      lastPickPress = e.timeStamp;
      speedPickDown(e);
      return;
    }
    if (pinch.down(e, canvasPoint(e))) {
      cancelGesture();
      pinchStart = { pxPerWhole, pxPerKey, start, edgePitch };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (pinch.active) return;
    {
      // 음량 레인: 도구와 상관없이 늘 v 그리기 (지우개·가위도)
      const [lx, ly] = canvasXY(e);
      if (inLane(view, lx, ly)) {
        laneDown(e, lx, ly);
        return;
      }
    }
    // 이벤트 라벨 오른쪽 클릭: 고치기 창 (지우기도 거기서)
    if (e.button === 2 && showEvents && inRuler(e)) {
      const label = labelUnder(e);
      const [x, y] = canvasXY(e);
      const row = eventRow(view, x, y);
      const at = pointer(e).time;
      if (label) openEvent(label, label.kind === "tempo" ? 0 : 1, toFloat(label.at));
      else if (row !== undefined && at !== undefined) openEvent(undefined, row, at);
      return;
    }
    // 오른쪽 클릭: 고른 트랙의 음을 지운다
    if (e.button === 2) {
      const at = pointer(e);
      const own = active && !activeLocked && at.time !== undefined ? hitNear(active.notes, at.time, at.pitch, e) : undefined;
      if (active && own) {
        onnotes(active.id, removeNotes(active.notes, new Set([own.id])), "음 지우기");
        if (selected.has(own.id)) selected = new Set([...selected].filter((id) => id !== own.id));
      }
      return;
    }
    if (e.button !== 0) return;
    const at = pointer(e);
    if (eraser && at.time !== undefined && !inRuler(e)) {
      host.focus();
      erasing = true;
      eraseAt(e);
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (at.time !== undefined && onalignbar && inWave(e)) {
      const bar = barNear(e, at.time);
      if (bar !== undefined) {
        barDrag = { bar, grab: at.time, x0: e.clientX, y0: e.clientY, slop: touchLike(e) ? 8 : 3, live: false, to: bar };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (at.time !== undefined && wave && onwaveoffset && inWave(e)) {
      waveDrag = { grab: at.time, x0: e.clientX, y0: e.clientY, slop: touchLike(e) ? 8 : 3, live: false, offset: wave.offset };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const [ex, ey] = canvasXY(e);
    const row = showEvents && at.time !== undefined ? eventRow(view, ex, ey) : undefined;
    // 이벤트 줄 밖을 누르면 고른 라벨을 놓는다
    if (row === undefined && pickedEvent) onpickevent?.(undefined);
    if (at.time !== undefined && row !== undefined) {
      // 이벤트 줄: 떼면 커서, 라벨을 끌면 옮기기, 길게 누르면 고치기 창
      const label = labelUnder(e);
      const time = at.time;
      const press: EventPress = { row, at: time, x0: e.clientX, y0: e.clientY, slop: touchLike(e) ? 8 : 3, live: false, to: time, ...(label ? { label } : {}) };
      if (touchLike(e))
        press.timer = setTimeout(() => {
          if (eventPress !== press || press.live) return;
          eventPress = undefined;
          openEvent(label, row, time);
        }, LONG_PRESS_MS);
      eventPress = press;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (at.time !== undefined && inRuler(e)) {
      // 마디 번호 줄: 그 자리로 커서, 재생 중이면 거기서부터
      onseek?.(toFloat(snapNearest(at.time, division)));
      return;
    }
    if (at.time === undefined) {
      // 건반 띠: 누르는 동안 그 음을 들려준다 (그린 건반 모양대로 판정)
      onKeys = true;
      preview(stripKey(e));
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    host.focus();
    if (tool === "split" && active && !activeLocked && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      // 가위: 누른 음을 가까운 격자에서 자른다. 음 밖을 누르면 아무것도 안 한다
      const own = hitNear(active.notes, at.time, at.pitch, e);
      if (own) splitNoteAt(own.id, snapNearest(at.time, division));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && active) {
      // Ctrl+클릭: 음을 고르기에 넣거나 뺀다. 빈 곳에서 Ctrl+끌기: 상자 안의 음을 고른다
      const own = hitNear(active.notes, at.time, at.pitch, e);
      if (own) {
        const next = new Set(selectedNotes.map((n) => n.id));
        if (next.has(own.id)) next.delete(own.id);
        else next.add(own.id);
        selected = next;
        return;
      }
      boxing = { t0: at.time, p0: at.pitch, t1: at.time, p1: at.pitch };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.shiftKey) {
      const t = toFloat(snapNearest(at.time, division));
      marking = [t, t];
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (active && ((tool === "select" && !selectMove) || activeLocked)) {
      // 잠긴 고르기 도구·잠근 트랙은 음을 옮기거나 늘이지 않는다: 음을 누르면 그 음만 고르고, 끌면 상자로 고른다
      const own = hitNear(active.notes, at.time, at.pitch, e);
      if (own) {
        selectOnly(own.id);
        onpicknote?.(active.id, own, false);
        preview(own.pitch);
        boxing = { t0: at.time, p0: at.pitch, t1: at.time, p1: at.pitch, from: { id: own.id, x0: e.clientX, y0: e.clientY } };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (active && !activeLocked) {
      const own = hitNear(active.notes, at.time, at.pitch, e);
      if (own && e.altKey) {
        // Alt+클릭: 다음 음과 &로 잇거나 푼다
        selectOnly(own.id);
        tieSelected();
        return;
      }
      if (own) {
        // 고른 음 가운데 하나를 잡으면 고른 음을 모두 함께 옮긴다
        const group = selected.has(own.id) ? selectedNotes.filter((n) => n.id !== own.id) : [];
        if (!selected.has(own.id)) selectOnly(own.id);
        onpicknote?.(active.id, own, false);
        preview(own.pitch);
        const grab: Grab = { t0: at.time, p0: at.pitch, x0: e.clientX, y0: e.clientY, slop: touchLike(e) ? 8 : 3, live: false };
        // 고르기 도구(자물쇠 풀림)는 옮기기만 한다
        drag = tool !== "select" && onResizeEdge(own, at.time, e) ? { mode: "resize", note: own, original: own, ...grab } : { mode: "move", note: own, original: own, group, moved: group, ...grab };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    const other = pickOthers ? song.tracks.find((t) => t.id !== activeTrackId && !locked?.has(t.id) && hit(t.notes, at.time!, at.pitch)) : undefined;
    if (other) {
      onselecttrack(other.id);
      const picked = hit(other.notes, at.time, at.pitch);
      selectOnly(picked?.id);
      if (picked) onpicknote?.(other.id, picked, false);
      return;
    }
    if (!active) return;
    if (tool === "select" || activeLocked) {
      // 고르기 도구: 빈 곳을 끌면 상자로 고르고, 그냥 누르면 고르기를 푼다 (음은 넣지 않는다)
      boxing = { t0: at.time, p0: at.pitch, t1: at.time, p1: at.pitch };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const noteStart = snapDown(at.time, division);
    const note: Note = {
      id: freshIds("r")(),
      start: noteStart,
      dur: noteDur ?? rat(1, division),
      pitch: at.pitch,
      vol: volume ?? noteBefore(active.notes, noteStart)?.vol ?? DEFAULT_VOLUME,
      tie: "none",
    };
    selectOnly(note.id);
    preview(note.pitch);
    // 누르기만 하면 새 음 길이, 문턱을 넘겨 끌면 끈 만큼
    drag = { mode: "create", note, t0: at.time, p0: at.pitch, x0: e.clientX, y0: e.clientY, slop: touchLike(e) ? 8 : 3, live: false };
    canvas.setPointerCapture(e.pointerId);
  }

  function onpointermove(e: PointerEvent) {
    const frame = pinch.move(e, canvasPoint(e));
    if (frame) {
      applyPinch(frame);
      return;
    }
    if (pinch.active) return;
    if (lane.drag) {
      laneMove(e);
      return;
    }
    if (waveDrag && wave) {
      const w = waveDrag;
      if (!w.live && Math.hypot(e.clientX - w.x0, e.clientY - w.y0) < w.slop) return;
      const at = pointer(e);
      if (at.time === undefined) return;
      // 누른 자리의 원곡 소리가 지금 손가락 자리에 오게: 곡 s초에 원곡 s + offset초가 들린다
      const secs = wholeToSecondsFn(song.tempo);
      waveDrag = { ...w, live: true, offset: wave.offset + secs(w.grab) - secs(Math.max(0, at.time)) };
      return;
    }
    if (barDrag) {
      const b = barDrag;
      if (!b.live && Math.hypot(e.clientX - b.x0, e.clientY - b.y0) < b.slop) return;
      const at = pointer(e);
      if (at.time !== undefined) barDrag = { ...b, live: true, to: Math.max(0, b.bar + at.time - b.grab) };
      return;
    }
    if (eventPress) {
      const p = eventPress;
      if (!p.live && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < p.slop) return;
      if (p.timer) clearTimeout(p.timer);
      const at = pointer(e);
      // 라벨이 없거나 못 옮기는 라벨이면 끌기는 아무것도 안 한다 (떼도 커서를 옮기지 않는다)
      // 잡은 자리와 라벨 시작의 차이를 지켜 옮긴다
      const to = p.label && movable(p.label) && at.time !== undefined ? toFloat(snapNearest(Math.max(0, toFloat(p.label.at) + at.time - p.at), division)) : p.to;
      const { timer: _timer, ...rest } = p;
      eventPress = { ...rest, live: true, to };
      return;
    }
    if (erasing) {
      // 누르지 않고 지나가는 펜·마우스로는 지우지 않는다
      if (e.buttons === 0) erasing = false;
      else eraseAt(e);
      return;
    }
    if (onKeys) {
      preview(stripKey(e));
      return;
    }
    if (marking) {
      const at = pointer(e);
      if (at.time !== undefined) marking = [marking[0], toFloat(snapNearest(at.time, division))];
      return;
    }
    if (boxing) {
      const from = boxing.from;
      if (from && Math.hypot(e.clientX - from.x0, e.clientY - from.y0) < 8) return;
      const at = pointer(e);
      boxing = { t0: boxing.t0, p0: boxing.p0, t1: at.time ?? boxing.t1, p1: at.pitch };
      return;
    }
    if (!drag) {
      hover(e);
      return;
    }
    const at = pointer(e);
    const time = at.time ?? (orientation === "horizontal" ? start : visibleTime(view)[1]);
    const minimum = rat(1, division);
    if (!drag.live) {
      // 누르기만 하거나 손이 조금 떨린 것은 끌기가 아니다
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < drag.slop) return;
      drag = { ...drag, live: true };
    }
    // 움직인 만큼을 격자 칸 단위로 (원래 자리가 격자 밖이면 그 어긋남을 그대로 둔다)
    const step = drag.mode === "create" ? rat(0) : rat(Math.round((time - drag.t0) * division), division);
    if (drag.mode === "move") {
      const o = drag.original;
      let dt = step;
      let dp = at.pitch - drag.p0;
      // 함께 옮기는 음이 0보다 앞이나 건반 밖으로 나가지 않게 막는다
      const all = [o, ...drag.group];
      const first = all.reduce((m, n) => (cmp(n.start, m) < 0 ? n.start : m), o.start);
      if (cmp(add(first, dt), rat(0)) < 0) dt = sub(rat(0), first);
      const pitches = all.map((n) => n.pitch);
      dp = Math.min(127 - Math.max(...pitches), Math.max(-Math.min(...pitches), dp));
      const shift = (n: Note): Note => ({ ...n, start: add(n.start, dt), pitch: n.pitch + dp });
      // 옮기는 높이를 들려준다
      preview(o.pitch + dp);
      drag = { ...drag, note: shift(o), moved: drag.group.map(shift) };
    } else if (drag.mode === "resize") {
      // 격자 한 칸보다 짧던 음은 그 길이까지는 줄일 수 있다
      const floor = cmp(drag.original.dur, minimum) < 0 ? drag.original.dur : minimum;
      const dur = add(drag.original.dur, step);
      drag = { ...drag, note: { ...drag.note, dur: cmp(dur, floor) < 0 ? floor : dur } };
    } else {
      const end = snapNearest(time, division);
      const dur = sub(end, drag.note.start);
      drag = { ...drag, note: { ...drag.note, dur: cmp(dur, minimum) < 0 ? minimum : dur } };
    }
  }

  /** 마우스를 음 위에 올리면 옮기기·길이 바꾸기 자리를 커서 모양으로 알려 준다 */
  function hover(e: PointerEvent) {
    if (e.pointerType !== "mouse" || e.buttons !== 0) return;
    const [hx, hy] = canvasXY(e);
    if (inLane(view, hx, hy)) {
      laneHoverAt(e, hx, hy);
      return;
    }
    if (lane.hover) lane.hover = undefined;
    let shape = "";
    const at = pointer(e);
    if (active && !eraser && at.time !== undefined && !inRuler(e)) {
      const own = hitNear(active.notes, at.time, at.pitch, e);
      if (activeLocked) shape = own ? "pointer" : "crosshair";
      else if (tool === "select") shape = own ? (selectMove ? "move" : "pointer") : "crosshair";
      else if (tool === "split") shape = own ? (orientation === "horizontal" ? "col-resize" : "row-resize") : "";
      else if (own) shape = onResizeEdge(own, at.time, e) ? (orientation === "horizontal" ? "ew-resize" : "ns-resize") : "move";
    }
    else if (at.time !== undefined && inWave(e)) {
      // 파형 띠: 마디선 가까이는 마디선 끌기, 나머지는 파형 끌기
      const bar = onalignbar ? barNear(e, at.time) : undefined;
      shape = bar !== undefined ? (orientation === "horizontal" ? "col-resize" : "row-resize") : onwaveoffset ? "grab" : "";
    }
    if (canvas.style.cursor !== shape) canvas.style.cursor = shape;
  }

  function onpointerup(e: PointerEvent) {
    const pinching = pinch.active;
    pinch.up(e);
    if (pinching) return;
    if (lane.drag) {
      laneUp();
      return;
    }
    if (waveDrag) {
      const w = waveDrag;
      waveDrag = undefined;
      if (!w.live) onseek?.(toFloat(snapNearest(w.grab, division)));
      else onwaveoffset?.(w.offset);
      return;
    }
    if (barDrag) {
      const b = barDrag;
      barDrag = undefined;
      if (!b.live) onseek?.(b.bar);
      else if (Math.abs(b.to - b.bar) > 1e-6) onalignbar?.(rat(Math.round(b.bar * 3840), 3840), b.to);
      return;
    }
    if (eventPress) {
      const p = eventPress;
      endEventPress();
      if (!p.live) {
        onseek?.(toFloat(snapNearest(p.at, division)));
        onpickevent?.(p.label ? { kind: p.label.kind, at: p.label.at, ...(p.label.id ? { id: p.label.id } : {}) } : undefined);
      } else if (p.label && movable(p.label)) {
        const to = snapNearest(p.to, division);
        if (cmp(to, p.label.at) !== 0) oneventmove?.(p.label, to);
      }
      return;
    }
    erasing = false;
    preview(undefined);
    if (onKeys) {
      onKeys = false;
      return;
    }
    if (marking) {
      const [a, b] = marking;
      marking = undefined;
      if (a === b) {
        // 같은 자리에서 떼면 커서. 커서 위를 다시 누르면 지운다
        oncursor?.(cursor === a ? undefined : a);
        onloop?.(undefined);
      } else {
        const range: [number, number] = a < b ? [a, b] : [b, a];
        onloop?.(range);
        oncursor?.(range[0]);
      }
      return;
    }
    if (boxing) {
      const b = boxing;
      boxing = undefined;
      // 음을 누르기만 했으면 그 음 고르기 그대로
      if (!active || b.from) return;
      const [t0, t1] = b.t0 < b.t1 ? [b.t0, b.t1] : [b.t1, b.t0];
      const [p0, p1] = b.p0 < b.p1 ? [b.p0, b.p1] : [b.p1, b.p0];
      selected = new Set(
        active.notes
          .filter((n) => n.pitch >= p0 && n.pitch <= p1 && toFloat(n.start) < t1 && toFloat(n.start) + toFloat(n.dur) > t0)
          .map((n) => n.id),
      );
      return;
    }
    const d = drag;
    drag = undefined;
    if (!d || !active) return;
    if (d.mode === "move" && d.group.length > 0) {
      if (cmp(d.original.start, d.note.start) === 0 && d.original.pitch === d.note.pitch) return;
      const changes = new Map<string, Note | null>([d.note, ...d.moved].map((n) => [n.id, n]));
      onnotes(active.id, replaceNotes(active.notes, changes), "음 옮기기");
      return;
    }
    if (d.mode !== "create") {
      const o = d.original;
      if (cmp(o.start, d.note.start) === 0 && cmp(o.dur, d.note.dur) === 0 && o.pitch === d.note.pitch) return;
    }
    const label = d.mode === "create" ? "음 넣기" : d.mode === "move" ? "음 옮기기" : "음 길이";
    onnotes(active.id, placeNote(active.notes, d.note), label);
  }

  /**
   * 고른 음 바꾸기 (단축키 명령이 부른다). change가 null을 돌려주면 지운다.
   * 고른 음이 없으면 false.
   */
  /** 곡 위치(와 높이)가 보이게 롤을 옮기고 그 음을 고른다 (곡 검사에서 누를 때) */
  export function reveal(time: number, pitch?: number, noteId?: string) {
    const [from, to] = visibleTime(view);
    if (time < from || time > to - (to - from) * 0.1) start = Math.max(0, time - (to - from) * 0.15);
    if (pitch !== undefined) {
      const [low, high] = visiblePitch(view);
      const span = high - low;
      if (pitch < low + 2 || pitch > high - 2) edgePitch = orientation === "horizontal" ? Math.min(127, pitch + Math.floor(span / 2)) : Math.max(0, pitch - Math.floor(span / 2));
    }
    if (noteId) selectOnly(noteId);
  }

  /** 고른 음 모두 바꾸기 (단축키·메뉴 명령이 부른다). change가 null을 돌려주면 지운다. 고른 음이 없으면 false */
  export function editSelected(change: (n: Note) => Note | null, label: string): boolean {
    if (!active || selectedNotes.length === 0) return false;
    const changes = new Map<string, Note | null>();
    for (const n of selectedNotes) {
      const next = change(n);
      if (next !== n) changes.set(n.id, next);
    }
    if (changes.size === 0) return true;
    onnotes(active.id, replaceNotes(active.notes, changes), label);
    const removed = [...changes].filter(([, n]) => n === null).map(([id]) => id);
    if (removed.length > 0) selected = new Set([...selected].filter((id) => !removed.includes(id)));
    return true;
  }

  /** 고른 음을 앱 클립보드에 복사한다. 고른 음이 없으면 false */
  export function copySelection(): boolean {
    const clip = clipNotes(selectedNotes);
    if (!clip) return false;
    noteClipboard.clip = clip;
    return true;
  }

  /** 고른 음을 복사하고 지운다 */
  export function cutSelection(label: string): boolean {
    return copySelection() && editSelected(() => null, label);
  }

  /**
   * 복사한 음을 고른 트랙의 at 위치(없으면 복사한 원래 자리)에 붙이고 붙인 음을 고른다.
   * at이 분수(Rat)면 그 자리 그대로, 소수(화면 커서)면 가까운 칸에 맞춘다.
   * 붙인 음 끝 위치를 분수로 돌려준다 (이어 붙일 때 반올림 없이 쓰게). 붙일 게 없으면 undefined
   */
  export function pasteAt(at: Rat | number | undefined, label: string): Rat | undefined {
    const clip = noteClipboard.clip;
    if (!active || !clip) return undefined;
    const from = at === undefined ? clip.origin : typeof at === "number" ? snapNearest(at, 3840) : at;
    const pasted = pasteClip(clip, from, freshIds("p"));
    onnotes(active.id, replaceNotes(active.notes, new Map(pasted.map((n) => [n.id, n]))), label);
    selected = new Set(pasted.map((n) => n.id));
    reveal(toFloat(from));
    return add(from, clip.length);
  }

  /** 고른 트랙의 음을 모두 고른다 */
  export function selectAll(): boolean {
    if (!active) return false;
    selected = new Set(active.notes.map((n) => n.id));
    return true;
  }

  /** 고른 트랙에서 이 id의 음들을 고른다 (슬라이드 적용 뒤 만든 사슬을 바로 다시 고칠 수 있게) */
  export function selectIds(ids: readonly string[]): void {
    if (!active) return;
    const own = new Set(active.notes.map((n) => n.id));
    selected = new Set(ids.filter((id) => own.has(id)));
  }

  /** 고른 트랙에서 고른 음들 (시작 순) */
  export function selection(): readonly Note[] {
    return selectedNotes;
  }

  /** 고른 음을 다음 음과 &로 잇거나 푼다 (단축키 명령·Alt+클릭). 하나도 못 바꾸면 false */
  export function tieSelected(): boolean {
    if (!active || selectedNotes.length === 0) return false;
    const first = selectedNotes[0]!;
    let notes: Note[] | undefined = [...active.notes];
    let changed = false;
    for (const n of selectedNotes) {
      const next = toggleTie(notes, n.id);
      if (next) {
        notes = next;
        changed = true;
      }
    }
    if (!changed) return false;
    onnotes(active.id, notes, first.tie === "next" ? "이음줄 풀기" : "이음줄");
    return true;
  }

  /** 음 하나를 at에서 자르고 두 조각을 고른다. 못 자르면 false */
  function splitNoteAt(id: string, at: Rat): boolean {
    if (!active) return false;
    const done = splitNote(active.notes, id, at, freshIds("s")());
    if (!done) return false;
    const [notes, head, tail] = done;
    onnotes(active.id, notes, "음 자르기");
    selected = new Set([head.id, tail.id]);
    return true;
  }

  /** 고른 트랙에서 at 위치에 걸린 음을 자른다 (단축키·편집 메뉴, at = 재생 커서). 자를 음이 없으면 false */
  export function splitAt(at: Rat): boolean {
    if (!active || activeLocked) return false;
    const target = active.notes.find((n) => cmp(n.start, at) < 0 && cmp(at, add(n.start, n.dur)) < 0);
    return target ? splitNoteAt(target.id, at) : false;
  }

  /**
   * 고른 음 길이 ×factor (첫 음 시작 기준으로 리듬 모양을 지킨다). 고르지 않은 음은 지우거나 줄이지 않는다:
   * 그 음 앞까지만 늘리고, 늘릴 자리가 없으면 바꾸지 않고 false
   */
  export function scaleSelected(factor: Rat, label: string): boolean {
    if (!active || selectedNotes.length === 0) return false;
    const scaled = scaleNotesIn(active.notes, selectedNotes, factor);
    if (!scaled) return false;
    const byId = new Map(scaled.map((n) => [n.id, n]));
    return editSelected((n) => byId.get(n.id) ?? n, label);
  }

  /** 고른 음 가운데 높이가 같고 맞닿은 음을 한 음으로 붙인다. 붙일 것이 없으면 false */
  export function glueSelected(): boolean {
    if (!active || activeLocked || selectedNotes.length < 2) return false;
    const done = glueNotes(active.notes, selected);
    if (!done) return false;
    onnotes(active.id, done[0], "음 붙이기");
    selected = new Set(done[1].map((n) => n.id));
    return true;
  }

  /** 음을 두 번 누르면 MML 글의 그 자리로 가서 바로 입력할 수 있게 한다 */
  function ondblclick(e: MouseEvent) {
    // 재는 중의 두 번 누름은 재기 누름이다: 이벤트 창·MML 편집기로 가지 않는다
    // (마지막 점을 눌러 재기가 막 끝난 뒤 따라오는 두 번 누름도 재기 누름으로 친다)
    if (speedStep !== 0 || e.timeStamp - lastPickPress < 1000) return;
    if (inLane(view, ...canvasXY(e))) return;
    if (showEvents) {
      // 이벤트 줄 두 번 누르기: 라벨을 고치거나 그 자리에 새로
      const [x, y] = canvasXY(e);
      const row = eventRow(view, x, y);
      if (row !== undefined) {
        const label = labelUnder(e);
        const time = fromScreen(view, x, y).time;
        if (label) openEvent(label, row, toFloat(label.at));
        else if (time !== undefined) openEvent(undefined, row, time);
        return;
      }
    }
    if (!active || e.shiftKey || e.altKey || tool === "split") return;
    const rect = canvas.getBoundingClientRect();
    const at = fromScreen(view, e.clientX - rect.left, e.clientY - rect.top);
    if (at.time === undefined) return;
    const own = hit(active.notes, at.time, at.pitch);
    if (own) onpicknote?.(active.id, own, true);
  }

  function onkeydown(e: KeyboardEvent) {
    // 재는 중에는 화살표로 음을 옮기지 않는다 (Esc는 앱이 받아 재기를 그만둔다)
    if (speedStep !== 0) return;
    if (!active || activeLocked || selectedNotes.length === 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    // 화살표: 고른 음을 모두 반음·격자 한 칸씩 옮긴다
    const notes = selectedNotes;
    const along = orientation === "horizontal" ? { fwd: "ArrowRight", back: "ArrowLeft", up: "ArrowUp", down: "ArrowDown" }
      : { fwd: "ArrowUp", back: "ArrowDown", up: "ArrowRight", down: "ArrowLeft" };
    const step = rat(1, division);
    let shift: ((n: Note) => Note) | undefined;
    if (e.key === along.up && notes.every((n) => n.pitch < 127)) shift = (n) => ({ ...n, pitch: n.pitch + 1 });
    else if (e.key === along.down && notes.every((n) => n.pitch > 0)) shift = (n) => ({ ...n, pitch: n.pitch - 1 });
    else if (e.key === along.fwd) shift = (n) => ({ ...n, start: add(n.start, step) });
    else if (e.key === along.back && notes.every((n) => cmp(n.start, step) >= 0)) shift = (n) => ({ ...n, start: sub(n.start, step) });
    if (!shift) return;
    e.preventDefault();
    onnotes(active.id, replaceNotes(active.notes, new Map(notes.map((n) => [n.id, shift(n)]))), "음 옮기기");
  }

  /** 확대·축소. time = 가로(시간) 폭, pitch = 건반 한 칸 높이. factor > 1이면 확대 */
  export function zoom(axis: "time" | "pitch", factor: number) {
    if (axis === "time") pxPerWhole = Math.min(2000, Math.max(20, pxPerWhole * factor));
    else {
      // 가운데 음이 그대로 보이게 칸 높이를 바꾼다
      const [low, high] = visiblePitch(view);
      const center = (low + high) / 2;
      pxPerKey = Math.min(40, Math.max(4, Math.round(pxPerKey * factor)));
      const span = visiblePitch(view)[1] - visiblePitch(view)[0];
      edgePitch = Math.round(orientation === "horizontal" ? Math.min(127, center + span / 2) : Math.max(0, center - span / 2));
    }
  }

  /** 곡 전체가 한눈에: 시간은 곡 길이에, 음 높이는 쓰인 음 범위에 맞춘다 */
  export function fitAll() {
    const notes = song.tracks.flatMap((tr) => tr.notes);
    if (notes.length === 0) return;
    const end = Math.max(...notes.map((n) => toFloat(n.start) + toFloat(n.dur)));
    const timeAxis = orientation === "horizontal" ? width - KEYBOARD : height - KEYBOARD;
    pxPerWhole = Math.min(2000, Math.max(5, (timeAxis - 20) / Math.max(end, 0.25)));
    start = 0;
    const low = Math.min(...notes.map((n) => n.pitch)) - 2;
    const high = Math.max(...notes.map((n) => n.pitch)) + 2;
    const pitchAxis = orientation === "horizontal" ? axes(view).pitch - 28 : axes(view).pitch;
    pxPerKey = Math.min(40, Math.max(3, Math.floor(pitchAxis / (high - low + 1))));
    edgePitch = orientation === "horizontal" ? Math.min(127, high) : Math.max(0, low);
  }

  /** Alt+휠 볼륨: 잘게 오는 휠 값을 모은다 */
  let wheelVolume = 0;
  /** 이벤트 줄 휠 템포: 잘게 오는 휠 값을 모은다 */
  let wheelTempo = 0;
  function onwheel(e: WheelEvent) {
    e.preventDefault();
    // 재는 중: 볼륨·템포 휠은 받지 않고, 첫 점 전에만 화면을 움직인다
    const wheel = speedPickWheel(speedStep);
    if (wheel === "none") return;
    if (wheel === "edit" && showEvents && ontempowheel && !e.altKey && !e.ctrlKey && !e.metaKey) {
      // 이벤트 줄(마디 번호 줄 포함) 위 휠: 마우스 아래 템포 라벨, 없으면 고른 템포를 ±1 (Shift ±10)
      const [x, y] = canvasXY(e);
      const along = orientation === "horizontal" ? y : x;
      const under = along < eventsSize() ? eventAt(eventLabels(view, song), x, y, false) : undefined;
      const target = along >= eventsSize() ? undefined : under?.kind === "tempo" ? under : pickedEvent?.kind === "tempo" ? pickedEvent : undefined;
      // 템포가 없으면 평소처럼 롤을 굴린다
      if (target) {
        if (under?.kind === "tempo" && !sameEvent(under, pickedEvent)) onpickevent?.({ kind: "tempo", at: under.at });
        // Shift+휠은 브라우저가 가로(deltaX)로 바꿔 보내기도 한다
        wheelTempo += e.deltaY || e.deltaX;
        if (Math.abs(wheelTempo) < 40) return;
        ontempowheel(target.at, (wheelTempo < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1));
        wheelTempo = 0;
        return;
      }
    }
    if (e.altKey) {
      if (wheel !== "edit") return;
      // Alt+휠: 고른 음 볼륨 (마비꼬와 같은 손). 고른 음이 없으면 마우스 아래 음을 골라서
      if (!active || activeLocked || !onvolume) return;
      if (selectedNotes.length === 0) {
        const rect = canvas.getBoundingClientRect();
        const at = fromScreen(view, e.clientX - rect.left, e.clientY - rect.top);
        const own = at.time === undefined ? undefined : noteNear(active.notes, at.time, at.pitch, pxPerWhole, false);
        if (!own) return;
        selectOnly(own.id);
        onpicknote?.(active.id, own, false);
      }
      // 마우스 휠은 한 칸에 한 단계, 트랙패드처럼 잘게 오는 값은 모아서 한 단계
      wheelVolume += e.deltaY;
      if (Math.abs(wheelVolume) < 40) return;
      onvolume(wheelVolume < 0 ? 1 : -1);
      wheelVolume = 0;
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      // Ctrl+Shift+휠: 건반 높이(음 축) 확대·축소
      zoom("pitch", e.deltaY > 0 ? 0.85 : 1.18);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      zoom("time", e.deltaY > 0 ? 0.85 : 1.18);
      return;
    }
    if (e.shiftKey) {
      const keys = Math.sign(e.deltaY) * 2;
      edgePitch = Math.min(127, Math.max(0, edgePitch + (orientation === "horizontal" ? -keys : keys)));
      return;
    }
    start = Math.max(0, start + (e.deltaY + e.deltaX) / pxPerWhole);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="roll {orientation}" class:eraser bind:this={host} tabindex="0" role="application" {onkeydown}>
  {#if video}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      bind:this={videoEl}
      src={video.url}
      muted={!video.sound}
      playsinline
      preload="auto"
      style:opacity={video.opacity}
      class:fit={!!videoStyle}
      style:width={videoStyle?.width}
      style:height={videoStyle?.height}
      style:transform={videoStyle?.transform}
      onloadedmetadata={(e) => onVideoLoaded(e.currentTarget)}
      onended={() => (videoPlay = false)}
    ></video>
  {/if}
  <canvas
    bind:this={canvas}
    style:width="{width}px"
    style:height="{height}px"
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    {ondblclick}
    oncontextmenu={(e) => e.preventDefault()}
    onpointerleave={() => {
      if (!lane.drag) lane.hover = undefined;
    }}
    onpointercancel={(e) => {
      pinch.up(e);
      endEventPress();
      lane.cancel();
      barDrag = undefined;
      waveDrag = undefined;
      erasing = false;
      drag = undefined;
      onKeys = false;
      preview(undefined);
    }}
    onlostpointercapture={() => {
      // 끄는 도중 다른 곳에서 손을 떼도 미리듣기는 멈춘다
      if (onKeys) {
        onKeys = false;
        preview(undefined);
      }
    }}
  ></canvas>
  {#if handles}
    {@const keyLine = orientation === "vertical" ? height - KEYBOARD : KEYBOARD}
    {#each [["low", handles.low], ["high", handles.high]] as const as [kind, at] (kind)}
      <div
        class="vhandle edge"
        role="slider"
        aria-valuenow={kind === "low" ? video?.low : video?.high}
        tabindex="-1"
        aria-label={t(kind === "low" ? "ui.videoLow" : "ui.videoHigh")}
        title={t(kind === "low" ? "ui.videoLow" : "ui.videoHigh")}
        style={orientation === "vertical"
          ? `left:${at - 6}px;top:0;width:12px;height:${keyLine}px`
          : `top:${at - 6}px;left:${keyLine}px;height:12px;right:0`}
        onpointerdown={(e) => onHandleDown(e, kind)}
        onpointermove={onHandleMove}
        onpointerup={onHandleUp}
        onpointercancel={onHandleUp}
      ></div>
    {/each}
    <div
      class="vhandle move"
      role="slider"
      aria-valuenow={video?.keyLine}
      tabindex="-1"
      aria-label={t("ui.videoHandleMove")}
      title={t("ui.videoHandleMove")}
      style={orientation === "vertical"
        ? `left:${handles.from}px;width:${handles.to - handles.from}px;top:${keyLine - 6}px;height:12px`
        : `top:${handles.from}px;height:${handles.to - handles.from}px;left:${keyLine - 6}px;width:12px`}
      onpointerdown={(e) => onHandleDown(e, "move")}
      onpointermove={onHandleMove}
      onpointerup={onHandleUp}
      onpointercancel={onHandleUp}
    ></div>
  {/if}
  {#if laneReserved > 0 && laneTracks.length > 1}
    <!-- 여러 트랙에 그리는 중: 트랙 수와 높이 자리별 차이 (펼쳤을 때만 고친다). 레인을 가리지 않게 레인 바로 바깥에 -->
    <div
      class="lane-multi"
      title={t("ui.laneMultiHelp")}
      style={orientation === "horizontal" ? `left:${KEYBOARD + 4}px;top:${height - laneReserved - 24}px` : `right:${laneReserved + 2}px;top:20px`}
    >
      {#if onlanetoggle}
        <LaneTrackPicker tracks={song.tracks} players={song.players} activeId={activeTrackId} laneIds={laneTrackIds ?? []} ontoggle={onlanetoggle} onclear={onclearlane} label={t("ui.laneTracks", { n: laneTracks.length })} />
      {:else}
        <span>{t("ui.laneTracks", { n: laneTracks.length })}</span>
      {/if}
      {#if volumeLane.state === "expanded"}
        {#each [["top", "ui.laneTop"], ["middle", "ui.laneMiddle"], ["bottom", "ui.laneBottom"]] as const as [rank, label] (rank)}
          <label
            >{t(label)}
            <input
              type="number"
              min="-15"
              max="15"
              value={volumeLane.offsets[rank]}
              onchange={(e) => {
                const n = Math.round(Number(e.currentTarget.value));
                if (Number.isFinite(n)) saveVolumeLane({ offsets: { ...volumeLane.offsets, [rank]: Math.min(15, Math.max(-15, n)) } });
              }}
            /></label
          >
        {/each}
      {/if}
      {#if onclearlane}
        <button onclick={onclearlane} title={t("ui.laneClear")} aria-label={t("ui.laneClear")}>×</button>
      {/if}
    </div>
  {/if}
  <!-- 음량 레인 단추 (건반 띠 쪽 모서리). 접으면 단추 하나만 -->
  {#if volumeLane.state === "collapsed"}
    <div class="lane-corner collapsed" title={t("ui.laneHelp")}>
      <button onclick={() => saveVolumeLane({ state: "compact" })} title={t("ui.laneOpen")} aria-label={t("ui.laneOpen")}>{t("ui.laneName")} ▲</button>
    </div>
  {:else}
    <div
      class="lane-corner"
      title={t("ui.laneHelp")}
      style={orientation === "horizontal" ? `height:${laneReserved}px;width:${KEYBOARD}px` : `width:${laneReserved}px;height:${KEYBOARD}px`}
    >
      <div class="row">
        {#if orientation === "horizontal" || volumeLane.state === "expanded"}
          <!-- 이름표를 누르면 같이 그릴 트랙 고르기 (터치에는 Ctrl+클릭이 없다) -->
          {#if onlanetoggle}
            <LaneTrackPicker buttonClass="name" tracks={song.tracks} players={song.players} activeId={activeTrackId} laneIds={laneTrackIds ?? []} ontoggle={onlanetoggle} onclear={onclearlane} label={`${t("ui.laneName")} ▾`} />
          {:else}
            <span class="name">{t("ui.laneName")}</span>
          {/if}
        {/if}
        {#if volumeLane.state === "expanded"}
          <button onclick={() => saveVolumeLane({ state: "compact" })} title={t("ui.laneShrink")} aria-label={t("ui.laneShrink")}>▼</button>
        {:else}
          <button onclick={() => saveVolumeLane({ state: "expanded" })} title={t("ui.laneExpand")} aria-label={t("ui.laneExpand")}>▲</button>
        {/if}
        <button onclick={() => saveVolumeLane({ state: "collapsed" })} title={t("ui.laneCollapse")} aria-label={t("ui.laneCollapse")}>×</button>
      </div>
      {#if volumeLane.state === "expanded"}
        <div class="row">
          <button class="mode" class:on={volumeLane.mode === "brush"} onclick={() => saveVolumeLane({ mode: "brush" })}>{t("ui.laneBrush")}</button>
          <button class="mode" class:on={volumeLane.mode === "line"} onclick={() => saveVolumeLane({ mode: "line" })}>{t("ui.laneLine")}</button>
        </div>
      {/if}
    </div>
    <!-- 높이 손잡이: 얇은 띠에서도 끌면 크게 펼쳐진다. 펜·손가락으로 잡기 쉽게 12px -->
    <div
      class="lane-resize"
      role="separator"
      aria-orientation={orientation === "horizontal" ? "horizontal" : "vertical"}
      aria-label={t("ui.laneResize")}
      title={t("ui.laneResize")}
      style={orientation === "horizontal"
        ? `left:${KEYBOARD}px;right:18px;top:${height - laneReserved - 6}px;height:12px`
        : `top:18px;bottom:${KEYBOARD}px;left:${width - laneReserved - 6}px;width:12px`}
      onpointerdown={onLaneResizeDown}
      onpointermove={onLaneResizeMove}
      onpointerup={onLaneResizeUp}
      onpointercancel={onLaneResizeUp}
      ondblclick={() => saveVolumeLane({ state: volumeLane.state === "expanded" ? "compact" : "expanded" })}
    ><span class="grip"></span></div>
  {/if}
  <!-- 음 높이 스크롤 (가로 롤은 오른쪽 세로, 세로 롤은 위쪽 가로) -->
  <input
    class="scroll pitch"
    style={laneReserved > 0 ? (orientation === "horizontal" ? `bottom:${laneReserved + 4}px` : `right:${laneReserved + 4}px`) : undefined}
    type="range"
    aria-label={t("ui.rollScrollPitch")}
    title={t("ui.rollScrollPitch")}
    min={orientation === "horizontal" ? pitchRange[0] + pitchSpan : pitchRange[0]}
    max={orientation === "horizontal" ? pitchRange[1] : pitchRange[1] - pitchSpan}
    step="1"
    value={edgePitch}
    oninput={(e) => (edgePitch = Number(e.currentTarget.value))}
    onpointerdown={(e) => e.stopPropagation()}
  />
  <!-- 시간 스크롤 (가로 롤은 아래 가로, 세로 롤은 오른쪽 세로) -->
  <input
    class="scroll time"
    type="range"
    aria-label={t("ui.rollScrollTime")}
    title={t("ui.rollScrollTime")}
    min="0"
    max={timeMax}
    step="0.0625"
    value={start}
    oninput={(e) => (start = Number(e.currentTarget.value))}
    onpointerdown={(e) => e.stopPropagation()}
  />
  <!-- 확대·축소 단추: 롤 안 시간 스크롤바 끝 모서리 (도구줄이 좁아 건반 높이가 메뉴로 들어가도 바로 누르게). 레인이 열려 있으면 그 위로 -->
  <div class="zoom-corner" style={zoomCornerStyle} role="group" aria-label={t("ui.fitAll")} onpointerdown={(e) => e.stopPropagation()}>
    <button class="icon" title={t("ui.fitAllHelp")} aria-label={t("ui.fitAll")} onclick={fitAll}><Icon name="maximize" size={14} /></button>
    <button class="icon" title={t("ui.zoomTimeOut")} aria-label={t("ui.zoomTimeOut")} onclick={() => zoom("time", 1 / 1.25)}>
      <Icon name="arrows-h" size={14} /><Icon name="minus" size={12} />
    </button>
    <button class="icon" title={t("ui.zoomTimeIn")} aria-label={t("ui.zoomTimeIn")} onclick={() => zoom("time", 1.25)}>
      <Icon name="arrows-h" size={14} /><Icon name="plus" size={12} />
    </button>
    {#if !cornerNarrow}
      <button class="icon" title={t("ui.zoomPitchOut")} aria-label={t("ui.zoomPitchOut")} onclick={() => zoom("pitch", 1 / 1.25)}>
        <Icon name="arrows-v" size={14} /><Icon name="minus" size={12} />
      </button>
      <button class="icon" title={t("ui.zoomPitchIn")} aria-label={t("ui.zoomPitchIn")} onclick={() => zoom("pitch", 1.25)}>
        <Icon name="arrows-v" size={14} /><Icon name="plus" size={12} />
      </button>
    {/if}
  </div>
</div>
<style>
  /* 지우개 모드: 마우스 모양으로도 알 수 있게 */
  .roll.eraser canvas {
    cursor: not-allowed;
  }
  .roll {
    position: relative;
    /* 칸 높이를 다 쓴다 (캔버스 크기는 ResizeObserver가 따라간다) */
    flex: 1 1 0;
    min-height: 0;
    /* 펜·손가락으로 긋다가 글자가 골라지거나 복사 메뉴가 뜨지 않게 */
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
    outline: none;
    touch-action: none;
  }
  .roll:focus-visible {
    border-color: var(--accent);
  }
  /* 스크롤바: 롤 가장자리에 얇게 */
  .scroll {
    position: absolute;
    margin: 0;
    opacity: 0.55;
    accent-color: var(--accent);
    z-index: 2;
  }
  .scroll:hover,
  .scroll:focus-visible {
    opacity: 1;
  }
  /* 세로 막대: 위가 큰 값 (높은 음 / 나중 시간) */
  .horizontal .scroll.pitch,
  .vertical .scroll.time {
    writing-mode: vertical-lr;
    direction: rtl;
    right: 2px;
    top: 16px;
    bottom: 16px;
    width: 14px;
  }
  .horizontal .scroll.time {
    left: 60px;
    right: 20px;
    bottom: 2px;
    height: 14px;
  }
  .vertical .scroll.pitch {
    left: 16px;
    right: 20px;
    top: 2px;
    height: 14px;
  }

  /* 확대·축소 단추: 스크롤바처럼 평소 옅게, 올리면 진하게. 터치로도 누르게 28px */
  .zoom-corner {
    position: absolute;
    z-index: 3;
    display: flex;
    gap: 2px;
    opacity: 0.55;
  }
  .zoom-corner:hover,
  .zoom-corner:focus-within {
    opacity: 1;
  }
  .zoom-corner button {
    min-width: 28px;
    height: 28px;
    padding: 0 4px;
    gap: 1px;
  }

  /* 음량 레인 단추: 건반 띠와 레인이 만나는 모서리 */
  .lane-corner {
    position: absolute;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px;
    box-sizing: border-box;
  }
  .lane-corner .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
  }
  /* 이름표: 이 띠가 음량을 그리는 곳이라는 걸 보이게 */
  .lane-corner .name,
  .lane-corner :global(button.name) {
    font-size: 10px;
    font-weight: 700;
    line-height: 12px;
    color: var(--accent);
    white-space: nowrap;
  }
  /* 이름표 단추: 글자는 이름표 그대로, 누를 수 있게 테두리만 옅게 */
  .lane-corner :global(button.name) {
    flex: 1 1 100%;
    height: auto;
    min-height: 14px;
    padding: 0 2px;
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 3px;
    cursor: pointer;
  }
  .horizontal .lane-corner .name,
  .horizontal .lane-corner :global(button.name) {
    flex-basis: 100%;
    text-align: center;
  }
  .horizontal .lane-corner {
    left: 0;
    bottom: 0;
  }
  .vertical .lane-corner {
    right: 0;
    bottom: 0;
  }
  .lane-corner.collapsed {
    width: auto;
    height: auto;
  }
  .lane-corner button {
    flex: 1 1 auto;
    min-width: 0;
    height: 20px;
    padding: 0 1px;
    font-size: 11px;
    line-height: 1;
    white-space: nowrap;
  }
  .lane-corner.collapsed button {
    padding: 0 6px;
  }
  .lane-corner .mode {
    flex: 1 1 0;
    padding: 0;
    letter-spacing: -0.5px;
  }
  .lane-corner .mode.on {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }
  .lane-multi {
    position: absolute;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 1px 4px;
    font-size: 11px;
    background: color-mix(in srgb, var(--panel) 85%, transparent);
    border: 1px solid var(--line);
    border-radius: 4px;
  }
  .lane-multi input {
    width: 3.4em;
    font-size: 11px;
    padding: 0 2px;
  }
  .lane-multi button,
  .lane-multi :global(button) {
    height: 16px;
    padding: 0 4px;
    font-size: 11px;
    line-height: 1;
  }
  .lane-resize {
    position: absolute;
    z-index: 3;
    touch-action: none;
  }
  .horizontal .lane-resize {
    cursor: ns-resize;
  }
  .vertical .lane-resize {
    cursor: ew-resize;
  }
  .lane-resize {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .lane-resize:hover {
    background: color-mix(in srgb, var(--accent) 25%, transparent);
  }
  /* 가운데 손잡이 눈금 */
  .lane-resize .grip {
    border-radius: 2px;
    background: var(--accent);
    opacity: 0.7;
    pointer-events: none;
  }
  .horizontal .lane-resize .grip {
    width: 36px;
    height: 4px;
  }
  .vertical .lane-resize .grip {
    width: 4px;
    height: 36px;
  }

  canvas {
    position: relative;
    display: block;
    cursor: default;
  }
  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    pointer-events: none;
  }
  /* 영상 맞춤 손잡이: 끝 건반은 세로(가로 롤은 가로) 선, 건반 윗선 막대는 영상 전체를 옮긴다 */
  .vhandle {
    position: absolute;
    z-index: 2;
    touch-action: none;
  }
  .vhandle::after {
    content: "";
    position: absolute;
    background: var(--accent);
    opacity: 0.85;
    border-radius: 2px;
  }
  .vertical .vhandle.edge {
    cursor: ew-resize;
  }
  .vertical .vhandle.edge::after {
    left: 5px;
    width: 2px;
    top: 0;
    bottom: 0;
  }
  .horizontal .vhandle.edge {
    cursor: ns-resize;
  }
  .horizontal .vhandle.edge::after {
    top: 5px;
    height: 2px;
    left: 0;
    right: 0;
  }
  .vhandle.move {
    cursor: move;
  }
  .vertical .vhandle.move::after {
    left: 0;
    right: 0;
    top: 4px;
    height: 4px;
  }
  .horizontal .vhandle.move::after {
    top: 0;
    bottom: 0;
    left: 4px;
    width: 4px;
  }
  video.fit {
    inset: auto;
    left: 0;
    top: 0;
    max-width: none;
    transform-origin: 0 0;
  }
</style>
