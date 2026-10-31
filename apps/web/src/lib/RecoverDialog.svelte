<script lang="ts">
  import { t } from "./i18n.svelte";
  import RecoverList from "./RecoverList.svelte";
  import type { WorkSummary } from "./workStore";

  /** 파일 메뉴 "지난 작업 되살리기": 곡을 연 뒤에도 자동 보존한 작업을 고른다 */
  interface Props {
    works: readonly WorkSummary[];
    /** 다른 탭에서 열려 있는 작업 id */
    elsewhere?: ReadonlySet<string> | undefined;
    onrestore: (id: string) => void;
    onforget: (id: string) => void;
    onclose: () => void;
  }

  let { works, elsewhere, onrestore, onforget, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });
</script>

<dialog bind:this={dialog} {onclose}>
  <RecoverList {works} {elsewhere} {onrestore} {onforget} />
  <div class="actions">
    <button onclick={() => dialog.close()}>{t("ui.close")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(560px, calc(100vw - 32px));
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }
</style>
