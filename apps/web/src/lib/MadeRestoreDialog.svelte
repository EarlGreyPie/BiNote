<script lang="ts">
  import { madeTracks, restoreMade, type MadeRestore, type Song } from "@mmlce/core";
  import { t } from "./i18n.svelte";

  /**
   * 아르페지오 원래대로 되돌리기 창: 기록이 걸친 트랙을 체크로 골라 고른 트랙만 되돌린다 (아르페지오 창의 화음 트랙 고르기처럼).
   * 뺀 트랙은 그대로 둔다. 고르기를 바꿀 때마다 계획을 다시 세워 손댄 음 수와 막히는 까닭을 보여 준다
   */
  interface Props {
    song: Song;
    /** 되돌릴 기록 id */
    records: readonly string[];
    locked: ReadonlySet<string>;
    /** 곡의 트랙 색 (트랙 바와 같은 색) */
    colors: ReadonlyMap<string, string>;
    onapply: (plan: Extract<MadeRestore, { ok: true }>) => void;
    onclose: () => void;
  }

  let { song, records, locked, colors, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });

  const tracks = $derived(madeTracks(song, records).flatMap((id) => song.tracks.filter((tr) => tr.id === id)));
  /** 뺀 트랙 (기본은 모두 되돌리기). 잠근 트랙은 처음부터 뺀다 */
  // svelte-ignore state_referenced_locally
  let excluded = $state<ReadonlySet<string>>(new Set(madeTracks(song, records).filter((id) => locked.has(id))));
  function toggle(id: string, on: boolean) {
    const next = new Set(excluded);
    if (on) next.delete(id);
    else next.add(id);
    excluded = next;
  }
  const chosen = $derived(new Set(tracks.map((tr) => tr.id).filter((id) => !excluded.has(id))));
  const plan = $derived(chosen.size > 0 ? restoreMade(song, records, chosen) : undefined);
  const lockedHit = $derived(plan?.ok === true && (plan.changes.some((c) => locked.has(c.trackId)) || plan.removeTracks.some((id) => locked.has(id))));
  const BLOCKED = { occupied: "ui.madeBlockedOccupied", nested: "ui.madeBlockedNested", track: "ui.madeBlockedTrack", range: "ui.madeBlockedRange" } as const;
  const ok = $derived(plan?.ok === true && !lockedHit);

  function apply() {
    if (!plan?.ok || lockedHit) return;
    onapply(plan);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.madeRestore")}</h2>
  <p class="muted help">{t("ui.madeRestoreTracksHelp")}</p>
  <div class="row" role="group" aria-label={t("ui.madeRestoreTracks")}>
    <span>{t("ui.madeRestoreTracks")}</span>
    {#each tracks as tr (tr.id)}
      <label>
        <input type="checkbox" checked={!excluded.has(tr.id)} disabled={locked.has(tr.id)} onchange={(e) => toggle(tr.id, e.currentTarget.checked)} />
        <span class="dot" style:background={colors.get(tr.id) ?? tr.color}></span>{tr.name}
      </label>
    {/each}
  </div>
  {#if !plan}
    <p class="muted">{t("ui.madeRestoreNoTrack")}</p>
  {:else if !plan.ok}
    <p class="warn">{t(BLOCKED[plan.reason])}</p>
  {:else if lockedHit}
    <p class="warn">{t("ui.madeLocked")}</p>
  {:else if plan.edited > 0}
    <p class="warn">{t("ui.madeEditedNote", { n: plan.edited })}</p>
  {/if}
  <footer>
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!ok} onclick={apply}>{t("ui.madeRestoreApply")}</button>
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
  .row,
  footer {
    display: flex;
    align-items: center;
    gap: 6px 12px;
    flex-wrap: wrap;
    margin: 8px 0;
  }
  .help {
    font-size: 0.85rem;
    margin: 0;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 4px;
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
