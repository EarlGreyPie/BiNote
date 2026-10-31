<script lang="ts">
  import { diagnosticReport } from "./diagnosticReport";
  import { t } from "./i18n.svelte";

  /**
   * [진단 정보 복사] 단추: 판·빌드·브라우저·켠 실험실·최근 오류를 클립보드로.
   * 복사하지 못하면(권한·오래된 브라우저) 그 글을 칸에 보여 직접 고르게 한다
   */
  let copyState = $state<"idle" | "copied" | "failed">("idle");
  let text = $state("");

  async function copy() {
    text = diagnosticReport();
    try {
      await navigator.clipboard.writeText(text);
      copyState = "copied";
    } catch {
      copyState = "failed";
    }
  }
</script>

<span class="diag-copy">
  <button title={t("ui.diagCopyHelp")} onclick={copy}>{t("ui.diagCopy")}</button>
  {#if copyState === "copied"}<span class="muted" role="status">{t("ui.diagCopied")}</span>{/if}
</span>
{#if copyState === "failed"}
  <p class="muted" role="status">{t("ui.diagCopyFailed")}</p>
  <textarea class="diag-text" readonly rows="8" value={text} onfocus={(e) => e.currentTarget.select()}></textarea>
{/if}

<style>
  .diag-copy {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 12px;
  }
  p {
    margin: 6px 0 0;
    font-size: 12px;
  }
  .diag-text {
    display: block;
    box-sizing: border-box;
    width: 100%;
    margin-top: 4px;
    font: 11px/1.4 "D2Coding", monospace;
    -webkit-user-select: text;
    user-select: text;
  }
</style>
