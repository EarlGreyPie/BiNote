<script lang="ts">
  import { programForPack, type InstrumentGains, type SoundPackInfo } from "@mmlce/audio/browser";
  import {
    add,
    cmp,
    sub,
    DEFAULT_BPM,
    normalizeTempo,
    getProfile,
    positionToSeconds,
    secondsToWhole,
    toFloat,
    History,
    planReverbStamp,
    maxChordsOf,
    type ArpResult,
    type SlidesResult,
    type GraceResult,
    type TrillResult,
    type LabResult,
    isSoloInstrument,
    barBeatAt,
    barsOfRange,
    headsInBars,
    type BarRange,
    meterAt,
    meterGrid,
    measureStart,
    ZERO,
    foldPitch,
    rat,
    clipOverlaps,
    transposeNotes,
    changeVolumes,
    tieChains,
    volumeSpan,
    type VolumeChange,
    DOUBLE,
    HALF,
    STANDARD_TUNING,
    trackInstrument,
    replaceSong,
    breakTimbreTies,
    madeOf,
    madeTracks,
    guessArpeggioAround,
    restoreMade,
    sameNotes,
    type MadeRestore,
    type Note,
    type Rat,
    type Command,
    type GameProfile,
    type Song,
    type TabTuning,
    type TempoEvent,
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
    addTrackWithNotes,
    appendSong,
    compactResult,
    compactSong,
    deleteTime,
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
    blockedSplitBack,
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
    changeTempos,
    changeTemposResult,
    rampTempos,
    rampTemposResult,
    type TempoRamp,
    tempoChangeTargets,
    type TempoChange,
    fillScoreTempo,
    keepScoreTempo,
    scoresMissingTempo,
    setPlayerInstrument,
    setPlayerTab,
    setTrackInstrument,
    setNotesAndAddTracks,
    applyMadeRestore,
    madeCommand,
    restoreMadeCommand,
    adoptMadeCommand,
    setTracksNotesAddingTracks,
    setTrackPack,
    type ProgramForPack,
    type SoloSplit,
    setTrackRole,
    setTracksNotes,
    canWriteExactly,
    setTrackNotes,
    setTrackText,
    findOffgrid,
    fixOffgrid,
    type OffgridFix,
    type BookPlan,
    type BookProgress,
    type FewerBooks,
    gameCharCounts,
    reviewFolds,
    applyFoldShifts,
    type FoldPhrase,
  } from "@mmlce/mml";
  import { analyzeSong, noteSpan, spanAt, textTimeline } from "./lib/analysis";
  import { trackSoundingRange, type CanonicalOf } from "./lib/instrumentRange";
  import { emptyViewMemory, fromCurrentView, rememberView } from "./lib/viewCarry";
  import { freshSongView } from "./lib/songView";
  import type { TabAlign } from "./lib/tabAlign";
  import { Engine, MASTER_MAX } from "./lib/engine";
  import { diag, i18n, instrumentLabel, instrumentName, LOCALE_LABELS, setLocale, t } from "./lib/i18n.svelte";
  import { openScore } from "./lib/load";
  import { confirmedSave } from "./lib/projectSave";
  import {
    asksSaveDialog,
    canAskSave,
    canOpenFile,
    loadSaveTarget,
    pickOpenFile,
    recallProjectFile,
    rememberProjectFile,
    saveFile,
    saveProject as saveProjectFile,
    type SavedFile,
  } from "./lib/saveTarget.svelte";
  import { saveBaseName } from "./lib/saveName";
  import { windowTitle } from "./lib/windowTitle";
  import { restoreWorkFile, sameAutosave, type AutosaveState as WorkAutosave } from "./lib/workFile";
  import { flushAllEditors } from "./lib/MmlEditor.svelte";
  import ReferenceBar from "./lib/ReferenceBar.svelte";
  import TapBar from "./lib/TapBar.svelte";
  import RecordBar from "./lib/RecordBar.svelte";
  import { countIn, MidiRecorder, quantizeTake, RecordFlow, type RecordJob, type RecordStatus, type TakeKey } from "./lib/midiRecord";
  import { assignTake, planChanges, recordTarget, takeGhosts, type RecordGhost, type RecordMode, type RecordTarget } from "./lib/recordPlan";
  import { alignBarTempo, attackStarts, boundToSong, tempoOutOfRange, barStart, bpmAt, nearestBar, nearestBeat, offIntervals, onsetNear, pairBarTempo, previousBar, snapTaps, tapMarks, tapTempos, type BarDragMode, type TapReview, type TapUnit } from "./lib/tempoSync";
  import SongChecks from "./lib/SongChecks.svelte";
  import TrackPane from "./lib/TrackPane.svelte";
  import type { TrackActions } from "./lib/trackActions";
  import type { Peaks } from "./lib/waveform";
  import { noteClipboard } from "./lib/noteClipboard.svelte";
  import { APPEARANCE_STORAGE, applyAppearance, parseAppearance, themeKeyOf, type Appearance } from "./lib/appearance";
  import { uiScaleNow } from "./lib/uiScaleNow.svelte";
  import VideoBar from "./lib/VideoBar.svelte";
  import VideoBarsBar from "./lib/VideoBarsBar.svelte";
  import { pickBarStarts } from "./lib/videoBars";
  import { scanVideo } from "./lib/videoScan";
  import { MidiKeys } from "./lib/midiKeys.svelte";
  import { loadStored, parseJson, saveStored } from "./lib/persist";
  import { flushSync, untrack } from "svelte";
  import { speedPickAllows } from "./lib/videoSpeed";
  import { clock } from "./lib/time";
  import { forgetPack, loadPacks, savePack, savePackOrder } from "./lib/packStore";
  import { fileAccept, hasExtension } from "./lib/fileAccept";
  import { AutosaveQueue, AutosaveTracker } from "./lib/autosave";
  import { booksJob, splitJob, wavJob } from "./lib/jobs";
  import NoteList from "./lib/NoteList.svelte";
  import { forgetWork, listWorks, loadWork, newWorkId, saveWork, type WorkSummary } from "./lib/workStore";
  import { editorStateKey, parseEditorState, withTrackView, type EditorState, type ReferenceFit, type TrackViewState, type VideoFit } from "./lib/projectEditor";
  import RecoverList from "./lib/RecoverList.svelte";
  import RecoverDialog from "./lib/RecoverDialog.svelte";
  import NoteInfo from "./lib/NoteInfo.svelte";

  const SCORE_EXTENSIONS = [...PROJECT_EXTENSIONS, ".mml", ".mmi", ".txt", ".mid", ".midi"];
  const SCORE_FILES = SCORE_EXTENSIONS.join(",");
  const PACK_FILES = ".dls,.sf2,.sf3";
  import Menu, { type MenuItem } from "./lib/Menu.svelte";
  import MmlKeyPad from "./lib/MmlKeyPad.svelte";
  import MasterVolume from "./lib/MasterVolume.svelte";
  import AddScoreDialog from "./lib/AddScoreDialog.svelte";
  import HelpPopover from "./lib/HelpPopover.svelte";
  import Icon from "./lib/Icon.svelte";
  import MeterDialog from "./lib/MeterDialog.svelte";
  import TupletDialog from "./lib/TupletDialog.svelte";
  import { newUnwritableTrack } from "./lib/writable";
  import { gridDivisions, isGridDivision, stepGrid, tupletFits, tupletGrid, tupletName, withLengths, type Tuplet } from "./lib/tuplet";
  import { setTuplet, tupletPrefs } from "./lib/tupletPrefs.svelte";
  import EventDialog from "./lib/EventDialog.svelte";
  import type { EventChanges } from "./lib/eventChanges";
  import TempoChangeDialog from "./lib/TempoChangeDialog.svelte";
  import TempoRampDialog from "./lib/TempoRampDialog.svelte";
  import OffgridDialog from "./lib/OffgridDialog.svelte";
  import FoldReviewDialog from "./lib/FoldReviewDialog.svelte";
  import SettingsDialog from "./lib/SettingsDialog.svelte";
  import StatusBar, { type StatusPanel } from "./lib/StatusBar.svelte";
  import Toolbar, { type RollLayer } from "./lib/Toolbar.svelte";
  import { coarsePointer, mmlPad } from "./lib/mmlPad.svelte";
  import { parseTabPad, TAB_PAD_KEY } from "./lib/tabPad";
  import { FOLLOW_CURSOR_KEY, parseFollowCursor } from "./lib/tabFollow";
  import VoiceDialog, { parseVoicePrefs, VOICE_STORAGE, type VoiceMode, type VoiceOptions, type VoicePreview } from "./lib/VoiceDialog.svelte";
  import RetuneDialog, { type RetuneCheck } from "./lib/RetuneDialog.svelte";
  import { retuneCommand, retuneKeepingTab } from "./lib/retune";
  import TransposeDialog, { type TransposeCheck, type TransposeScope } from "./lib/TransposeDialog.svelte";
  import VolumeDialog, { type VolumeCheck } from "./lib/VolumeDialog.svelte";
  import ArpeggioDialog from "./lib/ArpeggioDialog.svelte";
  import SlideDialog from "./lib/SlideDialog.svelte";
  import GraceDialog from "./lib/GraceDialog.svelte";
  import TrillDialog from "./lib/TrillDialog.svelte";
  import MadeRestoreDialog from "./lib/MadeRestoreDialog.svelte";
  import LabNoteDialog from "./lib/LabNoteDialog.svelte";
  import ReverbDialog from "./lib/ReverbDialog.svelte";
  import LoudnessCompareDialog from "./lib/LoudnessCompareDialog.svelte";
  import type { ReferencePower } from "./lib/loudnessCompare";
  import { reverbPrefs, stampTail } from "./lib/reverbPrefs.svelte";
  import { LAB_FEATURES, labs, type LabFeatureId } from "./lib/labs.svelte";
  import { Playback } from "./lib/playback.svelte";
  import { TUNINGS, isTuningName, type ScoreTuning, type TuningName } from "./lib/tunings";
  import PianoRoll from "./lib/PianoRoll.svelte";
  import TabView from "./lib/TabView.svelte";
  import KeymapDialog from "./lib/KeymapDialog.svelte";
  import AboutDialog from "./lib/AboutDialog.svelte";
  import ReleaseNotesDialog from "./lib/ReleaseNotesDialog.svelte";
  import SplitPanel from "./lib/SplitPanel.svelte";
  import { setSplitSpread, setSplitThorough, splitPrefs } from "./lib/splitPrefs.svelte";
  import OutputPanel from "./lib/OutputPanel.svelte";
  import OptimizePreview from "./lib/OptimizePreview.svelte";
  import SpreadDialog from "./lib/SpreadDialog.svelte";
  import MergeDialog from "./lib/MergeDialog.svelte";
  import { outputRows, previewRows, tempoAdvice } from "./lib/output";
  import { midiStepLength, stepCursorFor, notesEnd, placeChord, previousVolume, volumeForVelocity } from "./lib/midiInput";
  import { fillEditorTracks, oldestEditor, parseEditorCount, parseEditorMax, swapIntoEditors } from "./lib/editors";
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
  import { clampRollShare, maxRollShare, paneMinHeight, ROLL_SHARE_MAX, ROLL_SHARE_MIN } from "./lib/paneSplit";
  import { meterEditAt, meterTarget } from "./lib/meterTarget";
  import { pitchText, positionText } from "./lib/noteInfo";
  import { dotFactor, toggleDot } from "./lib/dotLength";
  import { arpMadeOfGuess, parseArpMade, tabArpPick, type ArpMade } from "./lib/arpeggioOptions";
  import { parseSlideMade, tabSlidePick, type SlideChoice } from "./lib/slideOptions";
  import { parseGraceMade, type GraceChoice } from "./lib/graceOptions";
  import { parseTrillMade, type TrillChoice } from "./lib/trillOptions";
  import { VIDEO_DEFAULTS, exactTime, tempoChanges, lengthsFor, noteLengthOf, stepNoteLength, type BackgroundVideo, type EventKind, type EventLabel, type EventRef, type NoteLength, type Orientation, type RollTool } from "./lib/roll";


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
  /** 최근에 고른 트랙 (새 것이 뒤). 실행 취소로 고른 트랙이 사라지면 그 전에 보던 트랙으로 돌아간다 */
  let recentTrackIds: string[] = [];
  $effect(() => {
    const id = activeTrackId;
    if (id === undefined) return;
    recentTrackIds = [...recentTrackIds.filter((r) => r !== id).slice(-31), id];
  });
  let orientation = $state<Orientation>("horizontal");
  let division = $state(16);
  /** 새 음 길이 (격자대로 또는 l4·l8. 같은 MML 길이) */
  let noteLength = $state<NoteLength>("grid");
  /** 보기 → 타브 숫자판: 마우스로 지판을 눌러도 프렛 숫자판을 연다. 이 브라우저에 기억한다 */
  let tabPadOn = $state(loadStored(TAB_PAD_KEY, parseTabPad));
  function toggleTabPad() {
    tabPadOn = !tabPadOn;
    saveStored(TAB_PAD_KEY, tabPadOn ? "1" : "0");
  }
  /** 보기 → 커서 따라가기 (기본 켬). 지금은 타브에만 쓴다. 이 브라우저에 기억한다 */
  let followCursor = $state(loadStored(FOLLOW_CURSOR_KEY, parseFollowCursor));
  function toggleFollowCursor() {
    followCursor = !followCursor;
    saveStored(FOLLOW_CURSOR_KEY, followCursor ? "1" : "0");
  }
  const newNoteDur = $derived(noteLengthOf(noteLength, division));
  const DIVISIONS = GRID_DIVISIONS;
  /** 새 음 → 잇단음… 창 */
  let tupletOpen = $state(false);
  /** 잇단음을 정한다: 새 음 길이로 삼고, grid면 격자도 그 칸으로 */
  function applyTuplet(tuplet: Tuplet, grid: boolean) {
    setTuplet(tuplet);
    noteLength = tupletName(tuplet);
    if (grid && isGridDivision(tupletGrid(tuplet), profile.length)) division = tupletGrid(tuplet);
  }
  let viewMode = $state<"roll" | "tab">("roll");
  /**
   * 타브 ↔ 피아노롤을 바꿔도 이어 보는 자리: 보던 시간 자리(같이 씀), 롤·타브 확대(따로), 타브 커서.
   * 보기를 바꾸면 컴포넌트를 새로 만들므로 여기 두고 넘긴다. 화면을 다시 그릴 일이 아니라 반응 상태로 두지 않는다.
   * 롤에 가 있는 동안 앱의 tabCursor는 비어 있다 (기억한 커서는 여기에만 있고 타브를 다시 열 때 되살린다)
   */
  const viewMemory = emptyViewMemory();
  /** 타브 지판 위치 (TabView가 알린다. PC 위 도구줄 단추 글자·안내용) */
  let tabAlign = $state<TabAlign>("middle");
  // 화면 모양: 테마·강조색·음 모양. 시스템 테마가 바뀌어도 롤·타브 캔버스를 다시 그리게 themeKey를 바꾼다
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
  $effect(() => {
    applyAppearance(appearance, document.documentElement);
    uiScaleNow.factor = appearance.uiScale / 100;
  });
  const themeKey = $derived(themeKeyOf(appearance, systemDark));

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
  const compactQuery = typeof matchMedia === "undefined" ? undefined : matchMedia("(max-width: 1700px), (max-aspect-ratio: 1/1)");
  let narrow = $state(compactQuery?.matches ?? false);
  $effect(() => {
    const onchange = () => (narrow = compactQuery?.matches ?? false);
    compactQuery?.addEventListener("change", onchange);
    return () => compactQuery?.removeEventListener("change", onchange);
  });
  let statusPanel = $state<StatusPanel | undefined>(undefined);
  let settings = $state<{ section: "packs" | "playback" | "display" | "save" | "language" | "keys" } | undefined>(undefined);
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
  /** 영상 속도 직접 재기 단계 (PianoRoll과 묶음) */
  let speedStep = $state<0 | 1 | 2 | 3>(0);
  // 영상 속도를 직접 재는 동안에는 곡을 바꾸는 입구를 모두 닫는다 (규칙은 speedPickAllows 한 곳).
  // 단축키·메뉴·실행 취소·MIDI 건반·롤에서 넘어오는 편집·글 입력이 모두 여기서 막힌다. 그만두기는 Esc나 도구줄의 취소
  const picking = $derived(speedStep !== 0);
  /**
   * 피아노롤 ↔ 타브. 재는 중에 롤을 떠나면 재기를 그만두고, 재기 전 화면 자리를 보기 기억에 먼저 적은 뒤 바꾼다
   * (타브는 만들어질 때 그 기억을 읽으므로, 롤이 사라지며 적으면 늦다)
   */
  function showView(mode: "roll" | "tab") {
    if (mode !== viewMode && picking) {
      roll?.cancelSpeedPick();
      flushSync();
    }
    viewMode = mode;
  }
  // 롤이 사라지면(타브로 바꾸기) 재기 단계를 남기지 않는다 (남으면 위 규칙이 타브에서도 키를 막는다)
  $effect(() => {
    if (viewMode !== "roll") untrack(() => (speedStep = 0));
  });
  /** 영상 속도 재기 결과 한 줄 */
  let speedNote = $state("");
  /** 속도 맞추기: 자동으로 재고, 못 재면 직접 재기로 넘어간다 */
  async function matchVideoSpeed() {
    speedNote = t("ui.videoSpeedMeasuring");
    const ok = (await roll?.measureVideoSpeed()) ?? false;
    if (ok && video?.speed) speedNote = t("ui.videoSpeedDone", { speed: Math.round(video.speed) });
    else {
      speedNote = t("ui.videoSpeedAutoFailed");
      roll?.startSpeedPick();
    }
  }

  const KEYMAP_STORAGE = "mmlce.keymap";
  let keymap = $state.raw<KeymapSettings>(loadStored(KEYMAP_STORAGE, (raw) => parseSettings(parseJson(raw) ?? null)));
  let showKeymap = $state(false);
  /** BiNote 정보 창 */
  let about = $state(false);
  /** 바뀐 내용 창: 받아 둔 새 판(waiting) 또는 지금 판(current) */
  let releaseNotes = $state<"waiting" | "current" | undefined>(undefined);
  const bindings = $derived(resolve(keymap));
  let roll = $state<ReturnType<typeof PianoRoll> | undefined>(undefined);
  let tab = $state<ReturnType<typeof TabView> | undefined>(undefined);
  /** 고른 음 편집을 받는 쪽: 피아노롤 또는 타브 (같은 이름·같은 뜻의 함수를 내보낸다) */
  const editor = $derived(viewMode === "roll" ? roll : tab);
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
    const keep: VideoFit | typeof VIDEO_DEFAULTS | Omit<VideoFit, "name" | "opacity" | "offset"> =
      saved ?? (video ? { fit: video.fit, low: video.low, high: video.high, keyLine: video.keyLine, stretch: video.stretch, ...(video.fill === false ? { fill: false } : {}), ...(video.speed ? { speed: video.speed } : {}) } : VIDEO_DEFAULTS);
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
      ...("fill" in keep && keep.fill === false ? { fill: false } : {}),
      ...("speed" in keep && keep.speed ? { speed: keep.speed } : {}),
    };
    videoName = file.name;
    speedNote = "";
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
      referencePower = undefined;
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
    referencePower = undefined;
    loudnessOpen = false;
  }

  function removeVideo() {
    if (video) URL.revokeObjectURL(video.url);
    video = undefined;
    videoName = "";
    videoPlay = false;
  }
  /** 타브에서 화음 음을 넣다가 트랙을 더할 수 있는 한도 (악기별 게임 한도, 오르골·축음기 3) */
  const tabMaxTracks = $derived.by(() => {
    const p = song?.players.find((pl) => pl.id === tabScore);
    return maxChordsOf(profile, p?.instrument.canonical);
  });
  /** 고른 트랙의 악보. 타브 튜닝은 이 악보 것을 보이고 바꾼다 */
  const tabScore = $derived(song?.tracks.find((t) => t.id === activeTrackId)?.playerId);
  // 악보마다 고른 튜닝은 곡의 악보(Player.tab)에 있어 실행 취소·다시 실행을 곡과 함께 따른다. 고르지 않은 악보는 tuningName·capo
  const scoreTuning = $derived.by<ScoreTuning>(() => {
    const tab = song?.players.find((p) => p.id === tabScore)?.tab;
    return tab && isTuningName(tab.tuning) ? { tuning: tab.tuning, capo: tab.capo } : { tuning: tuningName, capo };
  });
  const tuning = $derived<TabTuning>({ ...STANDARD_TUNING, strings: TUNINGS[scoreTuning.tuning].strings, capo: scoreTuning.capo });
  function setScoreTuning(change: Partial<ScoreTuning>) {
    if (tabScore === undefined) {
      if (change.tuning) tuningName = change.tuning;
      if (change.capo !== undefined) capo = change.capo;
      return;
    }
    // 튜닝은 보는 방법이라 실행 취소 기록에 넣지 않는다 (음소거처럼). 되돌리기가 튜닝을 표준으로 돌리지 않게
    if (!history) return;
    const next = setPlayerTab(tabScore, { ...scoreTuning, ...change }).apply(history.song);
    if (next !== history.song) sync(history.amend(next));
  }


  const profile = $derived(getProfile(song?.meta.profileId ?? "mobile"));
  /** 고를 수 있는 새 음 길이: 게임 음길이 한도(곡 프로필)로 거른 목록. 고른 길이가 목록 밖이면(프로필이 바뀜 등) 격자로 */
  /** 정해 둔 잇단음 길이 ("20"). 게임이 받지 못하면(곡 프로필이 바뀜 등) 없다 */
  const tupletLength = $derived(tupletFits(tupletPrefs.tuplet, profile.length) ? tupletName(tupletPrefs.tuplet) : undefined);
  /** 잇단음 길이와, 파일에서 읽은 지금 길이(다른 잇단음)도 게임이 받으면 목록에 둔다 */
  const noteLengths = $derived(withLengths(lengthsFor(profile.length), [...(tupletLength ? [tupletLength] : []), noteLength], profile.length));
  /**
   * 고를 수 있는 격자: 목록 칸 + 잇단음 칸 + 새 음 길이에 맞는 칸(l20.이면 1/40) + 지금 격자.
   * 새 음을 같은 길이로 이어 넣을 자리가 칸에 맞아야 롤에서 눌러 넣고 고칠 수 있다.
   * 칸 하나가 게임 최단 토막보다 짧은 격자(1/128 등)는 넣지 않는다 (그 칸 길이 음·쉼표를 MML로 쓸 수 없다)
   */
  const divisions = $derived(
    gridDivisions(GRID_DIVISIONS, [...(tupletLength ? [tupletGrid(tupletPrefs.tuplet)] : []), ...(noteLength !== "grid" ? [noteLengthOf(noteLength, 1).d] : []), division], profile.length),
  );
  $effect(() => {
    if (!noteLengths.includes(noteLength)) noteLength = "grid";
  });
  /** 피아노롤에 보일 음 높이: C0~B8 (게임 프로필의 옥타브 범위가 더 좁으면 그 안) */
  const pitchRange = $derived<readonly [number, number]>([
    Math.max(12, (profile.octave.min + 1) * 12),
    Math.min(119, (profile.octave.max + 1) * 12 + 11),
  ]);
  /**
   * 번호로만 아는 악기(추가 사운드팩의 #42.3 등)의 실제 악기. 재생과 같은 해석으로 진단·롤 음역을 정한다.
   * 올린 팩에 따라 달라지므로 팩 목록이 바뀌면 새 함수가 되어 진단과 롤을 다시 계산한다
   */
  const canonicalOf = $derived.by<CanonicalOf>(() => {
    void packs;
    return (instrument, program, pack) => engine.canonicalOf(instrument, program, pack);
  });
  const analysis = $derived(song ? analyzeSong(song, profile, { canonicalOf }) : undefined);
  // 악보 하나에 담는 트랙 수는 악기마다 (오르골 3)
  const chordsOf = $derived((playerId: string) => maxChordsOf(profile, song?.players.find((p) => p.id === playerId)?.instrument.canonical));
  const groups = $derived(song ? scoreGroups(song, chordsOf) : []);
  /**
   * 트랙마다 내보낼 때(악보 단위로 다시 쓴 게임 글) 글자 수. 원문은 주석·줄바꿈·겹친 v·l까지 세어 게임 글보다 길 수 있어
   * 트랙 목록·편집기·상태줄의 한도 표시는 이 수로 한다. 다시 쓰기는 무거우므로 고친 뒤 잠깐 쉬었을 때 센다 (처음 열 때는 바로)
   */
  let exportCount = $state.raw<{ readonly song: Song; readonly chars: ReadonlyMap<string, number> } | undefined>(undefined);
  const exportChars = $derived(exportCount?.chars);
  $effect(() => {
    const s = song;
    const chords = chordsOf;
    const pasteLimit = profile.maxChordsPerPlayer;
    const limit = profile.charLimitPerScore;
    if (!s) {
      exportCount = undefined;
      return;
    }
    const count = () => {
      try {
        exportCount = { song: s, chars: gameCharCounts(s, chords, pasteLimit, limit) };
      } catch {
        exportCount = undefined;
      }
    };
    // 다른 곡을 열었거나 트랙이 늘고 줄면 바로 센다 (옛 곡의 수를 잠깐이라도 보이지 않게)
    const before = untrack(() => exportCount);
    const same = before !== undefined && before.song.meta === s.meta && before.song.tracks.length === s.tracks.length && before.song.tracks.every((t, k) => t.id === s.tracks[k]!.id);
    const timer = setTimeout(count, same ? EXPORT_CHARS_DELAY_MS : 0);
    return () => clearTimeout(timer);
  });
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
    if (open.length > 0) commit(setTracksNotes(open, label));
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
  /** 화면 위치(소수) → 분수. 지금 격자 칸에 있으면 그 칸 그대로(1/28 등), 아니면 1/960 칸 */
  const asRat = (time: number) => exactTime(time, division);
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
    // 편집기에 열린 트랙만 (고른 트랙 + 아래 편집기들)
    for (const id of [activeTrackId, ...extraTrackIds]) {
      const tr = song.tracks.find((x) => x.id === id);
      const span = tr ? spanAt(textTimeline(song, tr), at) : undefined;
      if (tr && span) out.set(tr.id, span);
    }
    return out;
  });
  const soundingNow = $derived(song && nowAt !== undefined ? soundingAt(song, nowAt) : undefined);
  // 위쪽 시계: 지금 템포(재생선 또는 커서 자리)와 곡 전체 길이.
  // 첫 템포보다 앞(곡 처음에 t를 적지 않은 곡)은 게임처럼 기본 t120
  const tempoNow = $derived.by(() => {
    if (!song) return undefined;
    const at = nowAt ?? 0;
    let bpm = DEFAULT_BPM;
    for (const e of normalizeTempo(song.tempo)) if (toFloat(e.at) <= at + 1e-9) bpm = e.bpm;
    return bpm;
  });
  const totalSeconds = $derived.by(() => {
    if (!song) return 0;
    let end = rat(0);
    for (const tr of song.tracks) for (const n of tr.notes) if (cmp(add(n.start, n.dur), end) > 0) end = add(n.start, n.dur);
    return positionToSeconds(song.tempo, end);
  });
  const clockNow = $derived(playing ? songSeconds : song && cursor !== undefined ? positionToSeconds(song.tempo, asRat(cursor)) : 0);

  /** restore: 실행 취소·다시 실행일 때만 true. 사라진 트랙 대신 그 전에 보던 트랙으로 돌아간다 */
  function sync(next: Song, restore = false) {
    song = next;
    // 고른 트랙이 사라지면: 실행 취소·다시 실행은 그 전에 보던 트랙으로 (새 악보를 되돌리면 첫 악보가 아니라 보던 악보·튜닝으로), 그 밖에는 첫 트랙
    if (activeTrackId !== undefined && !next.tracks.some((tr) => tr.id === activeTrackId)) {
      const live = new Set(next.tracks.map((tr) => tr.id));
      activeTrackId = (restore ? [...recentTrackIds].reverse().find((id) => live.has(id)) : undefined) ?? next.tracks[0]?.id;
    }
    canUndo = history?.canUndo ?? false;
    canRedo = history?.canRedo ?? false;
  }

  function editText(trackId: string, text: string) {
    if (!history) return;
    const track = history.song.tracks.find((tr) => tr.id === trackId);
    // 편집기가 닫히며 남은 입력을 저장할 때 그 트랙이 이미 지워졌을 수 있다
    if (!track || track.mml?.text === text || !editable(trackId) || picking) return;
    // MML 글 직접 입력은 검사하지 않는다: 쓴 글이 곧 출력이고, 입력하는 중간 글을 거절하면 타이핑이 막힌다
    commit(setTrackText(trackId, text), { unchecked: true });
  }

  /**
   * 타브 붙이기: 있는 트랙의 바뀐 음과 이 악보에 더할 새 트랙(트랙 나눔 그대로 붙인 화음)을 한 명령으로 (실행 취소 한 칸).
   * 새 트랙은 고른 트랙에 따로 정한 악기를 따른다 (타브 입력이 트랙을 더할 때와 같다)
   */
  function pasteLayers(base: Song, changes: { trackId: string; notes: Note[] }[], added: Note[][], playerId: string, label: string): Command {
    const instrument = base.tracks.find((tr) => tr.id === activeTrackId && tr.playerId === playerId)?.instrument;
    const command: Command = {
      label,
      apply(song) {
        let next = changes.length > 0 ? setTracksNotes(changes, label).apply(song) : song;
        for (const notes of added) {
          const n = next.tracks.filter((tr) => tr.playerId === playerId).length + 1;
          next = addTrackWithNotes(playerId, t("ui.newTrackName", { n }), notes, label, instrument).apply(next);
        }
        return next;
      },
      invert: (before) => ({ label, apply: () => before, invert: () => command }),
    };
    return command;
  }

  /** 새 곡의 실행 취소 기록. 모든 편집이 지나는 run에 쓸 수 없는 길이 검사(guardEdit)를 건다 */
  function newHistory(next: Song): History {
    return new History(next, guardEdit);
  }

  /**
   * 곡을 바꾸는 모든 편집의 검사 (실행 취소 기록 run 한 곳에서 부른다).
   * 결과 곡에 게임에 정확히 쓸 수 없는 길이(1/70 쉼표 등)가 새로 생기면 곡을 그대로 두고 이유를 알린다
   * (출력기가 그 조각을 버려 음이 빠지거나 당겨지지 않게)
   */
  function guardEdit(before: Song, after: Song): boolean {
    const bad = newUnwritableTrack(before, after, profile.length);
    if (bad === undefined) return true;
    const name = after.tracks.find((tr) => tr.id === bad)?.name ?? "";
    error = t("ui.unwritableEdit", { track: name, max: profile.length.max });
    return false;
  }

  /** 명령을 실행 취소 기록에 넣고 화면을 맞춘다. 검사가 거절했으면 undefined (곡은 그대로) */
  function commit(command: Command, options?: { readonly unchecked?: boolean }): Song | undefined {
    if (!history) return undefined;
    const next = history.run(command, options);
    if (history.refused) return undefined;
    sync(next);
    return next;
  }

  function editNotes(trackId: string, notes: Note[], label: string) {
    if (history && editable(trackId) && !picking) commit(setTrackNotes(trackId, notes, label));
  }

  /** MML로 내보내기 창. 열려 있는 동안 곡이 바뀌면 바로 다시 센다 */
  let outputOpen = $state(false);
  /** 내보내기 창에서 복사한 트랙 (트랙 id → 복사할 때 도장). 창을 닫았다 열어도 남고, 곡을 열면 비운다 */
  let exportCopied = $state.raw<ReadonlyMap<string, string> | undefined>(undefined);
  const output = $derived(outputOpen && song && analysis ? { rows: outputRows(song, profile, analysis), tempo: tempoAdvice(song, profile.tempo) } : undefined);
  function openOutput() {
    if (song) outputOpen = true;
  }

  /** 나누기 결과. song은 나눌 때의 곡(바뀌면 지운다), plan.song은 실제로 나눈 곡(화음을 고르게 나눴으면 옮긴 곡) */
  let split = $state.raw<{ song: Song; plan: BookPlan; locked: string } | undefined>(undefined);
  /** 잠금 상태 비교용 */
  const lockKey = (ids: Iterable<string>) => [...ids].sort().join("\n");
  /** 나누는 중이면 단계와 진행률 (0~1). 계산은 Web Worker에서 한다 */
  let splitProgress = $state<BookProgress | undefined>(undefined);
  const splitting = $derived(splitProgress !== undefined);
  const splitRunner = splitJob();
  /** 나눈 뒤 트랙 사이 음을 고르게 옮기면 권이 줄어드는지. checking이면 계산 중 */
  let fewer = $state.raw<{ song: Song; value: FewerBooks | "checking" | undefined } | undefined>(undefined);
  const booksRunner = booksJob();
  /** 나누기 요청 번호 (WAV의 wavToken과 같은 쓰임) */
  let splitToken = 0;
  /** WAV로 저장하는 중이면 진행률 (0~1). 그리기는 Web Worker에서 한다 */
  let wavProgress = $state<number | undefined>(undefined);
  /** 다 만들었지만 아직 저장하지 않은 WAV. 저장 창은 누른 직후에만 뜨므로 저장 단추를 눌러 저장한다 */
  let wavReady = $state<{ bytes: Uint8Array; name: string } | undefined>(undefined);
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

  /** 글자 수 줄이기 미리보기. 적용하면 같은 명령을 실행 취소 한 칸으로 넣는다 (화음 분산·병합은 각자 창) */
  let optimizing = $state.raw<{ before: Song; after: Song; kept?: "notes" | "tempo" } | undefined>(undefined);

  function compact() {
    if (!song) return;
    const r = compactResult(song, profile, lockedIds);
    optimizing = { before: song, after: r.song, ...(r.kept ? { kept: r.kept } : {}) };
  }

  /** 화음 분산 창 (곡 메뉴·MML로 내보내기 창). source = 처음 고를 보내는 트랙 */
  let spreadOpen = $state<{ source?: string | undefined } | undefined>(undefined);
  /** 화음 병합 창 (곡 메뉴) */
  let mergeOpen = $state(false);

  /** 분산 창의 [빈 트랙 더하기]: 그 연주자 마지막 트랙 뒤에 빈 트랙 (실행 취소 한 칸) */
  function addSpreadTrack(playerId: string) {
    if (!history) return;
    const n = history.song.tracks.filter((tr) => tr.playerId === playerId).length + 1;
    commit(addTrack(playerId, t("ui.newTrackName", { n }), t("ui.addTrack")));
  }

  /** 트랙 수가 화음 수의 배수면 트랙을 더할 때 악보가 하나 더 생긴다 (게임에서 같이 칠 사람이 한 명 는다) */
  function newScoreOnAdd(playerId: string): boolean {
    return !!song && song.tracks.filter((tr) => tr.playerId === playerId).length % chordsOf(playerId) === 0;
  }

  function applyOptimize() {
    if (!history || !song || !optimizing || optimizing.before !== song) return;
    const before = totalChars(song);
    const next = commit(compactSong(profile, undefined, lockedIds));
    if (!next) return;
    flash(t("ui.compactDone", { before, after: totalChars(next) }));
  }

  /** 곡 위치로 커서를 옮기고 피아노롤을 그 자리로 (MML로 내보내기·화음 분산·병합 창의 [그 자리로]) */
  function seekTo(at: Rat) {
    setCursor(at);
    roll?.reveal(toFloat(at));
  }

  /** 화음 분산·병합 창의 명령을 넣고 글자 수 변화를 잠깐 알린다 */
  function applyChordTool(command: Command) {
    if (!song) return;
    const before = totalChars(song);
    const next = commit(command);
    if (next) flash(t("ui.compactDone", { before, after: totalChars(next) }));
  }

  /** 미리보기 표에서 트랙 앞에 붙일 악보 이름 */
  function scoreLabel(trackId: string): string {
    const g = groups.find((x) => x.trackIds.includes(trackId));
    return g ? t("ui.scoreN", { n: g.number }) : "";
  }

  /** 나누기 단계별 진행 표시 글 */
  const SPLIT_STAGE = { spread: "ui.splitStageSpread", split: "ui.splitting", thorough: "ui.splitStageThorough" } as const;
  /** 지금 나누고 있는 곡과 그 계산에 쓴 잠금 */
  let splitTarget: Song | undefined;
  let splitLocked = "";
  async function runSplit() {
    if (!song) return;
    const target = song;
    splitTarget = target;
    split = undefined;
    splitProgress = { stage: splitPrefs.spread ? "spread" : "split", fraction: 0 };
    const token = ++splitToken;
    const request = { song: target, profile: $state.snapshot(profile) as GameProfile, spread: splitPrefs.spread, thorough: splitPrefs.thorough, locked: [...lockedIds] };
    const locked = lockKey(request.locked);
    splitLocked = locked;
    const plan = await splitRunner.run(request, (p) => {
      if (token === splitToken) splitProgress = p;
    });
    // 취소했거나 다른 나누기가 시작됐으면 버린다
    if (token !== splitToken) return;
    splitTarget = undefined;
    splitProgress = undefined;
    // 계산하는 동안 잠금이 바뀌었으면 옛 잠금으로 옮긴 결과이므로 버리고 다시 나눈다
    if (plan && song === target && lockKey(lockedIds) !== locked) return void runSplit();
    if (plan && song === target) {
      split = { song: target, plan, locked };
      // 화음을 고르게 나누지 않았을 때만: 나눈 뒤 옮기면 줄어드는지 따로 알려 준다
      if (!request.spread) void checkFewer(target, plan.result.parts.length);
    }
  }

  /** 나눈 결과보다 권을 줄일 수 있는지 뒤에서 따로 계산한다 (나누기 결과는 먼저 보여 준다) */
  async function checkFewer(target: Song, books: number) {
    fewer = undefined;
    if (books < 2) return;
    fewer = { song: target, value: "checking" };
    const locked = lockKey(lockedIds);
    const value = await booksRunner.run({ song: target, profile: $state.snapshot(profile) as GameProfile, books, locked: [...lockedIds] });
    // 잠금이 바뀌었으면 쓰지 않는다 (다시 나누면서 새로 계산한다)
    if (fewer?.song === target && lockKey(lockedIds) === locked) fewer = { song: target, value };
  }

  /** 트랙 사이 음을 고르게 옮기고(실행 취소 한 칸) 다시 나눈다 */
  function applyFewer(limit: number) {
    if (!history || !song) return;
    booksRunner.cancel();
    fewer = undefined;
    // 적용할 때의 잠금으로 다시 옮긴다 (계산한 뒤 잠금이 바뀌었어도 잠근 트랙은 건드리지 않는다)
    if (commit(distributeSong(profile, t("ui.splitFewerUndo"), limit, lockedIds))) void runSplit();
  }
  function cancelSplit() {
    booksRunner.cancel();
    splitToken++;
    splitTarget = undefined;
    splitRunner.cancel();
    splitProgress = undefined;
  }
  // 나눈 뒤나 나누는 중에 트랙 잠금이 바뀌면 다시 나눈다: 화음 분산 결과가 잠금에 따라 달라진다
  // (나누는 중이면 옛 잠금의 계산은 멈추고 새로 시작한다)
  $effect(() => {
    const now = lockKey(lockedIds);
    untrack(() => {
      const stale = (split && split.song === song && split.locked !== now) || (splitTarget && splitTarget === song && splitLocked !== now);
      if (stale) void runSplit();
    });
  });
  // 나누는 동안 곡이 바뀌면 (편집·열기) 계산을 멈춘다: 결과가 옛 곡 것이라 쓸 수 없다
  $effect(() => {
    const now = song;
    untrack(() => {
      if (splitTarget && now !== splitTarget) cancelSplit();
    });
  });

  function undo() {
    if (history && !picking) sync(history.undo(), true);
  }

  function redo() {
    if (history && !picking) sync(history.redo(), true);
  }

  async function onOpen(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) await openPicked(file);
  }

  /** 악보 열기. 열기 창을 띄울 수 있는 브라우저(PC 크롬·엣지)는 연 프로젝트 파일을 기억해 다음 저장에서 바로 쓴다 */
  async function openScoreFile() {
    if (!canOpenFile) return openInput.click();
    const picked = await pickOpenFile(SCORE_EXTENSIONS);
    if (picked === "cancelled") return;
    if (!picked) return openInput.click();
    // 프로젝트가 아닌 파일(.mml·.mmi·.mid 등)은 기억하지 않는다: 저장할 때 그 파일을 프로젝트로 덮어쓰지 않게
    const isProject = PROJECT_EXTENSIONS.some((ext) => picked.file.name.toLowerCase().endsWith(ext));
    await openPicked(picked.file, isProject ? picked.handle : undefined);
  }

  /** 고른 파일을 연다. handle: 다시 쓸 수 있는 프로젝트 파일 */
  async function openPicked(file: File, handle?: FileSystemFileHandle) {
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
      openSong(result.song, file.name, handle);
      if (result.editor) {
        applyEditor(parseEditorState(result.editor, result.song));
        notices = [...result.diagnostics, ...fitNotices()];
      } else offerOffgrid(result.song);
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
    // 튜닝을 적지 않은 옛 파일은 기본 튜닝으로 연다 (앞 곡의 튜닝·카포를 이어 쓰지 않는다)
    tuningName = state.tuning ?? "standard";
    capo = state.capo ?? 0;
    // 1.0.0-beta.8 파일은 악보별 튜닝을 화면 상태에 적었다: 연 곡의 악보로 옮긴다 (막 연 곡이라 실행 취소 기록 없이)
    const old = state.scoreTunings;
    if (history && old && Object.keys(old).length > 0) {
      const next = { ...history.song, players: history.song.players.map((p) => (Object.hasOwn(old, p.id) && !p.tab ? { ...p, tab: old[p.id]! } : p)) };
      history = newHistory(next);
      sync(next);
    }
    // 파일에 적힌 튜닝을 되살린 것은 고친 것이 아니다: 연 그대로의 상태로 다시 잡는다
    autosaved.reset(autosaveState());
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
        ? { name: videoName, opacity: video.opacity, offset: video.offset, fit: video.fit, low: video.low, high: video.high, keyLine: video.keyLine, stretch: video.stretch, ...(video.fill === false ? { fill: false } : {}), ...(video.speed ? { speed: video.speed } : {}) }
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

  /** 지금 곡의 프로젝트 파일 (저장 창으로 저장했거나 열기 창으로 연 .mme). 있으면 다음 저장에서 창 없이 바로 쓴다 */
  let projectFile: FileSystemFileHandle | undefined;

  /** 되살린 곡의 이름을 믿을 수 없다 (자동 보존 기록과 저장한 이름이 어긋남). 다음 저장은 이름 없는 곡처럼 덮어쓰지 않는다 */
  let nameUnsure = false;

  /**
   * 지금 곡의 저장한 이름과 프로젝트 파일을 바꾸고, 새로고침 뒤 복구해도 이어 쓰게 작업 id로 적어 둔다.
   * name이 없으면 (저장한 적 없는 곡) 적어 둔 것을 지운다
   */
  function setProjectFile(file: FileSystemFileHandle | undefined, name?: string) {
    projectFile = file;
    rememberProjectFile(workId, name ? { name, ...(file ? { file } : {}) } : undefined).catch(() => {});
  }

  /** 프로젝트로 저장한다. saveAs: 다른 이름으로 저장 (언제나 저장 창) */
  function saveProject(saveAs = false) {
    if (!song) return;
    // 편집기에 아직 반영 안 된 입력까지 넣고 저장한다
    flushAllEditors();
    const current = history?.song ?? song;
    const editor = editorState();
    const name = `${baseName()}${PROJECT_EXTENSION}`;
    const fresh = !fileName || nameUnsure;
    const work = workId;
    void saveProjectFile(new TextEncoder().encode(writeProject(current, { editor: { ...editor }, app: APP_VERSION })), name, { file: projectFile, saveAs, fresh }).then((saved) => {
      const { outcome } = saved;
      report(saved, name, fresh);
      if (saved.directFailed) {
        const was = projectFile?.name ?? name;
        if (outcome === "written") error = t("ui.saveDirectFailedPicked", { name: was });
        else if (outcome === "downloaded") error = t("ui.saveDirectFailedDownloaded", { name: was });
        else if (outcome === "cancelled") error = t("ui.saveDirectFailedCancelled", { name: was });
      }
      // 저장하는 사이 다른 곡을 열었으면 그 곡의 이름·파일은 건드리지 않는다
      if (work === workId) {
        // 폴더·저장 창에 쓴 이름을 이 곡의 이름으로 삼는다: 다시 저장하면 그 파일을 덮어쓰고, 다른 형식도 같은 이름을 쓴다
        // (다운로드·공유는 실제 이름을 알 수 없어 그대로 둔다)
        if (outcome === "written" && saved.name) {
          fileName = saved.name;
          nameUnsure = false;
          // 저장 창·바로 쓰기로 쓴 파일은 기억하고, 폴더에 쓴 것은 (파일 핸들이 없어) 기억한 파일을 버린다. 이름은 언제나 적어 둔다
          setProjectFile(saved.file, saved.name);
          if (!saved.directFailed && !renamedInFolder(saved, name, fresh)) flash(t("ui.savedTo", { name: saved.name }));
        } else if (saved.directFailed) setProjectFile(undefined, fileName);
      }
      // 폴더에 썼거나 공유 창에서 보냈으면 저장을 확인한 것: 자동 보존이 안 돼도 이 곡·편집 상태로는 새 판으로 바꿀 수 있다
      if (work !== workId) return;
      // 쓰지 못해 다운로드로 물러났거나 기억한 파일에 바로 쓰지 못했으면 전에 확인한 저장도 믿지 않는다
      // (저장 창에서 고른 그 파일은 이미 비었을 수 있고, 기억한 파일은 지워졌을 수 있다)
      projectSaved = confirmedSave(projectSaved, saved, { song: current, editor: editorStateKey(editor) });
    });
    notices = [];
    offerUtf8 = false;
  }

  /** 프로젝트 파일로 저장한 것이 확인된 곡과 그때의 편집 상태(원곡·영상 맞춤 등, 파일에 함께 들어간다).
   *  다운로드는 끝났는지 알 수 없어 넣지 않는다 */
  let projectSaved = $state.raw<{ song: Song; editor: string } | undefined>(undefined);

  /** 지금 곡과 편집 상태가 확인된 프로젝트 저장과 같은지 */
  function savedAsProject(): boolean {
    return !!history && !!projectSaved && history.song === projectSaved.song && editorStateKey(editorState()) === projectSaved.editor;
  }

  // 창 제목에 작업 중인 파일 이름. 프로젝트로 저장한 뒤 고친 곳이 있으면 ● (저장한 적 없는 곡은 표시하지 않는다)
  $effect(() => {
    document.title = windowTitle(fileName, !!song, !!projectSaved && !savedAsProject());
  });

  /** 새 판으로 바꾸는 동안 화면 입력과 MIDI 건반 입력을 막는다 */
  function lockForUpdate(on: boolean) {
    document.body.inert = on;
    document.body.style.cursor = on ? "wait" : "";
    midiKeys.paused = on;
  }

  /** 자동 보존을 이만큼 기다려도 끝나지 않으면 실패로 본다 (막은 화면이 풀리지 않는 일이 없게) */
  const UPDATE_SAVE_WAIT_MS = 15_000;
  /** 고친 뒤 이만큼 쉬면 내보낼 때 글자 수를 다시 센다 */
  const EXPORT_CHARS_DELAY_MS = 300;

  /**
   * 새 판으로 바꾸기 전: 화면 입력을 막고, 편집 중인 입력을 넣고 자동 보존한다. 막은 뒤라 기다리는 동안
   * 새 입력이 생기지 않는다.
   * - 저장되면(또는 자동 보존은 실패했지만 지금 곡·편집 상태를 프로젝트 파일로 저장한 것이 확인됐으면) 새로고침하기로
   *   정한 것이다. 되돌리지 않고 새로고침까지 막은 채로 둔다. 새 판 전환이 오지 않아도 applyUpdate가 직접 새로고침한다
   *   (새로고침 뒤 새 판이 아직 기다리면 안내가 다시 뜬다). 막은 뒤에는 고칠 수 없으므로 잃는 입력이 없다.
   *   바꾸기는 한 번에 하나라(applyUpdate), 막고 푸는 것은 지금 하는 바꾸기만 한다.
   * - 아니면 막은 것을 풀고 거부해 새로고침을 멈춘다. 이때는 새 판 전환을 요청하지 않았다
   */
  async function beforeUpdate(): Promise<void> {
    lockForUpdate(true);
    const save = () =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("autosave timeout")), UPDATE_SAVE_WAIT_MS);
        flushAutosave().then(resolve, reject).finally(() => clearTimeout(timer));
      });
    try {
      // 막기 전에 친 글·누른 건반(아직 반영 대기 중)까지 넣는다
      midiKeys.flushPending();
      flushAllEditors();
      await save();
      // 저장을 기다리는 사이 반영된 것이 있으면 한 번 더 적는다
      flushAllEditors();
      if (autosaved.dirty(autosaveState())) await save();
    } catch (e) {
      flushAllEditors();
      if (!savedAsProject()) {
        lockForUpdate(false);
        throw e;
      }
    }
  }

  /** 자동 보존이 계속 안 될 때: 묻고 나서 저장 없이 새 판으로 바꾼다 */
  function reloadWithoutSaving() {
    if (pwa.applying) return;
    // 저장은 건너뛰지만 막기·직접 새로고침은 다른 바꾸기와 같다 (바꾸는 동안 친 것이 사라지지 않게)
    if (confirm(t("ui.updateReloadAnywayConfirm")))
      void applyUpdate(() => {
        lockForUpdate(true);
      });
  }

  /**
   * 자동 보존이 비교하는 상태: 곡과 타브 튜닝(곡 밖 편집 상태). 튜닝·카포만 바꿔도 다시 적는다.
   * 트랙 고르기·보기 방식 같은 다른 화면 상태만 바뀐 것으로는 새 기록을 만들지 않는다
   */
  type AutosaveState = WorkAutosave<Song>;
  const tabsKey = $derived(editorStateKey({ tuning: tuningName, capo }));
  function autosaveState(current: Song | undefined = history?.song, name: string = fileName): AutosaveState | undefined {
    return current ? { song: current, tabs: tabsKey, name } : undefined;
  }

  // 작업 자동 보존: 곡을 열거나 새로 만들 때마다 새 작업 id. 고친 뒤에만 적는다.
  // 롤·타브 보기도 이 값이 바뀔 때(곡을 열 때만) 새로 만든다 (옛 곡의 커서·보던 자리가 남지 않게)
  let workId = $state(newWorkId());
  /**
   * 보기 세대 번호: 곡을 열 때마다 1씩 (같은 작업을 다시 되살려도). 롤·타브 보기를 새로 만들고({#key}),
   * 옛 보기가 늦게 알린 자리·커서를 버리는 데 쓴다. workId는 자동 보존·프로젝트 파일 기억에만 쓴다
   */
  let viewGen = $state(0);
  /** 이 작업으로 저장에 성공한 곡 (아직 안 적었으면 연 그대로의 곡). 이것과 같으면 적을 것이 없다.
   *  실행 취소로 연 그대로 돌아와도 이미 적은 기록이 있으면 그 기록을 지금 상태로 고쳐 적는다.
   *  저장이 실패하면 적지 않은 것으로 남아 다음 기회에 다시 적는다 */
  const autosaved = new AutosaveTracker<AutosaveState>(sameAutosave);
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  /** 보낸 순서대로 적고, 실패하면 거부로 알린다 (업데이트 새로고침이 저장 실패를 성공으로 보지 않게) */
  const autosaveQueue = new AutosaveQueue(autosaved);
  let works = $state.raw<readonly WorkSummary[]>([]);
  let recoverOpen = $state(false);

  async function refreshWorks() {
    works = await listWorks();
  }
  void refreshWorks();
  // 홈 화면에 설치해 쓰면 묻지 않고도 지속 공간을 주는 브라우저가 많다 (iPad 홈 화면 앱 등)
  if (typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches) void requestPersistentStorage();
  else void checkStorage();

  /**
   * 바뀐 곡을 자동 보존에 적는다. 돌려준 약속은 지금 곡이 적히면(또는 이미 진행 중인 그 저장이 성공하면) 풀리고,
   * 적지 못하면 거부된다
   */
  function flushAutosave(): Promise<void> {
    clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
    return autosaveQueue.flush(autosaveState(), ({ song: current, name }) => {
      const record = {
        id: workId,
        savedAt: Date.now(),
        fileName: name,
        title: current.meta.title,
        trackCount: current.tracks.length,
        noteCount: current.tracks.reduce((sum, tr) => sum + tr.notes.length, 0),
        project: writeProject(current, { editor: { ...editorState() }, app: APP_VERSION }),
      };
      // 보낸 순서대로 적는다: 늦게 끝난 앞 저장이 뒤 저장을 덮지 않게
      return () => saveWork(record);
    });
  }

  $effect(() => {
    const now = autosaveState(song);
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
      // 아이패드·폰에서 앱을 나가면(홈으로, 다른 앱으로, 전원 버튼) 재생을 멈춘다. 그대로 두면 안 보이는 채로
      // 곡 끝까지 소리가 났다. PC는 다른 탭을 보며 들을 수 있게 둔다
      if (navigator.maxTouchPoints > 0) stop();
    };
    const onpagehide = () => {
      flushAllEditors();
      flushAutosave().catch(() => {});
      stop();
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
      // 그 작업의 프로젝트 파일이 기억돼 있으면 다시 바로 쓴다 (처음 저장할 때 쓰기 허락을 다시 묻는다).
      // 자동 보존 기록의 이름과 저장할 때 적어 둔 이름이 어긋나면 어느 파일에도 덮어쓰지 않게 이름을 믿지 않는다
      const stored = await recallProjectFile(id);
      const restored = stored === "unknown" ? { file: undefined, unsure: !!record.fileName } : restoreWorkFile(record.fileName, stored, (f) => f.name);
      if (workId === id) {
        projectFile = restored.file;
        nameUnsure = restored.unsure;
      }
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
    rememberProjectFile(id, undefined).catch(() => {});
    await refreshWorks();
  }

  /** 곡을 연다. file: 다시 쓸 수 있는 프로젝트 파일 (없으면 앞 곡의 파일을 버린다) */
  function openSong(next: Song, name: string, file?: FileSystemFileHandle) {
    // 녹음 중이면 앞 곡에 넣고 끝낸다 (준비 중이면 취소). 남겨 두면 정지 감지가 새 곡에 넣는다
    endRecording();
    // 앞 곡에서 찍다 만 탭은 버린다. 남겨 두면 정지 감지가 새 곡 템포를 바꾼다
    clearTaps();
    tapResult = "";
    tapReview = undefined;
    // 영상 마디의 결과·파형 맞추기 제안도 앞 곡 것이라 버린다 (찾은 마디 시각은 영상 것이라 둔다)
    videoBarsResult = "";
    videoBarsReview = undefined;
    stop();
    error = "";
    notices = [];
    offerUtf8 = false;
    // 앞 곡 편집기에 남은 입력과 자동 보존을 먼저 적고, 새 곡은 새 작업으로
    flushAllEditors();
    flushAutosave().catch(() => {});
    workId = newWorkId();
    projectSaved = undefined;
    nameUnsure = false;
    setProjectFile(file, file ? name : undefined);
    savedFits = {};
    trackView = {};
    // 새 곡은 기본 튜닝으로 시작한다. 프로젝트 파일이면 applyEditor가 적힌 튜닝으로 다시 잡는다
    tuningName = "standard";
    capo = 0;
    autosaved.reset(autosaveState(next, name));
    history = newHistory(next);
    sync(next);
    activeTrackId = next.tracks[0]?.id;
    fileName = name;
    flash("");
    resetSongView();
    midiKeys.dropPending();
  }

  /**
   * 곡을 열 때 새 곡에 남으면 안 되는 상태는 여기에 더한다 (모든 곡 열기 길이 openSong을 지난다).
   * 보기 세대 번호를 올려 롤·타브 보기를 새로 만들고, 보기를 바꿀 때 이어 보던 자리·확대·타브 커서 기억,
   * 재생 위치·반복 구간, 고른 템포·마커와 열린 창, 옛 트랙 id를 가리키는 상태를 비운다 (목록은 songView.ts).
   * 보기 방향·편집기 수·화면 배치·음량·키맵처럼 곡과 상관없는 설정은 그대로 둔다
   */
  function resetSongView() {
    const fresh = freshSongView(viewGen);
    viewGen = fresh.viewGen;
    cursor = fresh.cursor;
    cursorExact = fresh.cursorExact;
    loop = fresh.loop;
    loopStash = fresh.loopStash;
    tabCursor = fresh.tabCursor;
    pickedEvent = fresh.pickedEvent;
    eventEdit = fresh.eventEdit;
    reveal = fresh.reveal;
    laneExtra = fresh.laneExtra;
    extraChosen = [...fresh.extraChosen];
    extraStamps = [...fresh.extraStamps];
    arpeggio = fresh.arpeggio;
    slide = fresh.slide;
    grace = fresh.grace;
    trill = fresh.trill;
    labDialog = fresh.labDialog;
    reverbDialog = fresh.reverbDialog;
    loudnessOpen = fresh.loudnessOpen;
    transposing = fresh.transposing;
    voicing = fresh.voicing;
    tempoChangeOpen = fresh.tempoChangeOpen;
    tempoRampOpen = fresh.tempoRampOpen;
    offgridOpen = fresh.offgridOpen;
    meterOpen = fresh.meterOpen;
    split = fresh.split;
    compactNote = fresh.compactNote;
    exportCopied = fresh.exportCopied;
    Object.assign(viewMemory, emptyViewMemory());
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
    const next = commit(addTrack(activePlayer.id, t("ui.newTrackName", { n }), t("ui.addTrack")));
    if (!next) return;
    activeTrackId = next.tracks.find((tr) => !s.tracks.some((o) => o.id === tr.id))?.id ?? activeTrackId;
  }

  function addNewPlayer(canonical: string) {
    if (!history) return;
    const s = history.song;
    const next = commit(addPlayer(canonical, freshScoreName(s, canonical), t("ui.newTrackName", { n: 1 }), t("ui.addPlayer")));
    if (!next) return;
    activeTrackId = next.tracks.find((tr) => !s.tracks.some((o) => o.id === tr.id))?.id ?? activeTrackId;
  }

  /** 바뀌는 게 있을 때만 실행한다 (제자리 옮기기가 실행 취소 기록에 빈 단계로 남지 않게) */
  function runIfChanged(command: Command): Song | undefined {
    if (!history || command.apply(history.song) === history.song) return undefined;
    return commit(command);
  }

  function deleteTrack(track: Track) {
    if (!history) return;
    if (track.notes.length > 0 && !confirm(t("ui.removeTrackConfirm", { name: track.name }))) return;
    const s = history.song;
    const index = s.tracks.findIndex((tr) => tr.id === track.id);
    const wasActive = activeTrackId === track.id;
    const next = commit(removeTrack(track.id, t("ui.removeTrack")));
    if (!next) return;
    // 고르던 트랙을 지우면 그 자리 이웃 트랙을 고른다 (sync가 첫 트랙으로 바꾸기 전 값으로 판단)
    if (wasActive) activeTrackId = next.tracks[Math.min(index, next.tracks.length - 1)]?.id;
  }

  function appendPasted(other: Song) {
    if (!history) return openSong(other, "");
    // 붙여 넣은 MML 글을 새 악보로 더한다: 글 그대로 출력되는 것은 새로 열기와 같아서 검사하지 않는다
    const next = commit(appendSong(other), { unchecked: true });
    if (!next) return;
    activeTrackId = next.tracks[next.tracks.length - other.tracks.length]?.id ?? activeTrackId;
    split = undefined;
  }

  /** 편집 칸 밖에서 MML@ 글을 붙여넣으면 붙여넣기 창을 연다 */
  function onPaste(event: ClipboardEvent) {
    if (picking) return;
    if (showKeymap || paste || midi || settings || meterOpen || tupletOpen || eventEdit || addScoreOpen) return;
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

  /** 사운드팩을 한 칸 위(-1)나 아래(+1)로. 저장해 둔 순서도 함께 바꾼다 */
  function movePack(id: string, step: -1 | 1) {
    const list = [...engine.registry.list];
    const i = list.findIndex((p) => p.id === id);
    const j = i + step;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    engine.setPackOrder(list.map((p) => p.id));
    packs = [...engine.registry.list];
    void savePackOrder(packs.map((p) => p.label));
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
  void loadSaveTarget();

  /** 끄기·솔로는 듣는 방법이라 실행 취소 기록에 넣지 않는다 */
  function updateTrack(id: string, change: Partial<Pick<Track, "mute" | "solo">>) {
    if (!history) return;
    const current = history.song;
    sync(history.amend({ ...current, tracks: current.tracks.map((tr) => (tr.id === id ? { ...tr, ...change } : tr)) }));
    // 재생 중이면 바뀐 트랙 구성으로 처음부터 다시 재생한다 (이어 재생은 커서가 생기면)
    if (playing) void play();
  }

  // MIDI 건반 입력: 커서 자리에 격자 길이로 넣고 커서를 민다. 함께 누른 건반은 하나를 뗄 때 화음 하나로 넣는다
  const midiKeys = new MidiKeys({
    previewOn: (pitch, velocity) => {
      const track = song?.tracks.find((tr) => tr.id === activeTrackId);
      const inst = song && track ? trackInstrument(song, track) : { canonical: "piano" };
      engine.previewOn(inst.canonical, inst.program, pitch, velocity, profile, inst.packId).catch(() => {
        // 오디오를 못 켜도 악보 입력은 이어 간다
      });
    },
    previewOff: (pitch) => engine.previewOff(pitch),
    chord: (chord) => placeMidiChord(chord),
    unsupported: () => (error = t("ui.midiKeysUnsupported")),
    askVelocity: () => confirm(t("ui.midiKeysVelocityAsk")),
  });
  // 화면이 사라질 때도 MIDI 연결·대기 입력·울리는 음을 정리한다
  $effect(() => () => midiKeys.stop());

  function placeMidiChord(chord: { pitches: number[]; velocity: number }) {
    if (!history || !activeTrackId || !editable(activeTrackId) || picking) return;
    const s = history.song;
    const active = s.tracks.find((tr) => tr.id === activeTrackId);
    if (!active) return;
    // 커서(타브 보기면 타브 커서)가 없으면 고른 트랙의 마지막 음 뒤
    const at = stepCursor() ?? notesEnd(active.notes);
    const dur = newNoteDur;
    const useVelocity = midiKeys.velocity;
    const limit = maxChordsOf(profile, s.players.find((p) => p.id === active.playerId)?.instrument.canonical);
    // 잠긴 트랙은 건너뛰고, 다음 트랙이 모자라면 악보 트랙 한도까지 트랙을 더한다
    const plan = placeChord(
      s,
      groups,
      activeTrackId,
      at,
      dur,
      chord,
      (notes, where, vel) => (useVelocity ? volumeForVelocity(profile, vel) : previousVolume(notes, where)),
      limit,
      lockedIds,
    );
    if (plan.changes.length === 0 && plan.newTracks.length === 0) return;
    const command = setTracksNotesAddingTracks(
      active.playerId,
      plan.changes,
      plan.newTracks,
      (n) => t("ui.newTrackName", { n }),
      t("ui.midiKeysInput"),
      active.instrument,
    );
    if (!commit(command)) return;
    moveStepCursor(add(at, dur));
    if (plan.dropped > 0) error = t("ui.midiChordFull", { limit, n: plan.dropped });
  }

  /** MIDI 건반 스텝 입력 자리: 타브 보기면 타브 커서, 아니면 편집 커서. 없으면 undefined */
  function stepCursor(): Rat | undefined {
    return stepCursorFor(viewMode === "tab" ? "tab" : "roll", viewMode === "tab" ? tabCursorForCommand() : undefined, editCursor());
  }
  /** 스텝 입력 뒤 커서를 민다. 타브 보기면 타브 커서를 (롤 커서는 그대로) */
  function moveStepCursor(at: Rat) {
    if (viewMode === "tab" && tab) tab.moveCursorTo(at);
    else setCursor(at);
  }

  /**
   * MIDI 건반 스텝 입력 키: 1~6 = 온음표~32분, 7 = 8분 셋잇단(l12), 8 = 16분 셋잇단(l24), 0 = 쉼표(커서를 새 음 길이만큼 민다).
   * 게임이 받지 않는 길이면 바꾸지 않고 알린다. 처리했으면 true
   */
  function midiStepKey(key: string): boolean {
    const length = midiStepLength(key);
    if (length === undefined) return false;
    if (length === "rest") {
      midiStepRest();
      return true;
    }
    if (!noteLengths.includes(length)) error = t("ui.midiStepLengthRefused", { n: length });
    else noteLength = length;
    return true;
  }
  /** 쉼표: 기다리던 화음을 먼저 넣고, 커서(없으면 고른 트랙 끝)를 새 음 길이만큼 민다 */
  function midiStepRest() {
    midiKeys.flushPending();
    const active = song?.tracks.find((tr) => tr.id === activeTrackId);
    if (!active) return;
    const at = stepCursor() ?? notesEnd(active.notes);
    moveStepCursor(add(at, newNoteDur));
  }

  // MIDI 건반 녹음 (실험실): 커서가 있는 마디부터 한 마디 예비박 뒤 재생하며 친 건반을 모아, 멈추면 격자에 맞춰 넣는다
  const RECORD_GRIDS = [8, 12, 16, 24, 32] as const;
  const RECORD_SPEEDS = [1, 0.75, 0.5] as const;
  const RECORD_KEY = "mmlce.midiRecord";
  const recordPrefs = $state(
    loadStored(RECORD_KEY, (raw) => {
      try {
        const v = raw ? (JSON.parse(raw) as { grid?: number; speed?: number; metronome?: boolean; mode?: string; addTracks?: boolean }) : {};
        return {
          grid: RECORD_GRIDS.includes(v.grid as (typeof RECORD_GRIDS)[number]) ? (v.grid as number) : 16,
          speed: typeof v.speed === "number" && v.speed >= 0 && v.speed < RECORD_SPEEDS.length ? Math.floor(v.speed) : 0,
          metronome: v.metronome !== false,
          mode: (v.mode === "replace" ? "replace" : "overdub") as RecordMode,
          addTracks: v.addTracks !== false,
        };
      } catch {
        return { grid: 16, speed: 0, metronome: true, mode: "overdub" as RecordMode, addTracks: true };
      }
    }),
  );
  function setRecordPref(change: Partial<typeof recordPrefs>) {
    Object.assign(recordPrefs, change);
    saveStored(RECORD_KEY, JSON.stringify(recordPrefs));
  }
  let recordOpen = $state(false);
  let recordResult = $state("");
  const recorder = new MidiRecorder({ heardSeconds: () => engine.heardSeconds(), click: (at, accent) => engine.click(at, accent) });
  let recordStatus = $state<RecordStatus | undefined>(undefined);
  recorder.onstatus = (status) => {
    recordStatus = status;
    if (!status) recordLive = [];
  };
  /**
   * 녹음할 트랙: 녹음 줄에서 고른 트랙들. 고른 트랙이 없거나 다른 악보 트랙만 있으면 지금 트랙과 그 뒤 트랙들 (recordTarget).
   * 보기 상태라 곡·기록에 넣지 않는다
   */
  let recordArmed = $state.raw<ReadonlySet<string> | undefined>(undefined);
  const recordLimitOf = (s: Song, trackId: string | undefined) => {
    const track = s.tracks.find((tr) => tr.id === trackId);
    return maxChordsOf(profile, s.players.find((p) => p.id === track?.playerId)?.instrument.canonical);
  };
  const recordTargetNow = $derived(song ? recordTarget(song, groups, activeTrackId, recordArmed, lockedIds, recordLimitOf(song, activeTrackId), recordPrefs.addTracks) : undefined);
  /** 녹음 줄에 보일 트랙 단추: 고른 트랙이 든 악보의 트랙들 (악보 안 번호와 이름) */
  const recordTargets = $derived.by(() => {
    const target = recordTargetNow;
    if (!song || !target) return [];
    return target.groupTrackIds.map((id, k) => {
      const track = song!.tracks.find((tr) => tr.id === id);
      return { id, label: track?.name ? `${k + 1} ${track.name}` : String(k + 1), armed: target.trackIds.includes(id), locked: lockedIds.has(id) };
    });
  });
  /** 녹음 줄에서 트랙 하나를 녹음할 트랙에 넣거나 뺀다 (지금 정해진 트랙에서 시작) */
  function toggleRecordArm(trackId: string) {
    const target = recordTargetNow;
    if (!target || lockedIds.has(trackId)) return;
    const next = new Set(target.trackIds);
    if (next.has(trackId)) next.delete(trackId);
    else next.add(trackId);
    // 하나는 남긴다 (모두 빼면 저절로 정하는 트랙으로 돌아가 단추가 그대로 보여 헷갈린다)
    if (next.size > 0) recordArmed = next;
  }
  /** 녹음 중 친 음이 들어갈 모양 (치는 대로 롤·타브에 미리 보인다. 넣는 것과 같은 assignTake 결과라 보이는 대로 들어간다) */
  let recordLive = $state.raw<readonly RecordGhost[]>([]);
  /** 녹음 중인 녹음의 넣을 곳 (시작할 때 정한 것) */
  let recordTargetActive: RecordTarget | undefined;
  /** 모은 건반을 넣을 모양으로: 격자 맞추기 → 트랙 나누기. 미리 보기와 넣기가 같이 쓴다 */
  function assignRecord(s: Song, target: RecordTarget, take: { from: Rat; keys: TakeKey[] }) {
    const grid = rat(1, recordPrefs.grid);
    const notes = quantizeTake(take.keys, grid, take.from);
    const useVelocity = midiKeys.velocity;
    const live = {
      ...target,
      // 녹음 중에 지워지거나 잠긴 트랙에는 넣지 않는다
      trackIds: target.trackIds.filter((id) => s.tracks.some((tr) => tr.id === id) && !lockedIds.has(id)),
    };
    const assign = assignTake(s, live, notes, grid, recordPrefs.mode, (track, where, vel) => (useVelocity ? volumeForVelocity(profile, vel) : previousVolume(track, where)));
    return { notes, assign };
  }
  recorder.onlive = () => {
    const live = recorder.live();
    const target = recordTargetActive;
    recordLive = live && target && history ? takeGhosts(assignRecord(history.song, target, live).assign, colors) : [];
  };
  // 재생이 멈추는 그 순간의 자리로 누르고 있던 건반을 닫는다 (멈춘 뒤 고치는 effect는 늦다)
  engine.onStopping = (heard) => recorder.cut(heard);
  // 사운드팩이 없어도 녹음한다 (곡 소리 없이 메트로놈만). 넣을 트랙이 하나도 없으면(모두 잠김, 더할 수도 없음) 시작하지 않는다
  const canRecord = $derived(!!song && !!recordTargetNow && (recordTargetNow.trackIds.length > 0 || recordTargetNow.room > 0) && !picking);

  const recordFlow = new RecordFlow<History, RecordTarget>(recorder, {
    owner: () => history,
    open: () => recordOpen && labs.on,
    play: async () => {
      const job = recordStart;
      if (!job) return undefined;
      const started = await playback.play(job.song, toFloat(job.from), undefined, job.rate, undefined, { leadIn: countIn(job.song, job.from).seconds / job.rate });
      return started && playback.playing ? playback.runs : undefined;
    },
    stop: () => stop(),
    capture: (on) => (midiKeys.capture = on ? { on: (p, v) => recorder.keyOn(p, v), off: (p) => recorder.keyOff(p) } : undefined),
    apply: (take, job) => applyRecord(take, job),
    lost: () => (recordResult = t("ui.midiRecordLost")),
  });
  /** 시작할 녹음의 곡·자리·속도 (recordFlow.play가 쓴다) */
  let recordStart: { song: Song; from: Rat; rate: number } | undefined;

  async function startRecord() {
    const target = recordTargetNow;
    if (!history || !target || !canRecord) return;
    midiKeys.flushPending();
    const s = history.song;
    const from = measureStart(s.timeSig, stepCursor() ?? ZERO);
    recordStart = { song: s, from, rate: RECORD_SPEEDS[recordPrefs.speed] ?? 1 };
    recordResult = "";
    recordTargetActive = target;
    await recordFlow.start(target, s, from, recordPrefs.metronome);
  }

  /** 녹음을 지금 끝낸다 (준비 중이면 취소, 녹음 중이면 시작한 곡에 넣는다). 곡 바꾸기 전·줄 닫기·실험실 끄기가 부른다 */
  function endRecording() {
    recordFlow.end();
  }

  /** 모은 건반을 미리 보인 그대로 넣는다 (실행 취소 한 번). 곡을 바꾸는 길은 여기 commit 하나 */
  function applyRecord(take: { from: Rat; keys: TakeKey[] }, job: RecordJob<History, RecordTarget>) {
    recordTargetActive = undefined;
    recordLive = [];
    if (!history) return;
    const s = history.song;
    if (!s.players.some((p) => p.id === job.target.playerId) && !s.tracks.some((tr) => tr.playerId === job.target.playerId)) {
      recordResult = t("ui.midiRecordLost");
      return;
    }
    const { notes, assign } = assignRecord(s, job.target, take);
    if (notes.length === 0) {
      recordResult = t("ui.midiRecordEmpty");
      return;
    }
    const first = assign.lanes.find((l) => l.trackId !== undefined);
    const instrument = s.tracks.find((tr) => tr.id === first?.trackId)?.instrument;
    const limit = recordLimitOf(s, first?.trackId ?? job.target.trackIds[0]);
    const dropped = assign.dropped.length;
    const { changes, newTracks } = planChanges(assign);
    if (changes.length === 0 && newTracks.length === 0) {
      recordResult = assign.lanes.length === 0 ? t("ui.midiRecordLost") : t("ui.midiChordFull", { limit, n: dropped });
      return;
    }
    const command = setTracksNotesAddingTracks(job.target.playerId, changes, newTracks, (n) => t("ui.newTrackName", { n }), t("ui.labMidiRecord"), instrument);
    if (!commit(command)) return;
    recordResult = t("ui.midiRecordDone", { n: notes.length - dropped }) + (dropped > 0 ? " · " + t("ui.midiChordFull", { limit, n: dropped }) : "");
  }
  // 정지·다른 재생(자리 옮기기 등)이면 녹음을 끝내고 넣는다
  $effect(() => {
    const running = playing;
    const run = playback.runs;
    const status = recordStatus;
    if (status && (!running || run !== status.run)) untrack(() => recordFlow.finish());
  });
  $effect(() => {
    if (!labs.on && recordOpen) untrack(() => closeRecord());
  });
  /** 녹음 단축키: 녹음 중(준비 중 포함)이면 멈추고 넣기, 아니면 녹음 시작 (건반이 연결돼 있을 때) */
  function toggleRecording() {
    if (recordFlow.busy) return endRecording();
    if (midiKeys.status && canRecord) void startRecord();
  }
  function toggleRecord() {
    if (recordOpen) return closeRecord();
    recordOpen = true;
    recordResult = "";
  }
  function closeRecord() {
    endRecording();
    recordOpen = false;
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
    engine.previewOn(inst.canonical, inst.program, pitch, 100, profile, inst.packId).catch(() => {
      // 오디오를 못 켜도 편집은 이어 간다
    });
  }

  /** 타브 커서 자리 (타브 보기에서 Alt+B·Alt+M과 박자 바꾸기가 쓴다). 커서가 없거나 타브가 아니면 undefined */
  let tabCursor = $state.raw<Rat | undefined>(undefined);
  /**
   * 앱 명령(템포·마커·박자·아르페지오·편집 커서에서 재생)이 타브 커서 자리를 쓸 때는 이것만 부른다:
   * 타브 보기면 커서 칸을 먼저 화면에 보이게 하고(타브의 편집 전 규칙과 같다) 타브 커서를 돌려준다. 타브가 아니면 undefined
   */
  function tabCursorForCommand(): Rat | undefined {
    if (viewMode !== "tab") return undefined;
    if (tabCursor) tab?.revealCursor();
    return tabCursor;
  }
  // 박자: 타브 보기면 타브 커서가 든 마디부터, 아니면 재생 커서가 든 마디부터, 둘 다 없으면 곡 처음부터 바꾼다
  const meterPos = $derived(song ? meterTarget(song.timeSig, viewMode, tabCursor, cursor === undefined ? undefined : editCursor()) : rat(0));
  const meterHere = $derived(song ? meterAt(song.timeSig, meterPos) : { at: rat(0), beats: 4, unit: 4 });

  // 템포·마커·박자 넣기·고치기 창 (이벤트 줄, Alt+B·Alt+M)
  let eventEdit = $state<{ kind: EventKind; at: Rat; existing: boolean; id?: string } | undefined>(undefined);
  function openEvent(request: { label?: EventLabel; kind: EventKind; at: Rat; work?: number | undefined }) {
    // 곡을 다시 연 뒤 옛 보기가 늦게 보낸 요청(길게 누르기 타이머 등)은 버린다 (onmemory와 같은 보기 세대 검사)
    if (!song || !fromCurrentView(request.work, viewGen)) return;
    const l = request.label;
    // 곡 처음 기본 템포(적지 않은 t120) 라벨은 새로 넣기로 연다 (지울 것이 없다)
    eventEdit = l ? { kind: l.kind, at: l.at, existing: !l.implicit, ...(l.id ? { id: l.id } : {}) } : { kind: request.kind, at: request.at, existing: false };
  }
  /** 편집 커서(타브 보기면 타브 커서 먼저, 없으면 곡 처음) 자리 템포·마커 창. 그 자리에 템포가 있으면 고치기 */
  function openEventAtCursor(kind: EventKind) {
    if (!song) return;
    const at = tabCursorForCommand() ?? editCursor() ?? rat(0);
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
    // 고치는 마커: 누른 마커 글자 (템포·박자 글자를 눌렀으면 마커 칸은 새 마커)
    const markerHere = e.kind === "marker" && e.id ? song.markers.find((m) => m.id === e.id) : undefined;
    return {
      where: `${bar}:${Number.isInteger(beat) ? beat : beat.toFixed(2)}`,
      tempo: { bpm: tempoHere, here: song.tempo.some((x) => cmp(x.at, e.at) === 0) },
      meter: { beats: meter.beats, unit: meter.unit, here: song.timeSig.some((x) => cmp(x.at, e.at) === 0) },
      marker: { text: markerHere?.label ?? "", here: !!markerHere },
      markerId: markerHere?.id,
      atStart: cmp(e.at, rat(0)) === 0,
    };
  });
  /** 템포·박자·마커 창의 바뀐 것을 한꺼번에 (실행 취소 한 칸). 하나만 바뀌면 그 명령 이름 그대로 */
  function applyEvent(changes: EventChanges) {
    const e = eventEdit;
    const info = eventInfo;
    if (!history || !song || !e || !info) return;
    const commands: Command[] = [];
    if (changes.tempo === null) commands.push(removeTempoAt(e.at, t("ui.tempoDelete")));
    else if (changes.tempo !== undefined) commands.push(setTempoAt(e.at, changes.tempo, t("ui.tempoLabel")));
    if (changes.meter === null) commands.push(removeMeter(e.at, t("ui.meterDelete")));
    else if (changes.meter) commands.push(meterEditAt(song.timeSig, e.at, changes.meter.beats, changes.meter.unit, t("ui.meter")));
    if (changes.marker === null) {
      if (info.markerId) commands.push(removeMarker(info.markerId, t("ui.markerDelete")));
    } else if (changes.marker !== undefined) commands.push(setMarker(info.markerId, e.at, changes.marker, t("ui.markerLabel")));
    if (commands.length === 1) commit(commands[0]!);
    else if (commands.length > 1) {
      // 박자 명령은 그 앞 박자 지도를 보고 만들었으므로, 차례로 적용한 결과를 한 명령으로 넣는다
      const next = commands.reduce((s, c) => c.apply(s), history.song);
      commit(replaceSong(t("ui.eventTogether"), next));
    }
  }
  function moveEvent(label: EventLabel, to: Rat) {
    if (!history) return;
    if (label.kind === "tempo") runIfChanged(moveTempo(label.at, to, t("ui.tempoMove")));
    else if (label.kind === "marker" && label.id) runIfChanged(moveMarker(label.id, to, t("ui.markerMove")));
  }

  // 원곡에 템포 맞추기: 템포를 짐작하지 않고 사람이 정한 자리를 곡 템포로 옮긴다
  const fine = (time: number) => rat(Math.round(time * 3840), 3840);

  /** 파형 띠 마디선 끌기 방식: 앞에서부터(앞 템포 자리부터 이 마디선까지, 뒤는 밀린다) · 양옆 마디만. 기억한다 */
  const BAR_DRAG_KEY = "mmlce.barDragMode";
  let barDragMode = $state<BarDragMode>(loadStored(BAR_DRAG_KEY, (raw) => (raw === "pair" ? "pair" : "chain")));
  function setBarDragMode(mode: BarDragMode) {
    barDragMode = mode;
    saveStored(BAR_DRAG_KEY, mode);
  }
  function barPlan(s: Song, bar: Rat, to: number) {
    const target = positionToSeconds(s.tempo, fine(to));
    return barDragMode === "pair" ? pairBarTempo(s.tempo, s.timeSig, bar, target) : alignBarTempo(s.tempo, bar, target);
  }

  /** 파형 띠에서 마디선 bar를 끌어 놓은 자리(to, 지금 템포로 잰 온음표)에 그 마디가 오게 템포를 바꾼다 */
  function alignBar(bar: Rat, to: number) {
    if (!history) return;
    const plan = barPlan(history.song, bar, to);
    if (plan) runIfChanged(setTempos(plan.set, plan.remove, t(barDragMode === "pair" ? "ui.tempoAlignPair" : "ui.tempoAlign")));
  }
  /** 마디선을 끄는 동안 보여 줄 템포: 양옆 마디만이면 두 마디, 앞에서부터면 앞 구간. 못 끄는 자리면 × */
  function barDragText(bar: number, to: number): string {
    const s = history?.song;
    if (!s) return "×";
    const at = rat(Math.round(bar * 3840), 3840);
    const target = positionToSeconds(s.tempo, fine(to));
    if (barDragMode === "pair") {
      const plan = pairBarTempo(s.tempo, s.timeSig, at, target);
      return plan ? `t${plan.bpms[0]} | t${plan.bpms[1]}` : "×";
    }
    const plan = alignBarTempo(s.tempo, at, target);
    return plan ? `t${plan.set[0]?.bpm ?? ""}` : "×";
  }

  /**
   * 탭 템포: 재생 중 마디 첫 박마다 누른 곡 시각(초). 멈추면 마디마다 템포로 넣는다.
   * 한 번 재생하는 동안 찍은 것이 한 묶음이다. 그 재생에 쓴 템포 지도를 같이 둔다 (곡 시각 → 자리를 그 템포로 잰다).
   * anchor: 이어 찍기로 고른 마디 (첫 탭을 가장 가까운 마디 대신 이 자리로 잡는다)
   */
  type TapSession = { run: number; tempo: readonly TempoEvent[]; times: readonly number[]; anchor?: Rat | undefined };
  let tapOpen = $state(false);
  let tapSession = $state.raw<TapSession | undefined>(undefined);
  const tapCount = $derived(tapSession?.times.length ?? 0);
  let tapResult = $state("");
  /** 이어 찍기: 고른 마디와, 그보다 이른 탭(앞 마디 박)을 버릴 곡 시각. run은 그 재생 번호 */
  let tapAnchor = $state.raw<{ run: number; at: Rat; early: number } | undefined>(undefined);
  /** 이어 찍을 마디 번호 (넣은 뒤에는 마지막 탭 마디로) */
  let tapResumeBar = $state(1);
  /** 넣은 뒤 다시 볼 것: 간격이 튀는 자리, 파형 시작점 맞추기 제안 (누르기 전에는 고치지 않는다) */
  let tapReview = $state.raw<TapReview | undefined>(undefined);
  /** 탭 단위 (마디마다·박마다). 기억한다 */
  const TAP_UNIT_KEY = "mmlce.tapUnit";
  let tapUnit = $state<TapUnit>(loadStored(TAP_UNIT_KEY, (raw) => (raw === "beat" ? "beat" : "bar")));
  function setTapUnit(unit: TapUnit) {
    tapUnit = unit;
    clearTaps();
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
  /** 튀는 탭 표시 기준 (앞뒤 간격과 다른 비율, 0 끔). 기억한다 */
  const TAP_FLAG = [0, 0.1, 0.2, 0.35] as const;
  const TAP_FLAG_KEY = "mmlce.tapFlag";
  let tapFlag = $state(loadStored(TAP_FLAG_KEY, (raw) => (raw !== null && [0, 1, 2, 3].includes(Number(raw)) ? Number(raw) : 2)));
  function setTapFlag(n: number) {
    tapFlag = n;
    saveStored(TAP_FLAG_KEY, String(n));
  }
  /** 파형 시작점 맞추기 창 (초, 0 끔 = 기본). 기억한다 */
  const TAP_SNAP = [0, 0.03, 0.06] as const;
  const TAP_SNAP_KEY = "mmlce.tapSnap";
  let tapSnap = $state(loadStored(TAP_SNAP_KEY, (raw) => (raw !== null && [0, 1, 2].includes(Number(raw)) ? Number(raw) : 0)));
  function setTapSnap(n: number) {
    tapSnap = n;
    saveStored(TAP_SNAP_KEY, String(n));
  }
  /**
   * 탭 재생 속도 (1 = 원래). 빠른 곡은 느리게 틀어 찍는다. 탭 줄이 열려 있을 때만 쓰고, 닫으면 원래 속도로 재생한다.
   * 탭 시각은 곡 시간으로 재므로 찍은 간격은 따로 바꾸지 않아도 원래 빠르기의 템포가 된다. 기억한다
   */
  const TAP_SPEED = [1, 0.85, 0.75, 0.6, 0.5] as const;
  const TAP_SPEED_KEY = "mmlce.tapSpeed";
  let tapSpeed = $state(loadStored(TAP_SPEED_KEY, (raw) => (raw !== null && [0, 1, 2, 3, 4].includes(Number(raw)) ? Number(raw) : 0)));
  const playRate = $derived(tapOpen ? (TAP_SPEED[tapSpeed] ?? 1) : 1);
  function setTapSpeed(n: number) {
    tapSpeed = n;
    saveStored(TAP_SPEED_KEY, String(n));
    respeed();
  }
  /**
   * 재생 중에 속도가 바뀌면(속도를 고르거나 탭 줄을 열고 닫으면) 찍은 것을 먼저 넣고 지금 자리부터 새 속도로 다시 재생한다.
   * 자리는 곡 시각(초)으로 잡아 두었다가 탭을 넣은 뒤의 템포 지도로 잰다 (원곡이 건너뛰지 않게). 반복 구간이면 그 안에서 이어 간다.
   * 아직 준비 중인 재생은 같은 요청을 새 속도로 다시 한다
   */
  function respeed() {
    const rate = untrack(() => playRate);
    if (!playback.playing) {
      const p = playback.pending;
      if (p && p.rate !== rate) void playback.play(p.song, p.start, p.loop, rate);
      return;
    }
    const seconds = playback.now();
    if (playback.rate === rate || seconds === undefined) return;
    if (tapSession) finishTap();
    const s = history?.song;
    if (!s) return;
    void playback.play(s, secondsToWhole(s.tempo, seconds), loop, rate, seconds);
  }
  /** 탭 줄을 닫을 때 아직 넣지 않은 탭 (0 버리기 = 기본 · 1 물어보기 · 2 넣기). 잘못 찍었을 수도 있어 기본은 버린다. 기억한다 */
  const TAP_CLOSE_KEY = "mmlce.tapClose";
  let tapClose = $state(loadStored(TAP_CLOSE_KEY, (raw) => (raw !== null && [0, 1, 2].includes(Number(raw)) ? Number(raw) : 0)));
  function setTapClose(n: number) {
    tapClose = n;
    saveStored(TAP_CLOSE_KEY, String(n));
  }
  function clearTaps() {
    tapSession = undefined;
    tapAnchor = undefined;
  }
  function tap(): boolean {
    if (!tapOpen) return false;
    const now = playback.now();
    if (now === undefined) return true;
    let current = tapSession;
    // 자리를 옮겨 다시 재생했거나 반복 구간이 처음으로 돌아가면, 그때까지 찍은 것을 먼저 넣고 새로 찍는다
    if (current && (current.run !== playback.runs || now <= current.times.at(-1)!)) {
      finishTap();
      current = undefined;
    }
    if (current) tapSession = { ...current, times: [...current.times, now] };
    else {
      const anchor = tapAnchor?.run === playback.runs ? tapAnchor : undefined;
      // 이어 찍기: 고른 마디보다 반 마디 넘게 이른 탭(앞 마디 박)은 세지 않는다
      if (anchor && now < anchor.early) return true;
      tapAnchor = undefined;
      tapSession = { run: playback.runs, tempo: playback.tempo, times: [now], anchor: anchor?.at };
    }
    tapResult = "";
    tapReview = undefined;
    return true;
  }
  /** 이어 찍기: 고른 마디 한 마디 앞부터 재생하고, 그 마디 첫 박을 첫 탭으로 잡는다. 앞에서 넣은 템포는 그대로 */
  async function resumeTap(bar: number) {
    if (!song || packs.length === 0 || !(bar >= 1)) return;
    if (tapSession) finishTap();
    const s = song;
    const at = barStart(s.timeSig, bar);
    const from = previousBar(s.timeSig, at);
    tapResumeBar = Math.floor(bar);
    tapResult = "";
    tapReview = undefined;
    await playback.play(s, toFloat(from), undefined, playRate);
    if (!playback.playing) return;
    const atSeconds = positionToSeconds(s.tempo, at);
    tapAnchor = { run: playback.runs, at, early: atSeconds - (atSeconds - positionToSeconds(s.tempo, from)) / 2 };
  }
  function finishTap() {
    const s = history?.song;
    const session = tapSession;
    tapSession = undefined;
    if (!s || !session || session.times.length < 2) return;
    const list = session.times;
    const unit = tapUnit;
    const at = fine(secondsToWhole(session.tempo, list[0]!));
    const first = session.anchor ?? (unit === "bar" ? nearestBar(s.timeSig, at) : nearestBeat(s.timeSig, at));
    const r = placeTaps(s, list, first, unit, t("ui.tapTempo"), (o) => {
      tapResult = o.result;
      tapReview = o.review;
    });
    if (r) tapResumeBar = barBeatAt(s.timeSig, r).bar;
  }
  type TapShow = (o: { result: string; review: TapReview | undefined }) => void;
  /**
   * 탭 시각(곡 초, 간격만 쓴다)을 first부터 마디·박마다 템포로 넣는다 (실행 취소 한 칸).
   * 결과 문구와 다시 볼 것(튀는 자리·파형 맞추기)은 show로 넘기고, 마지막 탭 자리를 돌려준다. 못 넣으면 undefined
   */
  function placeTaps(s: Song, list: readonly number[], first: Rat, unit: TapUnit, label: string, show: TapShow): Rat | undefined {
    const slack = TAP_SLACK[tapMerge] ?? 0;
    const plan = tapTempos(s.tempo, s.timeSig, first, list, { slack, unit });
    if (!plan) {
      show({ result: t("ui.tapFailed"), review: undefined });
      return undefined;
    }
    // 게임 템포 범위 밖 값은 넣지 않는다 (영상 마디가 촘촘하거나 시작 마디를 잘못 고른 경우 등)
    const outside = tempoOutOfRange(plan, profile.tempo);
    if (outside !== undefined) {
      show({ result: t("ui.tapOutOfRange", { bpm: outside, min: profile.tempo.min, max: profile.tempo.max }), review: undefined });
      return undefined;
    }
    const done = runIfChanged(setTempos(plan.set, plan.remove, label));
    // 파형 맞추기 제안은 지금 곡에만 쓴다 (그 뒤 다른 편집·다른 곡이면 옛 탭 시각으로 템포를 덮지 않는다)
    const base = history?.song;
    const where = barBeatAt(s.timeSig, first);
    const result = done
      ? t(unit === "bar" ? "ui.tapDone" : "ui.tapDoneBeats", { bar: where.bar, beat: where.beat, n: list.length - 1, undo: keyOf("edit.undo") ?? "" })
      : t("ui.tapSame");
    const marks = tapMarks(s.timeSig, first, list.length, unit);
    // 간격이 튀는 자리는 알려만 준다 (고치지 않는다)
    const flags = offIntervals(list, marks, TAP_FLAG[tapFlag] ?? 0).map((i) => {
      const w = barBeatAt(s.timeSig, marks[i]!);
      return { at: toFloat(marks[i]!), label: unit === "bar" ? t("ui.tapFlagBar", { bar: w.bar }) : t("ui.tapFlagBeat", { bar: w.bar, beat: w.beat }) };
    });
    // 파형 시작점 맞추기: 악보에 그 박 첫 음이 있는 탭만, 맞출지 물어본다
    let snap: TapReview["snap"];
    const window = TAP_SNAP[tapSnap] ?? 0;
    if (window > 0 && reference && referencePeaks) {
      const peaks = referencePeaks;
      const offset = reference.offsetMs / 1000;
      const attacks = attackStarts(s.tracks.filter((tr) => !tr.mute));
      const r = snapTaps(list, marks, attacks, (time) => {
        const o = onsetNear(peaks, time + offset, window);
        return o === undefined ? undefined : o - offset;
      });
      if (r.moved.length > 0) {
        const ms = Math.round((r.moved.reduce((sum, m) => sum + Math.abs(m.shift), 0) / r.moved.length) * 1000);
        const offer = boundToSong(
          base,
          () => applySnap(first, r.times, slack, unit, r.moved.length, flags, show),
          () => show({ result: t("ui.tapSnapStale"), review: flags.length > 0 ? { flags } : undefined }),
        );
        snap = { count: r.moved.length, ms, apply: () => offer(history?.song) };
      } else snap = { count: 0, ms: 0, apply: () => {} };
    }
    show({ result, review: flags.length > 0 || snap ? { flags, snap } : undefined });
    return marks.at(-1)!;
  }
  /** 파형 시작점에 맞춘 탭 시각으로 다시 넣는다 (실행 취소 한 칸) */
  function applySnap(first: Rat, times: readonly number[], slack: number, unit: TapUnit, count: number, flags: TapReview["flags"], show: TapShow) {
    const s = history?.song;
    if (!s) return;
    const plan = tapTempos(s.tempo, s.timeSig, first, times, { slack, unit });
    const outside = plan && tempoOutOfRange(plan, profile.tempo);
    if (outside !== undefined) {
      show({ result: t("ui.tapOutOfRange", { bpm: outside, min: profile.tempo.min, max: profile.tempo.max }), review: flags.length > 0 ? { flags } : undefined });
      return;
    }
    const done = plan ? runIfChanged(setTempos(plan.set, plan.remove, t("ui.tapSnapLabel"))) : false;
    show({ result: done ? t("ui.tapSnapDone", { n: count, undo: keyOf("edit.undo") ?? "" }) : t("ui.tapSame"), review: flags.length > 0 ? { flags } : undefined });
  }
  // 멈추면(끝까지 갔거나 정지·일시정지) 찍은 것을 넣는다
  $effect(() => {
    if (!playing && tapSession) untrack(finishTap);
  });
  function toggleTap() {
    // 닫을 때 넣지 않은 탭(2개 이상)은 설정대로 넣거나 버린다
    if (tapOpen && tapSession && tapSession.times.length >= 2 && (tapClose === 2 || (tapClose === 1 && confirm(t("ui.tapCloseConfirm", { n: tapSession.times.length })))))
      finishTap();
    tapOpen = !tapOpen;
    clearTaps();
    tapResult = "";
    tapReview = undefined;
    respeed();
  }

  // 실험실 영상 마디 넘김: 배경 영상에서 마디 상자가 옮겨진 시각을 찾아 마디 단위 탭으로 넣는다
  let videoBarsOpen = $state(false);
  /** 찾는 중: 읽은 비율과 그만두기 */
  let videoBarsScan = $state.raw<{ share: number; abort: AbortController } | undefined>(undefined);
  /** 찾은 마디 시작 (영상 초)과 그 영상 */
  let videoBarsFound = $state.raw<{ url: string; times: readonly number[]; complete: boolean } | undefined>(undefined);
  let videoBarsFirst = $state(1);
  let videoBarsResult = $state("");
  let videoBarsReview = $state.raw<TapReview | undefined>(undefined);
  const VIDEO_BARS_SPEEDS = [1, 2] as const;
  const VIDEO_BARS_SPEED_KEY = "mmlce.videoBarsSpeed";
  let videoBarsSpeed = $state(loadStored(VIDEO_BARS_SPEED_KEY, (raw) => (raw === "1" ? 1 : 0)));
  function setVideoBarsSpeed(n: number) {
    videoBarsSpeed = n;
    saveStored(VIDEO_BARS_SPEED_KEY, String(n));
  }
  function toggleVideoBars() {
    if (videoBarsOpen) return closeVideoBars();
    videoBarsOpen = true;
    videoBarsResult = "";
    videoBarsReview = undefined;
  }
  function closeVideoBars() {
    videoBarsScan?.abort.abort();
    videoBarsScan = undefined;
    videoBarsOpen = false;
  }
  $effect(() => {
    if (!labs.on && videoBarsOpen) untrack(closeVideoBars);
  });
  // 배경 영상을 빼거나 바꾸면 찾던 것을 그만두고 찾은 것도 버린다
  $effect(() => {
    const url = video?.url;
    untrack(() => {
      if (videoBarsFound && videoBarsFound.url !== url) videoBarsFound = undefined;
      if (videoBarsScan && !url) {
        videoBarsScan.abort.abort();
        videoBarsScan = undefined;
      }
    });
  });
  async function startVideoBars() {
    if (!video || videoBarsScan) return;
    const url = video.url;
    const abort = new AbortController();
    videoBarsScan = { share: 0, abort };
    videoBarsFound = undefined;
    videoBarsResult = "";
    videoBarsReview = undefined;
    try {
      const r = await scanVideo(url, {
        rate: VIDEO_BARS_SPEEDS[videoBarsSpeed] ?? 1,
        signal: abort.signal,
        onprogress: (share) => {
          if (videoBarsScan?.abort === abort) videoBarsScan = { share, abort };
        },
      });
      if (videoBarsScan?.abort !== abort || video?.url !== url) return;
      const times = pickBarStarts(r.samples, r.pixels);
      videoBarsFound = { url, times, complete: r.complete };
      // 첫 마디 번호: 지금 템포와 영상 어긋남으로 첫 변화가 오는 가장 가까운 마디 (직접 고칠 수 있다)
      const s = history?.song;
      if (s && times.length > 0) videoBarsFirst = barBeatAt(s.timeSig, nearestBar(s.timeSig, fine(secondsToWhole(s.tempo, Math.max(0, times[0]! - video.offset))))).bar;
    } catch {
      if (videoBarsScan?.abort === abort) videoBarsResult = t("ui.videoBarsFailed");
    } finally {
      if (videoBarsScan?.abort === abort) videoBarsScan = undefined;
    }
  }
  function applyVideoBars(bar: number) {
    const s = history?.song;
    const found = videoBarsFound;
    if (!s || !video || !found || found.times.length < 2 || !(bar >= 1)) return;
    // 영상 초 → 곡 초 (간격만 쓰지만 파형 맞추기는 곡 초로 원곡을 찾는다)
    const offset = video.offset;
    placeTaps(s, found.times.map((time) => time - offset), barStart(s.timeSig, Math.floor(bar)), "bar", t("ui.labVideoBars"), (o) => {
      videoBarsResult = o.result;
      videoBarsReview = o.review;
    });
  }

  /** 이벤트 줄에서 누른 라벨: 휠로 템포 바꾸기, Del로 지우기 */
  let pickedEvent = $state.raw<EventRef | undefined>(undefined);
  /** 잇달아 굴린 휠 템포는 실행 취소 한 칸으로 묶는다 */
  let tempoWheel: { at: Rat; after: Song; time: number } | undefined;
  function wheelTempo(at: Rat, step: number) {
    if (!history || picking) return;
    const merge = tempoWheel && cmp(tempoWheel.at, at) === 0 && tempoWheel.after === history.song && performance.now() - tempoWheel.time < 1500;
    const { min, max } = profile.tempo;
    const bpm = Math.min(max, Math.max(min, bpmAt(history.song.tempo, at) + step));
    if (bpm === bpmAt(history.song.tempo, at)) return;
    if (merge) history.undo();
    const next = commit(setTempoAt(at, bpm, t("ui.tempoLabel")));
    if (!next) return;
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

  /** 템포 한꺼번에 바꾸기: 반복 구간이 있으면 그 안, 없으면 곡 전체 (실행 취소 한 칸) */
  let tempoChangeOpen = $state(false);
  const tempoChangeTarget = $derived.by(() => {
    const s = song;
    if (!s) return undefined;
    const from = loop ? asRat(loop[0]) : rat(0);
    const to = loop ? asRat(loop[1]) : undefined;
    // 실제로 고칠 지도 템포·원문 t와 같은 목록 (겹쳐 쓴 t도 범위 밖으로 센다)
    const bpms = tempoChangeTargets(s, from, to).bpms;
    const where = (at: Rat) => {
      const { bar, beat } = barBeatAt(s.timeSig, at);
      return `${bar}:${Number.isInteger(beat) ? beat : beat.toFixed(2)}`;
    };
    return { from, to, bpms, scope: to ? t("ui.tempoChangeRange", { from: where(from), to: where(to) }) : t("ui.tempoChangeSong") };
  });
  function changeAllTempos(change: TempoChange) {
    const target = tempoChangeTarget;
    if (!target) return;
    const before = history?.song;
    const failed = before ? changeTemposResult(before, change, target.from, target.to).failed : [];
    runIfChanged(changeTempos(change, target.from, target.to, t("ui.tempoChange")));
    // 경계 템포를 넣지 못한 악보는 원문을 그대로 두었으니 알려 준다
    if (failed.length > 0) {
      const reasons = [...new Set(failed.flatMap((f) => f.reasons))].map((r) => t(r === "n-note" ? "ui.tempoEdgeNNote" : "ui.tempoEdgeLength"));
      error = t("ui.tempoChangeFailed", { scores: failed.map((f) => f.score + 1).join(", "), reasons: reasons.join(", ") });
    }
  }

  /**
   * 실험실 점점 느리게·빠르게: 반복 구간이 있으면 그 안, 없으면 고른 음이 걸친 구간 (실행 취소 한 칸).
   * 열려 있는 동안 고른 음이 바뀌어도 연 때의 구간을 쓴다
   */
  let tempoRampOpen = $state(false);
  let tempoRampAt = $state.raw<{ from: Rat; to: Rat; scope: string } | undefined>(undefined);
  const tempoRampRange = $derived.by(() => {
    const s = song;
    if (!s) return undefined;
    const where = (at: Rat) => {
      const { bar, beat } = barBeatAt(s.timeSig, at);
      return `${bar}:${Number.isInteger(beat) ? beat : beat.toFixed(2)}`;
    };
    if (loop) {
      const from = asRat(loop[0]);
      const to = asRat(loop[1]);
      return { from, to, scope: t("ui.tempoChangeRange", { from: where(from), to: where(to) }) };
    }
    if (selectedNotes.length === 0) return undefined;
    const from = selectedNotes.reduce((m, n) => (cmp(n.start, m) < 0 ? n.start : m), selectedNotes[0]!.start);
    const to = selectedNotes.reduce((m, n) => (cmp(add(n.start, n.dur), m) > 0 ? add(n.start, n.dur) : m), add(selectedNotes[0]!.start, selectedNotes[0]!.dur));
    return { from, to, scope: t("ui.tempoRampScopeNotes", { from: where(from), to: where(to) }) };
  });
  function openTempoRamp() {
    if (!labs.on || !tempoRampRange) return;
    tempoRampAt = tempoRampRange;
    tempoRampOpen = true;
  }
  function previewTempoRamp(ramp: TempoRamp) {
    const s = history?.song;
    const at = tempoRampAt;
    if (!s || !at) return { steps: [], replaced: 0, rows: [] };
    const r = rampTemposResult(s, ramp, at.from, at.to, profile.tempo);
    return { steps: r.steps, replaced: r.replaced, rows: r.song === s ? [] : previewRows(s, r.song, profile.charLimitPerScore) };
  }
  function applyTempoRamp(ramp: TempoRamp) {
    const at = tempoRampAt;
    const before = history?.song;
    if (!at || !before) return;
    const failed = rampTemposResult(before, ramp, at.from, at.to, profile.tempo).failed;
    runIfChanged(rampTempos(ramp, at.from, at.to, t("ui.tempoRamp"), profile.tempo));
    if (failed.length > 0) {
      const reasons = [...new Set(failed.flatMap((f) => f.reasons))].map((r) => t(r === "n-note" ? "ui.tempoEdgeNNote" : "ui.tempoEdgeLength"));
      error = t("ui.tempoRampFailed", { scores: failed.map((f) => f.score + 1).join(", "), reasons: reasons.join(", ") });
    }
  }
  $effect(() => {
    if (!labs.on && tempoRampOpen) tempoRampOpen = false;
  });

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
    // 박자를 바꿀 자리: meterPos와 같은 규칙이고, 타브 커서를 쓰면 그 칸을 먼저 보인다
    const pos = song ? meterTarget(song.timeSig, viewMode, tabCursorForCommand(), cursor === undefined ? undefined : editCursor()) : meterPos;
    commit(setMeter(pos, beats, unit, t("ui.meter")));
  }

  /**
   * 어긋난 길이 찾기 창 (3MLE·마비꼬식 r21·b19.·l27 같은 길이). 열려 있는 동안 곡이 바뀌면 다시 찾는다.
   * 3MLE·마비꼬·MML@ 글을 열거나 붙여 넣었을 때 그 글에 찾은 곳이 있으면 저절로 연다 (고치는 것은 사용자가 고른 것만)
   */
  let offgridOpen = $state(false);
  const offgrid = $derived(offgridOpen && song ? findOffgrid(song) : []);
  function offerOffgrid(opened: Song) {
    if (findOffgrid(opened).length > 0) offgridOpen = true;
  }
  function goToOffgrid(fix: OffgridFix) {
    const track = song?.tracks.find((tr) => tr.id === fix.trackId);
    if (!track) return;
    // 고칠 자리가 음이면 그 음, 쉼표면 그 뒤 첫 음을 고른다
    const note = track.notes.find((n) => cmp(n.start, fix.at) === 0 && (fix.pitch === undefined || n.pitch === fix.pitch)) ?? track.notes.find((n) => cmp(n.start, fix.at) >= 0);
    if (note) return goToCheck(track, note);
    activeTrackId = track.id;
    setCursor(fix.at);
  }
  /** 고친 자리 앞뒤 한 박씩을 원래대로 또는 고친 대로 들려준다 (곡 전체 트랙을 같이) */
  let offgridTimer: ReturnType<typeof setTimeout> | undefined;
  function listenOffgrid(fix: OffgridFix, fixed: boolean) {
    if (!song) return;
    const target = fixed ? fixOffgrid([fix]).apply(song) : song;
    const beat = rat(1, 4);
    const from = cmp(fix.at, beat) > 0 ? sub(fix.at, beat) : rat(0);
    const to = add(fix.at, add(sub(fix.landing, fix.start), beat));
    clearTimeout(offgridTimer);
    void playback.play(target, toFloat(from), undefined);
    const seconds = positionToSeconds(target.tempo, to) - positionToSeconds(target.tempo, from);
    offgridTimer = setTimeout(stop, Math.max(0, seconds) * 1000 + 150);
  }
  function applyOffgrid(fixes: readonly OffgridFix[]) {
    // 잠근 트랙이 끼면 묻고, 그래도 하겠다면 잠근 트랙까지 고친다 (조옮김·볼륨 일괄 조정과 같음)
    const locked = lockedNames(fixes.map((f) => f.trackId));
    if (locked && !confirm(t("ui.offgridLockedConfirm", { names: locked }))) return;
    runIfChanged(fixOffgrid(fixes, t("ui.offgrid")));
  }

  /**
   * 접힘 검토 창 (곡 메뉴, 곡 검사의 접힘 줄). 실측 음역 밖이라 게임이 접어 내는 음이 있는 구간마다
   * 구간째 옥타브를 옮기는 방법을 견준다. 열려 있는 동안 곡이 바뀌면 다시 본다
   */
  let foldOpen = $state(false);
  /** 곡 검사와 같은 악기 해석 (번호로만 아는 악기는 실제 악기로) */
  const foldInstrumentOf = $derived((track: Track) => {
    const ref = trackInstrument(song!, track);
    return canonicalOf(ref.canonical, ref.program, ref.packId) ?? ref.canonical;
  });
  const folds = $derived(foldOpen && song ? reviewFolds(song, profile, foldInstrumentOf) : []);
  function goToFold(phrase: FoldPhrase) {
    const track = song?.tracks.find((tr) => tr.id === phrase.trackId);
    const note = track?.notes.find((n) => n.id === phrase.noteIds[0]);
    if (track && note) goToCheck(track, note);
  }
  /** 구간과 앞뒤 한 박을 그대로 또는 옮긴 대로 들려준다 (곡 전체 트랙을 같이) */
  function listenFold(phrase: FoldPhrase, shift: number) {
    if (!song) return;
    const target = applyFoldShifts(song, [{ phrase, shift }])?.apply(song) ?? song;
    const beat = rat(1, 4);
    const from = cmp(phrase.start, beat) > 0 ? sub(phrase.start, beat) : rat(0);
    const to = add(phrase.end, beat);
    clearTimeout(offgridTimer);
    void playback.play(target, toFloat(from), undefined);
    const seconds = positionToSeconds(target.tempo, to) - positionToSeconds(target.tempo, from);
    offgridTimer = setTimeout(stop, Math.max(0, seconds) * 1000 + 150);
  }
  function applyFolds(picks: readonly { phrase: FoldPhrase; shift: number }[]) {
    if (!song) return;
    const locked = lockedNames(picks.filter((p) => p.shift !== 0).map((p) => p.phrase.trackId));
    if (locked && !confirm(t("ui.offgridLockedConfirm", { names: locked }))) return;
    const command = applyFoldShifts(song, picks, t("ui.foldReview"));
    if (command) runIfChanged(command);
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
    commit(kind === "insert" ? insertTime(at, bar, t("ui.insertBar")) : deleteTime(at, bar, t("ui.deleteBar")));
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
    return Number.isFinite(v) ? Math.min(MASTER_MAX, Math.max(0, v)) : 1;
  });
  let masterVolume = $state(initialMasterVolume);
  function setMasterVolume(v: number) {
    masterVolume = v;
    engine.setMasterVolume(v);
    saveStored(MASTER_KEY, String(v));
  }
  engine.setMasterVolume(initialMasterVolume);

  // 악기별 음량 (dB, 팩 이름#번호 → 값). 이 기기에만 기억하고 곡 파일에는 넣지 않는다
  const GAINS_KEY = "mmlce.instrumentGains";
  const initialGains = loadStored<InstrumentGains>(GAINS_KEY, (raw) => {
      try {
        const v: unknown = raw ? JSON.parse(raw) : {};
        if (!v || typeof v !== "object") return {};
        return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1])));
      } catch {
        return {};
      }
    });
  let instrumentGains = $state.raw<InstrumentGains>(initialGains);
  function setInstrumentGain(key: string, db: number) {
    const next = { ...instrumentGains };
    if (db === 0) delete next[key];
    else next[key] = db;
    instrumentGains = next;
    engine.setInstrumentGains(next);
    saveStored(GAINS_KEY, JSON.stringify(next));
  }
  engine.setInstrumentGains(initialGains);

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
      return Number.isFinite(v) && v >= ROLL_SHARE_MIN && v <= ROLL_SHARE_MAX ? Math.round(v) : 46;
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
  let dividerFrom: { x: number; y: number; width: number; share: number; eh: number; box: DOMRect; maxShare: number } | undefined;
  /** 세로 화면 아래 패널 (분할선 한도를 잴 때 쓴다) */
  let listPaneEl = $state<HTMLElement | undefined>(undefined);
  /** 세로 화면 롤 몫의 위 한도: 아래 패널이 트랙 띠 + 편집기 머리 + 글 두세 줄보다 작아지지 않게 (paneSplit.ts) */
  function rollShareLimit(box: DOMRect): number {
    return listPaneEl ? maxRollShare(box.height, paneMinHeight(listPaneEl)) : ROLL_SHARE_MAX;
  }
  function ondividerdown(e: PointerEvent) {
    const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    dividerFrom = { x: e.clientX, y: e.clientY, width: paneWidth, share: rollShareV, eh: editorHeight, box, maxShare: portrait ? rollShareLimit(box) : ROLL_SHARE_MAX };
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
      rollShareV = clampRollShare(dividerFrom.share + ((e.clientY - dividerFrom.y) / Math.max(1, dividerFrom.box.height)) * 100, dividerFrom.maxShare);
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
  // 저장된 몫이 이 화면에서 아래 패널을 너무 작게 하면 불러올 때(세로 화면이 되거나 패널이 생길 때) 맞춘다
  const hasPane = $derived(!!analysis);
  $effect(() => {
    const pane = listPaneEl;
    if (!portrait || !pane || !hasPane) return;
    untrack(() => {
      const box = pane.parentElement?.getBoundingClientRect();
      if (!box) return;
      const max = rollShareLimit(box);
      if (rollShareV > max) rollShareV = max;
    });
  });
  function resetDivider() {
    editorHeight = EDITOR_DEFAULT;
    saveStored(EDITOR_KEY, String(editorHeight));
    paneWidth = PANE_DEFAULT;
    rollShareV = Math.min(46, portrait && listPaneEl?.parentElement ? rollShareLimit(listPaneEl.parentElement.getBoundingClientRect()) : ROLL_SHARE_MAX);
    saveStored(PANE_KEY, String(paneWidth));
    saveStored(SHARE_KEY, String(rollShareV));
  }

  // 이벤트 줄 (템포·박자·마커를 롤 위에 표시, 변속 확인용). 템포가 늘 보이게 처음엔 켜 두고, 끄고 켠 것은 기억한다
  const EVENTS_KEY = "mmlce.showEvents";
  let showEvents = $state(loadStored(EVENTS_KEY, (raw) => raw !== "0"));
  $effect(() => {
    saveStored(EVENTS_KEY, showEvents ? "1" : "0");
  });
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
  // 기본은 켬 (끈 적이 있으면 "0"이 남는다)
  let lightKeys = $state(loadStored(LIGHT_KEYS_KEY, (raw) => raw !== "0"));
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
  // 편집기 여러 개: 트랙 패널 편집기를 위아래로 1~최대치(설정 → 화면, 기본 4)개. 위는 고른 트랙, 아래 칸은 Alt+클릭(또는 메뉴)으로
  // 고른 트랙. 편집기 수와 최대치를 이 브라우저에 기억한다 (예전 "편집기 둘 나란히" 켜짐은 처음 한 번 2개로 옮긴다)
  const EDITOR_COUNT_KEY = "mmlce.editorCount";
  const EDITOR_MAX_KEY = "mmlce.editorMax";
  const DUAL_KEY = "mmlce.dualEditor";
  /** 최대치를 고를 수 있는 끝: 한 악보 트랙 수 (게임 한도) */
  const editorLimit = $derived(profile.maxChordsPerPlayer);
  let editorMax = $state(untrack(() => loadStored(EDITOR_MAX_KEY, (raw) => parseEditorMax(raw, profile.maxChordsPerPlayer))));
  let editorCountStored = $state(
    untrack(() => loadStored(EDITOR_COUNT_KEY, (raw) => parseEditorCount(raw, raw === null ? loadStored(DUAL_KEY, (d) => d) : null, editorMax))),
  );
  saveStored(EDITOR_COUNT_KEY, String(untrack(() => editorCountStored)));
  /** 지금 편집기 수 (최대치·한 악보 트랙 수 안) */
  const editorCount = $derived(Math.max(1, Math.min(editorCountStored, editorMax, editorLimit)));
  function setEditorCount(n: number) {
    editorCountStored = Math.max(1, Math.min(n, editorMax, editorLimit));
    saveStored(EDITOR_COUNT_KEY, String(editorCountStored));
  }
  /** 설정 → 화면: 편집기 최대치. 지금 편집기 수보다 낮추면 편집기 수도 줄인다 */
  function setEditorMax(n: number) {
    editorMax = Math.max(2, Math.min(n, editorLimit));
    saveStored(EDITOR_MAX_KEY, String(editorMax));
    if (editorCountStored > editorMax) setEditorCount(editorMax);
  }
  /** 아래 칸마다 고른 트랙과 바뀐 차례 (Alt+클릭은 가장 오래 안 바꾼 칸을 바꾼다) */
  let extraChosen = $state.raw<(string | undefined)[]>([]);
  let extraStamps = $state.raw<(number | undefined)[]>([]);
  let extraTick = 0;
  /** 아래 칸들에 실제로 여는 트랙 (같은 트랙은 두 칸에 열지 않는다) */
  const extraTrackIds = $derived(song ? fillEditorTracks(song.tracks.map((tr) => tr.id), activeTrackId, extraChosen, editorCount) : []);
  function openSecond(trackId: string) {
    if (trackId === activeTrackId || extraTrackIds.includes(trackId)) return;
    if (editorCount <= 1) {
      setEditorCount(2);
      extraChosen = [trackId];
      extraStamps = [++extraTick];
      return;
    }
    const slot = oldestEditor(extraStamps, Math.max(1, extraTrackIds.length));
    extraChosen = extraTrackIds.map((id, k) => (k === slot ? trackId : id));
    extraStamps = extraTrackIds.map((_, k) => (k === slot ? ++extraTick : extraStamps[k]));
  }
  /** 아래 칸 하나 닫기: 그 칸만 빠지고 편집기 수가 하나 준다 (남은 칸 트랙은 그대로) */
  function closeExtra(index: number) {
    extraChosen = extraTrackIds.filter((_, k) => k !== index);
    extraStamps = extraTrackIds.map((_, k) => extraStamps[k]).filter((_, k) => k !== index);
    setEditorCount(editorCount - 1);
  }
  // 아래 칸에 연 트랙을 위에서 고르면 그 칸에 원래 위 트랙을 넣는다 (같은 트랙이 두 번 열리지 않게)
  let prevActive: string | undefined;
  let shownExtras: string[] = [];
  $effect(() => {
    const now = activeTrackId;
    untrack(() => {
      const swapped = swapIntoEditors(shownExtras, prevActive, now);
      if (swapped) {
        const slot = shownExtras.indexOf(now!);
        extraChosen = swapped;
        extraStamps = swapped.map((_, k) => (k === slot ? ++extraTick : extraStamps[k]));
      }
      prevActive = now;
    });
  });
  $effect(() => {
    shownExtras = extraTrackIds;
  });

  /** 새로 넣는 음의 v (피아노롤·타브 같이). undefined = 앞 음 v 이어받기 */
  let inputVolume = $state<number | undefined>(undefined);
  /** 피아노롤에서 고른 음들의 v (서로 다르면 null, 고른 음이 없으면 undefined) */
  /** 피아노롤에서 고른 음 (상태줄 음 정보) */
  const selectedNotes = $derived(editor?.selection() ?? []);
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
    { label: t("ui.openFile"), title: t("ui.openFileHelp"), hint: keyOf("file.open"), run: () => void openScoreFile() },
    { label: t("ui.paste"), title: t("ui.pasteHint"), run: () => (paste = { text: "" }) },
    { label: t("ui.recoverMenu"), title: t("ui.recoverMenuHelp"), run: () => void refreshWorks().then(() => (recoverOpen = true)) },
    { separator: true },
    { label: t("ui.saveProject", { ext: PROJECT_EXTENSION }), title: t("ui.saveProjectHelp"), hint: keyOf("file.saveProject"), disabled: !song, run: () => saveProject() },
    // 다른 이름으로 저장: 저장 창을 띄울 수 있는 브라우저(PC 크롬·엣지)에서만
    ...(canAskSave ? [{ label: t("ui.saveProjectAs"), title: t("ui.saveProjectAsHelp"), hint: keyOf("file.saveProjectAs"), disabled: !song, run: () => saveProject(true) }] : []),
    // 프로젝트(.mme) 말고는 하위 메뉴로 (단축키는 그대로 쓴다)
    {
      label: t("ui.menuSaveOther"),
      items: [
        { label: t("ui.save3mle"), hint: keyOf("file.save3mle"), disabled: !song, run: () => save3mle() },
        { label: t("ui.saveMmi"), hint: keyOf("file.saveMmi"), disabled: !song, run: saveMmi },
        { label: t("ui.saveMidi"), title: t("ui.saveMidiHelp"), disabled: !song, run: saveMidi },
        { label: t("ui.saveWav"), title: packs.length === 0 ? t("ui.wavNeedPack") : t("ui.saveWavHelp"), disabled: !song || packs.length === 0 || wavProgress !== undefined, run: saveWav },
      ],
    },
    { separator: true },
    { label: t("ui.outputMenu"), title: t("ui.outputMenuHelp"), disabled: !song, run: openOutput },
    { separator: true },
    { label: t("ui.addPack"), run: () => packInput.click() },
    { label: t("ui.midiKeysConnect"), title: t("ui.midiKeysHelp"), checked: !!midiKeys.status, run: () => void midiKeys.toggle() },
  ]);

  // 아르페지오: 피아노롤에서 고른 음(한 트랙)의 화음을 펼치거나 깔면서 올라간다 (실행 취소 한 칸).
  // 타브에서는 고른 음, 없으면 타브 커서 자리에서 시작하는 화음 (같은 악보 여러 트랙 음을 함께 넘긴다)
  let arpeggio = $state.raw<{ trackId: string; picked: readonly Note[]; cursor?: boolean; redo?: MadeRedo; initial?: ArpMade } | undefined>(undefined);
  const tabArp = $derived(song && viewMode === "tab" ? tabArpPick(song, activeTrackId, tabCursor, selectedNotes) : undefined);
  function openArpeggio() {
    if (!song || !canArpeggio) return;
    // 창으로 만든 아르페지오를 골랐으면 그 아르페지오를 다시 고친다 (펼친 음을 또 펼치면 화음 칸이 없어 만들 것이 없다)
    if (madeArp) {
      reeditMade();
      return;
    }
    if (viewMode === "tab") {
      const pick = song ? tabArpPick(song, activeTrackId, tabCursorForCommand(), selectedNotes) : undefined;
      if (pick) arpeggio = { ...pick, ...(selectedNotes.length === 0 ? { cursor: true } : {}) };
      return;
    }
    if (activeTrackId) arpeggio = { trackId: activeTrackId, picked: selectedNotes };
  }
  function applyArpeggio(result: ArpResult, made: ArpMade) {
    const target = arpeggio;
    const track = target && (target.redo?.base ?? history?.song)?.tracks.find((tr) => tr.id === target.trackId);
    if (!history || !track || staleMade(target.redo?.plan)) return;
    // 타브 커서 자리로 연 아르페지오면 넣기 전에 그 칸을 보인다
    if (target.cursor && selectedNotes.length === 0) tabCursorForCommand();
    // 잠근 트랙을 바꾸는 결과는 넣지 않는다 (계산에서 이미 빼지만, 다른 편집 명령과 같게 적용 직전에도 막는다)
    if (!result.changes.every((c) => editable(c.trackId))) return;
    const command = setNotesAndAddTracks(track.playerId, result.changes, result.newTracks, (n) => t("ui.newTrackName", { n }), t("ui.arpeggio"));
    const next = commit(madeCommand(command, { tool: "arpeggio", options: made, trackId: target.trackId, picked: target.picked.map((n) => n.id) }, redoBase(target.redo)));
    // 만든 음을 골라 두어 바로 되돌리거나 다시 고칠 수 있게
    const id = next?.made?.at(-1)?.id;
    if (next && id) selectNoteIds(next.tracks.flatMap((tr) => tr.notes.filter((n) => n.made === id).map((n) => n.id)));
  }

  // 슬라이드: 고른 음 사이를 반음씩 잇거나, 앞뒤에 미끄러져 들어가고 나가는 음을 붙인다 (실행 취소 한 칸).
  // 고른 음이 여러 트랙(화음)이면 줄마다 자기 트랙에서. 타브는 고른 음, 없으면 커서 자리에서 시작하는 화음 전체.
  // 타브에서 열면 사이 음도 원래 음이 보이는 줄에 놓는다
  let slide = $state.raw<{ picked: readonly Note[]; strings?: ReadonlyMap<string, number>; redo?: MadeRedo; initial?: SlideChoice } | undefined>(undefined);
  const canSlide = $derived(!!song && (selectedNotes.length > 0 || (viewMode === "tab" && tabSlidePick(song, activeTrackId, tabCursor).length > 0)));
  function openSlide() {
    if (!song || !canSlide) return;
    if (viewMode === "roll") {
      slide = { picked: selectedNotes };
      return;
    }
    const picked = selectedNotes.length > 0 ? selectedNotes : tabSlidePick(song, activeTrackId, tabCursorForCommand());
    if (picked.length === 0) return;
    const strings = new Map<string, number>();
    for (const n of picked) {
      const at = tab?.positionOf(n.id);
      if (at) strings.set(n.id, at.string);
    }
    slide = { picked, strings };
  }
  function applySlide(result: SlidesResult, choice: SlideChoice) {
    const target = slide;
    if (!history || !target || result.changes.length === 0 || staleMade(target.redo?.plan)) return;
    // 잠근 트랙은 바꾸지 않는다 (계산·대화상자에서 이미 막지만, 아르페지오처럼 적용 직전에도 막는다)
    if (!result.changes.every((c) => editable(c.trackId))) return;
    const command = setTracksNotes(result.changes.map((c) => ({ trackId: c.trackId, notes: c.notes })), t("ui.slide"));
    const options = { choice, strings: [...(target.strings ?? [])] };
    if (!commit(madeCommand(command, { tool: "slide", options, picked: target.picked.map((n) => n.id) }, redoBase(target.redo)))) return;
    // 만든 사슬 전체를 골라 바로 다시 고칠 수 있게
    if (viewMode === "roll") roll?.selectIds(result.chain);
    else tab?.selectIds(result.chain);
  }
  // 곡 검사 "음색 경계를 넘는 &" → 모두 끊기 (실행 취소 한 칸. 잠근 트랙은 그대로)
  function breakTimbre() {
    if (!history) return;
    const fixed = breakTimbreTies(history.song, profile, (id) => instrumentIdOf(history!.song, id), lockedIds);
    if (fixed.count === 0) return;
    if (!commit(setTracksNotes(fixed.changes, t("ui.breakTimbreTies")))) return;
    // 남은 검사가 없으면 빈 검사 칸을 닫는다
    if ((analysis?.song.length ?? 0) === 0) statusPanel = undefined;
  }
  /** 트랙이 실제로 소리 내는 악기 (음역·샘플 길이·음색 경계를 재생·검사와 같게) */
  function instrumentIdOf(of: Song, trackId: string): string | undefined {
    const tr = of.tracks.find((x) => x.id === trackId);
    if (!tr) return undefined;
    const ref = trackInstrument(of, tr);
    return canonicalOf(ref.canonical, ref.program, ref.packId) ?? ref.canonical;
  }

  // 꾸밈음: 고른 음(본음) 앞에 짧은 음을 붙인다 (실행 취소 한 칸). 피아노롤은 고른 음, 타브는 고른 음이나 없으면 커서 자리 음.
  // 타브에서 열면 본음 줄의 프렛 번호로 높이를 받고, 꾸밈음도 본음이 보이는 줄에 놓는다
  let grace = $state.raw<
    | {
        picked: readonly Note[];
        tab?: { fret: number; string: number; maxFret: number };
        strings?: ReadonlyMap<string, number>;
        redo?: MadeRedo;
        initial?: GraceChoice;
      }
    | undefined
  >(undefined);
  const canGrace = $derived(!!song && (viewMode === "roll" ? !!activeTrackId && selectedNotes.length > 0 : selectedNotes.length > 0 || !!tabArp));
  function openGrace() {
    if (!song || !canGrace) return;
    if (viewMode === "roll") {
      grace = { picked: selectedNotes };
      return;
    }
    // 커서 자리면 그 자리 화음 가운데 고른 트랙(없으면 위쪽 트랙)의 첫 음 하나
    const picked = selectedNotes.length > 0 ? selectedNotes : (tabArpPick(song, activeTrackId, tabCursorForCommand(), [])?.picked.slice(0, 1) ?? []);
    if (picked.length === 0) return;
    const strings = new Map<string, number>();
    for (const n of picked) {
      const at = tab?.positionOf(n.id);
      if (at) strings.set(n.id, at.string);
    }
    // 기준 본음: 가장 먼저 시작하는 음 중 가장 높은 음 (화음이면 꾸밈음을 붙이는 음)
    const ref = [...picked].sort((a, b) => cmp(a.start, b.start) || b.pitch - a.pitch)[0]!;
    const at = tab?.positionOf(ref.id);
    grace = { picked, strings, ...(at ? { tab: { fret: at.fret, string: at.string, maxFret: tuning.maxFret } } : {}) };
  }
  function applyGrace(result: GraceResult, choice: GraceChoice) {
    const target = grace;
    if (!history || !target || result.changes.length === 0 || staleMade(target.redo?.plan)) return;
    // 잠근 트랙은 바꾸지 않는다 (계산에서 이미 건너뛰지만, 다른 편집 명령과 같게 적용 직전에도 막는다)
    if (!result.changes.every((c) => editable(c.trackId))) return;
    const command = setTracksNotes(result.changes.map((c) => ({ trackId: c.trackId, notes: c.notes })), t("ui.grace"));
    const options = { choice, ...(target.tab ? { tab: target.tab } : {}), strings: [...(target.strings ?? [])] };
    if (!commit(madeCommand(command, { tool: "grace", options, picked: target.picked.map((n) => n.id) }, redoBase(target.redo)))) return;
    if (viewMode === "roll") roll?.selectIds(result.ids);
    else tab?.selectIds(result.ids);
  }

  // 트릴·트레몰로: 고른 음을 짧은 음 여러 개로 나눈다 (실행 취소 한 칸). 고르는 법은 꾸밈음과 같다:
  // 피아노롤은 고른 음, 타브는 고른 음이나 없으면 커서 자리 음. 타브에서 열면 상대 음을 본음 줄의 프렛 번호로 받는다
  let trill = $state.raw<
    | {
        picked: readonly Note[];
        tab?: { fret: number; string: number; maxFret: number };
        strings?: ReadonlyMap<string, number>;
        redo?: MadeRedo;
        initial?: TrillChoice;
      }
    | undefined
  >(undefined);
  function openTrill() {
    if (!song || !canGrace) return;
    if (viewMode === "roll") {
      trill = { picked: selectedNotes };
      return;
    }
    const picked = selectedNotes.length > 0 ? selectedNotes : (tabArpPick(song, activeTrackId, tabCursorForCommand(), [])?.picked.slice(0, 1) ?? []);
    if (picked.length === 0) return;
    const strings = new Map<string, number>();
    for (const n of picked) {
      const at = tab?.positionOf(n.id);
      if (at) strings.set(n.id, at.string);
    }
    // 기준 본음: 가장 먼저 시작하는 음 중 가장 높은 음 (화음이면 트릴을 거는 음)
    const ref = [...picked].sort((a, b) => cmp(a.start, b.start) || b.pitch - a.pitch)[0]!;
    const at = tab?.positionOf(ref.id);
    trill = { picked, strings, ...(at ? { tab: { fret: at.fret, string: at.string, maxFret: tuning.maxFret } } : {}) };
  }
  function applyTrill(result: TrillResult, choice: TrillChoice) {
    const target = trill;
    if (!history || !target || result.changes.length === 0 || staleMade(target.redo?.plan)) return;
    // 잠근 트랙은 바꾸지 않는다 (계산에서 이미 건너뛰지만, 다른 편집 명령과 같게 적용 직전에도 막는다)
    if (!result.changes.every((c) => editable(c.trackId))) return;
    const command = setTracksNotes(result.changes.map((c) => ({ trackId: c.trackId, notes: c.notes })), t("ui.trill"));
    const options = { choice, ...(target.tab ? { tab: target.tab } : {}), strings: [...(target.strings ?? [])] };
    if (!commit(madeCommand(command, { tool: "trill", options, picked: target.picked.map((n) => n.id) }, redoBase(target.redo)))) return;
    selectNoteIds(result.ids);
  }

  // 만든 것 되돌리기·다시 고치기: 아르페지오·꾸밈음·슬라이드·트릴 창으로 만든 음에 남긴 기록(Song.made, .mme에만 저장)으로
  // 원래 음을 돌려놓거나, 원래 음으로 되돌린 곡에서 그 창을 옛 설정으로 다시 연다 (적용하면 되돌리기와 새로 만들기가 실행 취소 한 칸)
  type MadeRedo = { readonly record: string; readonly plan: Extract<MadeRestore, { ok: true }>; readonly base: Song; readonly title: string };
  /** 기록을 볼 음: 고른 음, 타브는 없으면 커서 자리 화음 */
  const madePick = $derived.by(() => {
    if (selectedNotes.length > 0) return selectedNotes;
    if (viewMode !== "tab" || !song) return [];
    if (tabArp) return tabArp.picked;
    // 커서가 만든 음 한가운데(음 시작이 아닌 자리)에 있으면 그 자리에서 울리는 만든 음 (펼친 아르페지오 칸 안 등)
    const player = song.tracks.find((tr) => tr.id === activeTrackId)?.playerId;
    const at = tabCursor;
    if (player === undefined || !at) return [];
    return song.tracks
      .filter((tr) => tr.playerId === player)
      .flatMap((tr) => tr.notes.filter((n) => n.made !== undefined && cmp(n.start, at) <= 0 && cmp(at, add(n.start, n.dur)) < 0));
  });
  const madeHere = $derived(song?.made ? madeOf(song, madePick.map((n) => n.id)) : []);
  /** 고른 음(타브는 커서 자리)이 창으로 만든 아르페지오 하나면 아르페지오 메뉴가 다시 고치기를 연다 */
  const madeArp = $derived(madeHere.length === 1 && madeHere[0]!.tool === "arpeggio");
  /** 아르페지오 메뉴: 피아노롤은 고른 음, 타브는 커서 자리 화음. 만든 아르페지오를 골랐으면 다시 고치기 */
  const canArpeggio = $derived(!!song && ((viewMode === "roll" ? !!activeTrackId && selectedNotes.length > 0 : !!tabArp) || madeArp));
  /** 다시 고치기면 적용할 때 먼저 옛 기록을 되돌린 곡에서 시작한다 */
  const redoBase = (redo: MadeRedo | undefined) => (redo ? (s: Song) => applyMadeRestore(s, redo.plan) : undefined);
  /** 계획을 세운 뒤(창을 연 사이 MIDI 건반 입력 등) 곡 음이 바뀌었으면 넣지 않고 알린다 */
  function staleMade(plan: Extract<MadeRestore, { ok: true }> | undefined): boolean {
    if (!plan || !history || sameNotes(history.song, plan.from)) return false;
    error = t("ui.madeStale");
    return true;
  }
  function selectNoteIds(ids: readonly string[]) {
    if (viewMode === "roll") roll?.selectIds(ids);
    else tab?.selectIds(ids);
  }
  /** 되돌리기 계획. 안 되면 까닭을 알리고 걸리는 음을 고른다. 만든 뒤 손댄 음이 있으면 묻는다 */
  function madePlan(ids: readonly string[]): Extract<MadeRestore, { ok: true }> | undefined {
    if (!history || ids.length === 0) return undefined;
    const plan = restoreMade(history.song, ids);
    if (!plan.ok) {
      const key = { occupied: "ui.madeBlockedOccupied", nested: "ui.madeBlockedNested", track: "ui.madeBlockedTrack", range: "ui.madeBlockedRange" } as const;
      error = t(key[plan.reason]);
      if (plan.blocking.length > 0) selectNoteIds(plan.blocking);
      return undefined;
    }
    if (plan.changes.some((c) => lockedIds.has(c.trackId)) || plan.removeTracks.some((id) => lockedIds.has(id))) {
      error = t("ui.madeLocked");
      return undefined;
    }
    if (plan.edited > 0 && !confirm(t("ui.madeEditedConfirm", { n: plan.edited }))) return undefined;
    return plan;
  }
  /** 아르페지오 되돌리기 창 (트랙을 골라 되돌린다). 꾸밈음·슬라이드는 창 없이 바로 */
  let madeRestoreOpen = $state.raw<{ records: readonly string[] } | undefined>(undefined);
  function restoreMadeHere() {
    if (!song) return;
    const ids = madeHere.map((r) => r.id);
    if (madeHere.some((r) => r.tool === "arpeggio") && madeTracks(song, ids).length > 1) {
      madeRestoreOpen = { records: ids };
      return;
    }
    const plan = madePlan(ids);
    if (plan) applyMadeRestorePlan(plan);
  }
  /** 다시 고치기 창의 "원래대로": 열 때 세운(손댄 음은 이미 물은) 계획으로 되돌린다. 아르페지오가 여러 트랙에 걸치면 트랙 고르는 창 */
  function restoreFromDialog(redo: MadeRedo | undefined, arp = false) {
    if (!redo || !song || staleMade(redo.plan)) return;
    if (arp && madeTracks(song, [redo.record]).length > 1) madeRestoreOpen = { records: [redo.record] };
    else applyMadeRestorePlan(redo.plan);
  }
  function applyMadeRestorePlan(plan: Extract<MadeRestore, { ok: true }>) {
    if (staleMade(plan) || !commit(restoreMadeCommand(plan, t("ui.madeRestore")))) return;
    selectNoteIds([...plan.ids.values()]);
  }
  function reeditMade() {
    const record = madeHere.length === 1 ? madeHere[0]! : undefined;
    const plan = record && madePlan([record.id]);
    if (!history || !record || !plan) return;
    const base = applyMadeRestore(history.song, plan);
    const id = (old: string) => plan.ids.get(old) ?? old;
    const byId = new Map(base.tracks.flatMap((tr) => tr.notes.map((n) => [n.id, n] as const)));
    const picked = record.picked.map((old) => byId.get(id(old))).filter((n): n is Note => n !== undefined);
    if (picked.length === 0) return;
    const tool = t(record.tool === "arpeggio" ? "ui.arpeggio" : record.tool === "grace" ? "ui.grace" : record.tool === "trill" ? "ui.trill" : "ui.slide");
    const redo: MadeRedo = { record: record.id, plan, base, title: t("ui.madeReeditTitle", { tool }) };
    const stringsOf = (list: readonly (readonly [string, number])[]) => new Map(list.map(([old, string]) => [id(old), string] as const));
    if (record.tool === "arpeggio") {
      const trackId = record.trackId;
      if (!trackId || !base.tracks.some((tr) => tr.id === trackId)) return;
      arpeggio = { trackId, picked, redo, initial: parseArpMade(record.options) };
    } else if (record.tool === "grace") {
      const made = parseGraceMade(record.options);
      grace = { picked, redo, initial: made.choice, strings: stringsOf(made.strings), ...(made.tab ? { tab: made.tab } : {}) };
    } else if (record.tool === "trill") {
      const made = parseTrillMade(record.options);
      trill = { picked, redo, initial: made.choice, strings: stringsOf(made.strings), ...(made.tab ? { tab: made.tab } : {}) };
    } else {
      const made = parseSlideMade(record.options);
      slide = { picked, redo, initial: made.choice, strings: stringsOf(made.strings) };
    }
  }

  // 아르페지오로 알아보기: 기록 없는 아르페지오(전 판에서 만들었거나 .mml로 다시 연 곡)를 고른 음의 배치로 짐작해 만든 기록을 남긴다.
  // 고른 음만 본다 (보통 선율도 아르페지오와 모양이 같을 수 있어 곡을 저절로 훑지 않는다). 짐작한 화음을 보여 주고 물어본 뒤 넣는다 (실행 취소 한 칸)
  // 한 음만 골라도 된다: 못 찾으면 그 둘레(같은 악보에서 시간이 겹쳐 이어지는 음, 그 트랙에서 빈틈없이 이어진 음)로 넓혀 본다
  const canAdoptArp = $derived(!!song && selectedNotes.length >= 1 && madeHere.length === 0);
  function adoptArpeggio() {
    if (!history || !canAdoptArp) return;
    const song0 = history.song;
    const used = new Set(song0.tracks.flatMap((tr) => tr.notes.map((n) => n.id)));
    let k = 0;
    const newId = () => {
      let id: string;
      do id = `ag${++k}`;
      while (used.has(id));
      used.add(id);
      return id;
    };
    const guess = guessArpeggioAround(song0, selectedNotes, newId, lockedIds);
    if (!guess.ok) {
      error = t(guess.reason === "made" ? "ui.arpAdoptMade" : guess.reason === "score" ? "ui.arpAdoptScore" : "ui.arpAdoptNone");
      if (guess.blocking.length > 0) selectNoteIds(guess.blocking);
      return;
    }
    const made = arpMadeOfGuess(guess);
    const styleKey = { spread: "ui.arpStyleSpread", strum: "ui.arpStyleStrum", roll: "ui.arpStyleRoll" } as const;
    const orderKey = { up: "ui.arpOrderUp", down: "ui.arpOrderDown", updown: "ui.arpOrderUpDown", random: "ui.arpOrderRandom" } as const;
    const shown = guess.cells.slice(0, 4).map((c) => `${positionText(song0.timeSig, c.start)} ${c.pitches.map(pitchText).join("·")}`);
    const lines = [
      t("ui.arpAdoptConfirm", { cells: guess.cells.length, style: t(styleKey[guess.style]), order: t(orderKey[guess.order]), length: made.choice.length === "grid" ? "-" : made.choice.length }),
      ...shown,
      ...(guess.cells.length > shown.length ? ["…"] : []),
      ...(guess.dropped > 0 ? [t("ui.arpAdoptDropped", { n: guess.dropped })] : []),
      ...(guess.skipped > 0 ? [t("ui.arpAdoptSkipped", { n: guess.skipped })] : []),
      t("ui.arpAdoptAsk"),
    ];
    if (!confirm(lines.join("\n"))) return;
    const next = commit(adoptMadeCommand({ tool: "arpeggio", options: made, trackId: guess.trackId, picked: guess.picked }, guess.before, guess.after, t("ui.arpAdopt")));
    if (!next || next === song0) return;
    selectNoteIds(guess.after.flatMap((g) => g.notes.map((n) => n.id)));
    flash(t("ui.arpAdoptDone"));
  }

  // 실험실 (설정 → 실험실을 켰을 때만 메뉴가 보인다): 고른 음을 고스트 노트·하모닉스로 (실행 취소 한 칸).
  // 피아노롤은 고른 음, 타브는 고른 음이나 없으면 커서 자리 음. 타브에서 열면 음이 놓인 줄·프렛을 넘겨 자연 하모닉스를 계산한다
  let labDialog = $state.raw<
    { kind: Exclude<LabFeatureId, "reverb" | "midiRecord" | "tempoRamp" | "videoBars" | "arpFold" | "loudness">; picked: readonly Note[]; positions?: ReadonlyMap<string, { string: number; fret: number; open: number }> } | undefined
  >(undefined);
  const canLab = $derived(!!song && (viewMode === "roll" ? selectedNotes.length > 0 : selectedNotes.length > 0 || !!tabArp));
  function openLab(kind: Exclude<LabFeatureId, "reverb" | "midiRecord" | "tempoRamp" | "videoBars" | "arpFold" | "loudness">) {
    if (!song || !canLab || !labs.on) return;
    if (viewMode === "roll") {
      labDialog = { kind, picked: selectedNotes };
      return;
    }
    const picked = selectedNotes.length > 0 ? selectedNotes : (tabArpPick(song, activeTrackId, tabCursorForCommand(), [])?.picked ?? []);
    if (picked.length === 0) return;
    const positions = new Map<string, { string: number; fret: number; open: number }>();
    for (const n of picked) {
      const at = tab?.positionOf(n.id);
      const open = at ? tuning.strings[at.string - 1] : undefined;
      if (at && open !== undefined) positions.set(n.id, { string: at.string, fret: at.fret, open: open + tuning.capo });
    }
    labDialog = { kind, picked, positions };
  }
  function applyLab(result: { readonly changes: LabResult["changes"]; readonly ids: readonly string[] }, label: string) {
    if (!history || result.changes.length === 0) return;
    if (!result.changes.every((c) => editable(c.trackId))) return;
    if (!commit(setTracksNotes(result.changes.map((c) => ({ trackId: c.trackId, notes: c.notes })), label))) return;
    if (viewMode === "roll") roll?.selectIds(result.ids);
    else tab?.selectIds(result.ids);
  }
  // 실험실 울림: 울림 넣기 창(고른 음이나 지금 트랙에서 조건에 맞는 음)과 울림 찍기 (피아노롤 도구로 누른 자리, 타브·메뉴는 커서 자리부터)
  let reverbDialog = $state.raw<{ trackId: string; picked: readonly Note[] } | undefined>(undefined);
  function openReverb() {
    if (!song || !activeTrackId || !labs.on) return;
    reverbDialog = { trackId: activeTrackId, picked: selectedNotes };
  }
  // 실험실 원곡 대조 셈여림 (보기만): 원곡 세기 요약은 처음 열 때 한 번 만들고 원곡을 바꾸면 버린다
  let loudnessOpen = $state(false);
  let referencePower = $state.raw<ReferencePower | undefined>(undefined);
  function openLoudness() {
    if (!song || !reference || !labs.on) return;
    referencePower ??= engine.referencePower();
    if (referencePower) loudnessOpen = true;
  }
  $effect(() => {
    if (!labs.on && loudnessOpen) loudnessOpen = false;
  });
  function stampReverb(trackId: string, noteId: string, at: Rat) {
    if (!song || !history || !labs.on) return;
    const used = new Set(song.tracks.flatMap((tr) => tr.notes.map((n) => n.id)));
    let k = 0;
    const newId = () => {
      let id: string;
      do id = `rv${++k}`;
      while (used.has(id));
      used.add(id);
      return id;
    };
    const r = planReverbStamp(song, trackId, noteId, at, stampTail(reverbPrefs.choice), profile, { locked: lockedIds, canWrite: (d) => canWriteExactly(d, profile.length), newId });
    if (r.changes.length === 0) {
      error = t("ui.labReverbStampNone");
      return;
    }
    applyLab(r, t("ui.labReverbStamp"));
  }
  /** 커서 자리 음에 울림 찍기 (타브 커서, 피아노롤은 재생 커서). 커서가 음 시작이면 끝에서부터 놓는다 */
  function stampReverbAtCursor() {
    if (!song || !activeTrackId) return;
    const at = viewMode === "tab" ? tabCursorForCommand() : editCursor();
    const track = song.tracks.find((tr) => tr.id === activeTrackId);
    const note = at && track?.notes.find((n) => cmp(n.start, at) <= 0 && cmp(at, add(n.start, n.dur)) < 0);
    if (!at || !note) {
      error = t("ui.labReverbStampNone");
      return;
    }
    stampReverb(activeTrackId, note.id, at);
  }
  $effect(() => {
    if (!labs.on && rollTool === "reverb") rollTool = "pen";
  });
  const tempoRampItem: MenuItem = $derived({
    label: t("ui.tempoRamp") + "…",
    title: tempoRampRange ? t("ui.tempoRampHelp") : t("ui.tempoRampNoRange"),
    disabled: !tempoRampRange,
    run: openTempoRamp,
  });
  const labsMenu: MenuItem[] = $derived([
    ...LAB_FEATURES.filter((f) => f.id !== "reverb" && f.id !== "midiRecord" && f.id !== "tempoRamp" && f.id !== "videoBars" && f.id !== "arpFold" && f.id !== "loudness").map((f) => ({ label: t(f.label) + "…", title: t(f.help), disabled: !canLab, run: () => openLab(f.id as Exclude<LabFeatureId, "reverb" | "midiRecord" | "tempoRamp" | "videoBars" | "arpFold" | "loudness">) })),
    { separator: true },
    { label: t("ui.labReverb") + "…", title: t("ui.labReverbHelp"), disabled: !song || !activeTrackId, run: openReverb },
    { label: t("ui.labReverbStampCursor"), title: t("ui.labReverbStampCursorHelp"), disabled: !song || !activeTrackId, run: stampReverbAtCursor },
    { separator: true },
    { label: t("ui.labMidiRecord"), title: t("ui.labMidiRecordHelp"), checked: recordOpen, disabled: !song, run: toggleRecord },
    { label: t("ui.labVideoBars"), title: t("ui.labVideoBarsHelp"), checked: videoBarsOpen, disabled: !song, run: toggleVideoBars },
    { separator: true },
    tempoRampItem,
    { separator: true },
    { label: t("ui.labLoudness") + "…", title: reference ? t("ui.labLoudnessHelp") : t("ui.loudnessNoReference"), disabled: !song || !reference, run: openLoudness },
  ]);

  const editMenu: MenuItem[] = $derived([
    { label: t("ui.undo"), hint: keyOf("edit.undo"), disabled: !canUndo, run: undo },
    { label: t("ui.redo"), hint: keyOf("edit.redo"), disabled: !canRedo, run: redo },
    { separator: true },
    { label: t("ui.selectAll"), title: t("ui.selectHelp"), hint: keyOf("edit.selectAll"), disabled: !song, run: () => run("edit.selectAll") },
    { label: t("ui.deleteNotes"), hint: keyOf("note.delete"), disabled: !song, run: () => run("note.delete") },
    { label: t("ui.cut"), hint: keyOf("edit.cut"), disabled: !song, run: () => run("edit.cut") },
    { label: t("ui.copy"), hint: keyOf("edit.copy"), disabled: !song, run: () => run("edit.copy") },
    { label: t("ui.pasteNotes"), title: t("ui.pasteNotesHelp"), hint: keyOf("edit.paste"), disabled: !song || !noteClipboard.clip, run: () => run("edit.paste") },
    { separator: true },
    // 한 음 고치기는 모두 단축키가 있어 하위 메뉴로 묶는다
    {
      label: t("ui.menuNoteEdit"),
      items: [
        { label: t("ui.lengthDouble"), hint: keyOf("edit.lengthDouble"), disabled: !song, run: () => run("edit.lengthDouble") },
        { label: t("ui.lengthHalf"), hint: keyOf("edit.lengthHalf"), disabled: !song, run: () => run("edit.lengthHalf") },
        { label: t("ui.dotToggle"), title: t("ui.dotToggleHelp"), hint: keyOf("edit.dotToggle"), disabled: !song, run: () => run("edit.dotToggle") },
        { separator: true },
        { label: t("cmd.note.volumeUp"), hint: keyOf("note.volumeUp"), disabled: !song, run: () => run("note.volumeUp") },
        { label: t("cmd.note.volumeDown"), hint: keyOf("note.volumeDown"), disabled: !song, run: () => run("note.volumeDown") },
        { label: t("cmd.note.octaveUp"), hint: keyOf("note.octaveUp"), disabled: !song, run: () => run("note.octaveUp") },
        { label: t("cmd.note.octaveDown"), hint: keyOf("note.octaveDown"), disabled: !song, run: () => run("note.octaveDown") },
        { separator: true },
        { label: t("cmd.note.tie"), hint: keyOf("note.tie"), disabled: !song, run: () => run("note.tie") },
        { label: t("cmd.note.split"), hint: keyOf("note.split"), disabled: !song || (viewMode === "roll" ? cursor === undefined : tabCursor === undefined), run: () => run("note.split") },
        { label: t("cmd.note.glue"), hint: keyOf("note.glue"), disabled: !song, run: () => run("note.glue") },
      ],
    },
    { separator: true },
    { label: t("ui.arpeggio") + "…", title: t("ui.arpeggioHelp"), disabled: !canArpeggio, run: openArpeggio },
    { label: t("ui.slide") + "…", title: t("ui.slideHelp"), disabled: !canSlide, run: openSlide },
    { label: t("ui.grace") + "…", title: t("ui.graceHelp"), disabled: !canGrace, run: openGrace },
    { label: t("ui.trill") + "…", title: t("ui.trillHelp"), disabled: !canGrace, run: openTrill },
    { label: t("ui.madeRestore"), title: madeHere.length > 0 ? t("ui.madeRestoreHelp") : t("ui.madeNone"), disabled: madeHere.length === 0, run: restoreMadeHere },
    { label: t("ui.madeReedit") + "…", title: madeHere.length > 0 ? t("ui.madeReeditHelp") : t("ui.madeNone"), disabled: madeHere.length !== 1, run: reeditMade },
    { label: t("ui.arpAdopt") + "…", title: t("ui.arpAdoptHelp"), disabled: !canAdoptArp, run: adoptArpeggio },
  ]);

  const songMenu: MenuItem[] = $derived([
    { label: t("ui.transpose") + "…", hint: keyOf("edit.transpose"), disabled: !song, run: () => run("edit.transpose") },
    { label: t("ui.volumeBulk") + "…", title: t("ui.volumeBulkHelp"), hint: keyOf("edit.volume"), disabled: !song, run: () => run("edit.volume") },
    { label: t("ui.voiceMenu"), title: t("ui.voiceHelp"), disabled: !song || !activeTrackId, run: openVoice },
    { label: t("ui.meterChange"), title: t("ui.meterHelp"), disabled: !song, run: () => (meterOpen = true) },
    {
      label: t("ui.menuTempo"),
      items: [
        { label: t("ui.tapTempo"), title: t("ui.tapTempoHelp"), checked: tapOpen, disabled: !song, run: toggleTap },
        {
          label: (loop ? t("ui.tempoClearLoop") : t("ui.tempoClearAll")) + ` (${tempoClearTargets.length})`,
          title: t("ui.tempoClearHelp"),
          disabled: tempoClearTargets.length === 0,
          run: clearTempos,
        },
        {
          label: (loop ? t("ui.tempoChangeLoop") : t("ui.tempoChange")) + "…",
          title: t("ui.tempoChangeHelp"),
          disabled: !song,
          run: () => (tempoChangeOpen = true),
        },
        // 실험실을 켜면 템포 하위 메뉴에도 보인다
        ...(labs.on ? [tempoRampItem] : []),
        {
          label: t("ui.tempoFillScores") + ` (${tempoMissing})`,
          title: t("ui.tempoFillScoresHelp"),
          disabled: tempoMissing === 0,
          run: () => runIfChanged(fillScoreTempo(t("ui.tempoFillScores"))),
        },
      ],
    },
    { label: t("ui.offgrid") + "…", title: t("ui.offgridHelp"), disabled: !song, run: () => (offgridOpen = true) },
    { label: t("ui.foldReview") + "…", title: t("ui.foldReviewHelp"), disabled: !song, run: () => (foldOpen = true) },
    { separator: true },
    { label: t("ui.addTrackMenu"), title: t("ui.addTrackHelp"), disabled: !activePlayer, run: addTrackToPlayer },
    { label: t("ui.addScoreMenu"), title: t("ui.addPlayerHelp"), disabled: !song, run: () => (addScoreOpen = true) },
    { separator: true },
    // MML로 내보내기는 파일 메뉴와 패널 ⋯ 메뉴에 있다
    {
      label: t("ui.menuFitChars"),
      items: [
        { label: t("ui.distribute") + "…", title: t("ui.distributeHelp"), disabled: !song, run: () => (spreadOpen = {}) },
        { label: t("ui.merge") + "…", title: t("ui.mergeHelp"), disabled: !song, run: () => (mergeOpen = true) },
        { label: t("ui.compact") + "…", title: t("ui.compactHelp"), disabled: !song, run: compact },
        { label: t("ui.split") + "…", disabled: !song || splitting, run: runSplit },
      ],
    },
  ]);

  /** 고른 음 길이 ×2·½ (첫 음 시작 기준으로 리듬 모양을 지킨다) */
  function scaleSelection(factor: Rat, label: string): boolean {
    if ((editor?.selection().length ?? 0) === 0) return false;
    // 고르지 않은 음은 지우거나 줄이지 않는다: 그 음 앞까지만 늘리고, 늘릴 자리가 없으면 바꾸지 않는다 (타브는 트랙마다 같은 기준)
    if (editor?.scaleSelected(factor, label)) return true;
    refuse(t("ui.lengthNoRoom"));
    return false;
  }

  const hasSelection = () => (editor?.selection().length ?? 0) > 0;

  /** 키로 한 편집을 거절할 때: 같은 알림을 전에 닫았어도 누를 때마다 다시 띄운다 (닫은 뒤 키가 먹통처럼 보이지 않게) */
  function refuse(message: string) {
    error = message;
    dismissedSig = "";
  }

  /**
   * `.` 키: 고른 음(타브는 고른 음이 없으면 커서 음)에 점을 붙이거나 뗀다 (길이 ×2와 같은 scaleNotesIn 규칙, 트랙마다).
   * 점은 정확히 붙이거나 아예 안 붙인다: 다음 음과 겹치면 다음 음 앞까지 어중간하게 늘리지 않고 알린다 (뒤 음은 밀거나 지우지 않는다).
   * 바꿀 음이 없으면 새 음 길이에. 한 토큰으로 쓸 수 없는 길이면 바꾸지 않고 알린다
   */
  function toggleDotLength(): boolean {
    if (!song) return false;
    const picked = editor?.selection() ?? [];
    const cursorNote = picked.length === 0 && viewMode === "tab" ? tab?.cursorLengthNote() : undefined;
    const notes = picked.length > 0 ? picked : cursorNote ? [cursorNote] : [];
    if (notes.length === 0) {
      // 새 음 길이: 고르기 목록에 있는 길이만 (목록 밖이면 바꾸지 않고 알린다)
      const next = toggleDot(noteLengthOf(noteLength, division), profile);
      const found = next && noteLengths.find((l) => l !== "grid" && cmp(noteLengthOf(l, division), next) === 0);
      if (found) noteLength = found;
      else refuse(t("ui.dotNoLength"));
      return true;
    }
    const factor = dotFactor(notes.map((n) => n.dur), profile);
    if (!factor) {
      refuse(t("ui.dotNoLength"));
      return true;
    }
    const label = t("ui.dotToggle");
    const done = viewMode === "tab" ? tab?.scaleSelected(factor, label, cursorNote ? [cursorNote.id] : undefined, true) : roll?.scaleSelected(factor, label, true);
    if (!done) refuse(t("ui.dotNoRoom"));
    // 바뀌었으면 앞서 거절한 점·길이 알림은 지난 일이라 지운다
    else if ([t("ui.dotNoRoom"), t("ui.dotNoLength"), t("ui.lengthNoRoom")].includes(error)) error = "";
    return true;
  }
  /** 고른 음이 없을 때: 새 음 길이를 ×2·½ (타브의 +/−와 같은 규칙. 격자면 격자 한 칸에서, 목록 밖이면 그대로) */
  function stepNewLength(factor: 2 | 0.5): boolean {
    const length = stepNoteLength(noteLengthOf(noteLength, division), factor, profile.length, noteLengths);
    if (length) noteLength = length;
    return true;
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
        const range = trackSoundingRange(profile, song, track, canonicalOf);
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
    if (changes.length > 0) commit(setTracksNotes(changes, label));
  }

  // 볼륨 일괄 조정: 고른 음(피아노롤·타브)·트랙·악보·곡 전체의 v를 한 값으로 / ±N / 목표 dB로. 실행 취소 한 칸
  let volumeOpen = $state<{ scope: TransposeScope; vol: number } | undefined>(undefined);

  function openVolume() {
    if (!song) return;
    const picked = editor?.selection().length ?? 0;
    const scope: TransposeScope = picked > 0 ? "selection" : activeTrackId ? "track" : "song";
    // 처음 보이는 한 값: 범위 안 소리들의 가운데 v
    const heads = volumeTargets(scope).flatMap(({ notes, picked }) => tieChains(notes).filter((c) => !picked || picked.has(c[0]!.id)).map((c) => c[0]!.vol));
    heads.sort((a, b) => a - b);
    volumeOpen = { scope, vol: heads[Math.floor(heads.length / 2)] ?? 10 };
  }

  /** 범위에 드는 트랙과 그 안에서 바꿀 음 id (없으면 트랙 전체) */
  function volumeTargets(scope: TransposeScope, bars?: readonly BarRange[]): { track: Track; notes: readonly Note[]; picked?: ReadonlySet<string> }[] {
    if (!song) return [];
    if (scope !== "selection" && !bars) return transposeTargets(scope).map(({ track }) => ({ track, notes: track.notes }));
    if (scope !== "selection") {
      // 마디 범위: 범위 안에서 시작하는 소리만. 범위에 소리가 없는 트랙은 빼서 잠금 확인에도 끼지 않게 한다
      const timeSig = song.timeSig;
      return transposeTargets(scope)
        .map(({ track }) => ({ track, notes: track.notes, picked: headsInBars(track.notes, timeSig, bars!) }))
        .filter((x) => x.picked.size > 0);
    }
    // 타브는 한 연주자의 여러 트랙에서 고른다. 고른 음은 곡 트랙의 음 그대로라 객체로 찾는다
    const chosen = new Set(editor?.selection() ?? []);
    return song.tracks
      .map((track) => ({ track, notes: track.notes, picked: new Set(track.notes.filter((n) => chosen.has(n)).map((n) => n.id)) }))
      .filter((x) => x.picked.size > 0);
  }

  function checkVolume(scope: TransposeScope, change: VolumeChange, bars?: readonly BarRange[]): VolumeCheck {
    let count = 0;
    let changed = 0;
    let clamped = 0;
    let viaTie = 0;
    let before: [number, number] | undefined;
    let after: [number, number] | undefined;
    const widen = (a: [number, number] | undefined, b: readonly [number, number] | undefined): [number, number] | undefined =>
      !b ? a : !a ? [b[0], b[1]] : [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
    for (const { notes, picked } of volumeTargets(scope, bars)) {
      const r = changeVolumes(notes, change, profile, picked);
      count += r.count;
      changed += r.changed;
      clamped += r.clamped;
      viaTie += r.viaTie;
      before = widen(before, volumeSpan(notes, picked));
      after = widen(after, volumeSpan(r.notes, picked));
    }
    return { count, changed, clamped, viaTie, before, after };
  }

  function applyVolume(scope: TransposeScope, change: VolumeChange, bars?: readonly BarRange[]) {
    if (!history) return;
    const targets = volumeTargets(scope, bars);
    const locked = lockedNames(targets.map(({ track }) => track.id));
    if (locked && !confirm(t("ui.volumeLockedConfirm", { names: locked }))) return;
    const changes = targets.flatMap(({ track, notes, picked }) => {
      const r = changeVolumes(notes, change, profile, picked);
      return r.notes.some((n, i) => n !== notes[i]) ? [{ trackId: track.id, notes: r.notes }] : [];
    });
    if (changes.length > 0) commit(setTracksNotes(changes, t("ui.volumeBulk")));
  }

  // 타브 그대로 튜닝 바꾸기: 잘못 고른 튜닝으로 친 타브의 줄·프렛 숫자를 지키고 음 높이를 새 튜닝 것으로 바꾼다
  let retuning = $state(false);
  function openRetune() {
    retuning = true;
  }

  /** 타브에 보이는 트랙 (고른 트랙의 악보, 소리 켠 트랙. TabView와 같다) */
  function tabTracks(): Track[] {
    return song?.tracks.filter((tr) => tr.playerId === tabScore && !tr.mute) ?? [];
  }

  function tabTuningOf(to: ScoreTuning): TabTuning {
    return { ...STANDARD_TUNING, strings: TUNINGS[to.tuning].strings, capo: to.capo };
  }

  function planRetune(to: ScoreTuning) {
    return retuneKeepingTab(tabTracks(), tuning, tabTuningOf(to));
  }

  function checkRetune(to: ScoreTuning): RetuneCheck {
    const { changes, moved, kept } = planRetune(to);
    let folded = 0;
    for (const { trackId, notes } of changes) {
      const track = song?.tracks.find((tr) => tr.id === trackId);
      if (!song || !track) continue;
      const before = new Map(track.notes.map((n) => [n.id, n.pitch]));
      const range = trackSoundingRange(profile, song, track, canonicalOf);
      folded += notes.filter((n) => before.get(n.id) !== n.pitch && foldPitch(n.pitch, range) !== n.pitch).length;
    }
    return { moved, kept, folded };
  }

  function applyRetune(to: ScoreTuning) {
    if (!history || tabScore === undefined) return;
    const { changes } = planRetune(to);
    if (changes.length === 0) return;
    const locked = lockedNames(changes.map((c) => c.trackId));
    if (locked && !confirm(t("ui.retuneLockedConfirm", { names: locked }))) return;
    commit(retuneCommand(tabScore, to, changes, t("ui.retune")));
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
    if (!commit(applyPlan(plan, label))) return;
    voicePrefs = { mode, order: o.order };
    saveStored(VOICE_STORAGE, JSON.stringify(voicePrefs));
    flash(plan.blocked > 0 ? t("ui.voiceDoneBlocked", { moved: plan.moved, blocked: plan.blocked }) : t("ui.voiceDone", { moved: plan.moved }));
  }

  // 건반 불·트랙 색은 설정 창(재생·보기)에만 둔다
  const viewMenu: MenuItem[] = $derived([
    { label: t("ui.pianoRoll"), checked: viewMode === "roll", run: () => showView("roll") },
    { label: t("ui.tabView"), checked: viewMode === "tab", hint: keyOf("view.tab"), run: () => showView("tab") },
    { separator: true },
    { label: t("ui.dockBottom"), title: t("ui.dockHelp"), checked: paneDock === "bottom", run: () => setDock("bottom") },
    { label: t("ui.dockRight"), title: t("ui.dockHelp"), checked: paneDock === "right", run: () => setDock("right") },
    { label: t("ui.sideBySide"), title: t("ui.sideBySideHelp"), checked: !bottom && !portrait && sideBySide, disabled: bottom || portrait, run: toggleSideBySide },
    {
      label: t("ui.menuEditors"),
      title: t("ui.editorCountHelp"),
      items: Array.from({ length: Math.min(editorMax, editorLimit) }, (_, k) => ({
        label: t("ui.editorCount", { n: k + 1 }),
        title: t("ui.editorCountHelp"),
        checked: editorCount === k + 1,
        run: () => setEditorCount(k + 1),
      })),
    },
    { label: t("ui.verticalRoll"), title: t("ui.verticalRollHelp"), checked: orientation === "vertical", hint: keyOf("view.orientation"), run: () => run("view.orientation") },
    { separator: true },
    { label: t("ui.events"), title: t("ui.eventsHelp"), checked: showEvents, run: () => (showEvents = !showEvents) },
    { label: t("ui.noteList"), title: t("ui.noteListHelp"), checked: noteListOpen, run: () => (noteListOpen = !noteListOpen) },
    { label: t("ui.pauseMark"), title: t("ui.pauseMarkHelp"), checked: pauseMark, run: togglePauseMark },
    { label: t("ui.pickBackground"), title: t("ui.pickBackgroundHelp"), checked: pickBackground, run: togglePickBackground },
    { separator: true },
    { label: t("ui.mmlPad"), title: t("ui.mmlPadHelp"), checked: mmlPad.enabled, run: () => (mmlPad.enabled = !mmlPad.enabled) },
    { label: t("ui.tabPad"), title: t("ui.tabPadHelp"), checked: tabPadOn, disabled: viewMode === "roll", run: toggleTabPad },
    { label: t("ui.followCursor"), title: t("ui.followCursorHelp"), checked: followCursor, disabled: viewMode === "roll", run: toggleFollowCursor },
    { label: t("ui.keymap") + "…", hint: keyOf("view.keymap"), run: () => (showKeymap = true) },
    { separator: true },
    { label: t("ui.menuLanguage"), items: LOCALES.map((l) => ({ label: LOCALE_LABELS[l], checked: i18n.locale === l, run: () => setLocale(l) })) },
  ]);

  /** 위 띠 ? 메뉴: 가이드북, 단축키, 업데이트 확인, BiNote 정보 */
  const helpMenu: MenuItem[] = $derived([
    { label: t("ui.helpGuide"), run: () => window.open(guideUrl(i18n.locale), "_blank", "noopener") },
    { label: t("ui.keymap") + "…", hint: keyOf("view.keymap"), run: () => (showKeymap = true) },
    { separator: true },
    { label: t("ui.currentNotes") + "…", run: () => (releaseNotes = "current") },
    { label: t("ui.aboutTitle") + "…", run: () => (about = true) },
  ]);

  /** 커서(없으면 처음)부터 재생. 반복 구간이 있으면 그 시작부터 끝까지를 끊김 없이 되풀이한다 */
  async function play() {
    if (song) await playback.play(song, cursor, loop, playRate);
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

  /** 파일을 저장한다. 저장 창에서 고른 파일에 쓰지 못해 다운로드로 저장했으면 알린다 */
  async function store(bytes: Uint8Array, name: string): Promise<SavedFile> {
    // 이름 없는 새 악보는 폴더의 같은 이름 파일을 덮어쓰지 않고 새 이름을 고른다
    const fresh = !fileName || nameUnsure;
    const saved = await saveFile(bytes, name, { fresh });
    report(saved, name, fresh);
    return saved;
  }

  /** 저장 결과 알림: 다운로드로 물러남·다시 저장·새 이름 */
  function report(saved: SavedFile, name: string, fresh: boolean) {
    if (saved.outcome === "rescued") error = t("ui.saveRescued", { name });
    if (saved.outcome === "retry") error = t("ui.saveRetry");
    if (saved.outcome === "full") error = t("ui.saveFolderFull", { name });
    if (saved.name && renamedInFolder(saved, name, fresh)) flash(t("ui.saveNewName", { name: saved.name }));
  }

  /** 이름 없는 새 악보를 폴더에 저장하며 같은 이름을 피해 새 이름을 골랐는지 (저장 창에서 사용자가 고친 이름은 아니다) */
  function renamedInFolder(saved: SavedFile, name: string, fresh: boolean): boolean {
    return fresh && !saved.file && !!saved.name && saved.name !== name;
  }

  function baseName(): string {
    return saveBaseName(fileName);
  }

  function save3mle(encoding: "cp949" | "utf-8" = "cp949") {
    if (!song) return;
    const result = encode3mle(song, { encoding });
    void store(result.bytes, `${baseName()}.mml`);
    notices = result.diagnostics;
    offerUtf8 = result.unencodable.length > 0;
  }

  async function saveWav() {
    if (!song || wavProgress !== undefined) return;
    const name = `${baseName()}.wav`;
    // 사운드팩 바이트를 읽는 동안에도 작업 중으로 보여 다시 누르지 못하게 한다
    const token = ++wavToken;
    wavProgress = 0;
    wavReady = undefined;
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
    // 저장 창은 누른 직후에만 뜨고, 고른 파일을 먼저 비운다. 그래서 다 만든 뒤 저장 단추를 눌러 고르고 곧바로 쓴다
    if (asksSaveDialog()) wavReady = { bytes: new Uint8Array(result.wav), name };
    else void store(new Uint8Array(result.wav), name);
    const missing = [...new Set(prepared.unresolved.map((u) => instrumentLabel({ canonical: u.instrument, program: u.program })))];
    if (missing.length > 0) error = t("ui.wavUnresolved", { list: missing.join(", ") });
  }
  /** 저장 창이 떠 있는 동안 저장 단추를 다시 누르지 못하게 한다 */
  let wavSaving = $state(false);
  function saveReadyWav() {
    const ready = wavReady;
    if (!ready || wavSaving) return;
    wavSaving = true;
    void store(ready.bytes, ready.name)
      .then(({ outcome }) => {
        // 저장 창을 닫았으면 다시 누를 수 있게 남겨 둔다
        if (outcome !== "cancelled" && outcome !== "retry" && outcome !== "full" && wavReady === ready) wavReady = undefined;
      })
      .finally(() => (wavSaving = false));
  }
  function cancelWav() {
    wavToken++;
    wavProgress = undefined;
    wavRunner.cancel();
  }

  function saveMidi() {
    if (!song) return;
    // 번호로만 적힌 추가 팩 악기는 재생처럼 올린 팩에서 찾은 실제 악기의 GM 번호로 낸다
    void store(writeSmf(songToSmf(song, 480, profile.volume.max, "gm", { canonicalOf: engine.canonicalOf })), `${baseName()}.mid`);
  }

  function saveMmi() {
    if (!song) return;
    const result = writeMmi(song);
    void store(new TextEncoder().encode(result.text), `${baseName()}.mmi`);
    notices = result.diagnostics;
    offerUtf8 = false;
  }

  /** 고른 음의 v를 프로필 범위 안에서 바꾼다 */
  function nudgeVolume(delta: number) {
    const { min, max } = profile.volume;
    editor?.editSelected((n) => ({ ...n, vol: Math.min(max, Math.max(min, n.vol + delta)) }), "음 볼륨");
  }

  function selectTrack(step: number) {
    if (!song || song.tracks.length === 0) return;
    const i = song.tracks.findIndex((tr) => tr.id === activeTrackId);
    const next = Math.min(song.tracks.length - 1, Math.max(0, i + step));
    activeTrackId = song.tracks[next]!.id;
  }

  /** 명령 실행. 할 일이 없었으면 false (키를 브라우저에 그대로 넘긴다) */
  function run(command: CommandId): boolean {
    if (!speedPickAllows(speedStep, command)) return false;
    if (command === "grid.double" || command === "grid.half") {
      // 더 바꿀 수 없으면(1/1의 ×2 등) 그대로 두고 키는 먹는다
      division = stepGrid(division, command === "grid.double" ? "double" : "half", profile.length) ?? division;
      return true;
    }
    if (command.startsWith("grid.")) {
      division = Number(command.slice(5));
      return true;
    }
    switch (command) {
      case "file.open":
        void openScoreFile();
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
      case "file.saveProjectAs":
        saveProject(true);
        return true;
      case "edit.undo":
        undo();
        return true;
      case "edit.redo":
        redo();
        return true;
      case "note.tie":
        return editor?.tieSelected() ?? false;
      case "note.split": {
        // 피아노롤은 재생 커서 자리, 타브는 타브 커서 자리에서 자른다
        if (viewMode === "tab") return tab?.splitAt() ?? false;
        const at = editCursor();
        return at !== undefined && (roll?.splitAt(at) ?? false);
      }
      case "tempo.tap":
        return tap();
      case "record.toggle":
        if (!recordOpen || !labs.on) return false;
        toggleRecording();
        return true;
      case "event.tempo":
      case "event.marker":
        // 타브에서도 된다 (마커는 타브에 그리지 않고 피아노롤 이벤트 줄에서만 보인다)
        if (!song) return false;
        openEventAtCursor(command === "event.tempo" ? "tempo" : "marker");
        return true;
      case "note.glue":
        return editor?.glueSelected() ?? false;
      case "note.delete":
        if (pickedEvent && viewMode === "roll" && showEvents) return deletePicked();
        return editor?.editSelected(() => null, "음 지우기") ?? false;
      case "note.octaveUp":
        return editor?.editSelected((n) => (n.pitch + 12 <= 127 ? { ...n, pitch: n.pitch + 12 } : n), "옥타브 올리기") ?? false;
      case "note.octaveDown":
        return editor?.editSelected((n) => (n.pitch - 12 >= 0 ? { ...n, pitch: n.pitch - 12 } : n), "옥타브 내리기") ?? false;
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
      case "play.fromEditCursor": {
        // 재생 위치를 편집 커서로 (타브는 타브 커서. 피아노롤은 편집 커서가 곧 재생 위치라 할 일이 없다)
        const at = tabCursorForCommand();
        if (!at) return false;
        setCursor(at);
        if (playing) void play();
        return true;
      }
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
        runIfChanged(keepScoreTempo(shiftTrack(activeTrackId, command === "track.moveUp" ? -1 : 1, t("ui.moveTrack"))));
        return true;
      }
      case "view.tab":
        showView(viewMode === "roll" ? "tab" : "roll");
        return true;
      case "view.orientation":
        orientation = orientation === "horizontal" ? "vertical" : "horizontal";
        return true;
      case "view.keymap":
        showKeymap = true;
        return true;
      case "edit.selectAll":
        return editor?.selectAll() ?? false;
      case "edit.copy":
        return editor?.copySelection() ?? false;
      case "edit.cut":
        return editor?.cutSelection(t("ui.cut")) ?? false;
      case "edit.paste": {
        if (viewMode === "tab") {
          // 타브: 타브 커서 자리(없으면 복사한 원래 자리)에 트랙 나눔 그대로. 커서는 타브가 붙인 끝으로 옮긴다
          if (!noteClipboard.clip) return false;
          tab?.pasteAt(undefined, t("ui.pasteNotes"));
          return true;
        }
        // 여러 트랙에서 복사한 화음은 피아노롤의 트랙 하나에 겹쳐 붙일 수 없다 (음을 버리지 않게 붙이지 않는다)
        if (noteClipboard.clip && clipOverlaps(noteClipboard.clip)) {
          error = t("ui.pasteChordRoll");
          return true;
        }
        // 재생 커서가 있으면 그 자리, 없으면 복사한 원래 자리. 붙인 뒤 커서를 끝으로 옮겨 이어 붙이기 쉽게
        // 편집 커서는 분수로 써서 l7 같은 길이도 틈 없이 잇는다
        const end = roll?.pasteAt(editCursor(), t("ui.pasteNotes"));
        if (end === undefined) return false;
        setCursor(end);
        return true;
      }
      case "edit.lengthDouble":
        return hasSelection() ? scaleSelection(DOUBLE, t("ui.lengthDouble")) : stepNewLength(2);
      case "edit.lengthHalf":
        return hasSelection() ? scaleSelection(HALF, t("ui.lengthHalf")) : stepNewLength(0.5);
      case "edit.dotToggle":
        return toggleDotLength();
      case "edit.transpose":
        openTranspose();
        return !!song;
      case "edit.volume":
        openVolume();
        return !!song;
    }
    return false;
  }

  const TEXT_INPUT = ".cm-editor, input, select, textarea, [contenteditable]";
  const TYPING = `${TEXT_INPUT}, button`;
  // 글 입력 칸에서는 롤 음을 바꾸지 않는다 (Ctrl+A·C·X·V는 글 편집으로, Ctrl+[ ]는 그대로 둔다)
  const TEXT_COMMANDS: ReadonlySet<CommandId> = new Set(["edit.selectAll", "edit.copy", "edit.cut", "edit.paste", "edit.lengthDouble", "edit.lengthHalf", "edit.dotToggle"]);

  /** 영상 속도를 직접 재는 동안의 키: Esc는 재기를 그만두고, 저장 말고 묶인 키는 아무것도 하지 않는다 (브라우저에도 넘기지 않는다) */
  function pickingKey(event: KeyboardEvent) {
    if (event.isComposing) return;
    const key = keyName(event);
    if (key === "Escape") {
      event.preventDefault();
      roll?.cancelSpeedPick();
      return;
    }
    // 글 입력 칸(영상 칸의 숫자 등)에서는 글 치기를 그대로 둔다. MML 편집기는 그동안 고칠 수 없다
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(TEXT_INPUT) && !allowedWhileTyping(key ?? "")) return;
    const command = key ? commandFor(bindings, key) : undefined;
    if (!command) return;
    event.preventDefault();
    if (speedPickAllows(speedStep, command)) {
      flushAllEditors();
      run(command);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    // 편집기가 이미 처리한 키(편집기 안 실행 취소 등)는 건드리지 않는다
    if (picking && !event.defaultPrevented) return pickingKey(event);
    if (event.defaultPrevented || showKeymap || paste || midi || transposing || arpeggio || slide || grace || trill || labDialog || reverbDialog || voicing || settings || meterOpen || eventEdit || addScoreOpen || recoverOpen || outputOpen || optimizing || spreadOpen || mergeOpen || event.isComposing) return;
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
    // MIDI 건반 녹음 줄이 열려 있으면 녹음 시작 / 멈추고 넣기 (탭 템포와 같이 버튼에 초점이 있어도 먹게)
    if (recordOpen && labs.on && commandFor(bindings, key) === "record.toggle" && !target?.closest?.(TEXT_INPUT)) {
      event.preventDefault();
      if (!event.repeat) toggleRecording();
      return;
    }
    // MIDI 건반을 켜 두면 숫자 키는 새 음 길이, 0은 쉼표 (글 치는 곳은 빼고. 버튼에 초점이 있어도 먹게)
    if (midiKeys.status && !target?.closest?.(TEXT_INPUT) && midiStepKey(key)) {
      event.preventDefault();
      return;
    }
    if (target?.closest?.(TYPING) && !allowedWhileTyping(key)) return;
    const command = commandFor(bindings, key);
    if (!command) return;
    if (TEXT_COMMANDS.has(command) && target?.closest?.(TYPING)) return;
    // 글 입력 칸에 초점이 있으면 음·이벤트·트랙을 바꾸는 단축키(Alt+S·G·B·M·L·P, Alt+↑↓ 등)는 넘기지 않는다. 저장·재생·실행 취소는 그대로
    if (target?.closest?.(TEXT_INPUT) && /^(note|event|track)\.|^edit\.(transpose|volume)$/.test(command)) return;
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
    return text === undefined ? undefined : { count: exportChars?.get(activeTrackId!) ?? text.length, limit: profile.charLimitPerScore };
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
  /** 트랙의 지금 악기 글 (.2·.3 팩 악기는 하프(24.2)처럼) */
  const ownInstrumentLabel = (track: Track) => instrumentLabel(song ? trackInstrument(song, track) : { canonical: "piano" });
  /** 트랙에서 고른 사운드팩 파일 이름 (없으면 자동) */
  const ownPack = (track: Track) => (song ? trackInstrument(song, track).packId : undefined);
  /** 트랙 편집기의 팩 고르기 항목: 지금 올린 팩 파일 이름 (같은 이름은 하나만) */
  const packLabels = $derived([...new Set(packs.map((p) => p.label))]);
  /** 고른 팩에 맞춘 악기 번호 (마비꼬 팩 번호 부분). 고른 팩이 지금 없으면 번호를 그대로 둔다 */
  const programFor: ProgramForPack = (ref) => {
    if (ref.packId === undefined) return programForPack(ref, undefined);
    const pack = engine.registry.list.find((p) => p.label === ref.packId);
    return pack ? programForPack(ref, pack) : ref.program;
  };

  const trackActions: TrackActions = {
    select: (id) => (activeTrackId = id),
    renameTrack: (id, name) => commit(renameTrack(id, name, t("ui.rename"))),
    renamePlayer: (id, name) => commit(renamePlayer(id, name, t("ui.rename"))),
    playerInstrument: (playerId, canonical) => {
      const player = history?.song.players.find((p) => p.id === playerId);
      if (!history || !player) return;
      const from = instrumentName(player.instrument.canonical);
      runSoloSplit(keepScoreTempo(setPlayerInstrument(playerId, canonical, { from, to: instrumentName(canonical) }, t("ui.instrument"), soloSplit, programFor)));
    },
    trackInstrument: (id, canonical) => runSoloSplit(keepScoreTempo(setTrackInstrument(id, canonical, t("ui.trackInstrument"), soloSplit, programFor))),
    trackPack: (id, pack) => commit(setTrackPack(id, pack, programFor, t("ui.trackPack"))),
    listen: updateTrack,
    viewOf: (id) => trackView[id] ?? {},
    view: (id, change) => (trackView = withTrackView(trackView, id, change)),
    remove: deleteTrack,
    canShift: (id, step) => {
      const s = history?.song;
      return !!s && shiftTrack(id, step).apply(s) !== s;
    },
    shift: (id, step) => runIfChanged(keepScoreTempo(shiftTrack(id, step, t("ui.moveTrack")))),
    move: (id, playerId, index) => {
      if (history && !trackMoveBlock(history.song, id, playerId, profile.maxChordsPerPlayer)) runIfChanged(keepScoreTempo(moveTrack(id, playerId, index, t("ui.moveTrack"))));
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
      runIfChanged(keepScoreTempo(moveTrackToNewPlayer(id, newScoreName(s, track), t("ui.moveTrackToNew"))));
    },
    copyToNewScore: (id) => {
      const s = history?.song;
      const track = s?.tracks.find((tr) => tr.id === id);
      if (!s || !track) return;
      const next = runIfChanged(keepScoreTempo(duplicateTrackToNewPlayer(id, t("ui.duplicateTrackName", { name: track.name }), newScoreName(s, track), t("ui.copyTrackToNew"))));
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
    isActive: (id) => id === activeTrackId,
    inLane: (id) => laneExtra.includes(id),
    toggleLane: toggleLaneTrack,
    openSecond,
  };

  /** 트랙을 새 악보로 보낼 때 붙일 이름: "<트랙 악기> n" */
  function newScoreName(s: Song, track: Track): string {
    return freshScoreName(s, trackInstrument(s, track).canonical);
  }
  /** 새 악보 이름 "악기 n". 지우거나 이름을 바꿔 이미 있는 이름이면 번호를 올린다 */
  function freshScoreName(s: Song, canonical: string): string {
    const names = new Set(s.players.map((p) => p.name));
    let n = s.players.filter((p) => p.instrument.canonical === canonical).length + 1;
    while (names.has(t("ui.newPlayerName", { instrument: instrumentName(canonical), n }))) n++;
    return t("ui.newPlayerName", { instrument: instrumentName(canonical), n });
  }

  /** 패널 머리 ⋯ 메뉴: 곡 메뉴의 구성 항목과 같다 */
  const paneMenu: MenuItem[] = $derived([
    { label: t("ui.addTrackMenu"), title: t("ui.addTrackHelp"), disabled: !activePlayer, run: addTrackToPlayer },
    { label: t("ui.addScoreMenu"), title: t("ui.addPlayerHelp"), run: () => (addScoreOpen = true) },
    { separator: true },
    { label: t("ui.distribute") + "…", title: t("ui.distributeHelp"), run: () => (spreadOpen = {}) },
    { label: t("ui.merge") + "…", title: t("ui.mergeHelp"), run: () => (mergeOpen = true) },
    { label: t("ui.compact") + "…", title: t("ui.compactHelp"), run: compact },
    { label: t("ui.split") + "…", disabled: splitting, run: runSplit },
    { label: t("ui.outputMenu"), title: t("ui.outputMenuHelp"), run: openOutput },
  ]);

  /**
   * 악기 바꾸기에서 게임에서 같은 악보에 둘 수 없는 트랙 악기(오르골·축음기 악보의 다른 악기, 오르골·축음기 트랙)를
   * 새 악보로 떼어 낼 때 쓴다
   */
  const soloSplit: SoloSplit = {
    solo: (canonical) => isSoloInstrument(profile, canonical),
    get limit() {
      return profile.maxChordsPerPlayer;
    },
    name: freshScoreName,
  };

  /** 악기 바꾸기를 실행하고, 트랙을 새 악보로 떼어 냈거나 원래 악보로 돌려보냈으면 몇 트랙인지 알린다 */
  function runSoloSplit(command: Command) {
    if (!history) return;
    const owners = new Map(history.song.tracks.map((tr) => [tr.id, tr.playerId]));
    const beforeSong = history.song;
    const before = new Set(beforeSong.players.map((p) => p.id));
    if (!commit(command)) return;
    const moved = history.song.tracks.filter((tr) => owners.has(tr.id) && owners.get(tr.id) !== tr.playerId);
    // 원래 있던 악보로 옮겼으면 떼어 냈던 트랙을 돌려보낸 것
    const back = moved.filter((tr) => before.has(tr.playerId)).length;
    // 보통 악기로 바꾼 악보인데 한도 때문에 돌아오지 못한 떼어 낸 악보가 있으면 함께 알린다
    const changed = history.song.players.filter((p) => {
      const was = beforeSong.players.find((q) => q.id === p.id);
      return was !== undefined && was.instrument.canonical !== p.instrument.canonical;
    });
    const blocked = changed.flatMap((p) => blockedSplitBack(history!.song, p.id, soloSplit));
    const notes: string[] = [];
    if (moved.length > back) notes.push(t("ui.soloSplitMoved", { n: moved.length - back }));
    else if (back > 0) notes.push(t("ui.soloMergedBack", { n: back }));
    if (blocked.length > 0) {
      const names = blocked.map((b) => history!.song.players.find((p) => p.id === b.playerId)?.name ?? b.playerId).join(", ");
      notes.push(t("ui.soloBackBlocked", { names, n: blocked.reduce((sum, b) => sum + b.tracks, 0), limit: profile.maxChordsPerPlayer }));
    }
    if (notes.length > 0) error = notes.join(" ");
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
    onopen={(next) => {
      openSong(next, "");
      offerOffgrid(next);
    }}
    onappend={(next) => {
      appendPasted(next);
      offerOffgrid(next);
    }}
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

{#if slide && song}
  {@const sl = slide}
  <SlideDialog
    song={sl.redo?.base ?? song}
    picked={sl.picked}
    initial={sl.initial}
    title={sl.redo?.title}
    onrestore={sl.redo ? () => restoreFromDialog(sl.redo) : undefined}
    {profile}
    instrumentOf={(id) => (song ? instrumentIdOf(song, id) : undefined)}
    {...sl.strings ? { stringOf: (n: Note) => sl.strings?.get(n.id) } : {}}
    locked={lockedIds}
    onapply={applySlide}
    onclose={() => (slide = undefined)}
  />
{/if}
{#if grace && song}
  {@const g = grace}
  <GraceDialog
    song={g.redo?.base ?? song}
    picked={g.picked}
    initial={g.initial}
    title={g.redo?.title}
    onrestore={g.redo ? () => restoreFromDialog(g.redo) : undefined}
    {profile}
    locked={lockedIds}
    {...g.tab ? { tab: g.tab } : {}}
    stringOf={(n) => g.strings?.get(n.id)}
    instrumentOf={(id) => {
      const tr = song?.tracks.find((x) => x.id === id);
      if (!song || !tr) return undefined;
      const ref = trackInstrument(song, tr);
      return canonicalOf(ref.canonical, ref.program, ref.packId) ?? ref.canonical;
    }}
    onapply={applyGrace}
    onclose={() => (grace = undefined)}
  />
{/if}
{#if trill && song}
  {@const g = trill}
  <TrillDialog
    song={g.redo?.base ?? song}
    picked={g.picked}
    initial={g.initial}
    title={g.redo?.title}
    onrestore={g.redo ? () => restoreFromDialog(g.redo) : undefined}
    {profile}
    locked={lockedIds}
    {...g.tab ? { tab: g.tab } : {}}
    stringOf={(n) => g.strings?.get(n.id)}
    instrumentOf={(id) => (song ? instrumentIdOf(song, id) : undefined)}
    onapply={applyTrill}
    onclose={() => (trill = undefined)}
  />
{/if}
{#if labDialog && song}
  {@const d = labDialog}
  <LabNoteDialog
    kind={d.kind}
    {song}
    picked={d.picked}
    {profile}
    locked={lockedIds}
    {...d.positions ? { positionOf: (n: Note) => d.positions?.get(n.id) } : {}}
    onapply={applyLab}
    onclose={() => (labDialog = undefined)}
  />
{/if}
{#if loudnessOpen && song && referencePower}
  <LoudnessCompareDialog
    {song}
    {profile}
    power={referencePower}
    offsetMs={reference?.offsetMs ?? 0}
    {loop}
    now={nowAt}
    onseek={seekTo}
    onclose={() => (loudnessOpen = false)}
  />
{/if}
{#if reverbDialog && song}
  {@const d = reverbDialog}
  <ReverbDialog {song} trackId={d.trackId} picked={d.picked} {profile} locked={lockedIds} onapply={applyLab} onclose={() => (reverbDialog = undefined)} />
{/if}
{#if arpeggio && song}
  {@const arpSong = arpeggio.redo?.base ?? song}
  {@const arpTrack = arpSong.tracks.find((tr) => tr.id === arpeggio?.trackId)}
  {#if arpTrack}
    <ArpeggioDialog
      song={arpSong}
      initial={arpeggio.initial}
      title={arpeggio.redo?.title}
      onrestore={arpeggio.redo ? () => restoreFromDialog(arpeggio?.redo, true) : undefined}
      trackId={arpTrack.id}
      picked={arpeggio.picked}
      {division}
      lengthRange={profile.length}
      {tupletLength}
      range={trackSoundingRange(profile, arpSong, arpTrack, canonicalOf)}
      maxTracks={maxChordsOf(profile, song.players.find((p) => p.id === arpTrack.playerId)?.instrument.canonical)}
      locked={lockedIds}
      colorsFor={(s) => trackColors(s, scoreGroups(s, chordsOf), colorScheme, paletteTheme)}
      onapply={applyArpeggio}
      onclose={() => (arpeggio = undefined)}
    />
  {/if}
{/if}
{#if madeRestoreOpen && song}
  <MadeRestoreDialog
    {song}
    records={madeRestoreOpen.records}
    locked={lockedIds}
    colors={trackColors(song, scoreGroups(song, chordsOf), colorScheme, paletteTheme)}
    onapply={applyMadeRestorePlan}
    onclose={() => (madeRestoreOpen = undefined)}
  />
{/if}
{#if volumeOpen}
  <VolumeDialog
    scopes={[
      ...((editor?.selection().length ?? 0) > 0 ? [{ id: "selection" as const, label: t("ui.scopeSelection", { count: editor?.selection().length ?? 0 }) }] : []),
      ...(activeTrackId ? [{ id: "track" as const, label: t("ui.scopeTrack") }, { id: "score" as const, label: t("ui.scopeScore") }] : []),
      { id: "song", label: t("ui.scopeSong") },
    ]}
    initialScope={volumeOpen.scope}
    initialVol={volumeOpen.vol}
    loopBars={song && loop ? barsOfRange(song.timeSig, asRat(loop[0]), asRat(loop[1])) : undefined}
    {profile}
    check={checkVolume}
    onapply={applyVolume}
    onclose={() => (volumeOpen = undefined)}
  />
{/if}
{#if retuning}
  <RetuneDialog current={scoreTuning} check={checkRetune} onapply={applyRetune} onclose={() => (retuning = false)} />
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
    onmovepack={movePack}
    onaddpack={() => packInput.click()}
    {masterVolume}
    onvolume={setMasterVolume}
    {instrumentGains}
    ongain={setInstrumentGain}
    {syncOffsetMs}
    onsync={setSyncOffset}
    onaudioreport={() => engine.audioReport()}
    onaudiorebuild={() => engine.rebuildNow()}
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
      about = true;
    }}
    {editorMax}
    {editorLimit}
    oneditormax={setEditorMax}
    initial={settings.section}
    onclose={() => (settings = undefined)}
  />
{/if}

{#if about}
  <AboutDialog
    {beforeUpdate}
    onreloadanyway={reloadWithoutSaving}
    onnotes={() => (releaseNotes = "waiting")}
    onclose={() => (about = false)}
  />
{/if}

{#if releaseNotes}
  <ReleaseNotesDialog
    version={releaseNotes === "current" ? __MMLCE_BUILD__.version : (pwa.newVersion ?? "")}
    current={releaseNotes === "current"}
    onclose={() => (releaseNotes = undefined)}
  />
{/if}

{#if recoverOpen}
  <RecoverDialog {works} onrestore={restoreWork} onforget={removeWork} onclose={() => (recoverOpen = false)} />
{/if}
{#if eventEdit && eventInfo}
  <EventDialog
    kind={eventEdit.kind}
    where={eventInfo.where}
    tempoRange={profile.tempo}
    tempo={eventInfo.tempo}
    meter={eventInfo.meter}
    marker={eventInfo.marker}
    atStart={eventInfo.atStart}
    onapply={applyEvent}
    onclose={() => (eventEdit = undefined)}
  />
{/if}
{#if tempoChangeOpen && tempoChangeTarget}
  <TempoChangeDialog
    scope={tempoChangeTarget.scope}
    bpms={tempoChangeTarget.bpms}
    tempoRange={profile.tempo}
    loop={tempoChangeTarget.to !== undefined}
    onapply={changeAllTempos}
    onclose={() => (tempoChangeOpen = false)}
  />
{/if}
{#if tempoRampOpen && tempoRampAt && song}
  <TempoRampDialog
    scope={tempoRampAt.scope}
    startBpm={bpmAt(song.tempo, tempoRampAt.from)}
    backBpm={bpmAt(song.tempo, tempoRampAt.to)}
    tempoRange={profile.tempo}
    limit={profile.charLimitPerScore}
    preview={previewTempoRamp}
    onapply={applyTempoRamp}
    onclose={() => (tempoRampOpen = false)}
  />
{/if}
{#if foldOpen && song}
  <FoldReviewDialog {song} {profile} phrases={folds} instrumentOf={foldInstrumentOf} ongo={goToFold} onlisten={listenFold} onapply={applyFolds} onclose={() => (foldOpen = false)} />
{/if}
{#if offgridOpen && song}
  <OffgridDialog {song} fixes={offgrid} ongo={goToOffgrid} onlisten={listenOffgrid} onfix={applyOffgrid} onclose={() => (offgridOpen = false)} />
{/if}
{#if meterOpen}
  <MeterDialog beats={meterHere.beats} unit={meterHere.unit} onapply={changeMeter} onclose={() => (meterOpen = false)} />
{/if}
{#if tupletOpen}
  <TupletDialog tuplet={tupletPrefs.tuplet} limit={profile.length} onapply={applyTuplet} onclose={() => (tupletOpen = false)} />
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
  {#if labs.on}<Menu label={t("ui.menuLabs")} items={labsMenu} />{/if}
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
    <MasterVolume value={masterVolume} max={MASTER_MAX} title={t("ui.masterVolume")} onchange={setMasterVolume} />
  </div>
  <span class="spacer"></span>
  <!-- 위 띠가 넘쳐 옆으로 밀려도(좁은 화면·큰 화면 배율) 도움말·설정은 오른쪽 끝에 남는다 -->
  <div class="bar-end">
    <Menu icon="help" title={t("ui.helpTitle")} align="right" items={helpMenu} />
    <button class="icon" title={t("ui.settings")} aria-label={t("ui.settings")} onclick={() => (settings = { section: "packs" })}><Icon name="settings" /></button>
  </div>
</header>

{#if song}
  <div class="toolzone">
    <Toolbar
      {viewMode}
      onview={showView}
      tabHint={hint("view.tab")}
      tool={rollTool}
      ontool={(next) => (rollTool = next)}
      {selectMove}
      onselectmove={setSelectMove}
      meter={meterHere}
      onmeter={changeMeter}
      {division}
      {divisions}
      ondivision={(d) => (division = d)}
      ontuplet={() => (tupletOpen = true)}
      {noteLength}
      {noteLengths}
      onnotelength={(l) => (noteLength = l)}
      bind:inputVolume
      volumeMin={profile.volume.min}
      volumeMax={profile.volume.max}
      {selectedVolume}
      onselectedvolume={(vol) => roll?.editSelected((n) => (n.vol === vol ? n : { ...n, vol }), "음 볼륨")}
      hasCursor={cursor !== undefined}
      onbar={editBar}
      onfit={() => (viewMode === "roll" ? roll?.fitAll() : tab?.fitAll())}
      onzoom={(axis, factor) => (viewMode === "roll" ? roll?.zoom(axis, factor) : axis === "time" && tab?.zoomTime(factor))}
      {tabAlign}
      ontabalign={() => tab?.cycleAlign()}
      ontabsize={(step) => tab?.resizeTab(step)}
      layer={rollLayer}
      onlayer={setRollLayer}
      compact={narrow}
      tuningName={scoreTuning.tuning}
      ontuning={(name) => setScoreTuning({ tuning: name })}
      capo={scoreTuning.capo}
      oncapo={(c) => setScoreTuning({ capo: c })}
      onretune={tabScore !== undefined ? openRetune : undefined}
      {showEvents}
      ontoggleevents={() => (showEvents = !showEvents)}
      {orientation}
      ontoggleorientation={() => run("view.orientation")}
      dock={paneDock}
      canDock={!portrait}
      ondock={setDock}
      {sideBySide}
      canSide={!bottom && !portrait}
      ontoggleside={toggleSideBySide}
      {loadingReference}
      onreference={onReference}
      onvideo={onVideo}
    />
    {#if reference}
      <ReferenceBar {reference} bind:showWave onoffset={setReferenceOffset} onvolume={setReferenceVolume} onremove={removeReference} {tapOpen} ontaptempo={toggleTap} {barDragMode} onbardrag={setBarDragMode} />
    {/if}
    {#if videoBarsOpen}
      <VideoBarsBar
        hasVideo={!!video}
        scanning={videoBarsScan?.share}
        found={videoBarsFound && videoBarsFound.url === video?.url ? videoBarsFound : undefined}
        bind:first={videoBarsFirst}
        speed={videoBarsSpeed}
        speeds={VIDEO_BARS_SPEEDS}
        onspeed={setVideoBarsSpeed}
        result={videoBarsResult}
        review={videoBarsReview}
        onscan={startVideoBars}
        onstop={() => videoBarsScan?.abort.abort()}
        onapply={applyVideoBars}
        onjump={seek}
        onclose={closeVideoBars}
      />
    {/if}
    {#if recordOpen}
      <RecordBar
        recording={recordStatus?.count}
        {canRecord}
        silent={packs.length === 0}
        connected={!!midiKeys.status}
        grid={recordPrefs.grid}
        grids={RECORD_GRIDS}
        ongrid={(n) => setRecordPref({ grid: n })}
        speed={recordPrefs.speed}
        speeds={RECORD_SPEEDS}
        onspeed={(n) => setRecordPref({ speed: n })}
        metronome={recordPrefs.metronome}
        onmetronome={(on) => setRecordPref({ metronome: on })}
        targets={recordTargets}
        ontarget={toggleRecordArm}
        addTracks={recordPrefs.addTracks}
        canAdd={recordTargetNow?.canAdd ?? false}
        onaddtracks={(on) => setRecordPref({ addTracks: on })}
        mode={recordPrefs.mode}
        onmode={(mode) => setRecordPref({ mode })}
        result={recordResult}
        onrecord={() => void startRecord()}
        onstop={stop}
        onconnect={() => void midiKeys.toggle()}
        onclose={closeRecord}
      />
    {/if}
    {#if tapOpen}
      <TapBar
        {playing}
        count={tapCount}
        key={keyOf("tempo.tap") ?? ""}
        result={tapResult}
        merge={tapMerge}
        unit={tapUnit}
        onunit={setTapUnit}
        onmerge={setTapMerge}
        ontap={tap}
        onfinish={() => (playing ? stop() : finishTap())}
        onclear={clearTaps}
        resumeBar={tapResumeBar}
        resuming={playing && tapCount === 0 && tapAnchor?.run === playback.runs ? barBeatAt(song?.timeSig ?? [], tapAnchor.at).bar : undefined}
        canResume={!!song && packs.length > 0}
        onresume={resumeTap}
        flag={tapFlag}
        onflag={setTapFlag}
        snap={tapSnap}
        snapReady={!!reference && !!referencePeaks}
        onsnap={setTapSnap}
        speed={tapSpeed}
        speeds={TAP_SPEED}
        onspeed={setTapSpeed}
        close={tapClose}
        onclosemode={setTapClose}
        review={tapReview}
        onjump={seek}
        onclose={toggleTap}
      />
    {/if}
    {#if viewMode === "roll" && video}
      <VideoBar
        bind:video
        bind:playing={videoPlay}
        onremove={removeVideo}
        onfitroll={() => roll?.fitVideo()}
        onmatchspeed={matchVideoSpeed}
        onpickspeed={() => ((speedNote = ""), roll?.startSpeedPick())}
        onpickforward={() => roll?.speedPickForward()}
        onpickcancel={() => roll?.cancelSpeedPick()}
        {speedStep}
        {speedNote}
        tempoChanges={!!song && tempoChanges(song.tempo)}
      />
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
        <button onclick={() => void openScoreFile()} title={t("ui.openFileHelp")}>{t("ui.openFile")}</button>
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
      <!-- 곡을 열 때마다(보기 세대 번호) 보기를 새로 만든다. 저장·실행 취소로는 번호가 바뀌지 않아 그대로다 -->
      {#key viewGen}
      {#if viewMode === "roll"}
        <PianoRoll
          bind:this={roll}
          {song}
          ghost={recordLive}
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
          bind:speedStep
          onspeedpicked={(speed) => (speedNote = speed ? t("ui.videoSpeedDone", { speed: Math.round(speed) }) : t("ui.videoSpeedBad"))}
          {pitchRange}
          look={appearance.note}
          {themeKey}
          wave={showWave && reference && referencePeaks ? { peaks: referencePeaks, offset: reference.offsetMs / 1000 } : undefined}
          {colors}
          seconds={playing ? songSeconds : undefined}
          rate={playback.rate}
          {cursor}
          {loop}
          oncursor={(t) => (cursor = t)}
          onseek={seek}
          {showEvents}
          onloop={(r) => (loop = r)}
          tool={rollTool}
          onreverb={stampReverb}
          {selectMove}
          volume={inputVolume}
          onvolume={nudgeVolume}
          {lightKeys}
          {canonicalOf}
          memory={viewMemory}
          work={viewGen}
          onmemory={(place, zoom, work) => rememberView(viewMemory, work, viewGen, { place, roll: zoom })}
          visibleTrackIds={rollTracks}
          locked={lockedIds}
          pickOthers={pickBackground}
          onevent={openEvent}
          oneventmove={moveEvent}
          onalignbar={alignBar}
          bardragtext={barDragText}
          onwaveoffset={(sec) => setReferenceOffset(Math.round(sec * 1000))}
          {pickedEvent}
          onpickevent={(e) => (pickedEvent = e)}
          ontempowheel={wheelTempo}
          laneTrackIds={laneExtra}
          {melodyIds}
          onvolumes={editVolumes}
          onclearlane={() => (laneExtra = [])}
          onlanetoggle={toggleLaneTrack}
        />
      {:else}
        <TabView
          {song}
          ghost={recordLive}
          {themeKey}
          wave={showWave && reference && referencePeaks ? { peaks: referencePeaks, offset: reference.offsetMs / 1000 } : undefined}
          onwaveoffset={(sec) => setReferenceOffset(Math.round(sec * 1000))}
          octaveKey={(e) => {
            const c = commandFor(bindings, keyName(e) ?? "");
            return c === "note.octaveUp" || c === "note.octaveDown";
          }}
          {activeTrackId}
          {tuning}
          {playhead}
          {division}
          noteDur={newNoteDur}
          {noteLength}
          {noteLengths}
          {tupletLength}
          lengthLimit={profile.length}
          onnotelength={(l) => (noteLength = l)}
          ontuplet={() => (tupletOpen = true)}
          bind:volume={inputVolume}
          volumeRange={profile.volume}
          {colors}
          locked={lockedIds}
          laneTrackIds={laneExtra}
          onlanetoggle={toggleLaneTrack}
          onclearlane={() => (laneExtra = [])}
          {melodyIds}
          onunplayable={(n) => (unplayable = n)}
          padByMouse={tabPadOn}
          {followCursor}
          playCursor={cursor}
          {loop}
          onseek={seek}
          onplaycursor={(at) => (cursor = at)}
          onloop={(r) => (loop = r)}
          onevent={openEvent}
          oncursor={(at) => (tabCursor = at)}
          onalign={(a) => (tabAlign = a)}
          memory={viewMemory}
          work={viewGen}
          onmemory={(place, tabZoom, work) => rememberView(viewMemory, work, viewGen, { place, tab: tabZoom })}
          bind:this={tab}
          onedit={(changes, label) => {
            // 여러 트랙을 바꾸는 명령은 잠근 트랙이 하나라도 끼면 통째로 하지 않는다 (피아노롤과 같이 알리고 거절)
            if (!history || changes.length === 0 || !changes.every((c) => editable(c.trackId))) return;
            commit(setTracksNotes(changes, label));
          }}
          onlayers={(changes, added, playerId, label) => {
            if (!history || !changes.every((c) => editable(c.trackId))) return;
            commit(pasteLayers(history.song, changes, added, playerId, label));
          }}
          onpastefull={(limit) => (error = t("ui.tabPasteFull", { limit }))}
          ondot={() => run("edit.dotToggle")}
          maxTracks={tabMaxTracks}
          onnewtrack={({ playerId, notes, instrument }, label) => {
            if (!history) return;
            const n = history.song.tracks.filter((tr) => tr.playerId === playerId).length + 1;
            commit(addTrackWithNotes(playerId, t("ui.newTrackName", { n }), notes, label, instrument));
          }}
          onfull={(limit) => (error = t("ui.tabChordFull", { limit }))}
          onpreview={(pitch) => {
            rollPreview(pitch, true);
            setTimeout(() => rollPreview(pitch, false), 300);
          }}
        />
      {/if}
      {/key}
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
    <div class="list-pane" bind:this={listPaneEl}>
      {#if analysis}
        <TrackPane
          {song}
          {groups}
          tracks={analysis.tracks}
          {colors}
          {activeTrackId}
          {fileName}
          charLimit={profile.charLimitPerScore}
          {exportChars}
          dock={paneDock}
          {portrait}
          trackInstrument={ownInstrument}
          trackInstrumentLabel={ownInstrumentLabel}
          trackPack={ownPack}
          {packLabels}
          actions={trackActions}
          {reveal}
          playing={activeTrackId ? playingSpans.get(activeTrackId) : undefined}
          follow={true}
          moreItems={paneMenu}
          {extraTrackIds}
          playingOf={(id) => playingSpans.get(id)}
          oncloseextra={closeExtra}
          onedit={editText}
          onundo={undo}
          onredo={redo}
          hold={picking}
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
                <SplitPanel
                  song={split.plan.song}
                  result={split.plan.result}
                  spread={split.plan.spread}
                  limit={profile.charLimitPerScore}
                  maxChords={chordsOf}
                  pasteLimit={profile.maxChordsPerPlayer}
                  fewer={fewer?.song === split.song ? fewer.value : undefined}
                  onfewer={applyFewer}
                  spreadOn={splitPrefs.spread}
                  thoroughOn={splitPrefs.thorough}
                  onspread={(on) => {
                    setSplitSpread(on);
                    void runSplit();
                  }}
                  onthorough={(on) => {
                    setSplitThorough(on);
                    void runSplit();
                  }}
                  onclose={() => {
                    booksRunner.cancel();
                    fewer = undefined;
                    split = undefined;
                  }}
                />
              </div>
            {/if}
          {/snippet}
        </TrackPane>
      {/if}
    </div>
  {/if}
  <!-- 오래 걸리는 일(악보책 나누기·WAV 저장)의 진행과 취소. 워커에서 돌아 그동안에도 편집할 수 있다 -->
  {#if splitProgress !== undefined || wavProgress !== undefined || wavReady}
    <div class="job-toast" role="status">
      {#if splitProgress !== undefined}
        <div class="job">
          <span>{t(SPLIT_STAGE[splitProgress.stage])} {Math.round(splitProgress.fraction * 100)}%</span>
          <span class="job-bar"><span style:width="{Math.round(splitProgress.fraction * 100)}%"></span></span>
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
      {#if wavReady}
        <div class="job">
          <span>{t("ui.wavReady")}</span>
          <button class="small" disabled={wavSaving} onclick={saveReadyWav}>{t("ui.wavSave")}…</button>
          <button class="small" onclick={() => (wavReady = undefined)}>{t("ui.wavDiscard")}</button>
        </div>
      {/if}
    </div>
  {/if}
</main>

{#if optimizing}
  {@const o = optimizing}
  {@const kept = o.after === o.before}
  <OptimizePreview
    title={t("ui.previewCompactTitle")}
    summary={kept ? t(o.kept === "tempo" ? "ui.compactKeptTempo" : "ui.compactKept") : t("ui.previewCompactSummary")}
    rows={kept ? [] : previewRows(o.before, o.after, profile.charLimitPerScore)}
    limit={profile.charLimitPerScore}
    blocked={kept}
    where={scoreLabel}
    onapply={applyOptimize}
    onclose={() => (optimizing = undefined)}
  />
{/if}
{#if spreadOpen && song}
  <SpreadDialog
    {song}
    {profile}
    locked={lockedIds}
    initialSource={spreadOpen.source}
    where={scoreLabel}
    {newScoreOnAdd}
    onseek={seekTo}
    onaddtrack={addSpreadTrack}
    onsplit={() => {
      spreadOpen = undefined;
      outputOpen = false;
      void runSplit();
    }}
    onapply={applyChordTool}
    onclose={() => (spreadOpen = undefined)}
  />
{/if}
{#if mergeOpen && song}
  <MergeDialog {song} {profile} locked={lockedIds} {activeTrackId} where={scoreLabel} onseek={seekTo} onapply={applyChordTool} onclose={() => (mergeOpen = false)} />
{/if}
{#if output}
  <OutputPanel
    song={song!}
    rows={output.rows}
    tempo={output.tempo}
    {profile}
    {chordsOf}
    copied={exportCopied}
    oncopied={(stamps) => (exportCopied = stamps)}
    ontrack={(id) => (activeTrackId = id)}
    onseek={seekTo}
    ondistribute={(source) => (spreadOpen = { source })}
    onsplit={runSplit}
    onchecks={() => (statusPanel = "checks")}
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
    <p class="error">{t("ui.unresolved", { list: [...new Set(playback.unresolved.map((u) => instrumentLabel({ canonical: u.instrument, program: u.program })))].join(", ") })}</p>
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
      range={trackSoundingRange(profile, song, activeTrack, canonicalOf)}
      onlength={(dur) => editor?.editSelected((n) => ({ ...n, dur }), t("ui.noteInfoLength"))}
    />
  {/if}
{/snippet}

{#snippet checksPanel()}
  {#if analysis && song}<SongChecks {song} diagnostics={analysis.song} ongo={goToCheck} onbreaktimbre={breakTimbre} onfoldreview={() => ((statusPanel = undefined), (foldOpen = true))} />{/if}
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
    <button disabled={pwa.applying} onclick={() => applyUpdate(beforeUpdate)}>{t("ui.updateReload")}</button>
    {#if pwa.updateFailed}<button disabled={pwa.applying} onclick={reloadWithoutSaving}>{t("ui.updateReloadAnyway")}</button>{/if}
    <button onclick={() => (releaseNotes = "waiting")}>{t("ui.changelog")}</button>
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
