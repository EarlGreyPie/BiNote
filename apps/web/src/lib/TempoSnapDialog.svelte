<script lang="ts" module>
  /** 미리보기: 숫자 셋(가장 큰 이동, 템포 개수 전후, 트랙별 글자 수)과 음 시작 맞추기의 찾은 음 수 */
  export interface TempoSnapPreview {
    /** 바뀌는 게 없으면 그 까닭 (창에 보인다) */
    readonly none?: string;
    readonly tempos: { readonly before: number; readonly after: number };
    /** 음 시작이 가장 많이 움직인 양 (ms) */
    readonly maxMs: number;
    readonly rows: readonly PreviewRow[];
    /** 음 시작 맞추기만: 찾은 음 / 전체, 평균 이동 ms */
    readonly found?: { readonly found: number; readonly total: number; readonly ms: number };
    /** 못 맞춘 음 (게임 템포 범위 밖): 자리(온음표)와 표시 (마디:박) */
    readonly outOfRange?: readonly { readonly at: number; readonly label: string }[];
    /** 실험실 범위 밖 템포 풀기를 골랐을 때: 음 길이로 풀 곳 (바꾸기 전 자리와 표시) */
    readonly folded?: readonly { readonly at: number; readonly label: string }[];
  }
  /** 창에서 고른 값: 찾는 창(초, 템포 정리에는 없음), 합치기 허용 오차(초, 0 = 합치지 않기) */
  export interface TempoSnapSettings {
    readonly window: number;
    readonly tolerance: number;
    /** 실험실: 범위 밖이 되는 음을 빼지 않고 맞춘 뒤 그 템포 조각을 음 길이로 푼다 */
    readonly fold?: boolean;
  }
</script>

<script lang="ts">
  import type { BarRange } from "@mmlce/core";
  import BarTargetRow, { barTarget, initialBarMode, type BarMode, type TempoTarget } from "./BarTargetRow.svelte";
  import { t } from "./i18n.svelte";
  import { loadStored, saveStored } from "./persist";
  import type { PreviewRow } from "./output";

  /**
   * 실험실 1.1 템포 작업 도구 창 (곡 → 템포 ▸): 음 시작을 원곡에 맞추기(snap) · 템포 정리(tidy).
   * 마디 줄은 템포 한꺼번에 바꾸기 창과 같고, 미리보기는 실제로 넣을 계획으로 계산한다
   */
  interface Props {
    kind: "snap" | "tidy";
    loopBars?: BarRange | undefined;
    loopRange?: string | undefined;
    limit: number;
    tempoRange: { readonly min: number; readonly max: number };
    preview: (target: TempoTarget, settings: TempoSnapSettings) => TempoSnapPreview | undefined;
    onapply: (target: TempoTarget, settings: TempoSnapSettings) => void;
    /** 못 맞춘 음 자리로 가기 (창은 열어 둔다) */
    onjump: (at: number) => void;
    /** 실험실 범위 밖 템포를 길이로 풀기를 쓸 수 있는지 (못 맞춘 음 목록에 단추가 생긴다) */
    canFold?: boolean;
    onclose: () => void;
  }

  let { kind, loopBars, loopRange, limit, tempoRange, preview, onapply, onjump, canFold = false, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  const WINDOWS = [30, 60, 100] as const;
  // 음 시작 맞추기는 합치지 않기(0)도 고를 수 있다
  // svelte-ignore state_referenced_locally
  const TOLERANCES = kind === "snap" ? ([0, 5, 10, 20, 30] as const) : ([5, 10, 20, 30] as const);
  const WINDOW_KEY = "mmlce.tempoSnap.window";
  // svelte-ignore state_referenced_locally
  const TOLERANCE_KEY = `mmlce.tempoSnap.${kind}Tolerance`;
  const readMs = (list: readonly number[], fallback: number) => (raw: string | null) => (raw !== null && raw !== "" && list.includes(Number(raw)) ? Number(raw) : fallback);
  let windowMs = $state(loadStored(WINDOW_KEY, readMs(WINDOWS, 60)));
  let toleranceMs = $state(loadStored(TOLERANCE_KEY, readMs(TOLERANCES, 20)));
  function pickWindow(ms: number) {
    windowMs = ms;
    saveStored(WINDOW_KEY, String(ms));
  }
  function pickTolerance(ms: number) {
    toleranceMs = ms;
    saveStored(TOLERANCE_KEY, String(ms));
  }

  // svelte-ignore state_referenced_locally
  let barMode = $state<BarMode>(initialBarMode(loopBars, loopRange));
  let barText = $state("");
  const target = $derived(barTarget(barMode, barText));
  /** 못 맞춘 음을 길이로 풀기 (창을 연 동안만. 기억하지 않는다) */
  let fold = $state(false);
  const settings = $derived<TempoSnapSettings>({ window: windowMs / 1000, tolerance: toleranceMs / 1000, ...(canFold && fold ? { fold: true } : {}) });
  const result = $derived(target ? preview(target, settings) : undefined);
  const over = $derived(result?.rows.some((r) => r.after > r.limit) ?? false);
  const ready = $derived(!!target && !!result && !result.none);

  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (!ready || !target) return;
    onapply(target, settings);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t(kind === "snap" ? "ui.tempoSnap" : "ui.tempoTidy")}</h2>
  <p class="muted">{t(kind === "snap" ? "ui.tempoSnapHelp" : "ui.tempoTidyHelp")}</p>
  <BarTargetRow name="tempo-snap-bars" {loopBars} {loopRange} bind:mode={barMode} bind:text={barText} />
  {#if kind === "snap"}
    <div class="row">
      <span class="name">{t("ui.tempoSnapWindow")}</span>
      <div class="seg">
        {#each WINDOWS as ms (ms)}
          <button class:on={windowMs === ms} onclick={() => pickWindow(ms)}>±{ms}ms</button>
        {/each}
      </div>
    </div>
  {/if}
  <div class="row">
    <span class="name">{t(kind === "snap" ? "ui.tempoSnapMerge" : "ui.tempoTidyTolerance")}</span>
    <div class="seg">
      {#each TOLERANCES as ms (ms)}
        <button class:on={toleranceMs === ms} onclick={() => pickTolerance(ms)}>{ms === 0 ? t("ui.tempoSnapMergeOff") : `${ms}ms`}</button>
      {/each}
    </div>
  </div>
  {#if kind === "snap"}<p class="muted small">{t("ui.tempoSnapLimits")}</p>{/if}
  {#if result}
    {#if result.found}
      <p>{t("ui.tempoSnapFound", { found: result.found.found, total: result.found.total, ms: result.found.ms })}</p>
    {/if}
    {#if result.none}
      <p class="warn">{result.none}</p>
    {:else}
      <p>
        {t("ui.tempoSnapCount", { before: result.tempos.before, after: result.tempos.after })} · {t("ui.tempoSnapShift", { ms: result.maxMs })}
      </p>
      {#if result.outOfRange && result.outOfRange.length > 0}
        <p class="warn">{t("ui.tempoSnapOutOfRange", { n: result.outOfRange.length, min: tempoRange.min, max: tempoRange.max })}</p>
        <div class="spots">
          {#each result.outOfRange as o (o.at)}
            <button class="small" onclick={() => onjump(o.at)}>{o.label}</button>
          {/each}
          {#if canFold}<button class="small primary" title={t("ui.tempoSnapFoldHelp")} onclick={() => (fold = true)}>{t("ui.tempoSnapFold")}</button>{/if}
        </div>
      {/if}
      {#if fold && result.folded}
        <p>{t("ui.tempoSnapFolded", { n: result.folded.length })}</p>
        {#if result.folded.length > 0}
          <div class="spots">
            {#each result.folded as o (o.at)}
              <button class="small" onclick={() => onjump(o.at)}>{o.label}</button>
            {/each}
          </div>
        {/if}
      {/if}
      {#if result.rows.length > 0}
        <p class="muted">{t("ui.tempoRampChars", { limit })}</p>
        <ul class="rows">
          {#each result.rows as r (r.trackId)}
            <li class:warn={r.after > r.limit}>{r.name}: {r.before} → {r.after}</li>
          {/each}
        </ul>
      {/if}
      {#if over}<p class="warn">{t("ui.tempoSnapOver")}</p>{/if}
    {/if}
  {/if}
  {#if canFold && fold}
    <p class="muted small">{t("ui.tempoSnapFoldHelp")} <button class="small" onclick={() => (fold = false)}>{t("ui.tempoSnapFoldOff")}</button></p>
  {/if}
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!ready} onclick={apply}>{t("ui.eventApply")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(440px, calc(100vw - 32px));
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
  p {
    margin: 6px 0 0;
  }
  .small {
    font-size: 0.85rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin-top: 8px;
  }
  .name {
    min-width: 7em;
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
  }
  .warn {
    color: var(--warn, #c48a00);
  }
  .spots {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .rows {
    margin: 4px 0 0;
    padding-left: 18px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .spacer {
    flex: 1;
  }
</style>
