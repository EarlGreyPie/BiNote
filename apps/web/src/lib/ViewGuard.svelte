<script lang="ts">
  import type { Snippet } from "svelte";
  import DiagCopy from "./DiagCopy.svelte";
  import { errorText } from "./diagnostics";
  import { t } from "./i18n.svelte";

  /**
   * 오류 경계: 안에서 그리기·효과가 예외를 던지면 그 부분만 안내로 바꾼다 (화면 전체가 멈추지 않게).
   * [보기 다시 만들기]는 같은 내용을 새로 만든다. 창처럼 닫을 수 있는 것은 onclose를 주면 [닫기]도 보인다.
   * 곡은 App이 들고 있어 그대로다. 단추 처리(클릭 등)에서 난 예외는 경계가 받지 않는다 (전역 처리가 받는다)
   */
  interface Props {
    children: Snippet;
    /** 경계가 오류를 받았을 때 (최근 오류에 적고 자동 보존하는 일) */
    onfail: (error: unknown) => void;
    /** 창 자리: 화면 가운데에 띄운다 */
    floating?: boolean;
    /** 닫기: 이 부분을 닫은 뒤 다시 만든다 */
    onclose?: (() => void) | undefined;
  }

  let { children, onfail, floating = false, onclose }: Props = $props();
</script>

<svelte:boundary onerror={(error) => onfail(error)}>
  {@render children()}
  {#snippet failed(error, reset)}
    <div class="view-failed" class:floating role="alert">
      <p>{t("ui.viewFailed")}</p>
      <p class="muted reason">{errorText(error)}</p>
      <div class="actions">
        <button class="primary" onclick={reset}>{t("ui.viewRebuild")}</button>
        {#if onclose}
          <button
            onclick={() => {
              onclose();
              reset();
            }}>{t("ui.close")}</button
          >
        {/if}
      </div>
      <DiagCopy />
    </div>
  {/snippet}
</svelte:boundary>

<style>
  .view-failed {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 16px;
    text-align: center;
    background: var(--panel);
    color: var(--text);
    -webkit-user-select: text;
    user-select: text;
  }
  .view-failed.floating {
    position: fixed;
    inset: 50% auto auto 50%;
    transform: translate(-50%, -50%);
    z-index: 1000;
    width: min(420px, calc(100vw - 32px));
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.3);
  }
  p {
    margin: 0;
  }
  .reason {
    font-size: 12px;
    word-break: break-word;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
</style>
