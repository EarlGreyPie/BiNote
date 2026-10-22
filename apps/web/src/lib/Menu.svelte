<script lang="ts" module>
  /** 눌러서 고르는 항목 */
  export interface MenuAction {
    readonly label: string;
    /** 오른쪽에 흐리게 보이는 단축키 */
    readonly hint?: string | undefined;
    readonly title?: string;
    readonly disabled?: boolean;
    /** 켜고 끄는 항목이면 지금 상태 (✓ 표시) */
    readonly checked?: boolean;
    readonly run: () => void;
  }

  /** 하위 메뉴(▸). 눌러야 열린다. 한 단계만 둔다(하위 안에 하위 없음) */
  export interface MenuSub {
    readonly label: string;
    readonly title?: string;
    readonly disabled?: boolean;
    readonly items: readonly (MenuAction | { readonly separator: true })[];
  }

  /** 메뉴 항목. separator면 줄만 긋는다 */
  export type MenuItem = { readonly separator: true } | MenuAction | MenuSub;

  /** 하위 메뉴 줄이 꺼졌는지: 직접 껐거나, 고를 수 있는 항목이 하나도 없으면 */
  export function subDisabled(sub: MenuSub): boolean {
    return !!sub.disabled || !sub.items.some((it) => !("separator" in it) && !it.disabled);
  }
</script>

<script lang="ts">
  import { tick } from "svelte";
  import Icon, { type IconName } from "./Icon.svelte";
  import { portal } from "./portal";
  import { coarsePointer } from "./mmlPad.svelte";
  import { flyoutPlace, nextRow, subMenuMode } from "./menuNav";
  import { t } from "./i18n.svelte";

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
  /** 옆에 펼친 하위 판 (flyout일 때만) */
  let subPanel = $state<HTMLDivElement | undefined>(undefined);
  /** 펼친 판의 화면 위치. 위 띠·도구줄은 가로 스크롤(overflow)이라 absolute면 잘리므로 fixed로 띄우고 칸 밖으로 옮긴다 */
  let pos = $state({ top: 0, left: 0, right: 0, maxHeight: 400 });
  /** 연 하위 메뉴: items 안 자리와 여는 방식 */
  let sub = $state<{ index: number; mode: "flyout" | "drill" } | undefined>(undefined);
  /** 옆 펼침 판 자리. measuring이면 너비를 재는 중이라 숨겨 둔다 */
  let subPos = $state<{ top: number; left?: number; right?: number; maxHeight: number; measuring?: boolean }>({ top: 0, maxHeight: 400 });

  const openSub = $derived.by(() => {
    const it = sub ? items[sub.index] : undefined;
    return it && "items" in it ? it : undefined;
  });

  function place() {
    const r = button.getBoundingClientRect();
    pos = {
      top: r.bottom + 4,
      left: Math.max(4, r.left),
      right: Math.max(4, innerWidth - r.right),
      maxHeight: Math.max(120, innerHeight - r.bottom - 12),
    };
  }

  function close() {
    open = false;
    sub = undefined;
  }

  function toggle() {
    if (open) return close();
    place();
    open = true;
  }

  function inside(node: Node): boolean {
    return root.contains(node) || !!panel?.contains(node) || !!subPanel?.contains(node);
  }

  function onwindowpointerdown(e: PointerEvent) {
    if (open && !inside(e.target as Node)) close();
  }

  /**
   * 단추를 담은 칸(위 띠·도구줄 등)이 스크롤되거나 창 크기가 바뀌면 단추와 판이 어긋나므로 닫는다.
   * 재생 중 편집기·롤이 따라 스크롤하는 것처럼 상관없는 칸의 스크롤로는 닫지 않는다
   */
  function onwindowscroll(e: Event) {
    const target = e.target;
    if (!open || !(target instanceof Node) || inside(target)) return;
    if (target === document || target.contains(root)) close();
  }

  /** 판 안에서 고를 수 있는 줄 단추들 */
  function rowsOf(el: HTMLElement | undefined): HTMLButtonElement[] {
    return el ? Array.from(el.querySelectorAll<HTMLButtonElement>("button[role=menuitem]")) : [];
  }

  function focusRow(el: HTMLElement | undefined, dir: 1 | -1, from = -1) {
    const rows = rowsOf(el);
    const i = nextRow(rows.map((b) => ({ disabled: b.disabled })), from, dir);
    rows[i]?.focus();
  }

  /**
   * 하위 메뉴 열기. 키보드로 열었으면 첫 줄로 초점을 옮긴다.
   * hover: 마우스나 떠 있는 펜(애플펜슬 호버·S펜 에어 뷰)으로 열었으면 터치 기기여도 옆에 펼친다
   */
  async function showSub(index: number, row: HTMLElement, focus: boolean, hover = false) {
    const it = items[index];
    if (!it || !("items" in it) || subDisabled(it)) return;
    let mode = subMenuMode(coarsePointer && !hover, innerWidth, panel?.getBoundingClientRect().width ?? 220);
    if (mode === "flyout") {
      // 먼저 숨긴 채 띄워 실제 너비를 재고, 부모 판 좌우 어느 쪽에도 안 들어가면 같은 판을 바꾼다
      const r = row.getBoundingClientRect();
      const top = Math.max(4, r.top - 5);
      const maxHeight = Math.max(160, innerHeight - top - 12);
      subPos = { top: Math.min(top, Math.max(4, innerHeight - maxHeight - 8)), maxHeight, left: 0, measuring: true };
      sub = { index, mode };
      await tick();
      if (sub?.index !== index || !subPanel || !panel) return;
      const p = panel.getBoundingClientRect();
      const side = flyoutPlace(p.left, p.right, subPanel.getBoundingClientRect().width, innerWidth);
      if (side) subPos = { top: subPos.top, maxHeight: subPos.maxHeight, ...side };
      else if (hover) {
        // 올려 두기만으로는 판을 바꾸지 않는다 (바뀐 자리를 잘못 누르지 않게). 누르면 같은 판에서 연다
        sub = undefined;
        return;
      } else mode = "drill";
    }
    sub = { index, mode };
    await tick();
    if (sub?.index !== index) return;
    // 같은 판이 바뀌면 누르던 부모 줄이 사라지므로, 어떻게 열었든 초점을 판 안에 둔다(Esc·← 가 계속 듣게).
    // 키보드로 열었으면 첫 하위 줄, 누르거나 올려서 열었으면 ‹ 뒤로 줄
    if (mode === "drill") focusRow(panel, 1, focus ? 0 : -1);
    else if (focus) focusRow(subPanel, 1);
  }

  /** 하위 메뉴 닫고 부모 줄로 초점을 돌린다 */
  async function hideSub() {
    const index = sub?.index;
    sub = undefined;
    await tick();
    if (index !== undefined) panel?.querySelector<HTMLButtonElement>(`[data-row="${index}"]`)?.focus();
  }

  function onbuttonkeydown(e: KeyboardEvent) {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    if (!open) {
      place();
      open = true;
    }
    void tick().then(() => focusRow(panel, 1));
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      if (sub) void hideSub();
      else {
        close();
        button.focus();
      }
      return;
    }
    if (!open) return;
    const el = e.currentTarget as HTMLElement;
    const active = document.activeElement as HTMLElement | null;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const rows = rowsOf(el);
      focusRow(el, e.key === "ArrowDown" ? 1 : -1, rows.indexOf(active as HTMLButtonElement));
    } else if (e.key === "ArrowRight" && active?.dataset.sub !== undefined) {
      e.preventDefault();
      void showSub(Number(active.dataset.row), active, true);
    } else if (e.key === "ArrowLeft" && sub && (el === subPanel || sub.mode === "drill")) {
      e.preventDefault();
      void hideSub();
    }
  }

  function choose(item: MenuAction) {
    if (item.disabled) return;
    close();
    item.run();
  }

  /** 누르면 연다. 올려 두어 이미 옆에 펼친 하위 판은 그대로 둔다(누르자마자 닫히지 않게) */
  function onsubclick(index: number, e: MouseEvent) {
    const keyboard = e.detail === 0;
    if (sub?.index === index && sub.mode === "flyout") {
      if (keyboard) void tick().then(() => focusRow(subPanel, 1));
      return;
    }
    void showSub(index, e.currentTarget as HTMLElement, keyboard);
  }

  /**
   * 마우스나 떠 있는 펜으로 옆 펼침 메뉴를 쓸 때는 올려 두기만 해도 하위 판이 바뀐다(누르는 것도 된다).
   * 손가락·화면에 닿은 펜은 누를 때만 연다
   */
  function onrowenter(index: number, e: PointerEvent) {
    const hover = e.pointerType === "mouse" || (e.pointerType === "pen" && e.buttons === 0);
    if (!hover || sub?.mode === "drill") return;
    // 좁은 화면이라 옆에 펼칠 자리가 없으면 올려 두기로는 판을 바꾸지 않는다 (누를 때만)
    if (subMenuMode(false, innerWidth, panel?.getBoundingClientRect().width ?? 220) === "drill") return;
    const it = items[index];
    if (it && "items" in it) {
      if (sub?.index !== index) void showSub(index, e.currentTarget as HTMLElement, false, true);
    } else if (sub) sub = undefined;
  }
</script>

<svelte:window onpointerdown={onwindowpointerdown} onresize={close} />
<svelte:document onscrollcapture={onwindowscroll} />

{#snippet action(item: MenuAction, row?: number)}
  <button
    role="menuitem"
    class="menu-item"
    disabled={item.disabled}
    title={item.title}
    data-row={row}
    onclick={() => choose(item)}
    onpointerenter={row === undefined ? undefined : (e) => onrowenter(row, e)}
  >
    <span class="check">{item.checked ? "✓" : ""}</span>
    <span class="label">{item.label}</span>
    {#if item.hint}<span class="hint">{item.hint}</span>{/if}
  </button>
{/snippet}

{#snippet list(rows: readonly MenuItem[], top: boolean)}
  {#each rows as item, i (i)}
    {#if "separator" in item}
      <hr />
    {:else if "items" in item}
      <button
        role="menuitem"
        class="menu-item"
        class:open={sub?.index === i}
        aria-haspopup="menu"
        aria-expanded={sub?.index === i}
        disabled={subDisabled(item)}
        title={item.title}
        data-row={i}
        data-sub=""
        onclick={(e) => onsubclick(i, e)}
        onpointerenter={(e) => onrowenter(i, e)}
      >
        <span class="check"></span>
        <span class="label">{item.label}</span>
        <span class="arrow" aria-hidden="true">▸</span>
      </button>
    {:else}
      {@render action(item, top ? i : undefined)}
    {/if}
  {/each}
{/snippet}

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
    onkeydown={onbuttonkeydown}
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
      {#if openSub && sub?.mode === "drill"}
        <!-- 터치·좁은 화면: 같은 판이 하위 목록으로 바뀌고, 맨 위 줄로 돌아간다 -->
        <button role="menuitem" class="menu-item back" onclick={() => void hideSub()}>
          <span class="check">‹</span>
          <span class="label">{openSub.label}</span>
          <span class="hint">{t("ui.menuBack")}</span>
        </button>
        <hr />
        {#each openSub.items as item, i (i)}
          {#if "separator" in item}<hr />{:else}{@render action(item)}{/if}
        {/each}
      {:else}
        {@render list(items, true)}
      {/if}
    </div>
    {#if openSub && sub?.mode === "flyout"}
      <div
        class="menu-panel"
        role="menu"
        tabindex="-1"
        aria-label={openSub.label}
        bind:this={subPanel}
        use:portal
        {onkeydown}
        style:top="{subPos.top}px"
        style:left={subPos.left === undefined ? "auto" : `${subPos.left}px`}
        style:right={subPos.right === undefined ? "auto" : `${subPos.right}px`}
        style:max-height="{subPos.maxHeight}px"
        style:visibility={subPos.measuring ? "hidden" : undefined}
      >
        {#each openSub.items as item, i (i)}
          {#if "separator" in item}<hr />{:else}{@render action(item)}{/if}
        {/each}
      </div>
    {/if}
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
  .arrow {
    color: var(--muted);
  }
  .menu-item.open {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .menu-item.back .label {
    font-weight: 600;
  }
  hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 4px 2px;
  }
</style>
