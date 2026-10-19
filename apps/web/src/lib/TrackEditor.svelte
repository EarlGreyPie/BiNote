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
    /** 지금 악기의 화면 글 (.2·.3 팩 악기는 하프(24.2)처럼). 없으면 이름만 */
    instrumentLabel?: string | undefined;
    /** 이 트랙이 들을 사운드팩 파일 이름 (없으면 자동) */
    pack?: string | undefined;
    /** 지금 올린 사운드팩 파일 이름들. 둘 이상일 때만 팩 고르기를 보인다 */
    packLabels?: readonly string[];
    charLimit: number;
    /** 머리 줄에 끄기·솔로를 둔다 (구조 목록이 안 보이는 아래 배치) */
    showListen: boolean;
    reveal: { from: number; to: number; focus: boolean; nonce: number } | undefined;
    playing?: readonly [number, number] | undefined;
    follow?: boolean;
    oninstrument: (canonical: string) => void;
    /** 팩 고르기 (undefined면 자동) */
    onpack?: ((pack: string | undefined) => void) | undefined;
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
    /** 잠시 글을 고칠 수 없게 (영상 속도를 직접 재는 동안). 자물쇠와 달리 트랙에 남지 않는다 */
    hold?: boolean;
    /** 아래 편집기(편집기 둘 나란히)면 닫기 단추를 단다 */
    onclose?: (() => void) | undefined;
  }

  let { track, index, text, diagnostics, color, instrument, instrumentLabel, pack, packLabels = [], charLimit, showListen, reveal, playing, follow = false, oninstrument, onpack, onlisten, onedit, onundo, onredo, ongodiag, onrename, onclose, locked = false, onlock, hold = false }: Props = $props();

  const over = $derived(text.length > charLimit);
  const first = $derived(diagnostics[0]);
  // 고른 팩이 지금 없어도 항목에 남겨 "(없음)"을 붙인다 (곡의 값은 지우지 않는다)
  const packMissing = $derived(pack !== undefined && !packLabels.includes(pack));
  const showPack = $derived(!!onpack && (packLabels.length > 1 || packMissing));
  // 지금 악기에 팩 번호가 붙으면 맨 위에 따로 두고 고르게 한다. 같은 악기의 기본 항목(이름만)을 고르면 번호 없는 악기로 바뀌고,
  // 이 항목을 다시 골라도 바뀌지 않는다
  const current = $derived(instrumentLabel !== undefined && instrumentLabel !== instrumentName(instrument) ? instrumentLabel : undefined);
  /** 지금 악기 항목의 값 (공통 ID와 겹치지 않게) */
  const CURRENT = "@current";
  /** 자동은 빈 값 */
  const AUTO = "";
</script>

<section class="editor" style:--track-color={color}>
  <div class="editor-head">
    <span class="dot"></span>
    <span class="title">{index} <InlineName value={track.name} title={t("ui.renameHelp")} {onrename} /></span>
    <select class="track-instrument" class:own={!!track.instrument} title={t("ui.trackInstrumentHelp")} value={current !== undefined ? CURRENT : instrument} onchange={(e) => {
      if (e.currentTarget.value !== CURRENT) oninstrument(e.currentTarget.value);
    }}>
      {#if current !== undefined}<option value={CURRENT}>{current}</option>
      {:else if !INSTRUMENTS.some((i) => i.id === instrument)}<option value={instrument}>{instrumentName(instrument)}</option>{/if}
      {#each INSTRUMENTS as inst (inst.id)}<option value={inst.id}>{instrumentName(inst.id)}</option>{/each}
    </select>
    {#if showPack}
      <select
        class="track-instrument track-pack"
        class:own={pack !== undefined}
        class:missing={packMissing}
        title={t("ui.trackPackHelp")}
        aria-label={t("ui.trackPack")}
        value={pack ?? AUTO}
        onchange={(e) => onpack?.(e.currentTarget.value === AUTO ? undefined : e.currentTarget.value)}
      >
        <option value={AUTO}>{t("ui.trackPackAuto")}</option>
        {#if packMissing && pack !== undefined}<option value={pack}>{pack} {t("ui.trackPackMissing")}</option>{/if}
        {#each packLabels as label (label)}<option value={label}>{label}</option>{/each}
      </select>
    {/if}
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
        readonly={locked || hold}
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
  .track-pack {
    max-width: 160px;
    text-overflow: ellipsis;
  }
  .track-pack.missing {
    border-color: var(--danger);
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
