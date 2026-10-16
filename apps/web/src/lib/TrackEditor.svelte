<script lang="ts">
  import { INSTRUMENTS, type Track } from "@mmlce/core";
  import type { Diagnostic } from "@mmlce/mml";
  import { diag, instrumentName, t } from "./i18n.svelte";
  import Icon from "./Icon.svelte";
  import InlineName from "./InlineName.svelte";
  import MmlEditor from "./MmlEditor.svelte";

  /** 편집기 하나: 머리 줄(이름·악기·음 수·글자 수·검사)과 고른 트랙의 MML 글 */
  interface Props {
    track: Track;
    index: number;
    text: string;
    diagnostics: readonly Diagnostic[];
    color: string;
    /** 이 트랙이 실제로 쓰는 악기 */
    instrument: string;
    charLimit: number;
    /** 머리 줄에 끄기·솔로를 둔다 (구조 목록이 안 보이는 아래 배치) */
    showListen: boolean;
    reveal: { from: number; to: number; focus: boolean; nonce: number } | undefined;
    playing?: readonly [number, number] | undefined;
    follow?: boolean;
    oninstrument: (canonical: string) => void;
    onlisten: (change: { mute?: boolean; solo?: boolean }) => void;
    /** 글 저장. trackId는 그 편집기를 연 트랙 (트랙을 바꾸는 순간 남은 입력이 새 트랙에 들어가지 않게) */
    onedit: (trackId: string, text: string) => void;
    onundo: () => void;
    onredo: () => void;
    /** 첫 검사 자리로 */
    ongodiag: (from: number, to: number) => void;
    /** 머리 줄 이름을 두 번 눌러 바꾸기 */
    onrename: (name: string) => void;
    /** 잠근 트랙이면 글을 고칠 수 없다. 머리 줄 자물쇠로 풀고 잠근다 */
    locked?: boolean;
    onlock?: ((locked: boolean) => void) | undefined;
    /** 아래 편집기(편집기 둘 나란히)면 닫기 단추를 단다 */
    onclose?: (() => void) | undefined;
  }

  let { track, index, text, diagnostics, color, instrument, charLimit, showListen, reveal, playing, follow = false, oninstrument, onlisten, onedit, onundo, onredo, ongodiag, onrename, onclose, locked = false, onlock }: Props = $props();

  const over = $derived(text.length > charLimit);
  const first = $derived(diagnostics[0]);
</script>

<section class="editor" style:--track-color={color}>
  <div class="editor-head">
    <span class="dot"></span>
    <span class="title">{index} <InlineName value={track.name} title={t("ui.renameHelp")} {onrename} /></span>
    <select class="track-instrument" class:own={!!track.instrument} title={t("ui.trackInstrumentHelp")} value={instrument} onchange={(e) => oninstrument(e.currentTarget.value)}>
      {#if !INSTRUMENTS.some((i) => i.id === instrument)}<option value={instrument}>{instrumentName(instrument)}</option>{/if}
      {#each INSTRUMENTS as inst (inst.id)}<option value={inst.id}>{instrumentName(inst.id)}</option>{/each}
    </select>
    <span class="muted">{t("ui.notes", { count: track.notes.length })}</span>
    <span class={over ? "over" : "muted"}>{text.length} / {charLimit}</span>
    <span class="spacer"></span>
    {#if showListen}
      <button class="ms" class:lit={track.mute} title={t("ui.mute")} onclick={() => onlisten({ mute: !track.mute })}>{t("ui.muteShort")}</button>
      <button class="ms" class:lit={track.solo} title={t("ui.solo")} onclick={() => onlisten({ solo: !track.solo })}>{t("ui.soloShort")}</button>
    {/if}
    {#if onlock}
      <button
        class="ms lock"
        class:lit={locked}
        title={locked ? t("ui.unlockTrack") : t("ui.lockTrack")}
        aria-label={locked ? t("ui.unlockTrack") : t("ui.lockTrack")}
        aria-pressed={locked}
        onclick={() => onlock(!locked)}><Icon name={locked ? "lock" : "lock-open"} size={14} /></button
      >
    {/if}
    {#if first}
      <button class="small checks" title={diag(first)} onclick={() => ongodiag(first.span[0], first.span[1])}>
        <span class="alert-dot"></span>{t("ui.editorChecks", { count: diagnostics.length })}
      </button>
    {/if}
    {#if onclose}
      <button class="icon close" title={t("ui.closeSecond")} aria-label={t("ui.closeSecond")} onclick={onclose}><Icon name="x" /></button>
    {/if}
  </div>
  {#key track.id}
    <div class="editor-body">
      <MmlEditor
        {text}
        diagnostics={diagnostics.map((d) => ({ from: d.span[0], to: d.span[1], severity: d.level, message: diag(d) }))}
        owner={track.id}
        onedit={(value, owner) => onedit(owner ?? track.id, value)}
        {onundo}
        {onredo}
        {reveal}
        {playing}
        {follow}
        readonly={locked}
      />
    </div>
  {/key}
</section>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
  }
  .editor-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 4px 8px;
    border-bottom: 1px solid var(--line);
    border-left: 4px solid var(--track-color);
    white-space: nowrap;
    /* 폰처럼 좁으면 단추가 잘리지 않게 다음 줄로 */
    flex-wrap: wrap;
    row-gap: 4px;
  }
  .dot {
    display: none;
  }
  .title {
    font-weight: 600;
  }
  .close {
    min-height: 0;
    height: 24px;
    width: 24px;
    padding: 0;
  }
  .track-instrument {
    font-size: 12px;
    min-height: 0;
    height: 24px;
    padding: 0 4px;
    color: var(--muted);
  }
  .track-instrument.own {
    color: var(--text);
    border-color: var(--accent);
  }
  .ms {
    min-width: 28px;
    min-height: 0;
    height: 24px;
    padding: 0;
    font-size: 11px;
    font-weight: 600;
  }
  .ms.lit {
    background: #f2c94c;
    border-color: #d4a72c;
    color: #1f2430;
  }
  .checks {
    min-height: 0;
    height: 24px;
    gap: 5px;
  }
  .alert-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
  }
  /* 편집 글은 남는 높이를 다 쓰고 안에서 스크롤 */
  .editor-body {
    flex: 1 1 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .editor-body :global(.mml-editor) {
    flex: 1 1 0;
    min-height: 0;
    margin: 0;
  }
  .editor-body :global(.cm-editor) {
    height: 100%;
  }
  .editor-body :global(.cm-scroller) {
    max-height: none !important;
    overflow: auto;
  }
</style>
