<script lang="ts">
  import { t } from "./i18n.svelte";
  import { HIGHEST_PITCH, LOWEST_PITCH, MAX_STRINGS, shiftStrings, stringName, TUNINGS, type TuningName } from "./tunings";

  interface Props {
    /** 줄 높이 (1번 줄부터 개방현 MIDI 번호) */
    strings: readonly number[];
  }

  let { strings = $bindable() }: Props = $props();

  /** 음 고르기 칸 (검은건반은 두 이름을 다 보인다) */
  const NOTES = ["C", "C♯/D♭", "D", "D♯/E♭", "E", "F", "F♯/G♭", "G", "G♯/A♭", "A", "A♯/B♭", "B"];
  /** 옥타브 (o4c = 60 = C4). MML로 쓸 수 있는 높이(o0c~o9g)만 고르고, 넘는 칸은 막아 둔다 */
  const OCTAVES = Array.from({ length: Math.floor(HIGHEST_PITCH / 12) - Math.floor(LOWEST_PITCH / 12) + 1 }, (_, i) => Math.floor(LOWEST_PITCH / 12) - 1 + i);
  const fits = (pitch: number) => pitch >= LOWEST_PITCH && pitch <= HIGHEST_PITCH;
  /** 예전 파일의 범위 밖 줄(개방현 MIDI 0 등)도 지금 옥타브가 보이게, 그 옥타브를 막힌 칸으로 덧붙인다 */
  const octavesFor = (pitch: number) => {
    const own = Math.floor(pitch / 12) - 1;
    return OCTAVES.includes(own) ? OCTAVES : [...OCTAVES, own].sort((a, b) => a - b);
  };
  let preset = $state<TuningName>("standard");

  const down = $derived(shiftStrings(strings, -1));
  const up = $derived(shiftStrings(strings, 1));

  function set(i: number, pitch: number) {
    strings = strings.map((p, j) => (j === i ? Math.max(LOWEST_PITCH, Math.min(HIGHEST_PITCH, pitch)) : p));
  }

  function addString() {
    // 맨 아래 줄보다 완전4도 아래 (기타 줄 간격). o0c 아래로는 가지 않는다
    const low = strings[strings.length - 1] ?? 52;
    strings = [...strings, Math.max(LOWEST_PITCH, low - 5)];
  }
</script>

<div class="row">
  <label>
    <select aria-label={t("ui.tuning")} bind:value={preset}>
      {#each Object.entries(TUNINGS) as [name, info] (name)}<option value={name}>{t(info.key)}</option>{/each}
    </select>
  </label>
  <button onclick={() => (strings = [...TUNINGS[preset].strings])}>{t("ui.tuningLoad")}</button>
</div>
<div class="row">
  <button disabled={!down} onclick={() => down && (strings = down)}>{t("ui.tuningDown")}</button>
  <button disabled={!up} onclick={() => up && (strings = up)}>{t("ui.tuningUp")}</button>
</div>
<table>
  <tbody>
    {#each strings as pitch, i (i)}
      <tr>
        <th>{t("ui.tuningString", { n: i + 1 })}</th>
        <td>
          <select aria-label={t("ui.tuningString", { n: i + 1 })} value={pitch % 12} onchange={(e) => set(i, pitch - (pitch % 12) + Number(e.currentTarget.value))}>
            {#each NOTES as name, pc (pc)}<option value={pc} disabled={!fits(pitch - (pitch % 12) + pc)}>{name}</option>{/each}
          </select>
        </td>
        <td>
          <select aria-label={t("ui.tuningOctave")} value={Math.floor(pitch / 12) - 1} onchange={(e) => set(i, (Number(e.currentTarget.value) + 1) * 12 + (pitch % 12))}>
            {#each octavesFor(pitch) as o (o)}<option value={o} disabled={!fits((o + 1) * 12 + (pitch % 12))}>{o}</option>{/each}
          </select>
        </td>
        <td class="muted">{stringName(pitch)}</td>
      </tr>
    {/each}
  </tbody>
</table>
<div class="row">
  <button disabled={strings.length >= MAX_STRINGS} onclick={addString}>{t("ui.tuningAddString")}</button>
  <button disabled={strings.length <= 1} onclick={() => (strings = strings.slice(0, -1))}>{t("ui.tuningRemoveString")}</button>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 8px 12px;
    flex-wrap: wrap;
    margin: 8px 0;
  }
  select {
    max-width: 100%;
  }
  table {
    border-collapse: collapse;
    margin: 4px 0;
  }
  th {
    text-align: left;
    font-weight: normal;
    padding-right: 12px;
    white-space: nowrap;
  }
  td {
    padding: 2px 6px 2px 0;
  }
  .muted {
    color: var(--muted);
  }
</style>
