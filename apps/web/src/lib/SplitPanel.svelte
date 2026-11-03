<script lang="ts">
  import { barBeatAt, positionToSeconds, toFloat, type Rat, type Song } from "@mmlce/core";
  import { playerScores, type BookSpread, type FewerBooks, type SplitChoice, type SplitResult } from "@mmlce/mml";
  import { t } from "./i18n.svelte";
  import { lostText } from "./splitView";

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
    /** 게임 악보 하나의 트랙 한도 (profile.maxChordsPerPlayer). 오르골·축음기 악보에 소리 없는 나머지 트랙을 붙인다 */
    pasteLimit?: number;
    /** 트랙 사이 음을 고르게 옮기면 권이 줄어드는지 (checking: 계산 중) */
    fewer?: FewerBooks | "checking" | undefined;
    /** 고르게 옮기고 다시 나누기·편집 중인 곡에도 적용 (distributeChords에 줄 채널 글자 수) */
    onfewer: (limit: number) => void;
    /** 닫기 단추 (글자 수 맞추기 창 안이면 없다) */
    onclose?: (() => void) | undefined;
    /** 고정한 자르는 자리 */
    fixed?: readonly Rat[];
    /** 지금 커서 자리 (여기서 자르기) */
    cursor?: Rat | undefined;
    /** 자르는 자리를 고정하거나 풀고 다시 나눈다 */
    onfix?: ((at: Rat, on: boolean) => void) | undefined;
    onunfixall?: (() => void) | undefined;
    /** 곡 위치로 커서와 피아노롤을 옮긴다 */
    onseek?: ((at: Rat) => void) | undefined;
  }

  let { song, result, spread, spreadOn, thoroughOn, onspread, onthorough, limit, maxChords, pasteLimit, fewer, onfewer, onclose, fixed = [], cursor, onfix, onunfixall, onseek }: Props = $props();

  /** 마디·박 자리 글 */
  const place = (at: Rat) => {
    const b = barBeatAt(song.timeSig, at);
    return t("ui.checkPlace", { bar: b.bar, beat: b.beat });
  };
  /** 자르는 자리 상태 글: 모두 쉬는 자리, 잘려 나가는 소리, 지연을 못 메움 */
  const costText = (x: { clean: boolean; lost: number; cut: number }) =>
    x.clean ? t("ui.splitClean") : x.lost === Infinity ? t("ui.splitNoGap") : t("ui.splitLost", { seconds: lostText(x.lost), count: x.cut });
  const choiceText = (c: SplitChoice) => `${place(c.at)} · ${costText(c)}`;
  /** 곡 끝 (띠 너비) */
  const total = $derived(Math.max(1e-9, toFloat(result.parts[result.parts.length - 1]?.end ?? { n: 1, d: 1 })));
  const xOf = (at: Rat | number) => ((typeof at === "number" ? at : toFloat(at)) / total) * 1000;
  /** 커서 자리가 자를 수 있는 곳인지 (곡 처음·끝이 아닌 곳) */
  const cursorOk = $derived(cursor !== undefined && toFloat(cursor) > 0 && toFloat(cursor) < total);
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
  const scoresOf = (part: SplitResult["parts"][number]) => playerScores(song, part.texts, maxChords, pasteLimit);
</script>

<section class="split">
  <header>
    <!-- 글자 수 맞추기 창 안에서는 칸 이름이 제목이다 -->
    {#if onclose}<h2>{t("ui.split")}</h2>{/if}
    <span class="muted">
      {result.needed ? t("ui.splitCount", { count: result.parts.length }) : spread ? t("ui.splitNotNeededSpread") : t("ui.splitNotNeeded")}
    </span>
    <span class="spacer"></span>
    {#if onclose}<button class="small" onclick={onclose}>{t("ui.close")}</button>{/if}
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
  {#if result.needed}
    <!-- 곡 전체 띠: 권마다 칸, 자르는 자리 앞 지연 구간(쉬면 옅게, 소리가 잘리면 경고 색), 고정한 자리는 굵은 선 -->
    <svg class="strip" viewBox="0 0 1000 30" preserveAspectRatio="none" role="img" aria-label={t("ui.splitStrip")}>
      {#each result.parts as part, i (i)}
        <rect x={xOf(part.start)} y="4" width={Math.max(1, xOf(part.end) - xOf(part.start))} height="22" class={i % 2 === 0 ? "book even" : "book odd"} />
        {#if i < result.parts.length - 1}
          {@const from = toFloat(part.end) - toFloat(part.trim)}
          <rect x={xOf(from)} y="4" width={Math.max(2, xOf(part.end) - xOf(from))} height="22" class={part.clean ? "gap clean" : "gap lost"} />
          <rect x={xOf(part.end) - (part.fixed ? 2 : 1)} y="0" width={part.fixed ? 4 : 2} height="30" class={part.fixed ? "cut fixed" : "cut"} />
        {/if}
      {/each}
      {#each song.markers as m (m.id)}
        <rect x={xOf(m.at) - 0.5} y="26" width="1" height="4" class="marker" />
      {/each}
    </svg>
    <div class="row">
      {#if onfix}
        <button class="small" disabled={!cursorOk} onclick={() => cursor && onfix(cursor, true)} title={t("ui.splitCutHereHint")}>{t("ui.splitCutHere")}</button>
      {/if}
      {#if onunfixall && fixed.length > 0}
        <button class="small" onclick={onunfixall}>{t("ui.splitUnfixAll", { count: fixed.length })}</button>
      {/if}
    </div>
  {/if}
  {#each result.parts as part, i (i)}
    {@const from = positionToSeconds(song.tempo, part.start)}
    {@const to = positionToSeconds(song.tempo, part.end)}
    <div class="part">
      <div class="part-head">
        <strong>{t("ui.splitPart", { n: i + 1 })}</strong>
        <span class="muted">{clock(from)} – {clock(to)} · {place(part.start)}</span>
        {#if part.cut > 0}<span class="warn">{t("ui.splitCut", { count: part.cut })}</span>{/if}
        {#if part.lossy.length > 0}<span class="warn">{t("ui.splitLossy", { list: part.lossy.map(nameOf).join(", ") })}</span>{/if}
        {#if part.moved > 0}<span class="muted">{t("ui.outputTempoMoved", { count: part.moved })}</span>{/if}
        {#each scoresOf(part) as score (`${score.playerId}:${score.index}`)}
          {@const id = `score:${i}:${score.playerId}:${score.index}`}
          {@const name = score.index > 0 ? `${playerName(score.playerId)} (${score.index + 1})` : playerName(score.playerId)}
          <button class="small" onclick={() => copy(id, score.text)} title={t("ui.copyScoreHint", { count: score.trackIds.length }) + (score.silent > 0 ? `\n${t("ui.pasteSilent", { count: score.silent })}: ${t("ui.pasteSilentHint")}` : "")}>
            {copied === id ? t("ui.copied") : t("ui.copyScore", { name })}
          </button>
        {/each}
      </div>
      {#if i < result.parts.length - 1}
        <!-- 이 권 끝 자르는 자리: 상태, 그 자리로, 고정·풀기, 다른 자리로 옮기기 -->
        <div class="cut-row">
          <span>{t("ui.splitCutAt", { place: place(part.end) })}</span>
          <span class={part.clean ? "muted" : "warn"}>{costText({ clean: part.clean, lost: part.lost, cut: part.cut })}</span>
          {#if part.fixed}<span class="badge">{t("ui.splitFixed")}</span>{/if}
          {#if onseek}<button class="small link" onclick={() => onseek(part.end)}>{t("ui.outputTempoGo")}</button>{/if}
          {#if onfix}
            {#if part.fixed}
              <button class="small" onclick={() => onfix(part.end, false)}>{t("ui.splitUnfix")}</button>
            {:else}
              <button class="small" onclick={() => onfix(part.end, true)} title={t("ui.splitFixHint")}>{t("ui.splitFix")}</button>
            {/if}
            {#if part.choices.length > 0}
              <select
                aria-label={t("ui.splitMove")}
                onchange={(e) => {
                  const k = Number(e.currentTarget.value);
                  const c = part.choices[k];
                  e.currentTarget.value = "";
                  if (c) onfix(c.at, true);
                }}
              >
                <option value="">{t("ui.splitMove")}</option>
                {#each part.choices as c, k (k)}
                  <option value={k}>{choiceText(c)}</option>
                {/each}
              </select>
            {/if}
          {/if}
        </div>
      {/if}
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
  .strip {
    width: 100%;
    height: 30px;
    display: block;
    margin: 4px 0;
  }
  .book.even {
    fill: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .book.odd {
    fill: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .gap.clean {
    fill: var(--muted);
    opacity: 0.35;
  }
  .gap.lost {
    fill: var(--danger);
    opacity: 0.6;
  }
  .cut {
    fill: var(--text);
  }
  .cut.fixed {
    fill: var(--accent);
  }
  .marker {
    fill: var(--ev-marker, var(--muted));
  }
  .row,
  .cut-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    font-size: 13px;
  }
  .cut-row {
    margin: 2px 0;
  }
  .cut-row select {
    max-width: 100%;
  }
  .badge {
    padding: 0 6px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    font-size: 12px;
  }
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
