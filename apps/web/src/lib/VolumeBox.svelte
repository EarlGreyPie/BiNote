<script lang="ts">
  import { t } from "./i18n.svelte";
  import Icon from "./Icon.svelte";

  /**
   * 입력 볼륨 칸. 고른 음이 있으면 그 음들의 v를 보여 주고 바꾸면 한꺼번에 바꾼다.
   * 고른 음이 없으면 새로 넣을 음의 v (이어받기면 앞 음 v를 따른다)
   */
  interface Props {
    /** 새 음 볼륨. undefined = 이어받기 */
    value: number | undefined;
    min: number;
    max: number;
    /** 고른 음들의 v (서로 다르면 null). 고른 음이 없으면 undefined */
    selected?: number | null | undefined;
    onselected?: (vol: number) => void;
    /** 크게 (터치용) */
    large?: boolean;
  }

  let { value = $bindable(), min, max, selected, onselected, large = false }: Props = $props();

  const editingSelection = $derived(selected !== undefined);
  const shown = $derived(editingSelection ? selected : value);

  function set(next: number | undefined) {
    if (editingSelection) {
      if (next !== undefined) onselected?.(Math.min(max, Math.max(min, next)));
    } else value = next === undefined ? undefined : Math.min(max, Math.max(min, next));
  }

  function step(by: number) {
    const base = shown ?? Math.round((min + max) / 2);
    set(base + by);
  }
</script>

<span class="vol" class:large title={editingSelection ? t("ui.volumeSelectedHelp") : t("ui.volumeInputHelp")}>
  <span class="muted">{editingSelection ? t("ui.volumeSelected") : t("ui.volumeInput")}</span>
  <button class="small" onclick={() => step(-1)} aria-label="v −"><Icon name="minus" size={12} /></button>
  <select
    value={shown === undefined ? "" : shown === null ? "mixed" : String(shown)}
    onchange={(e) => {
      const v = e.currentTarget.value;
      if (v === "") set(undefined);
      else if (v !== "mixed") set(Number(v));
    }}
  >
    {#if !editingSelection}<option value="">{t("ui.volumeInherit")}</option>{/if}
    {#if shown === null}<option value="mixed">{t("ui.volumeMixed")}</option>{/if}
    {#each Array.from({ length: max - min + 1 }, (_, i) => min + i) as v (v)}<option value={String(v)}>v{v}</option>{/each}
  </select>
  <button class="small" onclick={() => step(1)} aria-label="v +"><Icon name="plus" size={12} /></button>
</span>

<style>
  .vol {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .large button {
    min-width: 40px;
    min-height: 40px;
  }
  .large select {
    min-height: 40px;
  }
</style>
