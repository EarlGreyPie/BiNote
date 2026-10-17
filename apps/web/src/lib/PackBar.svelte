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
    /** 한 칸 위(-1)·아래(+1)로 옮겨 우선순위 바꾸기 */
    onmove: (id: string, step: -1 | 1) => void;
  }

  let { packs, loading, stored, onremove, onmove }: Props = $props();
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
    {#if packs.length > 1}
      <button class="small" disabled={i === 0} aria-label={t("ui.packUp")} title={t("ui.packUp")} onclick={() => onmove(pack.id, -1)}>▲</button>
      <button class="small" disabled={i === packs.length - 1} aria-label={t("ui.packDown")} title={t("ui.packDown")} onclick={() => onmove(pack.id, 1)}>▼</button>
    {/if}
    <button class="small" onclick={() => onremove(pack.id)}>{t("ui.remove")}</button>
  </span>
{/each}
{#if loading}<span class="muted">{t("ui.loadingPack", { name: loading })}</span>{/if}
