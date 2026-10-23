<script lang="ts">
  import { rat, type TempoEvent } from "@mmlce/core";
  import type { TempoCurve, TempoRamp } from "@mmlce/mml";
  import { t } from "./i18n.svelte";
  import type { PreviewRow } from "./output";

  /**
   * 점점 느리게·빠르게 창 (실험실 · 곡 → 템포): 구간에 간격마다 t를 계단처럼 적는다.
   * 미리보기는 실제로 적을 곡으로 계산한다 (계단 템포 목록과 트랙별 글자 수)
   */
  interface Props {
    /** 범위 표시 (반복 구간 · 고른 음 마디:박 ~ 마디:박) */
    scope: string;
    /** 구간 처음 자리 템포 (처음 값 기본) */
    startBpm: number;
    /** 구간 끝 자리 원래 템포 (돌아갈 값) */
    backBpm: number;
    tempoRange: { readonly min: number; readonly max: number };
    /** 트랙 글자 수 한도 */
    limit: number;
    preview: (ramp: TempoRamp) => { readonly steps: readonly TempoEvent[]; readonly replaced: number; readonly rows: readonly PreviewRow[] };
    onapply: (ramp: TempoRamp) => void;
    onclose: () => void;
  }

  let { scope, startBpm, backBpm, tempoRange, limit, preview, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  /** 계단 간격 (n분음표마다) */
  const STEPS = [1, 2, 4, 8, 16] as const;
  const CURVES: { id: TempoCurve; label: "ui.tempoRampLinear" | "ui.tempoRampIn" | "ui.tempoRampOut" }[] = [
    { id: "linear", label: "ui.tempoRampLinear" },
    { id: "in", label: "ui.tempoRampIn" },
    { id: "out", label: "ui.tempoRampOut" },
  ];
  const clamp = (bpm: number) => Math.min(tempoRange.max, Math.max(tempoRange.min, Math.round(bpm)));
  // svelte-ignore state_referenced_locally
  let start = $state(clamp(startBpm));
  // svelte-ignore state_referenced_locally
  let end = $state(clamp(startBpm * 0.75));
  let step = $state<number>(4);
  let curve = $state<TempoCurve>("linear");
  let restore = $state(true);
  $effect(() => {
    dialog.showModal();
  });

  /** 점점 느리게 = 처음의 3/4로, 점점 빠르게 = 처음의 5/4로 (값은 직접 고칠 수 있다) */
  function preset(slower: boolean) {
    end = clamp(start * (slower ? 0.75 : 1.25));
  }

  const valid = $derived(Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= 1);
  const ramp = $derived<TempoRamp>({ startBpm: start, endBpm: end, step: rat(1, step), curve, restore });
  const result = $derived(valid ? preview(ramp) : undefined);
  const clamped = $derived(valid && [start, end].some((b) => b < tempoRange.min || b > tempoRange.max));
  const over = $derived(result?.rows.some((r) => r.after > limit) ?? false);
  const listed = $derived.by(() => {
    const bpms = result?.steps.map((e) => `t${e.bpm}`) ?? [];
    return bpms.length > 10 ? [...bpms.slice(0, 5), "…", ...bpms.slice(-4)].join(" ") : bpms.join(" ");
  });

  function apply() {
    if (!valid || !result || result.steps.length === 0) return;
    onapply(ramp);
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
  <h2>{t("ui.tempoRamp")} <span class="muted where">{scope}</span></h2>
  <div class="seg">
    <button class:on={valid && end < start} onclick={() => preset(true)}>{t("ui.tempoRampRit")}</button>
    <button class:on={valid && end > start} onclick={() => preset(false)}>{t("ui.tempoRampAccel")}</button>
  </div>
  <div class="row">
    <label>{t("ui.tempoRampStart")} t<input class="num" type="number" step="1" min={tempoRange.min} max={tempoRange.max} bind:value={start} {onkeydown} /></label>
    <span aria-hidden="true">→</span>
    <!-- svelte-ignore a11y_autofocus -->
    <label>{t("ui.tempoRampEnd")} t<input class="num" type="number" step="1" min={tempoRange.min} max={tempoRange.max} bind:value={end} {onkeydown} autofocus /></label>
  </div>
  <div class="row">
    <span class="name">{t("ui.tempoRampStep")}</span>
    <div class="seg">
      {#each STEPS as n (n)}
        <button class:on={step === n} onclick={() => (step = n)}>l{n}</button>
      {/each}
    </div>
  </div>
  <div class="row">
    <span class="name">{t("ui.tempoRampCurve")}</span>
    <div class="seg">
      {#each CURVES as c (c.id)}
        <button class:on={curve === c.id} onclick={() => (curve = c.id)}>{t(c.label)}</button>
      {/each}
    </div>
  </div>
  <label class="check"><input type="checkbox" bind:checked={restore} /> {t("ui.tempoRampRestore", { bpm: backBpm })}</label>
  {#if result}
    {#if result.steps.length === 0}
      <p class="warn">{t("ui.tempoRampNone")}</p>
    {:else}
      <p class="muted">{t("ui.tempoRampSteps", { n: result.steps.length, list: listed })}</p>
    {/if}
    {#if result.replaced > 0}<p class="muted">{t("ui.tempoRampReplaced", { n: result.replaced })}</p>{/if}
    {#if result.rows.length > 0}
      <p class="muted">{t("ui.tempoRampChars", { limit })}</p>
      <ul class="rows">
        {#each result.rows as r (r.trackId)}
          <li class:warn={r.after > limit}>{r.name}: {r.before} → {r.after}</li>
        {/each}
      </ul>
    {/if}
    {#if over}<p class="warn">{t("ui.tempoRampOver")}</p>{/if}
  {/if}
  {#if clamped}<p class="warn">{t("ui.tempoRampClamp", { min: tempoRange.min, max: tempoRange.max })}</p>{/if}
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!result || result.steps.length === 0} onclick={apply}>{t("ui.eventApply")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px));
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
    flex-wrap: wrap;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .name {
    min-width: 3em;
  }
  /* 세 자리 템포와 위아래 화살표가 다 보이게 넉넉히 */
  .num {
    width: 5em;
    font-size: 1.05rem;
    padding: 4px 6px;
    margin-left: 2px;
  }
  .check {
    display: block;
    margin-top: 10px;
  }
  .rows {
    margin: 4px 0 0;
    padding-left: 18px;
    max-height: 8em;
    overflow: auto;
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
