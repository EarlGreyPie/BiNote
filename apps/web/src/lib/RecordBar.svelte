<script lang="ts">
  import { t } from "./i18n.svelte";

  /**
   * MIDI 건반 녹음 줄 (실험실). 커서가 있는 마디부터 한 마디 예비박 뒤 곡을 재생하며 친 건반을 모으고,
   * 멈추면 고른 격자에 맞춰 고른 트랙부터 넣는다 (실행 취소 한 번).
   * 버튼은 눌렀을 때 초점을 가져가지 않는다 (Space로 재생·정지가 계속 먹게)
   */
  interface Props {
    /** 녹음 중이면 모은 음 수 */
    recording: number | undefined;
    /** 녹음을 시작할 수 있는지 (곡·사운드팩·고른 트랙) */
    canRecord: boolean;
    /** MIDI 건반이 연결됐는지 */
    connected: boolean;
    /** 격자 (온음표의 1/n) */
    grid: number;
    grids: readonly number[];
    ongrid: (n: number) => void;
    /** 재생 속도 (speeds의 번호). 느리게 쳐도 원래 빠르기의 자리에 들어간다 */
    speed: number;
    speeds: readonly number[];
    onspeed: (n: number) => void;
    metronome: boolean;
    onmetronome: (on: boolean) => void;
    /** 마지막 녹음 결과 */
    result: string;
    onrecord: () => void;
    onstop: () => void;
    onconnect: () => void;
    onclose: () => void;
  }

  let { recording, canRecord, connected, grid, grids, ongrid, speed, speeds, onspeed, metronome, onmetronome, result, onrecord, onstop, onconnect, onclose }: Props = $props();

  const gridLabel = (n: number) => (n % 3 === 0 ? t("ui.midiRecordGridTuplet", { n: (n / 3) * 2 }) : t("ui.midiRecordGridNote", { n }));
  const keep = (e: Event) => e.preventDefault();
</script>

<div class="video-bar record-bar">
  <strong>{t("ui.labMidiRecord")}</strong>
  {#if !connected}
    <span class="muted">{t("ui.midiRecordNotConnected")}</span>
    <button class="small primary" onpointerdown={keep} onclick={onconnect}>{t("ui.midiKeysConnect")}</button>
  {:else if recording !== undefined}
    <span class="rec">● {t("ui.midiRecordCount", { n: recording })}</span>
    <button class="small primary" onpointerdown={keep} onclick={onstop}>{t("ui.midiRecordStop")}</button>
  {:else}
    <span class="muted">{t("ui.midiRecordHint")}</span>
    <button class="small primary" disabled={!canRecord} onpointerdown={keep} onclick={onrecord}>● {t("ui.midiRecordStart")}</button>
  {/if}
  <label title={t("ui.midiRecordGridHelp")}>
    {t("ui.midiRecordGrid")}
    <select value={grid} disabled={recording !== undefined} onchange={(e) => {
        ongrid(Number(e.currentTarget.value));
        e.currentTarget.blur();
      }}>
      {#each grids as n (n)}<option value={n}>{gridLabel(n)}</option>{/each}
    </select>
  </label>
  <label title={t("ui.midiRecordSpeedHelp")}>
    {t("ui.tapSpeed")}
    <select value={speed} disabled={recording !== undefined} onchange={(e) => {
        onspeed(Number(e.currentTarget.value));
        e.currentTarget.blur();
      }}>
      {#each speeds as rate, n (n)}<option value={n}>{Math.round(rate * 100)}%</option>{/each}
    </select>
  </label>
  <label>
    <input type="checkbox" checked={metronome} disabled={recording !== undefined} onchange={(e) => {
        onmetronome(e.currentTarget.checked);
        e.currentTarget.blur();
      }} />
    {t("ui.midiRecordMetronome")}
  </label>
  {#if result}<span class="muted">{result}</span>{/if}
  <button class="small" onclick={onclose}>{t("ui.close")}</button>
</div>

<style>
  .rec {
    color: var(--danger, #d03030);
    font-variant-numeric: tabular-nums;
  }
</style>
