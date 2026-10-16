<script lang="ts">
  import { INSTRUMENTS, type Song } from "@mmlce/core";
  import { readMmlAt } from "@mmlce/fileio";
  import { diag, instrumentName, t } from "./i18n.svelte";

  interface Props {
    /** 처음 채워 둘 글 (붙여넣기로 열었을 때) */
    initial?: string;
    /** 지금 열린 곡이 있으면 "지금 곡에 더하기"를 보인다 */
    canAppend: boolean;
    limit: number;
    maxChords: number;
    onopen: (song: Song) => void;
    onappend: (song: Song) => void;
    onclose: () => void;
  }

  let { initial = "", canAppend, limit, maxChords, onopen, onappend, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let text = $state(initial);
  let instrumentId = $state("piano");
  /** 번호가 알려진 가락 악기만 고를 수 있게 한다 (모바일 전용 악기는 팩마다 번호가 달라 뺀다) */
  const CHOICES = INSTRUMENTS.filter((i) => i.program !== undefined && !i.percussion);

  $effect(() => {
    dialog.showModal();
  });

  const result = $derived.by(() => {
    const info = CHOICES.find((i) => i.id === instrumentId) ?? CHOICES[0]!;
    return readMmlAt(text, { instrument: { canonical: info.id, program: info.program! }, playerName: t("ui.pastePlayer") });
  });
  const ok = $derived(result.song.tracks.length > 0);
  const errors = $derived(result.diagnostics.filter((d) => d.level === "error" && d.code !== "mmlat-not-found"));

  function finish(action: (song: Song) => void) {
    action(result.song);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <header>
    <h2>{t("ui.paste")}</h2>
    <span class="spacer"></span>
    <button class="small" onclick={() => dialog.close()}>{t("ui.close")}</button>
  </header>
  <p class="muted">{t("ui.pasteHelp")}</p>
  <!-- svelte-ignore a11y_autofocus -->
  <textarea bind:value={text} rows="8" spellcheck="false" placeholder="MML@t120l8cdefgab>c,o3l2ceg;" autofocus></textarea>
  <label>
    {t("ui.pasteInstrument")}
    <select bind:value={instrumentId}>
      {#each CHOICES as info (info.id)}
        <option value={info.id}>{instrumentName(info.id)}</option>
      {/each}
    </select>
  </label>
  {#if text.trim() !== "" && !ok}
    <p class="warn">{diag({ code: "mmlat-not-found" })}</p>
  {/if}
  {#if ok}
    <ul>
      {#each result.song.players as player (player.id)}
        {@const mine = result.song.tracks.filter((tr) => tr.playerId === player.id)}
        <li>
          <strong>{player.name}</strong>
          <span class={mine.length > maxChords ? "warn" : "muted"}>{t("ui.pasteTracks", { count: mine.length, max: maxChords })}</span>
          {#each mine as track (track.id)}
            {@const length = track.mml?.text.length ?? 0}
            <span class={length > limit ? "warn" : "muted"}>{t("ui.chars", { count: length })}</span>
          {/each}
        </li>
      {/each}
    </ul>
    {#if errors.length > 0}
      <ul>
        {#each errors as d, i (i)}
          <li class="warn"><span class="muted">{d.where}</span> {diag(d)}</li>
        {/each}
      </ul>
    {/if}
  {/if}
  <footer>
    {#if canAppend}
      <button onclick={() => finish(onappend)} disabled={!ok}>{t("ui.pasteAppend")}</button>
    {/if}
    <button onclick={() => finish(onopen)} disabled={!ok}>{t("ui.pasteOpen")}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(640px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  header,
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  footer {
    justify-content: flex-end;
    margin-top: 8px;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  .spacer {
    flex: 1;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: "D2Coding", ui-monospace, monospace;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 6px;
    margin-bottom: 6px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
  }
  li {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: baseline;
  }
  .warn {
    color: var(--danger);
  }
</style>
