<script lang="ts">
  import { t } from "./i18n.svelte";

  /**
   * 작업 메모 넣기·고치기 창 (실험실). 가운데 모달 창이라 글 칸이 캔버스 옆에 붙지 않는다 (아이패드 펜슬 Scribble).
   * 자리는 여기서 바꾸지 않는다 (이벤트 줄에서 라벨을 끌어 옮긴다)
   */
  interface Props {
    /** 자리 글 ("12:1" 또는 범위 "12:1 - 14:1") */
    where: string;
    /** 고치는 메모면 지금 글·끝냄 */
    existing?: { readonly text: string; readonly done: boolean } | undefined;
    onapply: (text: string, done: boolean) => void;
    /** 메모 지우기 (고칠 때만) */
    onremove?: (() => void) | undefined;
    /** 구조 마커로 바꾸기 (고칠 때만) */
    onmarker?: (() => void) | undefined;
    onclose: () => void;
  }

  let { where, existing, onapply, onremove, onmarker, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let text = $state(existing?.text ?? "");
  // svelte-ignore state_referenced_locally
  let done = $state(existing?.done ?? false);
  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (!text.trim()) return;
    onapply(text, done);
    dialog.close();
  }
  function onkeydown(e: KeyboardEvent) {
    // 한글 조합 중 Enter는 글자를 끝내는 키라 적용하지 않는다
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      apply();
    }
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{existing ? t("ui.memoEdit") : t("ui.memoAdd")}</h2>
  <p class="muted small">{t("ui.memoWhere", { where })}</p>
  <!-- svelte-ignore a11y_autofocus -->
  <input class="text" type="text" bind:value={text} placeholder={t("ui.memoPlaceholder")} {onkeydown} autofocus />
  {#if existing}
    <label class="row"><input type="checkbox" bind:checked={done} />{t("ui.memoDone")}</label>
  {/if}
  <p class="muted small">{t("ui.memoNotExported")}</p>
  <div class="actions">
    {#if existing && onremove}
      <button
        class="left"
        onclick={() => {
          onremove?.();
          dialog.close();
        }}>{t("ui.memoRemove")}</button
      >
    {/if}
    {#if existing && onmarker}
      <button
        title={t("ui.memoToMarkerHelp")}
        onclick={() => {
          onmarker?.();
          dialog.close();
        }}>{t("ui.memoToMarker")}</button
      >
    {/if}
    <span class="grow"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!text.trim()} onclick={apply}>{t("ui.memoApply")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px));
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  h2 {
    margin: 0 0 4px;
    font-size: 1.05rem;
  }
  .small {
    font-size: 0.85rem;
  }
  .text {
    width: 100%;
    box-sizing: border-box;
    margin: 4px 0 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
  }
</style>
