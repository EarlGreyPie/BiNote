<script lang="ts">
  import { t } from "./i18n.svelte";

  /**
   * 탭 템포 줄. 원곡(또는 영상)을 들으며 마디 첫 박마다 T 키나 [탭]을 누르고, 멈추면 마디마다 템포가 들어간다.
   * 버튼은 눌렀을 때 초점을 가져가지 않는다 (그래야 T 키가 계속 먹는다)
   */
  interface Props {
    playing: boolean;
    count: number;
    /** 키 표기 (없으면 숨김) */
    key: string;
    /** 마지막으로 넣은 결과 */
    result: string;
    /** 비슷하면 합치기 세기 (0 끔 · 1 약하게 · 2 보통 · 3 강하게) */
    merge: number;
    /** 탭 단위 */
    unit: "bar" | "beat";
    onunit: (unit: "bar" | "beat") => void;
    onmerge: (n: number) => void;
    ontap: () => void;
    onfinish: () => void;
    onclear: () => void;
    onclose: () => void;
  }

  let { playing, count, key, result, merge, onmerge, unit, onunit, ontap, onfinish, onclear, onclose }: Props = $props();

  const MERGE_LABELS = ["ui.tapMergeOff", "ui.tapMergeWeak", "ui.tapMergeNormal", "ui.tapMergeStrong"] as const;

  function press(e: PointerEvent) {
    // 손가락·마우스가 닿는 순간을 쓴다 (click은 뗄 때라 늦다)
    e.preventDefault();
    ontap();
  }
</script>

<div class="video-bar tap-bar">
  <strong>{t("ui.tapTempo")}</strong>
  <span class="muted">{playing ? t(unit === "bar" ? "ui.tapHintPlaying" : "ui.tapHintPlayingBeat", { key }) : t(unit === "bar" ? "ui.tapHintStopped" : "ui.tapHintStoppedBeat")}</span>
  <button class="tap primary" disabled={!playing} onpointerdown={press} onclick={(e) => e.preventDefault()} tabindex="-1">
    {t("ui.tap")}{key ? ` (${key})` : ""}
  </button>
  <span class="count">{t("ui.tapCount", { n: count })}</span>
  <button class="small" disabled={count < 2} onpointerdown={(e) => e.preventDefault()} onclick={onfinish}>{t("ui.tapFinish")}</button>
  <button class="small" disabled={count === 0} onpointerdown={(e) => e.preventDefault()} onclick={onclear}>{t("ui.tapClear")}</button>
  <span class="seg">
    <button class:on={unit === "bar"} onpointerdown={(e) => e.preventDefault()} onclick={() => onunit("bar")}>{t("ui.tapUnitBar")}</button>
    <button class:on={unit === "beat"} onpointerdown={(e) => e.preventDefault()} onclick={() => onunit("beat")}>{t("ui.tapUnitBeat")}</button>
  </span>
  <label title={t("ui.tapMergeHelp")}>
    {t("ui.tapMerge")}
    <select value={merge} onchange={(e) => {
        onmerge(Number(e.currentTarget.value));
        // 고른 뒤 초점을 놓아야 T 키가 다시 탭으로 먹는다
        e.currentTarget.blur();
      }}>
      {#each [0, 1, 2, 3] as n (n)}<option value={n}>{t(MERGE_LABELS[n]!)}</option>{/each}
    </select>
  </label>
  {#if result}<span class="muted">{result}</span>{/if}
  <button class="small" onclick={onclose}>{t("ui.close")}</button>
</div>

<style>
  .tap {
    min-width: 88px;
    min-height: 36px;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  .count {
    font-variant-numeric: tabular-nums;
  }
</style>
