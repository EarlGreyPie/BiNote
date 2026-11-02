<script lang="ts" module>
  import type { TransposeScope } from "./TransposeDialog.svelte";

  /** 맞춰 보면 어떻게 되는지 (창에 미리 보여 준다) */
  export interface KeyFitCheck {
    /** 범위 안 음 수 */
    readonly count: number;
    /** 조 밖이라 바뀔 음 수 */
    readonly changed: number;
  }
</script>

<script lang="ts">
  import { parseBarList, type BarRange } from "@mmlce/core";
  import { t } from "./i18n.svelte";

  /**
   * 조표에 맞추기: 고른 음이나 고른 마디(볼륨 일괄 조정·마디 지우기와 같은 마디 고르기) 안에서
   * 조 밖 음만 그 자리 조표대로 맞춘다 (흰 건반은 조표의 올림·내림을 붙이고, 검은 건반은 제자리음으로). 실행 취소 한 칸
   */
  interface Props {
    scopes: readonly { readonly id: TransposeScope; readonly label: string }[];
    initialScope: TransposeScope;
    /** 반복 구간이 걸친 마디 [첫, 끝]. 반복 구간이 없으면 undefined */
    loopBars?: BarRange | undefined;
    check: (scope: TransposeScope, bars: readonly BarRange[] | undefined) => KeyFitCheck;
    onapply: (scope: TransposeScope, bars: readonly BarRange[] | undefined) => void;
    onclose: () => void;
  }

  let { scopes, initialScope, loopBars, check, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let scope = $state<TransposeScope>(initialScope);
  // 고른 음이 없으면 반복 구간 마디부터 권한다
  // svelte-ignore state_referenced_locally
  let barMode = $state<"all" | "loop" | "typed">(loopBars && initialScope !== "selection" ? "loop" : "all");
  let barText = $state("");
  const typedBars = $derived(parseBarList(barText));
  const bars = $derived<readonly BarRange[] | undefined>(
    scope === "selection" || barMode === "all" ? undefined : barMode === "loop" ? (loopBars ? [loopBars] : []) : (typedBars ?? []),
  );
  const barSpan = (b: BarRange) => (b[0] === b[1] ? `${b[0]}` : `${b[0]}-${b[1]}`);
  const result = $derived(check(scope, bars));

  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (result.changed === 0) return;
    onapply(scope, bars);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.keyFit")}</h2>
  <div class="row">
    {#each scopes as s (s.id)}
      <label><input type="radio" name="scope" value={s.id} bind:group={scope} /> {s.label}</label>
    {/each}
  </div>
  {#if scope !== "selection"}
    <div class="row">
      <span>{t("ui.volumeBars")}</span>
      <label><input type="radio" name="bars" value="all" bind:group={barMode} /> {t("ui.volumeBarsAll")}</label>
      <label title={loopBars ? undefined : t("ui.volumeBarsNoLoop")}>
        <input type="radio" name="bars" value="loop" bind:group={barMode} disabled={!loopBars} />
        {loopBars ? t("ui.volumeBarsLoop", { bars: barSpan(loopBars) }) : t("ui.volumeBarsLoopNone")}
      </label>
      <label><input type="radio" name="bars" value="typed" bind:group={barMode} /> {t("ui.volumeBarsTyped")}</label>
      {#if barMode === "typed"}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="bars" type="text" inputmode="text" autofocus placeholder={t("ui.volumeBarsPlaceholder")} bind:value={barText} aria-label={t("ui.volumeBarsTyped")} />
      {/if}
    </div>
    {#if barMode === "typed" && barText.trim() !== "" && !typedBars}
      <p class="warn">{t("ui.volumeBarsInvalid")}</p>
    {:else if barMode !== "all"}
      <p class="muted small">{t("ui.keyFitBarsHelp")}</p>
    {/if}
  {/if}
  <p class="muted small">{t("ui.keyFitHelp")}</p>
  <p>{result.changed > 0 ? t("ui.keyFitCount", { changed: result.changed, count: result.count }) : t("ui.keyFitNone")}</p>
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={result.changed === 0} onclick={apply}>{t("ui.keyFitApply")}</button>
  </div>
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
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-top: 6px;
  }
  .bars {
    width: 10em;
  }
  .small {
    font-size: 0.85rem;
  }
  .muted {
    margin: 6px 0 0;
  }
  .warn {
    color: var(--warn, #c48a00);
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
