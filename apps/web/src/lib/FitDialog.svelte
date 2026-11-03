<script lang="ts">
  import { type Command, type GameProfile, type Rat, type Song } from "@mmlce/core";
  import { scoreChunks, type BookPlan, type BookProgress, type FewerBooks } from "@mmlce/mml";
  import { t } from "./i18n.svelte";
  import MergeDialog from "./MergeDialog.svelte";
  import SpreadDialog from "./SpreadDialog.svelte";
  import SplitPanel from "./SplitPanel.svelte";
  import type { FitTab } from "./splitView";

  /**
   * 글자 수 맞추기 창 (곡 메뉴). 트랙마다 게임에 넣는 글자 수를 한눈에 보고, 한 창 안에서
   * 화음 분산(넘친 트랙의 음을 다른 트랙으로) → 화음 병합(트랙 줄이기) → 악보책 나누기 순으로 맞춘다.
   * 칸마다 적용은 지금처럼 실행 취소 한 칸이고, 적용해도 창은 닫히지 않는다 (곡이 바뀌면 칸을 새로 만든다).
   * 글자 수 줄이기(최적화)는 넣지 않는다: 게임에 넣기·내보내기·악보책은 늘 가장 짧은 글을 쓰므로 게임 글자 수가 바뀌지 않는다
   */
  interface Props {
    song: Song;
    profile: GameProfile;
    colors?: ReadonlyMap<string, string>;
    locked: ReadonlySet<string>;
    activeTrackId?: string | undefined;
    /** 트랙마다 게임에 넣는 글자 수 (MML로 내보내기와 같은 수). 아직 세는 중이면 undefined */
    chars: ReadonlyMap<string, number> | undefined;
    chordsOf: (playerId: string) => number;
    tab: FitTab;
    ontab: (tab: FitTab) => void;
    /** 화음 분산 칸에서 처음 고를 보내는 트랙 */
    spreadSource?: string | undefined;
    where: (trackId: string) => string;
    newScoreOnAdd: (playerId: string) => boolean;
    onseek: (at: Rat) => void;
    onaddtrack: (playerId: string) => void;
    onapply: (command: Command) => void;
    onclose: () => void;
    /** 악보책 나누기 칸: 지금 곡을 나눈 결과 (없으면 나누는 중이거나 아직) */
    split: BookPlan | undefined;
    splitProgress: BookProgress | undefined;
    /** 나누기에 실패했으면 그 알림 */
    splitError?: string | undefined;
    fewer: FewerBooks | "checking" | undefined;
    onfewer: (limit: number) => void;
    spreadOn: boolean;
    thoroughOn: boolean;
    onspread: (on: boolean) => void;
    onthorough: (on: boolean) => void;
    fixed: readonly Rat[];
    cursor: Rat | undefined;
    onfix: (at: Rat, on: boolean) => void;
    onunfixall: () => void;
    /** 피아노롤 위 예상 분할 위치 보기 (보기 메뉴와 같은 설정) */
    previewOn: boolean;
    onpreview: (on: boolean) => void;
    /** 나누기 진행 글 (단계 이름) */
    progressLabel: (progress: BookProgress) => string;
  }

  let p: Props = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });

  const limit = $derived(p.profile.charLimitPerScore);
  /** 악보마다 트랙 (게임에 붙여넣는 단위) */
  const scores = $derived(scoreChunks(p.song, p.chordsOf));
  const nameOf = (id: string) => p.song.tracks.find((tr) => tr.id === id)?.name ?? id;
  const color = (id: string) => p.colors?.get(id) ?? p.song.tracks.find((tr) => tr.id === id)?.color ?? "var(--muted)";
  const over = $derived(p.chars ? [...p.chars.values()].filter((n) => n > limit).length : 0);
  const books = $derived(p.split?.result.needed ? p.split.result.parts.length : undefined);
  const tabs = [
    { id: "spread", label: "ui.distribute" },
    { id: "merge", label: "ui.merge" },
    { id: "split", label: "ui.split" },
  ] as const satisfies readonly { id: FitTab; label: string }[];
</script>

<dialog bind:this={dialog} onclose={p.onclose}>
  <header>
    <h2>{t("ui.menuFitChars")}</h2>
    <span class="spacer"></span>
    <button class="small" onclick={() => dialog.close()}>{t("ui.close")}</button>
  </header>
  <p class="muted">{t("ui.fitIntro", { limit })}</p>

  <!-- 요약: 악보마다 트랙 글자 수 막대 (한도를 넘으면 경고 색) -->
  <section class="summary" aria-label={t("ui.fitSummary")}>
    <div class="headline">
      {#if !p.chars}
        <span class="muted">{t("ui.fitCounting")}</span>
      {:else if over > 0}
        <span class="warn">{t("ui.fitOver", { count: over, limit })}</span>
      {:else}
        <span>{t("ui.fitAllIn", { limit })}</span>
      {/if}
      {#if books !== undefined}<span class="muted">· {t("ui.splitCount", { count: books })}</span>{/if}
    </div>
    <div class="scores">
      {#each scores as score (`${score.playerId}:${score.index}`)}
        <div class="score">
          {#each score.trackIds as id (id)}
            {@const n = p.chars?.get(id)}
            <div class="bar-row" title={`${p.where(id)} ${nameOf(id)}`}>
              <span class="name"><span class="dot" style:background={color(id)}></span>{p.where(id)} {nameOf(id)}</span>
              <span class="bar"><span class="fill" class:full={(n ?? 0) > limit} style:width={`${Math.min(100, ((n ?? 0) / limit) * 100)}%`}></span></span>
              <span class="num" class:warn={(n ?? 0) > limit}>{n ?? "…"}</span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </section>

  <div class="tabs" role="tablist">
    {#each tabs as tab (tab.id)}
      <button role="tab" aria-selected={p.tab === tab.id} class:on={p.tab === tab.id} onclick={() => p.ontab(tab.id)}>{t(tab.label)}</button>
    {/each}
    <span class="spacer"></span>
    <label class="preview" title={t("ui.splitPreviewHelp")}>
      <input type="checkbox" checked={p.previewOn} onchange={(e) => p.onpreview(e.currentTarget.checked)} />
      {t("ui.splitPreview")}
    </label>
  </div>

  <div class="pane" role="tabpanel">
    {#if p.tab === "spread"}
      {#key p.song}
        <SpreadDialog
          embedded
          song={p.song}
          {...p.colors ? { colors: p.colors } : {}}
          profile={p.profile}
          locked={p.locked}
          initialSource={p.spreadSource}
          where={p.where}
          newScoreOnAdd={p.newScoreOnAdd}
          onseek={p.onseek}
          onaddtrack={p.onaddtrack}
          onsplit={() => p.ontab("split")}
          onapply={p.onapply}
          onclose={() => {}}
        />
      {/key}
    {:else if p.tab === "merge"}
      {#key p.song}
        <MergeDialog
          embedded
          song={p.song}
          {...p.colors ? { colors: p.colors } : {}}
          profile={p.profile}
          locked={p.locked}
          activeTrackId={p.activeTrackId}
          where={p.where}
          onseek={p.onseek}
          onapply={p.onapply}
          onclose={() => {}}
        />
      {/key}
    {:else if p.splitProgress}
      <p class="muted" role="status">
        {p.progressLabel(p.splitProgress)} {Math.round(p.splitProgress.fraction * 100)}%
      </p>
    {:else if p.split}
      <SplitPanel
        song={p.split.song}
        result={p.split.result}
        spread={p.split.spread}
        {limit}
        maxChords={p.chordsOf}
        pasteLimit={p.profile.maxChordsPerPlayer}
        fewer={p.fewer}
        onfewer={p.onfewer}
        spreadOn={p.spreadOn}
        thoroughOn={p.thoroughOn}
        onspread={p.onspread}
        onthorough={p.onthorough}
        fixed={p.fixed}
        cursor={p.cursor}
        onfix={p.onfix}
        onunfixall={p.onunfixall}
        onseek={p.onseek}
      />
    {:else if p.splitError}
      <p class="warn">{p.splitError}</p>
    {:else}
      <p class="muted">{p.progressLabel({ stage: "split", fraction: 0 })}</p>
    {/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(760px, calc(100vw - 32px));
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
  header,
  .tabs,
  .headline {
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
  .summary {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 10px;
    margin: 8px 0;
  }
  .scores {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
    max-height: 30dvh;
    overflow-y: auto;
  }
  .score + .score {
    border-top: 1px dashed var(--line);
    padding-top: 4px;
  }
  .bar-row {
    display: grid;
    grid-template-columns: minmax(0, 14em) 1fr 4em;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: middle;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--line) 60%, transparent);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .fill.full {
    background: var(--danger);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .tabs {
    border-bottom: 1px solid var(--line);
    margin-top: 8px;
  }
  .tabs button[role="tab"] {
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: none;
    color: inherit;
    padding: 6px 10px;
  }
  .tabs button.on {
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .preview {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
  }
  .pane {
    padding-top: 6px;
  }
  .warn {
    color: var(--danger);
  }
  @media (max-width: 520px) {
    .bar-row {
      grid-template-columns: minmax(0, 8em) 1fr 3.5em;
    }
  }
</style>
