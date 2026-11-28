<script lang="ts">
  import { t } from "./i18n.svelte";
  import { signedMs } from "./referenceSaved";

  /**
   * 원곡을 아직 불러오지 않은 곡의 원곡 줄: 프로젝트에 적힌 원곡 이름과 어긋남을 늘 보인다
   * (마커에 "-767ms"를 적어 둘 까닭이 없게). 그 이름의 원곡을 불러오면 이 값이 그대로 쓰인다
   */
  interface Props {
    saved: { readonly name: string; readonly offsetMs: number };
    onpick: () => void;
    loading: boolean;
  }
  let { saved, onpick, loading }: Props = $props();
</script>

<div class="video-bar">
  <strong>{t("ui.reference")}</strong>
  <span class="muted">{t("ui.referenceSavedNotLoaded", { name: saved.name })}</span>
  <span>{t("ui.referenceSavedOffset", { ms: signedMs(saved.offsetMs) })}</span>
  <button class="small" disabled={loading} onclick={onpick}>{loading ? t("ui.referenceLoading") : t("ui.referenceSavedLoad")}</button>
</div>
