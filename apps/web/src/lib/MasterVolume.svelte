<script lang="ts">
  import Icon from "./Icon.svelte";
  import { portal } from "./portal";

  /**
   * 맨 위 재생 묶음의 전체 음량. 넓으면 아이콘 + 슬라이더, 좁으면(세로로 긴 창이거나 폭이 좁은 창) 음량 단추 하나로 줄이고
   * 누르면 그 아래 작은 판에 같은 슬라이더를 연다. 바깥을 누르거나 Esc로 닫는다
   */
  interface Props {
    value: number;
    max: number;
    title: string;
    onchange: (value: number) => void;
  }
  let { value, max, title, onchange }: Props = $props();

  let open = $state(false);
  let root: HTMLElement;
  let button = $state<HTMLButtonElement | undefined>(undefined);
  /** 작은 판. 앱 맨 바깥으로 옮겨 띄우므로 root 안에 없다 */
  let pop = $state<HTMLDivElement | undefined>(undefined);
  /** 판 자리 (위 띠가 옆으로 스크롤될 수 있어 화면 기준으로 둔다. 메뉴 판과 같다) */
  let place = $state({ left: 0, top: 0 });

  function toggle() {
    if (!open && button) {
      const r = button.getBoundingClientRect();
      // 판 폭(약 160px)이 화면 밖으로 나가지 않게
      place = { left: Math.max(8, Math.min(r.left + r.width / 2 - 80, window.innerWidth - 168)), top: r.bottom + 6 };
    }
    open = !open;
  }

  function onwindowpointerdown(e: PointerEvent) {
    const target = e.target as Node;
    if (open && !root.contains(target) && !pop?.contains(target)) open = false;
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

<span class="master-volume" bind:this={root}>
  <label class="wide" {title}>
    <Icon name="volume" />
    <input type="range" min="0" {max} step="0.05" {value} oninput={(e) => onchange(Number(e.currentTarget.value))} />
  </label>
  <button class="icon narrow" class:on={open} bind:this={button} {title} aria-label={title} aria-expanded={open} onclick={toggle}>
    <Icon name="volume" />
  </button>
  {#if open}
    <div class="pop" role="dialog" bind:this={pop} use:portal aria-label={title} style:left="{place.left}px" style:top="{place.top}px">
      <!-- svelte-ignore a11y_autofocus -->
      <input type="range" min="0" {max} step="0.05" {value} aria-label={title} autofocus oninput={(e) => onchange(Number(e.currentTarget.value))} />
    </div>
  {/if}
</span>

<style>
  .master-volume {
    display: inline-flex;
    align-items: center;
    margin-left: 4px;
  }
  .wide {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .wide input {
    width: 90px;
  }
  .narrow {
    display: none;
  }
  .narrow.on {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .pop {
    position: fixed;
    z-index: 50;
    width: 160px;
    padding: 10px 12px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .pop input {
    width: 100%;
  }
  /* 좁을 때: 세로로 긴 창(전에 음량을 숨기던 조건)이거나 위 띠가 넘칠 만큼 폭이 좁은 창 */
  @media (max-aspect-ratio: 1/1), (max-width: 720px) {
    .wide {
      display: none;
    }
    .narrow {
      display: inline-flex;
    }
  }
</style>
