<script lang="ts">
  import { i18n, t } from "./i18n.svelte";
  import DiagCopy from "./DiagCopy.svelte";
  import Icon from "./Icon.svelte";
  import { CHANGELOG_URL, guideUrl, REPO_URL } from "./links";
  import { applyUpdate, checkForUpdate, pwa } from "./pwa.svelte";

  /**
   * BiNote 정보 창: 아이콘·이름·버전, 업데이트 확인, 링크(가이드북·소스·라이선스·신고), 진단 정보 복사.
   * 업데이트 확인은 지금 새 판이 있는지 바로 물어보고, 있으면 받아 둔다. 바꾸기는 새로고침 단추로
   */
  interface Props {
    /** 새로고침 전에 고치던 곡을 보존하는 일 */
    beforeUpdate: () => Promise<void> | void;
    /** 자동 보존이 계속 안 될 때 저장 없이 바꾸기 (묻고 나서) */
    onreloadanyway: () => void;
    /** 받아 둔 새 판의 바뀐 내용 보기 */
    onnotes: () => void;
    onclose: () => void;
  }

  let { beforeUpdate, onreloadanyway, onnotes, onclose }: Props = $props();

  /** 공개 사이트면 이 판을 빌드한 커밋의 소스로, 아니면 저장소 첫 화면으로 */
  const sourceUrl = __MMLCE_BUILD__.published && __MMLCE_BUILD__.commit ? `${REPO_URL}/tree/${__MMLCE_BUILD__.commit}` : REPO_URL;

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });

  /** 이름 읽는 법: 한국어·일본어 화면에만 붙인다 */
  const readName = $derived(i18n.locale === "ko" ? "바이노트" : i18n.locale === "ja" ? "バイノート" : "");

  const timeText = (ms: number) => new Date(ms).toLocaleString(i18n.locale);

  const status = $derived.by(() => {
    if (pwa.updateFailed) return t("ui.updateSaveFailed");
    if (pwa.newVersion !== null) return pwa.newVersion ? t("ui.updateFound", { version: pwa.newVersion }) : t("ui.updateReady");
    switch (pwa.check) {
      case "checking":
        return t("ui.updateChecking");
      case "latest":
        return t("ui.updateLatest");
      case "failed":
        return t("ui.updateCheckFailed");
      case "unsupported":
        return t("ui.updateUnsupported");
      default:
        return "";
    }
  });
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="about-title">
  <div class="head">
    <span class="spacer"></span>
    <button class="icon" aria-label={t("ui.close")} title={t("ui.close")} onclick={() => dialog.close()}><Icon name="x" /></button>
  </div>
  <div class="brand">
    <img src="./icon.svg" alt="" width="56" height="56" />
    <div>
      <h2 id="about-title">BiNote {#if readName}<span class="ko">{readName}</span>{/if}</h2>
      <p class="muted">{t("ui.appSubtitle")}</p>
    </div>
  </div>

  <div class="version">
    <strong>{t("ui.aboutVersion", { version: __MMLCE_BUILD__.version })}</strong>
    <button onclick={() => checkForUpdate()} disabled={pwa.check === "checking"}>{t("ui.updateCheck")}</button>
  </div>
  <p class="muted small">
    {t("ui.aboutBuild", { build: __MMLCE_BUILD__.build, commit: __MMLCE_BUILD__.commit || "-" })}
  </p>
  {#if status}
    <p class="status" role="status">
      {status}
      {#if pwa.newVersion !== null}
        <button class="primary" disabled={pwa.applying} onclick={() => applyUpdate(beforeUpdate)}>{t("ui.updateReload")}</button>
        {#if pwa.updateFailed}<button disabled={pwa.applying} onclick={onreloadanyway}>{t("ui.updateReloadAnyway")}</button>{/if}
        <button onclick={onnotes}>{t("ui.changelog")}</button>
      {/if}
    </p>
  {/if}
  {#if pwa.lastChecked}
    <p class="muted small">{t("ui.updateLastChecked", { time: timeText(pwa.lastChecked) })}</p>
  {/if}

  <p class="links">
    <a href={guideUrl(i18n.locale)} target="_blank" rel="noopener">{t("ui.helpGuide")}</a>
    <a href={CHANGELOG_URL} target="_blank" rel="noopener">{t("ui.changelogAll")}</a>
    <a href={sourceUrl} target="_blank" rel="noopener">{t("ui.aboutSource")}</a>
    <a href="./licenses/GPL-3.0.txt" target="_blank" rel="noopener">GPL-3.0</a>
    <a href="./licenses/third-party.txt" target="_blank" rel="noopener">{t("ui.aboutLicenses")}</a>
    <a href={`${REPO_URL}/issues/new/choose`} target="_blank" rel="noopener">{t("ui.aboutReport")}</a>
  </p>
  <!-- 신고할 때 붙여 넣을 판·브라우저·최근 오류 (문제 신고 양식에 칸이 있다) -->
  <div class="diag">
    <DiagCopy />
  </div>
  <p class="muted small center">{t("ui.aboutCredit")}</p>
  <p class="muted small center">{t("ui.aboutUnofficial")}</p>
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    overflow: auto;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 20px 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  .head {
    display: flex;
  }
  .spacer {
    flex: 1;
  }
  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .brand img {
    border-radius: 12px;
    flex: none;
  }
  h2 {
    margin: 0;
    font-size: 1.3rem;
  }
  h2 .ko {
    font-weight: 500;
    font-size: 0.95rem;
  }
  .brand p {
    margin: 2px 0 0;
    font-size: 12px;
  }
  .version {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 18px;
  }
  p {
    margin: 6px 0 0;
  }
  .small {
    font-size: 11px;
    text-align: center;
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 12px;
    text-align: center;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 12px;
    margin-top: 16px;
    font-size: 12px;
  }
  .links a {
    color: var(--accent);
  }
  .center {
    text-align: center;
  }
  .diag {
    margin-top: 8px;
    text-align: center;
  }
</style>
