<script lang="ts">
  import type { Rat } from "@mmlce/core";
  import { instrumentName, t } from "./i18n.svelte";
  import type { OutputRow, TempoAdvice } from "./output";

  /**
   * 게임에 넣기 (출력 점검판, 파일·곡 메뉴). 창을 띄운 채 화음 분산·글자 수 줄이기를 하면 수가 바로 바뀐다. 악보마다 한 줄: 악기, 트랙 수, 트랙별 글자 수, 접힘·오류·경고 수, [복사].
   * 위에는 게임 범위 밖 템포와 글자 수 넘침을 고칠 방법을 모아 둔다
   */
  interface Props {
    rows: readonly OutputRow[];
    tempo: readonly TempoAdvice[];
    limit: number;
    tempoRange: { readonly min: number; readonly max: number };
    /** 트랙 이름을 누르면 그 트랙으로 */
    ontrack: (trackId: string) => void;
    /** 템포 자리로 커서 옮기기 */
    onseek: (at: Rat) => void;
    ondistribute: () => void;
    onsplit: () => void;
    onclose: () => void;
  }

  let { rows, tempo, limit, tempoRange, ontrack, onseek, ondistribute, onsplit, onclose }: Props = $props();
  let copied = $state("");

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });
  /** 창을 닫고 할 일 (트랙·자리로 가기, 나누기) */
  function closeThen(run: () => void) {
    dialog.close();
    run();
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = id;
    } catch {
      copied = "";
    }
  }

  const overCount = $derived(rows.filter((r) => r.over).length);
  const fixCount = $derived(rows.filter((r) => r.over || r.errors > 0).length);
</script>

<dialog class="output" bind:this={dialog} {onclose}>
  <header>
    <h2>{t("ui.outputTitle")}</h2>
    <span class="muted">
      {fixCount === 0 && tempo.length === 0 ? t("ui.outputSummaryOk", { count: rows.length }) : t("ui.outputSummaryFix", { count: rows.length, fix: fixCount })}
    </span>
    <span class="spacer"></span>
    <button class="small" onclick={() => dialog.close()}>{t("ui.close")}</button>
  </header>
  <p class="muted help">{t("ui.outputHelp")}</p>

  {#if tempo.length > 0 || overCount > 0}
    <ul class="advice">
      {#each tempo as a (`${a.at.n}/${a.at.d}`)}
        <li class="warn">
          {a.high
            ? t("ui.outputTempoHigh", { bpm: a.bpm, bar: a.bar, beat: a.beat, min: tempoRange.min, max: tempoRange.max, factor: a.factor, to: a.to, quarter: 4 * a.factor })
            : t("ui.outputTempoLow", { bpm: a.bpm, bar: a.bar, beat: a.beat, min: tempoRange.min, max: tempoRange.max, factor: a.factor, to: a.to })}
          <span class="acts"><button class="small" onclick={() => closeThen(() => onseek(a.at))}>{t("ui.outputTempoGo")}</button></span>
        </li>
      {/each}
      {#if overCount > 0}
        <li class="bad">
          {t("ui.outputOver", { limit, count: overCount })}
          <span class="acts">
            <button class="small" title={t("ui.distributeHelp")} onclick={ondistribute}>{t("ui.distribute")}…</button>
            <button class="small" onclick={() => closeThen(onsplit)}>{t("ui.split")}…</button>
          </span>
        </li>
      {/if}
    </ul>
  {/if}

  <ul class="rows">
    {#each rows as row (`${row.playerId}:${row.index}`)}
      {@const id = `${row.playerId}:${row.index}`}
      <li class="row">
        <div class="head">
          <strong>{t("ui.scoreN", { n: row.number })}</strong>
          <span>{instrumentName(row.instrument)}</span>
          <span class="muted">{t("ui.outputTracks", { count: row.tracks.length, max: row.maxChords })}</span>
          {#if row.silent > 0}<span class="muted" title={t("ui.pasteSilentHint")}>{t("ui.pasteSilent", { count: row.silent })}</span>{/if}
          {#if row.fold > 0}<span class="badge warn" title={t("ui.outputChecksHint")}>{t("ui.outputFold", { count: row.fold })}</span>{/if}
          {#if row.errors > 0}<span class="badge bad" title={t("ui.outputChecksHint")}>{t("ui.outputErrors", { count: row.errors })}</span>{/if}
          {#if row.warnings > 0}<span class="badge warn" title={t("ui.outputChecksHint")}>{t("ui.outputWarnings", { count: row.warnings })}</span>{/if}
          <span class="spacer"></span>
          <button class="small" onclick={() => copy(id, row.text)} title={t("ui.copyScoreHint", { count: row.tracks.length })}>
            {copied === id ? t("ui.copied") : row.over ? t("ui.outputCopyOver") : t("ui.copy")}
          </button>
        </div>
        <div class="tracks">
          {#each row.tracks as tr (tr.trackId)}
            <button class="track" class:full={tr.over} onclick={() => closeThen(() => ontrack(tr.trackId))} title={t("ui.outputTrackGo")}>
              <span class="name">{tr.name}</span>
              <span class="bar"><span style:width="{Math.min(100, (tr.count / limit) * 100)}%"></span></span>
              <span class="count">{tr.count}/{limit}</span>
            </button>
          {/each}
        </div>
        {#if row.silentOver.length > 0}<p class="muted note">{t("ui.outputSilentOver", { names: row.silentOver.join(", "), limit })}</p>{/if}
        {#if row.asIs.length > 0}<p class="muted note">{t("ui.outputAsIs")}</p>{/if}
        {#if row.moved > 0}<p class="muted note">{t("ui.outputTempoMoved", { count: row.moved })}</p>{/if}
      </li>
    {/each}
  </ul>
</dialog>

<style>
  .output {
    width: min(760px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
  }
  .output::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  header,
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
  }
  .spacer {
    flex: 1;
  }
  .help {
    margin: 4px 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .advice li {
    padding: 3px 0;
  }
  .acts {
    display: inline-flex;
    gap: 6px;
    margin-left: 6px;
  }
  .advice .warn,
  .badge.warn {
    color: var(--ev-marker);
  }
  .advice .bad,
  .badge.bad {
    color: var(--danger);
  }
  .row {
    border-top: 1px solid var(--line);
    padding: 6px 0;
  }
  .badge {
    font-size: 0.85em;
  }
  .tracks {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-top: 4px;
  }
  .track {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: none;
    padding: 2px 4px;
    font: inherit;
    color: inherit;
    cursor: pointer;
    border-radius: 4px;
  }
  .track:hover {
    background: var(--hover, rgba(127, 127, 127, 0.12));
  }
  .bar {
    display: inline-block;
    width: 56px;
    height: 6px;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .track.full .bar span {
    background: var(--danger);
  }
  .track.full .count {
    color: var(--danger);
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-size: 0.9em;
  }
  .note {
    margin: 2px 0 0;
    font-size: 0.85em;
  }
</style>
