<script lang="ts">
  import { gainKey, type InstrumentGains, type SoundPackInfo } from "@mmlce/audio/browser";
  import { LOCALES, type Locale } from "@mmlce/i18n";
  import { i18n, instrumentName, LOCALE_LABELS, setLocale, t } from "./i18n.svelte";
  import { guideUrl, REPO_URL } from "./links";
  import { MASTER_MAX } from "./engine";
  import { checkSpace, pwa } from "./pwa.svelte";
  import { formatBytes, freeBytes } from "./storageSpace";
  import { setTabTint, tabTint } from "./tabTint.svelte";
  import { fretPadPrefs, setLengthPadTriplets, setPadAdvanceDir, type PadAdvanceDir } from "./fretPadPrefs.svelte";
  import { setTabEventFont, tabEventPrefs } from "./tabEventPrefs.svelte";
  import { TAB_EVENT_FONT, TAB_EVENT_FONTS } from "./tabEvents";
  import { setLengthPadTuplet, tupletPrefs } from "./tupletPrefs.svelte";
  import { setVolumeLabels, volumeLabels } from "./volumeLabels.svelte";
  import { setTimbreZones, timbreZones } from "./timbreZones.svelte";
  import type { VolumeLabelMode } from "./volumeLabels";
  import { rollFlow, setRollFlow, type RollFlow } from "./rollFlow.svelte";
  import { selectKeys, setSelectKeys } from "./selectKeys.svelte";
  import type { SelectKeysMode } from "./selectKeys";
  import { chordPrefs, setMidiMerge } from "./chordPrefs.svelte";
  import { setSplitSpread, splitPrefs } from "./splitPrefs.svelte";
  import { mmiPrefs, setMmiExportQuick, setMmiImportQuick } from "./mmiPrefs.svelte";
  import { canAskSave, canPickFolder, canShareFiles, pickSaveFolder, saveTarget, setSaveMode, setSaveShare } from "./saveTarget.svelte";
  import { LANE_MAX, LANE_MIN, saveVolumeLane, volumeLane, type LaneState } from "./volumeLane.svelte";
  import { LAB_FEATURES, labs, setButtonNames, setFade, setLabs, setLiveEdit } from "./labs.svelte";

  import Icon from "./Icon.svelte";
  import SettingGroup from "./SettingGroup.svelte";
  import SettingRow from "./SettingRow.svelte";
  import Switch from "./Switch.svelte";
  import { SETTINGS_HELP, type SettingsHelp } from "./settingsHelp";
  import { setContext } from "svelte";
  import PackBar from "./PackBar.svelte";
  import type { MidiKeys } from "./midiKeys.svelte";
  import type { ColorScheme } from "./scores";
  import { UI_SCALES } from "./uiScale";
  import { ACCENTS, EDITOR_FONT_SIZES, EDITOR_FONTS, type Appearance, type EditorFont, type NoteLook, type ThemeMode } from "./appearance";

  /**
   * 설정 창: 사운드팩 · 재생 · 화면 · 입력 · 화음 · 저장 · 실험실 · 언어 · 단축키. 맨 아래에 판 정보.
   * 칸마다 묶음 상자(SettingGroup)에 줄(SettingRow: 왼쪽 이름 · 오른쪽 조작)을 담고, 설명은 ⓘ로 펼친다
   */
  interface Props {
    packs: readonly SoundPackInfo[];
    /** 이 브라우저에 저장된 사운드팩 이름 */
    stored: ReadonlySet<string>;
    loadingPack: string;
    onremovepack: (id: string) => void;
    onmovepack: (id: string, step: -1 | 1) => void;
    onaddpack: () => void;
    masterVolume: number;
    onvolume: (v: number) => void;
    /** 악기별 음량 (dB). 키는 gainKey(팩 이름, 번호) */
    instrumentGains: InstrumentGains;
    ongain: (key: string, db: number) => void;
    syncOffsetMs: number;
    onsync: (ms: number) => void;
    /** 오디오 상태 칸: 재서 글로 돌려준다 / 오디오를 다시 만든다 */
    onaudioreport: () => Promise<string>;
    onaudiorebuild: () => Promise<void>;
    lightKeys: boolean;
    onlightkeys: () => void;
    midiKeys: MidiKeys;
    colorScheme: ColorScheme;
    oncolorscheme: (v: ColorScheme) => void;
    appearance: Appearance;
    onappearance: (a: Appearance) => void;
    onkeymap: () => void;
    /** BiNote 정보 창 열기 (업데이트 확인·링크) */
    onabout: () => void;
    /** 보기 메뉴에서 고를 수 있는 MML 편집기 수의 끝과 고를 수 있는 끝(한 악보 트랙 수) */
    editorMax: number;
    editorLimit: number;
    oneditormax: (n: number) => void;
    /** 처음 열 항목 (사운드팩 없음 표시를 눌러 열었으면 사운드팩) */
    initial?: Section;
    onclose: () => void;
  }

  type Section = "packs" | "playback" | "display" | "input" | "chords" | "save" | "labs" | "language" | "keys";

  let {
    packs,
    stored,
    loadingPack,
    onremovepack,
    onmovepack,
    onaddpack,
    masterVolume,
    onvolume,
    instrumentGains,
    ongain,
    syncOffsetMs,
    onsync,
    onaudioreport,
    onaudiorebuild,
    lightKeys,
    onlightkeys,
    midiKeys,
    colorScheme,
    oncolorscheme,
    appearance,
    onappearance,
    onkeymap,
    onabout,
    editorMax,
    editorLimit,
    oneditormax,
    initial = "packs",
    onclose,
  }: Props = $props();

  /** 설명 펼침: 칸 위 "설명 모두 펼치기"가 줄마다 ⓘ 상태를 한꺼번에 맞춘다 */
  const help = $state<SettingsHelp>({ all: false });
  setContext(SETTINGS_HELP, help);
  /** 설명(ⓘ)이 있는 칸 */
  const HAS_HELP: ReadonlySet<Section> = new Set(["playback", "display", "input", "chords", "save", "labs"]);

  /** 오디오 상태 칸에 보여 줄 글 (재기 전에는 빈 글) */
  let audioReport = $state("");
  let measuring = $state(false);
  async function measureAudio() {
    if (measuring) return;
    measuring = true;
    try {
      audioReport = await onaudioreport();
    } finally {
      measuring = false;
    }
  }
  async function rebuildAudio() {
    await onaudiorebuild();
    await measureAudio();
  }

  const NOTE_LOOKS: readonly (keyof NoteLook)[] = ["round", "border", "shade", "names"];
  function setLook(k: keyof NoteLook, on: boolean) {
    onappearance({ ...appearance, note: { ...appearance.note, [k]: on } });
  }

  /** 악기별 음량 범위 (dB) */
  const GAIN_RANGE = 12;
  const dbText = (db: number) => (db > 0 ? `+${db}` : `${db}`) + " dB";
  const packChanged = (pack: SoundPackInfo) => pack.instruments.filter((i) => instrumentGains[gainKey(pack.label, i.program)]).length;

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let section = $state<Section>(initial);
  $effect(() => {
    dialog.showModal();
  });
  // 사운드팩 칸을 열 때마다 쓰는 공간을 다시 읽는다. 팩을 넣고 빼도 바뀌므로 그때도 읽는다
  $effect(() => {
    void [packs, stored];
    if (section === "packs") void checkSpace();
  });

  const SECTIONS: readonly Section[] = ["packs", "playback", "display", "input", "chords", "save", "labs", "language", "keys"];
  /** 언어 칸은 글자를 못 읽는 언어로 바뀌어도 찾을 수 있게 영어 "Language"를 늘 같이 적는다 */
  const sectionLabel = (s: Section) =>
    s === "language"
      ? i18n.locale === "en"
        ? t("ui.language")
        : `${t("ui.language")} · Language`
      : t(s === "packs" ? "ui.settingsPacks" : s === "playback" ? "ui.settingsPlayback" : s === "display" ? "ui.settingsDisplay" : s === "input" ? "ui.settingsInput" : s === "chords" ? "ui.settingsChords" : s === "save" ? "ui.settingsSave" : s === "labs" ? "ui.settingsLabs" : "ui.settingsKeys");
</script>

<dialog bind:this={dialog} {onclose}>
  <div class="head">
    <h2>{t("ui.settings")}</h2>
    <span class="spacer"></span>
    <button class="icon" aria-label={t("ui.close")} title={t("ui.close")} onclick={() => dialog.close()}><Icon name="x" /></button>
  </div>
  <div class="body">
    <nav>
      {#each SECTIONS as s (s)}
        <button class:on={section === s} onclick={() => (section = s)}>{sectionLabel(s)}</button>
      {/each}
    </nav>
    <div class="content">
      <!-- 저장 칸이 내려받기 안내 글만 보일 때는 펼칠 설명이 없다 -->
      {#if HAS_HELP.has(section) && (section !== "save" || canAskSave || canPickFolder || canShareFiles)}
        <div class="tools">
          <button class="link" onclick={() => (help.all = !help.all)}>{t(help.all ? "ui.settingHelpHideAll" : "ui.settingHelpShowAll")}</button>
        </div>
      {/if}
      {#if section === "packs"}
        <div class="packs-list">
          <PackBar {packs} {stored} loading={loadingPack} onremove={onremovepack} onmove={onmovepack} />
        </div>
        <button class="primary" onclick={onaddpack}>{t("ui.addPack")}…</button>
        <p class="muted help">{t("ui.packOrderHelp")}</p>
        <p class="muted help">{t(pwa.storage === "persisted" ? "ui.storagePersisted" : "ui.storageBestEffort")}</p>
        {#if pwa.space}<p class="muted help">{t("ui.storageSpace", { used: formatBytes(pwa.space.usage), free: formatBytes(freeBytes(pwa.space)) })}</p>{/if}
      {:else if section === "playback"}
        <SettingGroup title={t("ui.settingGroupSound")}>
          <SettingRow label={t("ui.masterVolume")} for="set-master">
            <input id="set-master" class="ctl-range" type="range" min="0" max={MASTER_MAX} step="0.05" value={masterVolume} oninput={(e) => onvolume(Number(e.currentTarget.value))} />
          </SettingRow>
          <SettingRow label={t("ui.syncOffset")} for="set-sync" help={t("ui.syncOffsetHelp")}>
            <input id="set-sync" class="num wide" type="number" step="10" min="-1000" max="1000" value={syncOffsetMs} onchange={(e) => onsync(Number(e.currentTarget.value) || 0)} />
            <span class="muted">ms</span>
          </SettingRow>
        </SettingGroup>
        <SettingGroup title={t("ui.settingGroupKeyLights")}>
          <SettingRow label={t("ui.lightKeys")} for="set-lightkeys" help={t("ui.lightKeysHelp")}>
            <Switch id="set-lightkeys" checked={lightKeys} onchange={() => onlightkeys()} />
          </SettingRow>
          <SettingRow label={t("ui.selectKeys")} for="set-selectkeys" help={t("ui.selectKeysHelp")}>
            <select id="set-selectkeys" value={selectKeys.mode} onchange={(e) => setSelectKeys(e.currentTarget.value as SelectKeysMode)}>
              <option value="off">{t("ui.selectKeysOff")}</option>
              <option value="press">{t("ui.selectKeysPress")}</option>
              <option value="select">{t("ui.selectKeysSelect")}</option>
            </select>
          </SettingRow>
        </SettingGroup>
        <SettingGroup title={t("ui.instrumentGains")}>
          {#if packs.length === 0}
            <p class="muted help in-box">{t("ui.instrumentGainsNoPack")}</p>
          {:else}
            <p class="muted help in-box">{t("ui.instrumentGainsHelp")}</p>
            {#each packs as pack (pack.id)}
              <details class="gains" open={packs.length === 1}>
                <summary>
                  <span class="pack-name">{pack.label}</span>
                  {#if packChanged(pack)}<span class="muted">{t("ui.instrumentGainsChanged", { count: packChanged(pack) })}</span>{/if}
                </summary>
                {#each pack.instruments as ins (ins.program)}
                  {@const key = gainKey(pack.label, ins.program)}
                  {@const db = instrumentGains[key] ?? 0}
                  <div class="gain-row">
                    <span class="gain-name" title={ins.name}>{ins.canonical ? instrumentName(ins.canonical) : ins.name}</span>
                    <input
                      type="range"
                      min={-GAIN_RANGE}
                      max={GAIN_RANGE}
                      step="1"
                      value={db}
                      aria-label={`${ins.name} ${t("ui.instrumentGains")}`}
                      oninput={(e) => ongain(key, Number(e.currentTarget.value))}
                    />
                    <button class="gain-value" class:changed={db !== 0} title={t("ui.instrumentGainsReset")} disabled={db === 0} onclick={() => ongain(key, 0)}>{dbText(db)}</button>
                  </div>
                {/each}
              </details>
            {/each}
          {/if}
        </SettingGroup>
        <SettingGroup title={t("ui.settingGroupTrouble")}>
          <details class="audio-state">
            <summary>{t("ui.audioState")}</summary>
            <p class="muted help">{t("ui.audioStateHelp")}</p>
            <div class="buttons">
              <button onclick={measureAudio} disabled={measuring}>{t(measuring ? "ui.audioStateMeasuring" : "ui.audioStateMeasure")}</button>
              <button disabled={!audioReport} onclick={() => void navigator.clipboard.writeText(audioReport).catch(() => {})}>{t("ui.audioStateCopy")}</button>
              <button onclick={rebuildAudio}>{t("ui.audioRebuild")}</button>
            </div>
            <p class="muted help">{t("ui.audioRebuildHelp")}</p>
            {#if audioReport}<pre class="audio-report">{audioReport}</pre>{/if}
          </details>
        </SettingGroup>
      {:else if section === "display"}
        <SettingGroup title={t("ui.settingGroupLook")}>
          <SettingRow label={t("ui.uiScale")} for="set-uiscale" help={t("ui.uiScaleHelp")}>
            <select id="set-uiscale" value={appearance.uiScale} onchange={(e) => onappearance({ ...appearance, uiScale: Number(e.currentTarget.value) })}>
              {#each UI_SCALES as pct (pct)}<option value={pct}>{pct}%</option>{/each}
            </select>
          </SettingRow>
          <SettingRow label={t("ui.theme")} for="set-theme">
            <select id="set-theme" value={appearance.theme} onchange={(e) => onappearance({ ...appearance, theme: e.currentTarget.value as ThemeMode })}>
              <option value="system">{t("ui.themeSystem")}</option>
              <option value="light">{t("ui.themeLight")}</option>
              <option value="dark">{t("ui.themeDark")}</option>
            </select>
          </SettingRow>
          <SettingRow label={t("ui.accent")}>
            <span class="swatches">
              {#each ACCENTS as a (a.id)}
                <button
                  class="swatch"
                  class:on={appearance.accent === a.id}
                  style:--sw-light={a.light}
                  style:--sw-dark={a.dark}
                  title={t(`ui.accent.${a.id}`)}
                  aria-label={t(`ui.accent.${a.id}`)}
                  aria-pressed={appearance.accent === a.id}
                  onclick={() => onappearance({ ...appearance, accent: a.id })}
                ></button>
              {/each}
            </span>
          </SettingRow>
          <SettingRow label={t("ui.calm")} for="set-calm" help={t("ui.calmHelp")}>
            <Switch id="set-calm" checked={appearance.calm} onchange={(on) => onappearance({ ...appearance, calm: on })} />
          </SettingRow>
        </SettingGroup>
        <SettingGroup title={t("ui.settingGroupRollTab")}>
          <SettingRow label={t("ui.colorScheme")} for="set-colors" help={t("ui.colorSchemeHelp")}>
            <select id="set-colors" value={colorScheme} onchange={(e) => oncolorscheme(e.currentTarget.value as ColorScheme)}>
              <option value="score">{t("ui.colorByScore")}</option>
              <option value="position">{t("ui.colorByPosition")}</option>
              <option value="stored">{t("ui.colorStored")}</option>
            </select>
          </SettingRow>
          <SettingRow label={t("ui.rollFlow")} for="set-rollflow" help={t("ui.rollFlowHelp")}>
            <select id="set-rollflow" value={rollFlow.mode} onchange={(e) => setRollFlow(e.currentTarget.value as RollFlow)}>
              <option value="page">{t("ui.rollFlowPage")}</option>
              <option value="flow">{t("ui.rollFlowFlow")}</option>
            </select>
          </SettingRow>
          <SettingRow label={t("ui.noteLook")}>
            <span class="chips" role="group" aria-label={t("ui.noteLook")}>
              {#each NOTE_LOOKS as k (k)}
                <button class="chip" aria-pressed={appearance.note[k]} onclick={() => setLook(k, !appearance.note[k])}>{t(`ui.noteLook.${k}`)}</button>
              {/each}
            </span>
          </SettingRow>
          <SettingRow label={t("ui.volumeLabels")} for="set-vollabels" help={t("ui.volumeLabelsHelp")}>
            <select id="set-vollabels" value={volumeLabels.mode} onchange={(e) => setVolumeLabels(e.currentTarget.value as VolumeLabelMode)}>
              <option value="off">{t("ui.volumeLabels.off")}</option>
              <option value="changes">{t("ui.volumeLabels.changes")}</option>
              <option value="all">{t("ui.volumeLabels.all")}</option>
            </select>
          </SettingRow>
          <SettingRow label={t("ui.timbreZones")} for="set-zones" help={t("ui.timbreZonesHelp")}>
            <Switch id="set-zones" checked={timbreZones.on} onchange={setTimbreZones} />
          </SettingRow>
          <SettingRow label={t("ui.tabTrackTint")} for="set-tabtint" help={t("ui.tabTrackTintHelp")}>
            <Switch id="set-tabtint" checked={tabTint.on} onchange={setTabTint} />
          </SettingRow>
          <SettingRow label={t("ui.tabEventFont")} for="set-evfont" help={t("ui.tabEventFontHelp")}>
            <select id="set-evfont" value={tabEventPrefs.font} onchange={(e) => setTabEventFont(Number(e.currentTarget.value))}>
              {#each TAB_EVENT_FONTS as px (px)}<option value={px}>{t(px === TAB_EVENT_FONT ? "ui.tabEventFontDefault" : "ui.tabEventFontPx", { px })}</option>{/each}
            </select>
          </SettingRow>
        </SettingGroup>
        <SettingGroup title={t("ui.laneSettings")}>
          <SettingRow label={t("ui.laneShow")} for="set-lane" help={t("ui.laneHelp")}>
            <select id="set-lane" value={volumeLane.state} onchange={(e) => saveVolumeLane({ state: e.currentTarget.value as LaneState })}>
              <option value="collapsed">{t("ui.laneStateCollapsed")}</option>
              <option value="compact">{t("ui.laneStateCompact")}</option>
              <option value="expanded">{t("ui.laneStateExpanded")}</option>
            </select>
          </SettingRow>
          <SettingRow label={t("ui.laneSize")} for="set-lanesize" help={t("ui.laneSizeHelp")}>
            <input
              id="set-lanesize"
              class="ctl-range"
              type="range"
              min={LANE_MIN}
              max={LANE_MAX}
              step="4"
              value={volumeLane.size}
              oninput={(e) => saveVolumeLane({ size: Number(e.currentTarget.value), state: "expanded" })}
            />
            <output class="muted">{volumeLane.size}px</output>
          </SettingRow>
        </SettingGroup>
        <SettingGroup title={t("ui.settingGroupEditor")}>
          <SettingRow label={t("ui.editorMax")} for="set-editormax" help={t("ui.editorMaxHelp")}>
            <select id="set-editormax" value={editorMax} onchange={(e) => oneditormax(Number(e.currentTarget.value))}>
              {#each Array.from({ length: Math.max(1, editorLimit - 1) }, (_, k) => k + 2) as n (n)}<option value={n}>{n}</option>{/each}
            </select>
          </SettingRow>
          <SettingRow label={t("ui.settingEditorText")} for="set-edfont">
            <select id="set-edfont" aria-label={t("ui.editorFont")} value={appearance.editorFont} onchange={(e) => onappearance({ ...appearance, editorFont: e.currentTarget.value as EditorFont })}>
              {#each Object.keys(EDITOR_FONTS) as f (f)}<option value={f}>{t(`ui.editorFont.${f as EditorFont}`)}</option>{/each}
            </select>
            <select aria-label={t("ui.editorFontSize")} value={appearance.editorFontSize} onchange={(e) => onappearance({ ...appearance, editorFontSize: Number(e.currentTarget.value) })}>
              {#each EDITOR_FONT_SIZES as px (px)}<option value={px}>{px}px</option>{/each}
            </select>
          </SettingRow>
        </SettingGroup>
      {:else if section === "input"}
        <SettingGroup title={t("ui.tabPad")}>
          <SettingRow label={t("ui.padAdvanceDir")} for="set-padadvance" help={t("ui.padAdvanceDirHelp")}>
            <select id="set-padadvance" value={fretPadPrefs.advance} onchange={(e) => setPadAdvanceDir(e.currentTarget.value as PadAdvanceDir)}>
              <option value="right">{t("ui.padAdvanceRight")}</option>
              <option value="down">{t("ui.padAdvanceDown")}</option>
            </select>
          </SettingRow>
          <SettingRow label={t("ui.lengthPadTriplets")} for="set-triplets" help={t("ui.lengthPadTripletsHelp")}>
            <Switch id="set-triplets" checked={fretPadPrefs.triplets} onchange={setLengthPadTriplets} />
          </SettingRow>
          <SettingRow label={t("ui.lengthPadTuplet")} for="set-tuplet" help={t("ui.lengthPadTupletHelp")}>
            <Switch id="set-tuplet" checked={tupletPrefs.pad} onchange={setLengthPadTuplet} />
          </SettingRow>
        </SettingGroup>
        <SettingGroup title={t("ui.midiKeys")}>
          <SettingRow label={t("ui.midiKeysVelocity")} for="set-velocity" help={t("ui.midiKeysVelocityHelp")}>
            <Switch id="set-velocity" checked={midiKeys.velocity} onchange={(on) => midiKeys.setVelocity(on)} />
          </SettingRow>
        </SettingGroup>
      {:else if section === "chords"}
        <SettingGroup>
          <SettingRow label={t("ui.mergeOnImport")} for="set-merge" help={t("ui.mergeSettingHelp")}>
            <Switch id="set-merge" checked={chordPrefs.merge} onchange={setMidiMerge} />
          </SettingRow>
          <SettingRow label={t("ui.spreadOnSplit")} for="set-spread" help={t("ui.spreadSettingHelp")}>
            <Switch id="set-spread" checked={splitPrefs.spread} onchange={setSplitSpread} />
          </SettingRow>
        </SettingGroup>
      {:else if section === "save"}
        {#if canAskSave || canPickFolder}
          <SettingGroup title={t("ui.saveFolder")}>
            <div class="save-modes" role="radiogroup" aria-label={t("ui.saveFolder")}>
              {#if canAskSave}
                <SettingRow label={t("ui.saveAsk")} for="set-save-ask" help={t("ui.saveAskHelp")}>
                  <input id="set-save-ask" type="radio" name="save-mode" checked={saveTarget.mode === "ask"} onchange={() => setSaveMode("ask")} />
                </SettingRow>
              {/if}
              {#if canPickFolder}
                <SettingRow label={t("ui.saveFolderFixed")} for="set-save-folder" help={t("ui.saveFolderHelp")}>
                  <button onclick={() => void pickSaveFolder()}>{t("ui.saveFolderPick")}…</button>
                  <input
                    id="set-save-folder"
                    type="radio"
                    name="save-mode"
                    checked={saveTarget.mode === "folder" && !!saveTarget.folder}
                    onclick={(e) => {
                      // 정해 둔 폴더가 없으면 먼저 고른다. 고르지 않고 닫으면 원래 방식 그대로
                      if (saveTarget.folder) return;
                      e.preventDefault();
                      void pickSaveFolder();
                    }}
                    onchange={() => setSaveMode("folder")}
                  />
                  {#snippet below()}
                    {#if saveTarget.folder}<span class="folder-name">{saveTarget.folder}</span>{/if}
                  {/snippet}
                </SettingRow>
              {/if}
              <SettingRow label={t("ui.saveFolderDownloads")} for="set-save-download">
                <input
                  id="set-save-download"
                  type="radio"
                  name="save-mode"
                  checked={saveTarget.mode === "download" || (saveTarget.mode === "folder" && !saveTarget.folder) || (saveTarget.mode === "ask" && !canAskSave)}
                  onchange={() => setSaveMode("download")}
                />
              </SettingRow>
            </div>
          </SettingGroup>
        {:else if canShareFiles}
          <SettingGroup>
            <SettingRow label={t("ui.saveShare")} for="set-share" help={t("ui.saveShareHelp")}>
              <Switch id="set-share" checked={saveTarget.share} onchange={setSaveShare} />
            </SettingRow>
          </SettingGroup>
        {:else}
          <p class="muted help">{t("ui.saveDownloadOnly")}</p>
        {/if}
        <SettingGroup title={t("ui.mmiPrefsTitle")}>
          <SettingRow label={t("ui.mmiExportQuick")} for="set-mmi-export" help={t("ui.mmiExportQuickHelp")}>
            <Switch id="set-mmi-export" checked={mmiPrefs.exportQuick} onchange={setMmiExportQuick} />
          </SettingRow>
          <SettingRow label={t("ui.mmiImportQuick")} for="set-mmi-import" help={t("ui.mmiImportQuickHelp")}>
            <Switch id="set-mmi-import" checked={mmiPrefs.importQuick} onchange={setMmiImportQuick} />
          </SettingRow>
        </SettingGroup>
      {:else if section === "labs"}
        <SettingGroup>
          <SettingRow label={t("ui.labsOn")} for="set-labs" help={t("ui.labsHelp")}>
            <Switch id="set-labs" checked={labs.on} onchange={setLabs} />
          </SettingRow>
        </SettingGroup>
        <SettingGroup title={t("ui.labsMenuFeatures")} dim={!labs.on}>
          {#each LAB_FEATURES as f (f.id)}
            <SettingRow label={t(f.label)} help={t(f.help)} />
          {/each}
        </SettingGroup>
        <SettingGroup title={t("ui.labsSettings")}>
          <SettingRow label={t("ui.labButtonNames")} for="set-lab-names" help={t("ui.labButtonNamesHelp")}>
            <Switch id="set-lab-names" checked={labs.buttonNames} disabled={!labs.on} onchange={setButtonNames} />
          </SettingRow>
          <SettingRow label={t("ui.labFade")} for="set-lab-fade" help={t("ui.labFadeHelp")}>
            <Switch id="set-lab-fade" checked={labs.fade} disabled={!labs.on} onchange={setFade} />
          </SettingRow>
          <SettingRow label={t("ui.labLiveEdit")} for="set-lab-live" help={t("ui.labLiveEditHelp")}>
            <Switch id="set-lab-live" checked={labs.liveEdit} disabled={!labs.on} onchange={setLiveEdit} />
          </SettingRow>
        </SettingGroup>
      {:else if section === "language"}
        <div class="langs" role="radiogroup" aria-label={t("ui.language")}>
          {#each LOCALES as l (l)}
            <label class="lang" lang={l === "zh-TW" ? "zh-Hant" : l}>
              <input type="radio" name="locale" value={l} checked={i18n.locale === l} onchange={() => setLocale(l)} />
              <span>{LOCALE_LABELS[l]}</span>
            </label>
          {/each}
        </div>
        {#if i18n.locale !== "ko" && i18n.locale !== "en"}
          <p class="muted help">
            {t("ui.translationNote")}
            <a href={`${REPO_URL}/issues/new/choose`} target="_blank" rel="noopener">{t("ui.aboutReport")}</a>
          </p>
        {/if}
      {:else}
        <button onclick={onkeymap}>{t("ui.openKeymap")}</button>
      {/if}
    </div>
  </div>
  <p class="about muted">
    {t("ui.about", { version: __MMLCE_BUILD__.version, build: __MMLCE_BUILD__.build, commit: __MMLCE_BUILD__.commit || "-" })}
    · {t("ui.aboutCredit")} ·
    <a href={guideUrl(i18n.locale)} target="_blank" rel="noopener">{t("ui.helpGuide")}</a> ·
    <button class="link" onclick={onabout}>{t("ui.aboutTitle")}…</button>
  </p>
</dialog>

<style>
  dialog {
    width: min(720px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  .gains {
    border-top: 1px solid var(--line);
    padding: 4px 0;
  }
  .gains summary {
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 2px 0;
    font-size: 13px;
  }
  .pack-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gain-row {
    display: grid;
    grid-template-columns: minmax(0, 9em) minmax(0, 1fr) 4.5em;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    padding: 2px 0;
  }
  .gain-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gain-row input {
    width: 100%;
  }
  .gain-value {
    font-size: 11px;
    padding: 1px 4px;
    font-variant-numeric: tabular-nums;
  }
  .gain-value.changed {
    color: var(--accent);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .body {
    display: grid;
    grid-template-columns: 140px minmax(0, 1fr);
    gap: 16px;
    margin-top: 8px;
    min-height: 240px;
    overflow: auto;
  }
  nav {
    display: grid;
    align-content: start;
    gap: 4px;
  }
  nav button {
    text-align: left;
    border-color: transparent;
    background: none;
  }
  nav button.on {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: var(--accent);
    font-weight: 600;
  }
  .content {
    display: grid;
    align-content: start;
    gap: 14px;
    min-width: 0;
  }
  .packs-list {
    display: grid;
    gap: 6px;
  }
  .packs-list :global(.pack) {
    display: flex;
  }
  .primary {
    justify-self: start;
  }
  .langs {
    display: grid;
    gap: 6px;
  }
  .lang {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .audio-state {
    display: grid;
    gap: 8px;
    padding: 8px 0;
  }
  .audio-state summary {
    cursor: pointer;
  }
  .audio-state[open] summary {
    margin-bottom: 6px;
  }
  .audio-report {
    margin: 0;
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: 4px;
    font-size: 11px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .help {
    margin: -4px 0 0;
    font-size: 12px;
  }
  .about a {
    color: var(--accent);
  }
  .about .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .about {
    margin: 12px 0 0;
    padding-top: 8px;
    border-top: 1px solid var(--line);
    font-size: 11px;
  }
  .spacer {
    flex: 1;
  }
  /* 세로 화면: 항목 목록을 위로 */
  @media (max-aspect-ratio: 1/1) {
    .body {
      grid-template-columns: minmax(0, 1fr);
      /* 칸 줄(nav)은 옆으로 미는 스크롤 칸이라 최소 높이가 0이다. 내용이 길면(큰 화면 배율) 줄이 눌려 잘리지 않게 내용 높이로 둔다 */
      grid-auto-rows: max-content;
      gap: 8px;
    }
    /* 칸 이름이 길어도(언어 · Language) 글자가 꺾이지 않게 한 줄로 두고, 넘치면 옆으로 민다 */
    nav {
      grid-auto-flow: column;
      grid-auto-columns: max-content;
      overflow-x: auto;
    }
    nav button {
      white-space: nowrap;
    }
  }
  .folder-name {
    font-size: 12px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .swatches,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: flex-end;
  }
  .chip {
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--panel);
  }
  .chip[aria-pressed="true"] {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, var(--panel));
    font-weight: 600;
  }
  .chip[aria-pressed="true"]::before {
    content: "✓ ";
    color: var(--accent);
  }
  .tools {
    display: flex;
    justify-content: flex-end;
    margin-bottom: -6px;
  }
  .content .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
  }
  .in-box {
    margin: 8px 0 4px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ctl-range {
    width: min(160px, 40vw);
  }
  .swatch {
    width: 24px;
    height: 24px;
    min-height: 0;
    padding: 0;
    border-radius: 50%;
    border: 2px solid var(--line);
    background: var(--sw-light);
  }
  :global(:root[data-theme="dark"]) .swatch {
    background: var(--sw-dark);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) .swatch {
      background: var(--sw-dark);
    }
  }
  .swatch.on {
    border-color: var(--text);
    box-shadow: 0 0 0 2px var(--panel) inset;
  }
</style>
