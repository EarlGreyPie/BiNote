<script lang="ts">
  import { programForPack, type InstrumentGains, type SoundPackInfo } from "@mmlce/audio/browser";
  import {
    add,
    cmp,
    getProfile,
    positionToSeconds,
    secondsToWhole,
    toFloat,
    History,
    maxChordsOf,
    type ArpResult,
    type SlideResult,
    type ArpSource,
    isSoloInstrument,
    barBeatAt,
    meterAt,
    meterGrid,
    foldPitch,
    rat,
    clipOverlaps,
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
    addTrackWithNotes,
    appendSong,
    compactResult,
    compactSong,
    deleteTime,
    distributeChords,
    distributeSong,
    mergeResult,
    mergeSong,
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
    tempoChangeTargets,
    type TempoChange,
    fillScoreTempo,
    keepScoreTempo,
    scoresMissingTempo,
    setPlayerInstrument,
    setPlayerTab,
    setTrackInstrument,
    setNotesAndAddTracks,
    setTrackPack,
    type ProgramForPack,
    type SoloSplit,
    setTrackRole,
    setTracksNotes,
    setTrackNotes,
    setTrackText,
    type BookPlan,
    type BookProgress,
    type FewerBooks,
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
  import AddScoreDialog from "./lib/AddScoreDialog.svelte";
  import HelpPopover from "./lib/HelpPopover.svelte";
  import Icon from "./lib/Icon.svelte";
  import MeterDialog from "./lib/MeterDialog.svelte";
  import EventDialog from "./lib/EventDialog.svelte";
  import TempoChangeDialog from "./lib/TempoChangeDialog.svelte";
  import SettingsDialog from "./lib/SettingsDialog.svelte";
  import StatusBar, { type StatusPanel } from "./lib/StatusBar.svelte";
  import Toolbar, { type RollLayer } from "./lib/Toolbar.svelte";
  import { coarsePointer, mmlPad } from "./lib/mmlPad.svelte";
  import { parseTabPad, TAB_PAD_KEY } from "./lib/tabPad";
  import { FOLLOW_CURSOR_KEY, parseFollowCursor } from "./lib/tabFollow";
  import VoiceDialog, { parseVoicePrefs, VOICE_STORAGE, type VoiceMode, type VoiceOptions, type VoicePreview } from "./lib/VoiceDialog.svelte";
  import TransposeDialog, { type TransposeCheck, type TransposeScope } from "./lib/TransposeDialog.svelte";
  import ArpeggioDialog from "./lib/ArpeggioDialog.svelte";
  import SlideDialog from "./lib/SlideDialog.svelte";
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
  import { outputRows, previewRows, tempoAdvice } from "./lib/output";
  import { placeChord, previousVolume, volumeForVelocity } from "./lib/midiInput";
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
  import { dotFactor, toggleDot } from "./lib/dotLength";
  import { tabArpPick } from "./lib/arpeggioOptions";
  import { VIDEO_DEFAULTS, lengthsFor, noteLengthOf, stepNoteLength, type BackgroundVideo, type EventKind, type EventLabel, type EventRef, type NoteLength, type Orientation, type RollTool } from "./lib/roll";


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
  let viewMode = $state<"roll" | "tab">("roll");
  /**
   * 타브 ↔ 피아노롤을 바꿔도 이어 보는 자리: 보던 시간 자리(같이 씀), 롤·타브 확대(따로), 타브 커서.
   * 보기를 바꾸면 컴포넌트를 새로 만들므로 여기 두고 넘긴다. 화면을 다시 그릴 일이 아니라 반응 상태로 두지 않는다.
   * 롤에 가 있는 동안 앱의 tabCursor는 비어 있다 (기억한 커서는 여기에만 있고 타브를 다시 열 때 되살린다)
   */
  const viewMemory = emptyViewMemory();
  /** 타브 지판 위치 (TabView가 알린다. PC 위 도구줄 단추 글자·안내용) */
  let tabAlign = $state<TabAlign>("middle");
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
  const noteLengths = $derived(lengthsFor(profile.length));
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
    // 편집기에 열린 트랙만 (고른 트랙 + 아래 편집기들)
    for (const id of [activeTrackId, ...extraTrackIds]) {
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
    if (!track || track.mml?.text === text || !editable(trackId)) return;
    sync(history.run(setTrackText(trackId, text)));
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

  function editNotes(trackId: string, notes: Note[], label: string) {
    if (history && editable(trackId)) sync(history.run(setTrackNotes(trackId, notes, label)));
  }

  /** 게임에 넣기 점검판. 열려 있는 동안 곡이 바뀌면 바로 다시 센다 */
  let outputOpen = $state(false);
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

  /**
   * 글자 수 줄이기·화음 분산·화음 병합 미리보기. 적용하면 같은 명령을 실행 취소 한 칸으로 넣는다.
   * 화음 분산: addTo = 분산 전에 빈 트랙을 하나씩 더할 연주자, over = 그래도 넘치는 연주자(트랙을 더해 볼 수 있는)
   */
  let optimizing = $state.raw<
    | {
        kind: "compact" | "distribute" | "merge";
        before: Song;
        after: Song;
        moved: number;
        removed?: number;
        kept?: "notes" | "tempo";
        addTo?: readonly string[];
        over?: readonly string[];
        /** over 중 트랙을 더하면 악보가 하나 더 생기는(같이 칠 사람이 느는) 연주자 수 */
        newScores?: number;
        stillOver?: number;
      }
    | undefined
  >(undefined);

  function compact() {
    if (!song) return;
    const r = compactResult(song, profile, lockedIds);
    optimizing = { kind: "compact", before: song, after: r.song, moved: 0, ...(r.kept ? { kept: r.kept } : {}) };
  }

  /** 연주자마다 마지막 트랙 뒤에 빈 트랙을 하나씩 더한다 */
  function withTracks(s: Song, playerIds: readonly string[]): Song {
    return playerIds.reduce((next, id) => {
      const n = next.tracks.filter((tr) => tr.playerId === id).length + 1;
      return addTrack(id, t("ui.newTrackName", { n })).apply(next);
    }, s);
  }

  function distribute(addTo: readonly string[] = []) {
    if (!song) return;
    const base = withTracks(song, addTo);
    // 잠근 트랙은 음을 빼지도 넣지도 않고, 글도 다시 쓰지 않는다
    const spread = distributeChords(base, profile, { locked: lockedIds });
    // 그래도 넘치는 트랙의 연주자. 트랙에 악기를 따로 정한 트랙은 새 트랙과 악기가 달라 옮길 수 없으니 뺀다
    const over = [
      ...new Set(
        spread.over
          .map((id) => base.tracks.find((tr) => tr.id === id))
          .filter((tr): tr is Track => !!tr && !tr.instrument && !lockedIds.has(tr.id))
          .map((tr) => tr.playerId),
      ),
    ];
    // 트랙 수가 화음 수의 배수면 트랙을 더할 때 악보가 하나 더 생긴다 (게임에서 같이 칠 사람이 한 명 는다)
    const newScores = over.filter((id) => base.tracks.filter((tr) => tr.playerId === id).length % chordsOf(id) === 0).length;
    optimizing = {
      kind: "distribute",
      before: song,
      after: compactSong(profile, undefined, lockedIds).apply(spread.song),
      moved: spread.moved,
      addTo,
      over,
      newScores,
      stillOver: spread.over.length,
    };
  }

  /** 빈 트랙을 더한 뒤 화음 분산하는 명령 (실행 취소 한 칸) */
  function addAndDistribute(addTo: readonly string[]): Command {
    const spread = distributeSong(profile, t("ui.distribute"), undefined, lockedIds);
    const restore = (before: Song): Command => ({ label: t("ui.distribute"), apply: () => before, invert: (s) => restore(s) });
    return { label: t("ui.distribute"), apply: (s) => spread.apply(withTracks(s, addTo)), invert: restore };
  }

  /** 화음 병합: 드문 트랙의 음을 같은 악기의 쉬는 트랙으로 옮기고, 비게 된 트랙은 지운다 */
  function merge() {
    if (!song) return;
    const merged = mergeResult(song, profile, lockedIds);
    optimizing = { kind: "merge", before: song, after: merged.song, moved: merged.moved, removed: merged.removed.length };
  }

  function applyOptimize() {
    if (!history || !song || !optimizing || optimizing.before !== song) return;
    const before = totalChars(song);
    const next = history.run(
      optimizing.kind === "compact"
        ? compactSong(profile, undefined, lockedIds)
        : optimizing.kind === "merge"
          ? mergeSong(profile, t("ui.merge"), lockedIds)
          : optimizing.addTo?.length
            ? addAndDistribute(optimizing.addTo)
            : distributeSong(profile, undefined, undefined, lockedIds),
    );
    sync(next);
    flash(t("ui.compactDone", { before, after: totalChars(next) }));
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
    sync(history.run(distributeSong(profile, t("ui.splitFewerUndo"), limit, lockedIds)));
    void runSplit();
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
    if (history) sync(history.undo(), true);
  }

  function redo() {
    if (history) sync(history.redo(), true);
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
    // 튜닝을 적지 않은 옛 파일은 기본 튜닝으로 연다 (앞 곡의 튜닝·카포를 이어 쓰지 않는다)
    tuningName = state.tuning ?? "standard";
    capo = state.capo ?? 0;
    // 1.0.0-beta.8 파일은 악보별 튜닝을 화면 상태에 적었다: 연 곡의 악보로 옮긴다 (막 연 곡이라 실행 취소 기록 없이)
    const old = state.scoreTunings;
    if (history && old && Object.keys(old).length > 0) {
      const next = { ...history.song, players: history.song.players.map((p) => (Object.hasOwn(old, p.id) && !p.tab ? { ...p, tab: old[p.id]! } : p)) };
      history = new History(next);
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
    projectSaved = undefined;
    nameUnsure = false;
    setProjectFile(file, file ? name : undefined);
    savedFits = {};
    trackView = {};
    // 새 곡은 기본 튜닝으로 시작한다. 프로젝트 파일이면 applyEditor가 적힌 튜닝으로 다시 잡는다
    tuningName = "standard";
    capo = 0;
    autosaved.reset(autosaveState(next, name));
    history = new History(next);
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
    transposing = fresh.transposing;
    voicing = fresh.voicing;
    tempoChangeOpen = fresh.tempoChangeOpen;
    meterOpen = fresh.meterOpen;
    split = fresh.split;
    compactNote = fresh.compactNote;
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
    const next = history.run(addTrack(activePlayer.id, t("ui.newTrackName", { n }), t("ui.addTrack")));
    sync(next);
    activeTrackId = next.tracks.find((tr) => !s.tracks.some((o) => o.id === tr.id))?.id ?? activeTrackId;
  }

  function addNewPlayer(canonical: string) {
    if (!history) return;
    const s = history.song;
    const next = history.run(addPlayer(canonical, freshScoreName(s, canonical), t("ui.newTrackName", { n: 1 }), t("ui.addPlayer")));
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
    const wasActive = activeTrackId === track.id;
    const next = history.run(removeTrack(track.id, t("ui.removeTrack")));
    sync(next);
    // 고르던 트랙을 지우면 그 자리 이웃 트랙을 고른다 (sync가 첫 트랙으로 바꾸기 전 값으로 판단)
    if (wasActive) activeTrackId = next.tracks[Math.min(index, next.tracks.length - 1)]?.id;
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

  // MIDI 건반 입력: 커서 자리에 격자 길이로 넣고 커서를 민다. 첫 건반부터 60ms 안에 누른 건반은 화음 하나
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
    engine.previewOn(inst.canonical, inst.program, pitch, 100, profile, inst.packId).catch(() => {
      // 오디오를 못 켜도 편집은 이어 간다
    });
  }

  /** 타브 커서 자리 (타브 보기에서 Alt+B·Alt+M과 박자 바꾸기가 쓴다). 커서가 없거나 타브가 아니면 undefined */
  let tabCursor = $state.raw<Rat | undefined>(undefined);
  // 박자: 타브 보기면 타브 커서가 든 마디부터, 아니면 재생 커서가 든 마디부터, 둘 다 없으면 곡 처음부터 바꾼다
  const meterPos = $derived(song ? meterTarget(song.timeSig, viewMode, tabCursor, cursor === undefined ? undefined : editCursor()) : rat(0));
  const meterHere = $derived(song ? meterAt(song.timeSig, meterPos) : { at: rat(0), beats: 4, unit: 4 });

  // 템포·마커·박자 넣기·고치기 창 (이벤트 줄, Alt+B·Alt+M)
  let eventEdit = $state<{ kind: EventKind; at: Rat; existing: boolean; id?: string } | undefined>(undefined);
  function openEvent(request: { label?: EventLabel; kind: EventKind; at: Rat; work?: number | undefined }) {
    // 곡을 다시 연 뒤 옛 보기가 늦게 보낸 요청(길게 누르기 타이머 등)은 버린다 (onmemory와 같은 보기 세대 검사)
    if (!song || !fromCurrentView(request.work, viewGen)) return;
    const l = request.label;
    eventEdit = l ? { kind: l.kind, at: l.at, existing: true, ...(l.id ? { id: l.id } : {}) } : { kind: request.kind, at: request.at, existing: false };
  }
  /** 편집 커서(타브 보기면 타브 커서 먼저, 없으면 곡 처음) 자리 템포·마커 창. 그 자리에 템포가 있으면 고치기 */
  function openEventAtCursor(kind: EventKind) {
    if (!song) return;
    const at = (viewMode === "roll" ? undefined : tabCursor) ?? editCursor() ?? rat(0);
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
    else sync(history.run(meterEditAt(song.timeSig, e.at, change.beats, change.unit, t("ui.meter"))));
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
    { label: t("ui.save3mle"), hint: keyOf("file.save3mle"), disabled: !song, run: () => save3mle() },
    { label: t("ui.saveMmi"), hint: keyOf("file.saveMmi"), disabled: !song, run: saveMmi },
    { label: t("ui.saveMidi"), title: t("ui.saveMidiHelp"), disabled: !song, run: saveMidi },
    { label: t("ui.saveWav"), title: packs.length === 0 ? t("ui.wavNeedPack") : t("ui.saveWavHelp"), disabled: !song || packs.length === 0 || wavProgress !== undefined, run: saveWav },
    { separator: true },
    { label: t("ui.outputMenu"), title: t("ui.outputMenuHelp"), disabled: !song, run: openOutput },
    { separator: true },
    { label: t("ui.addPack"), run: () => packInput.click() },
    { label: t("ui.midiKeysConnect"), title: t("ui.midiKeysHelp"), checked: !!midiKeys.status, run: () => void midiKeys.toggle() },
  ]);

  // 아르페지오: 피아노롤에서 고른 음(한 트랙)의 화음을 펼치거나 깔면서 올라간다 (실행 취소 한 칸).
  // 타브에서는 고른 음, 없으면 타브 커서 자리에서 시작하는 화음 (화음 음은 같은 시간 음으로 연다)
  let arpeggio = $state.raw<{ trackId: string; picked: readonly Note[]; source?: ArpSource } | undefined>(undefined);
  const tabArp = $derived(song && viewMode === "tab" ? tabArpPick(song, activeTrackId, tabCursor, selectedNotes) : undefined);
  const canArpeggio = $derived(!!song && (viewMode === "roll" ? !!activeTrackId && selectedNotes.length > 0 : !!tabArp));
  function openArpeggio() {
    if (!song || !canArpeggio) return;
    if (viewMode === "tab") {
      if (tabArp) arpeggio = { ...tabArp, ...(selectedNotes.length === 0 ? { source: "together" as const } : {}) };
      return;
    }
    if (activeTrackId) arpeggio = { trackId: activeTrackId, picked: selectedNotes };
  }
  function applyArpeggio(result: ArpResult) {
    const target = arpeggio;
    const track = target && history?.song.tracks.find((tr) => tr.id === target.trackId);
    if (!history || !track) return;
    // 잠근 트랙을 바꾸는 결과는 넣지 않는다 (계산에서 이미 빼지만, 다른 편집 명령과 같게 적용 직전에도 막는다)
    if (!result.changes.every((c) => editable(c.trackId))) return;
    sync(history.run(setNotesAndAddTracks(track.playerId, result.changes, result.newTracks, (n) => t("ui.newTrackName", { n }), t("ui.arpeggio"))));
  }

  // 슬라이드: 피아노롤에서 고른 음(한 트랙) 사이를 반음씩 잇거나, 앞뒤에 미끄러져 들어가고 나가는 음을 붙인다 (실행 취소 한 칸)
  let slide = $state.raw<{ trackId: string; picked: readonly Note[] } | undefined>(undefined);
  function openSlide() {
    if (!song || viewMode !== "roll" || !activeTrackId || selectedNotes.length === 0) return;
    slide = { trackId: activeTrackId, picked: selectedNotes };
  }
  function applySlide(result: SlideResult) {
    const target = slide;
    if (!history || !target || !result.notes) return;
    // 잠근 트랙은 바꾸지 않는다 (계산·대화상자에서 이미 막지만, 아르페지오처럼 적용 직전에도 막는다)
    if (!editable(target.trackId)) return;
    sync(history.run(setTracksNotes([{ trackId: target.trackId, notes: result.notes }], t("ui.slide"))));
    // 만든 사슬 전체를 골라 바로 다시 고칠 수 있게
    roll?.selectIds(result.chain);
  }

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
    { label: t("ui.lengthDouble"), hint: keyOf("edit.lengthDouble"), disabled: !song, run: () => run("edit.lengthDouble") },
    { label: t("ui.lengthHalf"), hint: keyOf("edit.lengthHalf"), disabled: !song, run: () => run("edit.lengthHalf") },
    { label: t("ui.dotToggle"), title: t("ui.dotToggleHelp"), hint: keyOf("edit.dotToggle"), disabled: !song, run: () => run("edit.dotToggle") },
    { label: t("ui.arpeggio") + "…", title: t("ui.arpeggioHelp"), disabled: !canArpeggio, run: openArpeggio },
    { label: t("ui.slide") + "…", title: t("ui.slideHelp"), disabled: !song || viewMode !== "roll" || selectedNotes.length === 0, run: openSlide },
    { separator: true },
    { label: t("cmd.note.volumeUp"), hint: keyOf("note.volumeUp"), disabled: !song, run: () => run("note.volumeUp") },
    { label: t("cmd.note.volumeDown"), hint: keyOf("note.volumeDown"), disabled: !song, run: () => run("note.volumeDown") },
    { label: t("cmd.note.octaveUp"), hint: keyOf("note.octaveUp"), disabled: !song, run: () => run("note.octaveUp") },
    { label: t("cmd.note.octaveDown"), hint: keyOf("note.octaveDown"), disabled: !song, run: () => run("note.octaveDown") },
    { label: t("cmd.note.tie"), hint: keyOf("note.tie"), disabled: !song, run: () => run("note.tie") },
    { label: t("cmd.note.split"), hint: keyOf("note.split"), disabled: !song || (viewMode === "roll" ? cursor === undefined : tabCursor === undefined), run: () => run("note.split") },
    { label: t("cmd.note.glue"), hint: keyOf("note.glue"), disabled: !song, run: () => run("note.glue") },
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
      label: (loop ? t("ui.tempoChangeLoop") : t("ui.tempoChange")) + "…",
      title: t("ui.tempoChangeHelp"),
      disabled: !song,
      run: () => (tempoChangeOpen = true),
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
    { label: t("ui.distribute") + "…", title: t("ui.distributeHelp"), disabled: !song, run: () => distribute() },
    { label: t("ui.merge") + "…", title: t("ui.mergeHelp"), disabled: !song, run: merge },
    { label: t("ui.compact") + "…", title: t("ui.compactHelp"), disabled: !song, run: compact },
    { label: t("ui.split") + "…", disabled: !song || splitting, run: runSplit },
    { label: t("ui.outputMenu"), title: t("ui.outputMenuHelp"), disabled: !song, run: openOutput },
  ]);

  /** 고른 음 길이 ×2·½ (첫 음 시작 기준으로 리듬 모양을 지킨다) */
  function scaleSelection(factor: Rat, label: string): boolean {
    if ((editor?.selection().length ?? 0) === 0) return false;
    // 고르지 않은 음은 지우거나 줄이지 않는다: 그 음 앞까지만 늘리고, 늘릴 자리가 없으면 바꾸지 않는다 (타브는 트랙마다 같은 기준)
    if (editor?.scaleSelected(factor, label)) return true;
    error = t("ui.lengthNoRoom");
    return false;
  }

  const hasSelection = () => (editor?.selection().length ?? 0) > 0;

  /**
   * `.` 키: 고른 음(타브는 고른 음이 없으면 커서 음)에 점을 붙이거나 뗀다 (길이 ×2와 같은 scaleNotesIn 규칙, 트랙마다).
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
      else error = t("ui.dotNoLength");
      return true;
    }
    const factor = dotFactor(notes.map((n) => n.dur), profile);
    if (!factor) {
      error = t("ui.dotNoLength");
      return true;
    }
    const label = t("ui.dotToggle");
    const done = viewMode === "tab" ? tab?.scaleSelected(factor, label, cursorNote ? [cursorNote.id] : undefined) : roll?.scaleSelected(factor, label);
    if (!done) error = t("ui.lengthNoRoom");
    return true;
  }
  /** 고른 음이 없을 때: 새 음 길이를 ×2·½ (타브의 +/−와 같은 규칙. 격자면 격자 한 칸에서, 목록 밖이면 그대로) */
  function stepNewLength(factor: 2 | 0.5): boolean {
    const length = stepNoteLength(noteLengthOf(noteLength, division), factor, profile.length);
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
    ...Array.from({ length: Math.min(editorMax, editorLimit) }, (_, k) => ({
      label: t("ui.editorCount", { n: k + 1 }),
      title: t("ui.editorCountHelp"),
      checked: editorCount === k + 1,
      run: () => setEditorCount(k + 1),
    })),
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
    { label: t("ui.tabPad"), title: t("ui.tabPadHelp"), checked: tabPadOn, disabled: viewMode === "roll", run: toggleTabPad },
    { label: t("ui.followCursor"), title: t("ui.followCursorHelp"), checked: followCursor, disabled: viewMode === "roll", run: toggleFollowCursor },
    { label: t("ui.keymap") + "…", hint: keyOf("view.keymap"), run: () => (showKeymap = true) },
    { separator: true },
    ...LOCALES.map((l) => ({ label: LOCALE_LABELS[l], checked: i18n.locale === l, run: () => setLocale(l) })),
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
        if (viewMode !== "tab" || !tabCursor) return false;
        setCursor(tabCursor);
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
        viewMode = viewMode === "roll" ? "tab" : "roll";
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
    }
    return false;
  }

  const TEXT_INPUT = ".cm-editor, input, select, textarea, [contenteditable]";
  const TYPING = `${TEXT_INPUT}, button`;
  // 글 입력 칸에서는 롤 음을 바꾸지 않는다 (Ctrl+A·C·X·V는 글 편집으로, Ctrl+[ ]는 그대로 둔다)
  const TEXT_COMMANDS: ReadonlySet<CommandId> = new Set(["edit.selectAll", "edit.copy", "edit.cut", "edit.paste", "edit.lengthDouble", "edit.lengthHalf", "edit.dotToggle"]);

  function onKeydown(event: KeyboardEvent) {
    // 편집기가 이미 처리한 키(편집기 안 실행 취소 등)는 건드리지 않는다
    if (event.defaultPrevented || showKeymap || paste || midi || transposing || arpeggio || slide || voicing || settings || meterOpen || eventEdit || addScoreOpen || recoverOpen || outputOpen || optimizing || event.isComposing) return;
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
    renameTrack: (id, name) => history && sync(history.run(renameTrack(id, name, t("ui.rename")))),
    renamePlayer: (id, name) => history && sync(history.run(renamePlayer(id, name, t("ui.rename")))),
    playerInstrument: (playerId, canonical) => {
      const player = history?.song.players.find((p) => p.id === playerId);
      if (!history || !player) return;
      const from = instrumentName(player.instrument.canonical);
      runSoloSplit(keepScoreTempo(setPlayerInstrument(playerId, canonical, { from, to: instrumentName(canonical) }, t("ui.instrument"), soloSplit, programFor)));
    },
    trackInstrument: (id, canonical) => runSoloSplit(keepScoreTempo(setTrackInstrument(id, canonical, t("ui.trackInstrument"), soloSplit, programFor))),
    trackPack: (id, pack) => history && sync(history.run(setTrackPack(id, pack, programFor, t("ui.trackPack")))),
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
    { label: t("ui.distribute") + "…", title: t("ui.distributeHelp"), run: () => distribute() },
    { label: t("ui.merge") + "…", title: t("ui.mergeHelp"), run: merge },
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
    sync(history.run(command));
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

{#if slide && song}
  {@const slideTrack = song.tracks.find((tr) => tr.id === slide?.trackId)}
  {#if slideTrack}
    {@const ref = trackInstrument(song, slideTrack)}
    <SlideDialog
      {song}
      trackId={slideTrack.id}
      picked={slide.picked}
      {profile}
      instrument={canonicalOf(ref.canonical, ref.program, ref.packId) ?? ref.canonical}
      locked={lockedIds}
      onapply={applySlide}
      onclose={() => (slide = undefined)}
    />
  {/if}
{/if}
{#if arpeggio && song}
  {@const arpTrack = song.tracks.find((tr) => tr.id === arpeggio?.trackId)}
  {#if arpTrack}
    <ArpeggioDialog
      {song}
      trackId={arpTrack.id}
      picked={arpeggio.picked}
      {division}
      lengthRange={profile.length}
      range={trackSoundingRange(profile, song, arpTrack, canonicalOf)}
      maxTracks={maxChordsOf(profile, song.players.find((p) => p.id === arpTrack.playerId)?.instrument.canonical)}
      locked={lockedIds}
      source={arpeggio.source}
      onapply={applyArpeggio}
      onclose={() => (arpeggio = undefined)}
    />
  {/if}
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
    <label class="volume" title={t("ui.masterVolume")}>
      <Icon name="volume" />
      <input type="range" min="0" max={MASTER_MAX} step="0.05" value={masterVolume} oninput={(e) => setMasterVolume(Number(e.currentTarget.value))} />
    </label>
  </div>
  <span class="spacer"></span>
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
          lengthLimit={profile.length}
          onnotelength={(l) => (noteLength = l)}
          bind:volume={inputVolume}
          volumeRange={profile.volume}
          {colors}
          locked={lockedIds}
          laneTrackIds={laneExtra}
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
            sync(history.run(setTracksNotes(changes, label)));
          }}
          onlayers={(changes, added, playerId, label) => {
            if (!history || !changes.every((c) => editable(c.trackId))) return;
            sync(history.run(pasteLayers(history.song, changes, added, playerId, label)));
          }}
          onpastefull={(limit) => (error = t("ui.tabPasteFull", { limit }))}
          ondot={() => run("edit.dotToggle")}
          maxTracks={tabMaxTracks}
          onnewtrack={({ playerId, notes, instrument }, label) => {
            if (!history) return;
            const n = history.song.tracks.filter((tr) => tr.playerId === playerId).length + 1;
            sync(history.run(addTrackWithNotes(playerId, t("ui.newTrackName", { n }), notes, label, instrument)));
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
  {@const kept = o.kind === "compact" ? o.after === o.before : o.moved === 0}
  {@const addable = o.kind === "distribute" && (o.over?.length ?? 0) > 0}
  <OptimizePreview
    title={t(o.kind === "compact" ? "ui.previewCompactTitle" : o.kind === "merge" ? "ui.previewMergeTitle" : "ui.previewDistributeTitle")}
    summary={o.kind === "compact"
      ? kept
        ? t(o.kept === "tempo" ? "ui.compactKeptTempo" : "ui.compactKept")
        : t("ui.previewCompactSummary")
      : o.kind === "merge"
        ? kept
          ? t("ui.previewMergeNone")
          : t("ui.previewMergeSummary", { moved: o.moved, removed: o.removed ?? 0 })
        : kept
          ? t("ui.previewDistributeNone")
          : t("ui.previewDistributeSummary", { moved: o.moved })}
    rows={kept ? [] : previewRows(o.before, o.after, profile.charLimitPerScore)}
    limit={profile.charLimitPerScore}
    blocked={kept}
    where={scoreLabel}
    stillOver={o.stillOver}
    addTrack={addable
      ? {
          added: o.addTo?.length ?? 0,
          newScores: o.newScores ?? 0,
          onadd: () => distribute([...(o.addTo ?? []), ...(o.over ?? [])]),
          onsplit: () => {
            optimizing = undefined;
            void runSplit();
          },
        }
      : undefined}
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
    ondistribute={() => distribute()}
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
