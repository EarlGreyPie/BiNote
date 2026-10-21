<script lang="ts">
  import { t } from "./i18n.svelte";
  import type { PreviewRow } from "./output";

  /**
   * 글자 수 줄이기를 하기 전에 결과를 보여 준다: 트랙별 글자 수 전후, 그래도 한도를 넘는 트랙.
   * 소리는 바꾸지 않으므로 미리 듣기는 두지 않는다 (화음 분산·병합은 SpreadDialog·MergeDialog)
   */
  interface Props {
    title: string;
    /** 무엇이 바뀌는지 한두 문장 */
    summary: string;
    rows: readonly PreviewRow[];
    limit: number;
    /** 할 수 없으면(바뀌는 게 없거나 음이 사라질 때) 적용을 막는다 */
    blocked: boolean;
    /** 트랙 이름 앞에 붙일 악보 이름 */
    where: (trackId: string) => string;
    onapply: () => void;
    onclose: () => void;
  }

  let { title, summary, rows, limit, blocked, where, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });

  const total = $derived(rows.reduce((sum, r) => ({ before: sum.before + r.before, after: sum.after + r.after }), { before: 0, after: 0 }));
  const stillOver = $derived(rows.filter((r) => r.after > limit).length);

  function apply() {
    if (blocked) return;
    onapply();
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{title}</h2>
  <p>{summary}</p>
  {#if rows.length > 0}
    <table>
      <thead>
        <tr><th>{t("ui.previewTrack")}</th><th>{t("ui.previewBefore")}</th><th>{t("ui.previewAfter")}</th></tr>
      </thead>
      <tbody>
        {#each rows as r (r.trackId)}
          <tr>
            <td><span class="muted">{where(r.trackId)}</span> {r.name}</td>
            <td class="num" class:full={r.before > limit}>{r.before}</td>
            <td class="num" class:full={r.after > limit}>{r.after} <span class="muted">({r.after - r.before >= 0 ? "+" : ""}{r.after - r.before})</span></td>
          </tr>
        {/each}
      </tbody>
      {#if rows.length > 1}
        <tfoot>
          <tr><td>{t("ui.previewTotal")}</td><td class="num">{total.before}</td><td class="num">{total.after}</td></tr>
        </tfoot>
      {/if}
    </table>
  {/if}
  {#if stillOver > 0}<p class="warn">{t("ui.previewStillOver", { count: stillOver, limit })}</p>{/if}
  <div class="actions">
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={blocked} onclick={apply}>{t("ui.apply")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
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
    margin: 0 0 6px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: left;
    padding: 3px 6px;
    border-bottom: 1px solid var(--line);
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
  th:not(:first-child) {
    text-align: right;
  }
  tfoot td {
    font-weight: 600;
    border-bottom: none;
  }
  .full,
  .warn {
    color: var(--danger);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
