<script lang="ts">
  import type { MessageKey } from "@mmlce/i18n";
  import { i18n, t } from "./i18n.svelte";
  import { guideUrl } from "./links";

  /** 지금 보기(롤/타브)에 맞는 조작 안내를 항목별 줄로 보여 준다 */
  interface Props {
    viewMode: "roll" | "tab";
    onkeymap: () => void;
  }

  let { viewMode, onkeymap }: Props = $props();

  const ROLL: readonly MessageKey[] = [
    "ui.helpRoll1",
    "ui.helpRoll2",
    "ui.helpRoll3",
    "ui.helpRoll4",
    "ui.helpRoll5",
    "ui.helpRoll6",
    "ui.helpRoll7",
    "ui.helpRoll8",
    "ui.helpRoll9",
    "ui.helpRoll10",
    "ui.helpRoll11",
  ];
  const TAB: readonly MessageKey[] = ["ui.helpTab1", "ui.helpTab2", "ui.helpTab3", "ui.helpTab4", "ui.helpTab5"];
  const lines = $derived(viewMode === "roll" ? ROLL : TAB);
</script>

<div class="help-body">
  <strong>{t("ui.helpTitle")} · {viewMode === "roll" ? t("ui.pianoRoll") : t("ui.tabView")}</strong>
  <ul>
    {#each lines as key (key)}<li>{t(key)}</li>{/each}
  </ul>
  <button onclick={onkeymap}>{t("ui.helpKeymap")}</button>
  <a href={guideUrl(i18n.locale)} target="_blank" rel="noopener">{t("ui.helpGuide")}</a>
</div>

<style>
  a {
    color: var(--accent);
  }
  .help-body {
    display: grid;
    gap: 6px;
    font-size: 13px;
  }
  ul {
    margin: 0;
    padding-left: 18px;
  }
  li {
    margin: 2px 0;
  }
  button {
    justify-self: start;
  }
</style>
