<script lang="ts">
  import { t } from "./i18n.svelte";
  import { clock } from "./time";
  import type { BarDragMode } from "./tempoSync";

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
  }

  let { reference, onoffset, onvolume, onremove, showWave = $bindable(), tapOpen, ontaptempo, barDragMode, onbardrag }: Props = $props();
</script>

<div class="video-bar">
  <strong>{t("ui.reference")}</strong>
  <span class="muted">{reference.name} · {clock(reference.duration)}</span>
  <label>
    {t("ui.referenceOffset")}
    <input type="number" step="10" value={reference.offsetMs} onchange={(e) => onoffset(Number(e.currentTarget.value))} />
  </label>
  <span class="nudge">
    {#each [-100, -10, 10, 100] as d (d)}
      <button class="small" onclick={() => onoffset(reference.offsetMs + d)}>{d > 0 ? `+${d}` : d}</button>
    {/each}
  </span>
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
  <button class="small" class:on={tapOpen} title={t("ui.tapTempoHelp")} onclick={ontaptempo}>{t("ui.tapTempo")}</button>
  <button class="small" onclick={onremove}>{t("ui.videoRemove")}</button>
</div>
