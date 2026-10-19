<script lang="ts" module>
  /** 메뉴 항목. separator면 줄만 긋는다 */
  export type MenuItem =
    | { readonly separator: true }
    | {
        readonly label: string;
        /** 오른쪽에 흐리게 보이는 단축키 */
        readonly hint?: string | undefined;
        readonly title?: string;
        readonly disabled?: boolean;
        /** 켜고 끄는 항목이면 지금 상태 (✓ 표시) */
        readonly checked?: boolean;
        readonly run: () => void;
      };
</script>

<script lang="ts">
  import Icon, { type IconName } from "./Icon.svelte";
  import { portal } from "./portal";

  /** 위쪽 메뉴 하나 (파일·편집·곡·보기). 누르면 펼치고, 바깥을 누르거나 Esc면 닫는다 */
  interface Props {
    /** 단추 글자. 아이콘만 쓰는 메뉴(⋯)는 비워 둔다 */
    label?: string;
    icon?: IconName;
    /** 아이콘 메뉴의 툴팁·접근성 이름 */
    title?: string;
    /** 펼침 방향: 단추 왼쪽 끝에 맞출지 오른쪽 끝에 맞출지 */
    align?: "left" | "right";
    items: readonly MenuItem[];
  }

  let { label = "", icon, title, align = "left", items }: Props = $props();
  let open = $state(false);
  let root: HTMLDivElement;
  let button: HTMLButtonElement;
  /** 펼친 판. 앱 맨 바깥으로 옮겨 띄우므로 root 안에 없다 */
  let panel = $state<HTMLDivElement | undefined>(undefined);
  /** 펼친 판의 화면 위치. 위 띠·도구줄은 가로 스크롤(overflow)이라 absolute면 잘리므로 fixed로 띄우고 칸 밖으로 옮긴다 */
  let pos = $state({ top: 0, left: 0, right: 0, maxHeight: 400 });

  function place() {
    const r = button.getBoundingClientRect();
    pos = {
      top: r.bottom + 4,
      left: Math.max(4, r.left),
      right: Math.max(4, innerWidth - r.right),
      maxHeight: Math.max(120, innerHeight - r.bottom - 12),
    };
  }

  function toggle() {
    if (!open) place();
    open = !open;
  }

  function inside(node: Node): boolean {
    return root.contains(node) || !!panel?.contains(node);
  }

  function onwindowpointerdown(e: PointerEvent) {
    if (open && !inside(e.target as Node)) open = false;
  }

  /**
   * 단추를 담은 칸(위 띠·도구줄 등)이 스크롤되거나 창 크기가 바뀌면 단추와 판이 어긋나므로 닫는다.
   * 재생 중 편집기·롤이 따라 스크롤하는 것처럼 상관없는 칸의 스크롤로는 닫지 않는다
   */
  function onwindowscroll(e: Event) {
    const target = e.target;
    if (!open || !(target instanceof Node) || inside(target)) return;
    if (target === document || target.contains(root)) open = false;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      open = false;
      e.stopPropagation();
    }
  }

  function choose(item: Extract<MenuItem, { run: () => void }>) {
    if (item.disabled) return;
    open = false;
    item.run();
  }
</script>

<svelte:window onpointerdown={onwindowpointerdown} onresize={() => (open = false)} />
<svelte:document onscrollcapture={onwindowscroll} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="menu" bind:this={root} {onkeydown}>
  <button
    class="menu-button"
    class:icon={!!icon && !label}
    class:on={open}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={title ?? label}
    title={title}
    bind:this={button}
    onclick={toggle}
  >
    {#if icon}<Icon name={icon} />{/if}{label}
  </button>
  {#if open}
    <div
      class="menu-panel"
      role="menu"
      tabindex="-1"
      bind:this={panel}
      use:portal
      {onkeydown}
      style:top="{pos.top}px"
      style:left={align === "right" ? "auto" : `${pos.left}px`}
      style:right={align === "right" ? `${pos.right}px` : "auto"}
      style:max-height="{pos.maxHeight}px"
    >
      {#each items as item, i (i)}
        {#if "separator" in item}
          <hr />
        {:else}
          <button role="menuitem" class="menu-item" disabled={item.disabled} title={item.title} onclick={() => choose(item)}>
            <span class="check">{item.checked ? "✓" : ""}</span>
            <span class="label">{item.label}</span>
            {#if item.hint}<span class="hint">{item.hint}</span>{/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .menu {
    position: relative;
    display: inline-block;
  }
  .menu-panel {
    position: fixed;
    z-index: 50;
    overflow-y: auto;
    min-width: 220px;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .menu-item {
    display: flex;
    width: 100%;
    gap: 8px;
    align-items: center;
    padding: 5px 8px;
    border: none;
    background: none;
    text-align: left;
    border-radius: 5px;
  }
  .menu-item:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  /* 터치 기기: 줄 높이 36px 이상 */
  @media (pointer: coarse) {
    .menu-item {
      min-height: 36px;
    }
  }
  .menu-item:disabled {
    opacity: 0.45;
  }
  .check {
    width: 1em;
    color: var(--accent);
  }
  .label {
    flex: 1;
  }
  .hint {
    color: var(--muted);
    font-size: 11px;
  }
  hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 4px 2px;
  }
</style>
