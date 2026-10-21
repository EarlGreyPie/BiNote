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
  import { t } from "./i18n.svelte";
  import { TUNINGS, type ScoreTuning, type TuningName } from "./tunings";

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
  let tuning = $state<TuningName>(current.tuning);
  // svelte-ignore state_referenced_locally
  let capo = $state(current.capo);
  const result = $derived(check({ tuning, capo }));

  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (result.moved === 0) return;
    onapply({ tuning, capo });
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.retune")}</h2>
  <p class="muted">{t("ui.retuneHelp")}</p>
  <div class="row">
    <label>
      {t("ui.tuning")}
      <select bind:value={tuning}>
        {#each Object.entries(TUNINGS) as [name, info] (name)}<option value={name}>{t(info.key)}</option>{/each}
      </select>
    </label>
    <label>
      {t("ui.capo")}
      <select bind:value={capo}>
        {#each CAPOS as c (c)}<option value={c}>{c}</option>{/each}
      </select>
    </label>
  </div>
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
    <button disabled={result.moved === 0} onclick={apply}>{t("ui.apply")}</button>
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
