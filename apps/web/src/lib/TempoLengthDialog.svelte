<script lang="ts" module>
  import type { RespaceUnit } from "@mmlce/mml";

  /** 창에서 고른 값. grid: 64면 1/64 격자, "auto"면 허용 오차를 지키는 가장 성긴 격자 */
  export interface TempoLengthSettings {
    readonly unit: RespaceUnit;
    readonly grid: "auto" | 16 | 24 | 32 | 48 | 64;
    /** 격자 오차 허용 (초) */
    readonly tolerance: number;
    /** 배율을 1로 묶기 (마디 길이를 바꾸지 않는다) */
    readonly lockScale: boolean;
    /** 원곡 시작점으로 맞추기와 찾는 창 (초) */
    readonly snap: boolean;
    readonly window: number;
  }

  /** 미리보기 (실제로 넣을 곡으로 계산한다) */
  export interface TempoLengthPreview {
    /** 바뀌는 게 없거나 바꿀 수 없으면 그 까닭 */
    readonly none?: string;
    readonly tempos: { readonly before: number; readonly after: number };
    /** 맞출 시각에서 가장 많이 어긋난 양 (ms) */
    readonly errorMs: number;
    /** 음 시작이 지금보다 가장 많이 움직인 양 (ms, 구간 밖 포함) */
    readonly shiftMs: number;
    /** 길이 0이 될 뻔해 끝을 한 칸 민 음 */
    readonly collapsed: number;
    /** 한 자리로 모인 음 시작, 그 가운데 만든 기록 음이 낀 곳 */
    readonly merged: number;
    readonly mergedMade: number;
    /** 바뀌는 박자표 (마디 n/m) */
    readonly meters: readonly string[];
    /** 구간마다 고른 배율·격자·평균 템포 */
    readonly spans: readonly string[];
    readonly rows: readonly PreviewRow[];
    /** 원곡 시작점을 찾은 음 / 전체 */
    readonly found?: { readonly found: number; readonly total: number };
  }

  /** 템포가 튀는 박 (마디:박 표시, 가장 작은·큰 템포) */
  export interface TempoJumpRow {
    readonly label: string;
    readonly min: number;
    readonly max: number;
  }
</script>

<script lang="ts">
  import type { BarRange } from "@mmlce/core";
  import BarTargetRow, { barTarget, initialBarMode, type BarMode, type TempoTarget } from "./BarTargetRow.svelte";
  import { t } from "./i18n.svelte";
  import { loadStored, saveStored } from "./persist";
  import type { PreviewRow } from "./output";

  /**
   * 실험실 1.1 "템포를 음 길이로 바꾸기" 창 (곡 → 템포 ▸): 고른 구간의 템포를 고르게 펴고 음 자리·길이를 다시 쓴다.
   * 마디 줄은 템포 한꺼번에 바꾸기 창과 같다. 아래 "템포가 튀는 곳"을 누르면 그 박이 반복 구간으로 잡힌다
   */
  interface Props {
    loopBars?: BarRange | undefined;
    loopRange?: string | undefined;
    limit: number;
    /** 원곡이 있어야 원곡 시작점으로 맞추기를 고를 수 있다 */
    hasReference: boolean;
    jumps: readonly TempoJumpRow[];
    preview: (target: TempoTarget, settings: TempoLengthSettings) => TempoLengthPreview | undefined;
    /** 바꾼다. 바꾸지 못했으면 그 까닭을 돌려주고 창은 열어 둔다 */
    onapply: (target: TempoTarget, settings: TempoLengthSettings) => string | undefined;
    /** 튀는 곳 하나를 반복 구간으로 */
    onjump: (index: number) => void;
    onclose: () => void;
  }

  let { loopBars, loopRange, limit, hasReference, jumps, preview, onapply, onjump, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  const UNITS: readonly RespaceUnit[] = ["span", "bar", "beat"];
  const UNIT_LABEL = { span: "ui.tempoLengthUnitSpan", bar: "ui.tempoLengthUnitBar", beat: "ui.tempoLengthUnitBeat" } as const;
  const GRIDS = ["auto", 16, 24, 32, 48, 64] as const;
  const TOLERANCES = [10, 15, 20, 30] as const;
  const WINDOWS = [30, 60, 100] as const;
  const KEY = "mmlce.tempoLength.";
  const pickOf =
    <T extends string | number>(list: readonly T[], fallback: T) =>
    (raw: string | null): T =>
      list.find((v) => String(v) === raw) ?? fallback;
  let unit = $state<RespaceUnit>(loadStored(KEY + "unit", pickOf(UNITS, "span")));
  let grid = $state<(typeof GRIDS)[number]>(loadStored(KEY + "grid", pickOf(GRIDS, 64)));
  let toleranceMs = $state<number>(loadStored(KEY + "tolerance", pickOf(TOLERANCES, 15)));
  let lockScale = $state(loadStored(KEY + "lockScale", (raw) => raw === "1"));
  let snap = $state(false);
  // 찾는 창은 음 시작을 원곡에 맞추기와 같은 값을 쓴다
  let windowMs = $state<number>(loadStored("mmlce.tempoSnap.window", pickOf(WINDOWS, 60)));
  const remember = (key: string, value: string | number | boolean) => saveStored(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));

  // svelte-ignore state_referenced_locally
  let barMode = $state<BarMode>(initialBarMode(loopBars, loopRange));
  let barText = $state("");
  // 튀는 곳을 눌러 반복 구간이 바뀌면 "반복 구간 그대로"(마디선에 맞으면 선택 마디)로 옮긴다
  let jumped = $state(false);
  $effect(() => {
    if (!jumped) return;
    barMode = initialBarMode(loopBars, loopRange);
  });
  const target = $derived(barTarget(barMode, barText));
  const settings = $derived<TempoLengthSettings>({
    unit,
    grid,
    tolerance: toleranceMs / 1000,
    lockScale,
    snap: snap && hasReference,
    window: windowMs / 1000,
  });
  const result = $derived(target ? preview(target, settings) : undefined);
  const over = $derived(result?.rows.some((r) => r.after > r.limit) ?? false);
  const ready = $derived(!!target && !!result && !result.none);
  let error = $state("");
  let showJumps = $state(false);

  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (!ready || !target) return;
    const message = onapply(target, settings);
    if (message === undefined) dialog.close();
    else error = message;
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.tempoLength")}</h2>
  <p class="muted">{t("ui.tempoLengthHelp")}</p>
  <BarTargetRow name="tempo-length-bars" {loopBars} {loopRange} bind:mode={barMode} bind:text={barText} onpick={() => ((jumped = false), (error = ""))} />
  {#if barMode === "all"}<p class="warn small">{t("ui.tempoLengthWholeSong")}</p>{/if}
  <div class="row">
    <span class="name">{t("ui.tempoLengthUnit")}</span>
    <div class="seg">
      {#each UNITS as u (u)}
        <button class:on={unit === u} onclick={() => ((unit = u), remember(KEY + "unit", u))}>{t(UNIT_LABEL[u])}</button>
      {/each}
    </div>
  </div>
  <div class="row">
    <span class="name">{t("ui.tempoLengthGrid")}</span>
    <div class="seg">
      {#each GRIDS as g (g)}
        <button class:on={grid === g} onclick={() => ((grid = g), remember(KEY + "grid", g))}>{g === "auto" ? t("ui.tempoLengthAuto") : `1/${g}`}</button>
      {/each}
    </div>
  </div>
  <div class="row">
    <span class="name">{t("ui.tempoTidyTolerance")}</span>
    <div class="seg">
      {#each TOLERANCES as ms (ms)}
        <button class:on={toleranceMs === ms} onclick={() => ((toleranceMs = ms), remember(KEY + "tolerance", ms))}>{ms}ms</button>
      {/each}
    </div>
  </div>
  <label class="row">
    <input type="checkbox" bind:checked={lockScale} onchange={() => remember(KEY + "lockScale", lockScale)} />
    {t("ui.tempoLengthLockScale")}
  </label>
  <label class="row" title={hasReference ? undefined : t("ui.tempoSnapNoReference")}>
    <input type="checkbox" bind:checked={snap} disabled={!hasReference} />
    {t("ui.tempoLengthSnap")}
  </label>
  {#if snap && hasReference}
    <div class="row">
      <span class="name">{t("ui.tempoSnapWindow")}</span>
      <div class="seg">
        {#each WINDOWS as ms (ms)}
          <button class:on={windowMs === ms} onclick={() => ((windowMs = ms), remember("mmlce.tempoSnap.window", ms))}>±{ms}ms</button>
        {/each}
      </div>
    </div>
  {/if}
  {#if result}
    {#if result.found}
      <p>{t("ui.tempoLengthFound", { found: result.found.found, total: result.found.total })}</p>
    {/if}
    {#if result.none}
      <p class="warn">{result.none}</p>
    {:else}
      <p>
        {t("ui.tempoSnapCount", { before: result.tempos.before, after: result.tempos.after })} · {t("ui.tempoLengthError", { ms: result.errorMs })} ·
        {t("ui.tempoSnapShift", { ms: result.shiftMs })}
      </p>
      {#if result.spans.length > 0}<p class="muted small">{result.spans.join(" · ")}</p>{/if}
      {#if result.meters.length > 0}<p>{t("ui.tempoLengthMeters", { list: result.meters.join(", ") })}</p>{/if}
      {#if result.collapsed > 0}<p class="warn">{t("ui.tempoLengthCollapsed", { n: result.collapsed })}</p>{/if}
      {#if result.merged > 0}<p class:warn={result.mergedMade > 0}>{t(result.mergedMade > 0 ? "ui.tempoLengthMergedMade" : "ui.tempoLengthMerged", { n: result.merged, made: result.mergedMade })}</p>{/if}
      {#if result.rows.length > 0}
        <p class="muted">{t("ui.tempoRampChars", { limit })}</p>
        <ul class="rows">
          {#each result.rows as r (r.trackId)}
            <li class:warn={r.after > r.limit}>{r.name}: {r.before} → {r.after}</li>
          {/each}
        </ul>
      {/if}
      {#if over}<p class="warn">{t("ui.tempoLengthOver")}</p>{/if}
    {/if}
  {/if}
  {#if error}<p class="warn">{error}</p>{/if}
  <details bind:open={showJumps}>
    <summary>{t("ui.tempoLengthJumps", { n: jumps.length })}</summary>
    {#if jumps.length === 0}
      <p class="muted small">{t("ui.tempoLengthJumpsNone")}</p>
    {:else}
      <p class="muted small">{t("ui.tempoLengthJumpsHelp")}</p>
      <ul class="jumps">
        {#each jumps as j, i (j.label)}
          <li><button class="link" onclick={() => ((jumped = true), (error = ""), onjump(i))}>{j.label}</button> t{j.min}-t{j.max}</li>
        {/each}
      </ul>
    {/if}
  </details>
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!ready} onclick={apply}>{t("ui.eventApply")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow: auto;
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
  .rows,
  .jumps {
    margin: 4px 0 0;
    padding-left: 18px;
  }
  .jumps {
    max-height: 10em;
    overflow: auto;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent, inherit);
    text-decoration: underline;
    cursor: pointer;
  }
  details {
    margin-top: 10px;
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
