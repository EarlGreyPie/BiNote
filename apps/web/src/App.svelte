<script lang="ts">
  import type { SoundPackInfo } from "@mmlce/audio/browser";
  import {
    add,
    cmp,
    getProfile,
    positionToSeconds,
    secondsToWhole,
    toFloat,
    History,
    maxChordsOf,
    barBeatAt,
    measureStart,
    meterAt,
    meterGrid,
    foldPitch,
    rat,
    scaleNotes,
    soundingRangeOf,
    transposeNotes,
    DOUBLE,
    HALF,
    STANDARD_TUNING,
    trackInstrument,
    type Note,
    type Rat,
    type Command,
    type GameProfile,
    type Song,
    type TabTuning,
    type Track,
  } from "@mmlce/core";
  import {
    encode3mle,
    looksLikeMmlAt,
    PROJECT_EXTENSION,
    PROJECT_EXTENSIONS,
    projectFromObject,
    ProjectError,
    writeMmi,
    writeProject,
    type FileDiagnostic,
  } from "@mmlce/fileio";
  import { LOCALES } from "@mmlce/i18n";
  import {
    addPlayer,
    addTrack,
    appendSong,
    compactSong,
    deleteTime,
    distributeChords,
    distributeSong,
    insertTime,
    newSong,
    applyPlan,
    planMergeTracks,
    planMoveNotes,
    planVoiceByPitch,
    removeTrack,
    renamePlayer,
    renameTrack,
    duplicateTrack,
    moveTrack,
    moveTrackToNewPlayer,
    duplicateTrackToNewPlayer,
    shiftTrack,
    trackMoveBlock,
    setMeter,
    removeMeter,
    setMarker,
    moveMarker,
    removeMarker,
    setTempoAt,
    removeTempoAt,
    moveTempo,
    setTempos,
    fillScoreTempo,
    scoresMissingTempo,
    setPlayerInstrument,
    setTrackInstrument,
    setTrackRole,
    setTracksNotes,
    setTrackNotes,
    setTrackText,
    type SplitResult,
  } from "@mmlce/mml";
  import { analyzeSong, noteSpan, spanAt, textTimeline } from "./lib/analysis";
  import { Engine } from "./lib/engine";
  import { diag, i18n, instrumentName, LOCALE_LABELS, setLocale, t } from "./lib/i18n.svelte";
  import { download, openScore } from "./lib/load";
  import { flushAllEditors } from "./lib/MmlEditor.svelte";
  import ReferenceBar from "./lib/ReferenceBar.svelte";
  import TapBar from "./lib/TapBar.svelte";
  import { alignBarTempo, bpmAt, nearestBar, nearestBeat, tapTempos, type TapUnit } from "./lib/tempoSync";
  import SongChecks from "./lib/SongChecks.svelte";
  import TrackPane from "./lib/TrackPane.svelte";
  import type { TrackActions } from "./lib/trackActions";
  import type { Peaks } from "./lib/waveform";
  import { noteClipboard } from "./lib/noteClipboard.svelte";
  import { APPEARANCE_STORAGE, applyAppearance, parseAppearance, type Appearance } from "./lib/appearance";
  import VideoBar from "./lib/VideoBar.svelte";
  import { MidiKeys } from "./lib/midiKeys.svelte";
  import { loadStored, parseJson, saveStored } from "./lib/persist";
  import { untrack } from "svelte";
  import { clock } from "./lib/time";
  import { forgetPack, loadPacks, savePack } from "./lib/packStore";
  import { fileAccept, hasExtension } from "./lib/fileAccept";
  import { AutosaveTracker } from "./lib/autosave";
  import { splitJob, wavJob } from "./lib/jobs";
  import NoteList from "./lib/NoteList.svelte";
  import { forgetWork, listWorks, loadWork, newWorkId, saveWork, type WorkSummary } from "./lib/workStore";
  import { parseEditorState, withTrackView, type EditorState, type ReferenceFit, type TrackViewState, type VideoFit } from "./lib/projectEditor";
  import RecoverList from "./lib/RecoverList.svelte";
  import RecoverDialog from "./lib/RecoverDialog.svelte";
  import NoteInfo from "./lib/NoteInfo.svelte";

  const SCORE_FILES = [...PROJECT_EXTENSIONS, ".mml", ".mmi", ".txt", ".mid", ".midi"].join(",");
  const PACK_FILES = ".dls,.sf2,.sf3";
  import Menu, { type MenuItem } from "./lib/Menu.svelte";
  import MmlKeyPad from "./lib/MmlKeyPad.svelte";
  import AddScoreDialog from "./lib/AddScoreDialog.svelte";
  import HelpPopover from "./lib/HelpPopover.svelte";
  import Icon from "./lib/Icon.svelte";
  import MeterDialog from "./lib/MeterDialog.svelte";
  import EventDialog from "./lib/EventDialog.svelte";
  import SettingsDialog from "./lib/SettingsDialog.svelte";
  import StatusBar, { type StatusPanel } from "./lib/StatusBar.svelte";
  import Toolbar, { type RollLayer } from "./lib/Toolbar.svelte";
  import { coarsePointer, mmlPad } from "./lib/mmlPad.svelte";
  import VoiceDialog, { parseVoicePrefs, VOICE_STORAGE, type VoiceMode, type VoiceOptions, type VoicePreview } from "./lib/VoiceDialog.svelte";
  import TransposeDialog, { type TransposeCheck, type TransposeScope } from "./lib/TransposeDialog.svelte";
  import { Playback } from "./lib/playback.svelte";
  import { TUNINGS, type TuningName } from "./lib/tunings";
  import PianoRoll from "./lib/PianoRoll.svelte";
  import TabView from "./lib/TabView.svelte";
  import KeymapDialog from "./lib/KeymapDialog.svelte";
  import AboutDialog from "./lib/AboutDialog.svelte";
  import SplitPanel from "./lib/SplitPanel.svelte";
  import OutputPanel from "./lib/OutputPanel.svelte";
  import OptimizePreview from "./lib/OptimizePreview.svelte";
  import { outputRows, previewRows, tempoAdvice } from "./lib/output";
  import { placeChord, previousVolume, volumeForVelocity } from "./lib/midiInput";
  import { melodyTrackIds, peakPolyphony, scoreGroups, soundingAt, trackColors, type ColorScheme } from "./lib/scores";
  import PasteDialog from "./lib/PasteDialog.svelte";
  import MidiDialog from "./lib/MidiDialog.svelte";
  import { analyzeMidi, readSmf, songToSmf, writeSmf, type MidiAnalysis } from "@mmlce/midi";
  import {
    allowedWhileTyping,
    commandFor,
    GRID_DIVISIONS,
    keyName,
    keysOf,
    parseSettings,
    resolve,
    volumeForDigit,
    type CommandId,
    type KeymapSettings,
  } from "./lib/keymap";
  import { applyUpdate, checkStorage, pwa, requestPersistentStorage } from "./lib/pwa.svelte";
  import { guideUrl } from "./lib/links";
  import { VIDEO_DEFAULTS, noteLengthOf, type BackgroundVideo, type EventKind, type EventLabel, type EventRef, type NoteLength, type Orientation, type RollTool } from "./lib/roll";


  const engine = new Engine();
  let history: History | undefined;

  let song = $state.raw<Song | undefined>(undefined);
  let canUndo = $state(false);
  let canRedo = $state(false);
  let fileName = $state("");
  /** 저장할 때 생긴 알림 */
  let notices = $state.raw<FileDiagnostic[]>([]);
  let offerUtf8 = $state(false);
  let packs = $state.raw<readonly SoundPackInfo[]>([]);
  let loadingPack = $state("");
  let error = $state("");
  const playback = new Playback(engine);
  let activeTrackId = $state<string | undefined>(undefined);
  let orientation = $state<Orientation>("horizontal");
  let division = $state(16);
  /** 새 음 길이 (격자대로 또는 l4·l8. 같은 MML 길이) */
  let noteLength = $state<NoteLength>("grid");
  const newNoteDur = $derived(noteLengthOf(noteLength, division));
  const DIVISIONS = GRID_DIVISIONS;
  let viewMode = $state<"roll" | "tab">("roll");
  // 화면 모양: 테마·강조색·음 모양. 시스템 테마가 바뀌어도 롤을 다시 그리게 themeKey를 바꾼다
  let appearance = $state<Appearance>(loadStored(APPEARANCE_STORAGE, parseAppearance));
  function setAppearance(next: Appearance) {
    // 롤 캔버스가 다시 그릴 때 새 색을 읽도록 문서 테마를 먼저 바꾼다 (효과 순서에 기대지 않는다)
    applyAppearance(next, document.documentElement);
    appearance = next;
    saveStored(APPEARANCE_STORAGE, JSON.stringify(next));
  }
  let systemDark = $state(typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  $effect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => (systemDark = mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  });
  $effect(() => applyAppearance(appearance, document.documentElement));
  const themeKey = $derived(`${appearance.theme}:${appearance.accent}:${systemDark}`);

  const COLOR_STORAGE = "mmlce.colorScheme";
  let colorScheme = $state<ColorScheme>(loadStored(COLOR_STORAGE, (raw) => (raw === "score" || raw === "stored" ? raw : "position")));
  function setColorScheme(v: ColorScheme) {
    colorScheme = v;
    saveStored(COLOR_STORAGE, v);
  }
  // 피아노롤에 그릴 트랙: 고른 트랙 / 악보 / 전체 (기억)
  const LAYER_KEY = "mmlce.rollLayer";
  let rollLayer = $state<RollLayer>(loadStored(LAYER_KEY, (raw) => (raw === "track" || raw === "all" ? raw : "score")));
  function setRollLayer(v: RollLayer) {
    rollLayer = v;
    saveStored(LAYER_KEY, v);
  }
  // 세로 화면(아이패드 세로·폰): 롤 위, 트랙 패널 아래로 나누고 도구줄 일부는 ⋯ 메뉴로
  const portraitQuery = typeof matchMedia === "undefined" ? undefined : matchMedia("(max-aspect-ratio: 1/1)");
  let portrait = $state(portraitQuery?.matches ?? false);
  $effect(() => {
    const onchange = () => (portrait = portraitQuery?.matches ?? false);
    portraitQuery?.addEventListener("change", onchange);
    return () => portraitQuery?.removeEventListener("change", onchange);
  });
  // 도구줄이 한 줄에 안 들어가는 폭(아이패드 가로 포함)에서는 일부를 ⋯ 메뉴로 넘긴다
  const compactQuery = typeof matchMedia === "undefined" ? undefined : matchMedia("(max-width: 1300px), (max-aspect-ratio: 1/1)");
  let narrow = $state(compactQuery?.matches ?? false);
  $effect(() => {
    const onchange = () => (narrow = compactQuery?.matches ?? false);
    compactQuery?.addEventListener("change", onchange);
    return () => compactQuery?.removeEventListener("change", onchange);
  });
  let statusPanel = $state<StatusPanel | undefined>(undefined);
  let settings = $state<{ section: "packs" | "playback" | "display" | "keys" } | undefined>(undefined);
  let meterOpen = $state(false);
  let addScoreOpen = $state(false);
  let tuningName = $state<TuningName>("standard");
  let capo = $state(0);
  let unplayable = $state(0);
  /** 배경 영상은 사용자가 고른 로컬 파일만 쓴다 */
  let video = $state<BackgroundVideo | undefined>(undefined);
  let videoName = $state("");
  /** 곡 없이 배경 영상만 재생 중. 곡을 재생하면 곡 시계로 넘어간다 */
  let videoPlay = $state(false);

  const KEYMAP_STORAGE = "mmlce.keymap";
  let keymap = $state.raw<KeymapSettings>(loadStored(KEYMAP_STORAGE, (raw) => parseSettings(parseJson(raw) ?? null)));
  let showKeymap = $state(false);
  /** BiNote 정보 창. checkNow면 열자마자 업데이트를 확인한다 */
  let about = $state<{ checkNow: boolean } | undefined>(undefined);
  const bindings = $derived(resolve(keymap));
  let roll = $state<ReturnType<typeof PianoRoll> | undefined>(undefined);
  let openInput: HTMLInputElement;
  let packInput: HTMLInputElement;
  /** MML@ 붙여넣기 창. 열려 있으면 처음 채울 글 */
  let paste = $state<{ text: string } | undefined>(undefined);
  /** MIDI 가져오기 창 */
  let midi = $state.raw<{ analysis: MidiAnalysis; name: string } | undefined>(undefined);

  function setKeymap(next: KeymapSettings) {
    keymap = next;
    saveStored(KEYMAP_STORAGE, JSON.stringify(next));
  }

  /** 버튼 툴팁에 붙일 첫 번째 키 */
  function hint(command: CommandId): string {
    const k = keysOf(bindings, command)[0];
    return k ? ` (${k})` : "";
  }

  function onVideo(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    // 안드로이드는 고르기 창에서 거르지 않으므로 여기서 영상인지 본다
    if (file.type && !file.type.startsWith("video/")) {
      error = t("ui.openFailed", { name: file.name });
      return;
    }
    if (video) URL.revokeObjectURL(video.url);
    // 프로젝트에 맞춰 둔 같은 이름 영상이면 그 맞춤값을 쓴다
    const saved = savedFits.video?.name === file.name ? savedFits.video : undefined;
    // 맞춤 설정은 영상을 바꿔도 이어 쓴다 (같은 채널 영상을 여러 개 찍을 때)
    const keep = saved ?? (video ? { fit: video.fit, low: video.low, high: video.high, keyLine: video.keyLine, stretch: video.stretch } : VIDEO_DEFAULTS);
    video = {
      url: URL.createObjectURL(file),
      opacity: saved?.opacity ?? video?.opacity ?? 0.5,
      offset: saved?.offset ?? 0,
      sound: false,
      fit: keep.fit,
      low: keep.low,
      high: keep.high,
      keyLine: keep.keyLine,
      stretch: keep.stretch,
    };
    videoName = file.name;
  }

  /** 프로젝트·지난 작업에 적혀 있던 원곡·영상 맞춤값. 같은 이름 파일을 불러오면 쓴다 */
  let savedFits = $state.raw<{ reference?: ReferenceFit | undefined; video?: VideoFit | undefined }>({});
  /** 트랙 눈(롤에서 숨김)·잠금(편집 막기). 듣기(M/S)와 따로이고 실행 취소에 안 들어간다. 프로젝트 파일에 남는다 */
  let trackView = $state.raw<Readonly<Record<string, TrackViewState>>>({});
  const hiddenIds = $derived(new Set(Object.keys(trackView).filter((id) => trackView[id]?.hidden)));
  const lockedIds = $derived(new Set(Object.keys(trackView).filter((id) => trackView[id]?.locked)));
  /** 잠근 트랙이 아닐 때만 true. 잠갔으면 짧게 알린다 */
  function editable(trackId: string): boolean {
    if (!lockedIds.has(trackId)) return true;
    flash(t("ui.trackLockedFlash"));
    return false;
  }

  // 원곡 동시재생: 템포를 찾을 때 원곡과 MML을 같은 시계로 같이 튼다. 어긋남은 ms, 원곡이 늦으면 양수
  let reference = $state<{ name: string; duration: number; offsetMs: number; volume: number } | undefined>(undefined);
  /** 원곡 파형 요약 (피아노롤 마디 줄 아래 띠). 원곡을 불러올 때 한 번 만든다 */
  let referencePeaks = $state.raw<Peaks | undefined>(undefined);
  /** 원곡 파형 띠 보이기 */
  let showWave = $state(true);
  let loadingReference = $state(false);

  async function onReference(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    loadingReference = true;
    try {
      const duration = await engine.loadReference(file);
      const saved = savedFits.reference?.name === file.name ? savedFits.reference : undefined;
      const keep = saved ?? reference ?? { offsetMs: 0, volume: 0.8 };
      reference = { name: file.name, duration, offsetMs: keep.offsetMs, volume: keep.volume };
      referencePeaks = engine.referencePeaks();
      engine.setReferenceOffset(keep.offsetMs / 1000);
      engine.setReferenceVolume(keep.volume);
    } catch (e) {
      error = t("ui.referenceFailed", { name: file.name });
      console.error(e);
    } finally {
      loadingReference = false;
    }
  }

  function setReferenceOffset(ms: number) {
    if (!reference || !Number.isFinite(ms)) return;
    reference = { ...reference, offsetMs: ms };
    engine.setReferenceOffset(ms / 1000);
  }

  function setReferenceVolume(volume: number) {
    if (!reference) return;
    reference = { ...reference, volume };
    engine.setReferenceVolume(volume);
  }

  function removeReference() {
    engine.clearReference();
    reference = undefined;
    referencePeaks = undefined;
  }

  function removeVideo() {
    if (video) URL.revokeObjectURL(video.url);
    video = undefined;
    videoName = "";
    videoPlay = false;
  }
  const tuning = $derived<TabTuning>({ ...STANDARD_TUNING, strings: TUNINGS[tuningName].strings, capo });


  const profile = $derived(getProfile(song?.meta.profileId ?? "mobile"));
  /** 피아노롤에 보일 음 높이: C0~B8 (게임 프로필의 옥타브 범위가 더 좁으면 그 안) */
  const pitchRange = $derived<readonly [number, number]>([
    Math.max(12, (profile.octave.min + 1) * 12),
    Math.min(119, (profile.octave.max + 1) * 12 + 11),
  ]);
  const analysis = $derived(song ? analyzeSong(song, profile) : undefined);
  // 악보 하나에 담는 트랙 수는 악기마다 (오르골 3)
  const chordsOf = $derived((playerId: string) => maxChordsOf(profile, song?.players.find((p) => p.id === playerId)?.instrument.canonical));
  const groups = $derived(song ? scoreGroups(song, chordsOf) : []);
  /** 멜로디 트랙 (음량 레인 여러 트랙 그리기) */
  const melodyIds = $derived(song ? melodyTrackIds(song, groups) : new Set<string>());
  /** 음량 레인에 고른 트랙과 같이 그리는 트랙 (트랙 목록 Ctrl+클릭) */
  let laneExtra = $state<readonly string[]>([]);
  function toggleLaneTrack(id: string) {
    if (id === activeTrackId) return;
    laneExtra = laneExtra.includes(id) ? laneExtra.filter((x) => x !== id) : [...laneExtra, id];
  }
  /** 음량 레인 한 획이 여러 트랙을 바꿀 때 (잠근 트랙은 뺀다) */
  function editVolumes(changes: { trackId: string; notes: Note[] }[], label: string) {
    const open = changes.filter((c) => editable(c.trackId));
    if (history && open.length > 0) sync(history.run(setTracksNotes(open, label)));
  }
  // 트랙 색은 지금 보이는 테마(밝게·어둡게)에 맞춘 짝을 쓴다
  const paletteTheme = $derived(appearance.theme === "system" ? (systemDark ? "dark" : "light") : appearance.theme);
  const colors = $derived(song ? trackColors(song, groups, colorScheme, paletteTheme) : new Map<string, string>());
  // 롤 레이어에 따라 그릴 트랙 (고른 트랙은 롤이 항상 그린다)
  const rollTracks = $derived.by(() => {
    const layer =
      rollLayer === "all" || !activeTrackId
        ? undefined
        : rollLayer === "track"
          ? [activeTrackId]
          : (groups.find((g) => g.trackIds.includes(activeTrackId!))?.trackIds ?? [activeTrackId]);
    if (hiddenIds.size === 0) return layer;
    // 눈을 끈 트랙은 롤에서 뺀다 (고른 트랙은 늘 보인다)
    return (layer ?? song?.tracks.map((tr) => tr.id) ?? []).filter((id) => id === activeTrackId || !hiddenIds.has(id));
  });
  // 재생 커서와 반복 구간(온음표 단위). 피아노롤에서 Shift+클릭 / Shift+끌기
  let cursor = $state<number | undefined>(undefined);
  /**
   * 편집 위치를 분수로 정확히 알 때(검사 위치·MIDI 입력·붙여넣기 끝) 그 값. 화면 커서(cursor)는 그리기용 소수라,
   * 편집에 쓸 때는 cursor가 이 값 그대로면 이 분수를, 다르면(사용자가 화면에서 옮김) 칸에 맞춘 값을 쓴다
   */
  let cursorExact = $state.raw<Rat | undefined>(undefined);
  function setCursor(at: Rat) {
    cursorExact = at;
    cursor = toFloat(at);
  }
  /** 편집에 쓸 커서 위치 (분수). l7처럼 칸에 안 맞는 자리도 반올림하지 않는다 */
  function editCursor(): Rat | undefined {
    if (cursor === undefined) return undefined;
    return cursorExact && toFloat(cursorExact) === cursor ? cursorExact : asRat(cursor);
  }
  let loop = $state<readonly [number, number] | undefined>(undefined);
  /** 이번 재생을 시작한 곡 시각(초). position은 여기서부터 흐른 시간 */
  const playing = $derived(playback.playing);
  $effect(() => {
    if (playing) videoPlay = false;
  });
  const songSeconds = $derived(playback.seconds);
  const playhead = $derived(playback.playhead(song));
  const asRat = (time: number) => rat(Math.round(time * 960), 960);
  // 동시발음 모니터: 재생 중이면 재생선, 아니면 커서 자리. 곡 전체 최대도 함께
  const peak = $derived(song ? peakPolyphony(song) : { count: 0, at: 0 });
  const nowAt = $derived(playhead ?? cursor);
  /** 멈춘 뒤에도 MML 입력창에 그 자리 음 표시 (기억, 기본 켬) */
  const PAUSE_MARK_KEY = "mmlce.pauseMark";
  let pauseMark = $state(loadStored(PAUSE_MARK_KEY, (raw) => raw !== "0"));
  function togglePauseMark() {
    pauseMark = !pauseMark;
    saveStored(PAUSE_MARK_KEY, pauseMark ? "1" : "0");
  }
  // 재생 중 트랙 글에서 지금 울리는 음 (고른 트랙). 음이 바뀔 때만 새 값을 낸다.
  // "멈춘 자리 MML에 표시"를 켜면 멈춘 뒤에도 커서(일시정지한 자리) 음을 표시한다
  const markAt = $derived(playhead ?? (pauseMark ? cursor : undefined));
  const playingSpans = $derived.by(() => {
    const out = new Map<string, readonly [number, number]>();
    const at = markAt;
    if (!song || at === undefined) return out;
    // 편집기에 열린 트랙만 (고른 트랙 + 편집기 둘 나란히의 아래 트랙)
    for (const id of [activeTrackId, secondTrackId]) {
      const tr = song.tracks.find((x) => x.id === id);
      const span = tr ? spanAt(textTimeline(song, tr), at) : undefined;
      if (tr && span) out.set(tr.id, span);
    }
    return out;
  });
  const soundingNow = $derived(song && nowAt !== undefined ? soundingAt(song, nowAt) : undefined);
  // 위쪽 시계: 지금 템포(재생선 또는 커서 자리)와 곡 전체 길이
  const tempoNow = $derived.by(() => {
    if (!song) return undefined;
    const at = nowAt ?? 0;
    let bpm = song.tempo[0]?.bpm;
    for (const e of song.tempo) if (toFloat(e.at) <= at + 1e-9) bpm = e.bpm;
    return bpm;
  });
  const totalSeconds = $derived.by(() => {
    if (!song) return 0;
    let end = rat(0);
    for (const tr of song.tracks) for (const n of tr.notes) if (cmp(add(n.start, n.dur), end) > 0) end = add(n.start, n.dur);
    return positionToSeconds(song.tempo, end);
  });
  const clockNow = $derived(playing ? songSeconds : song && cursor !== undefined ? positionToSeconds(song.tempo, asRat(cursor)) : 0);

  function sync(next: Song) {
    song = next;
    // 실행 취소로 트랙이 사라지면 남은 트랙을 고른다
    if (activeTrackId !== undefined && !next.tracks.some((tr) => tr.id === activeTrackId)) activeTrackId = next.tracks[0]?.id;
    canUndo = history?.canUndo ?? false;
    canRedo = history?.canRedo ?? false;
  }

  function editText(trackId: string, text: string) {
    if (!history) return;
    const track = history.song.tracks.find((tr) => tr.id === trackId);
    // 편집기가 닫히며 남은 입력을 저장할 때 그 트랙이 이미 지워졌을 수 있다
    if (!track || track.mml?.text === text || !editable(trackId)) return;
    sync(history.run(setTrackText(trackId, text)));
  }

  function editNotes(trackId: string, notes: Note[], label: string) {
    if (history && editable(trackId)) sync(history.run(setTrackNotes(trackId, notes, label)));
  }

  /** 게임에 넣기 점검판. 열려 있는 동안 곡이 바뀌면 바로 다시 센다 */
  let outputOpen = $state(false);
  const output = $derived(outputOpen && song && analysis ? { rows: outputRows(song, profile, analysis), tempo: tempoAdvice(song, profile.tempo) } : undefined);
  function openOutput() {
    if (song) outputOpen = true;
  }

  /** 나누기 결과. 곡이 바뀌면 지운다 */
  let split = $state.raw<{ song: Song; result: SplitResult } | undefined>(undefined);
  /** 나누는 중이면 진행률 (0~1). 계산은 Web Worker에서 한다 */
  let splitProgress = $state<number | undefined>(undefined);
  const splitting = $derived(splitProgress !== undefined);
  const splitRunner = splitJob();
  /** 나누기 요청 번호 (WAV의 wavToken과 같은 쓰임) */
  let splitToken = 0;
  /** WAV로 저장하는 중이면 진행률 (0~1). 그리기는 Web Worker에서 한다 */
  let wavProgress = $state<number | undefined>(undefined);
  const wavRunner = wavJob();
  /** WAV 저장 요청 번호. 취소하거나 새로 시작하면 바뀌어, 앞 요청의 늦은 진행률·결과를 버린다 */
  let wavToken = 0;
  /** 상태줄에 잠깐 보여 주는 글 (글자 수 줄이기 결과) */
  let compactNote = $state("");
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  function flash(text: string) {
    compactNote = text;
    clearTimeout(flashTimer);
    flashTimer = text ? setTimeout(() => (compactNote = ""), 5000) : undefined;
  }

  function totalChars(s: Song): number {
    return analyzeSong(s, profile).tracks.reduce((sum, tr) => sum + tr.text.length, 0);
  }

  /** 글자 수 줄이기·화음 분산 미리보기. 적용하면 같은 명령을 실행 취소 한 칸으로 넣는다 */
  let optimizing = $state.raw<{ kind: "compact" | "distribute"; before: Song; after: Song; moved: number } | undefined>(undefined);

  function compact() {
    if (!song) return;
    optimizing = { kind: "compact", before: song, after: compactSong(profile).apply(song), moved: 0 };
  }

  function distribute() {
    if (!song) return;
    const spread = distributeChords(song, profile);
    optimizing = { kind: "distribute", before: song, after: compactSong(profile).apply(spread.song), moved: spread.moved };
  }

  function applyOptimize() {
    if (!history || !song || !optimizing || optimizing.before !== song) return;
    const before = totalChars(song);
    const next = history.run(optimizing.kind === "compact" ? compactSong(profile) : distributeSong(profile));
    sync(next);
    flash(t("ui.compactDone", { before, after: totalChars(next) }));
  }

  /** 미리보기 표에서 트랙 앞에 붙일 악보 이름 */
  function scoreLabel(trackId: string): string {
    const g = groups.find((x) => x.trackIds.includes(trackId));
    return g ? t("ui.scoreN", { n: g.number }) : "";
  }

  /** 지금 나누고 있는 곡 */
  let splitTarget: Song | undefined;
  async function runSplit() {
    if (!song) return;
    const target = song;
    splitTarget = target;
    split = undefined;
    splitProgress = 0;
    const token = ++splitToken;
    const result = await splitRunner.run({ song: target, profile: $state.snapshot(profile) as GameProfile }, (p) => {
      if (token === splitToken) splitProgress = p;
    });
    // 취소했거나 다른 나누기가 시작됐으면 버린다
    if (token !== splitToken) return;
    splitTarget = undefined;
    splitProgress = undefined;
    if (result && song === target) split = { song: target, result };
  }
  function cancelSplit() {
    splitToken++;
    splitTarget = undefined;
    splitRunner.cancel();
    splitProgress = undefined;
  }
  // 나누는 동안 곡이 바뀌면 (편집·열기) 계산을 멈춘다: 결과가 옛 곡 것이라 쓸 수 없다
  $effect(() => {
    const now = song;
    untrack(() => {
      if (splitTarget && now !== splitTarget) cancelSplit();
    });
  });

  function undo() {
    if (history) sync(history.undo());
  }

  function redo() {
    if (history) sync(history.redo());
  }

  async function onOpen(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (/\.midi?$/i.test(file.name)) {
      try {
        midi = { analysis: analyzeMidi(readSmf(new Uint8Array(await file.arrayBuffer()))), name: file.name };
        error = "";
      } catch {
        error = t("ui.openFailed", { name: file.name });
      }
      return;
    }
    try {
      const result = await openScore(file);
      openSong(result.song, file.name);
      if (result.editor) {
        applyEditor(parseEditorState(result.editor, result.song));
        notices = [...result.diagnostics, ...fitNotices()];
      }
    } catch (e) {
      error = e instanceof ProjectError ? `${file.name}: ${diag(e)}` : t("ui.openFailed", { name: file.name });
    }
  }

  /** 프로젝트·지난 작업에 적힌 편집 화면 상태를 되살린다 */
  function applyEditor(state: EditorState) {
    if (state.activeTrackId) activeTrackId = state.activeTrackId;
    if (state.division) division = state.division;
    noteLength = state.noteLength ?? "grid";
    if (state.viewMode) viewMode = state.viewMode;
    if (state.tuning) tuningName = state.tuning;
    if (state.capo !== undefined) capo = state.capo;
    savedFits = { reference: state.reference, video: state.video };
    trackView = state.trackView ?? {};
    // 같은 원곡이 이미 열려 있으면 맞춤값을 바로 쓴다
    if (state.reference && reference?.name === state.reference.name) {
      setReferenceOffset(state.reference.offsetMs);
      setReferenceVolume(state.reference.volume);
    }
  }

  /** 다시 불러오면 맞춤값을 이어 쓸 원곡·영상 알림 */
  function fitNotices(): FileDiagnostic[] {
    const out: FileDiagnostic[] = [];
    const r = savedFits.reference;
    if (r && reference?.name !== r.name) out.push({ level: "info", code: "project-reference", params: { name: r.name }, span: [0, 0], where: "" });
    const v = savedFits.video;
    if (v && videoName !== v.name) out.push({ level: "info", code: "project-video", params: { name: v.name }, span: [0, 0], where: "" });
    return out;
  }

  /** 지금 편집 화면 상태 (프로젝트 저장·자동 보존) */
  function editorState(): EditorState {
    const ref: ReferenceFit | undefined = reference
      ? { name: reference.name, offsetMs: reference.offsetMs, volume: reference.volume }
      : savedFits.reference;
    const vid: VideoFit | undefined =
      video && videoName
        ? { name: videoName, opacity: video.opacity, offset: video.offset, fit: video.fit, low: video.low, high: video.high, keyLine: video.keyLine, stretch: video.stretch }
        : savedFits.video;
    return {
      ...(activeTrackId ? { activeTrackId } : {}),
      division,
      ...(noteLength !== "grid" ? { noteLength } : {}),
      viewMode,
      tuning: tuningName,
      capo,
      ...(ref ? { reference: ref } : {}),
      ...(vid ? { video: vid } : {}),
      ...(Object.keys(trackView).length > 0 ? { trackView } : {}),
    };
  }

  const APP_VERSION = `${__MMLCE_BUILD__.version}${__MMLCE_BUILD__.commit ? ` · ${__MMLCE_BUILD__.commit}` : ""}`;

  function saveProject() {
    if (!song) return;
    // 편집기에 아직 반영 안 된 입력까지 넣고 저장한다
    flushAllEditors();
    const current = history?.song ?? song;
    download(new TextEncoder().encode(writeProject(current, { editor: { ...editorState() }, app: APP_VERSION })), `${baseName()}${PROJECT_EXTENSION}`);
    notices = [];
    offerUtf8 = false;
  }

  // 작업 자동 보존: 곡을 열거나 새로 만들 때마다 새 작업 id. 고친 뒤에만 적는다
  let workId = newWorkId();
  /** 이 작업으로 저장에 성공한 곡 (아직 안 적었으면 연 그대로의 곡). 이것과 같으면 적을 것이 없다.
   *  실행 취소로 연 그대로 돌아와도 이미 적은 기록이 있으면 그 기록을 지금 상태로 고쳐 적는다.
   *  저장이 실패하면 적지 않은 것으로 남아 다음 기회에 다시 적는다 */
  const autosaved = new AutosaveTracker<Song>();
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let autosaveQueue: Promise<void> = Promise.resolve();
  let works = $state.raw<readonly WorkSummary[]>([]);
  let recoverOpen = $state(false);

  async function refreshWorks() {
    works = await listWorks();
  }
  void refreshWorks();
  // 홈 화면에 설치해 쓰면 묻지 않고도 지속 공간을 주는 브라우저가 많다 (iPad 홈 화면 앱 등)
  if (typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches) void requestPersistentStorage();
  else void checkStorage();

  /** 바뀐 곡을 자동 보존에 적는다. 돌려준 약속은 그 저장(또는 이미 진행 중인 저장)이 끝나면 풀린다 */
  function flushAutosave(): Promise<void> {
    clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
    const current = history?.song;
    if (!autosaved.dirty(current)) return autosaveQueue;
    const done = autosaved.begin(current);
    const record = {
      id: workId,
      savedAt: Date.now(),
      fileName,
      title: current.meta.title,
      trackCount: current.tracks.length,
      noteCount: current.tracks.reduce((sum, tr) => sum + tr.notes.length, 0),
      project: writeProject(current, { editor: { ...editorState() }, app: APP_VERSION }),
    };
    // 보낸 순서대로 적는다: 늦게 끝난 앞 저장이 뒤 저장을 덮지 않게
    const job = autosaveQueue.then(() => saveWork(record)).then(done);
    // 한 번 실패해도 다음 저장은 이어서 한다
    autosaveQueue = job.catch(() => {});
    return job;
  }

  $effect(() => {
    const now = song;
    untrack(() => {
      if (!autosaved.dirty(now)) return;
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => flushAutosave().catch(() => {}), 1500);
    });
  });

  // 탭을 숨기거나 닫을 때 바로 적는다 (모바일은 beforeunload가 잘 오지 않는다)
  $effect(() => {
    const onhide = () => {
      if (document.visibilityState !== "hidden") return;
      // 편집기에 아직 반영 안 된 입력까지
      flushAllEditors();
      flushAutosave().catch(() => {});
    };
    const onpagehide = () => {
      flushAllEditors();
      flushAutosave().catch(() => {});
    };
    document.addEventListener("visibilitychange", onhide);
    window.addEventListener("pagehide", onpagehide);
    return () => {
      document.removeEventListener("visibilitychange", onhide);
      window.removeEventListener("pagehide", onpagehide);
    };
  });

  async function restoreWork(id: string) {
    const record = await loadWork(id);
    try {
      if (!record) throw new Error("gone");
      const result = projectFromObject(JSON.parse(record.project));
      openSong(result.song, record.fileName);
      // 되살린 작업을 이어 고치면 같은 기록을 덮어쓴다
      workId = id;
      applyEditor(parseEditorState(result.editor, result.song));
      notices = [...result.diagnostics, ...fitNotices()];
      recoverOpen = false;
    } catch {
      error = t("ui.recoverFailed");
    }
    void refreshWorks();
  }

  async function removeWork(id: string) {
    await forgetWork(id);
    await refreshWorks();
  }

  function openSong(next: Song, name: string) {
    // 앞 곡에서 찍다 만 탭은 버린다. 남겨 두면 정지 감지가 새 곡 템포를 바꾼다
    taps = [];
    tapResult = "";
    stop();
    error = "";
    notices = [];
    offerUtf8 = false;
    // 앞 곡 편집기에 남은 입력과 자동 보존을 먼저 적고, 새 곡은 새 작업으로
    flushAllEditors();
    flushAutosave().catch(() => {});
    workId = newWorkId();
    autosaved.reset(next);
    savedFits = {};
    trackView = {};
    history = new History(next);
    sync(next);
    activeTrackId = next.tracks[0]?.id;
    fileName = name;
    flash("");
    split = undefined;
    // 앞 곡의 커서·반복 구간·치던 화음이 새 곡에 남지 않게
    cursor = undefined;
    loop = undefined;
    midiKeys.dropPending();
  }

  /** 빈 악보로 시작한다. 고친 내용이 있으면 먼저 묻는다 */
  function startNewSong() {
    if (history?.canUndo && !confirm(t("ui.newSongConfirm"))) return;
    openSong(newSong({ playerName: instrumentName("piano"), trackName: t("ui.newTrackName", { n: 1 }) }), "");
  }

  // 연주자·트랙 구성: 고른 트랙의 연주자를 기준으로 한다
  const activeTrack = $derived(song?.tracks.find((tr) => tr.id === activeTrackId));
  const activePlayer = $derived(song?.players.find((p) => p.id === song?.tracks.find((tr) => tr.id === activeTrackId)?.playerId));

  function addTrackToPlayer() {
    if (!history || !activePlayer) return;
    const s = history.song;
    const n = s.tracks.filter((tr) => tr.playerId === activePlayer.id).length + 1;
    const next = history.run(addTrack(activePlayer.id, t("ui.newTrackName", { n }), t("ui.addTrack")));
    sync(next);
    activeTrackId = next.tracks.find((tr) => !s.tracks.some((o) => o.id === tr.id))?.id ?? activeTrackId;
  }

  function addNewPlayer(canonical: string) {
    if (!history) return;
    const s = history.song;
    const n = s.players.filter((p) => p.instrument.canonical === canonical).length + 1;
    const name = t("ui.newPlayerName", { instrument: instrumentName(canonical), n });
    const next = history.run(addPlayer(canonical, name, t("ui.newTrackName", { n: 1 }), t("ui.addPlayer")));
    sync(next);
    activeTrackId = next.tracks.find((tr) => !s.tracks.some((o) => o.id === tr.id))?.id ?? activeTrackId;
  }

  /** 바뀌는 게 있을 때만 실행한다 (제자리 옮기기가 실행 취소 기록에 빈 단계로 남지 않게) */
  function runIfChanged(command: Command): Song | undefined {
    if (!history || command.apply(history.song) === history.song) return undefined;
    const next = history.run(command);
    sync(next);
    return next;
  }

  function deleteTrack(track: Track) {
    if (!history) return;
    if (track.notes.length > 0 && !confirm(t("ui.removeTrackConfirm", { name: track.name }))) return;
    const s = history.song;
    const index = s.tracks.findIndex((tr) => tr.id === track.id);
    const next = history.run(removeTrack(track.id, t("ui.removeTrack")));
    sync(next);
    if (activeTrackId === track.id) activeTrackId = next.tracks[Math.min(index, next.tracks.length - 1)]?.id;
  }

  function appendPasted(other: Song) {
    if (!history) return openSong(other, "");
    const next = history.run(appendSong(other));
    sync(next);
    activeTrackId = next.tracks[next.tracks.length - other.tracks.length]?.id ?? activeTrackId;
    split = undefined;
  }

  /** 편집 칸 밖에서 MML@ 글을 붙여넣으면 붙여넣기 창을 연다 */
  function onPaste(event: ClipboardEvent) {
    if (showKeymap || paste || midi || settings || meterOpen || eventEdit || addScoreOpen) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(TYPING)) return;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!looksLikeMmlAt(text)) return;
    event.preventDefault();
    paste = { text };
  }

  async function onAddPack(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    error = "";
    // 올린 사운드팩·자동 보존이 브라우저 정리로 지워지지 않게 (사용자가 직접 고른 때에 묻는다)
    if (files.length > 0) void requestPersistentStorage();
    for (const file of files) {
      if (!hasExtension(file.name, PACK_FILES)) {
        error = t("ui.notPackFile", { name: file.name });
        continue;
      }
      loadingPack = file.name;
      try {
        // 같은 이름 팩을 다시 올리면 바꿔 끼운다 (저장소도 이름 하나에 한 벌이라 다음에 열 때와 같게)
        for (const old of engine.registry.list.filter((p) => p.label === file.name)) await engine.removePack(old.id);
        await engine.addPack(file);
        const name = file.name;
        void savePack(file).then((ok) => {
          const next = new Set(storedPacks);
          if (ok) next.add(name);
          else next.delete(name);
          storedPacks = next;
        });
      } catch {
        error = t("ui.openFailed", { name: file.name });
      }
    }
    loadingPack = "";
    packs = [...engine.registry.list];
  }

  async function removePack(id: string) {
    const label = packs.find((p) => p.id === id)?.label;
    await engine.removePack(id);
    packs = [...engine.registry.list];
    if (label && !packs.some((p) => p.label === label)) {
      void forgetPack(label);
      storedPacks = new Set([...storedPacks].filter((x) => x !== label));
    }
  }

  /** 이 브라우저에 저장된 사운드팩 이름 (저장에 성공한 것만 "기억함"으로 보인다) */
  let storedPacks = $state.raw<ReadonlySet<string>>(new Set());

  /** 지난번에 올린 사운드팩을 이 브라우저 저장소에서 다시 불러온다 */
  async function restorePacks() {
    const restored = new Set<string>();
    for (const stored of await loadPacks()) {
      loadingPack = stored.name;
      restored.add(stored.name);
      try {
        await engine.addPack(new File([stored.data], stored.name));
      } catch {
        // 오디오를 못 켠 일시적 실패일 수 있어 저장한 것은 지우지 않는다 (올릴 때 한 번 읽힌 파일이다)
        error = t("ui.packRestoreFailed", { name: stored.name });
      }
    }
    loadingPack = "";
    packs = [...engine.registry.list];
    storedPacks = new Set([...restored].filter((name) => packs.some((p) => p.label === name)));
  }
  void restorePacks();

  /** 끄기·솔로는 듣는 방법이라 실행 취소 기록에 넣지 않는다 */
  function updateTrack(id: string, change: Partial<Pick<Track, "mute" | "solo">>) {
    if (!history) return;
    const current = history.song;
    sync(history.amend({ ...current, tracks: current.tracks.map((tr) => (tr.id === id ? { ...tr, ...change } : tr)) }));
    // 재생 중이면 바뀐 트랙 구성으로 처음부터 다시 재생한다 (이어 재생은 커서가 생기면)
    if (playing) void play();
  }

  // MIDI 건반 입력: 커서 자리에 격자 길이로 넣고 커서를 민다. 첫 건반부터 60ms 안에 누른 건반은 화음 하나
  const midiKeys = new MidiKeys({
    previewOn: (pitch, velocity) => {
      const track = song?.tracks.find((tr) => tr.id === activeTrackId);
      const inst = song && track ? trackInstrument(song, track) : { canonical: "piano" };
      engine.previewOn(inst.canonical, inst.program, pitch, velocity).catch(() => {
        // 오디오를 못 켜도 악보 입력은 이어 간다
      });
    },
    previewOff: (pitch) => engine.previewOff(pitch),
    chord: (chord) => placeMidiChord(chord),
    unsupported: () => (error = t("ui.midiKeysUnsupported")),
  });
  // 화면이 사라질 때도 MIDI 연결·대기 입력·울리는 음을 정리한다
  $effect(() => () => midiKeys.stop());

  function placeMidiChord(chord: { pitches: number[]; velocity: number }) {
    if (!history || !activeTrackId || !editable(activeTrackId)) return;
    const s = history.song;
    const active = s.tracks.find((tr) => tr.id === activeTrackId);
    if (!active) return;
    // 커서가 없으면 고른 트랙의 마지막 음 뒤
    const lastEnd = active.notes.reduce((m, n) => Math.max(m, n.start.n / n.start.d + n.dur.n / n.dur.d), 0);
    const at = editCursor() ?? asRat(lastEnd);
    const dur = newNoteDur;
    const useVelocity = midiKeys.velocity;
    const changes = placeChord(s, groups, activeTrackId, at, dur, chord, (notes, where, vel) =>
      useVelocity ? volumeForVelocity(profile, vel) : previousVolume(notes, where),
    );
    // 화음을 나눠 넣을 다른 트랙이 잠겼으면 그 트랙 몫은 버린다
    const open = changes.filter((c) => !lockedIds.has(c.trackId));
    if (open.length === 0) return;
    sync(history.run(setTracksNotes(open, t("ui.midiKeysInput"))));
    setCursor(add(at, dur));
  }

  // 피아노롤에서 고른 음을 MML 글에서 보여 준다. 고른 트랙만 보는 중이 아니면 그 트랙이 보이게 고른다
  let reveal = $state<{ trackId: string; from: number; to: number; focus: boolean; nonce: number } | undefined>(undefined);
  function pickNote(trackId: string, note: Note, focus: boolean) {
    const track = song?.tracks.find((tr) => tr.id === trackId);
    if (!song || !track) return;
    const span = noteSpan(song, track, note);
    if (!span) return;
    activeTrackId = trackId;
    reveal = { trackId, from: span[0], to: span[1], focus, nonce: (reveal?.nonce ?? 0) + 1 };
  }

  /** 피아노롤 건반·음을 누르는 동안 고른 트랙 악기로 들려준다 (사운드팩이 없으면 간단한 소리) */
  function rollPreview(pitch: number, on: boolean) {
    if (!on) return engine.previewOff(pitch);
    const track = song?.tracks.find((tr) => tr.id === activeTrackId);
    const inst = song && track ? trackInstrument(song, track) : { canonical: "piano" };
    engine.previewOn(inst.canonical, inst.program, pitch, 100).catch(() => {
      // 오디오를 못 켜도 편집은 이어 간다
    });
  }

  // 박자: 커서가 있으면 커서가 든 마디부터, 없으면 곡 처음부터 바꾼다
  const meterPos = $derived(song && cursor !== undefined ? measureStart(song.timeSig, editCursor()!) : rat(0));
  const meterHere = $derived(song ? meterAt(song.timeSig, meterPos) : { at: rat(0), beats: 4, unit: 4 });

  // 템포·마커·박자 넣기·고치기 창 (이벤트 줄, Alt+B·Alt+M)
  let eventEdit = $state<{ kind: EventKind; at: Rat; existing: boolean; id?: string } | undefined>(undefined);
  function openEvent(request: { label?: EventLabel; kind: EventKind; at: Rat }) {
    if (!song) return;
    const l = request.label;
    eventEdit = l ? { kind: l.kind, at: l.at, existing: true, ...(l.id ? { id: l.id } : {}) } : { kind: request.kind, at: request.at, existing: false };
  }
  /** 편집 커서(없으면 곡 처음) 자리 템포·마커 창. 그 자리에 템포가 있으면 고치기 */
  function openEventAtCursor(kind: EventKind) {
    if (!song) return;
    const at = editCursor() ?? rat(0);
    const existing = kind === "tempo" && song.tempo.some((e) => cmp(e.at, at) === 0);
    if (!showEvents) showEvents = true;
    eventEdit = { kind, at, existing };
  }
  const eventInfo = $derived.by(() => {
    if (!song || !eventEdit) return undefined;
    const e = eventEdit;
    const { bar, beat } = barBeatAt(song.timeSig, e.at);
    const tempoHere = [...song.tempo].filter((x) => cmp(x.at, e.at) <= 0).at(-1)?.bpm ?? 120;
    const meter = meterAt(song.timeSig, e.at);
    return {
      where: `${bar}:${Number.isInteger(beat) ? beat : beat.toFixed(2)}`,
      bpm: tempoHere,
      marker: (e.id && song.markers.find((m) => m.id === e.id)?.label) || "",
      beats: meter.beats,
      unit: meter.unit,
      atStart: cmp(e.at, rat(0)) === 0,
    };
  });
  function applyEvent(change: { kind: "tempo"; bpm: number } | { kind: "marker"; text: string } | { kind: "meter"; beats: number; unit: number }) {
    const e = eventEdit;
    if (!history || !song || !e) return;
    if (change.kind === "tempo") sync(history.run(setTempoAt(e.at, change.bpm, t("ui.tempoLabel"))));
    else if (change.kind === "marker") sync(history.run(setMarker(e.existing ? e.id : undefined, e.at, change.text, t("ui.markerLabel"))));
    else sync(history.run(setMeter(measureStart(song.timeSig, e.at), change.beats, change.unit, t("ui.meter"))));
  }
  function deleteEvent() {
    const e = eventEdit;
    if (!history || !e) return;
    if (e.kind === "tempo") sync(history.run(removeTempoAt(e.at, t("ui.tempoDelete"))));
    else if (e.kind === "marker" && e.id) sync(history.run(removeMarker(e.id, t("ui.markerDelete"))));
    else if (e.kind === "meter") sync(history.run(removeMeter(e.at, t("ui.meterDelete"))));
  }
  function moveEvent(label: EventLabel, to: Rat) {
    if (!history) return;
    if (label.kind === "tempo") runIfChanged(moveTempo(label.at, to, t("ui.tempoMove")));
    else if (label.kind === "marker" && label.id) runIfChanged(moveMarker(label.id, to, t("ui.markerMove")));
  }

  // 원곡에 템포 맞추기: 템포를 짐작하지 않고 사람이 정한 자리를 곡 템포로 옮긴다
  const fine = (time: number) => rat(Math.round(time * 3840), 3840);

  /** 파형 띠에서 마디선 bar를 끌어 놓은 자리(to, 지금 템포로 잰 온음표)에 그 마디가 오게 템포를 바꾼다 */
  function alignBar(bar: Rat, to: number) {
    if (!history) return;
    const s = history.song;
    const plan = alignBarTempo(s.tempo, bar, positionToSeconds(s.tempo, fine(to)));
    if (plan) runIfChanged(setTempos(plan.set, plan.remove, t("ui.tempoAlign")));
  }

  /** 탭 템포: 재생 중 마디 첫 박마다 누른 곡 시각(초). 멈추면 마디마다 템포로 넣는다 */
  let tapOpen = $state(false);
  let taps = $state.raw<number[]>([]);
  let tapRun = 0;
  let tapResult = $state("");
  /** 탭 단위 (마디마다·박마다). 기억한다 */
  const TAP_UNIT_KEY = "mmlce.tapUnit";
  let tapUnit = $state<TapUnit>(loadStored(TAP_UNIT_KEY, (raw) => (raw === "beat" ? "beat" : "bar")));
  function setTapUnit(unit: TapUnit) {
    tapUnit = unit;
    taps = [];
    saveStored(TAP_UNIT_KEY, unit);
  }
  /** 비슷한 탭 템포 합치기 세기 (0 끔 · 1 약하게 · 2 보통 · 3 강하게): 합쳐도 탭 자리가 이만큼(초) 안이면 합친다. 기억한다 */
  const TAP_SLACK = [0, 0.03, 0.06, 0.1] as const;
  const TAP_MERGE_KEY = "mmlce.tapMerge";
  let tapMerge = $state(loadStored(TAP_MERGE_KEY, (raw) => (raw !== null && [0, 1, 2, 3].includes(Number(raw)) ? Number(raw) : 2)));
  function setTapMerge(n: number) {
    tapMerge = n;
    saveStored(TAP_MERGE_KEY, String(n));
  }
  function tap(): boolean {
    if (!tapOpen) return false;
    const now = playback.now();
    if (now === undefined) return true;
    // 자리를 옮겨 다시 재생했거나 반복 구간이 처음으로 돌아가면 새로 찍는다
    if (playback.runs !== tapRun || (taps.length > 0 && now <= taps.at(-1)!)) {
      taps = [now];
      tapRun = playback.runs;
    } else taps = [...taps, now];
    tapResult = "";
    return true;
  }
  function finishTap() {
    const s = history?.song;
    const list = taps;
    taps = [];
    if (!s || list.length < 2) return;
    const at = fine(secondsToWhole(s.tempo, list[0]!));
    const firstBar = tapUnit === "bar" ? nearestBar(s.timeSig, at) : nearestBeat(s.timeSig, at);
    const plan = tapTempos(s.tempo, s.timeSig, firstBar, list, { slack: TAP_SLACK[tapMerge] ?? 0, unit: tapUnit });
    if (!plan) {
      tapResult = t("ui.tapFailed");
      return;
    }
    const done = runIfChanged(setTempos(plan.set, plan.remove, t("ui.tapTempo")));
    const where = barBeatAt(s.timeSig, firstBar);
    tapResult = done
      ? t(tapUnit === "bar" ? "ui.tapDone" : "ui.tapDoneBeats", { bar: where.bar, beat: where.beat, n: list.length - 1, undo: keyOf("edit.undo") ?? "" })
      : t("ui.tapSame");
  }
  // 멈추면(끝까지 갔거나 정지·일시정지) 찍은 것을 넣는다
  $effect(() => {
    if (!playing && taps.length > 0) untrack(finishTap);
  });
  function toggleTap() {
    tapOpen = !tapOpen;
    taps = [];
    tapResult = "";
  }

  /** 이벤트 줄에서 누른 라벨: 휠로 템포 바꾸기, Del로 지우기 */
  let pickedEvent = $state.raw<EventRef | undefined>(undefined);
  /** 잇달아 굴린 휠 템포는 실행 취소 한 칸으로 묶는다 */
  let tempoWheel: { at: Rat; after: Song; time: number } | undefined;
  function wheelTempo(at: Rat, step: number) {
    if (!history) return;
    const merge = tempoWheel && cmp(tempoWheel.at, at) === 0 && tempoWheel.after === history.song && performance.now() - tempoWheel.time < 1500;
    const { min, max } = profile.tempo;
    const bpm = Math.min(max, Math.max(min, bpmAt(history.song.tempo, at) + step));
    if (bpm === bpmAt(history.song.tempo, at)) return;
    if (merge) history.undo();
    const next = history.run(setTempoAt(at, bpm, t("ui.tempoLabel")));
    sync(next);
    tempoWheel = { at, after: next, time: performance.now() };
  }
  /** 템포 한꺼번에 지우기: 반복 구간이 있으면 그 안, 없으면 곡 처음 템포를 뺀 전부 (실행 취소 한 칸) */
  const tempoClearTargets = $derived.by(() => {
    if (!song) return [];
    return song.tempo
      .map((e) => e.at)
      .filter((at) => cmp(at, rat(0)) > 0 && (!loop || (toFloat(at) >= loop[0] - 1e-9 && toFloat(at) < loop[1] - 1e-9)));
  });
  /** 글에 곡 템포가 다 적혀 있지 않은 악보(연주자) 수. 게임은 악보마다 템포를 따로 읽는다 */
  const tempoMissing = $derived(song ? scoresMissingTempo(song).length : 0);
  function clearTempos() {
    if (tempoClearTargets.length === 0) return;
    runIfChanged(setTempos([], tempoClearTargets, t("ui.tempoClear")));
  }

  function deletePicked(): boolean {
    const e = pickedEvent;
    if (!history || !e) return false;
    pickedEvent = undefined;
    if (e.kind === "tempo") runIfChanged(removeTempoAt(e.at, t("ui.tempoDelete")));
    else if (e.kind === "marker" && e.id) runIfChanged(removeMarker(e.id, t("ui.markerDelete")));
    else if (e.kind === "meter" && cmp(e.at, rat(0)) > 0) runIfChanged(removeMeter(e.at, t("ui.meterDelete")));
    return true;
  }

  function changeMeter(beats: number, unit: number) {
    if (!history || !Number.isInteger(beats) || beats < 1 || beats > 32) return;
    sync(history.run(setMeter(meterPos, beats, unit, t("ui.meter"))));
  }

  /** 음 목록 (보기 메뉴): 고른 트랙의 음을 키보드·화면 낭독기로 찾아 고르는 길 */
  let noteListOpen = $state(false);

  /** 곡 검사 위치로: 그 트랙을 고르고, 롤을 그 음으로 옮기고, MML 글에서도 그 자리를 보여 준다 */
  function goToCheck(track: Track, note: Note) {
    activeTrackId = track.id;
    setCursor(note.start);
    roll?.reveal(toFloat(note.start), note.pitch, note.id);
    pickNote(track.id, note, false);
  }

  /** 커서 자리에 한 마디(커서 자리에 걸린 박자표 기준)를 넣거나 뺀다 */
  function editBar(kind: "insert" | "delete") {
    const at = editCursor();
    if (!history || !at) return;
    const bar = meterGrid(meterAt(history.song.timeSig, at)).measure;
    sync(history.run(kind === "insert" ? insertTime(at, bar, t("ui.insertBar")) : deleteTime(at, bar, t("ui.deleteBar"))));
  }

  /** 일시정지: 지금 재생 자리를 커서로 두고 멈춘다. 다시 재생하면 그 자리부터 */
  function pause() {
    if (playhead !== undefined && !loop) cursor = playhead;
    stop();
  }

  /** 롤 위 마디 번호 줄을 누르면 그 자리로 커서, 재생 중이면 거기서부터 이어 재생 */
  function seek(time: number) {
    cursor = time;
    if (playing) void play();
  }

  // 전체 음량 (기억)
  const MASTER_KEY = "mmlce.masterVolume";
  const initialMasterVolume = loadStored(MASTER_KEY, (raw) => {
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) ? Math.min(1.5, Math.max(0, v)) : 1;
  });
  let masterVolume = $state(initialMasterVolume);
  function setMasterVolume(v: number) {
    masterVolume = v;
    engine.setMasterVolume(v);
    saveStored(MASTER_KEY, String(v));
  }
  engine.setMasterVolume(initialMasterVolume);

  // 화면 싱크 보정(ms, 기억): 재생선이 소리보다 앞서거나 늦으면 맞춘다
  const SYNC_KEY = "mmlce.syncOffsetMs";
  const initialSyncOffset = loadStored(SYNC_KEY, (raw) => {
    const v = raw === null ? NaN : Number(raw);
    return Number.isFinite(v) ? Math.min(1000, Math.max(-1000, Math.round(v))) : 0;
  });
  let syncOffsetMs = $state(initialSyncOffset);
  engine.syncOffset = initialSyncOffset / 1000;
  function setSyncOffset(ms: number) {
    syncOffsetMs = Math.min(1000, Math.max(-1000, Math.round(ms)));
    engine.syncOffset = syncOffsetMs / 1000;
    saveStored(SYNC_KEY, String(syncOffsetMs));
  }

  // 트랙 패널: 롤 오른쪽(세로 화면은 아래)에 두고, 가운데 경계를 끌어 크기를 바꾼다 (기억)
  const SIDE_KEY = "mmlce.sideBySide";
  const PANE_KEY = "mmlce.paneWidth";
  const SHARE_KEY = "mmlce.rollShareV";
  const PANE_DEFAULT = 440;
  const PANE_MIN = 320;
  const ROLL_MIN = 480;
  const initialSide = loadStored(SIDE_KEY, (raw) => {
    const v = parseJson(raw) as { on?: unknown; share?: unknown } | undefined;
    return v && typeof v.on === "boolean" && typeof v.share === "number" ? { on: v.on, share: v.share } : { on: true, share: 55 };
  });
  let sideBySide = $state(initialSide.on);
  let paneWidth = $state(
    loadStored(PANE_KEY, (raw) => {
      const v = raw === null ? NaN : Number(raw);
      return Number.isFinite(v) ? Math.max(PANE_MIN, Math.round(v)) : PANE_DEFAULT;
    }),
  );
  // 세로 화면에서 롤이 차지하는 높이(%)
  let rollShareV = $state(
    loadStored(SHARE_KEY, (raw) => {
      const v = raw === null ? NaN : Number(raw);
      return Number.isFinite(v) && v >= 20 && v <= 80 ? Math.round(v) : 46;
    }),
  );
  // 패널 위치: 아래(3MLE식, 키보드용) / 옆(마우스·터치용). 세로 화면은 설정과 상관없이 위아래 분할
  const DOCK_KEY = "mmlce.paneDock";
  const EDITOR_KEY = "mmlce.editorHeight";
  const EDITOR_DEFAULT = 300;
  const EDITOR_MIN = 160;
  const ROLL_MIN_H = 240;
  let paneDock = $state<"right" | "bottom">(loadStored(DOCK_KEY, (raw) => (raw === "right" || raw === "bottom" ? raw : coarsePointer ? "right" : "bottom")));
  let editorHeight = $state(
    loadStored(EDITOR_KEY, (raw) => {
      const v = raw === null ? NaN : Number(raw);
      return Number.isFinite(v) ? Math.max(EDITOR_MIN, Math.round(v)) : EDITOR_DEFAULT;
    }),
  );
  const bottom = $derived(!portrait && paneDock === "bottom");
  function setDock(d: "right" | "bottom") {
    paneDock = d;
    saveStored(DOCK_KEY, d);
  }
  function toggleSideBySide() {
    sideBySide = !sideBySide;
    saveStored(SIDE_KEY, JSON.stringify({ on: sideBySide, share: initialSide.share }));
  }
  let dividerFrom: { x: number; y: number; width: number; share: number; eh: number; box: DOMRect } | undefined;
  function ondividerdown(e: PointerEvent) {
    const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    dividerFrom = { x: e.clientX, y: e.clientY, width: paneWidth, share: rollShareV, eh: editorHeight, box };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function ondividermove(e: PointerEvent) {
    if (!dividerFrom) return;
    if (bottom) {
      // 아래 편집기: 위로 끌수록 커진다
      const max = Math.max(EDITOR_MIN, dividerFrom.box.height - ROLL_MIN_H - 10);
      editorHeight = Math.round(Math.min(max, Math.max(EDITOR_MIN, dividerFrom.eh - (e.clientY - dividerFrom.y))));
    } else if (portrait) {
      rollShareV = Math.round(Math.min(80, Math.max(20, dividerFrom.share + ((e.clientY - dividerFrom.y) / Math.max(1, dividerFrom.box.height)) * 100)));
    } else {
      // 오른쪽 패널이므로 왼쪽으로 끌수록 넓어진다
      const max = Math.max(PANE_MIN, dividerFrom.box.width - ROLL_MIN - 10);
      paneWidth = Math.round(Math.min(max, Math.max(PANE_MIN, dividerFrom.width - (e.clientX - dividerFrom.x))));
    }
  }
  function ondividerup() {
    if (!dividerFrom) return;
    dividerFrom = undefined;
    saveStored(PANE_KEY, String(paneWidth));
    saveStored(SHARE_KEY, String(rollShareV));
    saveStored(EDITOR_KEY, String(editorHeight));
  }
  function resetDivider() {
    editorHeight = EDITOR_DEFAULT;
    saveStored(EDITOR_KEY, String(editorHeight));
    paneWidth = PANE_DEFAULT;
    rollShareV = 46;
    saveStored(PANE_KEY, String(paneWidth));
    saveStored(SHARE_KEY, String(rollShareV));
  }

  // 이벤트 줄 (템포·박자·마커를 롤 위에 표시, 변속 확인용)
  let showEvents = $state(false);
  /** 피아노롤 도구: 넣기 / 고르기(상자) / 지우개 (터치·펜에서 음 지우기) */
  let rollTool = $state<RollTool>("pen");
  // 고르기 도구 자물쇠: 풀면 고른 음을 끌어 한꺼번에 옮긴다 (기억, 기본 잠금)
  const SELECT_MOVE_KEY = "mmlce.selectMove";
  let selectMove = $state(loadStored(SELECT_MOVE_KEY, (raw) => raw === "1"));
  function setSelectMove(on: boolean) {
    selectMove = on;
    saveStored(SELECT_MOVE_KEY, on ? "1" : "0");
  }
  // 재생 중 피아노롤 건반에 불 켜기 (기억)
  const LIGHT_KEYS_KEY = "mmlce.lightKeys";
  let lightKeys = $state(loadStored(LIGHT_KEYS_KEY, (raw) => raw === "1"));
  function toggleLightKeys() {
    lightKeys = !lightKeys;
    saveStored(LIGHT_KEYS_KEY, lightKeys ? "1" : "0");
  }
  // 롤에서 다른 트랙 음을 누르면 그 트랙으로 바꾸기 (기억, 기본 켬)
  const PICK_BG_KEY = "mmlce.pickBackground";
  let pickBackground = $state(loadStored(PICK_BG_KEY, (raw) => raw !== "0"));
  function togglePickBackground() {
    pickBackground = !pickBackground;
    saveStored(PICK_BG_KEY, pickBackground ? "1" : "0");
  }
  // 편집기 둘 나란히: 트랙 패널 편집기를 위아래 둘로. 아래 편집기는 Alt+클릭(또는 메뉴)으로 고른 트랙 (켜짐만 기억)
  const DUAL_KEY = "mmlce.dualEditor";
  let dualEditor = $state(loadStored(DUAL_KEY, (raw) => raw === "1"));
  let secondChosen = $state<string | undefined>(undefined);
  function setDualEditor(on: boolean) {
    dualEditor = on;
    saveStored(DUAL_KEY, on ? "1" : "0");
  }
  function openSecond(trackId: string) {
    if (trackId === activeTrackId) return;
    secondChosen = trackId;
    setDualEditor(true);
  }
  /** 아래 편집기에 실제로 여는 트랙: 고른 것이 없거나 지워졌거나 위와 같으면 곡에서 고른 트랙 다음 트랙 */
  const secondTrackId = $derived.by(() => {
    if (!dualEditor || !song || song.tracks.length < 2) return undefined;
    if (secondChosen !== activeTrackId && song.tracks.some((tr) => tr.id === secondChosen)) return secondChosen;
    const i = song.tracks.findIndex((tr) => tr.id === activeTrackId);
    return song.tracks[(i + 1) % song.tracks.length]?.id;
  });
  // 아래 편집기에 연 트랙을 위에서 고르면 둘을 맞바꾼다 (같은 트랙이 두 번 열리지 않게)
  let prevActive: string | undefined;
  $effect(() => {
    const now = activeTrackId;
    untrack(() => {
      if (now !== undefined && now === secondChosen && prevActive !== undefined) secondChosen = prevActive;
      prevActive = now;
    });
  });

  /** 새로 넣는 음의 v (피아노롤·타브 같이). undefined = 앞 음 v 이어받기 */
  let inputVolume = $state<number | undefined>(undefined);
  /** 피아노롤에서 고른 음들의 v (서로 다르면 null, 고른 음이 없으면 undefined) */
  /** 피아노롤에서 고른 음 (상태줄 음 정보) */
  const selectedNotes = $derived(viewMode === "roll" ? (roll?.selection() ?? []) : []);
  const selectedIds = $derived(new Set(selectedNotes.map((n) => n.id)));
  const selectedVolume = $derived.by(() => {
    const picked = selectedNotes;
    if (picked.length === 0) return undefined;
    const v = picked[0]!.vol;
    return picked.every((n) => n.vol === v) ? v : null;
  });

  /** 단축키 표시 (메뉴 오른쪽) */
  function keyOf(command: CommandId): string | undefined {
    return keysOf(bindings, command)[0];
  }

  const fileMenu: MenuItem[] = $derived([
    { label: t("ui.newSong"), title: t("ui.newSongHelp"), run: startNewSong },
    { label: t("ui.openFile"), title: t("ui.openFileHelp"), hint: keyOf("file.open"), run: () => openInput.click() },
    { label: t("ui.paste"), title: t("ui.pasteHint"), run: () => (paste = { text: "" }) },
    { label: t("ui.recoverMenu"), title: t("ui.recoverMenuHelp"), run: () => void refreshWorks().then(() => (recoverOpen = true)) },
    { separator: true },
    { label: t("ui.saveProject", { ext: PROJECT_EXTENSION }), title: t("ui.saveProjectHelp"), hint: keyOf("file.saveProject"), disabled: !song, run: saveProject },
    { label: t("ui.save3mle"), hint: keyOf("file.save3mle"), disabled: !song, run: () => save3mle() },
    { label: t("ui.saveMmi"), hint: keyOf("file.saveMmi"), disabled: !song, run: saveMmi },
    { label: t("ui.saveMidi"), title: t("ui.saveMidiHelp"), disabled: !song, run: saveMidi },
    { label: t("ui.saveWav"), title: packs.length === 0 ? t("ui.wavNeedPack") : t("ui.saveWavHelp"), disabled: !song || packs.length === 0 || wavProgress !== undefined, run: saveWav },
    { separator: true },
    { label: t("ui.outputMenu"), title: t("ui.outputMenuHelp"), disabled: !song, run: openOutput },
    { separator: true },
    { label: t("ui.addPack"), run: () => packInput.click() },
  ]);

  const editMenu: MenuItem[] = $derived([
    { label: t("ui.undo"), hint: keyOf("edit.undo"), disabled: !canUndo, run: undo },
    { label: t("ui.redo"), hint: keyOf("edit.redo"), disabled: !canRedo, run: redo },
    { separator: true },
    { label: t("ui.selectAll"), title: t("ui.selectHelp"), hint: keyOf("edit.selectAll"), disabled: !song || viewMode !== "roll", run: () => run("edit.selectAll") },
    { label: t("ui.deleteNotes"), hint: keyOf("note.delete"), disabled: !song || viewMode !== "roll", run: () => run("note.delete") },
    { label: t("ui.cut"), hint: keyOf("edit.cut"), disabled: !song || viewMode !== "roll", run: () => run("edit.cut") },
    { label: t("ui.copy"), hint: keyOf("edit.copy"), disabled: !song || viewMode !== "roll", run: () => run("edit.copy") },
    { label: t("ui.pasteNotes"), title: t("ui.pasteNotesHelp"), hint: keyOf("edit.paste"), disabled: !song || viewMode !== "roll" || !noteClipboard.clip, run: () => run("edit.paste") },
    { separator: true },
    { label: t("ui.lengthDouble"), hint: keyOf("edit.lengthDouble"), disabled: !song || viewMode !== "roll", run: () => run("edit.lengthDouble") },
    { label: t("ui.lengthHalf"), hint: keyOf("edit.lengthHalf"), disabled: !song || viewMode !== "roll", run: () => run("edit.lengthHalf") },
    { separator: true },
    { label: t("cmd.note.volumeUp"), hint: keyOf("note.volumeUp"), disabled: !song || viewMode !== "roll", run: () => run("note.volumeUp") },
    { label: t("cmd.note.volumeDown"), hint: keyOf("note.volumeDown"), disabled: !song || viewMode !== "roll", run: () => run("note.volumeDown") },
    { label: t("cmd.note.octaveUp"), hint: keyOf("note.octaveUp"), disabled: !song || viewMode !== "roll", run: () => run("note.octaveUp") },
    { label: t("cmd.note.octaveDown"), hint: keyOf("note.octaveDown"), disabled: !song || viewMode !== "roll", run: () => run("note.octaveDown") },
    { label: t("cmd.note.tie"), hint: keyOf("note.tie"), disabled: !song || viewMode !== "roll", run: () => run("note.tie") },
    { label: t("cmd.note.split"), hint: keyOf("note.split"), disabled: !song || viewMode !== "roll" || cursor === undefined, run: () => run("note.split") },
    { label: t("cmd.note.glue"), hint: keyOf("note.glue"), disabled: !song || viewMode !== "roll", run: () => run("note.glue") },
  ]);

  const songMenu: MenuItem[] = $derived([
    { label: t("ui.transpose") + "…", hint: keyOf("edit.transpose"), disabled: !song, run: () => run("edit.transpose") },
    { label: t("ui.voiceMenu"), title: t("ui.voiceHelp"), disabled: !song || !activeTrackId, run: openVoice },
    { label: t("ui.meterChange"), title: t("ui.meterHelp"), disabled: !song, run: () => (meterOpen = true) },
    { label: t("ui.tapTempo"), title: t("ui.tapTempoHelp"), checked: tapOpen, disabled: !song, run: toggleTap },
    {
      label: (loop ? t("ui.tempoClearLoop") : t("ui.tempoClearAll")) + ` (${tempoClearTargets.length})`,
      title: t("ui.tempoClearHelp"),
      disabled: tempoClearTargets.length === 0,
      run: clearTempos,
    },
    {
      label: t("ui.tempoFillScores") + ` (${tempoMissing})`,
      title: t("ui.tempoFillScoresHelp"),
      disabled: tempoMissing === 0,
      run: () => runIfChanged(fillScoreTempo(t("ui.tempoFillScores"))),
    },
    { separator: true },
    { label: t("ui.addTrackMenu"), title: t("ui.addTrackHelp"), disabled: !activePlayer, run: addTrackToPlayer },
    { label: t("ui.addScoreMenu"), title: t("ui.addPlayerHelp"), disabled: !song, run: () => (addScoreOpen = true) },
    { separator: true },
    { label: t("ui.distribute") + "…", title: t("ui.distributeHelp"), disabled: !song, run: distribute },
    { label: t("ui.compact") + "…", title: t("ui.compactHelp"), disabled: !song, run: compact },
    { label: t("ui.split") + "…", disabled: !song || splitting, run: runSplit },
    { label: t("ui.outputMenu"), title: t("ui.outputMenuHelp"), disabled: !song, run: openOutput },
  ]);

  /** 고른 음 길이 ×2·½ (첫 음 시작 기준으로 리듬 모양을 지킨다) */
  function scaleSelection(factor: Rat, label: string): boolean {
    const picked = roll?.selection() ?? [];
    if (picked.length === 0) return false;
    const scaled = new Map(scaleNotes(picked, factor).map((n) => [n.id, n]));
    return roll?.editSelected((n) => scaled.get(n.id) ?? n, label) ?? false;
  }

  // 음정 변환: 고른 음·트랙·악보·곡 전체를 반음 단위로 옮긴다
  let transposing = $state<{ scope: TransposeScope } | undefined>(undefined);

  function openTranspose() {
    if (!song) return;
    const picked = viewMode === "roll" ? (roll?.selection().length ?? 0) : 0;
    transposing = { scope: picked > 0 ? "selection" : activeTrackId ? "track" : "song" };
  }

  /** 범위에 드는 트랙과 그 안에서 옮길 음 */
  function transposeTargets(scope: TransposeScope): { track: Track; notes: readonly Note[] }[] {
    if (!song) return [];
    const active = song.tracks.find((tr) => tr.id === activeTrackId);
    if (scope === "selection") return active && roll ? [{ track: active, notes: roll.selection() }] : [];
    if (scope === "track") return active ? [{ track: active, notes: active.notes }] : [];
    // 이 악보: 화면에 보이는 악보 묶음 (한 연주자가 화음 한도로 여러 악보에 나뉠 수 있다)
    const group = groups.find((g) => activeTrackId !== undefined && g.trackIds.includes(activeTrackId));
    const tracks = scope === "score" ? song.tracks.filter((tr) => group?.trackIds.includes(tr.id)) : song.tracks;
    return tracks.map((track) => ({ track, notes: track.notes }));
  }
  /** 잠근 트랙 이름 (경고창에 쓴다) */
  function lockedNames(ids: Iterable<string>): string {
    return [...new Set(ids)].filter((id) => lockedIds.has(id)).map(trackLabel).join(", ");
  }

  function checkTranspose(scope: TransposeScope, semitones: number): TransposeCheck {
    let count = 0;
    let folded = 0;
    let invalid = false;
    for (const { track, notes } of transposeTargets(scope)) {
      count += notes.length;
      const moved = transposeNotes(notes, semitones);
      if (!moved) invalid = true;
      else if (song) {
        const range = soundingRangeOf(profile, trackInstrument(song, track).canonical);
        folded += moved.filter((n) => foldPitch(n.pitch, range) !== n.pitch).length;
      }
    }
    return { count, invalid, folded };
  }

  function applyTranspose(scope: TransposeScope, semitones: number) {
    if (!history) return;
    const label = t("ui.transpose");
    const targets = transposeTargets(scope);
    // 잠근 트랙이 끼면 묻고, 그래도 하겠다면 잠근 트랙까지 바꾼다
    const locked = lockedNames(targets.map(({ track }) => track.id));
    if (locked && !confirm(t("ui.transposeLockedConfirm", { names: locked }))) return;
    if (scope === "selection" && !locked) {
      roll?.editSelected((n) => ({ ...n, pitch: n.pitch + semitones }), label);
      return;
    }
    const changes = targets.flatMap(({ track, notes }) => {
      const picked = new Set(notes.map((n) => n.id));
      const moved = transposeNotes(notes, semitones);
      if (!moved) return [];
      if (scope !== "selection") return [{ trackId: track.id, notes: moved }];
      const byId = new Map(moved.map((n) => [n.id, n]));
      return [{ trackId: track.id, notes: track.notes.map((n) => (picked.has(n.id) ? byId.get(n.id)! : n)) }];
    });
    if (changes.length > 0) sync(history.run(setTracksNotes(changes, label)));
  }

  // 화음↔트랙 정리: 고른 음 옮기기 / 트랙 합치기 / 높이 순으로 다시 나누기. 지난번 방식을 기억한다
  let voicing = $state<{ selected: number } | undefined>(undefined);
  let voicePrefs = $state(loadStored(VOICE_STORAGE, parseVoicePrefs));

  function openVoice() {
    if (!song || !activeTrackId) return;
    const picked = viewMode === "roll" ? (roll?.selection().length ?? 0) : 0;
    voicing = { selected: picked };
  }

  function trackLabel(id: string): string {
    const tr = song?.tracks.find((x) => x.id === id);
    const g = groups.find((x) => x.trackIds.includes(id));
    return g ? `${t("ui.scoreN", { n: g.number })} · ${tr?.name ?? id}` : (tr?.name ?? id);
  }

  /** 같은 악보의 트랙 (지금 트랙 포함, 순서대로) */
  function scoreTrackIds(): readonly string[] {
    return groups.find((g) => activeTrackId !== undefined && g.trackIds.includes(activeTrackId))?.trackIds ?? [];
  }

  /** 화음 정리가 건드리는 트랙 중 잠근 트랙 이름. 하나라도 있으면 정리하지 않는다 (한쪽만 빼면 음이 사라진다) */
  function voiceLockedNames(mode: VoiceMode, o: VoiceOptions): string {
    if (!activeTrackId) return "";
    if (mode === "voice") return lockedNames(scoreTrackIds());
    if (mode === "move") return lockedNames(o.target === "new" ? [activeTrackId] : [activeTrackId, o.target]);
    return lockedNames([activeTrackId, ...o.merge]);
  }

  function voicePlan(mode: VoiceMode, o: VoiceOptions) {
    if (!song || !activeTrackId) return undefined;
    if (mode === "voice") return planVoiceByPitch(song, scoreTrackIds(), o.order);
    if (mode === "move") {
      const ids = new Set((roll?.selection() ?? []).map((n) => n.id));
      if (ids.size === 0) return undefined;
      const player = activePlayer?.id;
      const n = song.tracks.filter((tr) => tr.playerId === player).length + 1;
      return planMoveNotes(song, activeTrackId, ids, o.target === "new" ? { newTrackName: t("ui.newTrackName", { n }) } : o.target);
    }
    return planMergeTracks(song, o.merge, activeTrackId);
  }

  function previewVoice(mode: VoiceMode, o: VoiceOptions): VoicePreview {
    const plan = voicePlan(mode, o);
    return plan ? { moved: plan.moved, blocked: plan.blocked } : { moved: 0, blocked: 0 };
  }

  function applyVoice(mode: VoiceMode, o: VoiceOptions) {
    const locked = voiceLockedNames(mode, o);
    if (locked) {
      alert(t("ui.voiceLockedAlert", { names: locked }));
      return;
    }
    const plan = voicePlan(mode, o);
    if (!history || !plan || plan.moved === 0) return;
    const label = t(mode === "move" ? "ui.voiceMoveLabel" : mode === "merge" ? "ui.voiceMergeLabel" : "ui.voiceByPitchLabel");
    sync(history.run(applyPlan(plan, label)));
    voicePrefs = { mode, order: o.order };
    saveStored(VOICE_STORAGE, JSON.stringify(voicePrefs));
    flash(plan.blocked > 0 ? t("ui.voiceDoneBlocked", { moved: plan.moved, blocked: plan.blocked }) : t("ui.voiceDone", { moved: plan.moved }));
  }

  const COLOR_LABELS: readonly { id: ColorScheme; key: "ui.colorByScore" | "ui.colorByPosition" | "ui.colorStored" }[] = [
    { id: "score", key: "ui.colorByScore" },
    { id: "position", key: "ui.colorByPosition" },
    { id: "stored", key: "ui.colorStored" },
  ];

  const viewMenu: MenuItem[] = $derived([
    { label: t("ui.pianoRoll"), checked: viewMode === "roll", run: () => (viewMode = "roll") },
    { label: t("ui.tabView"), checked: viewMode === "tab", hint: keyOf("view.tab"), run: () => (viewMode = "tab") },
    { separator: true },
    { label: t("ui.dockBottom"), title: t("ui.dockHelp"), checked: paneDock === "bottom", run: () => setDock("bottom") },
    { label: t("ui.dockRight"), title: t("ui.dockHelp"), checked: paneDock === "right", run: () => setDock("right") },
    { label: t("ui.sideBySide"), title: t("ui.sideBySideHelp"), checked: !bottom && !portrait && sideBySide, disabled: bottom || portrait, run: toggleSideBySide },
    { label: t("ui.dualEditor"), title: t("ui.dualEditorHelp"), checked: dualEditor, run: () => setDualEditor(!dualEditor) },
    { label: t("ui.verticalRoll"), title: t("ui.verticalRollHelp"), checked: orientation === "vertical", hint: keyOf("view.orientation"), run: () => run("view.orientation") },
    { label: t("ui.events"), title: t("ui.eventsHelp"), checked: showEvents, run: () => (showEvents = !showEvents) },
    { label: t("ui.noteList"), title: t("ui.noteListHelp"), checked: noteListOpen, run: () => (noteListOpen = !noteListOpen) },
    { label: t("ui.lightKeys"), title: t("ui.lightKeysHelp"), checked: lightKeys, run: toggleLightKeys },
    { label: t("ui.pauseMark"), title: t("ui.pauseMarkHelp"), checked: pauseMark, run: togglePauseMark },
    { label: t("ui.pickBackground"), title: t("ui.pickBackgroundHelp"), checked: pickBackground, run: togglePickBackground },
    { separator: true },
    ...COLOR_LABELS.map((c) => ({ label: `${t("ui.colorScheme")}: ${t(c.key)}`, checked: colorScheme === c.id, run: () => setColorScheme(c.id) })),
    { separator: true },
    { label: t("ui.mmlPad"), title: t("ui.mmlPadHelp"), checked: mmlPad.enabled, run: () => (mmlPad.enabled = !mmlPad.enabled) },
    { label: t("ui.keymap") + "…", hint: keyOf("view.keymap"), run: () => (showKeymap = true) },
    { separator: true },
    ...LOCALES.map((l) => ({ label: LOCALE_LABELS[l], checked: i18n.locale === l, run: () => setLocale(l) })),
  ]);

  /** 위 띠 ? 메뉴: 가이드북, 단축키, 업데이트 확인, BiNote 정보 */
  const helpMenu: MenuItem[] = $derived([
    { label: t("ui.helpGuide"), run: () => window.open(guideUrl(i18n.locale), "_blank", "noopener") },
    { label: t("ui.keymap") + "…", hint: keyOf("view.keymap"), run: () => (showKeymap = true) },
    { separator: true },
    { label: t("ui.updateCheck") + "…", run: () => (about = { checkNow: true }) },
    { label: t("ui.aboutTitle") + "…", run: () => (about = { checkNow: false }) },
  ]);

  /** 커서(없으면 처음)부터 재생. 반복 구간이 있으면 그 시작부터 끝까지를 끊김 없이 되풀이한다 */
  async function play() {
    if (song) await playback.play(song, cursor, loop);
  }

  function stop() {
    playback.stop();
  }

  /** 처음으로: 커서를 지우고 멈춘다 (다시 재생하면 곡 처음부터) */
  function toStart() {
    cursor = undefined;
    stop();
  }

  /** 반복 구간 끄기·켜기. 끄면 구간을 기억해 두었다가 다시 켠다 */
  let loopStash = $state<readonly [number, number] | undefined>(undefined);
  function toggleLoop() {
    if (loop) {
      loopStash = loop;
      loop = undefined;
    } else if (loopStash) {
      loop = loopStash;
    }
  }

  function baseName(): string {
    return fileName.replace(/\.[^.]+$/, "") || "mmlce";
  }

  function save3mle(encoding: "cp949" | "utf-8" = "cp949") {
    if (!song) return;
    const result = encode3mle(song, { encoding });
    download(result.bytes, `${baseName()}.mml`);
    notices = result.diagnostics;
    offerUtf8 = result.unencodable.length > 0;
  }

  async function saveWav() {
    if (!song || wavProgress !== undefined) return;
    const name = `${baseName()}.wav`;
    // 사운드팩 바이트를 읽는 동안에도 작업 중으로 보여 다시 누르지 못하게 한다
    const token = ++wavToken;
    wavProgress = 0;
    let prepared: Awaited<ReturnType<typeof engine.wavRequest>>;
    try {
      prepared = await engine.wavRequest($state.snapshot(song) as Song);
    } catch {
      // 사운드팩 파일을 못 읽었다 등: 작업 중 표시를 풀고 알린다
      if (token !== wavToken) return;
      wavProgress = undefined;
      error = t("ui.wavFailed");
      return;
    }
    // 준비하는 사이 취소했다
    if (token !== wavToken) return;
    if (!prepared) {
      wavProgress = undefined;
      error = t("ui.wavNeedPack");
      return;
    }
    error = "";
    const result = await wavRunner.run(prepared.request, (p) => {
      if (token === wavToken) wavProgress = p;
    });
    // 취소했으면 (wavToken이 바뀌었으면) 아무것도 하지 않는다
    if (token !== wavToken) return;
    wavProgress = undefined;
    if (!result) {
      error = t("ui.wavFailed");
      return;
    }
    download(new Uint8Array(result.wav), name);
    const missing = [...new Set(prepared.unresolved.map((u) => instrumentName(u.instrument)))];
    if (missing.length > 0) error = t("ui.wavUnresolved", { list: missing.join(", ") });
  }
  function cancelWav() {
    wavToken++;
    wavProgress = undefined;
    wavRunner.cancel();
  }

  function saveMidi() {
    if (!song) return;
    download(writeSmf(songToSmf(song, 480, profile.volume.max)), `${baseName()}.mid`);
  }

  function saveMmi() {
    if (!song) return;
    const result = writeMmi(song);
    download(new TextEncoder().encode(result.text), `${baseName()}.mmi`);
    notices = result.diagnostics;
    offerUtf8 = false;
  }

  /** 고른 음의 v를 프로필 범위 안에서 바꾼다 */
  function nudgeVolume(delta: number) {
    const { min, max } = profile.volume;
    roll?.editSelected((n) => ({ ...n, vol: Math.min(max, Math.max(min, n.vol + delta)) }), "음 볼륨");
  }

  function selectTrack(step: number) {
    if (!song || song.tracks.length === 0) return;
    const i = song.tracks.findIndex((tr) => tr.id === activeTrackId);
    const next = Math.min(song.tracks.length - 1, Math.max(0, i + step));
    activeTrackId = song.tracks[next]!.id;
  }

  /** 명령 실행. 할 일이 없었으면 false (키를 브라우저에 그대로 넘긴다) */
  function run(command: CommandId): boolean {
    if (command.startsWith("grid.")) {
      division = Number(command.slice(5));
      return true;
    }
    switch (command) {
      case "file.open":
        openInput.click();
        return true;
      case "file.save3mle":
        save3mle();
        return true;
      case "file.saveMmi":
        saveMmi();
        return true;
      case "file.saveProject":
        saveProject();
        return true;
      case "edit.undo":
        undo();
        return true;
      case "edit.redo":
        redo();
        return true;
      case "note.tie":
        return roll?.tieSelected() ?? false;
      case "note.split": {
        const at = editCursor();
        return viewMode === "roll" && at !== undefined && (roll?.splitAt(at) ?? false);
      }
      case "tempo.tap":
        return tap();
      case "event.tempo":
      case "event.marker":
        if (!song || viewMode !== "roll") return false;
        openEventAtCursor(command === "event.tempo" ? "tempo" : "marker");
        return true;
      case "note.glue":
        return viewMode === "roll" && (roll?.glueSelected() ?? false);
      case "note.delete":
        if (pickedEvent && viewMode === "roll" && showEvents) return deletePicked();
        return roll?.editSelected(() => null, "음 지우기") ?? false;
      case "note.octaveUp":
        return roll?.editSelected((n) => (n.pitch + 12 <= 127 ? { ...n, pitch: n.pitch + 12 } : n), "옥타브 올리기") ?? false;
      case "note.octaveDown":
        return roll?.editSelected((n) => (n.pitch - 12 >= 0 ? { ...n, pitch: n.pitch - 12 } : n), "옥타브 내리기") ?? false;
      case "note.volumeUp":
        nudgeVolume(1);
        return true;
      case "note.volumeDown":
        nudgeVolume(-1);
        return true;
      case "play.toggle":
        if (playing) pause();
        else if (song && packs.length > 0) void play();
        return true;
      case "play.start":
        if (song && packs.length > 0) void play();
        return true;
      case "play.stop":
        if (!playing) return false;
        stop();
        return true;
      case "track.prev":
        selectTrack(-1);
        return true;
      case "track.next":
        selectTrack(1);
        return true;
      case "track.moveUp":
      case "track.moveDown": {
        if (!activeTrackId) return false;
        runIfChanged(shiftTrack(activeTrackId, command === "track.moveUp" ? -1 : 1, t("ui.moveTrack")));
        return true;
      }
      case "view.tab":
        viewMode = viewMode === "roll" ? "tab" : "roll";
        return true;
      case "view.orientation":
        orientation = orientation === "horizontal" ? "vertical" : "horizontal";
        return true;
      case "view.keymap":
        showKeymap = true;
        return true;
      case "edit.selectAll":
        return viewMode === "roll" && (roll?.selectAll() ?? false);
      case "edit.copy":
        return viewMode === "roll" && (roll?.copySelection() ?? false);
      case "edit.cut":
        return viewMode === "roll" && (roll?.cutSelection(t("ui.cut")) ?? false);
      case "edit.paste": {
        if (viewMode !== "roll") return false;
        // 재생 커서가 있으면 그 자리, 없으면 복사한 원래 자리. 붙인 뒤 커서를 끝으로 옮겨 이어 붙이기 쉽게
        // 편집 커서는 분수로 써서 l7 같은 길이도 틈 없이 잇는다
        const end = roll?.pasteAt(editCursor(), t("ui.pasteNotes"));
        if (end === undefined) return false;
        setCursor(end);
        return true;
      }
      case "edit.lengthDouble":
        return viewMode === "roll" && scaleSelection(DOUBLE, t("ui.lengthDouble"));
      case "edit.lengthHalf":
        return viewMode === "roll" && scaleSelection(HALF, t("ui.lengthHalf"));
      case "edit.transpose":
        openTranspose();
        return !!song;
    }
    return false;
  }

  const TEXT_INPUT = ".cm-editor, input, select, textarea, [contenteditable]";
  const TYPING = `${TEXT_INPUT}, button`;
  // 글 입력 칸에서는 롤 음을 바꾸지 않는다 (Ctrl+A·C·X·V는 글 편집으로, Ctrl+[ ]는 그대로 둔다)
  const TEXT_COMMANDS: ReadonlySet<CommandId> = new Set(["edit.selectAll", "edit.copy", "edit.cut", "edit.paste", "edit.lengthDouble", "edit.lengthHalf"]);

  function onKeydown(event: KeyboardEvent) {
    // 편집기가 이미 처리한 키(편집기 안 실행 취소 등)는 건드리지 않는다
    if (event.defaultPrevented || showKeymap || paste || midi || transposing || voicing || settings || meterOpen || eventEdit || addScoreOpen || recoverOpen || outputOpen || optimizing || event.isComposing) return;
    // 위 목록에 없는 대화 상자라도 열려 있으면 뒤의 곡에 단축키를 보내지 않는다
    if (document.querySelector("dialog[open]")) return;
    const target = event.target as HTMLElement | null;
    // Alt+숫자: 고른 음 v를 바로 (피아노 롤에서, 글 치는 곳 밖)
    // v0(뒤를 소리 없이 두는 데 쓴다)은 숫자 1 왼쪽 키: Alt+`
    if (event.altKey && !event.ctrlKey && !event.metaKey && /^((Digit|Numpad)\d|Backquote)$/.test(event.code) && viewMode === "roll" && !target?.closest?.(TYPING)) {
      const v = event.code === "Backquote" ? (profile.volume.min <= 0 ? 0 : undefined) : volumeForDigit(Number(event.code.slice(-1)), event.shiftKey, profile.volume);
      if (v !== undefined && roll?.editSelected((n) => (n.vol === v ? n : { ...n, vol: v }), "음 볼륨")) event.preventDefault();
      return;
    }
    const key = keyName(event);
    if (!key) return;
    // 탭 템포: 버튼에 초점이 있어도 먹게 (글 치는 곳은 빼고). 누르고 있어 되풀이되는 키는 버린다
    if (tapOpen && commandFor(bindings, key) === "tempo.tap" && !target?.closest?.(TEXT_INPUT)) {
      event.preventDefault();
      if (!event.repeat) tap();
      return;
    }
    if (target?.closest?.(TYPING) && !allowedWhileTyping(key)) return;
    const command = commandFor(bindings, key);
    if (!command) return;
    if (TEXT_COMMANDS.has(command) && target?.closest?.(TYPING)) return;
    // 글 입력 칸에 초점이 있으면 음·이벤트·트랙을 바꾸는 단축키(Alt+S·G·B·M·L·P, Alt+↑↓ 등)는 넘기지 않는다. 저장·재생·실행 취소는 그대로
    if (target?.closest?.(TEXT_INPUT) && /^(note|event|track)\.|^edit\.transpose$/.test(command)) return;
    // 입력 직후 Ctrl+S 같은 단축키가 아직 반영 안 된 글을 놓치지 않게 먼저 반영한다
    flushAllEditors();
    if (run(command)) event.preventDefault();
  }

  // 상태줄 값
  const statusTrack = $derived.by(() => {
    if (!song || !activeTrack) return "";
    const group = groups.find((g) => g.trackIds.includes(activeTrack.id));
    const k = (group?.trackIds.indexOf(activeTrack.id) ?? 0) + 1;
    return t("ui.statusTrackValue", { score: group?.number ?? 1, name: `${k} ${activeTrack.name}` });
  });
  const statusPolyphony = $derived(
    song ? `${t("ui.polyphony")} ${soundingNow ?? "-"} · ${t("ui.polyphonyPeak", { count: peak.count, tracks: song.tracks.filter((tr) => !tr.mute).length })}` : "",
  );
  const statusChars = $derived.by(() => {
    const text = analysis?.tracks.find((a) => a.track.id === activeTrackId)?.text;
    return text === undefined ? undefined : { count: text.length, limit: profile.charLimitPerScore };
  });
  const instrumentCount = $derived(packs.reduce((n, p) => n + p.instruments.length, 0));

  // 저장 알림·오류는 상태줄 위 패널에 모은다. 닫으면 같은 내용은 다시 띄우지 않는다
  const hasMessages = $derived(!!error || playback.unresolved.length > 0 || notices.length > 0 || offerUtf8);
  const messagesSig = $derived(JSON.stringify([error, playback.unresolved.map((u) => u.instrument), notices.map((d) => diag(d)), offerUtf8]));
  let dismissedSig = $state("");
  const showMessages = $derived(hasMessages && messagesSig !== dismissedSig);
  $effect(() => {
    if (!hasMessages) dismissedSig = "";
  });

  const ownInstrument = (track: Track) => (song ? trackInstrument(song, track).canonical : "piano");

  const trackActions: TrackActions = {
    select: (id) => (activeTrackId = id),
    renameTrack: (id, name) => history && sync(history.run(renameTrack(id, name, t("ui.rename")))),
    renamePlayer: (id, name) => history && sync(history.run(renamePlayer(id, name, t("ui.rename")))),
    playerInstrument: (playerId, canonical) => {
      const player = history?.song.players.find((p) => p.id === playerId);
      if (!history || !player) return;
      const from = instrumentName(player.instrument.canonical);
      sync(history.run(setPlayerInstrument(playerId, canonical, { from, to: instrumentName(canonical) }, t("ui.instrument"))));
    },
    trackInstrument: (id, canonical) => history && sync(history.run(setTrackInstrument(id, canonical, t("ui.trackInstrument")))),
    listen: updateTrack,
    viewOf: (id) => trackView[id] ?? {},
    view: (id, change) => (trackView = withTrackView(trackView, id, change)),
    remove: deleteTrack,
    canShift: (id, step) => {
      const s = history?.song;
      return !!s && shiftTrack(id, step).apply(s) !== s;
    },
    shift: (id, step) => runIfChanged(shiftTrack(id, step, t("ui.moveTrack"))),
    move: (id, playerId, index) => {
      if (history && !trackMoveBlock(history.song, id, playerId, profile.maxChordsPerPlayer)) runIfChanged(moveTrack(id, playerId, index, t("ui.moveTrack")));
    },
    moveTargets: (id) => {
      const s = history?.song;
      const track = s?.tracks.find((tr) => tr.id === id);
      if (!s || !track) return [];
      return s.players
        .filter((p) => p.id !== track.playerId)
        .map((p) => ({
          playerId: p.id,
          label: t("ui.scoreTarget", { n: groups.find((g) => g.playerId === p.id)?.number ?? "-", name: p.name }),
          reason: trackMoveBlock(s, id, p.id, profile.maxChordsPerPlayer) === "full" ? t("ui.moveTrackFull", { limit: profile.maxChordsPerPlayer }) : undefined,
        }));
    },
    toNewScore: (id) => {
      const s = history?.song;
      const track = s?.tracks.find((tr) => tr.id === id);
      if (!s || !track) return;
      runIfChanged(moveTrackToNewPlayer(id, newScoreName(s, track), t("ui.moveTrackToNew")));
    },
    copyToNewScore: (id) => {
      const s = history?.song;
      const track = s?.tracks.find((tr) => tr.id === id);
      if (!s || !track) return;
      const next = runIfChanged(duplicateTrackToNewPlayer(id, t("ui.duplicateTrackName", { name: track.name }), newScoreName(s, track), t("ui.copyTrackToNew")));
      // 복제본(새 트랙)을 고른다
      const copy = next?.tracks.find((tr) => !s.tracks.some((o) => o.id === tr.id));
      if (copy) activeTrackId = copy.id;
    },
    duplicate: (id) => {
      const s = history?.song;
      const track = s?.tracks.find((tr) => tr.id === id);
      if (!s || !track) return;
      // 악보가 다 찼으면 복제본이 다음 게임 악보로 넘어가므로 그대로 두되, 곡 검사가 알려 준다
      const next = runIfChanged(duplicateTrack(id, t("ui.duplicateTrackName", { name: track.name }), t("ui.duplicateTrack")));
      if (next) activeTrackId = next.tracks[next.tracks.findIndex((tr) => tr.id === id) + 1]?.id ?? activeTrackId;
    },
    addTrack: addTrackToPlayer,
    addScore: () => (addScoreOpen = true),
    isMelody: (id) => melodyIds.has(id),
    // 끌 때는 "화음"으로 표시해 악보 첫 트랙 기본 멜로디에서도 빠지게 한다
    setMelody: (id, on) => runIfChanged(setTrackRole(id, on ? "melody" : "harmony", t("ui.melodyTrack"))),
    inLane: (id) => laneExtra.includes(id),
    toggleLane: toggleLaneTrack,
    openSecond,
  };

  /** 트랙을 새 악보로 보낼 때 붙일 이름: "<트랙 악기> n" */
  function newScoreName(s: Song, track: Track): string {
    const canonical = trackInstrument(s, track).canonical;
    const n = s.players.filter((p) => p.instrument.canonical === canonical).length + 1;
    return t("ui.newPlayerName", { instrument: instrumentName(canonical), n });
  }

  /** 패널 머리 ⋯ 메뉴: 곡 메뉴의 구성 항목과 같다 */
  const paneMenu: MenuItem[] = $derived([
    { label: t("ui.addTrackMenu"), title: t("ui.addTrackHelp"), disabled: !activePlayer, run: addTrackToPlayer },
    { label: t("ui.addScoreMenu"), title: t("ui.addPlayerHelp"), run: () => (addScoreOpen = true) },
    { separator: true },
    { label: t("ui.distribute") + "…", title: t("ui.distributeHelp"), run: distribute },
    { label: t("ui.compact") + "…", title: t("ui.compactHelp"), run: compact },
    { label: t("ui.split") + "…", disabled: splitting, run: runSplit },
    { label: t("ui.outputMenu"), title: t("ui.outputMenuHelp"), run: openOutput },
  ]);

  /** 트랙 악기 바꾸기 (악보 악기와 같게 고르면 악보 악기를 따른다) */
  function changeTrackInstrument(track: Track, canonical: string) {
    if (history) sync(history.run(setTrackInstrument(track.id, canonical, t("ui.trackInstrument"))));
  }

</script>

<svelte:window onkeydown={onKeydown} onpaste={onPaste} />
{#if midi}
  <MidiDialog
    analysis={midi.analysis}
    name={midi.name}
    {profile}
    onimport={(next) => openSong(next, midi?.name.replace(/\.midi?$/i, ".mml") ?? "")}
    onclose={() => (midi = undefined)}
  />
{/if}
{#if paste}
  <PasteDialog
    initial={paste.text}
    canAppend={!!song}
    limit={profile.charLimitPerScore}
    maxChords={profile.maxChordsPerPlayer}
    onopen={(next) => openSong(next, "")}
    onappend={appendPasted}
    onclose={() => (paste = undefined)}
  />
{/if}

{#if voicing && song && activeTrackId}
  <VoiceDialog
    selected={voicing.selected}
    current={trackLabel(activeTrackId)}
    targets={song.tracks.filter((tr) => tr.id !== activeTrackId).map((tr) => ({ id: tr.id, label: trackLabel(tr.id) }))}
    siblings={scoreTrackIds().filter((id) => id !== activeTrackId).map((id) => ({ id, label: trackLabel(id) }))}
    initialMode={voicing.selected > 0 ? "move" : voicePrefs.mode}
    initialOrder={voicePrefs.order}
    preview={previewVoice}
    onapply={applyVoice}
    onclose={() => (voicing = undefined)}
  />
{/if}

{#if transposing}
  <TransposeDialog
    scopes={[
      ...(viewMode === "roll" && (roll?.selection().length ?? 0) > 0
        ? [{ id: "selection" as const, label: t("ui.scopeSelection", { count: roll?.selection().length ?? 0 }) }]
        : []),
      ...(activeTrackId ? [{ id: "track" as const, label: t("ui.scopeTrack") }, { id: "score" as const, label: t("ui.scopeScore") }] : []),
      { id: "song", label: t("ui.scopeSong") },
    ]}
    initialScope={transposing.scope}
    check={checkTranspose}
    onapply={applyTranspose}
    onclose={() => (transposing = undefined)}
  />
{/if}

{#if showKeymap}
  <KeymapDialog settings={keymap} onchange={setKeymap} onclose={() => (showKeymap = false)} />
{/if}

{#if settings}
  <SettingsDialog
    {packs}
    stored={storedPacks}
    {loadingPack}
    onremovepack={removePack}
    onaddpack={() => packInput.click()}
    {masterVolume}
    onvolume={setMasterVolume}
    {syncOffsetMs}
    onsync={setSyncOffset}
    {lightKeys}
    onlightkeys={toggleLightKeys}
    {midiKeys}
    {colorScheme}
    {appearance}
    onappearance={setAppearance}
    oncolorscheme={setColorScheme}
    onkeymap={() => {
      settings = undefined;
      showKeymap = true;
    }}
    onabout={() => {
      settings = undefined;
      about = { checkNow: false };
    }}
    initial={settings.section}
    onclose={() => (settings = undefined)}
  />
{/if}

{#if about}
  <AboutDialog checkNow={about.checkNow} beforeUpdate={() => (flushAllEditors(), flushAutosave())} onclose={() => (about = undefined)} />
{/if}

{#if recoverOpen}
  <RecoverDialog {works} onrestore={restoreWork} onforget={removeWork} onclose={() => (recoverOpen = false)} />
{/if}
{#if eventEdit && eventInfo}
  <EventDialog
    kind={eventEdit.kind}
    existing={eventEdit.existing}
    where={eventInfo.where}
    bpm={eventInfo.bpm}
    tempoRange={profile.tempo}
    marker={eventInfo.marker}
    beats={eventInfo.beats}
    unit={eventInfo.unit}
    atStart={eventInfo.atStart}
    onapply={applyEvent}
    ondelete={deleteEvent}
    onclose={() => (eventEdit = undefined)}
  />
{/if}
{#if meterOpen}
  <MeterDialog beats={meterHere.beats} unit={meterHere.unit} onapply={changeMeter} onclose={() => (meterOpen = false)} />
{/if}

{#if addScoreOpen}
  <AddScoreDialog initial="piano" onadd={addNewPlayer} onclose={() => (addScoreOpen = false)} />
{/if}

<div class="app">
<header class="topbar">
  <h1>BINOTE</h1>
  <Menu label={t("ui.menuFile")} items={fileMenu} />
  <Menu label={t("ui.menuEdit")} items={editMenu} />
  <Menu label={t("ui.menuSong")} items={songMenu} />
  <Menu label={t("ui.menuView")} items={viewMenu} />
  <input type="file" accept={fileAccept(SCORE_FILES)} onchange={onOpen} hidden bind:this={openInput} />
  <input type="file" accept={fileAccept(PACK_FILES)} multiple onchange={onAddPack} hidden bind:this={packInput} />
  <span class="divider"></span>
  <button class="icon" onclick={undo} disabled={!canUndo} title={t("ui.undo") + hint("edit.undo")} aria-label={t("ui.undo")}><Icon name="undo" /></button>
  <button class="icon" onclick={redo} disabled={!canRedo} title={t("ui.redo") + hint("edit.redo")} aria-label={t("ui.redo")}><Icon name="redo" /></button>
  <span class="spacer"></span>
  <div class="playgroup">
    <button class="icon" onclick={toStart} disabled={!song} title={t("ui.toStart")} aria-label={t("ui.toStart")}><Icon name="skip-back" fill /></button>
    {#if playing}
      <button class="icon go" onclick={pause} title={t("ui.pauseHelp")} aria-label={t("ui.pause")}><Icon name="pause" fill /></button>
    {:else}
      <button class="icon go" onclick={play} disabled={!song || packs.length === 0} title={t("ui.play") + hint("play.toggle")} aria-label={t("ui.play")}>
        <Icon name="play" fill />
      </button>
    {/if}
    <button class="icon" onclick={stop} disabled={!playing} title={t("ui.stop") + hint("play.stop")} aria-label={t("ui.stop")}><Icon name="stop" fill /></button>
    <button class="icon" class:on={!!loop} onclick={toggleLoop} disabled={!loop && !loopStash} title={t("ui.loopToggleHelp")} aria-label={t("ui.loopToggle")}>
      <Icon name="repeat" />
    </button>
    <span class="clock" title={t("ui.clockHelp")}>{clock(clockNow)} / {clock(totalSeconds)}</span>
    {#if tempoNow !== undefined}<span class="clock tempo" title={t("ui.tempoNowHelp")}>t{tempoNow}</span>{/if}
  </div>
  <span class="spacer"></span>
  <label class="volume" title={t("ui.masterVolume")}>
    <Icon name="volume" />
    <input type="range" min="0" max="1.5" step="0.05" value={masterVolume} oninput={(e) => setMasterVolume(Number(e.currentTarget.value))} />
  </label>
  <span class="divider"></span>
  <button class="icon" class:on={!!midiKeys.status} title={t("ui.midiKeysHelp")} aria-label={t("ui.midiKeys")} onclick={() => midiKeys.toggle()}>
    <Icon name="piano" />
  </button>
  {#if !portrait}
    <button
      class="icon"
      title={paneDock === "bottom" ? t("ui.dockToRight") : t("ui.dockToBottom")}
      aria-label={t("ui.dockHelp")}
      onclick={() => setDock(paneDock === "bottom" ? "right" : "bottom")}
    >
      <Icon name={paneDock === "bottom" ? "panel-bottom" : "panel-right"} />
    </button>
  {/if}
  <Menu icon="help" title={t("ui.helpTitle")} align="right" items={helpMenu} />
  <button class="icon" title={t("ui.settings")} aria-label={t("ui.settings")} onclick={() => (settings = { section: "packs" })}><Icon name="settings" /></button>
</header>

{#if song}
  <div class="toolzone">
    <Toolbar
      {viewMode}
      onview={(mode) => (viewMode = mode)}
      tabHint={hint("view.tab")}
      tool={rollTool}
      ontool={(next) => (rollTool = next)}
      {selectMove}
      onselectmove={setSelectMove}
      meter={meterHere}
      onmeter={changeMeter}
      {division}
      ondivision={(d) => (division = d)}
      {noteLength}
      onnotelength={(l) => (noteLength = l)}
      bind:inputVolume
      volumeMin={profile.volume.min}
      volumeMax={profile.volume.max}
      {selectedVolume}
      onselectedvolume={(vol) => roll?.editSelected((n) => (n.vol === vol ? n : { ...n, vol }), "음 볼륨")}
      hasCursor={cursor !== undefined}
      onbar={editBar}
      onfit={() => roll?.fitAll()}
      onzoom={(axis, factor) => roll?.zoom(axis, factor)}
      layer={rollLayer}
      onlayer={setRollLayer}
      compact={narrow}
      {tuningName}
      ontuning={(name) => (tuningName = name)}
      {capo}
      oncapo={(c) => (capo = c)}
      {showEvents}
      ontoggleevents={() => (showEvents = !showEvents)}
      {orientation}
      ontoggleorientation={() => run("view.orientation")}
      {sideBySide}
      canSide={!bottom && !portrait}
      ontoggleside={toggleSideBySide}
      {loadingReference}
      onreference={onReference}
      onvideo={onVideo}
    />
    {#if reference}
      <ReferenceBar {reference} bind:showWave onoffset={setReferenceOffset} onvolume={setReferenceVolume} onremove={removeReference} {tapOpen} ontaptempo={toggleTap} />
    {/if}
    {#if tapOpen}
      <TapBar
        {playing}
        count={taps.length}
        key={keyOf("tempo.tap") ?? ""}
        result={tapResult}
        merge={tapMerge}
        unit={tapUnit}
        onunit={setTapUnit}
        onmerge={setTapMerge}
        ontap={tap}
        onfinish={() => (playing ? stop() : finishTap())}
        onclear={() => (taps = [])}
        onclose={toggleTap}
      />
    {/if}
    {#if viewMode === "roll" && video}
      <VideoBar bind:video bind:playing={videoPlay} onremove={removeVideo} onfitroll={() => roll?.fitVideo()} />
    {/if}
  </div>
{:else}
  <div class="toolzone"></div>
{/if}

<main class="work" class:no-pane={!sideBySide && !portrait && !bottom} class:dock-bottom={bottom} class:empty={!song} style:--editor-h="{editorHeight}px" style:--pane-w="{paneWidth}px" style:--roll-n={rollShareV}>
  {#if !song}
    <div class="empty-start">
      <p class="muted empty-note">{t("ui.noSong", { ext: PROJECT_EXTENSION })}</p>
      <div class="start-actions">
        <button onclick={startNewSong} title={t("ui.newSongHelp")}>{t("ui.newSong")}</button>
        <button onclick={() => openInput.click()} title={t("ui.openFileHelp")}>{t("ui.openFile")}</button>
        <button onclick={() => (paste = { text: "" })} title={t("ui.pasteHint")}>{t("ui.paste")}</button>
      </div>
      {#if packs.length === 0}
        <p class="muted empty-note">
          {t("ui.startPackNote")}
          <button class="link" onclick={() => (settings = { section: "packs" })}>{t("ui.addPack")}</button>
        </p>
      {/if}
      {#if works.length > 0}<RecoverList {works} onrestore={restoreWork} onforget={removeWork} />{/if}
    </div>
  {:else}
    <div class="roll-pane">
      {#if viewMode === "roll"}
        <PianoRoll
          bind:this={roll}
          {song}
          {activeTrackId}
          {orientation}
          {division}
          noteDur={newNoteDur}
          {playhead}
          onnotes={editNotes}
          onselecttrack={(id) => (activeTrackId = id)}
          onpicknote={pickNote}
          onpreview={rollPreview}
          bind:video
          bind:videoPlay
          {pitchRange}
          look={appearance.note}
          {themeKey}
          wave={showWave && reference && referencePeaks ? { peaks: referencePeaks, offset: reference.offsetMs / 1000 } : undefined}
          {colors}
          seconds={playing ? songSeconds : undefined}
          {cursor}
          {loop}
          oncursor={(t) => (cursor = t)}
          onseek={seek}
          {showEvents}
          onloop={(r) => (loop = r)}
          tool={rollTool}
          {selectMove}
          volume={inputVolume}
          onvolume={nudgeVolume}
          {lightKeys}
          visibleTrackIds={rollTracks}
          locked={lockedIds}
          pickOthers={pickBackground}
          onevent={openEvent}
          oneventmove={moveEvent}
          onalignbar={alignBar}
          onwaveoffset={(sec) => setReferenceOffset(Math.round(sec * 1000))}
          {pickedEvent}
          onpickevent={(e) => (pickedEvent = e)}
          ontempowheel={wheelTempo}
          laneTrackIds={laneExtra}
          {melodyIds}
          onvolumes={editVolumes}
          onclearlane={() => (laneExtra = [])}
        />
      {:else}
        <TabView
          {song}
          {activeTrackId}
          {tuning}
          {playhead}
          {division}
          noteDur={newNoteDur}
          bind:volume={inputVolume}
          volumeRange={profile.volume}
          {colors}
          locked={lockedIds}
          laneTrackIds={laneExtra}
          {melodyIds}
          onunplayable={(n) => (unplayable = n)}
          onedit={(changes, label) => {
            const open = changes.filter((c) => editable(c.trackId));
            if (history && open.length > 0) sync(history.run(setTracksNotes(open, label)));
          }}
          onpreview={(pitch) => {
            rollPreview(pitch, true);
            setTimeout(() => rollPreview(pitch, false), 300);
          }}
        />
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="pane-divider"
      class:h={portrait || bottom}
      title={bottom ? t("ui.editorDivider") : t("ui.sideDivider")}
      onpointerdown={ondividerdown}
      onpointermove={ondividermove}
      onpointerup={ondividerup}
      ondblclick={resetDivider}
    ></div>
    <div class="list-pane">
      {#if analysis}
        <TrackPane
          {song}
          {groups}
          tracks={analysis.tracks}
          {colors}
          {activeTrackId}
          {fileName}
          charLimit={profile.charLimitPerScore}
          dock={paneDock}
          {portrait}
          trackInstrument={ownInstrument}
          actions={trackActions}
          {reveal}
          playing={activeTrackId ? playingSpans.get(activeTrackId) : undefined}
          follow={true}
          moreItems={paneMenu}
          {secondTrackId}
          playingSecond={secondTrackId ? playingSpans.get(secondTrackId) : undefined}
          onclosesecond={() => setDualEditor(false)}
          onedit={editText}
          onundo={undo}
          onredo={redo}
          ongodiag={(trackId, from, to) => (reveal = { trackId, from, to, focus: true, nonce: (reveal?.nonce ?? 0) + 1 })}
        >
          {#snippet top()}
            {#if noteListOpen && activeTrack && song}
              <div class="split-wrap">
                <NoteList
                  trackName={activeTrack.name}
                  notes={activeTrack.notes}
                  selected={selectedIds}
                  timeSig={song.timeSig}
                  onpick={(note) => goToCheck(activeTrack, note)}
                  onclose={() => (noteListOpen = false)}
                />
              </div>
            {/if}
            {#if split && split.song === song}
              <div class="split-wrap">
                <SplitPanel song={split.song} result={split.result} limit={profile.charLimitPerScore} maxChords={chordsOf} onclose={() => (split = undefined)} />
              </div>
            {/if}
          {/snippet}
        </TrackPane>
      {/if}
    </div>
  {/if}
  <!-- 오래 걸리는 일(악보책 나누기·WAV 저장)의 진행과 취소. 워커에서 돌아 그동안에도 편집할 수 있다 -->
  {#if splitProgress !== undefined || wavProgress !== undefined}
    <div class="job-toast" role="status">
      {#if splitProgress !== undefined}
        <div class="job">
          <span>{t("ui.splitting")} {Math.round(splitProgress * 100)}%</span>
          <span class="job-bar"><span style:width="{Math.round(splitProgress * 100)}%"></span></span>
          <button class="small" onclick={cancelSplit}>{t("ui.cancel")}</button>
        </div>
      {/if}
      {#if wavProgress !== undefined}
        <div class="job">
          <span>{t("ui.wavRendering")} {Math.round(wavProgress * 100)}%</span>
          <span class="job-bar"><span style:width="{Math.round(wavProgress * 100)}%"></span></span>
          <button class="small" onclick={cancelWav}>{t("ui.cancel")}</button>
        </div>
      {/if}
    </div>
  {/if}
</main>

{#if optimizing}
  {@const o = optimizing}
  {@const kept = o.kind === "compact" ? o.after === o.before : o.moved === 0}
  <OptimizePreview
    title={t(o.kind === "compact" ? "ui.previewCompactTitle" : "ui.previewDistributeTitle")}
    summary={o.kind === "compact"
      ? kept
        ? t("ui.compactKept")
        : t("ui.previewCompactSummary")
      : kept
        ? t("ui.previewDistributeNone")
        : t("ui.previewDistributeSummary", { moved: o.moved })}
    rows={kept ? [] : previewRows(o.before, o.after, profile.charLimitPerScore)}
    limit={profile.charLimitPerScore}
    blocked={kept}
    where={scoreLabel}
    onapply={applyOptimize}
    onclose={() => (optimizing = undefined)}
  />
{/if}
{#if output}
  <OutputPanel
    rows={output.rows}
    tempo={output.tempo}
    limit={profile.charLimitPerScore}
    tempoRange={profile.tempo}
    ontrack={(id) => (activeTrackId = id)}
    onseek={(at) => {
      setCursor(at);
      roll?.reveal(toFloat(at));
    }}
    ondistribute={distribute}
    onsplit={runSplit}
    onclose={() => (outputOpen = false)}
  />
{/if}

{#snippet messagesPanel()}
  <div class="msg-head">
    <strong>{t("ui.statusMessages")}</strong>
    <span class="spacer"></span>
    <button class="icon" title={t("ui.dismiss")} aria-label={t("ui.dismiss")} onclick={() => (dismissedSig = messagesSig)}><Icon name="x" /></button>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
  {#if playback.unresolved.length > 0}
    <p class="error">{t("ui.unresolved", { list: [...new Set(playback.unresolved.map((u) => instrumentName(u.instrument)))].join(", ") })}</p>
  {/if}
  {#if notices.length > 0}
    <ul class="notices">
      {#each notices as d, i (i)}
        <li class={d.level}><span class="muted">{d.where}</span> {diag(d)}</li>
      {/each}
    </ul>
  {/if}
  {#if offerUtf8}
    <p class="notice">
      {t("ui.cp949Hint")}
      <button class="small" onclick={() => save3mle("utf-8")}>{t("ui.saveUtf8")}</button>
    </p>
  {/if}
{/snippet}

{#snippet selectionInfo()}
  {#if song && activeTrack}
    <NoteInfo
      notes={selectedNotes}
      timeSig={song.timeSig}
      range={soundingRangeOf(profile, trackInstrument(song, activeTrack).canonical)}
      onlength={(dur) => roll?.editSelected((n) => ({ ...n, dur }), t("ui.noteInfoLength"))}
    />
  {/if}
{/snippet}

{#snippet checksPanel()}
  {#if analysis && song}<SongChecks {song} diagnostics={analysis.song} ongo={goToCheck} />{/if}
{/snippet}

{#snippet helpPanel()}
  <HelpPopover
    {viewMode}
    onkeymap={() => {
      statusPanel = undefined;
      showKeymap = true;
    }}
  />
{/snippet}

{#if pwa.updateReady}
  <div class="update-bar" role="status">
    <span>{t(pwa.updateFailed ? "ui.updateSaveFailed" : "ui.updateReady")}</span>
    <button onclick={() => applyUpdate(() => (flushAllEditors(), flushAutosave()))}>{t("ui.updateReload")}</button>
    <button class="icon" title={t("ui.dismiss")} aria-label={t("ui.dismiss")} onclick={() => (pwa.updateReady = false)}><Icon name="x" /></button>
  </div>
{/if}
<StatusBar
  track={statusTrack}
  polyphony={statusPolyphony}
  chars={statusChars}
  unplayable={viewMode === "tab" ? unplayable : 0}
  checkCount={analysis?.song.length ?? 0}
  packCount={packs.length}
  {instrumentCount}
  flash={compactNote}
  panel={statusPanel}
  onpanel={(p) => (statusPanel = p)}
  onpacks={() => (settings = { section: "packs" })}
  messages={showMessages ? messagesPanel : undefined}
  selection={selectedNotes.length > 0 ? selectionInfo : undefined}
  checks={checksPanel}
  help={helpPanel}
/>
</div>
