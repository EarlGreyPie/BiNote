<script lang="ts">
  import { t } from "./i18n.svelte";
  import type { TapReview } from "./tempoSync";

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
    /** 이어 찍을 마디 번호 (기본: 마지막으로 찍은 마디) */
    resumeBar: number;
    /** 이어 찍기로 재생 중이고 아직 안 찍었으면 그 마디 번호 */
    resuming: number | undefined;
    canResume: boolean;
    onresume: (bar: number) => void;
    /** 튀는 탭 표시 기준 (0 끔 · 1 10% · 2 20% · 3 35%) */
    flag: number;
    onflag: (n: number) => void;
    /** 파형 시작점 맞추기 (0 끔 · 1 ±30ms · 2 ±60ms) */
    snap: number;
    /** 원곡 파형이 있어야 맞출 수 있다 */
    snapReady: boolean;
    onsnap: (n: number) => void;
    /** 재생 속도 고르기 (speeds의 번호). 느리게 틀어도 탭은 원래 빠르기의 템포로 들어간다 */
    speed: number;
    speeds: readonly number[];
    onspeed: (n: number) => void;
    /** 닫을 때 넣지 않은 탭 (0 버리기 · 1 물어보기 · 2 넣기) */
    close: number;
    onclosemode: (n: number) => void;
    /** 넣은 뒤 다시 볼 것 */
    review: TapReview | undefined;
    /** 튀는 자리로 가기 (온음표) */
    onjump: (at: number) => void;
  }

  let { playing, count, key, result, merge, onmerge, unit, onunit, ontap, onfinish, onclear, onclose, resumeBar, resuming, canResume, onresume, flag, onflag, snap, snapReady, onsnap, speed, speeds, onspeed, close, onclosemode, review, onjump }: Props = $props();

  const MERGE_LABELS = ["ui.tapMergeOff", "ui.tapMergeWeak", "ui.tapMergeNormal", "ui.tapMergeStrong"] as const;
  const FLAG_PERCENT = [0, 10, 20, 35] as const;
  const SNAP_MS = [0, 30, 60] as const;
  const CLOSE_LABELS = ["ui.tapCloseDiscard", "ui.tapCloseAsk", "ui.tapCloseApply"] as const;

  // 이어 찍을 마디: 넣은 뒤에는 마지막으로 찍은 마디로 따라간다 (직접 고칠 수 있다)
  let bar = $state(1);
  $effect(() => {
    bar = resumeBar;
  });
  function resume() {
    if (Number.isFinite(bar) && bar >= 1) onresume(Math.floor(bar));
  }

  function press(e: PointerEvent) {
    // 손가락·마우스가 닿는 순간을 쓴다 (click은 뗄 때라 늦다)
    e.preventDefault();
    ontap();
  }
</script>

<div class="video-bar tap-bar">
  <strong>{t("ui.tapTempo")}</strong>
  <span class="muted">{resuming !== undefined ? t("ui.tapResumeHint", { bar: resuming, key }) : playing ? t(unit === "bar" ? "ui.tapHintPlaying" : "ui.tapHintPlayingBeat", { key }) : t(unit === "bar" ? "ui.tapHintStopped" : "ui.tapHintStoppedBeat")}</span>
  <button class="tap primary" disabled={!playing} onpointerdown={press} onclick={(e) => e.preventDefault()} tabindex="-1">
    {t("ui.tap")}{key ? ` (${key})` : ""}
  </button>
  <label title={t("ui.tapSpeedHelp")}>
    {t("ui.tapSpeed")}
    <select value={speed} onchange={(e) => {
        onspeed(Number(e.currentTarget.value));
        e.currentTarget.blur();
      }}>
      {#each speeds as rate, n (n)}<option value={n}>{Math.round(rate * 100)}%</option>{/each}
    </select>
  </label>
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
  <span class="resume" title={t("ui.tapResumeHelp")}>
    {t("ui.tapResumeBar")}
    <input type="number" min="1" step="1" aria-label={t("ui.tapResumeBar")} bind:value={bar} onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
          resume();
        }
      }} />
    <button class="small" disabled={!canResume} onpointerdown={(e) => e.preventDefault()} onclick={resume}>{t("ui.tapResume")}</button>
  </span>
  <label title={t("ui.tapFlagHelp")}>
    {t("ui.tapFlag")}
    <select value={flag} onchange={(e) => {
        onflag(Number(e.currentTarget.value));
        e.currentTarget.blur();
      }}>
      {#each [0, 1, 2, 3] as n (n)}<option value={n}>{n === 0 ? t("ui.tapMergeOff") : t("ui.tapFlagPercent", { n: FLAG_PERCENT[n]! })}</option>{/each}
    </select>
  </label>
  <label title={t(snapReady ? "ui.tapSnapHelp" : "ui.tapSnapNoWave")}>
    {t("ui.tapSnap")}
    <select value={snap} disabled={!snapReady} onchange={(e) => {
        onsnap(Number(e.currentTarget.value));
        e.currentTarget.blur();
      }}>
      {#each [0, 1, 2] as n (n)}<option value={n}>{n === 0 ? t("ui.tapMergeOff") : t("ui.tapSnapWindow", { n: SNAP_MS[n]! })}</option>{/each}
    </select>
  </label>
  <label title={t("ui.tapCloseHelp")}>
    {t("ui.tapClose")}
    <select value={close} onchange={(e) => {
        onclosemode(Number(e.currentTarget.value));
        e.currentTarget.blur();
      }}>
      {#each CLOSE_LABELS as label, n (n)}<option value={n}>{t(label)}</option>{/each}
    </select>
  </label>
  {#if result}<span class="muted">{result}</span>{/if}
  <button class="small" onclick={onclose}>{t("ui.close")}</button>
  {#if review}
    <div class="review">
      {#if review.flags.length > 0}
        <span class="warn" title={t("ui.tapFlagHelp")}>{t("ui.tapFlagged", { n: review.flags.length })}</span>
        {#each review.flags as f (f.at)}
          <button class="small" onpointerdown={(e) => e.preventDefault()} onclick={() => onjump(f.at)}>{f.label}</button>
        {/each}
      {/if}
      {#if review.snap}
        {#if review.snap.count > 0}
          <span>{t("ui.tapSnapOffer", { n: review.snap.count, ms: review.snap.ms })}</span>
          <button class="small primary" onpointerdown={(e) => e.preventDefault()} onclick={review.snap.apply}>{t("ui.tapSnapApply")}</button>
        {:else}
          <span class="muted">{t("ui.tapSnapNone")}</span>
        {/if}
      {/if}
    </div>
  {/if}
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
  .resume {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .resume input {
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
