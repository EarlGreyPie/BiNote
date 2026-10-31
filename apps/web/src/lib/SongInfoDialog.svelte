<script lang="ts">
  import { t } from "./i18n.svelte";
  import type { SongInfo } from "./songInfo";

  /** 곡 정보 창: 제목·지은이·메모. 3MLE·마비꼬 파일과 프로젝트 파일에 함께 들어간다 */
  interface Props {
    info: SongInfo;
    onapply: (info: SongInfo) => void;
    onclose: () => void;
  }

  let { info, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let title = $state(info.title);
  // svelte-ignore state_referenced_locally
  let author = $state(info.author);
  // svelte-ignore state_referenced_locally
  let memo = $state(info.memo);
  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    onapply({ title, author, memo });
    dialog.close();
  }

  // 글자 칸에서 Enter는 바로 적용 (한글 조합 중에는 두기)
  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      apply();
    }
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.songInfoTitle")}</h2>
  <p class="muted">{t("ui.songInfoHelp")}</p>
  <label>
    {t("ui.songInfoName")}
    <!-- svelte-ignore a11y_autofocus -->
    <input type="text" bind:value={title} placeholder={t("ui.recoverUntitled")} {onkeydown} autofocus />
  </label>
  <label>
    {t("ui.songInfoAuthor")}
    <input type="text" bind:value={author} {onkeydown} />
  </label>
  <label>
    {t("ui.songInfoMemo")}
    <input type="text" bind:value={memo} {onkeydown} />
  </label>
  <p class="muted">{t("ui.songInfoFiles")}</p>
  <div class="actions">
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" onclick={apply}>{t("ui.apply")}</button>
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
  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 8px;
  }
  input {
    width: 100%;
    box-sizing: border-box;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
