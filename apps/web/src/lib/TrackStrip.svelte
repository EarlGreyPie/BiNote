<script lang="ts">
  import type { Song, Track } from "@mmlce/core";
  import { instrumentLabel, t } from "./i18n.svelte";
  import Icon from "./Icon.svelte";
  import StructureList from "./StructureList.svelte";
  import TrackMenu from "./TrackMenu.svelte";
  import type { ScoreGroup } from "./scores";
  import type { TrackActions } from "./trackActions";
  import { movedTooFar } from "./longPress";
  import { dragStarted, dropSpot, dropTargetAt, scoreRowId, type DropSpot } from "./trackDrag";

  /** 패널을 롤 아래에 둘 때(3MLE식) 편집기 위에 오는 32px 트랙 띠. 오른쪽 ▾로 구조 목록 전체를 팝오버로 */
  interface Props {
    song: Song;
    groups: readonly ScoreGroup[];
    chars: ReadonlyMap<string, number>;
    colors: ReadonlyMap<string, string>;
    activeTrackId: string | undefined;
    /** 트랙마다 글자 수 한도 (게임이 붙여넣는 자리마다 한도가 다를 수 있다) */
    charLimit: (trackId: string) => number;
    trackInstrument: (track: Track) => string;
    actions: TrackActions;
  }

  let { song, groups, chars, colors, activeTrackId, charLimit, trackInstrument, actions }: Props = $props();

  let popover = $state(false);
  let root: HTMLDivElement;
  /** 팝오버 화면 위치. 패널이 overflow: hidden이라 편집기가 낮으면 잘리므로 fixed로 띄우고, 아래가 좁으면 위로 편다 */
  let pop = $state<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number }>({ left: 0, width: 0, maxHeight: 0 });

  function togglePopover() {
    if (!popover) {
      const r = root.getBoundingClientRect();
      const below = innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const cap = innerHeight * 0.4;
      pop =
        below >= Math.min(cap, 240) || below >= above
          ? { left: r.left, width: r.width, top: r.bottom, maxHeight: Math.min(cap, below) }
          : { left: r.left, width: r.width, bottom: innerHeight - r.top, maxHeight: Math.min(cap, above) };
    }
    popover = !popover;
  }
  let menu = $state<{ x: number; y: number; track: Track | undefined; playerId: string } | undefined>(undefined);
  let pressTimer: ReturnType<typeof setTimeout> | undefined;

  const activeGroup = $derived(groups.find((g) => activeTrackId !== undefined && g.trackIds.includes(activeTrackId))?.number);
  const playerOf = (id: string) => song.players.find((p) => p.id === id);
  const trackOf = (id: string) => song.tracks.find((tr) => tr.id === id);

  // 트랙을 고르면 팝오버를 닫는다. 이름을 두 번 눌러 바꿀 수 있게 잠깐 기다렸다가 닫고, 그 사이 두 번 누르면 열어 둔다
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const selectingActions: TrackActions = $derived({
    ...actions,
    select: (id) => {
      actions.select(id);
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => (popover = false), 300);
    },
  });
  const keepOpen = () => clearTimeout(closeTimer);

  function onwindowpointerdown(e: PointerEvent) {
    if (popover && !root.contains(e.target as Node)) popover = false;
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && drag) {
      // 끄는 중 Esc: 옮기지 않고 그만둔다
      drag = undefined;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === "Escape" && popover) {
      popover = false;
      e.stopPropagation();
    }
  }
  function openMenu(e: { clientX: number; clientY: number }, track: Track, playerId: string) {
    menu = { x: e.clientX, y: e.clientY, track, playerId };
  }
  /** 길게 눌러 메뉴를 연 직후 손을 떼며 들어오는 click은 먹는다 */
  let longPressed = false;
  /** 길게 누르기를 시작한 자리 (손가락이 조금 흔들려도 이어 간다) */
  let pressAt: { clientX: number; clientY: number } | undefined;
  function press(e: PointerEvent, track: Track, playerId: string) {
    longPressed = false;
    if (e.pointerType === "mouse") return;
    const at = { clientX: e.clientX, clientY: e.clientY };
    pressAt = at;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      openMenu(at, track, playerId);
    }, 550);
  }
  function takeClick(): boolean {
    if (!longPressed) return true;
    longPressed = false;
    return false;
  }
  const release = () => {
    clearTimeout(pressTimer);
    pressAt = undefined;
  };
  /** 허용 거리(longPress.ts)를 넘게 움직였을 때만 길게 누르기를 그만둔다 (구조 목록과 같게) */
  function pressMove(e: PointerEvent) {
    if (movedTooFar(pressAt, e)) release();
  }

  /**
   * 트랙 단추를 마우스로 끌어 옮기기: 다른 트랙 단추의 왼쪽 반에 놓으면 그 앞, 오른쪽 반이면 그 뒤,
   * 접힌 악보 단추에 놓으면 그 악보 끝으로. 손가락·펜은 띠를 옆으로 굴려야 하므로 ▾ 목록의 손잡이로 끈다
   */
  let drag = $state<{ trackId: string; pointerId: number; over?: DropSpot | undefined } | undefined>(undefined);
  let pending: { trackId: string; pointerId: number; clientX: number; clientY: number } | undefined;
  let stripEl: HTMLDivElement;

  function pillDown(e: PointerEvent, track: Track, playerId: string) {
    press(e, track, playerId);
    pending = e.pointerType === "mouse" && e.button === 0 && !drag ? { trackId: track.id, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY } : undefined;
  }

  function pillMove(e: PointerEvent) {
    pressMove(e);
    if (pending && e.pointerId === pending.pointerId && !drag) {
      // 단추 밖에서 마우스를 놓으면 pointerup이 여기 오지 않는다. 버튼이 안 눌린 채 돌아오면 남은 누름을 버린다
      if ((e.buttons & 1) === 0) {
        pending = undefined;
        return;
      }
      if (!dragStarted(pending, e)) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag = { trackId: pending.trackId, pointerId: pending.pointerId };
      pending = undefined;
      // 끌고 나서 손을 떼며 들어오는 click이 트랙을 고르지 않게
      longPressed = true;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    const target = dropTargetAt(stripEl, e, "x");
    drag = { ...drag, over: target && dropSpot(song.tracks, groups, drag.trackId, target) };
  }

  function pillUp(e: PointerEvent, cancel = false) {
    release();
    pending = undefined;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { trackId, over } = drag;
    drag = undefined;
    if (!cancel && over) actions.move(trackId, over.playerId, over.index);
  }

  /** 끄는 동안 놓지 못하는 악보 (트랙이 꽉 참) */
  const dropBlocked = (playerId: string) => !!drag && actions.moveTargets(drag.trackId).find((x) => x.playerId === playerId)?.reason;
</script>

<svelte:window onpointerdown={onwindowpointerdown} {onkeydown} onresize={() => (popover = false)} />

<div class="strip-wrap" bind:this={root}>
  <div class="strip" class:dragging={!!drag} role="tablist" bind:this={stripEl}>
    {#each groups as g (g.number)}
      {@const player = playerOf(g.playerId)}
      {#if g.number === activeGroup}
        <span class="chip on">{t("ui.scoreN", { n: g.number })} {player ? instrumentLabel(player.instrument) : ""}</span>
        {#each g.trackIds as id, k (id)}
          {@const track = trackOf(id)}
          {#if track}
            {@const count = chars.get(id) ?? 0}
            <button
              class="pill"
              class:on={id === activeTrackId}
              class:lane={!!actions.inLane?.(id)}
              class:lifted={drag?.trackId === id}
              class:drop-before={drag?.over?.rowId === id && !drag.over.after && drag.trackId !== id}
              class:drop-after={drag?.over?.rowId === id && drag.over.after && drag.trackId !== id}
              data-drop="track"
              data-player={g.playerId}
              data-track={id}
              title={t("ui.trackGrip")}
              style:--track-color={colors.get(id) ?? track.color}
              role="tab"
              aria-selected={id === activeTrackId}
              onclick={(e) => takeClick() && ((e.ctrlKey || e.metaKey) && actions.toggleLane ? actions.toggleLane(id) : e.altKey && actions.openSecond ? actions.openSecond(id) : actions.select(id))}
              oncontextmenu={(e) => (e.preventDefault(), openMenu(e, track, g.playerId))}
              onpointerdown={(e) => pillDown(e, track, g.playerId)}
              onpointerup={(e) => pillUp(e)}
              onpointercancel={(e) => pillUp(e, true)}
              onpointermove={pillMove}
            >
              <span class="dot"></span>{k + 1}{#if actions.isMelody(id)}<span class="melody" title={t("ui.melodyTrack")}>♪</span>{/if} {track.name}
              {#if actions.viewOf(id).hidden}<span class="flag" title={t("ui.showTrack")}><Icon name="eye-off" size={12} /></span>{/if}
              {#if actions.viewOf(id).locked}<span class="flag" title={t("ui.unlockTrack")}><Icon name="lock" size={12} /></span>{/if}
              <span class="count" class:over={count > charLimit(id)}>{count}</span>
            </button>
          {/if}
        {/each}
      {:else}
        <button
          class="chip folded"
          class:drop-after={drag?.over?.rowId === scoreRowId(g.number) && !dropBlocked(g.playerId)}
          class:drop-blocked={drag?.over?.rowId === scoreRowId(g.number) && !!dropBlocked(g.playerId)}
          data-drop="score"
          data-player={g.playerId}
          data-score={g.number}
          onclick={() => g.trackIds[0] && actions.select(g.trackIds[0])}>
          {t("ui.scoreN", { n: g.number })} {player ? instrumentLabel(player.instrument) : ""} ({g.trackIds.length})
        </button>
      {/if}
    {/each}
    <span class="spacer"></span>
  </div>
  <button class="more" class:on={popover} title={t("ui.stripMore")} aria-label={t("ui.stripMore")} onclick={togglePopover}>
    <Icon name="chevron-down" />
  </button>
  {#if popover}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="popover"
      ondblclickcapture={keepOpen}
      style:left="{pop.left}px"
      style:width="{pop.width}px"
      style:top={pop.top === undefined ? "auto" : `${pop.top}px`}
      style:bottom={pop.bottom === undefined ? "auto" : `${pop.bottom}px`}
      style:max-height="{pop.maxHeight}px"
    >
      <StructureList {song} {groups} {chars} {colors} {activeTrackId} {charLimit} {trackInstrument} actions={selectingActions} />
    </div>
  {/if}
</div>

{#if menu}
  <TrackMenu
    x={menu.x}
    y={menu.y}
    track={menu.track}
    playerId={menu.playerId}
    playerName={playerOf(menu.playerId)?.name ?? ""}
    {actions}
    onclose={() => (menu = undefined)}
  />
{/if}

<style>
  .flag {
    display: inline-flex;
    color: var(--muted);
  }
  .strip-wrap {
    position: relative;
    display: flex;
    align-items: center;
    height: 32px;
    flex: none;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  .strip {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    padding: 0 8px;
    white-space: nowrap;
    scrollbar-width: none;
  }
  /* scrollbar-width를 모르는 사파리(18.2 전)에서도 스크롤 막대를 숨긴다 */
  .strip::-webkit-scrollbar {
    display: none;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    min-height: 0;
    height: 24px;
    padding: 0 8px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
  }
  .strip.dragging,
  .strip.dragging .pill,
  .strip.dragging .chip {
    cursor: grabbing;
  }
  .pill.lifted {
    opacity: 0.5;
  }
  .pill.drop-before {
    box-shadow: -3px 0 0 var(--accent);
  }
  .pill.drop-after,
  .chip.drop-after {
    box-shadow: 3px 0 0 var(--accent);
  }
  .chip.drop-blocked {
    box-shadow: inset 0 0 0 2px var(--danger);
    cursor: not-allowed;
  }
  .chip.on {
    color: var(--muted);
    font-weight: 600;
  }
  .chip.folded {
    border-color: transparent;
    background: none;
    color: var(--muted);
    font-weight: 400;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 0;
    height: 24px;
    padding: 0 8px;
    border-radius: 12px;
    font-size: 12px;
  }
  /* 음량 레인에 같이 그리는 트랙 */
  .pill.lane {
    box-shadow: inset 0 0 0 1.5px var(--track-color);
  }
  .melody {
    color: var(--track-color);
    font-weight: 700;
  }
  .pill.on {
    border-color: var(--track-color);
    background: color-mix(in srgb, var(--track-color) 18%, var(--bg));
    font-weight: 600;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--track-color);
  }
  .count {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .count.over {
    color: var(--danger);
    font-weight: 600;
  }
  .more {
    flex: none;
    min-height: 0;
    height: 26px;
    margin: 0 6px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
  }
  .popover {
    position: fixed;
    z-index: 35;
    overflow: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 0 0 8px 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
</style>
