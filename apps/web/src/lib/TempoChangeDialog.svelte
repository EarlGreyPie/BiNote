<script lang="ts">
  import { changedBpm, type TempoChange } from "@mmlce/mml";
  import { t } from "./i18n.svelte";

  /**
   * 템포 한꺼번에 바꾸기 창 (곡 메뉴): 곡 전체나 반복 구간의 템포를 한 값으로 맞추거나 ±BPM·%로 바꾼다
   */
  interface Props {
    /** 범위 표시 (곡 전체 · 반복 구간 마디:박 ~ 마디:박) */
    scope: string;
    /** 바뀔 템포 (구간 처음 자리 템포 포함) */
    bpms: readonly number[];
    tempoRange: { readonly min: number; readonly max: number };
    /** 반복 구간이면 구간 뒤는 그대로 둔다는 안내를 보인다 */
    loop: boolean;
    onapply: (change: TempoChange) => void;
    onclose: () => void;
  }

  let { scope, bpms, tempoRange, loop, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  type Mode = TempoChange["mode"];
  const MODES: Mode[] = ["set", "add", "scale"];
  const LABEL = { set: "ui.tempoChangeSet", add: "ui.tempoChangeAdd", scale: "ui.tempoChangeScale" } as const;
  // svelte-ignore state_referenced_locally
  const first = bpms[0] ?? 120;
  let mode = $state<Mode>("set");
  let value = $state(first);
  $effect(() => {
    dialog.showModal();
  });

  function pick(m: Mode) {
    mode = m;
    value = m === "set" ? first : m === "add" ? 0 : 100;
  }

  const valid = $derived(Number.isFinite(value) && (mode === "add" ? Number.isInteger(value) : mode === "set" ? Number.isInteger(value) && value >= 1 : value > 0));
  const after = $derived(valid ? bpms.map((b) => changedBpm(b, { mode, value })) : []);
  const out = $derived(after.filter((b) => b < tempoRange.min || b > tempoRange.max).length);
  const changes = $derived(after.some((b, k) => b !== bpms[k]));

  function apply() {
    if (!valid || !changes) return;
    onapply({ mode, value });
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
  <h2>{t("ui.tempoChange")} <span class="muted where">{scope}</span></h2>
  <div class="seg">
    {#each MODES as m (m)}
      <button class:on={mode === m} onclick={() => pick(m)}>{t(LABEL[m])}</button>
    {/each}
  </div>
  <div class="row">
    {#if mode === "set"}t{/if}
    <!-- svelte-ignore a11y_autofocus -->
    <input class="num" type="number" step="1" min={mode === "add" ? -998 : 1} max={mode === "scale" ? 1000 : 999} bind:value {onkeydown} autofocus />
    {#if mode === "scale"}%{/if}
  </div>
  {#if valid && bpms.length > 0}
    <p class="muted">
      {t("ui.tempoChangePreview", { n: bpms.length, min: Math.min(...bpms), max: Math.max(...bpms), toMin: Math.min(...after), toMax: Math.max(...after) })}
    </p>
  {/if}
  {#if out > 0}<p class="warn">{t("ui.tempoChangeOut", { n: out, min: tempoRange.min, max: tempoRange.max })}</p>{/if}
  {#if loop}<p class="muted">{t("ui.tempoChangeEdge")}</p>{/if}
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!valid || !changes} onclick={apply}>{t("ui.eventApply")}</button>
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
</style>
