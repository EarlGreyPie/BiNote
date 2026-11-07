<script lang="ts" module>
  import type { BarRange } from "@mmlce/core";

  /** 바꿀 자리: 곡 전체 · 선택 마디(반복 구간이 걸친 마디) · 반복 구간 그대로(마디선에 맞지 않을 때) · 적은 마디 */
  export type TempoTarget =
    | { readonly kind: "all" }
    | { readonly kind: "loopBars" }
    | { readonly kind: "loop" }
    | { readonly kind: "bars"; readonly bars: readonly BarRange[] };
</script>

<script lang="ts">
  import { parseBarList } from "@mmlce/core";
  import { changedBpm, type TempoChange } from "@mmlce/mml";
  import { t } from "./i18n.svelte";

  /**
   * 템포 한꺼번에 바꾸기 창 (곡 메뉴): 곡 전체나 선택 마디·적은 마디의 템포를 한 값으로 맞추거나 ±BPM·%로 바꾼다
   */
  interface Props {
    /** 반복 구간이 걸친 마디 [첫, 끝]. 반복 구간이 없으면 undefined */
    loopBars?: BarRange | undefined;
    /** 반복 구간이 마디선에 맞지 않으면 그 구간 표시 (마디:박 ~ 마디:박). 맞으면 undefined */
    loopRange?: string | undefined;
    /** 바뀔 템포 (구간 처음 자리 템포 포함). 고른 자리가 곡 밖이면 빈 목록 */
    bpmsOf: (target: TempoTarget) => readonly number[];
    tempoRange: { readonly min: number; readonly max: number };
    /**
     * 바꾼다. keepTime이면 음 길이·박자표를 템포와 같은 배율로 함께 맞춰 실제 시간을 지킨다.
     * 바꾸지 못했으면 그 까닭을 돌려주고 창은 열어 둔다
     */
    onapply: (change: TempoChange, keepTime: boolean, target: TempoTarget) => string | undefined;
    onclose: () => void;
  }

  let { loopBars, loopRange, bpmsOf, tempoRange, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  type Mode = TempoChange["mode"];
  const MODES: Mode[] = ["set", "add", "scale"];
  const LABEL = { set: "ui.tempoChangeSet", add: "ui.tempoChangeAdd", scale: "ui.tempoChangeScale" } as const;
  // 마디: 반복 구간이 있으면 처음엔 그 마디만 (마디선에 맞지 않는 반복 구간은 전처럼 구간 그대로)
  // svelte-ignore state_referenced_locally
  const initial = loopRange ? ({ kind: "loop" } as const) : loopBars ? ({ kind: "loopBars" } as const) : ({ kind: "all" } as const);
  let barMode = $state<"all" | "loopBars" | "loop" | "typed">(initial.kind);
  let barText = $state("");
  const typedBars = $derived(parseBarList(barText));
  const target = $derived<TempoTarget | undefined>(
    barMode === "typed" ? (typedBars ? { kind: "bars", bars: typedBars } : undefined) : barMode === "all" ? { kind: "all" } : { kind: barMode },
  );
  const bpms = $derived(target ? bpmsOf(target) : []);
  const barSpan = (b: BarRange) => (b[0] === b[1] ? `${b[0]}` : `${b[0]}-${b[1]}`);
  // svelte-ignore state_referenced_locally
  const first = bpmsOf(initial)[0] ?? 120;
  let mode = $state<Mode>("set");
  let value = $state(first);
  /** 실제 시간 지키기: 음 길이도 함께 맞춘다 (창을 열 때마다 끔) */
  let keepTime = $state(false);
  let failed = $state("");
  $effect(() => {
    dialog.showModal();
  });

  function pick(m: Mode) {
    mode = m;
    failed = "";
    value = m === "set" ? first : m === "add" ? 0 : 100;
  }

  const valid = $derived(Number.isFinite(value) && (mode === "add" ? Number.isInteger(value) : mode === "set" ? Number.isInteger(value) && value >= 1 : value > 0));
  const after = $derived(valid ? bpms.map((b) => changedBpm(b, { mode, value })) : []);
  const out = $derived(after.filter((b) => b < tempoRange.min || b > tempoRange.max).length);
  const changes = $derived(after.some((b, k) => b !== bpms[k]));

  function pickBars() {
    failed = "";
  }

  function apply() {
    if (!valid || !changes || !target) return;
    const why = onapply({ mode, value }, keepTime, target);
    if (why) {
      failed = why;
      return;
    }
    dialog.close();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      apply();
    }
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.tempoChange")}</h2>
  <div class="bars-row">
    <span>{t("ui.volumeBars")}</span>
    <label><input type="radio" name="tempo-bars" value="all" bind:group={barMode} onchange={pickBars} /> {t("ui.volumeBarsAll")}</label>
    <label title={loopBars ? undefined : t("ui.volumeBarsNoLoop")}>
      <input type="radio" name="tempo-bars" value="loopBars" bind:group={barMode} onchange={pickBars} disabled={!loopBars} />
      {loopBars ? t("ui.volumeBarsLoop", { bars: barSpan(loopBars) }) : t("ui.volumeBarsLoopNone")}
    </label>
    {#if loopRange}
      <label><input type="radio" name="tempo-bars" value="loop" bind:group={barMode} onchange={pickBars} /> {t("ui.tempoBarsLoopExact", { range: loopRange })}</label>
    {/if}
    <label><input type="radio" name="tempo-bars" value="typed" bind:group={barMode} onchange={pickBars} /> {t("ui.volumeBarsTyped")}</label>
    {#if barMode === "typed"}
      <input class="bars" type="text" inputmode="text" placeholder={t("ui.volumeBarsPlaceholder")} bind:value={barText} oninput={pickBars} aria-label={t("ui.volumeBarsTyped")} />
    {/if}
  </div>
  {#if barMode === "typed" && barText.trim() !== "" && !typedBars}
    <p class="warn">{t("ui.volumeBarsInvalid")}</p>
  {:else if target && target.kind !== "all" && bpms.length === 0}
    <p class="warn">{t("ui.tempoChangeNoBars")}</p>
  {/if}
  <div class="seg">
    {#each MODES as m (m)}
      <button class:on={mode === m} onclick={() => pick(m)}>{t(LABEL[m])}</button>
    {/each}
  </div>
  <div class="row">
    {#if mode === "set"}t{/if}
    <!-- svelte-ignore a11y_autofocus -->
    <input class="num" type="number" step="1" min={mode === "add" ? -998 : 1} max={mode === "scale" ? 1000 : 999} bind:value oninput={() => (failed = "")} {onkeydown} autofocus />
    {#if mode === "scale"}%{/if}
  </div>
  {#if valid && bpms.length > 0}
    <p class="muted">
      {t("ui.tempoChangePreview", { n: bpms.length, min: Math.min(...bpms), max: Math.max(...bpms), toMin: Math.min(...after), toMax: Math.max(...after) })}
    </p>
  {/if}
  {#if out > 0}<p class="warn">{t("ui.tempoChangeOut", { n: out, min: tempoRange.min, max: tempoRange.max })}</p>{/if}
  <label class="keep" title={t("ui.tempoChangeKeepTimeHelp")}>
    <input type="checkbox" bind:checked={keepTime} onchange={() => (failed = "")} />
    {t("ui.tempoChangeKeepTime")}
  </label>
  {#if keepTime}<p class="muted">{t("ui.tempoChangeKeepTimeHelp")}</p>{/if}
  {#if barMode !== "all"}<p class="muted">{t(keepTime ? "ui.tempoChangeKeepTimeEdge" : "ui.tempoChangeEdge")}</p>{/if}
  {#if failed}<p class="warn">{failed}</p>{/if}
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!valid || !changes || !target} onclick={apply}>{t("ui.eventApply")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(380px, calc(100vw - 32px));
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
  .bars-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    margin-bottom: 8px;
  }
  .bars-row .bars {
    width: 9em;
  }
  .seg {
    display: inline-flex;
    margin-bottom: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  /* 세 자리 템포와 위아래 화살표가 다 보이게 넉넉히 */
  .row .num {
    width: 6em;
    font-size: 1.1rem;
    padding: 4px 8px;
  }
  .warn {
    color: var(--warn, #c48a00);
    margin: 6px 0 0;
  }
  .muted {
    margin: 6px 0 0;
  }
  .keep {
    display: flex;
    align-items: center;
    gap: 6px;
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
