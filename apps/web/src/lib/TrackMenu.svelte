<script lang="ts">
  import { INSTRUMENTS, type Track } from "@mmlce/core";
  import { onMount, tick } from "svelte";
  import { instrumentName, t } from "./i18n.svelte";
  import type { TrackActions } from "./trackActions";

  /** 트랙 줄·악보 줄을 오른쪽 클릭(터치는 길게 누르기)하면 뜨는 메뉴 */
  interface Props {
    x: number;
    y: number;
    track: Track | undefined;
    playerId: string;
    playerName: string;
    actions: TrackActions;
    onclose: () => void;
  }

  let { x, y, track, playerId, playerName, actions, onclose }: Props = $props();
  /** 악기 고르는 중이면 어느 쪽 악기인지, "target"이면 옮길 악보 고르는 중 */
  let picking = $state<"track" | "score" | "target" | undefined>(undefined);
  /** 이름 바꾸는 중이면 어느 쪽 이름인지 (메뉴 안 입력칸, 브라우저 prompt 창은 iPad에서 불편해서 안 쓴다) */
  let renaming = $state<"track" | "score" | undefined>(undefined);
  let draft = $state("");
  let panel: HTMLDivElement;

  /** 화면 위치. 실제 크기를 재서 아래로 넘치면 위로 펴고, 그래도 모자라면 남는 높이만큼 안에서 스크롤 */
  let pos = $state({ left: 0, top: 0, maxHeight: 400 });
  /** 크기를 재기 전에는 숨겨 둔다 (왼쪽 위에 잠깐 번쩍이지 않게) */
  let placed = $state(false);

  async function place() {
    await tick();
    if (!panel) return;
    const margin = 4;
    const w = panel.offsetWidth;
    const full = panel.scrollHeight;
    const below = innerHeight - y - margin;
    const above = y - margin;
    let top: number;
    let maxHeight: number;
    if (full <= below || below >= above) {
      top = y;
      maxHeight = below;
    } else {
      maxHeight = above;
      top = Math.max(margin, y - Math.min(full, above));
    }
    pos = { left: Math.max(margin, Math.min(x, innerWidth - w - margin)), top, maxHeight };
    if (!placed) {
      placed = true;
      await tick();
      // 키보드: 보이게 된 뒤 첫 항목으로
      panel?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
    }
  }

  // 처음 열 때, 악기 목록·이름 입력으로 바뀔 때 다시 잰다
  $effect(() => {
    void picking;
    void renaming;
    void place();
  });

  // 키보드: 닫히면 연 자리로 포커스를 돌려준다
  onMount(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    return () => before?.focus({ preventScroll: true });
  });

  /** ↑↓로 항목 사이를 옮긴다 */
  function moveFocus(step: number) {
    const items = [...panel.querySelectorAll<HTMLButtonElement>("button[role=menuitem]:not(:disabled)")];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + step + items.length) % items.length]!.focus();
  }

  function startRename(which: "track" | "score") {
    draft = which === "track" ? (track?.name ?? "") : playerName;
    renaming = which;
  }

  function commitRename() {
    // 닫으면 props가 사라지므로 먼저 값을 잡아 둔다
    const name = draft.trim();
    const which = renaming;
    const target = track;
    const player = { id: playerId, name: playerName };
    onclose();
    if (!name) return;
    if (which === "track" && target && name !== target.name) actions.renameTrack(target.id, name);
    else if (which === "score" && name !== player.name) actions.renamePlayer(player.id, name);
  }

  function focus(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  /** 먼저 실행하고 닫는다. 닫으면 부모가 메뉴를 지워 track·playerId props를 더 읽을 수 없다 */
  function run(fn: () => void) {
    fn();
    onclose();
  }

  function onwindowpointerdown(e: PointerEvent) {
    if (!panel.contains(e.target as Node)) onclose();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }

  /** 판 안에서 ↑↓ (창 단축키보다 먼저 받아 막는다) */
  function onpanelkeydown(e: KeyboardEvent) {
    if (!renaming && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      moveFocus(e.key === "ArrowDown" ? 1 : -1);
    }
  }
</script>

<svelte:window onpointerdown={onwindowpointerdown} {onkeydown} onresize={onclose} />

<div class="track-menu" role="menu" tabindex="-1" onkeydown={onpanelkeydown} bind:this={panel} style:left="{pos.left}px" style:top="{pos.top}px" style:max-height="{pos.maxHeight}px" style:visibility={placed ? "visible" : "hidden"}>
  {#if renaming}
    <form class="rename" onsubmit={(e) => (e.preventDefault(), commitRename())}>
      <label class="muted" for="track-menu-rename">{renaming === "track" ? t("ui.renameTrack") : t("ui.renameScore")}</label>
      <input id="track-menu-rename" bind:value={draft} use:focus enterkeyhint="done" />
      <div class="rename-buttons">
        <button type="button" class="small" onclick={onclose}>{t("ui.cancel")}</button>
        <button type="submit" class="small primary">{t("ui.renameApply")}</button>
      </div>
    </form>
  {:else if picking === "target" && track}
    {@const id = track.id}
    {#each actions.moveTargets(id) as target (target.playerId)}
      <button role="menuitem" disabled={!!target.reason} title={target.reason} onclick={() => run(() => actions.move(id, target.playerId, Infinity))}>{target.label}</button>
    {/each}
    <hr />
    <button role="menuitem" title={t("ui.moveTrackToNewHelp")} onclick={() => run(() => actions.toNewScore(id))}>{t("ui.moveTrackToNew")}</button>
    <button role="menuitem" title={t("ui.copyTrackToNewHelp")} onclick={() => run(() => actions.copyToNewScore(id))}>{t("ui.copyTrackToNew")}</button>
  {:else if picking}
    {#each INSTRUMENTS as inst (inst.id)}
      <button
        role="menuitem"
        onclick={() => run(() => (picking === "track" && track ? actions.trackInstrument(track.id, inst.id) : actions.playerInstrument(playerId, inst.id)))}
      >
        {instrumentName(inst.id)}
      </button>
    {/each}
  {:else}
    {#if track}
      <button role="menuitem" onclick={() => startRename("track")}>{t("ui.renameTrack")}</button>
      <button role="menuitem" onclick={() => (picking = "track")}>{t("ui.trackInstrumentMenu")}</button>
      {#if actions.isMelody(track.id)}
        <button role="menuitem" title={t("ui.melodyHelp")} onclick={() => run(() => actions.setMelody(track.id, false))}>{t("ui.unmarkMelody")}</button>
      {:else}
        <button role="menuitem" title={t("ui.melodyHelp")} onclick={() => run(() => actions.setMelody(track.id, true))}>{t("ui.markMelody")}</button>
      {/if}
      {#if actions.toggleLane && actions.inLane && !actions.isActive?.(track.id)}
        {@const toggleLane = actions.toggleLane}
        <button role="menuitem" title={t("ui.laneMultiHelp")} onclick={() => run(() => toggleLane(track.id))}>{actions.inLane(track.id) ? t("ui.laneMenuOff") : t("ui.laneMenuOn")}</button>
      {/if}
      {#if actions.openSecond}
        {@const openSecond = actions.openSecond}
        <button role="menuitem" title={t("ui.openSecondHelp")} onclick={() => run(() => openSecond(track.id))}>{t("ui.openSecond")}</button>
      {/if}
      <button role="menuitem" title={t("ui.trackMoveHelp")} disabled={!actions.canShift(track.id, -1)} onclick={() => run(() => actions.shift(track.id, -1))}>{t("ui.trackUp")}</button>
      <button role="menuitem" title={t("ui.trackMoveHelp")} disabled={!actions.canShift(track.id, 1)} onclick={() => run(() => actions.shift(track.id, 1))}>{t("ui.trackDown")}</button>
      <button role="menuitem" onclick={() => (picking = "target")}>{t("ui.moveTrackTo")}…</button>
      <button role="menuitem" onclick={() => run(() => actions.duplicate(track.id))}>{t("ui.duplicateTrack")}</button>
      {#if actions.viewOf(track.id).hidden}
        <button role="menuitem" onclick={() => run(() => actions.view(track.id, { hidden: false }))}>{t("ui.showTrack")}</button>
      {:else}
        <button role="menuitem" title={t("ui.hideTrackHelp")} onclick={() => run(() => actions.view(track.id, { hidden: true }))}>{t("ui.hideTrack")}</button>
      {/if}
      {#if actions.viewOf(track.id).locked}
        <button role="menuitem" onclick={() => run(() => actions.view(track.id, { locked: false }))}>{t("ui.unlockTrack")}</button>
      {:else}
        <button role="menuitem" title={t("ui.lockTrackHelp")} onclick={() => run(() => actions.view(track.id, { locked: true }))}>{t("ui.lockTrack")}</button>
      {/if}
      <button role="menuitem" onclick={() => run(() => actions.remove(track))}>{t("ui.removeTrack")}</button>
      <hr />
    {/if}
    <button role="menuitem" onclick={() => startRename("score")}>{t("ui.renameScore")}</button>
    <button role="menuitem" onclick={() => (picking = "score")}>{t("ui.scoreInstrumentMenu")}</button>
  {/if}
</div>

<style>
  .track-menu {
    position: fixed;
    z-index: 60;
    min-width: 200px;
    overflow: auto;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .rename {
    display: grid;
    gap: 6px;
    padding: 6px;
  }
  .rename input {
    font: inherit;
    width: 100%;
    box-sizing: border-box;
  }
  .rename-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .rename-buttons button {
    display: inline-flex;
    width: auto;
    border: 1px solid var(--line);
    padding: 0 10px;
  }
  .rename-buttons .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--panel);
  }
  button {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    padding: 5px 8px;
  }
  button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  button:disabled {
    opacity: 0.45;
  }
  hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 4px 2px;
  }
</style>
