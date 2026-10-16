<script lang="ts">
  import { PROJECT_EXTENSION } from "@mmlce/fileio";
  import { i18n, t } from "./i18n.svelte";
  import { KEEP_WORKS, type WorkSummary } from "./workStore";

  /** 자동 보존해 둔 지난 작업 목록. 곡이 없는 첫 화면과 "지난 작업 되살리기" 창에서 쓴다 */
  interface Props {
    works: readonly WorkSummary[];
    onrestore: (id: string) => void;
    onforget: (id: string) => void;
  }

  let { works, onrestore, onforget }: Props = $props();

  function when(ms: number): string {
    return new Date(ms).toLocaleString(i18n.locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
</script>

<section class="recover">
  <h2>{t("ui.recoverTitle")}</h2>
  {#if works.length === 0}
    <p class="muted">{t("ui.recoverEmpty")}</p>
  {:else}
    <ul>
      {#each works as w (w.id)}
        <li>
          <div class="info">
            <strong>{w.title || w.fileName || t("ui.recoverUntitled")}</strong>
            {#if w.title && w.fileName}<span class="muted">{w.fileName}</span>{/if}
            <span class="muted small">{t("ui.recoverMeta", { tracks: w.trackCount, notes: w.noteCount, time: when(w.savedAt) })}</span>
          </div>
          <button class="primary small" onclick={() => onrestore(w.id)}>{t("ui.recoverRestore")}</button>
          <button class="small" onclick={() => onforget(w.id)}>{t("ui.recoverForget")}</button>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="muted small">{t("ui.recoverHelp", { count: KEEP_WORKS, ext: PROJECT_EXTENSION })}</p>
</section>

<style>
  .recover {
    width: min(520px, 100%);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--panel);
  }
  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .info strong,
  .info span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .small {
    font-size: 0.85em;
  }
  p {
    margin: 8px 0 0;
  }
</style>
