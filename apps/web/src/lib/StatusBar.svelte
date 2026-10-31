<script lang="ts" module>
  /** 상태줄 위로 펼쳐지는 패널 */
  export type StatusPanel = "checks" | "help";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "./i18n.svelte";
  import Icon from "./Icon.svelte";

  /** 맨 아래 상태줄: 고른 트랙 · 동시발음 · 글자 수 · 검사 · 사운드팩 · 도움말. 패널은 줄 위로 펼친다 */
  interface Props {
    /** "악보1 · 1 멜로디" (없으면 "-") */
    track: string;
    /** "동시발음 3 · 곡 최대 7 / 트랙 7" */
    polyphony: string;
    chars: { count: number; limit: number } | undefined;
    /** MML 편집기 글 커서 자리 "마디:박" (편집기에서 커서를 옮긴 뒤에만) */
    textCursor?: string | undefined;
    /** 타브에서 칠 수 없는 음 수 (0이면 숨김) */
    unplayable: number;
    checkCount: number;
    packCount: number;
    instrumentCount: number;
    /** 잠깐 보여 주는 한 줄 (글자 수 줄이기 결과 등) */
    flash: string;
    /** 자동 보존이 안 되고 있으면 그 안내 (마우스를 올리면 보인다). 없으면 배지를 숨긴다 */
    unsaved?: string | undefined;
    /** "보존 안 됨" 옆 [다시 시도]·[.mme로 저장] */
    onretrysave?: (() => void) | undefined;
    onsaveproject?: (() => void) | undefined;
    panel: StatusPanel | undefined;
    onpanel: (panel: StatusPanel | undefined) => void;
    onpacks: () => void;
    messages?: Snippet | undefined;
    /** 피아노롤에서 고른 음 정보 (고른 음이 있을 때만) */
    selection?: Snippet | undefined;
    checks?: Snippet | undefined;
    help?: Snippet | undefined;
  }

  let { track, polyphony, chars, textCursor, unplayable, checkCount, packCount, instrumentCount, flash, unsaved, onretrysave, onsaveproject, panel, onpanel, onpacks, messages, selection, checks, help }: Props = $props();

  const over = $derived(!!chars && chars.count > chars.limit);

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && panel) {
      onpanel(undefined);
      e.stopPropagation();
    }
  }

  function toggle(p: StatusPanel) {
    onpanel(panel === p ? undefined : p);
  }
</script>

<svelte:window {onkeydown} />

<footer class="statusbar">
  <div class="status-panels">
    {#if messages}<div class="status-panel messages">{@render messages()}</div>{/if}
    {#if panel === "checks" && checks}<div class="status-panel checks-panel">{@render checks()}</div>{/if}
    {#if panel === "help" && help}<div class="status-panel help-panel">{@render help()}</div>{/if}
  </div>
  <span class="item"><span class="muted">{t("ui.statusTrack")}</span> {track || "-"}</span>
  <span class="item" title={t("ui.polyphonyHelp")}>{polyphony}</span>
  {#if chars}
    <span class="item" title={t("ui.statusCharsHelp")}>
      <span class:pill={over}>{t("ui.statusChars", { count: chars.count, limit: chars.limit })}</span>
    </span>
  {/if}
  {#if textCursor}<span class="item" title={t("ui.statusTextCursorHelp")}>{t("ui.statusTextCursor", { at: textCursor })}</span>{/if}
  {#if selection}{@render selection()}{/if}
  {#if unplayable > 0}<span class="item over">{t("ui.statusUnplayable", { count: unplayable })}</span>{/if}
  {#if flash}<span class="item muted">{flash}</span>{/if}
  {#if unsaved}
    <span class="item unsaved" role="alert">
      <span class="pill" title={unsaved}><Icon name="alert-triangle" size={13} />{t("ui.autosaveFailed")}</span>
      {#if onretrysave}<button class="status-btn" title={unsaved} onclick={onretrysave}>{t("ui.autosaveRetry")}</button>{/if}
      {#if onsaveproject}<button class="status-btn" onclick={onsaveproject}>{t("ui.autosaveSaveProject")}</button>{/if}
    </span>
  {/if}
  <span class="spacer"></span>
  {#if checkCount > 0}
    <button class="status-btn" class:on={panel === "checks"} title={t("ui.statusChecksHelp")} onclick={() => toggle("checks")}>
      <Icon name="alert-triangle" size={13} />{t("ui.statusChecks", { count: checkCount })}
    </button>
  {/if}
  <button class="status-btn" class:over={packCount === 0} title={packCount === 0 ? t("ui.statusNoPackHelp") : ""} onclick={onpacks}>
    {packCount === 0 ? t("ui.statusNoPack") : t("ui.statusPacks", { count: packCount, instruments: instrumentCount })}
  </button>
  <button class="status-btn" class:on={panel === "help"} onclick={() => toggle("help")}>
    <Icon name="help" size={13} />{t("ui.help")}
  </button>
</footer>
