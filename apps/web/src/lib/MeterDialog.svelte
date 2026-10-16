<script lang="ts">
  import { METER_UNITS } from "@mmlce/core";
  import { t } from "./i18n.svelte";

  /** 박자 바꾸기 작은 창. 커서가 있으면 커서가 든 마디부터, 없으면 곡 처음부터 바뀐다 */
  interface Props {
    beats: number;
    unit: number;
    onapply: (beats: number, unit: number) => void;
    onclose: () => void;
  }

  let { beats: initialBeats, unit: initialUnit, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let beats = $state(initialBeats);
  // svelte-ignore state_referenced_locally
  let unit = $state(initialUnit);
  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    onapply(beats, unit);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.meterChange")}</h2>
  <p class="muted">{t("ui.meterHelp")}</p>
  <div class="row">
    <input class="num" type="number" min="1" max="32" bind:value={beats} />
    /
    <select bind:value={unit}>
      {#each METER_UNITS as u (u)}<option value={u}>{u}</option>{/each}
    </select>
  </div>
  <div class="actions">
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" onclick={apply}>{t("ui.meterApply")}</button>
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
    margin: 0 0 4px;
    font-size: 1.05rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
