<script lang="ts">
  import { add, assignTab, clipLayers, cmp, gridLines, mul, pasteClip, rat, splitNote, sub, toFloat, type LengthLimit, type Note, type Rat, type Song, type TabTuning } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { Pinch, pinchRatio } from "./pinch";
  import { typeFretDigit, type DigitNote, pinShownStrings, placeTabNote, removeTabNote, setTabNoteLength, shownStrings, tieTabNote, type TabEdit } from "./tabInput";
  import { onMount, untrack } from "svelte";
  import { fonts } from "./fonts.svelte";
  import { loadStored, saveStored } from "./persist";
  import VolumeBox from "./VolumeBox.svelte";
  import { lengthLabel } from "./Toolbar.svelte";
  import { NOTE_LENGTHS, noteLengthOf, stepNoteLength, type NoteLength } from "./roll";
  import Icon from "./Icon.svelte";
  import { drawVolumeLane } from "./laneDraw";
  import { LaneGesture } from "./laneGesture.svelte";
  import { laneItems, type LaneTrack } from "./volumeLaneEdit";
  import { LANE_MAX, LANE_MIN, laneThickness, saveVolumeLane, volumeLane } from "./volumeLane.svelte";
  import type { RollView } from "./roll";
  import { tabTint } from "./tabTint.svelte";
  import { padLengths, padPressed } from "./lengthPad";
  import { fretPadPrefs } from "./fretPadPrefs.svelte";
  import { tupletPrefs } from "./tupletPrefs.svelte";
  import { TUPLET_PICK } from "./tuplet";
  import { nextTabAlign, parseTabAlign, TAB_ALIGN_ICON, TAB_ALIGN_LABEL, type TabAlign } from "./tabAlign";
  import { coarsePointer } from "./mmlPad.svelte";
  import { carryViewStart, type ViewMemory } from "./viewCarry";
  import { volumeLabels } from "./volumeLabels.svelte";
  import { labelFits, volumeLabelNotes } from "./volumeLabels";
  import { fretBoxLeft, fretCenter, layoutTabEvents, rulerRelease, TAB_RULER, TAB_RULER_BASELINE, TAB_WAVE_TOP, tabEventAction, tabEventAt, tabEventRow, tabEventText, tabMarkerText, tabTop, tabZone, type TabEventRow, type TabEventSpot } from "./tabEvents";
  import { drawWaveStrip, noteStarts, WAVE_SIZE } from "./waveDraw";
  import { wholeToSecondsFn, type Peaks } from "./waveform";
  import { snapNearest, type EventKind, type EventLabel } from "./roll";
  import { firstVisibleCell, followPlayhead, followStart, PLAYHEAD_FOLLOW_HOLD_MS, revealRowScroll, revealStart } from "./tabFollow";
  import { arrowGoesToApp, editPicked, gluePicked, notesInRange, placeLayers, pruneSelection, scalePicked, selectionRange, tiePicked, type TrackChanges } from "./tabSelect";
  import { noteClipboard } from "./noteClipboard.svelte";

  interface Props {
    song: Song;
    /** 이 키가 앱의 옥타브 올리기·내리기 명령인지 (키 설정을 따른다). 고른 음이 있으면 타브가 먹지 않고 앱에 넘긴다 */
    octaveKey?: (e: KeyboardEvent) => boolean;
    /** 원곡 파형 띠 (피아노롤과 같은 값). offset = 원곡 어긋남(초, 원곡이 늦으면 양수) */
    wave?: { readonly peaks: Peaks; readonly offset: number } | undefined;
    /** 파형 띠의 빈 곳을 끌어 원곡을 옮겼을 때 새 어긋남(초) */
    onwaveoffset?: ((seconds: number) => void) | undefined;
    /** 이 트랙의 연주자가 가진 트랙을 모두 모아 보여 준다 */
    activeTrackId: string | undefined;
    tuning: TabTuning;
    playhead: number | undefined;
    onunplayable?: (count: number) => void;
    /** 격자: 온음표의 1/division. 타브 커서가 이 칸씩 움직인다 */
    division: number;
    /** 넣는 음 길이. 없으면 격자 한 칸 */
    noteDur?: Rat;
    /** 새 음 길이 고르기 (숫자판에서도 바꿀 수 있게). noteDur은 이 값으로 정해진다 */
    noteLength?: NoteLength;
    /** 고를 수 있는 새 음 길이 (게임 한도로 거른 목록, lengthsFor). 게임 음길이 한도 (+/− 키) */
    noteLengths?: readonly NoteLength[];
    lengthLimit?: LengthLimit;
    onnotelength?: (length: NoteLength) => void;
    /** 정해 둔 잇단음 길이 ("20"). 설정에서 켜면 음표 입력판에 단추로 둔다 */
    tupletLength?: NoteLength | undefined;
    /** 새 음 → 잇단음…: 잇단음 정하기 창을 연다 */
    ontuplet?: () => void;
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
    /** 보기 → 타브 숫자판: 켜면 마우스로 지판을 눌러도 프렛 숫자판을 연다 (끄면 터치·펜에서만) */
    padByMouse?: boolean;
    /** 위쪽 템포·박자 줄을 두 번 누르거나(터치·펜은 길게) 그 글자를 눌러 템포·박자 창을 연다 (피아노롤 이벤트 줄과 같은 모양) */
    /** 템포·마커 창 열기. work는 이 보기를 만든 보기 세대 (곡을 다시 연 뒤 옛 보기가 늦게 보낸 요청을 앱이 버리게) */
    onevent?: ((request: { label?: EventLabel; kind: EventKind; at: Rat; work?: number | undefined }) => void) | undefined;
    /** 타브 커서 자리가 바뀔 때 (Alt+B·Alt+M이 그 자리에 넣게). 커서가 없으면 undefined */
    oncursor?: ((at: Rat | undefined) => void) | undefined;
    /** 여러 트랙에 붙이기: 있는 트랙의 바뀐 음과 이 악보에 더할 새 트랙의 음 (실행 취소 한 칸) */
    onlayers?: ((changes: TrackChanges, added: Note[][], playerId: string, label: string) => void) | undefined;
    /** 재생 위치 (온음표 단위, 피아노롤과 같은 값). 없으면 곡 처음부터 */
    playCursor?: number | undefined;
    /** 반복 구간 (피아노롤과 같은 값) */
    loop?: readonly [number, number] | undefined;
    /** 마디 번호 줄을 눌렀다 뗀 자리: 재생 위치 (재생 중이면 거기서 이어 재생) */
    onseek?: ((time: number) => void) | undefined;
    /** 재생 위치를 바꾸거나 지운다 (구간 앞, 재생 위치 위를 다시 누름) */
    onplaycursor?: ((time: number | undefined) => void) | undefined;
    /** 마디 번호 줄을 끌어 정한 반복 구간 */
    onloop?: ((range: readonly [number, number] | undefined) => void) | undefined;
    /** 보기 → 커서 따라가기: 키보드·숫자판으로 커서가 화면 밖으로 나가면 화면을 넘긴다 */
    followCursor?: boolean;
    /** 보기를 바꾸기 전에 보던 자리와 지난번 타브 확대·커서 (만들 때 한 번만 읽는다) */
    memory?: ViewMemory | undefined;
    /** 보던 자리·확대·커서가 바뀔 때 (보기를 바꿨다 돌아와도 이어 보게 앱이 기억한다) */
    onmemory?: ((place: NonNullable<ViewMemory["place"]>, tab: NonNullable<ViewMemory["tab"]>, work: number | undefined) => void) | undefined;
    /** 이 보기를 만든 보기 세대(곡을 열 때마다 늘어나는 번호). 만들 때 한 번 읽어 onmemory에 함께 돌려준다 (곡을 연 뒤 옛 보기의 알림을 앱이 버리게) */
    work?: number | undefined;
    /** 지판 위치(위·가운데·아래)가 바뀔 때 (PC 위 도구줄 단추가 쓴다) */
    onalign?: ((align: TabAlign) => void) | undefined;
    /** 숫자판 점 단추 (앱의 점 붙이기·떼기 명령과 같다) */
    ondot?: (() => void) | undefined;
    /** 트랙 수 한도 때문에 붙이지 못했을 때 (아무것도 붙이지 않았다) */
    onpastefull?: ((limit: number) => void) | undefined;
  }

  let { song, octaveKey, wave, onwaveoffset, activeTrackId, tuning, playhead, onunplayable, division, noteDur, noteLength, noteLengths = NOTE_LENGTHS, tupletLength, ontuplet, lengthLimit, onnotelength, onedit, onnewtrack, onfull, maxTracks = Infinity, onpreview, volume = $bindable(), volumeRange, colors, locked, laneTrackIds, melodyIds, padByMouse = false, onevent, oncursor, onlayers, onpastefull, ondot, onalign, memory, onmemory, work, followCursor = true, playCursor, loop, onseek, onplaycursor, onloop }: Props = $props();

  // 위쪽에 마디 번호 줄과 변속 줄 두 칸(위 칸 템포, 아래 칸 박자·마커), 원곡이 있으면 그 아래 파형 띠를 두고 그 아래에 첫 줄
  // 숫자판을 띄운 동안은 지판 자리를 위해 띠를 숨긴다 (도구 띠를 숨기는 것과 같은 규칙)
  const waveShown = $derived.by(() => !!wave && !padOpen);
  const TOP = $derived.by(() => tabTop(waveShown));
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
  /** 타브 크기 한 단계 (A+ = 1, A− = −1). 위 도구줄(PC)과 아래 도구 띠(터치)가 같이 쓴다 */
  export function resizeTab(step: 1 | -1) {
    setGap(gap + 3 * step);
  }
  // 지판 세로 위치(위·가운데·아래). 세로로 긴 화면에서 남는 높이가 있을 때만 쓰인다. 이 브라우저에 기억한다
  const ALIGN_KEY = "mmlce.tabAlign";
  let align = $state<TabAlign>(loadStored(ALIGN_KEY, parseTabAlign));
  // 지금 지판 위치를 앱에 알린다 (PC는 위 도구줄 단추가 이 값으로 글자·안내를 쓴다)
  $effect(() => {
    const now = align;
    untrack(() => onalign?.(now));
  });
  export function cycleAlign() {
    align = nextTabAlign(align);
    saveStored(ALIGN_KEY, align);
  }
  /** 가로(시간) 확대·축소. factor > 1이면 확대, 화면 가운데를 기준으로 */
  export function zoomTime(factor: number) {
    const mid = start + (width - LEFT) / pxPerWhole / 2;
    pxPerWhole = Math.min(2000, Math.max(40, pxPerWhole * factor));
    start = Math.max(0, mid - (width - LEFT) / pxPerWhole / 2);
  }
  /** 전체 보기: 곡 전체가 한 화면에 들어오게 가로 확대를 맞추고 처음부터 (가장 작게 해도 넘치면 그만큼만) */
  export function fitAll() {
    pxPerWhole = Math.min(2000, Math.max(40, (width - LEFT - 20) / Math.max(songEnd, 0.25)));
    start = 0;
  }
  let host: HTMLDivElement;
  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let width = $state(600);
  // 보기를 바꾸기 전 자리에서 시작한다 (만들 때 한 번만 읽는다). 시작 시간은 화면 폭을 안 뒤 재생 위치가 보이게 다시 맞춘다
  const carry = untrack(() => ({ place: memory?.place, tab: memory?.tab, cursor: playCursor, work }));
  let carryPending = !!carry.place;
  let start = $state(carry.place?.start ?? 0);
  let pxPerWhole = $state(carry.tab?.pxPerWhole ?? 220);

  const player = $derived(song.tracks.find((t) => t.id === activeTrackId)?.playerId);
  const tracks = $derived(song.tracks.filter((t) => t.playerId === player && !t.mute));
  // 시간 스크롤바 범위: 곡 끝 뒤로 화면 반 폭만큼 더
  const span = $derived((width - LEFT) / pxPerWhole);
  const songEnd = $derived(Math.max(0, ...tracks.flatMap((tr) => tr.notes.map((n) => toFloat(n.start) + toFloat(n.dur)))));
  const timeMax = $derived(Math.max(span, songEnd + span * 0.5));
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
  const events = $derived(assignTab(tracks.flatMap((t) => struck(t.notes)), tuning, new Map(), slides));

  /** 타브 커서: 시간(격자에 맞춤)과 줄(1 = 가장 높은 줄) */
  // 피아노롤에 갔다 와도 전에 있던 커서 그대로 (그 사이 곡이 짧아져도 지우지 않는다)
  // 롤↔타브 전환에서 기억한 커서만 되살린다. 없으면 커서 없이 시작하고, 키를 누르면 그때 화면에 보이는 첫 칸에 만든다 (onkeydown)
  let cursor = $state.raw<{ at: Rat; string: number } | undefined>(carry.tab?.cursor);
  // 커서 자리를 앱에 알린다 (Alt+B·Alt+M이 그 자리에 템포·마커를 넣게). 타브를 닫으면 커서도 없다
  $effect(() => {
    const at = cursor?.at;
    untrack(() => oncursor?.(at));
  });
  // 사라질 때(곡을 다시 열거나 피아노롤로 바꿀 때) 커서를 알리고, 길게 누르기 타이머를 지운다 (옛 곡 자리로 창이 열리지 않게)
  onMount(() => () => {
    oncursor?.(undefined);
    cancelBandPress();
  });

  // 보던 자리·확대·커서를 앱에 알린다 (휠·스크롤바·확대·따라가기 등 어느 길로 바뀌어도)
  $effect(() => {
    const place = { start, span: (width - LEFT) / pxPerWhole };
    const tab = { pxPerWhole, cursor };
    untrack(() => onmemory?.(place, tab, carry.work));
  });

  // 커서 따라가기: 커서 자리가 바뀔 때만 (휠·끌기로 굴린 화면은 되돌리지 않는다). 커서를 옮기는 모든 길(방향키·Shift+방향키·
  // 숫자판·프렛 입력 뒤 넘어가기·붙여넣기)이 이 한 곳을 지난다. 마우스로 누르거나 끌어 놓은 커서는 이미 보이는 자리이고,
  // 누르는 동안 화면이 움직이면 끌기·고르기가 어긋나므로 따라가지 않는다. 재생 중에는 재생선 따라가기가 먼저다
  // 되살린 커서로는 따라가지 않는다 (앞 보기에서 넘긴 자리를 지킨다)
  let followedAt: Rat | undefined = carry.tab?.cursor?.at;
  /**
   * 규칙: 커서 자리에 쓰는 편집(숫자·지우기·잇기·길이·점·자르기·붙이기)이 적용되기 전에 커서 칸은 화면에 보여야 한다.
   * 안 보이면 화면을 바로 옮긴다. 커서를 만든 길과 커서 따라가기 설정·재생 중인지와 상관없이 지킨다
   */
  function ensureCursorVisible() {
    if (!cursor) return;
    const note = noteAtCursor();
    const from = toFloat(cursor.at);
    const to = note ? toFloat(note.start) + toFloat(note.dur) : from + 1 / division;
    const next = revealStart(from, to, start, (width - LEFT) / pxPerWhole, timeMax);
    // 편집으로 화면을 옮겼으면 재생선 따라가기를 잠깐 쉰다 (옮긴 화면을 바로 재생선 쪽으로 되돌리지 않게)
    if (next !== start) playheadHoldUntil = performance.now() + PLAYHEAD_FOLLOW_HOLD_MS;
    start = next;
    // 세로: 타브를 크게 해 지판이 칸보다 크면 커서 줄이 세로 스크롤 밖일 수 있다 (숫자판 열림과 상관없이)
    revealCursorRow();
  }
  /** 커서 줄이 지판 칸 안에 세로로 보이게 굴린다 */
  function revealCursorRow() {
    if (!cursor || !wrap) return;
    // 캔버스 위 여백(지판 위치)도 더한다
    const top = (canvas?.offsetTop ?? 0) + TOP + (cursor.string - 1) * gap - fontPx;
    wrap.scrollTop = revealRowScroll(top, top + fontPx * 2, wrap.scrollTop, wrap.clientHeight);
  }
  /** 앱 명령(템포·마커·박자·아르페지오)이 타브 커서 자리를 쓰기 전에 부른다: 커서 칸을 화면에 보이게 한다 */
  export function revealCursor() {
    ensureCursorVisible();
  }
  /** 이 시각(performance.now, ms)까지 재생선 따라가기를 쉰다 */
  let playheadHoldUntil = 0;
  /** 마우스·손가락으로 커서를 놓았다 (다음 한 번은 따라가지 않는다) */
  let placedByPointer = false;
  $effect(() => {
    const at = cursor?.at;
    const on = followCursor;
    untrack(() => {
      const changed = at !== undefined && (followedAt === undefined || cmp(at, followedAt) !== 0);
      followedAt = at;
      const byPointer = placedByPointer;
      placedByPointer = false;
      if (!on || !changed || byPointer || playhead !== undefined || at === undefined) return;
      const note = noteAtCursor();
      const from = toFloat(at);
      const to = note ? toFloat(note.start) + toFloat(note.dur) : from + 1 / division;
      start = followStart(from, to, start, (width - LEFT) / pxPerWhole, timeMax);
    });
  });

  /** 고른 음 id (보이는 모든 트랙의 음). 편집 메뉴·단축키 명령이 이 음에 쓰인다 */
  let selected = $state.raw<ReadonlySet<string>>(new Set());
  /** 고르기 범위의 시작 자리 (Shift+←/→, Shift+누르기·끌기, 숫자판 고르기). 없으면 범위를 넓히는 중이 아니다 */
  let anchor: Rat | undefined;
  /** 숫자판 고르기 단추: 켜 두면 커서를 옮기는(지판을 누르는) 동안 범위가 넓어진다 (터치용) */
  let selecting = $state(false);
  /** Shift+끌기로 고르는 중 */
  let dragSelect = false;
  /** 시작 자리에서 head 칸까지 시간 범위 안에 시작하는 음을 모두 고른다 */
  function selectTo(head: Rat) {
    anchor ??= head;
    const [from, to] = selectionRange(anchor, head, rat(1, division));
    selected = notesInRange(tracks, from, to);
  }
  function clearSelection() {
    anchor = undefined;
    selecting = false;
    if (selected.size > 0) selected = new Set();
  }
  // 곡이 바뀌어(지우기·실행 취소 등) 사라진 음은 고르기에서 뺀다
  $effect(() => {
    const now = untrack(() => selected);
    const pruned = pruneSelection(now, tracks);
    if (pruned !== now) selected = pruned;
  });
  /** 숫자판 고르기 단추 */
  function toggleSelecting() {
    if (selecting) {
      // 끄면 범위 넓히기만 멈춘다 (고른 음은 남겨 지우기 등에 쓴다)
      selecting = false;
      anchor = undefined;
      return;
    }
    if (!cursor) return;
    selecting = true;
    anchor = cursor.at;
    selectTo(cursor.at);
  }
  let digits = "";
  /** 숫자 키로 마지막에 넣은(바꾼) 음. 두 자리 프렛의 둘째 숫자가 이 음을 바꾼다 (typeFretDigit) */
  let lastFretNote: DigitNote | undefined;
  let digitsTimer: ReturnType<typeof setTimeout> | undefined;

  /** 커서 자리에서 그 줄에 놓인 음 */
  function noteAtCursor(): Note | undefined {
    if (!cursor) return undefined;
    const c = cursor;
    const e = events.find((x) => cmp(x.start, c.at) === 0);
    return e?.notes.find((x) => x.at?.string === c.string)?.note;
  }

  /**
   * 커서 음, 없으면 그 줄에 괄호로 보이는 이어 울리는 음(같은 높이로 &로 이은 뒷음). 타브 배정은 이어 울리는 음을
   * 빼고 하므로 noteAtCursor로는 못 찾는다. 길이 바꾸기에 쓴다
   */
  function lengthNoteAtCursor(): Note | undefined {
    const direct = noteAtCursor();
    if (direct || !cursor) return direct;
    const c = cursor;
    for (const track of tracks) {
      const notes = [...track.notes].sort((a, b) => cmp(a.start, b.start));
      const k = notes.findIndex((n) => cmp(n.start, c.at) === 0);
      if (k < 0) continue;
      let j = k;
      while (j > 0) {
        const prev = notes[j - 1]!;
        if (prev.tie !== "next" || prev.pitch !== notes[j]!.pitch || cmp(add(prev.start, prev.dur), notes[j]!.start) !== 0) break;
        j--;
      }
      if (j === k) continue;
      const head = notes[j]!;
      const e = events.find((x) => cmp(x.start, head.start) === 0);
      if (e?.notes.some((x) => x.note.id === head.id && x.at?.string === c.string)) return notes[k];
    }
    return undefined;
  }

  function apply(edit: TabEdit, label: string, string?: number) {
    if (edit.full) {
      onfull?.(maxTracks);
      return;
    }
    if (edit.changes.length === 0 && !edit.newTrack) return;
    // 고른 줄은 음에 적는다 (Note.tabString): 곡과 함께 저장되고, 되돌리기·보기 전환·다시 열기에도 남는다
    // 바뀌는 트랙의 다른 음은 지금 보이는 줄에 묶는다: 새 음 때문에 앞 음이 다른 줄로 옮겨 가지 않게
    const id = edit.noteId;
    const shown = shownStrings(events);
    const stamp = (notes: readonly Note[]): Note[] =>
      pinShownStrings(notes, shown).map((n) => (id && string !== undefined && n.id === id && n.tabString !== string ? { ...n, tabString: string } : n));
    if (edit.newTrack) onnewtrack?.({ ...edit.newTrack, notes: stamp(edit.newTrack.notes) }, label);
    else onedit?.(edit.changes.map((c) => ({ ...c, notes: stamp(c.notes) })), label);
  }

  /**
   * 커서 자리에 프렛 음을 넣는다. 돌려주는 값은 그 자리 음의 실제 길이(다음 칸으로 넘길 만큼),
   * 넣지 못했으면(한도 거절 등) undefined. 이미 있는 음 위에 치면 높이만 바꾸고 길이는 그대로다
   * (기타 프로처럼 프렛만 고친다. 길이는 새 음 고르기·+/−로 바꾼다)
   */
  function enterFret(fret: number, replaceId?: string): Rat | undefined {
    lastFretNote = undefined;
    if (!cursor || !activeTrackId || fret > tuning.maxFret || cursor.string > tuning.strings.length) return undefined;
    const pitch = tuning.strings[cursor.string - 1]! + tuning.capo + fret;
    // 트랙 수 한도는 음소거한 트랙도 센다 (타브에는 안 보여도 악보 자리는 차지한다)
    const scoreTracks = song.tracks.filter((t) => t.playerId === player).length;
    const room = Math.max(0, maxTracks - (scoreTracks - tracks.length));
    // 두 자리 프렛의 둘째 숫자면 첫 숫자로 만든 그 음을 바꾼다 (화음 배정으로 다른 줄에 그려져 있어도)
    const byId = replaceId ? tracks.flatMap((t) => t.notes).find((n) => n.id === replaceId) : undefined;
    const replace = byId ?? noteAtCursor();
    const dur = noteDur ?? rat(1, division);
    const edit = placeTabNote(song, tracks.map((t) => t.id), activeTrackId, cursor.at, dur, pitch, replace, volume, room);
    if (edit.full) {
      apply(edit, "타브 입력");
      return undefined;
    }
    apply(edit, "타브 입력", cursor.string);
    if (edit.noteId) lastFretNote = { id: edit.noteId, at: cursor.at, string: cursor.string };
    onpreview?.(pitch);
    // 잠근 트랙이면 앱이 곡을 바꾸지 않으므로 커서도 넘기지 않는다
    if (edit.changes.length > 0 && edit.changes.every((ch) => locked?.has(ch.trackId))) return undefined;
    return replace?.dur ?? dur;
  }

  // 두 손가락 집기(아이패드 등): 가로로 벌리면 확대·축소, 가운데를 따라 옮긴다
  const pinch = new Pinch();
  let pinchStart: { pxPerWhole: number; start: number } | undefined;

  function point(e: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  /** 그린 변속 글자 자리 (그릴 때마다 새로). 누를 때 이걸로 찾는다 */
  let eventSpots: TabEventSpot[] = [];
  /** 위쪽 변속 줄의 몇째 칸인지 (0 템포, 1 박자·마커. 첫 줄 숫자 칸과 겹치면 글자 위만. 첫 줄을 누르는 자리는 남긴다) */
  const eventRowAt = (px: number, py: number) => tabEventRow(eventSpots, px, py, TOP, fontPx);
  /** 템포 글자 위에 올렸을 때 보이는 안내 */
  let eventHover = $state<TabEventSpot | undefined>(undefined);
  /** 마커 글자의 전체 이름 (줄여 쓴 글자 대신 안내에 보인다) */
  const markerName = (spot: TabEventSpot) => song.markers.find((m) => m.id === spot.id)?.label ?? spot.text;
  /** 변속 줄 빈 자리 위의 칸 (위 칸은 두 번 눌러 템포, 아래 칸은 마커를 넣는다는 안내) */
  let bandHover = $state<TabEventRow | undefined>(undefined);
  /** 마디 번호 줄 위인지 (누르는 곳 안내) */
  let rulerHover = $state(false);
  /** 마디 번호 줄을 누르고 끄는 중: [누른 자리, 지금 자리] (격자에 맞춘 시간) */
  let marking = $state.raw<[number, number] | undefined>(undefined);
  const rulerTime = (px: number) => toFloat(snapNearest(Math.max(0, start + (px - LEFT) / pxPerWhole), division));
  /**
   * 파형 띠의 빈 곳을 끌어 원곡을 앞뒤로 옮기기 (피아노롤과 같다). 문턱(마우스 3px·터치 8px)을 넘기 전에 떼면 그 자리가 재생 위치.
   * offset: 끄는 동안의 어긋남(초)
   */
  let waveDrag = $state.raw<{ grab: number; x0: number; y0: number; slop: number; live: boolean; offset: number } | undefined>(undefined);
  /** 파형 띠 위인지 (끌 수 있다는 손 모양) */
  let waveHover = $state(false);
  /** 터치·펜으로 변속 줄을 길게 누르는 중 */
  let bandPress: { x: number; row: TabEventRow; x0: number; y0: number; timer: ReturnType<typeof setTimeout> } | undefined;
  const LONG_PRESS_MS = 500;

  function cancelBandPress() {
    if (bandPress) clearTimeout(bandPress.timer);
    bandPress = undefined;
  }

  /** 변속 줄 row 칸 px 자리: 글자가 있으면 그 템포·박자·마커를 고치고, 없으면 격자에 맞춘 자리에 새 템포(위 칸)·마커(아래 칸) */
  function openEventAt(px: number, row: TabEventRow) {
    if (!onevent) return;
    const act = tabEventAction(eventSpots, px, row);
    if ("edit" in act) {
      const spot = act.edit;
      const box = tabEventText(spot.row);
      // 마커는 id로 찾아 고친다 (같은 자리에 마커가 여럿일 수 있다)
      const label: EventLabel = { kind: spot.kind, at: spot.at, text: spot.text, x: spot.left, y: box.top, w: spot.right - spot.left, h: box.bottom - box.top, ...(spot.id ? { id: spot.id } : {}) };
      onevent({ label, kind: spot.kind, at: spot.at, work: carry.work });
      return;
    }
    const time = start + (px - LEFT) / pxPerWhole;
    onevent({ kind: act.add, at: snapNearest(Math.max(0, time), division), work: carry.work });
  }

  function ondblclick(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const row = px >= LEFT ? eventRowAt(px, e.clientY - rect.top) : undefined;
    if (row !== undefined) openEventAt(px, row);
  }

  function onpointermove(e: PointerEvent) {
    if (bandPress && Math.hypot(e.clientX - bandPress.x0, e.clientY - bandPress.y0) > 8) cancelBandPress();
    if (waveDrag && wave) {
      const w = waveDrag;
      if (!w.live && Math.hypot(e.clientX - w.x0, e.clientY - w.y0) < w.slop) return;
      // 누른 자리의 원곡 소리가 지금 손가락 자리에 오게: 곡 s초에 원곡 s + offset초가 들린다
      const secs = wholeToSecondsFn(song.tempo);
      const time = Math.max(0, start + (point(e)[0] - LEFT) / pxPerWhole);
      waveDrag = { ...w, live: true, offset: wave.offset + secs(w.grab) - secs(time) };
      return;
    }
    if (marking && e.buttons & 1) {
      const t = rulerTime(point(e)[0]);
      if (t !== marking[1]) marking = [marking[0], t];
      return;
    }
    if (dragSelect && cursor && e.buttons & 1) {
      const [px] = point(e);
      const at = rat(Math.max(0, Math.floor((start + (px - LEFT) / pxPerWhole) * division + 1e-9)), division);
      if (cmp(at, cursor.at) !== 0) {
        placedByPointer = true;
        cursor = { ...cursor, at };
        selectTo(at);
      }
    }
    if (e.pointerType === "mouse") {
      const [px, py] = point(e);
      rulerHover = !!onseek && px >= LEFT && py < TAB_RULER;
      waveHover = !!onwaveoffset && px >= LEFT && tabZone(eventSpots, px, py, TOP, fontPx, waveShown) === "wave";
      const row = onevent && px >= LEFT && !rulerHover ? eventRowAt(px, py) : undefined;
      eventHover = row !== undefined ? tabEventAt(eventSpots, px, row) : undefined;
      bandHover = eventHover ? undefined : row;
    }
    const f = pinch.move(e, point(e));
    const s = pinchStart;
    if (!f || !s) return;
    const midTime = s.start + (f.mid0[0] - LEFT) / s.pxPerWhole;
    pxPerWhole = Math.min(2000, Math.max(40, s.pxPerWhole * pinchRatio(f.gap0[0], f.gap[0])));
    start = Math.max(0, midTime - (f.mid[0] - LEFT) / pxPerWhole);
  }

  function onpointerup(e: PointerEvent) {
    cancelBandPress();
    if (waveDrag) {
      const w = waveDrag;
      waveDrag = undefined;
      if (e.type !== "pointercancel") {
        if (!w.live) onseek?.(toFloat(snapNearest(w.grab, division)));
        else onwaveoffset?.(w.offset);
      }
    }
    if (marking) {
      // 피아노롤 눈금자와 같다: 같은 자리 = 재생 위치(재생 위치 위를 다시 누르면 지우기), 끌었으면 반복 구간
      const [a, b] = marking;
      marking = undefined;
      if (e.type !== "pointercancel") {
        const r = rulerRelease(a, b, playCursor);
        if (r.kind === "seek") onseek?.(r.at);
        else if (r.kind === "clear") onplaycursor?.(undefined);
        else {
          onloop?.(r.range);
          onplaycursor?.(r.range[0]);
        }
      }
    }
    dragSelect = false;
    pinch.up(e);
  }

  function onpointerdown(e: PointerEvent) {
    if (pinch.down(e, point(e))) {
      // 두 손가락이면 마디 번호 줄·파형 띠 끌기는 그만두고 확대·축소
      marking = undefined;
      waveDrag = undefined;
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
    // 맨 위 마디 번호 줄: 누르고 떼면 재생 위치, 끌면 반복 구간 (피아노롤 눈금자와 같다). 화면은 움직이지 않는다
    if (py < TAB_RULER && onseek) {
      const t = rulerTime(px);
      marking = [t, t];
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    // 원곡 파형 띠: 마디 번호 줄과 같은 칸 (떼면 재생 위치). 빈 곳을 끌면 원곡을 앞뒤로 옮긴다 (피아노롤과 같다)
    if (tabZone(eventSpots, px, py, TOP, fontPx, waveShown) === "wave") {
      const grab = Math.max(0, start + (px - LEFT) / pxPerWhole);
      if (wave && onwaveoffset) {
        waveDrag = { grab, x0: e.clientX, y0: e.clientY, slop: e.pointerType === "mouse" ? 3 : 8, live: false, offset: wave.offset };
        canvas.setPointerCapture(e.pointerId);
      } else if (onseek) {
        const t = rulerTime(px);
        marking = [t, t];
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
    // 위쪽 변속 줄: 한 번 누르면 아무 일도 없다(지판 커서를 두지 않는다). 터치·펜은 길게 누르면 두 번 누르기와 같은 창
    const row = eventRowAt(px, py);
    if (row !== undefined) {
      cancelBandPress();
      if (e.pointerType === "touch" || e.pointerType === "pen") {
        const press = { x: px, row, x0: e.clientX, y0: e.clientY, timer: setTimeout(() => {
          if (bandPress !== press) return;
          bandPress = undefined;
          openEventAt(press.x, press.row);
        }, LONG_PRESS_MS) };
        bandPress = press;
      }
      return;
    }
    const time = start + (px - LEFT) / pxPerWhole;
    const string = Math.min(tuning.strings.length, Math.max(1, Math.round((py - TOP) / gap) + 1));
    const at = rat(Math.max(0, Math.floor(time * division + 1e-9)), division);
    // Shift+누르기: 커서(없으면 누른 자리)에서 누른 자리까지 고르고, 끌면 범위를 넓힌다. 숫자판 고르기를 켰으면 Shift 없이도
    const extend = (e.shiftKey && e.pointerType === "mouse") || selecting;
    if (extend) {
      anchor ??= cursor?.at ?? at;
      if (e.shiftKey && e.pointerType === "mouse") {
        dragSelect = true;
        canvas.setPointerCapture(e.pointerId);
      }
    } else clearSelection();
    touchPad = padByMouse || e.pointerType === "touch" || e.pointerType === "pen" || touchPad;
    placedByPointer = true;
    cursor = { at, string };
    if (extend) selectTo(at);
    digits = "";
  }

  /** 커서 음을 다음 음과 &로 잇거나 푼다 (다른 높이면 슬라이드) */
  function tieAtCursor() {
    const note = noteAtCursor();
    if (!note || !cursor) return;
    const edit = tieTabNote(song, note, noteDur ?? rat(1, division));
    const added = edit.changes[0]?.notes.find((n) => n.id === edit.noteId);
    apply(edit, note.tie === "next" ? "이음줄 풀기" : "이음줄", cursor.string);
    // 뒤가 비어 같은 음을 더해 이었으면 커서를 그 음 뒤로 (이어서 다음 음을 넣는다).
    // 잠근 트랙이면 앱이 바꾸지 않으므로 커서도 그대로 둔다
    const trackId = edit.changes[0]?.trackId;
    if (added && trackId && !locked?.has(trackId)) cursor = { ...cursor, at: add(added.start, added.dur) };
  }

  /**
   * 새 음 길이를 바꾼다. 길이를 콕 집어 고르면 커서 음 길이도 바꾼다 (기타 프로처럼 고른 박의 길이).
   * "격자대로"는 다음에 넣을 음의 방식만 바꾼다
   */
  function changeLength(length: NoteLength) {
    onnotelength?.(length);
    if (length === "grid") return;
    const note = lengthNoteAtCursor();
    // 커서 음을 실제로 바꿀 때만 커서 칸을 먼저 보인다 (새 음 기본값만 바꿀 때는 그대로)
    if (note) ensureCursorVisible();
    if (note) apply(setTabNoteLength(song, note, noteLengthOf(length, division)), "음 길이", cursor?.string);
  }

  /** 숫자판 위 길이 고르기. 잇단음…이면 창을 열고 고르기 칸은 지금 길이로 되돌린다 */
  function pickLength(e: Event & { currentTarget: HTMLSelectElement }) {
    const value = e.currentTarget.value;
    if (value !== TUPLET_PICK) return changeLength(value as NoteLength);
    if (noteLength !== undefined) e.currentTarget.value = noteLength;
    ontuplet?.();
  }

  /** +/− 키: 커서 음(없으면 새 음) 길이를 두 배 / 반으로 (온음표 ~ 64분음표) */
  function stepLength(factor: 2 | 0.5) {
    const length = stepNoteLength(lengthNoteAtCursor()?.dur ?? noteDur ?? rat(1, division), factor, lengthLimit);
    if (length) changeLength(length);
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
    ensureCursorVisible();
    onedit?.([{ trackId: track.id, notes: track.notes.map((n) => (n.id === note.id ? { ...n, vol } : n)) }], "음 볼륨");
  }

  function deleteAtCursor() {
    const note = noteAtCursor();
    if (note) apply(removeTabNote(song, note), "타브 지우기");
  }

  // ── 고른 음 편집 (피아노롤과 같은 이름·같은 뜻. 앱의 편집 메뉴·단축키가 부른다) ──

  /** 고른 음들 (시작 순) */
  const selectedNotes = $derived(
    tracks
      .flatMap((t) => t.notes.filter((n) => selected.has(n.id)))
      .sort((a, b) => cmp(a.start, b.start)),
  );
  export function selection(): readonly Note[] {
    return selectedNotes;
  }

  /** 타브에 보이는 트랙의 음을 모두 고른다 */
  export function selectAll(): boolean {
    if (tracks.length === 0) return false;
    anchor = undefined;
    selected = new Set(tracks.flatMap((t) => t.notes.map((n) => n.id)));
    return true;
  }

  /** 여러 트랙을 한 번에 바꾼다 (실행 취소 한 칸). 잠근 트랙이 끼면 앱이 알리고 바꾸지 않는다 */
  function commit(changes: TrackChanges, label: string): boolean {
    if (changes.length === 0) return false;
    // 바뀌는 트랙의 다른 음은 지금 보이는 줄에 묶는다 (apply와 같다)
    const shown = shownStrings(events);
    onedit?.(changes.map((c) => ({ ...c, notes: pinShownStrings(c.notes, shown) })), label);
    return true;
  }

  /** 고른 음 모두 바꾸기. change가 null이면 지운다. 높이가 바뀌어 적어 둔 줄에서 못 치면 줄을 다시 고른다. 고른 음이 없으면 false */
  export function editSelected(change: (n: Note) => Note | null, label: string): boolean {
    if (selected.size === 0) return false;
    commit(editPicked(tracks, selected, change, tuning), label);
    return true;
  }

  /** 고른 음을 앱 클립보드에 복사한다. 트랙 나눔(화음)을 원래 트랙 순서대로 층으로 담는다 */
  export function copySelection(): boolean {
    const clip = clipLayers(tracks.map((t) => t.notes.filter((n) => selected.has(n.id))));
    if (!clip) return false;
    noteClipboard.clip = clip;
    return true;
  }

  export function cutSelection(label: string): boolean {
    return copySelection() && editSelected(() => null, label);
  }

  let pasteCount = 0;
  /**
   * 복사한 음을 타브 커서 자리(없으면 복사한 원래 자리)에 붙인다. 층 k를 이 악보의 k번째 보이는 트랙에 먼저 넣고,
   * 겹치면 빈 트랙, 모자라면 한도 안에서 트랙을 더한다. 하나라도 못 넣으면 아무것도 붙이지 않는다.
   * 붙인 음을 고르고 커서를 붙인 끝으로 옮긴다. 붙인 끝 위치를 돌려준다 (못 붙이면 undefined)
   */
  export function pasteAt(_at: Rat | number | undefined, label: string): Rat | undefined {
    const clip = noteClipboard.clip;
    if (!clip || !player || tracks.length === 0) return undefined;
    ensureCursorVisible();
    const from = cursor?.at ?? clip.origin;
    const stamp = `${player}.tp${Date.now().toString(36)}${(pasteCount++).toString(36)}`;
    let k = 0;
    const newId = () => `${stamp}.${k++}`;
    const layers = (clip.layers ?? [clip.notes]).map((l) => pasteClip({ ...clip, notes: l }, from, newId));
    // 트랙 수 한도는 음소거한 트랙도 센다 (타브에는 안 보여도 악보 자리는 차지한다)
    const scoreTracks = song.tracks.filter((t) => t.playerId === player).length;
    const placed = placeLayers(tracks, layers, Math.max(0, maxTracks - scoreTracks), locked);
    if (!placed) {
      onpastefull?.(maxTracks);
      return undefined;
    }
    onlayers?.(placed.changes, placed.added, player, label);
    selected = new Set(layers.flat().map((n) => n.id));
    anchor = undefined;
    const end = add(from, clip.length);
    if (cursor) cursor = { ...cursor, at: end };
    return end;
  }

  /** 고른 음을 다음 음과 &로 잇거나 푼다. 하나도 못 바꾸면 false */
  export function tieSelected(): boolean {
    if (selected.size === 0) return false;
    const changes = tiePicked(tracks, selected);
    const first = selectedNotes[0];
    return !!changes && commit(changes, first?.tie === "next" ? "이음줄 풀기" : "이음줄");
  }

  /**
   * 타브 커서 자리에서 음을 자른다 (at은 피아노롤과 모양을 맞춘 것이고, 타브는 늘 타브 커서 자리).
   * 고른 음이 있으면 그 가운데 커서 자리에 걸린 음, 없으면 커서 줄에서 커서 자리에 걸린 음. 자른 조각을 고른다
   */
  export function splitAt(_at?: Rat): boolean {
    if (!cursor) return false;
    ensureCursorVisible();
    const c = cursor;
    const inside = (n: Note) => cmp(n.start, c.at) < 0 && cmp(c.at, add(n.start, n.dur)) < 0;
    let targets: Note[];
    if (selected.size > 0) targets = selectedNotes.filter(inside);
    else {
      const onString = new Set(events.flatMap((e) => e.notes.filter((x) => x.at?.string === c.string).map((x) => x.note.id)));
      targets = tracks.flatMap((t) => t.notes).filter((n) => inside(n) && onString.has(n.id)).slice(0, 1);
    }
    if (targets.length === 0) return false;
    const changes: TrackChanges = [];
    const pieces = new Set<string>();
    for (const t of tracks) {
      let notes: Note[] = [...t.notes];
      for (const n of targets.filter((x) => t.notes.includes(x))) {
        const done = splitNote(notes, n.id, c.at, `${n.id}.s${Date.now().toString(36)}`);
        if (!done) continue;
        notes = done[0];
        pieces.add(done[1].id).add(done[2].id);
      }
      if (notes.length !== t.notes.length) changes.push({ trackId: t.id, notes });
    }
    if (!commit(changes, "음 자르기")) return false;
    selected = pieces;
    return true;
  }

  /** 고른 음 가운데 같은 트랙에서 높이가 같고 맞닿은 음을 붙인다. 붙일 것이 없으면 false */
  export function glueSelected(): boolean {
    if (selected.size < 2) return false;
    const done = gluePicked(tracks, selected);
    if (!done || !commit(done.changes, "음 붙이기")) return false;
    selected = done.kept;
    return true;
  }

  /** 고른 음(ids를 주면 그 음) 길이 ×factor (트랙마다, 같은 기준). 늘릴 자리가 없으면 바꾸지 않고 false */
  export function scaleSelected(factor: Rat, label: string, ids?: readonly string[]): boolean {
    const changes = scalePicked(tracks, ids ? new Set(ids) : selected, factor);
    return !!changes && commit(changes, label);
  }

  /** 길이를 바꿀 커서 음 (이어 울리는 뒷음도. +/−와 같은 기준). 없으면 undefined */
  export function cursorLengthNote(): Note | undefined {
    // 앱의 점 붙이기·떼기가 이 음 길이를 바꾼다: 바꾸기 전에 커서 칸을 보이게
    ensureCursorVisible();
    return lengthNoteAtCursor();
  }

  /** Delete 키·숫자판 지우기: 고른 음이 있으면 고른 음, 없으면 커서 음 */
  function deleteKey() {
    if (selected.size > 0) editSelected(() => null, "음 지우기");
    else deleteAtCursor();
  }
  /** L·& 키·숫자판 잇기 */
  function tieKey() {
    if (selected.size > 0) tieSelected();
    else tieAtCursor();
  }
  /** +/− 키: 고른 음이 있으면 고른 음 길이 ×2·½, 없으면 커서 음(또는 새 음) 길이 */
  function lengthKey(factor: 2 | 0.5) {
    if (selected.size > 0) scaleSelected(rat(factor === 2 ? 2 : 1, factor === 2 ? 1 : 2), factor === 2 ? "길이 ×2" : "길이 ½");
    else stepLength(factor);
  }

  /** 커서를 격자 한 칸(좌우, 또는 step만큼) 또는 한 줄(위 = 높은 줄) 옮긴다 */
  function moveCursor(dir: "left" | "right" | "up" | "down", step = rat(1, division), extend = selecting) {
    if (!cursor) return;
    if (extend) anchor ??= cursor.at;
    else clearSelection();
    moveCursorBy(dir, step);
    if (extend) selectTo(cursor.at);
  }

  function moveCursorBy(dir: "left" | "right" | "up" | "down", step: Rat) {
    if (!cursor) return;
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
    selecting = false;
    anchor = undefined;
    cursor = undefined;
    digits = "";
  }

  // 보기 메뉴에서 타브 숫자판을 끄면 열려 있던 숫자판도 닫는다
  let padByMouseBefore = untrack(() => padByMouse);
  $effect(() => {
    const on = padByMouse;
    if (padByMouseBefore && !on && untrack(() => touchPad)) closePad();
    padByMouseBefore = on;
  });

  // 숫자판이 지판 칸을 줄이므로, 숫자판을 띄운 동안 커서가 움직이면 커서 줄이 보이게 지판 칸을 세로로 굴린다
  // (편집 직전의 세로 보이기는 숫자판과 상관없이 ensureCursorVisible이 한다. 계산은 같은 revealRowScroll)
  $effect(() => {
    if (!padOpen) return;
    void cursor;
    void TOP;
    revealCursorRow();
  });

  function padFret(fret: number) {
    ensureCursorVisible();
    // 한도로 거절된 음이면 커서를 그 자리에 둔다. 넘어갈 때는 그 자리 음의 길이만큼 (4분음표면 다음 4분음표 자리).
    // 설정 → 화면에서 "아래 줄로"를 골랐으면 같은 자리 한 줄 아래로 내려가 화음을 쌓는다 (맨 아래 줄이면 그대로)
    const dur = enterFret(fret);
    if (!dur || !padAdvance || padChord) return;
    if (fretPadPrefs.advance === "down") moveCursor("down");
    else moveCursor("right", dur);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    // 숫자판의 볼륨 칸·버튼에서 친 키는 그 칸이 받는다
    if ((e.target as HTMLElement | null)?.closest?.("input, select, textarea, button")) return;
    const key = e.key;
    if (!cursor) {
      // 커서가 없을 때 숫자·방향키가 오면 지금 화면에 보이는 첫 칸·첫 줄에 커서를 만들고 그 키를 처리한다.
      // 키보드로 옮긴 커서와 똑같이 다룬다 (커서 따라가기도 평소대로)
      if (!(/^[0-9]$/.test(key) || /^Numpad[0-9]$/.test(e.code) || /^Arrow(Left|Right|Up|Down)$/.test(key))) return;
      cursor = { at: firstVisibleCell(start, division, (width - LEFT) / pxPerWhole), string: 1 };
    }
    // 편집 키는 적용하기 전에 커서 칸을 화면에 보이게 한다 (규칙은 ensureCursorVisible 한 곳)
    const digitKey = /^[0-9]$/.test(key) || /^Numpad[0-9]$/.test(e.code);
    if (digitKey || ["Delete", "Backspace", "l", "L", "&", "+", "=", "-"].includes(key) || e.code === "NumpadAdd" || e.code === "NumpadSubtract") ensureCursorVisible();
    // 고른 음이 있으면 옥타브 키(기본 Shift+↑/↓)는 앱 명령으로 넘긴다 (막지 않고 그대로 올려 보낸다). 고르기는 남는다
    if (arrowGoesToApp(key, selected.size > 0, octaveKey?.(e) ?? false)) return;
    if (/^[0-9]$/.test(key) || /^Numpad[0-9]$/.test(e.code)) {
      const digit = /^[0-9]$/.test(key) ? key : e.code.slice(6);
      const { fret, buffer, replaceId } = typeFretDigit(digits, lastFretNote, digit, cursor, tuning.maxFret);
      digits = buffer;
      clearTimeout(digitsTimer);
      if (buffer) digitsTimer = setTimeout(() => (digits = ""), 700);
      enterFret(fret, replaceId);
    } else if (key === "Delete" || key === "Backspace") deleteKey();
    else if (key === "l" || key === "L" || key === "&") tieKey();
    else if (key === "+" || key === "=" || e.code === "NumpadAdd") lengthKey(2);
    else if (key === "-" || e.code === "NumpadSubtract") lengthKey(0.5);
    // Shift+←/→: 커서 자리에서 시작해 시간 범위를 넓히고 좁힌다
    else if (key === "ArrowRight") moveCursor("right", undefined, e.shiftKey || selecting);
    else if (key === "ArrowLeft") moveCursor("left", undefined, e.shiftKey || selecting);
    else if (key === "ArrowUp") moveCursor("up", undefined, selecting);
    else if (key === "ArrowDown") moveCursor("down", undefined, selecting);
    // Esc: 고르기를 먼저 풀고, 고른 것이 없으면 숫자판을 닫는다
    else if (key === "Escape") {
      if (selected.size > 0 || selecting) clearSelection();
      else closePad();
    }
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
  /** 음표 볼륨 숫자를 켜면 지판 맨 아래(빠진 음 × 밑)에 더하는 볼륨 줄 높이. 끄면 0이라 지금과 같다 */
  const VOLUME_ROW = 14;
  const volumeRow = $derived(volumeLabels.mode === "off" ? 0 : VOLUME_ROW);
  const height = $derived(TOP + fontPx + 8 + gap * (tuning.strings.length - 1) + 16 + volumeRow);

  $effect(() => onunplayable?.(unplayable));

  // 재생선 따라가기: 재생선이 움직일 때만 돈다 (화면 start가 바뀐 것으로는 돌지 않는다). 편집으로 커서 쪽으로 옮긴 직후 잠깐은 쉰다
  $effect(() => {
    const at = playhead;
    if (at === undefined) return;
    untrack(() => {
      const next = followPlayhead(at, start, (width - LEFT) / pxPerWhole, performance.now(), playheadHoldUntil);
      if (next !== undefined) start = next;
    });
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
      if (!entry) return;
      width = Math.max(100, Math.floor(entry.contentRect.width));
      // 처음 폭을 알았을 때: 앞 보기에서 보이던 재생 위치가 이 화면에서도 보이게
      if (carryPending) {
        carryPending = false;
        start = carryViewStart(carry.place, (width - LEFT) / pxPerWhole, carry.cursor);
      }
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

    // 마디 번호 줄 (누르는 곳): 피아노롤 눈금자와 같은 바탕색과 아래 경계선
    g.fillStyle = css("--bg");
    g.fillRect(LEFT, 0, width - LEFT, TAB_RULER);
    g.fillStyle = css("--line");
    g.fillRect(LEFT, TAB_RULER - 1, width - LEFT, 1);
    // 원곡 파형 띠 (피아노롤과 같은 그리기): 변속 줄 아래, 첫 줄 위. 음 시작 눈금은 타브에 보이는 트랙 음으로
    // 바탕은 마디 번호 줄처럼 먼저 칠하고, 막대·눈금은 마디선 위에 그린다 (피아노롤 띠와 같은 순서)
    if (waveShown && wave) {
      g.fillStyle = css("--bg");
      g.fillRect(LEFT, TAB_WAVE_TOP, width - LEFT, WAVE_SIZE);
    }
    // 마디선과 마디 번호
    g.font = '10px "D2Coding", ui-monospace, Consolas, monospace';
    for (const gl of gridLines(song.timeSig, start, end)) {
      if (gl.kind !== "measure") continue;
      g.fillStyle = css("--line");
      g.fillRect(x(gl.at), 4, 1, y(tuning.strings.length) - 4);
      g.fillStyle = css("--muted");
      g.fillText(String(gl.bar), x(gl.at) + 3, TAB_RULER_BASELINE);
    }
    if (waveShown && wave) {
      drawWaveStrip(g, {
        peaks: wave.peaks,
        offset: waveDrag?.live ? waveDrag.offset : wave.offset,
        tempo: song.tempo,
        start,
        pxPerWhole,
        axisStart: LEFT,
        length: width - LEFT,
        at: TAB_WAVE_TOP,
        size: WAVE_SIZE,
        horizontal: true,
        starts: noteStarts(tracks, start, end),
        screenOf: x,
        css,
      });
    }
    // 반복 구간 (끄는 중이면 그 범위): 타브 전체에 옅은 띠, 마디 번호 줄은 조금 진하게 (피아노롤과 같은 색)
    const range = marking ? ([Math.min(...marking), Math.max(...marking)] as const) : loop;
    if (range && range[1] > range[0]) {
      const a = x(range[0]);
      const b = x(range[1]);
      g.fillStyle = "rgba(127,127,255,0.14)";
      g.fillRect(a, 0, b - a, height);
      g.fillRect(a, 0, b - a, TAB_RULER);
    }
    // 재생 위치: 피아노롤과 같은 점선
    if (playCursor !== undefined && playCursor >= start - 0.01 && playCursor <= end) {
      g.strokeStyle = css("--accent");
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(x(playCursor), 0);
      g.lineTo(x(playCursor), height);
      g.stroke();
      g.setLineDash([]);
    }

    // 변속: 템포·박자가 바뀌는 자리와 마커를 위쪽 변속 줄에 글자로(위 칸 템포, 아래 칸 박자·마커. 피아노롤과 같다),
    // 타브 전체에 점선으로 (마커는 피아노롤과 같은 곡 데이터).
    // 글자 자리는 누를 때 찾을 수 있게 남긴다 (같은 칸에 여럿이 있으면 옆으로 이어 쓴다)
    const visible = (at: Rat) => toFloat(at) >= start - 0.01 && toFloat(at) < end;
    const changes = [
      ...song.tempo.filter((e) => visible(e.at)).map((e) => ({ kind: "tempo" as const, at: e.at, text: `t${e.bpm}` })),
      ...song.timeSig.filter((e) => visible(e.at)).map((e) => ({ kind: "meter" as const, at: e.at, text: `${e.beats}/${e.unit}` })),
      ...song.markers.filter((e) => visible(e.at)).map((e) => ({ kind: "marker" as const, at: e.at, text: tabMarkerText(e.label), id: e.id })),
    ];
    eventSpots = layoutTabEvents(changes, (at) => x(toFloat(at)), (text) => g.measureText(text).width);
    const eventColor = { tempo: css("--ev-tempo"), meter: css("--ev-meter"), marker: css("--ev-marker") };
    // 두 칸 경계 (피아노롤 이벤트 줄처럼)
    g.fillStyle = css("--line");
    g.fillRect(LEFT, tabEventText(1).top, width - LEFT, 1);
    for (const e of eventSpots) {
      const box = tabEventText(e.row);
      const px = x(toFloat(e.at));
      const color = eventColor[e.kind];
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(px + 0.5, box.top);
      g.lineTo(px + 0.5, y(tuning.strings.length));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = color;
      g.fillText(e.text, e.left, box.baseline);
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
    // 볼륨 줄 이름: 줄 이름 칸에 작은 v (무슨 줄인지 알게)
    /** 볼륨 줄 글자 기준선: 맨 아래 줄 숫자와 그 아래 빠진 음 × 밑 */
    const volumeY = y(tuning.strings.length) + fontPx + 4 + VOLUME_ROW;
    if (volumeRow > 0) {
      g.font = '10px "D2Coding", ui-monospace, Consolas, monospace';
      g.fillStyle = css("--muted");
      g.fillText("v", 6, volumeY);
      g.font = `${fontPx}px "D2Coding", ui-monospace, Consolas, monospace`;
    }

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
        // 음이 시작하는 자리에서 오른쪽으로 쓴다 (마디 첫 음이 마디선·박자 글자와 겹치지 않게)
        const left = fretBoxLeft(x(first.t));
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
        // 고른 음: 숫자 칸을 강조색으로 옅게 (트랙 색 위에 덧칠해 알아보게)
        if (list.slice(i, j).some((p) => selected.has(p.id))) {
          g.globalAlpha = 0.38;
          g.fillStyle = css("--accent");
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
        const marks = "×".repeat(missing);
        g.fillStyle = css("--danger");
        g.fillText(marks, fretCenter(x(t), g.measureText(marks).width), y(tuning.strings.length) + fontPx + 4);
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
        const label = `(${a.fret})`;
        const w = g.measureText(label).width + 4;
        // 앞 숫자 가운데에서 이어 울리는 자리의 (5) 칸 가운데까지
        const from = fretCenter(x0, g.measureText(String(a.fret)).width);
        const to = fretCenter(x1, w - 4);
        g.beginPath();
        g.moveTo(from + 2, yy);
        g.quadraticCurveTo((from + to) / 2, yy - 7, to - 2, yy);
        g.stroke();
        g.fillStyle = css("--panel");
        g.fillRect(fretBoxLeft(x1), y(a.string) - fontPx / 2 - 1, w, fontPx + 2);
        g.fillStyle = css("--muted");
        g.fillText(label, to, y(a.string) + fontPx * 0.36);
      } else {
        if (grouped.has(l.to)) continue;
        const b = placed.get(l.to);
        if (!b || x(b.t) < LEFT - 20 || x(a.t) > width + 20) continue;
        g.globalAlpha = a.string === b.string ? 1 : 0.4;
        const tilt = (l.up ? 1 : -1) * Math.max(4, fontPx * 0.35);
        g.beginPath();
        // 앞 숫자 칸 오른쪽 끝에서 뒤 숫자 칸 왼쪽 끝까지
        const wa = g.measureText(String(a.fret)).width;
        g.moveTo(fretCenter(x(a.t), wa) + wa / 2 + 3, y(a.string) + tilt);
        g.lineTo(fretBoxLeft(x(b.t)) - 1, y(b.string) - tilt);
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    // 볼륨 줄: 고르는 트랙 음의 v (피아노롤 볼륨 숫자와 같은 규칙). 프렛 숫자와 같은 왼쪽 끝에, 앞 숫자와 겹치면 건너뛴다.
    // 고른 음이면 진하게. 그리기만 한다 (누르기는 지판 칸 규칙 그대로)
    const own = tracks.find((t) => t.id === activeTrackId);
    if (volumeRow > 0 && own) {
      g.textAlign = "left";
      g.font = '11px "D2Coding", ui-monospace, Consolas, monospace';
      const labels = volumeLabelNotes(own.notes, volumeLabels.mode, start - 0.01, end);
      let prevEnd: number | undefined;
      for (const n of [...own.notes].filter((m) => labels.has(m.id)).sort((a, b) => cmp(a.start, b.start))) {
        const text = `v${labels.get(n.id)}`;
        const left = fretBoxLeft(x(toFloat(n.start)));
        if (!labelFits(prevEnd, left, 2)) continue;
        prevEnd = left + g.measureText(text).width;
        g.fillStyle = css(selected.has(n.id) ? "--text" : "--muted");
        g.fillText(text, left + 2, volumeY);
      }
      g.font = `${fontPx}px "D2Coding", ui-monospace, Consolas, monospace`;
    }
    g.textAlign = "left";
    g.restore();

    // 타브 커서: 그 줄·그 자리에 칸 표시
    if (cursor) {
      // 숫자 칸(한 자리 숫자)을 감싸게 숫자와 같은 만큼 오른쪽으로
      g.font = `${fontPx}px "D2Coding", ui-monospace, Consolas, monospace`;
      // 왼쪽 끝은 숫자 칸 왼쪽(마디선을 덮지 않게), 가운데는 숫자 가운데
      const at = x(toFloat(cursor.at));
      const cx = fretCenter(at, g.measureText("0").width);
      const left = fretBoxLeft(at);
      g.strokeStyle = css("--accent");
      g.lineWidth = 2;
      g.strokeRect(left, y(cursor.string) - fontPx * 0.7, Math.max((cx - left) * 2, fontPx * 1.2), fontPx * 1.4);
    }

    if (playhead !== undefined) {
      g.fillStyle = css("--accent");
      g.fillRect(x(playhead), 0, 2, height);
    }
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="tab" bind:this={host} tabindex="0" role="application" {onkeydown}>
  <!-- 숫자판이 열리면 지판 칸이 줄어드니 위치와 상관없이 위에 붙인다 -->
  <div class="canvas-wrap" bind:this={wrap} data-align={padOpen ? "top" : align} style:min-height={padOpen ? `min(${height}px, 45%)` : undefined}>
    <canvas
      bind:this={canvas}
      class:event-hover={!!eventHover || rulerHover}
      class:wave-hover={waveHover || !!waveDrag}
      title={rulerHover ? t("ui.tabRulerHelp") : eventHover ? (eventHover.kind === "marker" ? t("ui.tabMarkerEdit", { name: markerName(eventHover) }) : t(eventHover.kind === "tempo" ? "ui.tabTempoEdit" : "ui.tabMeterEdit")) : bandHover !== undefined ? t(bandHover === 0 ? "ui.tabTempoAdd" : "ui.tabMarkerAdd") : undefined}
      {ondblclick}
      onpointerleave={() => ((eventHover = undefined), (bandHover = undefined), (rulerHover = false), (waveHover = false))} style:width="{width}px" style:height="{height}px" {onpointerdown} {onpointermove} {onpointerup} onpointercancel={onpointerup}></canvas>
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
          <button title={t("ui.fretPadTieHelp")} onclick={() => (ensureCursorVisible(), tieKey())}>{t("ui.fretPadTie")}</button>
          <button onclick={() => (ensureCursorVisible(), deleteKey())}>{t("ui.fretPadDelete")}</button>
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
        <!-- 고르기: 옆으로 미는 줄 밖에 두어 좁은 화면에서도 늘 보인다 -->
        <button class="select" class:on={selecting} aria-pressed={selecting} title={t("ui.fretPadSelectHelp")} onclick={toggleSelecting}>{t("ui.fretPadSelect")}</button>
        {#if noteLength !== undefined && onnotelength}
          <!-- 음 길이: 옆으로 미는 줄 밖에 두어 좁은 화면에서도 늘 보인다 -->
          <label class="length" title={t("ui.noteLengthHelp")}>
            {t("ui.noteLength")}
            <select value={noteLength} onchange={pickLength}>
              {#each noteLengths as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
              {#if ontuplet}<option value={TUPLET_PICK}>{t("ui.noteLengthTupletPick")}</option>{/if}
            </select>
          </label>
        {/if}
        <button class="close" title={t("ui.fretPadClose")} aria-label={t("ui.fretPadClose")} onclick={closePad}>×</button>
      </div>
      {#if noteLength !== undefined && onnotelength}
        <!-- 음표 입력판: 한 줄로 깔고 넘치면 옆으로 민다. 눌린 단추가 새 음 길이이고, 커서 음이 있으면 그 음에도 적용한다 -->
        <div class="lengths" role="group" aria-label={t("ui.lengthPad")}>
          {#each padLengths(noteLengths, fretPadPrefs.triplets, tupletPrefs.pad ? tupletLength : undefined) as l (l)}
            {@const on = padPressed(l, noteLength)}
            <button class:on aria-pressed={on} title={lengthLabel(l)} onclick={() => changeLength(l)}>
              {l === "grid" ? t("ui.lengthPadGrid") : on && !l.endsWith(".") && noteLength.endsWith(".") ? `${l}.` : l}
            </button>
          {/each}
        </div>
      {/if}
      <div class="frets">
        {#each Array.from({ length: tuning.maxFret + 1 }, (_, i) => i) as fret (fret)}
          <button onclick={() => padFret(fret)}>{fret}</button>
        {/each}
        <!-- 점 붙이기·떼기: 0~10, 11~20 두 줄의 빈 칸(20 다음)에 둔다 -->
        {#if ondot}<button class="dot" title={t("ui.dotToggleHelp")} aria-label={t("ui.dotToggle")} onclick={ondot}>.</button>{/if}
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
    <!-- 확대·타브 크기·지판 위치: 터치는 엄지가 닿는 여기, PC(마우스)는 피아노롤처럼 위 도구줄에 있다 -->
    {#if coarsePointer}
      <span class="zoom">
        <button class="small" title={t("ui.zoomOutTime")} onclick={() => zoomTime(1 / 1.25)}><Icon name="arrows-h" size={14} /><Icon name="minus" size={12} /></button>
        <button class="small" title={t("ui.zoomInTime")} onclick={() => zoomTime(1.25)}><Icon name="arrows-h" size={14} /><Icon name="plus" size={12} /></button>
        <button class="small" title={t("ui.tabSmaller")} onclick={() => resizeTab(-1)}>A−</button>
        <button class="small" title={t("ui.tabBigger")} onclick={() => resizeTab(1)}>A+</button>
        <button
          class="small tab-align"
          title={t("ui.tabAlign", { now: t(TAB_ALIGN_LABEL[align]), next: t(TAB_ALIGN_LABEL[nextTabAlign(align)]) })}
          aria-label={t("ui.tabAlign", { now: t(TAB_ALIGN_LABEL[align]), next: t(TAB_ALIGN_LABEL[nextTabAlign(align)]) })}
          onclick={cycleAlign}>{TAB_ALIGN_ICON[align]}</button
        >
      </span>
    {/if}
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
    /* 지판 위치: 남는 높이가 있을 때만 위 여백으로 옮긴다. justify-content: center는 넘칠 때 위가 잘려 굴려도 안 보이므로 쓰지 않는다 */
    display: flex;
    flex-direction: column;
    /* 캔버스 offsetTop(숫자판 굴리기)을 이 칸 기준으로 */
    position: relative;
  }
  .canvas-wrap > canvas {
    flex: none;
  }
  .canvas-wrap[data-align="middle"] > canvas {
    margin-block: auto;
  }
  .canvas-wrap[data-align="bottom"] > canvas {
    margin-top: auto;
  }
  canvas.wave-hover {
    cursor: grab;
  }
  canvas.event-hover {
    cursor: pointer;
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
  .length {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .length select {
    min-height: 34px;
  }
  .select {
    flex: none;
    min-height: 34px;
    min-width: 44px;
    padding-inline: 8px;
  }
  .moves button.on,
  .select.on {
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
  .lengths {
    display: flex;
    gap: 3px;
    max-width: 760px;
    overflow-x: auto;
  }
  .lengths button {
    flex: 1 0 auto;
    min-width: 40px;
    min-height: 34px;
    padding-inline: 6px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .lengths button.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  /* 0~10, 11~20 두 줄: 폰 폭에서도 세 줄 이상 쌓이지 않는다 */
  .frets .dot {
    font-weight: 700;
    font-size: 1.2em;
  }
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
