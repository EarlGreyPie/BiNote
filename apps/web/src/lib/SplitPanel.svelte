<script lang="ts">
  import { positionToSeconds, type Song } from "@mmlce/core";
  import { playerScores, type BookSpread, type FewerBooks, type SplitResult } from "@mmlce/mml";
  import { t } from "./i18n.svelte";

  interface Props {
    /** 나눈 곡 (화음을 고르게 나눴으면 옮긴 곡) */
    song: Song;
    result: SplitResult;
    /** 나누기 전에 화음을 고르게 나눠 권이 줄었으면 그 내용 */
    spread?: BookSpread | undefined;
    /** 나누기 방식: 화음 고르게 나눈 뒤 나누기, 꼼꼼히 나누기. 바꾸면 다시 나눈다 */
    spreadOn: boolean;
    thoroughOn: boolean;
    onspread: (on: boolean) => void;
    onthorough: (on: boolean) => void;
    limit: number;
    /** 악보 하나에 넣을 수 있는 트랙 수 (profile.maxChordsPerPlayer) */
    maxChords: number | ((playerId: string) => number);
    /** 트랙 사이 음을 고르게 옮기면 권이 줄어드는지 (checking: 계산 중) */
    fewer?: FewerBooks | "checking" | undefined;
    /** 고르게 옮기고 다시 나누기·편집 중인 곡에도 적용 (distributeChords에 줄 채널 글자 수) */
    onfewer: (limit: number) => void;
    onclose: () => void;
  }

  let { song, result, spread, spreadOn, thoroughOn, onspread, onthorough, limit, maxChords, fewer, onfewer, onclose }: Props = $props();
  let copied = $state("");

  function clock(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = id;
    } catch {
      copied = "";
    }
  }

  const nameOf = (trackId: string) => song.tracks.find((tr) => tr.id === trackId)?.name ?? trackId;

  /** 이름이 같은 연주자도 구분되게 순번을 붙인다 */
  const playerName = (playerId: string) => {
    const k = song.players.findIndex((p) => p.id === playerId);
    return k < 0 ? playerId : `${k + 1}. ${song.players[k]!.name}`;
  };

  /** 게임 붙여넣기 단위: 권마다 연주자별 악보 하나 (MML@트랙1,트랙2,...;) */
  const scoresOf = (part: SplitResult["parts"][number]) => playerScores(song, part.texts, maxChords);
</script>

<section class="split">
  <header>
    <h2>{t("ui.split")}</h2>
    <span class="muted">
      {result.needed ? t("ui.splitCount", { count: result.parts.length }) : spread ? t("ui.splitNotNeededSpread") : t("ui.splitNotNeeded")}
    </span>
    <span class="spacer"></span>
    <button class="small" onclick={onclose}>{t("ui.close")}</button>
  </header>
  <div class="modes">
    <label title={t("ui.splitSpreadHint")}>
      <input type="checkbox" checked={spreadOn} onchange={(e) => onspread(e.currentTarget.checked)} />
      {t("ui.splitSpread")}
    </label>
    <label title={t("ui.splitThoroughHint")}>
      <input type="checkbox" checked={thoroughOn} onchange={(e) => onthorough(e.currentTarget.checked)} />
      {t("ui.splitThorough")}
    </label>
  </div>
  {#if spread}
    <p class="fewer">
      {spread.from === undefined ? t("ui.splitSpreadOne", { moved: spread.moved }) : t("ui.splitSpreadDone", { from: spread.from, to: spread.to, moved: spread.moved })}
      <button class="small" onclick={() => onfewer(spread.limit)}>{t("ui.splitSpreadApply")}</button>
    </p>
  {/if}
  {#if fewer === "checking"}
    <p class="muted help">{t("ui.splitFewerChecking")}</p>
  {:else if fewer}
    <p class="fewer">
      {t("ui.splitFewer", { from: fewer.from, to: fewer.to, moved: fewer.moved })}
      <button class="small" onclick={() => onfewer(fewer.limit)}>{t("ui.splitFewerApply")}</button>
    </p>
  {/if}
  <p class="muted help">{t("ui.splitHelp")}</p>
  {#each result.parts as part, i (i)}
    {@const from = positionToSeconds(song.tempo, part.start)}
    {@const to = positionToSeconds(song.tempo, part.end)}
    <div class="part">
      <div class="part-head">
        <strong>{t("ui.splitPart", { n: i + 1 })}</strong>
        <span class="muted">{clock(from)} – {clock(to)}</span>
        {#if part.cut > 0}<span class="warn">{t("ui.splitCut", { count: part.cut })}</span>{/if}
        {#if part.lossy.length > 0}<span class="warn">{t("ui.splitLossy", { list: part.lossy.map(nameOf).join(", ") })}</span>{/if}
        {#if part.moved > 0}<span class="muted">{t("ui.outputTempoMoved", { count: part.moved })}</span>{/if}
        {#each scoresOf(part) as score (`${score.playerId}:${score.index}`)}
          {@const id = `score:${i}:${score.playerId}:${score.index}`}
          {@const name = score.index > 0 ? `${playerName(score.playerId)} (${score.index + 1})` : playerName(score.playerId)}
          <button class="small" onclick={() => copy(id, score.text)} title={t("ui.copyScoreHint", { count: score.trackIds.length })}>
            {copied === id ? t("ui.copied") : t("ui.copyScore", { name })}
          </button>
        {/each}
      </div>
      <ul>
        {#each part.texts as { trackId, text } (trackId)}
          {@const id = `${i}:${trackId}`}
          <li>
            <span class="name">{nameOf(trackId)}</span>
            <span class={text.length > limit ? "over" : "muted"}>{t("ui.chars", { count: text.length })} / {limit}</span>
            <button class="small" onclick={() => copy(id, text)} disabled={text.length === 0}>
              {copied === id ? t("ui.copied") : t("ui.copy")}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</section>

<style>
  .modes {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 4px 0;
    font-size: 13px;
  }
  .modes label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .fewer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 4px 0;
    padding: 6px 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    font-size: 13px;
  }
  .split {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px 12px;
    margin: 8px 0;
    background: var(--panel);
  }
  header,
  .part-head {
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
  .part + .part {
    border-top: 1px solid var(--line);
    margin-top: 6px;
    padding-top: 6px;
  }
  ul {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .warn {
    color: var(--danger);
  }
</style>
