<script lang="ts" module>
  import { parseBarList, type BarRange } from "@mmlce/core";

  /** 바꿀 자리: 곡 전체 · 선택 마디(반복 구간이 걸친 마디) · 반복 구간 그대로(마디선에 맞지 않을 때) · 적은 마디 */
  export type TempoTarget =
    | { readonly kind: "all" }
    | { readonly kind: "loopBars" }
    | { readonly kind: "loop" }
    | { readonly kind: "bars"; readonly bars: readonly BarRange[] };

  export type BarMode = "all" | "loopBars" | "loop" | "typed";

  /** 창을 열 때 고를 칸: 반복 구간이 있으면 그 마디만 (마디선에 맞지 않는 반복 구간은 구간 그대로) */
  export function initialBarMode(loopBars: BarRange | undefined, loopRange: string | undefined): Exclude<BarMode, "typed"> {
    return loopRange ? "loop" : loopBars ? "loopBars" : "all";
  }

  /** 고른 칸과 적은 마디를 바꿀 자리로. 적은 마디를 읽을 수 없으면 undefined */
  export function barTarget(mode: BarMode, text: string): TempoTarget | undefined {
    if (mode === "typed") {
      const bars = parseBarList(text);
      return bars ? { kind: "bars", bars } : undefined;
    }
    return mode === "all" ? { kind: "all" } : { kind: mode };
  }
</script>

<script lang="ts">
  import { t } from "./i18n.svelte";

  /**
   * 마디 줄 (템포 한꺼번에 바꾸기 창, 음 시작을 원곡에 맞추기·템포 정리 창이 같이 쓴다):
   * 모든 마디 · 선택 마디만 · 반복 구간 그대로 · 마디 적기
   */
  interface Props {
    /** 라디오 묶음 이름 (창마다 다르게) */
    name: string;
    /** 반복 구간이 걸친 마디 [첫, 끝]. 반복 구간이 없으면 undefined */
    loopBars?: BarRange | undefined;
    /** 반복 구간이 마디선에 맞지 않으면 그 구간 표시 (마디:박 - 마디:박). 맞으면 undefined */
    loopRange?: string | undefined;
    mode: BarMode;
    text: string;
    /** 칸을 바꾸거나 마디를 적을 때 */
    onpick?: () => void;
  }

  let { name, loopBars, loopRange, mode = $bindable(), text = $bindable(), onpick }: Props = $props();
  const barSpan = (b: BarRange) => (b[0] === b[1] ? `${b[0]}` : `${b[0]}-${b[1]}`);
</script>

<div class="bars-row">
  <span>{t("ui.volumeBars")}</span>
  <label><input type="radio" {name} value="all" bind:group={mode} onchange={onpick} /> {t("ui.volumeBarsAll")}</label>
  <label title={loopBars ? undefined : t("ui.volumeBarsNoLoop")}>
    <input type="radio" {name} value="loopBars" bind:group={mode} onchange={onpick} disabled={!loopBars} />
    {loopBars ? t("ui.volumeBarsLoop", { bars: barSpan(loopBars) }) : t("ui.volumeBarsLoopNone")}
  </label>
  {#if loopRange}
    <label><input type="radio" {name} value="loop" bind:group={mode} onchange={onpick} /> {t("ui.tempoBarsLoopExact", { range: loopRange })}</label>
  {/if}
  <label><input type="radio" {name} value="typed" bind:group={mode} onchange={onpick} /> {t("ui.volumeBarsTyped")}</label>
  {#if mode === "typed"}
    <input class="bars" type="text" inputmode="text" placeholder={t("ui.volumeBarsPlaceholder")} bind:value={text} oninput={onpick} aria-label={t("ui.volumeBarsTyped")} />
  {/if}
</div>
{#if mode === "typed" && text.trim() !== "" && !parseBarList(text)}
  <p class="warn">{t("ui.volumeBarsInvalid")}</p>
{/if}

<style>
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
  .warn {
    color: var(--warn, #c48a00);
    margin: 6px 0 0;
  }
</style>
