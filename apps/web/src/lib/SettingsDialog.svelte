<script lang="ts">
  import type { SoundPackInfo } from "@mmlce/audio/browser";
  import { LOCALES, type Locale } from "@mmlce/i18n";
  import { i18n, LOCALE_LABELS, setLocale, t } from "./i18n.svelte";
  import { guideUrl, REPO_URL } from "./links";
  import { pwa } from "./pwa.svelte";

  /** 공개 사이트면 이 판을 빌드한 커밋의 소스로, 아니면 저장소 첫 화면으로 */
  const sourceUrl = __MMLCE_BUILD__.published && __MMLCE_BUILD__.commit ? `${REPO_URL}/tree/${__MMLCE_BUILD__.commit}` : REPO_URL;
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
    onaddpack: () => void;
    masterVolume: number;
    onvolume: (v: number) => void;
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
    /** 처음 열 항목 (사운드팩 없음 표시를 눌러 열었으면 사운드팩) */
    initial?: Section;
    onclose: () => void;
  }

  type Section = "packs" | "playback" | "display" | "keys";

  let {
    packs,
    stored,
    loadingPack,
    onremovepack,
    onaddpack,
    masterVolume,
    onvolume,
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
    initial = "packs",
    onclose,
  }: Props = $props();

  const NOTE_LOOKS: readonly (keyof NoteLook)[] = ["round", "border", "shade", "names"];
  function setLook(k: keyof NoteLook, on: boolean) {
    onappearance({ ...appearance, note: { ...appearance.note, [k]: on } });
  }

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let section = $state<Section>(initial);
  $effect(() => {
    dialog.showModal();
  });

  const SECTIONS: readonly Section[] = ["packs", "playback", "display", "keys"];
  const sectionLabel = (s: Section) =>
    t(s === "packs" ? "ui.settingsPacks" : s === "playback" ? "ui.settingsPlayback" : s === "display" ? "ui.settingsDisplay" : "ui.settingsKeys");
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
          <PackBar {packs} {stored} loading={loadingPack} onremove={onremovepack} />
        </div>
        <button class="primary" onclick={onaddpack}>{t("ui.addPack")}…</button>
        <p class="muted help">{t(pwa.storage === "persisted" ? "ui.storagePersisted" : "ui.storageBestEffort")}</p>
      {:else if section === "playback"}
        <label class="row" title={t("ui.masterVolume")}>
          <span>{t("ui.masterVolume")}</span>
          <input type="range" min="0" max="1.5" step="0.05" value={masterVolume} oninput={(e) => onvolume(Number(e.currentTarget.value))} />
        </label>
        <label class="row" title={t("ui.syncOffsetHelp")}>
          <span>{t("ui.syncOffset")}</span>
          <input class="num wide" type="number" step="10" min="-1000" max="1000" value={syncOffsetMs} onchange={(e) => onsync(Number(e.currentTarget.value) || 0)} />
          ms
        </label>
        <p class="muted help">{t("ui.syncOffsetHelp")}</p>
        <label class="row" title={t("ui.lightKeysHelp")}>
          <input type="checkbox" checked={lightKeys} onchange={onlightkeys} />
          <span>{t("ui.lightKeys")}</span>
        </label>
        <label class="row" title={t("ui.midiKeysVelocityHelp")}>
          <input type="checkbox" disabled={!midiKeys.status} checked={midiKeys.status?.velocity ?? false} onchange={(e) => midiKeys.setVelocity(e.currentTarget.checked)} />
          <span>{t("ui.midiKeys")}: {t("ui.midiKeysVelocity")}</span>
        </label>
      {:else if section === "display"}
        <label class="row">
          <span>{t("ui.colorScheme")}</span>
          <select value={colorScheme} onchange={(e) => oncolorscheme(e.currentTarget.value as ColorScheme)}>
            <option value="score">{t("ui.colorByScore")}</option>
            <option value="position">{t("ui.colorByPosition")}</option>
            <option value="stored">{t("ui.colorStored")}</option>
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
        <label class="row">
          <span>{t("ui.language")}</span>
          <select value={i18n.locale} onchange={(e) => setLocale(e.currentTarget.value as Locale)}>
            {#each LOCALES as l (l)}<option value={l}>{LOCALE_LABELS[l]}</option>{/each}
          </select>
        </label>
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
    {t("ui.about", { version: __MMLCE_BUILD__.version, commit: __MMLCE_BUILD__.commit || "-", date: new Date(__MMLCE_BUILD__.date).toLocaleString(i18n.locale) })}<br />
    {t("ui.aboutCredit")} ·
    <a href={guideUrl(i18n.locale)} target="_blank" rel="noopener">{t("ui.helpGuide")}</a> ·
    <a href={sourceUrl} target="_blank" rel="noopener">{t("ui.aboutSource")}</a> ·
    <a href="./licenses/GPL-3.0.txt" target="_blank" rel="noopener">GPL-3.0</a> ·
    <a href="./licenses/third-party.txt" target="_blank" rel="noopener">{t("ui.aboutLicenses")}</a> ·
    <a href={`${REPO_URL}/issues/new/choose`} target="_blank" rel="noopener">{t("ui.aboutReport")}</a><br />
    {t("ui.aboutUnofficial")}
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
  .help {
    margin: -4px 0 0;
    font-size: 12px;
  }
  .about a {
    color: var(--accent);
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
    nav {
      grid-auto-flow: column;
    }
  }
  .swatches,
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
