<script lang="ts">
  import { t } from "./i18n.svelte";

  /**
   * MIDI 건반 녹음 줄 (실험실). 커서가 있는 마디부터 한 마디 예비박 뒤 곡을 재생하며 친 건반을 모으고,
   * 치는 동안 들어갈 모양을 롤·타브에 보이다가, 멈추면 그대로 넣는다 (실행 취소 한 번).
   * 녹음할 트랙은 고른 트랙이 든 악보 안에서 고른다 (화음은 높은 음부터 이 트랙 순서로).
   * 버튼은 눌렀을 때 초점을 가져가지 않는다 (Space로 재생·정지가 계속 먹게)
   */
  interface Props {
    /** 녹음 중이면 모은 음 수 */
    recording: number | undefined;
    /** 녹음을 시작할 수 있는지 (곡·고른 트랙. 사운드팩은 없어도 된다) */
    canRecord: boolean;
    /** 사운드팩이 없어 곡 소리 없이 메트로놈만 들린다 */
    silent: boolean;
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
    /** 고른 트랙이 든 악보의 트랙들: 녹음할 트랙인지(armed), 잠겼는지 */
    targets: readonly { id: string; label: string; armed: boolean; locked: boolean }[];
    ontarget: (trackId: string) => void;
    /** 녹음할 트랙이 모자라면 트랙을 더할지. canAdd: 더할 수 있는 악보인지 (연주자의 마지막 악보, 한도가 남음) */
    addTracks: boolean;
    canAdd: boolean;
    onaddtracks: (on: boolean) => void;
    /** 덧녹음 / 바꿔 녹음 (친 마디의 녹음할 트랙 음을 비우고 넣기) */
    mode: "overdub" | "replace";
    onmode: (mode: "overdub" | "replace") => void;
    /** 마지막 녹음 결과 */
    result: string;
    onrecord: () => void;
    onstop: () => void;
    onconnect: () => void;
    onclose: () => void;
  }

  let { recording, canRecord, silent, connected, grid, grids, ongrid, speed, speeds, onspeed, metronome, onmetronome, targets, ontarget, addTracks, canAdd, onaddtracks, mode, onmode, result, onrecord, onstop, onconnect, onclose }: Props = $props();

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
    {#if silent}<span class="muted">{t("ui.midiRecordSilent")}</span>{/if}
    <button class="small primary" disabled={!canRecord} onpointerdown={keep} onclick={onrecord}>● {t("ui.midiRecordStart")}</button>
  {/if}
  <span class="targets" title={t("ui.midiRecordTracksHelp")}>
    {t("ui.midiRecordTracks")}
    {#each targets as target (target.id)}
      <button
        class="small arm"
        class:on={target.armed}
        aria-pressed={target.armed}
        disabled={recording !== undefined || target.locked}
        title={target.locked ? t("ui.midiRecordTrackLocked") : undefined}
        onpointerdown={keep}
        onclick={() => ontarget(target.id)}>{target.label}</button>
    {/each}
  </span>
  <label title={canAdd ? t("ui.midiRecordAddTracksHelp") : t("ui.midiRecordCannotAdd")}>
    <input type="checkbox" checked={addTracks && canAdd} disabled={recording !== undefined || !canAdd} onchange={(e) => {
        onaddtracks(e.currentTarget.checked);
        e.currentTarget.blur();
      }} />
    {t("ui.midiRecordAddTracks")}
  </label>
  <label title={t("ui.midiRecordModeHelp")}>
    <select value={mode} disabled={recording !== undefined} onchange={(e) => {
        onmode(e.currentTarget.value === "replace" ? "replace" : "overdub");
        e.currentTarget.blur();
      }}>
      <option value="overdub">{t("ui.midiRecordOverdub")}</option>
      <option value="replace">{t("ui.midiRecordReplace")}</option>
    </select>
  </label>
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
  .targets {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  /* 녹음할 트랙: 켜면 녹음 색 */
  .arm.on {
    border-color: var(--danger, #d03030);
    color: var(--danger, #d03030);
    font-weight: 600;
  }
  .rec {
    color: var(--danger, #d03030);
    font-variant-numeric: tabular-nums;
  }
</style>
