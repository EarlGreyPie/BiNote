<script lang="ts">
  import { INSTRUMENTS } from "@mmlce/core";
  import { instrumentName, t } from "./i18n.svelte";

  /** 악보 더하기: 악기를 고르면 그 악기 연주자와 빈 트랙 하나가 생긴다 */
  interface Props {
    initial: string;
    onadd: (canonical: string) => void;
    onclose: () => void;
  }

  let { initial, onadd, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let instrument = $state(initial);
  $effect(() => {
    dialog.showModal();
  });

  function add() {
    onadd(instrument);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.addScoreTitle")}</h2>
  <p class="muted">{t("ui.addScoreHelp")}</p>
  <label>
    {t("ui.newScore")}
    <select bind:value={instrument}>
      {#each INSTRUMENTS as inst (inst.id)}<option value={inst.id}>{instrumentName(inst.id)}</option>{/each}
    </select>
  </label>
  <div class="actions">
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" onclick={add}>{t("ui.add")}</button>
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
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
