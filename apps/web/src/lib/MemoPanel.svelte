<script lang="ts">
  import { toFloat, type Rat, type Song } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { memoListOf, memoWhere } from "./memos";
  import { loadStored, saveStored } from "./persist";

  /**
   * 작업 메모 목록 (실험실). 모달이 아니라 띄운 채로 편집한다 (왼쪽 아래).
   * 글 칸이 없다: 글을 적고 고치는 것은 가운데 모달 창(MemoEditDialog)에서 한다 (캔버스 옆 글 칸은 아이패드 펜슬 Scribble을 부른다).
   * 곡을 바꾸는 것(끝냄, 마커↔메모)은 모두 앱의 명령으로 넘긴다 (실행 취소 한 칸씩)
   */
  interface Props {
    song: Song;
    /** 재생선·커서 자리 (온음표 단위). 그 자리를 지난 첫 메모를 표시한다 */
    now: number | undefined;
    onseek: (at: Rat) => void;
    ondone: (id: string, done: boolean) => void;
    onedit: (id: string) => void;
    onadd: () => void;
    /** 구조 마커를 메모로 */
    onmemo: (id: string) => void;
    onclose: () => void;
  }

  let { song, now, onseek, ondone, onedit, onadd, onmemo, onclose }: Props = $props();

  const ONLY_OPEN_KEY = "mmlce.memoPanel.onlyOpen";
  let onlyOpen = $state(loadStored(ONLY_OPEN_KEY, (raw) => raw === "1"));
  function setOnlyOpen(on: boolean) {
    onlyOpen = on;
    saveStored(ONLY_OPEN_KEY, on ? "1" : "0");
  }

  let panel: HTMLDialogElement;
  $effect(() => {
    panel.show();
  });

  const list = $derived(memoListOf(song, onlyOpen));
  /** 지금 자리(커서·재생선)가 든 메모 (범위 메모는 그 안, 한 자리 메모는 바로 그 자리) */
  const here = (m: (typeof list.memos)[number]) =>
    now !== undefined && (m.end ? toFloat(m.at) <= now + 1e-9 && now < toFloat(m.end) - 1e-9 : Math.abs(toFloat(m.at) - now) < 1e-9);
</script>

<dialog class="panel" bind:this={panel} {onclose} aria-label={t("ui.memoPanel")}>
  <header>
    <strong>{t("ui.memoPanel")}</strong>
    <span class="muted small">{t("ui.memoCount", { open: list.open, total: list.total })}</span>
    <span class="grow"></span>
    <button class="small" onclick={onadd} title={t("ui.memoAddHelp")}>{t("ui.memoAdd")}</button>
    <button class="small" onclick={() => panel.close()} aria-label={t("ui.close")}>✕</button>
  </header>
  <label class="row small"><input type="checkbox" checked={onlyOpen} onchange={(e) => setOnlyOpen(e.currentTarget.checked)} />{t("ui.memoOnlyOpen")}</label>
  {#if list.memos.length === 0}
    <p class="muted small">{list.total === 0 ? t("ui.memoEmpty") : t("ui.memoAllDone")}</p>
  {:else}
    <ul>
      {#each list.memos as m (m.id)}
        <li class:done={m.done} class:here={here(m)}>
          <input type="checkbox" checked={!!m.done} onchange={(e) => ondone(m.id, e.currentTarget.checked)} aria-label={t("ui.memoDone")} />
          <button class="go" onclick={() => onseek(m.at)} title={t("ui.memoGo")}>
            <span class="where">{memoWhere(song.timeSig, m)}</span>
            <span class="text">{m.label}</span>
          </button>
          <button class="small" onclick={() => onedit(m.id)} title={t("ui.memoEdit")} aria-label={t("ui.memoEdit")}>✎</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if list.markers.length > 0}
    <details class="small">
      <summary>{t("ui.memoFromMarker")}</summary>
      <p class="muted">{t("ui.memoFromMarkerHelp")}</p>
      <ul>
        {#each list.markers as m (m.id)}
          <li>
            <button class="go" onclick={() => onseek(m.at)} title={t("ui.memoGo")}>
              <span class="where">{memoWhere(song.timeSig, m)}</span>
              <span class="text">{m.label}</span>
            </button>
            <button class="small" onclick={() => onmemo(m.id)}>{t("ui.markerToMemo")}</button>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</dialog>

<style>
  .panel {
    position: fixed;
    inset: auto auto 40px 16px;
    margin: 0;
    width: min(360px, calc(100vw - 32px));
    max-height: min(60vh, calc(100vh - 80px));
    overflow: auto;
    z-index: 40;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0 10px 8px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.3);
  }
  header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 0 6px;
    background: var(--panel);
  }
  .grow {
    flex: 1;
  }
  .small {
    font-size: 0.85rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    border-bottom: 1px solid var(--line);
  }
  li.here {
    background: color-mix(in srgb, var(--ev-memo) 14%, var(--panel));
  }
  li.done .text,
  li.done .where {
    opacity: 0.5;
    text-decoration: line-through;
  }
  .go {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 8px;
    text-align: left;
    background: none;
    border: none;
    color: inherit;
    padding: 4px 2px;
    cursor: pointer;
  }
  .where {
    flex: none;
    color: var(--ev-memo);
    font-variant-numeric: tabular-nums;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  details {
    margin-top: 6px;
  }
  details .where {
    color: var(--ev-marker);
  }
</style>
