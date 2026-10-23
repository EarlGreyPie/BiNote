<script lang="ts">
  import { t } from "./i18n.svelte";
  import type { TapReview } from "./tempoSync";

  /**
   * 영상 마디 넘김 줄 (실험실). 배경 영상을 한 번 재생하며 지금 마디에 칠한 상자가 옮겨지는 순간을 찾고,
   * 그 시각을 마디 단위 탭으로 넣는다. 합치기·튀는 탭·파형 맞추기는 탭 템포 설정을 따른다 (실행 취소 한 번)
   */
  interface Props {
    /** 배경 영상이 열려 있는지 */
    hasVideo: boolean;
    /** 찾는 중이면 읽은 비율 (0~1) */
    scanning: number | undefined;
    /** 찾은 마디 시작 (영상 초) */
    found: { times: readonly number[]; complete: boolean } | undefined;
    /** 첫 변화가 몇 마디 시작인지 */
    first: number;
    /** 찾는 재생 속도 (speeds의 번호) */
    speed: number;
    speeds: readonly number[];
    onspeed: (n: number) => void;
    /** 마지막으로 넣은 결과 */
    result: string;
    review: TapReview | undefined;
    onscan: () => void;
    onstop: () => void;
    onapply: (first: number) => void;
    /** 튀는 자리로 가기 (온음표) */
    onjump: (at: number) => void;
    onclose: () => void;
  }

  let { hasVideo, scanning, found, first = $bindable(), speed, speeds, onspeed, result, review, onscan, onstop, onapply, onjump, onclose }: Props = $props();

  const seconds = (s: number) => s.toFixed(1);
</script>

<div class="video-bar video-bars-bar">
  <strong>{t("ui.labVideoBars")}</strong>
  {#if !hasVideo}
    <span class="muted">{t("ui.videoBarsNoVideo")}</span>
  {:else if scanning !== undefined}
    <span>{t("ui.videoBarsScanning", { n: Math.round(scanning * 100) })}</span>
    <button class="small" onclick={onstop}>{t("ui.videoBarsStop")}</button>
  {:else}
    <span class="muted">{t("ui.videoBarsHint")}</span>
    <button class="small primary" onclick={onscan}>{t(found ? "ui.videoBarsRescan" : "ui.videoBarsScan")}</button>
  {/if}
  <label title={t("ui.videoBarsSpeedHelp")}>
    {t("ui.tapSpeed")}
    <select value={speed} disabled={scanning !== undefined} onchange={(e) => onspeed(Number(e.currentTarget.value))}>
      {#each speeds as rate, n (n)}<option value={n}>{Math.round(rate * 100)}%</option>{/each}
    </select>
  </label>
  {#if found && scanning === undefined}
    {#if found.times.length < 2}
      <span class="warn">{t("ui.videoBarsNone")}</span>
    {:else}
      <span>{t(found.complete ? "ui.videoBarsFound" : "ui.videoBarsFoundPart", { n: found.times.length, from: seconds(found.times[0]!), to: seconds(found.times.at(-1)!) })}</span>
      <label title={t("ui.videoBarsFirstHelp")}>
        {t("ui.videoBarsFirst")}
        <input type="number" min="1" step="1" bind:value={first} />
      </label>
      <button class="small primary" disabled={!(first >= 1)} onclick={() => onapply(first)}>{t("ui.videoBarsApply")}</button>
    {/if}
  {/if}
  {#if result}<span class="muted">{result}</span>{/if}
  <button class="small" onclick={onclose}>{t("ui.close")}</button>
  {#if review}
    <div class="review">
      {#if review.flags.length > 0}
        <span class="warn" title={t("ui.tapFlagHelp")}>{t("ui.tapFlagged", { n: review.flags.length })}</span>
        {#each review.flags as f (f.at)}
          <button class="small" onclick={() => onjump(f.at)}>{f.label}</button>
        {/each}
      {/if}
      {#if review.snap}
        {#if review.snap.count > 0}
          <span>{t("ui.tapSnapOffer", { n: review.snap.count, ms: review.snap.ms })}</span>
          <button class="small primary" onclick={review.snap.apply}>{t("ui.tapSnapApply")}</button>
        {:else}
          <span class="muted">{t("ui.tapSnapNone")}</span>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  input[type="number"] {
    width: 4.5em;
  }
  .review {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .warn {
    color: var(--warn, #c77700);
  }
</style>
