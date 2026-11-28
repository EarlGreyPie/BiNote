<script lang="ts">
  import type { GameProfile } from "@mmlce/core";
  import { slotLimitsDiffer, type SlotSwap } from "@mmlce/mml";
  import type { MessageKey } from "@mmlce/i18n";
  import { t } from "./i18n.svelte";

  /**
   * 자리 맞추기 켜기·끄기와 바뀐 자리 (화음 분산·병합 창). 자리마다 글자 수 한도가 다른 게임(PC)에서만 보인다
   */
  interface Props {
    profile: GameProfile;
    swaps: readonly SlotSwap[] | undefined;
    name: (trackId: string) => string;
    /** 켜기·끄기 (없으면 상자 없이 바뀐 자리만) */
    on?: boolean;
  }
  let { profile, swaps, name, on = $bindable() }: Props = $props();

  const slotName = (k: number) => (k <= 2 ? t(`ui.slot.${k}` as MessageKey) : String(k + 1));
  /** 자리를 옮긴 트랙마다 한 줄 */
  const lines = $derived(
    (swaps ?? []).flatMap((s) =>
      s.after.flatMap((id, k) => {
        const from = s.before.indexOf(id);
        return from === k ? [] : [t("ui.slotSwap", { name: name(id), from: slotName(from), to: slotName(k) })];
      }),
    ),
  );
</script>

{#if slotLimitsDiffer(profile)}
  {#if on !== undefined}<label class="slot-fit" title={t("ui.slotFitHelp")}><input type="checkbox" bind:checked={on} /> {t("ui.slotFit")}</label>{/if}
  {#if on !== false && lines.length > 0}
    <ul class="slot-swaps muted small">
      {#each lines as line, i (i)}<li>{line}</li>{/each}
    </ul>
  {/if}
{/if}

<style>
  .slot-fit {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .slot-swaps {
    margin: 4px 0;
    padding-left: 18px;
  }
</style>
