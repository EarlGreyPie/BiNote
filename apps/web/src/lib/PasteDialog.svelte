<script lang="ts">
  import { INSTRUMENTS, type Song } from "@mmlce/core";
  import { readMmlAt } from "@mmlce/fileio";
  import { diag, instrumentName, t } from "./i18n.svelte";
  import { pasteInstrumentNames, replaceSources } from "./pasteOptions";

  interface Props {
    /** 처음 채워 둘 글 (붙여넣기로 열었을 때) */
    initial?: string;
    /** 지금 열린 곡이 있으면 "지금 곡에 더하기"를 보인다 */
    canAppend: boolean;
    limit: number;
    maxChords: number;
    /** 권으로 이을 때 권 사이 틈(ms, 프로필 값. 모르면 null) */
    gapMs: number | null;
    /** 덮어쓸 수 있는 지금 트랙 이름. 없으면(곡이 없거나 잠긴 트랙) "지금 트랙 덮어쓰기"를 보이지 않는다 */
    replaceTarget?: string | undefined;
    onopen: (song: Song) => void;
    onappend: (song: Song) => void;
    /** 지금 트랙의 MML 원문을 이 글로 바꾼다 */
    onreplace?: ((text: string) => void) | undefined;
    onclose: () => void;
  }

  let { initial = "", canAppend, limit, maxChords, gapMs, replaceTarget, onopen, onappend, onreplace, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let text = $state(initial);
  let instrumentId = $state("piano");
  /** 악보 여러 개를 연주자로 나눌지, 권으로 이을지 */
  let mode = $state<"players" | "book">("players");
  /** 연주자마다 바꾼 악기 (머리줄에서 읽은 악기·기본 악기 대신). 글이나 나누는 방법을 바꾸면 비운다 */
  let picked = $state<Record<string, string>>({});
  /** 덮어쓸 때 쓸 글 (replaceSources 차례) */
  let source = $state(0);
  /** 번호가 알려진 가락 악기만 고를 수 있게 한다 (모바일 전용 악기는 팩마다 번호가 달라 뺀다) */
  const CHOICES = INSTRUMENTS.filter((i) => i.program !== undefined && !i.percussion);
  const NAMES = pasteInstrumentNames(CHOICES);
  const refOf = (id: string) => {
    const info = CHOICES.find((i) => i.id === id) ?? CHOICES[0]!;
    return { canonical: info.id, program: info.program! };
  };

  $effect(() => {
    dialog.showModal();
  });

  $effect(() => {
    void text;
    void mode;
    picked = {};
    source = 0;
  });

  const read = $derived(
    readMmlAt(text, { instrument: refOf(instrumentId), playerName: t("ui.pastePlayer"), mode, gapMs, instrumentNames: NAMES }),
  );
  const result = $derived({
    ...read,
    song: { ...read.song, players: read.song.players.map((p) => (picked[p.id] ? { ...p, instrument: refOf(picked[p.id]!) } : p)) },
  });
  const ok = $derived(result.song.tracks.length > 0);
  const errors = $derived(result.diagnostics.filter((d) => d.level === "error" && d.code !== "mmlat-not-found"));
  const sources = $derived(replaceSources(read.blocks));

  function finish(action: (song: Song) => void) {
    action(result.song);
    dialog.close();
  }

  function replace() {
    const chosen = sources[source];
    if (!chosen || !onreplace) return;
    onreplace(chosen.text);
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
  <div class="row">
    <label>
      {t("ui.pasteInstrument")}
      <select bind:value={instrumentId}>
        {#each CHOICES as info (info.id)}
          <option value={info.id}>{instrumentName(info.id)}</option>
        {/each}
      </select>
    </label>
    {#if read.blocks.length > 1}
      <span class="modes" title={t("ui.pasteModeHint")}>
        <label><input type="radio" name="paste-mode" value="players" bind:group={mode} /> {t("ui.pasteModePlayers")}</label>
        <label><input type="radio" name="paste-mode" value="book" bind:group={mode} /> {t("ui.pasteModeBook")}</label>
      </span>
    {/if}
  </div>
  {#if mode === "book" && read.blocks.length > 1}
    <p class="muted">{t("ui.pasteModeHint")}</p>
  {/if}
  {#if text.trim() !== "" && !ok}
    <p class="warn">{diag({ code: "mmlat-not-found" })}</p>
  {/if}
  {#if ok}
    <ul>
      {#each result.song.players as player (player.id)}
        {@const mine = result.song.tracks.filter((tr) => tr.playerId === player.id)}
        {@const books = result.playerBlocks[player.id] ?? []}
        <li>
          <strong>{player.name}</strong>
          <select
            aria-label={t("ui.pasteInstrument")}
            value={player.instrument.canonical}
            onchange={(e) => (picked = { ...picked, [player.id]: e.currentTarget.value })}
          >
            {#each CHOICES as info (info.id)}
              <option value={info.id}>{instrumentName(info.id)}</option>
            {/each}
          </select>
          <span class={mine.length > maxChords ? "warn" : "muted"}>{t("ui.pasteTracks", { count: mine.length, max: maxChords })}</span>
          {#if books.length > 1}
            <span class="muted">{t("ui.pasteVolumes", { count: books.length })}</span>
          {/if}
          <!-- 글자 수는 붙여넣을 글(권마다 따로)로 센다 -->
          {#each books as b, v (b)}
            {#if v > 0}<span class="muted">/</span>{/if}
            {#each read.blocks[b]!.parts as part, i (i)}
              <span class={part.length > limit ? "warn" : "muted"}>{t("ui.chars", { count: part.length })}</span>
            {/each}
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
    {#if replaceTarget !== undefined && onreplace && sources.length > 0}
      {#if sources.length > 1}
        <select aria-label={t("ui.pasteReplace")} bind:value={source}>
          {#each sources as src, k (k)}
            <option value={k}>{t("ui.pasteReplaceSource", { score: src.score, track: src.track })}</option>
          {/each}
        </select>
      {/if}
      <button onclick={replace} title={t("ui.pasteReplaceHint", { track: replaceTarget })}>{t("ui.pasteReplace")}</button>
      <span class="spacer"></span>
    {/if}
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
    flex-wrap: wrap;
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
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
  }
  .modes {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px 12px;
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
