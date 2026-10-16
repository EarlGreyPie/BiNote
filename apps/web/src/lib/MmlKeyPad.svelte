<script lang="ts">
  import { t } from "./i18n.svelte";
  import Icon from "./Icon.svelte";
  import { mmlPad } from "./mmlPad.svelte";

  /** 화면 아래 MML 키판. 누르면 마지막으로 누른 트랙 편집기의 커서 자리에 넣는다 */
  const ROWS: readonly (readonly string[])[] = [
    ["c", "d", "e", "f", "g", "a", "b", "r", "+", "-", "&", "."],
    ["o", "<", ">", "l", "t", "v", "n", "1", "2", "4", "8", "16"],
    ["0", "3", "5", "6", "7", "9", ",", " "],
  ];

  // 버튼을 눌러도 편집기 포커스(커서)가 그대로 있게 한다
  const keep = (e: PointerEvent) => e.preventDefault();
</script>

<div class="mml-pad" role="toolbar" aria-label={t("ui.mmlPad")}>
  {#each ROWS as row, r (r)}
    <div class="row">
      {#each row as k (k)}
        <button onpointerdown={keep} onclick={() => mmlPad.insert(k)}>{k === " " ? "␣" : k}</button>
      {/each}
      {#if r === 2}
        <button onpointerdown={keep} onclick={() => mmlPad.key("left")} aria-label={t("ui.mmlPadLeft")}><Icon name="chevron-left" /></button>
        <button onpointerdown={keep} onclick={() => mmlPad.key("right")} aria-label={t("ui.mmlPadRight")}><Icon name="chevron-right" /></button>
        <button onpointerdown={keep} onclick={() => mmlPad.key("backspace")} aria-label={t("ui.mmlPadBackspace")}><Icon name="backspace" /></button>
        <button class="close" onclick={() => (mmlPad.enabled = false)}>{t("ui.close")}</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  /* 트랙 패널 맨 아래에 붙는다 (패널이 세로 flex, 키판은 줄지 않는다) */
  .mml-pad {
    flex: none;
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
    background: var(--panel);
    border-top: 1px solid var(--line);
    display: grid;
    gap: 4px;
    -webkit-user-select: none;
    user-select: none;
  }
  .row {
    display: flex;
    gap: 4px;
  }
  /* 좁은 패널(옆 배치 440px)에서도 한 줄에 다 들어가게 글자 폭이 아니라 칸을 똑같이 나눈다 */
  button {
    flex: 1 1 0;
    min-width: 0;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    font-family: "D2Coding", ui-monospace, monospace;
    font-size: 16px;
  }
  .close {
    flex: 1.5 1 0;
    white-space: nowrap;
    font-family: inherit;
    font-size: 13px;
  }
</style>
