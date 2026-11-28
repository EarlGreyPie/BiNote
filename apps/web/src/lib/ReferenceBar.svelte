<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "./i18n.svelte";
  import { clock } from "./time";
  import type { BarDragMode } from "./tempoSync";
  import { signedMs } from "./referenceSaved";

  /** 원곡 동시재생 설정 줄: 어긋남(ms, 원곡이 늦으면 양수)과 원곡 음량 */
  interface Props {
    reference: { name: string; duration: number; offsetMs: number; volume: number };
    onoffset: (ms: number) => void;
    onvolume: (volume: number) => void;
    onremove: () => void;
    /** 피아노롤에 원곡 파형 띠 보이기 */
    showWave: boolean;
    /** 탭 템포 줄이 열려 있는지와 열고 닫기 */
    tapOpen: boolean;
    ontaptempo: () => void;
    /** 파형 띠 마디선 끌기 방식 */
    barDragMode: BarDragMode;
    onbardrag: (mode: BarDragMode) => void;
    /** 원곡이 영상 파일이면 그 화면을 떠 있는 창으로 띄우기 */
    canVideo?: boolean;
    videoOpen?: boolean;
    onvideo?: () => void;
    /** 원곡 고정: 켜면 파형 띠 끌기·어긋남 칸·단추로 원곡을 옮기지 못한다 */
    locked: boolean;
    onlock: (on: boolean) => void;
    /** 프로젝트에 적힌 다른 이름 원곡의 맞춤값 (지금 원곡과 이름이 달라 자동으로 쓰지 않은 것). 누르면 그 어긋남을 쓴다 */
    saved?: { readonly name: string; readonly offsetMs: number } | undefined;
  }

  let { reference, onoffset, onvolume, onremove, showWave = $bindable(), tapOpen, ontaptempo, barDragMode, onbardrag, canVideo = false, videoOpen = false, onvideo, locked, onlock, saved }: Props = $props();
</script>

<div class="video-bar">
  <strong>{t("ui.reference")}</strong>
  <span class="muted">{reference.name} · {clock(reference.duration)}</span>
  <label>
    {t("ui.referenceOffset")}
    <input type="number" step="10" value={reference.offsetMs} disabled={locked} onchange={(e) => onoffset(Number(e.currentTarget.value))} />
  </label>
  <span class="nudge">
    {#each [-100, -10, 10, 100] as d (d)}
      <button class="small" disabled={locked} onclick={() => onoffset(reference.offsetMs + d)}>{d > 0 ? `+${d}` : d}</button>
    {/each}
  </span>
  {#if saved && saved.offsetMs !== reference.offsetMs}
    <!-- 같은 원곡을 다른 이름(영상 소리, 다른 형식)으로 불러왔을 때 적어 둔 값을 손으로 옮겨 적지 않게 -->
    <button class="small" disabled={locked} title={t("ui.referenceSavedUseHelp", { name: saved.name })} onclick={() => onoffset(saved.offsetMs)}>
      {t("ui.referenceSavedUse", { ms: signedMs(saved.offsetMs) })}
    </button>
  {/if}
  <button class="small" class:on={locked} title={t("ui.referenceLockHelp")} aria-pressed={locked} onclick={() => onlock(!locked)}>
    <Icon name={locked ? "lock" : "lock-open"} />
    {t("ui.referenceLock")}
  </button>
  <label>
    {t("ui.referenceVolume")}
    <input type="range" min="0" max="1.5" step="0.05" value={reference.volume} oninput={(e) => onvolume(Number(e.currentTarget.value))} />
  </label>
  <label title={t("ui.referenceWaveHint")}><input type="checkbox" bind:checked={showWave} /> {t("ui.referenceWave")}</label>
  <label title={t("ui.barDragHelp")}>
    {t("ui.barDrag")}
    <select value={barDragMode} onchange={(e) => {
        onbardrag(e.currentTarget.value === "pair" ? "pair" : "chain");
        // 고른 뒤 초점을 놓아야 T 키가 다시 탭으로 먹는다
        e.currentTarget.blur();
      }}>
      <option value="chain">{t("ui.barDragChain")}</option>
      <option value="pair">{t("ui.barDragPair")}</option>
    </select>
  </label>
  {#if canVideo}
    <button class="small" class:on={videoOpen} title={t("ui.referenceVideoHelp")} onpointerdown={(e) => e.preventDefault()} onclick={onvideo}>{t("ui.referenceVideoShow")}</button>
  {/if}
  <button class="small" class:on={tapOpen} title={t("ui.tapTempoHelp")} onclick={ontaptempo}>{t("ui.tapTempo")}</button>
  <button class="small" onclick={onremove}>{t("ui.videoRemove")}</button>
</div>
