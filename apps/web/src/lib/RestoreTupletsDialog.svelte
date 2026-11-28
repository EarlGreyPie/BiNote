<script lang="ts">
  import type { Song } from "@mmlce/core";
  import { restoreTuplets } from "@mmlce/mml";
  import { t } from "./i18n.svelte";

  /** 잇단음 되살리기 창 (곡 메뉴, 틱 칸 게임에서 바꿔 왔을 때 권함). 미리 세어 보이고 적용은 실행 취소 한 칸 */
  interface Props {
    song: Song;
    locked: ReadonlySet<string>;
    /** 게임을 바꾼 뒤 권하는 것이면 true (첫 줄에 묻는 글) */
    offer?: boolean;
    onapply: () => void;
    onclose: () => void;
  }
  let { song, locked, offer = false, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });
  const plan = $derived(restoreTuplets(song, locked));
  const fixes = $derived(plan.tracks.reduce((s, x) => s + x.fixes, 0));
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.menuRestoreTuplets").replace(/…$/, "")}</h2>
  {#if offer}<p>{t("ui.restoreTupletsOffer")}</p>{/if}
  <p class="muted help">{t("ui.restoreTupletsHelp")}</p>
  {#if plan.tracks.length === 0}
    <p class="muted">{t("ui.restoreTupletsNone")}</p>
  {:else}
    <p>{t("ui.restoreTupletsResult", { tracks: plan.tracks.length, fixes, moved: plan.moved })}</p>
  {/if}
  {#if plan.left > 0}<p class="warn">{t("ui.restoreTupletsLeft", { count: plan.left })}</p>{/if}
  <footer>
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button
      class="primary"
      disabled={plan.tracks.length === 0}
      onclick={() => {
        onapply();
        dialog.close();
      }}>{t("ui.apply")}</button
    >
  </footer>
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 32px));
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
    gap: 6px 12px;
    flex-wrap: wrap;
    margin: 8px 0 0;
  }
  .spacer {
    flex: 1;
  }
  .help {
    font-size: 0.85rem;
    margin: 0;
  }
</style>
