<script lang="ts">
  import { barBeatAt, type Song } from "@mmlce/core";
  import type { OffgridFix } from "@mmlce/mml";
  import { t } from "./i18n.svelte";

  /**
   * 어긋난 길이 찾기 창 (곡 메뉴, 3MLE·마비꼬·MML@ 글을 열 때 찾은 곳이 있으면 저절로 연다).
   * 자리마다 원래 → 고칠 값을 보이고 이동·원래 듣기·고친 뒤 듣기·고치기를 단다. 저절로 고치는 것은 없다.
   * 곡을 볼 수 있게 화면을 막지 않는 창으로 띄운다
   */
  interface Props {
    song: Song;
    fixes: readonly OffgridFix[];
    ongo: (fix: OffgridFix) => void;
    onlisten: (fix: OffgridFix, fixed: boolean) => void;
    onfix: (fixes: readonly OffgridFix[]) => void;
    onclose: () => void;
  }

  let { song, fixes, ongo, onlisten, onfix, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.show();
  });

  const rows = $derived(
    fixes.map((fix, k) => {
      const { bar, beat } = barBeatAt(song.timeSig, fix.at);
      return {
        key: `${fix.trackId}:${fix.edits[0]?.span[0] ?? k}`,
        fix,
        track: song.tracks.find((tr) => tr.id === fix.trackId)?.name ?? "",
        place: t("ui.checkPlace", { bar, beat: Number.isInteger(beat) ? beat : beat.toFixed(2) }),
        change: fix.edits.map((e) => `${e.from} → ${e.to}`).join(", "),
      };
    }),
  );

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      dialog.close();
    }
  }
</script>

<dialog bind:this={dialog} {onclose} {onkeydown}>
  <h2>{t("ui.offgrid")}</h2>
  <p class="muted">{t("ui.offgridIntro")}</p>
  {#if rows.length === 0}
    <p>{t("ui.offgridNone")}</p>
  {:else}
    <p><strong>{t("ui.offgridFound", { n: rows.length })}</strong></p>
    <ul>
      {#each rows as row (row.key)}
        <li>
          <span class="where"><span class="muted">{row.track}</span> {row.place}</span>
          <code>{row.change}</code>
          {#if row.fix.kind === "tuplet"}<span class="muted">{t("ui.offgridTuplet")}</span>{/if}
          <span class="buttons">
            <button class="small" onclick={() => ongo(row.fix)}>{t("ui.offgridGo")}</button>
            <button class="small" onclick={() => onlisten(row.fix, false)}>{t("ui.offgridListenBefore")}</button>
            <button class="small" onclick={() => onlisten(row.fix, true)}>{t("ui.offgridListenAfter")}</button>
            <button class="small primary" onclick={() => onfix([row.fix])}>{t("ui.offgridFix")}</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.close")}</button>
    <button class="primary" disabled={rows.length === 0} onclick={() => onfix(fixes)}>{t("ui.offgridFixAll", { n: rows.length })}</button>
  </div>
</dialog>

<style>
  dialog {
    position: fixed;
    inset: auto 16px 16px auto;
    margin: 0;
    z-index: 50;
    width: min(520px, calc(100vw - 32px));
    max-height: min(70vh, 640px);
    overflow: auto;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.3);
  }
  h2 {
    margin: 0 0 6px;
    font-size: 1.05rem;
  }
  p {
    margin: 4px 0;
  }
  ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    padding: 6px 0;
    border-top: 1px solid var(--line);
  }
  .where {
    min-width: 9em;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-left: auto;
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
