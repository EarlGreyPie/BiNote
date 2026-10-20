<script lang="ts">
  import { METER_UNITS } from "@mmlce/core";
  import type { MessageKey } from "@mmlce/i18n";
  import { t } from "./i18n.svelte";
  import type { EventKind } from "./roll";
  import { eventChanges, type EventChanges } from "./eventChanges";

  /**
   * 템포·박자·마커를 한 자리에서 함께 넣거나 고치는 작은 창 (이벤트 줄 두 번 누르기·길게 누르기, Alt+B·Alt+M).
   * 세 칸마다 체크로 켜고 끈다: 그 자리에 이미 있는 것은 켜진 채로 열리고, 끄면 지운다. 누른 칸(kind)은 켜진 채로 연다
   */
  interface Props {
    /** 누른 칸·글자의 종류 (켜 두고 먼저 입력할 칸) */
    kind: EventKind;
    /** 위치 표시 (마디:박) */
    where: string;
    tempoRange: { readonly min: number; readonly max: number };
    /** 이 자리(또는 앞)의 템포. here = 바로 이 자리에 템포가 있다 */
    tempo: { readonly bpm: number; readonly here: boolean };
    /** 이 자리가 든 마디의 박자. here = 바로 이 자리에 박자가 있다 */
    meter: { readonly beats: number; readonly unit: number; readonly here: boolean };
    /** 고치는 마커 이름. here = 누른 마커를 고친다 (아니면 새 마커) */
    marker: { readonly text: string; readonly here: boolean };
    /** 곡 처음 박자는 지울 수 없다 / 곡 처음 템포를 지우면 t120 */
    atStart: boolean;
    onapply: (changes: EventChanges) => void;
    onclose: () => void;
  }

  let { kind, where, tempoRange, tempo, meter, marker, atStart, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let on = $state({ tempo: tempo.here || kind === "tempo", meter: meter.here || kind === "meter", marker: marker.here || kind === "marker" });
  // svelte-ignore state_referenced_locally
  let bpm = $state(tempo.bpm);
  // svelte-ignore state_referenced_locally
  let text = $state(marker.text);
  // svelte-ignore state_referenced_locally
  let beats = $state(meter.beats);
  // svelte-ignore state_referenced_locally
  let unit = $state(meter.unit);
  $effect(() => {
    dialog.showModal();
  });

  const existing = $derived(tempo.here || meter.here || marker.here);
  /** 곡 처음 박자는 늘 있다 (끌 수 없다) */
  const meterLocked = $derived(atStart && meter.here);
  const changes = $derived(eventChanges({ tempo, meter, marker }, { tempo: on.tempo, meter: on.meter || meterLocked, marker: on.marker }, { bpm, beats, unit, text }));
  const valid = $derived(
    (!on.tempo || (Number.isInteger(bpm) && bpm >= 1)) &&
      (!(on.meter || meterLocked) || (Number.isInteger(beats) && beats >= 1 && beats <= 32)) &&
      (!on.marker || text.trim() !== "") &&
      Object.keys(changes).length > 0,
  );
  const outOfRange = $derived(on.tempo && Number.isInteger(bpm) && (bpm < tempoRange.min || bpm > tempoRange.max));

  function apply() {
    if (!valid) return;
    onapply(changes);
    dialog.close();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      apply();
    }
  }
  const label = (k: EventKind) => t(`ui.event.${k}` as MessageKey);
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{existing ? t("ui.eventEdit") : t("ui.eventAdd")} <span class="muted where">{where}</span></h2>
  <div class="row">
    <label class="kind"><input type="checkbox" bind:checked={on.tempo} />{label("tempo")}</label>
    <label class:off={!on.tempo}>t <input class="num" type="number" min="1" max="999" bind:value={bpm} oninput={() => (on.tempo = true)} {onkeydown} /></label>
    {#if tempo.here && !on.tempo}<span class="muted gone">{t("ui.eventDelete")}</span>{/if}
  </div>
  <div class="row">
    <label class="kind"><input type="checkbox" checked={on.meter || meterLocked} disabled={meterLocked} onchange={(e) => (on.meter = e.currentTarget.checked)} />{label("meter")}</label>
    <span class="meter" class:off={!(on.meter || meterLocked)}>
      <input class="num" type="number" min="1" max="32" bind:value={beats} oninput={() => (on.meter = true)} {onkeydown} />
      /
      <select bind:value={unit} onchange={() => (on.meter = true)}>
        {#each METER_UNITS as u (u)}<option value={u}>{u}</option>{/each}
      </select>
    </span>
    {#if meter.here && !on.meter && !meterLocked}<span class="muted gone">{t("ui.eventDelete")}</span>{/if}
  </div>
  <div class="row">
    <label class="kind"><input type="checkbox" bind:checked={on.marker} />{label("marker")}</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input class="text" class:off={!on.marker} type="text" bind:value={text} placeholder={t("ui.markerPlaceholder")} oninput={() => (on.marker = true)} {onkeydown} autofocus={kind === "marker"} />
    {#if marker.here && !on.marker}<span class="muted gone">{t("ui.eventDelete")}</span>{/if}
  </div>
  {#if outOfRange}<p class="warn">{t("ui.tempoOutOfRange", { min: tempoRange.min, max: tempoRange.max })}</p>{/if}
  {#if tempo.here && atStart && !on.tempo}<p class="muted">{t("ui.tempoStartDelete")}</p>{/if}
  {#if on.meter && !meter.here}<p class="muted">{t("ui.meterHelpAt")}</p>{/if}
  <p class="muted">{t("ui.eventTogetherHelp")}</p>
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!valid} onclick={apply}>{t("ui.eventApply")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(360px, calc(100vw - 32px));
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
  .where {
    font-size: 0.85rem;
    font-weight: normal;
    margin-left: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row + .row {
    margin-top: 6px;
  }
  .row .text {
    flex: 1;
    min-width: 0;
  }
  .kind {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    width: 5.5em;
    flex: none;
  }
  .meter {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  /* 체크를 끈 칸은 흐리게 (입력하면 다시 켜진다) */
  .off {
    opacity: 0.45;
  }
  .gone {
    margin: 0;
    color: var(--error, #d33);
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
