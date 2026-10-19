<script lang="ts">
  import type { LengthLimit } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { tupletBaseLabel } from "./Toolbar.svelte";
  import { isGridDivision, TUPLET_BASES, TUPLET_COUNTS, tupletFits, tupletGrid, tupletName, type Tuplet } from "./tuplet";

  /** 잇단음 정하기 작은 창: count개를 base분음표 시간에. 고르면 새 음 길이가 되고, 켜 두면 격자도 그 칸으로 */
  interface Props {
    tuplet: Tuplet;
    /** 게임이 받는 음 길이 범위 (곡 프로필) */
    limit: LengthLimit;
    onapply: (tuplet: Tuplet, grid: boolean) => void;
    onclose: () => void;
  }

  let { tuplet: initial, limit, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let count = $state(initial.count);
  /** 바탕 음표: "4" 또는 점음표 "4." */
  // svelte-ignore state_referenced_locally
  let baseName = $state(`${initial.base}${initial.dotted ? "." : ""}`);
  let grid = $state(true);
  const chosen = $derived<Tuplet>({ count, base: Number(baseName.replace(".", "")), dotted: baseName.endsWith(".") });
  const n = $derived(tupletName(chosen));
  const cell = $derived(tupletGrid(chosen));
  const fits = $derived(tupletFits(chosen, limit));
  /** 잇단음 칸이 격자로 쓸 수 있을 만큼 굵은지 (l40.의 칸 1/80은 너무 잘다) */
  const gridFits = $derived(isGridDivision(cell, limit));
  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (!fits) return;
    onapply(chosen, grid && gridFits);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.tupletTitle")}</h2>
  <p class="muted">{t("ui.tupletHelp")}</p>
  <div class="row">
    <select bind:value={count} aria-label={t("ui.tupletCount")}>
      {#each TUPLET_COUNTS as c (c)}<option value={c}>{c}</option>{/each}
    </select>
    <span>{t("ui.tupletCountUnit")}</span>
    <select bind:value={baseName} aria-label={t("ui.tupletBase")}>
      {#each TUPLET_BASES as b (b)}<option value={`${b}`}>{tupletBaseLabel(b, false)}</option>{/each}
      {#each TUPLET_BASES as b (b)}<option value={`${b}.`}>{tupletBaseLabel(b, true)}</option>{/each}
    </select>
    <span>{t("ui.tupletBaseUnit")}</span>
  </div>
  {#if fits}
    <p>{t("ui.tupletResult", { n })}</p>
  {:else}
    <p class="error" role="alert">{t("ui.tupletTooShort", { n, min: limit.min, max: limit.max })}</p>
  {/if}
  {#if !fits || gridFits}
    <label class="row">
      <input type="checkbox" bind:checked={grid} disabled={!fits} />
      <span>{t("ui.tupletGrid", { n: cell })}</span>
    </label>
  {:else}
    <p class="muted">{t("ui.tupletGridTooFine", { n: cell, max: limit.max })}</p>
  {/if}
  <div class="actions">
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!fits} onclick={apply}>{t("ui.tupletApply")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(380px, calc(100vw - 32px));
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
    flex-wrap: wrap;
  }
  .error {
    color: var(--danger);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
