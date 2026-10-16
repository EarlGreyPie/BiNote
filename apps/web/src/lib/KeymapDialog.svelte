<script lang="ts">
  import type { MessageKey } from "@mmlce/i18n";
  import { t } from "./i18n.svelte";
  import {
    bind,
    COMMANDS,
    commandFor,
    keyName,
    keysOf,
    PRESETS,
    resolve,
    unbind,
    type CommandId,
    type KeymapSettings,
    type PresetId,
  } from "./keymap";

  interface Props {
    settings: KeymapSettings;
    onchange: (next: KeymapSettings) => void;
    onclose: () => void;
  }

  let { settings, onchange, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  /** 키를 기다리는 명령 */
  let capturing = $state<CommandId | undefined>(undefined);
  let notice = $state("");

  const bindings = $derived(resolve(settings));
  const customized = $derived(Object.keys(settings.overrides).length > 0);

  $effect(() => {
    dialog.showModal();
  });

  const label = (c: CommandId) => t(`cmd.${c}` as MessageKey);

  function oncapture(e: KeyboardEvent) {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      capturing = undefined;
      return;
    }
    const key = keyName(e);
    if (!key) return;
    const previous = commandFor(bindings, key);
    notice = previous && previous !== capturing ? t("ui.keyMoved", { key, from: label(previous) }) : "";
    onchange(bind(settings, capturing, key));
    capturing = undefined;
  }

  function onpreset(e: Event) {
    capturing = undefined;
    notice = "";
    onchange({ preset: (e.currentTarget as HTMLSelectElement).value as PresetId, overrides: {} });
  }
</script>

<!-- 키를 누른 뒤 ＋ 버튼이 사라지면 초점이 창 밖으로 가므로 window에서 받는다 -->
<svelte:window onkeydowncapture={oncapture} />

<dialog bind:this={dialog} onclose={onclose}>
  <header>
    <h2>{t("ui.keymap")}</h2>
    <label>
      {t("ui.keymapPreset")}
      <select value={settings.preset} onchange={onpreset}>
        {#each PRESETS as p (p)}<option value={p}>{t(`ui.preset.${p}` as MessageKey)}</option>{/each}
      </select>
    </label>
    {#if customized}
      <span class="muted">{t("ui.keymapCustomized")}</span>
      <button class="small" onclick={() => onchange({ ...settings, overrides: {} })}>{t("ui.keymapReset")}</button>
    {/if}
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.close")}</button>
  </header>
  <p class="muted">{t("ui.keymapHelp")}</p>
  {#if notice}<p class="notice">{notice}</p>{/if}
  <table>
    <tbody>
      {#each COMMANDS as c (c)}
        <tr>
          <th>{label(c)}</th>
          <td>
            {#each keysOf(bindings, c) as k (k)}
              <span class="key">
                <kbd>{k}</kbd>
                <button class="x" aria-label={t("ui.remove")} onclick={() => onchange(unbind(settings, c, k))}>×</button>
              </span>
            {/each}
            {#if capturing === c}
              <span class="waiting">{t("ui.keyWaiting")}</span>
            {:else}
              <button class="small" onclick={() => ((capturing = c), (notice = ""))}>+ {t("ui.keyAdd")}</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</dialog>

<style>
  dialog {
    width: min(640px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .spacer {
    flex: 1;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    font-weight: normal;
    padding: 4px 8px 4px 0;
    white-space: nowrap;
  }
  td {
    padding: 4px 0;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  tr + tr {
    border-top: 1px solid var(--line);
  }
  .key {
    display: inline-flex;
    align-items: center;
  }
  kbd {
    font-family: "D2Coding", ui-monospace, Consolas, monospace;
    font-size: 0.85rem;
    border: 1px solid var(--line);
    border-radius: 4px 0 0 4px;
    padding: 1px 6px;
  }
  .x {
    border: 1px solid var(--line);
    border-left: none;
    border-radius: 0 4px 4px 0;
    padding: 1px 5px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .waiting {
    color: var(--accent);
  }
</style>
