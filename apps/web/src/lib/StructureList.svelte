<script lang="ts">
  import { INSTRUMENTS, type Song, type Track } from "@mmlce/core";
  import { instrumentName, t } from "./i18n.svelte";
  import Icon from "./Icon.svelte";
  import InlineName from "./InlineName.svelte";
  import TrackMenu from "./TrackMenu.svelte";
  import type { ScoreGroup } from "./scores";
  import type { TrackActions } from "./trackActions";

  /**
   * 구조 목록: 악보 줄(접기·펼치기) 아래에 트랙 줄. 고른 트랙이 든 악보만 펼친다.
   * 트랙 줄에서 고르기·이름·끄기·솔로·글자 수, 오른쪽 클릭(길게 누르기) 메뉴
   */
  interface Props {
    song: Song;
    groups: readonly ScoreGroup[];
    /** 트랙 id → MML 글자 수 */
    chars: ReadonlyMap<string, number>;
    colors: ReadonlyMap<string, string>;
    activeTrackId: string | undefined;
    charLimit: number;
    /** 트랙 악기 (악보 악기와 다르면 줄에 알약으로 보인다) */
    trackInstrument: (track: Track) => string;
    actions: TrackActions;
  }

  let { song, groups, chars, colors, activeTrackId, charLimit, trackInstrument, actions }: Props = $props();

  // 접기·펼치기: 기본은 고른 트랙이 든 악보만 펼침. 눌러서 바꾼 것은 고른 트랙이 바뀌면 되돌린다
  let collapsed = $state<ReadonlySet<number>>(new Set());
  let opened = $state<ReadonlySet<number>>(new Set());
  $effect(() => {
    void activeTrackId;
    collapsed = new Set();
    opened = new Set();
  });

  const activeGroup = $derived(groups.find((g) => activeTrackId !== undefined && g.trackIds.includes(activeTrackId))?.number);
  const isOpen = (g: ScoreGroup) => (g.number === activeGroup ? !collapsed.has(g.number) : opened.has(g.number));

  function toggle(g: ScoreGroup) {
    const flip = (s: ReadonlySet<number>) => {
      const next = new Set(s);
      if (!next.delete(g.number)) next.add(g.number);
      return next;
    };
    if (g.number === activeGroup) collapsed = flip(collapsed);
    else opened = flip(opened);
  }

  const trackOf = (id: string) => song.tracks.find((tr) => tr.id === id);
  const playerOf = (id: string) => song.players.find((p) => p.id === id);
  const scoreChars = (g: ScoreGroup) => g.trackIds.reduce((n, id) => n + (chars.get(id) ?? 0), 0);

  let menu = $state<{ x: number; y: number; track: Track | undefined; playerId: string } | undefined>(undefined);
  let pressTimer: ReturnType<typeof setTimeout> | undefined;

  /** 길게 눌러 메뉴를 연 직후 손을 떼며 들어오는 click은 먹는다 (안 그러면 고르기·접기가 같이 일어나 메뉴·팝오버가 닫힌다) */
  let longPressed = false;
  let pressAt: { clientX: number; clientY: number } | undefined;

  function openMenu(e: { clientX: number; clientY: number }, track: Track | undefined, playerId: string) {
    menu = { x: e.clientX, y: e.clientY, track, playerId };
  }
  /** 터치: 길게 누르면 메뉴 */
  function press(e: PointerEvent, track: Track | undefined, playerId: string) {
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
  const release = () => clearTimeout(pressTimer);
  /** 손가락은 가만히 대고 있어도 조금씩 흔들린다. 10px 넘게 움직였을 때만 길게 누르기를 그만둔다 */
  function pressMove(e: PointerEvent) {
    if (pressAt && Math.hypot(e.clientX - pressAt.clientX, e.clientY - pressAt.clientY) > 10) release();
  }
  /** 줄 끝 ⋯ 단추: 단추 아래에 메뉴를 연다 */
  function menuButton(e: MouseEvent, track: Track | undefined, playerId: string) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu({ clientX: r.left, clientY: r.bottom }, track, playerId);
  }
  /** click 처리 앞에 붙인다. 길게 누른 뒤의 click이면 false */
  function takeClick(): boolean {
    if (!longPressed) return true;
    longPressed = false;
    return false;
  }

  /**
   * 손잡이 끌기: 트랙 줄 위쪽 반에 놓으면 그 앞, 아래쪽 반이면 그 뒤, 악보 줄에 놓으면 그 악보 끝으로.
   * 마우스·펜·손가락 모두 같은 포인터 이벤트로 받는다 (HTML 끌어 놓기는 iPad에서 길게 누르기와 겹친다)
   */
  let drag = $state<{ trackId: string; pointerId: number; over?: { playerId: string; index: number; rowId: string; after: boolean } | undefined } | undefined>(undefined);
  let listEl: HTMLDivElement;

  function startDrag(e: PointerEvent, trackId: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(pressTimer);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { trackId, pointerId: e.pointerId };
  }

  /** 놓을 자리: 그 연주자 트랙 중 몇 번째 (끄는 트랙을 뺀 순서) */
  function dropAt(e: PointerEvent): NonNullable<typeof drag>["over"] {
    if (!drag) return undefined;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop]");
    if (!el || !listEl.contains(el)) return undefined;
    const playerId = el.dataset.player!;
    const others = song.tracks.filter((tr) => tr.playerId === playerId && tr.id !== drag!.trackId).map((tr) => tr.id);
    if (el.dataset.drop === "score") {
      // 악보 줄: 그 게임 악보(묶음)의 마지막 트랙 뒤
      const group = groups.find((g) => g.number === Number(el.dataset.score));
      const tail = group ? [...group.trackIds].reverse().find((id) => id !== drag!.trackId) : undefined;
      const index = tail ? others.indexOf(tail) + 1 : others.length;
      return { playerId, index, rowId: el.dataset.row!, after: true };
    }
    const id = el.dataset.track!;
    const r = el.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    if (id === drag.trackId) return { playerId, index: song.tracks.filter((tr) => tr.playerId === playerId).findIndex((tr) => tr.id === id), rowId: id, after };
    return { playerId, index: others.indexOf(id) + (after ? 1 : 0), rowId: id, after };
  }

  function moveDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = { ...drag, over: dropAt(e) };
  }

  function endDrag(e: PointerEvent, cancel = false) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { trackId, over } = drag;
    drag = undefined;
    if (!cancel && over) actions.move(trackId, over.playerId, over.index);
  }

  /** 끄는 동안 놓을 자리 표시와 막힌 자리 */
  const dropBlocked = (playerId: string) => !!drag && actions.moveTargets(drag.trackId).find((x) => x.playerId === playerId)?.reason;

  /** 키보드: Enter·Space는 누르기, 메뉴 키·Shift+F10은 줄 메뉴 */
  function rowKey(e: KeyboardEvent, activate: () => void, track: Track | undefined, playerId: string) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openMenu({ clientX: r.left + 24, clientY: r.bottom }, track, playerId);
    }
  }
</script>

<div class="structure-list" class:dragging={!!drag} bind:this={listEl}>
  {#each groups as g (g.number)}
    {@const player = playerOf(g.playerId)}
    {@const open = isOpen(g)}
    <div
      class="score-row"
      class:dim={!open}
      data-drop="score"
      data-player={g.playerId}
      data-score={g.number}
      data-row="score-{g.number}"
      class:drop-after={drag?.over?.rowId === `score-${g.number}`}
      class:drop-blocked={drag?.over?.rowId === `score-${g.number}` && !!dropBlocked(g.playerId)}
      role="button"
      tabindex="0"
      aria-expanded={open}
      onclick={() => takeClick() && toggle(g)}
      onkeydown={(e) => rowKey(e, () => toggle(g), undefined, g.playerId)}
      oncontextmenu={(e) => (e.preventDefault(), openMenu(e, undefined, g.playerId))}
      onpointerdown={(e) => press(e, undefined, g.playerId)}
      onpointerup={release}
      onpointercancel={release}
      onpointermove={pressMove}
    >
      <span class="twist"><Icon name={open ? "chevron-down" : "chevron-right"} size={14} /></span>
      <strong>{t("ui.scoreN", { n: g.number })}</strong>
      {#if player}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <select
          class="pill"
          title={t("ui.instrument")}
          value={player.instrument.canonical}
          onclick={(e) => e.stopPropagation()}
          onchange={(e) => actions.playerInstrument(player.id, e.currentTarget.value)}
        >
          {#if !INSTRUMENTS.some((i) => i.id === player.instrument.canonical)}
            <option value={player.instrument.canonical}>{instrumentName(player.instrument.canonical)}</option>
          {/if}
          {#each INSTRUMENTS as inst (inst.id)}<option value={inst.id}>{instrumentName(inst.id)}</option>{/each}
        </select>
        <span class="muted name"><InlineName value={player.name} title={t("ui.renameHelp")} onrename={(name) => actions.renamePlayer(player.id, name)} /></span>
      {/if}
      <span class="spacer"></span>
      <span class="muted">{t("ui.scoreSummary", { tracks: g.trackIds.length, chars: scoreChars(g) })}</span>
    </div>
    {#if open}
      {#each g.trackIds as id, k (id)}
        {@const track = trackOf(id)}
        {#if track}
          {@const count = chars.get(id) ?? 0}
          {@const own = trackInstrument(track)}
          {@const view = actions.viewOf(id)}
          <div
            class="track-row"
            class:on={id === activeTrackId}
            class:lane={!!actions.inLane?.(id)}
            class:lifted={drag?.trackId === id}
            class:drop-before={drag?.over?.rowId === id && !drag.over.after}
            class:drop-after={drag?.over?.rowId === id && drag.over.after}
            class:drop-blocked={drag?.over?.rowId === id && !!dropBlocked(g.playerId)}
            data-drop="track"
            data-player={g.playerId}
            data-track={id}
            style:--track-color={colors.get(id) ?? track.color}
            role="button"
            tabindex="0"
            aria-pressed={id === activeTrackId}
            title={actions.toggleLane ? t("ui.laneTrackToggle") : undefined}
            onclick={(e) => takeClick() && ((e.ctrlKey || e.metaKey) && actions.toggleLane ? actions.toggleLane(id) : e.altKey && actions.openSecond ? actions.openSecond(id) : actions.select(id))}
            onkeydown={(e) => rowKey(e, () => (e.altKey && actions.openSecond ? actions.openSecond(id) : actions.select(id)), track, g.playerId)}
            oncontextmenu={(e) => (e.preventDefault(), openMenu(e, track, g.playerId))}
            onpointerdown={(e) => press(e, track, g.playerId)}
            onpointerup={release}
            onpointercancel={release}
            onpointermove={pressMove}
          >
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <span
              class="grip"
              title={t("ui.trackGrip")}
              onpointerdown={(e) => startDrag(e, id)}
              onpointermove={moveDrag}
              onpointerup={(e) => endDrag(e)}
              onpointercancel={(e) => endDrag(e, true)}
              onclick={(e) => e.stopPropagation()}
            ><Icon name="grip" size={14} /></span>
            <span class="dot"></span>
            <span class="idx">{k + 1}</span>
            {#if actions.isMelody(id)}<span class="melody" title={t("ui.melodyTrack")}>♪</span>{/if}
            <span class="tname"><InlineName value={track.name} title={t("ui.renameHelp")} onrename={(name) => actions.renameTrack(id, name)} /></span>
            <!-- 트랙 악기는 늘 보인다. 악보 악기와 다른 트랙만 강조색 테두리로 (악보 악기를 바꿔도 줄마다 무엇이 나는지 바로 보이게) -->
            <span class="pill small-pill" class:own={!!player && own !== player.instrument.canonical} title={t("ui.trackInstrumentHelp")}>{instrumentName(own)}</span>
            <span class="spacer"></span>
            <button
              class="ms eye"
              class:off={view.hidden}
              title={view.hidden ? t("ui.showTrack") : t("ui.hideTrack")}
              aria-label={view.hidden ? t("ui.showTrack") : t("ui.hideTrack")}
              aria-pressed={!!view.hidden}
              onclick={(e) => (e.stopPropagation(), actions.view(id, { hidden: !view.hidden }))}><Icon name={view.hidden ? "eye-off" : "eye"} size={13} /></button
            >
            <button
              class="ms lock"
              class:lit={view.locked}
              title={view.locked ? t("ui.unlockTrack") : t("ui.lockTrack")}
              aria-label={view.locked ? t("ui.unlockTrack") : t("ui.lockTrack")}
              aria-pressed={!!view.locked}
              onclick={(e) => (e.stopPropagation(), actions.view(id, { locked: !view.locked }))}><Icon name={view.locked ? "lock" : "lock-open"} size={13} /></button
            >
            <button class="ms" class:lit={track.mute} title={t("ui.mute")} onclick={(e) => (e.stopPropagation(), actions.listen(id, { mute: !track.mute }))}>{t("ui.muteShort")}</button>
            <button class="ms" class:lit={track.solo} title={t("ui.solo")} onclick={(e) => (e.stopPropagation(), actions.listen(id, { solo: !track.solo }))}>{t("ui.soloShort")}</button>
            <span class="bar" class:over={count > charLimit} title={`${count} / ${charLimit}`}>
              <span style:width="{Math.min(100, (count / charLimit) * 100)}%"></span>
            </span>
            <span class="count" class:over={count > charLimit}>{count}</span>
            <button class="ms more" title={t("ui.trackMenu")} aria-label={t("ui.trackMenu")} onclick={(e) => menuButton(e, track, g.playerId)}
              ><Icon name="ellipsis" size={14} /></button
            >
          </div>
        {/if}
      {/each}
    {/if}
  {/each}
  <div class="add muted">
    <button class="link" onclick={actions.addTrack}>{t("ui.addTrack")}</button>
    ·
    <button class="link" onclick={actions.addScore}>{t("ui.addPlayer")}</button>
  </div>
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
  .structure-list {
    font-size: 13px;
    container-type: inline-size;
  }
  .score-row:focus-visible,
  .track-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .score-row,
  .track-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: var(--ctl-h);
    padding: 0 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  .score-row {
    border-top: 1px solid var(--line);
  }
  .score-row:first-child {
    border-top: none;
  }
  .score-row.dim {
    opacity: 0.65;
  }
  .twist {
    display: inline-flex;
    width: 14px;
    color: var(--muted);
  }
  .track-row {
    padding-left: 4px;
  }
  .grip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    align-self: stretch;
    color: var(--muted);
    cursor: grab;
    touch-action: none;
    flex: none;
  }
  @media (pointer: coarse) {
    .grip {
      width: 28px;
    }
  }
  .dragging,
  .dragging .grip {
    cursor: grabbing;
  }
  .lifted {
    opacity: 0.5;
  }
  .drop-before {
    box-shadow: inset 0 2px 0 var(--accent);
  }
  .drop-after {
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .drop-blocked {
    box-shadow: inset 0 0 0 2px var(--danger);
    cursor: not-allowed;
  }
  .track-row.on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  /* 음량 레인에 같이 그리는 트랙 */
  .track-row.lane {
    box-shadow: inset 0 0 0 1.5px var(--track-color);
  }
  .melody {
    color: var(--track-color);
    font-weight: 700;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--track-color);
    flex: none;
  }
  .idx {
    color: var(--muted);
  }
  .tname,
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pill {
    font-size: 12px;
    min-height: 0;
    height: 22px;
    padding: 0 4px;
    border-radius: 11px;
  }
  .small-pill {
    display: inline-flex;
    align-items: center;
    flex: none;
    padding: 0 8px;
    border: 1px solid var(--line);
    color: var(--muted);
  }
  .small-pill.own {
    border-color: var(--accent);
    color: var(--text);
  }
  .ms {
    min-width: 24px;
    min-height: 0;
    height: 22px;
    padding: 0;
    font-size: 11px;
    font-weight: 600;
  }
  @media (pointer: coarse) {
    .ms {
      min-width: 32px;
      height: 30px;
    }
  }
  .ms.eye,
  .ms.lock {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }
  .ms.eye.off {
    opacity: 0.55;
  }
  .ms.lit {
    background: #f2c94c;
    border-color: #d4a72c;
    color: #1f2430;
  }
  .bar {
    width: 56px;
    height: 6px;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
    flex: none;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .bar.over span {
    background: var(--danger);
  }
  .count {
    min-width: 3.2em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .ms.more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }
  /* 폰처럼 좁은 칸: 글자 수 막대를 빼서 ⋯ 단추까지 한 줄에 들어가게 */
  @container (max-width: 480px) {
    .bar {
      display: none;
    }
  }
  .count.over {
    color: var(--danger);
    font-weight: 600;
  }
  .add {
    padding: 4px 8px 6px 22px;
    font-size: 12px;
  }
  .link {
    border: none;
    background: none;
    min-height: 0;
    padding: 0 2px;
    color: inherit;
    text-decoration: underline dotted;
  }
</style>
