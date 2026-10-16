<script lang="ts">
  import { t } from "./i18n.svelte";
  import type { BackgroundVideo } from "./roll";

  /** 배경 영상 설정 줄 두 개: 비침·어긋남·소리·영상만 재생, 영상 건반을 롤 건반에 맞추기 */
  interface Props {
    video: BackgroundVideo;
    /** 곡 없이 영상만 재생 중 */
    playing: boolean;
    onremove: () => void;
    /** 롤을 영상 건반 범위에 맞춰 옮기고 확대한다 */
    onfitroll: () => void;
  }

  let { video = $bindable(), playing = $bindable(), onremove, onfitroll }: Props = $props();

  function setFit(fit: boolean) {
    video = { ...video, fit };
    if (fit) onfitroll();
  }

  /** 끝 건반을 고르면 롤도 그 범위로 다시 맞춘다 (손잡이로 끌어 소수가 된 값은 가까운 건반으로 보인다) */
  function setEnd(end: "low" | "high", pitch: number) {
    video = { ...video, [end]: pitch };
    onfitroll();
  }

  /** 영상 끝 건반 고르기용 이름 (o4c = C4 = 60) */
  const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const pitchLabel = (p: number) => `${PITCH_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
  const PITCHES = Array.from({ length: 128 }, (_, i) => i);
</script>

<div class="video-bar">
  <label>{t("ui.videoOpacity")} <input type="range" min="0.1" max="1" step="0.05" bind:value={video.opacity} /></label>
  <label>{t("ui.videoOffset")} <input type="number" step="0.05" bind:value={video.offset} /></label>
  <label><input type="checkbox" bind:checked={video.sound} /> {t("ui.videoSound")}</label>
  <button class="small" onclick={() => (playing = !playing)} title={t("ui.videoPlayHint")}>{t(playing ? "ui.videoPause" : "ui.videoPlay")}</button>
  <button class="small" onclick={onremove}>{t("ui.videoRemove")}</button>
</div>
<div class="video-bar">
  <label><input type="checkbox" checked={video.fit} onchange={(e) => setFit(e.currentTarget.checked)} /> {t("ui.videoFit")}</label>
  {#if video.fit}
    <label>
      {t("ui.videoLow")}
      <select value={Math.round(video.low)} onchange={(e) => setEnd("low", Number(e.currentTarget.value))}>
        {#each PITCHES as p (p)}<option value={p}>{pitchLabel(p)}</option>{/each}
      </select>
    </label>
    <label>
      {t("ui.videoHigh")}
      <select value={Math.round(video.high)} onchange={(e) => setEnd("high", Number(e.currentTarget.value))}>
        {#each PITCHES as p (p)}<option value={p} disabled={p <= video.low}>{pitchLabel(p)}</option>{/each}
      </select>
    </label>
    <label title={t("ui.videoHandlesHint")}><input type="checkbox" checked={!!video.handles} onchange={(e) => (video = { ...video, handles: e.currentTarget.checked })} /> {t("ui.videoHandles")}</label>
    <button class="small" onclick={onfitroll} title={t("ui.videoFitRollHint")}>{t("ui.videoFitRoll")}</button>
    <label>{t("ui.videoKeyLine")} <input type="range" min="0" max="1" step="0.005" bind:value={video.keyLine} /></label>
    <label>{t("ui.videoStretch")} <input type="number" min="0.1" max="10" step="0.05" bind:value={video.stretch} /></label>
  {/if}
</div>
