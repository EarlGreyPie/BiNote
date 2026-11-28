<script lang="ts">
  import { toFloat, type Rat, type TickSnapReport } from "@mmlce/core";
  import { t } from "./i18n.svelte";

  /**
   * 틱 칸 게임(PC)으로 바꾸기 전 확인 창. 옮길 음·템포가 있을 때만 연다 (없으면 묻지 않고 바꾼다).
   * 되돌릴 수 없는 음(모바일로 돌려 잇단음을 되살려도 처음으로 돌아오지 않는 음)이 있으면 다른 이름으로 저장을 권한다
   */
  interface Props {
    game: string;
    snap: TickSnapReport;
    /** 되돌릴 수 없는 음 수 (lostOnReturn) */
    lost: number;
    /** 가장 느린 템포 (가장 큰 이동을 ms로 어림할 때) */
    bpm: number;
    onapply: () => void;
    onclose: () => void;
  }
  let { game, snap, lost, bpm, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });
  const ms = (r: Rat) => Math.round((toFloat(r) * 240000) / bpm);
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.profileSnapTitle")} · {game}</h2>
  <p>{t("ui.profileSnapSummary", { moved: snap.moved, ms: ms(snap.maxShift), tempo: snap.tempoMoved })}</p>
  {#if snap.short > 0}<p class="warn">{t("ui.profileSnapShort", { count: snap.short })}</p>{/if}
  {#if lost > 0}
    <p class="warn">{t("ui.profileSnapLost", { count: lost })}</p>
    <p class="muted help">{t("ui.profileSnapSaveAs")}</p>
  {/if}
  <footer>
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button
      class="primary"
      onclick={() => {
        onapply();
        dialog.close();
      }}>{t("ui.profileSnapApply")}</button
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
