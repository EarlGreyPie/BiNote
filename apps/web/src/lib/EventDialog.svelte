<script lang="ts">
  import { METER_UNITS } from "@mmlce/core";
  import type { MessageKey } from "@mmlce/i18n";
  import { t } from "./i18n.svelte";
  import type { EventKind } from "./roll";

  /**
   * 템포·마커·박자를 넣거나 고치는 작은 창 (이벤트 줄 두 번 누르기·길게 누르기, Alt+B·Alt+M).
   * existing이면 그 이벤트를 고치고 지울 수 있으며 종류는 바꿀 수 없다
   */
  interface Props {
    kind: EventKind;
    existing: boolean;
    /** 위치 표시 (마디:박) */
    where: string;
    bpm: number;
    tempoRange: { readonly min: number; readonly max: number };
    marker: string;
    beats: number;
    unit: number;
    /** 곡 처음 템포·박자는 지울 수 없다(박자) / 지우면 t120 (템포) */
    atStart: boolean;
    onapply: (change: { kind: "tempo"; bpm: number } | { kind: "marker"; text: string } | { kind: "meter"; beats: number; unit: number }) => void;
    ondelete: () => void;
    onclose: () => void;
  }

  let { kind: initialKind, existing, where, bpm: initialBpm, tempoRange, marker: initialMarker, beats: initialBeats, unit: initialUnit, atStart, onapply, ondelete, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let kind = $state<EventKind>(initialKind);
  // svelte-ignore state_referenced_locally
  let bpm = $state(initialBpm);
  // svelte-ignore state_referenced_locally
  let marker = $state(initialMarker);
  // svelte-ignore state_referenced_locally
  let beats = $state(initialBeats);
  // svelte-ignore state_referenced_locally
  let unit = $state(initialUnit);
  $effect(() => {
    dialog.showModal();
  });

  const KINDS: EventKind[] = ["tempo", "marker", "meter"];
  const valid = $derived(
    kind === "tempo" ? Number.isInteger(bpm) && bpm >= 1 : kind === "marker" ? marker.trim() !== "" : Number.isInteger(beats) && beats >= 1 && beats <= 32,
  );
  const outOfRange = $derived(kind === "tempo" && valid && (bpm < tempoRange.min || bpm > tempoRange.max));
  const canDelete = $derived(existing && !(kind === "meter" && atStart));

  function apply() {
    if (!valid) return;
    onapply(kind === "tempo" ? { kind, bpm } : kind === "marker" ? { kind, text: marker.trim() } : { kind, beats, unit });
    dialog.close();
  }

  function remove() {
    ondelete();
    dialog.close();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      apply();
    }
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{existing ? t("ui.eventEdit") : t("ui.eventAdd")} <span class="muted where">{where}</span></h2>
  {#if !existing}
    <div class="seg">
      {#each KINDS as k (k)}
        <button class:on={kind === k} onclick={() => (kind = k)}>{t(`ui.event.${k}` as MessageKey)}</button>
      {/each}
    </div>
  {/if}
  <div class="row">
    {#if kind === "tempo"}
      <label>t <input class="num" type="number" min="1" max="999" bind:value={bpm} {onkeydown} /></label>
    {:else if kind === "marker"}
      <!-- svelte-ignore a11y_autofocus -->
      <input type="text" bind:value={marker} placeholder={t("ui.markerPlaceholder")} {onkeydown} autofocus />
    {:else}
      <input class="num" type="number" min="1" max="32" bind:value={beats} {onkeydown} />
      /
      <select bind:value={unit}>
        {#each METER_UNITS as u (u)}<option value={u}>{u}</option>{/each}
      </select>
    {/if}
  </div>
  {#if outOfRange}<p class="warn">{t("ui.tempoOutOfRange", { min: tempoRange.min, max: tempoRange.max })}</p>{/if}
  {#if kind === "tempo" && existing && atStart}<p class="muted">{t("ui.tempoStartDelete")}</p>{/if}
  {#if kind === "meter"}<p class="muted">{t("ui.meterHelpAt")}</p>{/if}
  <div class="actions">
    {#if canDelete}<button class="danger" onclick={remove}>{t("ui.eventDelete")}</button>{/if}
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!valid} onclick={apply}>{t("ui.eventApply")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(360px, calc(100vw - 32px));
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1.05rem;
  }
  .where {
    font-size: 0.85rem;
    font-weight: normal;
    margin-left: 6px;
  }
  .seg {
    display: inline-flex;
    margin-bottom: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row input[type="text"] {
    flex: 1;
  }
  /* 세 자리 템포와 위아래 화살표가 다 보이게 넉넉히 */
  .row .num {
    width: 6em;
    font-size: 1.1rem;
    padding: 4px 8px;
  }
  .warn {
    color: var(--warn, #c48a00);
    margin: 6px 0 0;
  }
  .muted {
    margin: 6px 0 0;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .spacer {
    flex: 1;
  }
  .danger {
    color: var(--error, #d33);
  }
</style>
