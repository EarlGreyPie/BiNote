<script lang="ts">
  import { cmp, type Note, type TimeSigEvent } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { lengthText, pitchText, positionText } from "./noteInfo";

  /**
   * 음 목록 (보기 메뉴). 고른 트랙의 음을 위치 순으로 글로 보여 준다: 키보드(↑↓·Home·End·Enter)와 화면 낭독기로
   * 음을 찾아 고르는 길. 고르면 롤이 그 음으로 가고 그 음만 고른다. 그다음은 평소 단축키(지우기·높이·볼륨 등)가 그 음에 듣는다
   */
  interface Props {
    trackName: string;
    notes: readonly Note[];
    /** 롤에서 고른 음 id */
    selected: ReadonlySet<string>;
    timeSig: readonly TimeSigEvent[];
    onpick: (note: Note) => void;
    onclose: () => void;
  }

  let { trackName, notes, selected, timeSig, onpick, onclose }: Props = $props();
  let onlyPicked = $state(false);
  let focus = $state(0);
  let list: HTMLUListElement;

  const sorted = $derived([...notes].sort((a, b) => cmp(a.start, b.start) || a.pitch - b.pitch));
  const shown = $derived(onlyPicked ? sorted.filter((n) => selected.has(n.id)) : sorted);
  const current = $derived(Math.min(focus, Math.max(0, shown.length - 1)));

  // 목록에서 고른 음을 지우면 그 줄이 사라져 초점이 갈 곳을 잃는다: 그 자리 줄로 초점을 돌려준다
  let inside = false;
  $effect(() => {
    void shown;
    queueMicrotask(() => {
      if (inside && (document.activeElement === document.body || document.activeElement === null)) moveTo(current);
    });
  });

  function label(n: Note): string {
    return t("ui.noteListItem", {
      pos: positionText(timeSig, n.start),
      pitch: pitchText(n.pitch),
      len: lengthText(n.dur),
      vol: n.vol,
      tie: n.tie === "next" ? t("ui.noteListTie") : "",
    });
  }

  function moveTo(k: number) {
    focus = Math.max(0, Math.min(shown.length - 1, k));
    (list.children[focus] as HTMLElement | undefined)?.focus();
  }

  function onkeydown(event: KeyboardEvent) {
    const page = 10;
    const keys: Record<string, () => void> = {
      ArrowDown: () => moveTo(current + 1),
      ArrowUp: () => moveTo(current - 1),
      PageDown: () => moveTo(current + page),
      PageUp: () => moveTo(current - page),
      Home: () => moveTo(0),
      End: () => moveTo(shown.length - 1),
      Enter: () => shown[current] && onpick(shown[current]!),
      " ": () => shown[current] && onpick(shown[current]!),
    };
    const run = keys[event.key];
    if (!run || event.altKey || event.ctrlKey || event.metaKey) return;
    // 롤 단축키(화살표 등)로 넘어가지 않게
    event.preventDefault();
    event.stopPropagation();
    run();
  }
</script>

<section class="note-list" aria-label={t("ui.noteListTitle", { name: trackName })}>
  <header>
    <strong>{t("ui.noteListTitle", { name: trackName })}</strong>
    <span class="muted">{t("ui.noteListCount", { count: shown.length })}</span>
    <label><input type="checkbox" bind:checked={onlyPicked} /> {t("ui.noteListOnlyPicked")}</label>
    <span class="spacer"></span>
    <button class="small" onclick={onclose}>{t("ui.close")}</button>
  </header>
  <p class="muted help">{t("ui.noteListHelp")}</p>
  <ul role="listbox" aria-label={t("ui.noteListTitle", { name: trackName })} aria-multiselectable="true" bind:this={list}
    onfocusin={() => (inside = true)}
    onfocusout={(e) => {
      // 줄이 사라져 초점을 잃은 경우(relatedTarget 없음)는 목록 안에 있던 것으로 둔다
      if (e.relatedTarget !== null) inside = false;
    }}>
    {#each shown as n, k (n.id)}
      <li
        role="option"
        aria-selected={selected.has(n.id)}
        aria-label={label(n)}
        tabindex={k === current ? 0 : -1}
        class:picked={selected.has(n.id)}
        {onkeydown}
        onclick={() => {
          focus = k;
          onpick(n);
        }}
      >
        <span class="pos">{positionText(timeSig, n.start)}</span>
        <span class="pitch">{pitchText(n.pitch)}</span>
        <span class="len">{lengthText(n.dur)}</span>
        <span class="vol">v{n.vol}</span>
        <span class="tie">{n.tie === "next" ? "&" : ""}</span>
      </li>
    {:else}
      <li class="muted empty">{t("ui.noteListEmpty")}</li>
    {/each}
  </ul>
</section>

<style>
  .note-list {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .help {
    margin: 2px 0 4px;
    font-size: 0.85em;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: auto;
    max-height: 220px;
    border: 1px solid var(--line);
    border-radius: 4px;
  }
  li {
    display: grid;
    grid-template-columns: 4.5em 3.5em 3.5em 3em 1em;
    gap: 4px;
    padding: 2px 6px;
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  li:hover {
    background: var(--hover, rgba(127, 127, 127, 0.12));
  }
  li.picked {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  li:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  li.empty {
    display: block;
    cursor: default;
  }
</style>
