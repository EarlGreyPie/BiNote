<script lang="ts">
  import { parseBarList, type BarRange } from "@mmlce/core";
  import type { DeleteBarsCheck, ReferenceShiftPlan } from "@mmlce/mml";
  import { t } from "./i18n.svelte";

  interface Props {
    /** 반복 구간이 걸친 마디 [첫, 끝]. 반복 구간이 없으면 undefined */
    loopBars?: BarRange | undefined;
    /** 지우면 어떻게 되는지 (창에 미리 보여 준다) */
    check: (bars: readonly BarRange[]) => DeleteBarsCheck;
    /** 원곡 대조 위치를 어떻게 맞출지. 원곡이 없으면 undefined */
    referencePlan?: ((bars: readonly BarRange[]) => ReferenceShiftPlan | undefined) | undefined;
    /** 배경 영상 위치를 어떻게 맞출지 (원곡과 같은 규칙). 영상이 없으면 undefined */
    videoPlan?: ((bars: readonly BarRange[]) => ReferenceShiftPlan | undefined) | undefined;
    onapply: (bars: readonly BarRange[]) => void;
    onclose: () => void;
  }

  let { loopBars, check, referencePlan, videoPlan, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // 마디: 선택 마디(반복 구간) / 적은 마디. 볼륨 창과 같은 고르기지만 "모든 마디"는 없다
  // svelte-ignore state_referenced_locally
  let barMode = $state<"loop" | "typed">(loopBars ? "loop" : "typed");
  let barText = $state("");
  const typedBars = $derived(parseBarList(barText));
  const bars = $derived<readonly BarRange[]>(barMode === "loop" ? (loopBars ? [loopBars] : []) : (typedBars ?? []));
  const barSpan = (b: BarRange) => (b[0] === b[1] ? `${b[0]}` : `${b[0]}-${b[1]}`);
  const result = $derived(check(bars));
  const reference = $derived(referencePlan?.(bars));
  /** 원곡 어긋남에 더할 ms (앱이 실제로 더하는 값과 같게 정수로) */
  const shiftMs = $derived(reference ? Math.round(reference.shiftSec * 1000) : 0);
  const video = $derived(videoPlan?.(bars));
  /** 배경 영상 어긋남에 더할 ms (앱과 같게 정수로) */
  const videoShiftMs = $derived(video ? Math.round(video.shiftSec * 1000) : 0);

  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (result.bars === 0) return;
    onapply(bars);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.deleteBars")}</h2>
  <div class="row">
    <label title={loopBars ? undefined : t("ui.volumeBarsNoLoop")}>
      <input type="radio" name="bars" value="loop" bind:group={barMode} disabled={!loopBars} />
      {loopBars ? t("ui.volumeBarsLoop", { bars: barSpan(loopBars) }) : t("ui.volumeBarsLoopNone")}
    </label>
    <label><input type="radio" name="bars" value="typed" bind:group={barMode} /> {t("ui.volumeBarsTyped")}</label>
    {#if barMode === "typed"}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="bars"
        type="text"
        inputmode="text"
        autofocus
        placeholder={t("ui.volumeBarsPlaceholder")}
        bind:value={barText}
        aria-label={t("ui.volumeBarsTyped")}
        onkeydown={(e) => {
          if (e.key === "Enter" && !e.isComposing) {
            e.preventDefault();
            apply();
          }
        }}
      />
    {/if}
  </div>
  {#if barMode === "typed" && barText.trim() !== "" && !typedBars}
    <p class="warn">{t("ui.volumeBarsInvalid")}</p>
  {/if}
  <p class="muted small">{t("ui.deleteBarsHelp")}</p>
  {#if result.bars > 0}
    <p>{t("ui.deleteBarsCount", { bars: result.bars, removed: result.removed })}</p>
    {#if result.cut > 0}
      <p class="muted">{t("ui.deleteBarsCut", { count: result.cut })}</p>
    {/if}
    {#if result.made > 0}
      <p class="warn">{t("ui.deleteBarsMade", { count: result.made })}</p>
    {/if}
    {#if shiftMs > 0}
      <p class="muted">{t("ui.deleteBarsReferenceShift", { seconds: shiftMs / 1000, ms: shiftMs })}</p>
    {/if}
    {#if reference?.brokenBar !== undefined}
      <p class="warn">{t("ui.deleteBarsReferenceOff", { bar: reference.brokenBar })}</p>
    {/if}
    {#if videoShiftMs > 0}
      <p class="muted">{t("ui.deleteBarsVideoShift", { seconds: videoShiftMs / 1000 })}</p>
    {/if}
    {#if video?.brokenBar !== undefined}
      <p class="warn">{t("ui.deleteBarsVideoOff", { bar: video.brokenBar })}</p>
    {/if}
  {:else if bars.length > 0}
    <p class="muted">{t("ui.deleteBarsNone")}</p>
  {/if}
  <footer>
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="danger" disabled={result.bars === 0} onclick={apply}>{t("ui.deleteBarsApply")}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(460px, calc(100vw - 32px));
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
  .row,
  footer {
    display: flex;
    align-items: center;
    gap: 8px 12px;
    flex-wrap: wrap;
    margin: 8px 0;
  }
  input.bars {
    width: 9em;
  }
  .spacer {
    flex: 1;
  }
  p {
    margin: 4px 0;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 0.85rem;
  }
  .warn,
  button.danger:not(:disabled) {
    color: var(--danger);
  }
</style>
