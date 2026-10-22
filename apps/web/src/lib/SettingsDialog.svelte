<script lang="ts">
  import { gainKey, type InstrumentGains, type SoundPackInfo } from "@mmlce/audio/browser";
  import { LOCALES, type Locale } from "@mmlce/i18n";
  import { i18n, instrumentName, LOCALE_LABELS, setLocale, t } from "./i18n.svelte";
  import { guideUrl, REPO_URL } from "./links";
  import { MASTER_MAX } from "./engine";
  import { pwa } from "./pwa.svelte";
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
  import { canAskSave, canPickFolder, canShareFiles, pickSaveFolder, saveTarget, setSaveMode, setSaveShare } from "./saveTarget.svelte";
  import { LANE_MAX, LANE_MIN, saveVolumeLane, volumeLane, type LaneState } from "./volumeLane.svelte";
  import { LAB_FEATURES, labs, setButtonNames, setLabs } from "./labs.svelte";

  import Icon from "./Icon.svelte";
  import PackBar from "./PackBar.svelte";
  import type { MidiKeys } from "./midiKeys.svelte";
  import type { ColorScheme } from "./scores";
  import { ACCENTS, EDITOR_FONT_SIZES, EDITOR_FONTS, type Appearance, type EditorFont, type NoteLook, type ThemeMode } from "./appearance";

  /** 설정 창: 사운드팩 · 재생 · 화면 · 단축키. 맨 아래에 판 정보 */
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

  type Section = "packs" | "playback" | "display" | "chords" | "save" | "labs" | "language" | "keys";

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

  const SECTIONS: readonly Section[] = ["packs", "playback", "display", "chords", "save", "labs", "language", "keys"];
  /** 언어 칸은 글자를 못 읽는 언어로 바뀌어도 찾을 수 있게 영어 "Language"를 늘 같이 적는다 */
  const sectionLabel = (s: Section) =>
    s === "language"
      ? i18n.locale === "en"
        ? t("ui.language")
        : `${t("ui.language")} · Language`
      : t(s === "packs" ? "ui.settingsPacks" : s === "playback" ? "ui.settingsPlayback" : s === "display" ? "ui.settingsDisplay" : s === "chords" ? "ui.settingsChords" : s === "save" ? "ui.settingsSave" : s === "labs" ? "ui.settingsLabs" : "ui.settingsKeys");
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
      {#if section === "packs"}
        <div class="packs-list">
          <PackBar {packs} {stored} loading={loadingPack} onremove={onremovepack} onmove={onmovepack} />
        </div>
        <button class="primary" onclick={onaddpack}>{t("ui.addPack")}…</button>
        <p class="muted help">{t("ui.packOrderHelp")}</p>
        <p class="muted help">{t(pwa.storage === "persisted" ? "ui.storagePersisted" : "ui.storageBestEffort")}</p>
      {:else if section === "playback"}
        <label class="row" title={t("ui.masterVolume")}>
          <span>{t("ui.masterVolume")}</span>
          <input type="range" min="0" max={MASTER_MAX} step="0.05" value={masterVolume} oninput={(e) => onvolume(Number(e.currentTarget.value))} />
        </label>
        <label class="row" title={t("ui.lightKeysHelp")}>
          <input type="checkbox" checked={lightKeys} onchange={onlightkeys} />
          <span>{t("ui.lightKeys")}</span>
        </label>
        <label class="row" title={t("ui.selectKeysHelp")}>
          <span>{t("ui.selectKeys")}</span>
          <select value={selectKeys.mode} onchange={(e) => setSelectKeys(e.currentTarget.value as SelectKeysMode)}>
            <option value="off">{t("ui.selectKeysOff")}</option>
            <option value="press">{t("ui.selectKeysPress")}</option>
            <option value="select">{t("ui.selectKeysSelect")}</option>
          </select>
        </label>
        <p class="muted help">{t("ui.selectKeysHelp")}</p>
        <label class="row" title={t("ui.midiKeysVelocityHelp")}>
          <input type="checkbox" checked={midiKeys.velocity} onchange={(e) => midiKeys.setVelocity(e.currentTarget.checked)} />
          <span>{t("ui.midiKeys")}: {t("ui.midiKeysVelocity")}</span>
        </label>
        <label class="row" title={t("ui.syncOffsetHelp")}>
          <span>{t("ui.syncOffset")}</span>
          <input class="num wide" type="number" step="10" min="-1000" max="1000" value={syncOffsetMs} onchange={(e) => onsync(Number(e.currentTarget.value) || 0)} />
          ms
        </label>
        <p class="muted help">{t("ui.syncOffsetHelp")}</p>
        <h3 class="sub">{t("ui.instrumentGains")}</h3>
        {#if packs.length === 0}
          <p class="muted help">{t("ui.instrumentGainsNoPack")}</p>
        {:else}
          <p class="muted help">{t("ui.instrumentGainsHelp")}</p>
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
      {:else if section === "display"}
        <label class="row">
          <span>{t("ui.colorScheme")}</span>
          <select value={colorScheme} onchange={(e) => oncolorscheme(e.currentTarget.value as ColorScheme)}>
            <option value="score">{t("ui.colorByScore")}</option>
            <option value="position">{t("ui.colorByPosition")}</option>
            <option value="stored">{t("ui.colorStored")}</option>
          </select>
        </label>
        <label class="row" title={t("ui.rollFlowHelp")}>
          <span>{t("ui.rollFlow")}</span>
          <select value={rollFlow.mode} onchange={(e) => setRollFlow(e.currentTarget.value as RollFlow)}>
            <option value="page">{t("ui.rollFlowPage")}</option>
            <option value="flow">{t("ui.rollFlowFlow")}</option>
          </select>
        </label>
        <p class="muted help">{t("ui.rollFlowHelp")}</p>
        <label class="row" title={t("ui.editorMaxHelp")}>
          <span>{t("ui.editorMax")}</span>
          <select value={editorMax} onchange={(e) => oneditormax(Number(e.currentTarget.value))}>
            {#each Array.from({ length: Math.max(1, editorLimit - 1) }, (_, k) => k + 2) as n (n)}<option value={n}>{n}</option>{/each}
          </select>
        </label>
        <p class="muted help">{t("ui.editorMaxHelp")}</p>
        <label class="row" title={t("ui.tabTrackTintHelp")}>
          <input type="checkbox" checked={tabTint.on} onchange={(e) => setTabTint(e.currentTarget.checked)} />
          <span>{t("ui.tabTrackTint")}</span>
        </label>
        <label class="row" title={t("ui.lengthPadTripletsHelp")}>
          <input type="checkbox" checked={fretPadPrefs.triplets} onchange={(e) => setLengthPadTriplets(e.currentTarget.checked)} />
          <span>{t("ui.lengthPadTriplets")}</span>
        </label>
        <label class="row" title={t("ui.lengthPadTupletHelp")}>
          <input type="checkbox" checked={tupletPrefs.pad} onchange={(e) => setLengthPadTuplet(e.currentTarget.checked)} />
          <span>{t("ui.lengthPadTuplet")}</span>
        </label>
        <label class="row" title={t("ui.padAdvanceDirHelp")}>
          <span>{t("ui.padAdvanceDir")}</span>
          <select value={fretPadPrefs.advance} onchange={(e) => setPadAdvanceDir(e.currentTarget.value as PadAdvanceDir)}>
            <option value="right">{t("ui.padAdvanceRight")}</option>
            <option value="down">{t("ui.padAdvanceDown")}</option>
          </select>
        </label>
        <label class="row" title={t("ui.tabEventFontHelp")}>
          <span>{t("ui.tabEventFont")}</span>
          <select value={tabEventPrefs.font} onchange={(e) => setTabEventFont(Number(e.currentTarget.value))}>
            {#each TAB_EVENT_FONTS as px (px)}<option value={px}>{t(px === TAB_EVENT_FONT ? "ui.tabEventFontDefault" : "ui.tabEventFontPx", { px })}</option>{/each}
          </select>
        </label>
        <label class="row">
          <span>{t("ui.theme")}</span>
          <select value={appearance.theme} onchange={(e) => onappearance({ ...appearance, theme: e.currentTarget.value as ThemeMode })}>
            <option value="system">{t("ui.themeSystem")}</option>
            <option value="light">{t("ui.themeLight")}</option>
            <option value="dark">{t("ui.themeDark")}</option>
          </select>
        </label>
        <div class="row">
          <span>{t("ui.accent")}</span>
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
        </div>
        <div class="row">
          <span>{t("ui.noteLook")}</span>
          <span class="checks">
            {#each NOTE_LOOKS as k (k)}
              <label><input type="checkbox" checked={appearance.note[k]} onchange={(e) => setLook(k, e.currentTarget.checked)} /> {t(`ui.noteLook.${k}`)}</label>
            {/each}
          </span>
        </div>
        <label class="row" title={t("ui.volumeLabelsHelp")}>
          <span>{t("ui.volumeLabels")}</span>
          <select value={volumeLabels.mode} onchange={(e) => setVolumeLabels(e.currentTarget.value as VolumeLabelMode)}>
            <option value="off">{t("ui.volumeLabels.off")}</option>
            <option value="changes">{t("ui.volumeLabels.changes")}</option>
            <option value="all">{t("ui.volumeLabels.all")}</option>
          </select>
        </label>
        <p class="muted help">{t("ui.volumeLabelsHelp")}</p>
        <label class="row" title={t("ui.timbreZonesHelp")}>
          <span>{t("ui.timbreZones")}</span>
          <input type="checkbox" checked={timbreZones.on} onchange={(e) => setTimbreZones(e.currentTarget.checked)} />
        </label>
        <p class="muted help">{t("ui.timbreZonesHelp")}</p>
        <div class="row">
          <span>{t("ui.editorFont")}</span>
          <span class="checks">
            <select aria-label={t("ui.editorFont")} value={appearance.editorFont} onchange={(e) => onappearance({ ...appearance, editorFont: e.currentTarget.value as EditorFont })}>
              {#each Object.keys(EDITOR_FONTS) as f (f)}<option value={f}>{t(`ui.editorFont.${f as EditorFont}`)}</option>{/each}
            </select>
            <select aria-label={t("ui.editorFontSize")} value={appearance.editorFontSize} onchange={(e) => onappearance({ ...appearance, editorFontSize: Number(e.currentTarget.value) })}>
              {#each EDITOR_FONT_SIZES as px (px)}<option value={px}>{px}px</option>{/each}
            </select>
          </span>
        </div>
        <h3 class="sub">{t("ui.laneSettings")}</h3>
        <label class="row" title={t("ui.laneHelp")}>
          <span>{t("ui.laneShow")}</span>
          <select value={volumeLane.state} onchange={(e) => saveVolumeLane({ state: e.currentTarget.value as LaneState })}>
            <option value="collapsed">{t("ui.laneStateCollapsed")}</option>
            <option value="compact">{t("ui.laneStateCompact")}</option>
            <option value="expanded">{t("ui.laneStateExpanded")}</option>
          </select>
        </label>
        <label class="row" title={t("ui.laneSizeHelp")}>
          <span>{t("ui.laneSize")}</span>
          <input
            type="range"
            min={LANE_MIN}
            max={LANE_MAX}
            step="4"
            value={volumeLane.size}
            oninput={(e) => saveVolumeLane({ size: Number(e.currentTarget.value), state: "expanded" })}
          />
          <output>{volumeLane.size}px</output>
        </label>
      {:else if section === "chords"}
        <label class="row">
          <input type="checkbox" checked={chordPrefs.merge} onchange={(e) => setMidiMerge(e.currentTarget.checked)} />
          <span>{t("ui.mergeOnImport")}</span>
        </label>
        <p class="muted help">{t("ui.mergeSettingHelp")}</p>
        <label class="row">
          <input type="checkbox" checked={splitPrefs.spread} onchange={(e) => setSplitSpread(e.currentTarget.checked)} />
          <span>{t("ui.spreadOnSplit")}</span>
        </label>
        <p class="muted help">{t("ui.spreadSettingHelp")}</p>
      {:else if section === "save"}
        {#if canAskSave || canPickFolder}
          <div class="save-modes" role="radiogroup" aria-label={t("ui.saveFolder")}>
            {#if canAskSave}
              <label class="row">
                <input type="radio" name="save-mode" checked={saveTarget.mode === "ask"} onchange={() => setSaveMode("ask")} />
                <span>{t("ui.saveAsk")}</span>
              </label>
              <p class="muted help">{t("ui.saveAskHelp")}</p>
            {/if}
            {#if canPickFolder}
              <div class="row">
                <label class="checks">
                  <input
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
                  <span>{t("ui.saveFolderFixed")}</span>
                </label>
                <span class="checks">
                  {#if saveTarget.folder}<span class="folder-name">{saveTarget.folder}</span>{/if}
                  <button onclick={() => void pickSaveFolder()}>{t("ui.saveFolderPick")}…</button>
                </span>
              </div>
              <p class="muted help">{t("ui.saveFolderHelp")}</p>
            {/if}
            <label class="row">
              <input type="radio" name="save-mode" checked={saveTarget.mode === "download" || (saveTarget.mode === "folder" && !saveTarget.folder) || (saveTarget.mode === "ask" && !canAskSave)} onchange={() => setSaveMode("download")} />
              <span>{t("ui.saveFolderDownloads")}</span>
            </label>
          </div>
        {:else if canShareFiles}
          <label class="row">
            <input type="checkbox" checked={saveTarget.share} onchange={(e) => setSaveShare(e.currentTarget.checked)} />
            <span>{t("ui.saveShare")}</span>
          </label>
          <p class="muted help">{t("ui.saveShareHelp")}</p>
        {:else}
          <p class="muted help">{t("ui.saveDownloadOnly")}</p>
        {/if}
      {:else if section === "labs"}
        <label class="row">
          <input type="checkbox" checked={labs.on} onchange={(e) => setLabs(e.currentTarget.checked)} />
          <span>{t("ui.labsOn")}</span>
        </label>
        <p class="muted help">{t("ui.labsHelp")}</p>
        <ul class="labs">
          {#each LAB_FEATURES as f (f.id)}
            <li class:off={!labs.on}><b>{t(f.label)}</b> <span class="muted">{t(f.help)}</span></li>
          {/each}
        </ul>
        <label class="row">
          <input type="checkbox" checked={labs.buttonNames} disabled={!labs.on} onchange={(e) => setButtonNames(e.currentTarget.checked)} />
          <span>{t("ui.labButtonNames")}</span>
        </label>
        <p class="muted help">{t("ui.labButtonNamesHelp")}</p>
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
  .labs {
    margin: 4px 0;
    padding-left: 1.2em;
  }
  .labs li {
    margin: 4px 0;
  }
  .labs li.off {
    opacity: 0.6;
  }
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
  .sub {
    margin: 14px 0 2px;
    font-size: 0.9rem;
  }
  .gains {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 8px;
    margin-top: 6px;
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
    gap: 10px;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row > span:first-child {
    min-width: 8em;
  }
  .row input[type="checkbox"] + span {
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
  .swatches,
  .folder-name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    align-items: center;
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
