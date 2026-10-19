<script lang="ts">
  import { t } from "./i18n.svelte";
  import { portal } from "./portal";

  /**
   * 음량 레인에 같이 그릴 트랙을 고르는 작은 판. 터치에는 Ctrl+클릭이 없어서 여기서 체크로 넣고 뺀다.
   * 단추를 누르면 열리고, 바깥을 누르거나 Esc로 닫는다. 고른 트랙(편집 중)은 늘 들어 있어 끌 수 없다
   */
  interface Props {
    tracks: readonly { readonly id: string; readonly name: string; readonly playerId: string }[];
    players: readonly { readonly id: string; readonly name: string }[];
    activeId: string | undefined;
    laneIds: readonly string[];
    ontoggle: (trackId: string) => void;
    onclear?: (() => void) | undefined;
    /** 단추 글자와 모양 */
    label: string;
    buttonClass?: string;
  }
  let { tracks, players, activeId, laneIds, ontoggle, onclear, label, buttonClass = "" }: Props = $props();

  let open = $state(false);
  let button = $state<HTMLButtonElement | undefined>(undefined);
  let pop = $state<HTMLDivElement | undefined>(undefined);
  /** 화면 기준 자리. 레인은 보통 화면 아래쪽이라 단추 위로 펴고, 위쪽이면 아래로 편다 */
  let place = $state<{ left: number; top?: number; bottom?: number; maxHeight: number }>({ left: 0, maxHeight: 300 });

  const groups = $derived(
    players
      .map((p) => ({ player: p, tracks: tracks.filter((tr) => tr.playerId === p.id) }))
      .filter((g) => g.tracks.length > 0),
  );
  const extraCount = $derived(laneIds.filter((id) => id !== activeId && tracks.some((tr) => tr.id === id)).length);

  function toggle() {
    if (!open && button) {
      const r = button.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 228));
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      place = below >= above ? { left, top: r.bottom + 4, maxHeight: below } : { left, bottom: window.innerHeight - r.top + 4, maxHeight: above };
    }
    open = !open;
  }

  function onwindowpointerdown(e: PointerEvent) {
    const target = e.target as Node;
    if (open && !button?.contains(target) && !pop?.contains(target)) open = false;
  }

  // Esc는 판을 닫는 데만 쓴다 (재생 멈춤 단축키로 넘기지 않는다)
  function onwindowkeydown(e: KeyboardEvent) {
    if (open && e.key === "Escape") {
      open = false;
      e.preventDefault();
      e.stopPropagation();
      button?.focus();
    }
  }
</script>

<svelte:window onpointerdown={onwindowpointerdown} onkeydowncapture={onwindowkeydown} onresize={() => (open = false)} />

<button
  type="button"
  class={buttonClass}
  class:on={open}
  bind:this={button}
  title={t("ui.lanePickHelp")}
  aria-label={t("ui.lanePick")}
  aria-expanded={open}
  onclick={toggle}>{label}</button
>
{#if open}
  <div
    class="lane-pick"
    role="dialog"
    aria-label={t("ui.lanePick")}
    bind:this={pop}
    use:portal
    style:left="{place.left}px"
    style:top={place.top !== undefined ? `${place.top}px` : undefined}
    style:bottom={place.bottom !== undefined ? `${place.bottom}px` : undefined}
    style:max-height="{place.maxHeight}px"
  >
    <div class="head">{t("ui.lanePick")}</div>
    {#each groups as g (g.player.id)}
      <div class="score">{g.player.name}</div>
      {#each g.tracks as tr (tr.id)}
        <label class:active={tr.id === activeId}>
          <input
            type="checkbox"
            checked={tr.id === activeId || laneIds.includes(tr.id)}
            disabled={tr.id === activeId}
            onchange={() => ontoggle(tr.id)}
          />
          <span>{tr.name}</span>
          {#if tr.id === activeId}<span class="muted">{t("ui.lanePickActive")}</span>{/if}
        </label>
      {/each}
    {/each}
    {#if onclear && extraCount > 0}
      <button type="button" class="small clear" onclick={() => onclear?.()}>{t("ui.laneClear")}</button>
    {/if}
  </div>
{/if}

<style>
  button.on {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .lane-pick {
    position: fixed;
    z-index: 60;
    width: 220px;
    overflow: auto;
    padding: 6px;
    font-size: 13px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .head {
    margin-bottom: 4px;
    font-weight: 700;
  }
  .score {
    margin-top: 6px;
    font-size: 11px;
    color: var(--muted, inherit);
    opacity: 0.8;
  }
  /* 손가락으로 누르기 쉽게 한 줄을 넉넉히 */
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 4px;
    border-radius: 4px;
    cursor: pointer;
  }
  label.active {
    cursor: default;
  }
  label span:first-of-type {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    font-size: 11px;
    opacity: 0.7;
  }
  .clear {
    width: 100%;
    margin-top: 6px;
  }
</style>
