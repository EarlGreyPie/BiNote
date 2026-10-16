<script lang="ts">
  import type { SoundPackInfo } from "@mmlce/audio/browser";
  import { t } from "./i18n.svelte";

  /** 올린 사운드팩 목록 (위쪽 한 줄). 위에 있는 팩이 우선 */
  interface Props {
    packs: readonly SoundPackInfo[];
    /** 불러오는 중인 파일 이름 */
    loading: string;
    /** 이 브라우저에 저장된 팩 이름 */
    stored: ReadonlySet<string>;
    onremove: (id: string) => void;
  }

  let { packs, loading, stored, onremove }: Props = $props();
</script>

{#if packs.length === 0 && !loading}
  <span class="muted">{t("ui.noPacks")}</span>
{/if}
{#each packs as pack, i (pack.id)}
  <span class="pack">
    <span class="muted">{i + 1}.</span>
    <span>{pack.label}</span>
    <span class="muted">{t("ui.packInstruments", { count: pack.instruments.length })}</span>
    {#if stored.has(pack.label)}<span class="muted" title={t("ui.packsStoredHelp")}>{t("ui.packsStored")}</span>{/if}
    <button class="small" onclick={() => onremove(pack.id)}>{t("ui.remove")}</button>
  </span>
{/each}
{#if loading}<span class="muted">{t("ui.loadingPack", { name: loading })}</span>{/if}
