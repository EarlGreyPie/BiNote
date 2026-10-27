<script lang="ts">
  import { t } from "./i18n.svelte";
  import TuningStrings from "./TuningStrings.svelte";
  import { validStrings } from "./tunings";

  interface Props {
    /** 처음 보일 줄 높이 (지금 튜닝) */
    initial: readonly number[];
    onapply: (strings: readonly number[]) => void;
    onclose: () => void;
  }

  let { initial, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let strings = $state<readonly number[]>([...initial]);

  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (!validStrings(strings)) return;
    onapply(strings);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="custom-tuning-title">
  <h2 id="custom-tuning-title">{t("ui.tuningCustomTitle")}</h2>
  <p class="muted">{t("ui.tuningCustomHelp")}</p>
  <TuningStrings bind:strings />
  <p class="muted">{t("ui.tuningCustomViewHelp")}</p>
  <footer>
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button onclick={apply}>{t("ui.apply")}</button>
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
  footer {
    display: flex;
    align-items: center;
    gap: 8px 12px;
    margin: 8px 0;
  }
  .spacer {
    flex: 1;
  }
  .muted {
    color: var(--muted);
    margin: 4px 0;
  }
</style>
