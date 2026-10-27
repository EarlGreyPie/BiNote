<script lang="ts" module>
  /** 바꿔 보면 어떻게 되는지 (창에 미리 보여 준다) */
  export interface RetuneCheck {
    /** 높이가 바뀌는 음 수 */
    readonly moved: number;
    /** 자리가 없어 그대로 두는 음 수 */
    readonly kept: number;
    /** 악기 소리 범위 밖으로 나가 게임에서 옥타브째 접혀 날 음 수 */
    readonly folded: number;
  }
</script>

<script lang="ts">
  import { samePlayerTab } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import TuningStrings from "./TuningStrings.svelte";
  import { CUSTOM_TUNING, TUNINGS, tuningStrings, type ScoreTuning, type TuningChoice } from "./tunings";

  interface Props {
    /** 지금 악보 튜닝 */
    current: ScoreTuning;
    check: (to: ScoreTuning) => RetuneCheck;
    onapply: (to: ScoreTuning) => void;
    onclose: () => void;
  }

  let { current, check, onapply, onclose }: Props = $props();

  const CAPOS = Array.from({ length: 25 }, (_, c) => c);
  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let tuning = $state<TuningChoice>(current.tuning);
  // svelte-ignore state_referenced_locally
  let capo = $state(current.capo);
  /** 직접 입력 줄 높이. 직접 입력으로 바꾸면 그 앞에 고른 튜닝에서 시작한다 (반음 내린 내슈빌 등) */
  // svelte-ignore state_referenced_locally
  let strings = $state<readonly number[]>([...tuningStrings(current)]);
  const target = $derived<ScoreTuning>(tuning === CUSTOM_TUNING ? { tuning, capo, strings } : { tuning, capo });
  const result = $derived(check(target));
  /** 높이가 바뀌는 음이 없어도(반음 옮김과 카포가 서로 상쇄되는 등) 튜닝이 다르면 적용할 수 있다 */
  const changed = $derived(result.moved > 0 || !samePlayerTab(target, current));

  function choose(next: TuningChoice) {
    if (next === CUSTOM_TUNING && tuning !== CUSTOM_TUNING) strings = [...tuningStrings({ tuning, capo })];
    tuning = next;
  }

  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (!changed) return;
    onapply(target);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="retune-title">
  <h2 id="retune-title">{t("ui.retune")}</h2>
  <p class="muted">{t("ui.retuneHelp")}</p>
  <div class="row">
    <label>
      {t("ui.tuning")}
      <select value={tuning} onchange={(e) => choose(e.currentTarget.value as TuningChoice)}>
        {#each Object.entries(TUNINGS) as [name, info] (name)}<option value={name}>{t(info.key)}</option>{/each}
        <option value={CUSTOM_TUNING}>{t("ui.tuningCustom")}</option>
      </select>
    </label>
    <label>
      {t("ui.capo")}
      <select bind:value={capo}>
        {#each CAPOS as c (c)}<option value={c}>{c}</option>{/each}
      </select>
    </label>
  </div>
  {#if tuning === CUSTOM_TUNING}
    <p class="muted">{t("ui.tuningCustomHelp")}</p>
    <TuningStrings bind:strings />
  {/if}
  <p class="muted">{result.moved > 0 ? t("ui.retuneCount", { count: result.moved }) : t("ui.retuneNothing")}</p>
  {#if result.kept > 0}
    <p class="warn">{t("ui.retuneKept", { count: result.kept })}</p>
  {/if}
  {#if result.folded > 0}
    <p class="warn">{t("ui.transposeFolded", { count: result.folded })}</p>
  {/if}
  <footer>
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button disabled={!changed} onclick={apply}>{t("ui.apply")}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(460px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
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
  select {
    max-width: 100%;
  }
  .spacer {
    flex: 1;
  }
  .muted {
    color: var(--muted);
    margin: 4px 0;
  }
  .warn {
    color: var(--danger);
    margin: 4px 0;
  }
</style>
