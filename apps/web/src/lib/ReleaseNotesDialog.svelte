<script module lang="ts">
  import type { ReleaseNotes as Notes } from "./releaseNotes";
  /** GitHub에서 읽은 본문. 같은 판을 다시 열 때 또 묻지 않는다 (요청 한도). 못 읽었으면 다음에 다시 묻는다 */
  const cache = new Map<string, Notes>();
</script>

<script lang="ts">
  import { t } from "./i18n.svelte";
  import Icon from "./Icon.svelte";
  import { CHANGELOG_URL, REPO } from "./links";
  import { waitingChangelog } from "./pwa.svelte";
  import { fetchRelease, renderNotes, type ReleaseNotes } from "./releaseNotes";

  /**
   * 한 판의 바뀐 내용: 받아 둔 새 판(새 판 안내) 또는 지금 판(? 메뉴 → 이번 업데이트 내역).
   * 공개 사이트는 GitHub Releases의 그 판 본문을 먼저 읽고, 못 읽으면 그 판의 CHANGELOG 절을 보여 준다.
   * 전체 변경 내역은 아래 링크로
   */
  interface Props {
    /** 판 번호. 못 읽었으면 "" (그때는 CHANGELOG 절만) */
    version: string;
    /** 지금 판이면 true: CHANGELOG 절을 앱에 든 것에서 꺼낸다. 아니면 받아 둔 새 서비스 워커에게 묻는다 */
    current?: boolean;
    onclose: () => void;
  }

  let { version, current = false, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  let notes = $state<ReleaseNotes | null | undefined>(undefined);

  $effect(() => {
    dialog.showModal();
    const abort = new AbortController();
    void load(version, abort.signal).then((n) => {
      if (!abort.signal.aborted) notes = n;
    });
    return () => abort.abort();
  });

  async function load(v: string, signal: AbortSignal): Promise<ReleaseNotes | null> {
    const known = cache.get(v);
    if (known) return known;
    // 테스트 사이트·개발 서버는 공개 저장소의 판이 아니라 Releases를 읽지 않는다
    const release = v && __MMLCE_BUILD__.published ? await fetchRelease(REPO, v, signal) : null;
    const fallback = current ? __MMLCE_NOTES__ : await waitingChangelog();
    const result = release ?? (fallback ? { text: fallback } : null);
    if (release) cache.set(v, release);
    return result;
  }

  const html = $derived(notes ? renderNotes(notes.text) : "");
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="notes-title">
  <div class="head">
    <h2 id="notes-title">{version ? t("ui.releaseNotesTitle", { version }) : t("ui.changelog")}</h2>
    <button class="icon" aria-label={t("ui.close")} title={t("ui.close")} onclick={() => dialog.close()}><Icon name="x" /></button>
  </div>
  <div class="body">
    {#if notes === undefined}
      <p class="muted">{t("ui.releaseNotesLoading")}</p>
    {:else if notes === null}
      <p class="muted">{t("ui.releaseNotesNone")}</p>
    {:else}
      <!-- renderNotes가 HTML을 모두 이스케이프하고 https 링크만 건다 -->
      {@html html}
    {/if}
  </div>
  <p class="links">
    {#if notes?.url}<a href={notes.url} target="_blank" rel="noopener">{t("ui.releaseNotesOnGitHub")}</a>{/if}
    <a href={CHANGELOG_URL} target="_blank" rel="noopener">{t("ui.changelogAll")}</a>
  </p>
</dialog>

<style>
  dialog {
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    display: flex;
    flex-direction: column;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 20px 16px;
  }
  dialog:not([open]) {
    display: none;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 1.05rem;
  }
  .body {
    overflow: auto;
    font-size: 13px;
    line-height: 1.55;
    word-break: keep-all;
    overflow-wrap: anywhere;
    margin-top: 8px;
  }
  .body :global(h3),
  .body :global(h4),
  .body :global(h5) {
    font-size: 13px;
    margin: 12px 0 4px;
  }
  .body :global(ul) {
    margin: 4px 0;
    padding-left: 20px;
  }
  .body :global(p) {
    margin: 6px 0;
  }
  .body :global(code) {
    font-family: "D2Coding", monospace;
    font-size: 12px;
  }
  .body :global(a),
  .links a {
    color: var(--accent);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px 12px;
    margin: 12px 0 0;
    font-size: 12px;
  }
</style>
