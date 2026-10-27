<script lang="ts">
  import { staffBars, staffTrack, type Song } from "@mmlce/core";
  import { untrack } from "svelte";
  import { t } from "./i18n.svelte";
  import { loadStored, saveStored } from "./persist";
  import { drawGutter, drawStaff, loadVexFlow, type StaffDrawn, type StaffHit, type StaffRow, type VexFlowModule } from "./staffDraw";
  import { barOffsets, barWidths, STAFF_GUTTER, STAFF_ROW, STAFF_TOP, STAFF_ZOOM, timeToX, visibleBars, xToTime, type TimeAnchors } from "./staffLayout";

  /**
   * 실험실 오선보 보기 (보기만). 편집기 위 칸에 트랙마다 한 단씩 그린다. 곡은 읽기만 하고 바꾸지 않는다.
   * 보이는 마디만 그리고 스크롤하면 다시 그린다. 음을 누르면 그 음으로(피아노롤이 그 자리로 가고 그 음을 고른다), 빈 곳을 누르면 커서만 옮긴다
   */
  interface Props {
    song: Song;
    /** 그릴 트랙 (곡 트랙 순서) */
    trackIds: readonly string[];
    colors: ReadonlyMap<string, string>;
    volume: { readonly min: number; readonly max: number };
    /** 재생 중 재생선 (온음표 단위) */
    playhead: number | undefined;
    cursor: number | undefined;
    /** 테마가 바뀌면 다시 그린다 */
    themeKey: string;
    onpick: (trackId: string, noteId: string) => void;
    onseek: (at: number) => void;
    onclose: () => void;
  }

  let { song, trackIds, colors, volume, playhead, cursor, themeKey, onpick, onseek, onclose }: Props = $props();

  const ZOOM_KEY = "mmlce.staffZoom";
  const HEIGHT_KEY = "mmlce.staffHeight";
  let zoom = $state(loadStored(ZOOM_KEY, (raw) => {
    const z = Number(raw);
    return raw !== null && Number.isFinite(z) ? Math.min(STAFF_ZOOM.max, Math.max(STAFF_ZOOM.min, z)) : 1;
  }));
  let height = $state(loadStored(HEIGHT_KEY, (raw) => {
    const h = Number(raw);
    return raw !== null && Number.isFinite(h) && h >= 120 ? h : 260;
  }));
  function setZoom(z: number) {
    zoom = Math.min(STAFF_ZOOM.max, Math.max(STAFF_ZOOM.min, Math.round(z * 100) / 100));
    saveStored(ZOOM_KEY, String(zoom));
  }

  let vf = $state.raw<VexFlowModule | undefined>(undefined);
  let failed = $state(false);
  $effect(() => {
    loadVexFlow().then(
      (m) => (vf = m),
      () => (failed = true),
    );
  });

  const bars = $derived(staffBars(song));
  const rows: StaffRow[] = $derived(
    trackIds.flatMap((id) => {
      const tr = song.tracks.find((x) => x.id === id);
      return tr ? [{ trackId: id, name: tr.name, color: colors.get(id) ?? "currentColor", view: staffTrack(tr.notes, bars, volume) }] : [];
    }),
  );
  const widths = $derived(barWidths(bars, rows.map((r) => r.view), zoom));
  const offsets = $derived(barOffsets(widths));
  const total = $derived(offsets[offsets.length - 1] ?? 0);
  const hidden = $derived(rows.reduce((s, r) => s + r.view.hidden, 0));
  const approx = $derived(rows.some((r) => r.view.measures.some((m) => m.items.some((i) => i.approx))));

  let scroller: HTMLDivElement;
  let paint: HTMLDivElement;
  let gutter: HTMLDivElement;
  let scrollLeft = $state(0);
  let viewWidth = $state(600);
  $effect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) viewWidth = entry.contentRect.width;
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  });
  let frame = 0;
  function onscroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      scrollLeft = scroller.scrollLeft;
    });
  }

  const range = $derived(visibleBars(offsets, scrollLeft, Math.max(0, viewWidth - STAFF_GUTTER), 0));
  /** 범위가 바뀔 때만 그리게 글로 (범위 배열은 스크롤마다 새로 만들어진다) */
  const rangeKey = $derived(range ? `${range[0]}-${range[1]}` : "");

  /**
   * 마디 CHUNK개씩 따로 그린 조각 (SVG 하나씩). 스크롤하면 새로 보이는 조각만 그리고, 멀어진 조각은 버린다.
   * 곡·트랙·배율·테마가 바뀌면 모두 버리고 다시 그린다
   */
  const CHUNK = 4;
  const chunks = new Map<number, { el: HTMLDivElement; drawn: StaffDrawn }>();
  let anchors = $state.raw<ReadonlyMap<number, TimeAnchors>>(new Map());

  function ink() {
    const css = getComputedStyle(scroller);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return { text: v("--text", "#1f2430"), muted: v("--muted", "#6b7280"), approx: v("--ev-marker", "#a47c12") };
  }

  function clearChunks() {
    for (const c of chunks.values()) c.el.remove();
    chunks.clear();
  }

  /** 보이는 마디가 든 조각을 그리고(없는 것만), 앞뒤 한 조각보다 먼 조각은 버린다 */
  function ensureChunks(m: VexFlowModule, r: readonly [number, number]) {
    const from = Math.floor(r[0] / CHUNK);
    const to = Math.floor(r[1] / CHUNK);
    for (const [k, c] of chunks) {
      if (k < from - 1 || k > to + 1) {
        c.el.remove();
        chunks.delete(k);
      }
    }
    let added = false;
    const colors = ink();
    for (let k = from; k <= to; k++) {
      if (chunks.has(k)) continue;
      const first = k * CHUNK;
      const last = Math.min(bars.length - 1, first + CHUNK - 1);
      const el = document.createElement("div");
      el.className = "chunk";
      el.style.left = `${offsets[first]}px`;
      paint.append(el);
      chunks.set(k, { el, drawn: drawStaff(m, el, bars, offsets, widths, rows, [first, last], colors) });
      added = true;
    }
    if (added) {
      const all = new Map<number, TimeAnchors>();
      for (const c of chunks.values()) for (const [i, a] of c.drawn.anchors) all.set(i, a);
      anchors = all;
    }
  }

  $effect(() => {
    void themeKey;
    const m = vf;
    void [bars, offsets, widths, rows];
    untrack(() => {
      clearChunks();
      anchors = new Map();
      const r = range;
      if (!m || !r || rows.length === 0) return;
      try {
        ensureChunks(m, r);
      } catch (e) {
        console.error(e);
        failed = true;
      }
    });
  });
  $effect(() => {
    void rangeKey;
    untrack(() => {
      const r = range;
      if (!vf || !r || rows.length === 0 || failed) return;
      try {
        ensureChunks(vf, r);
      } catch (e) {
        console.error(e);
        failed = true;
      }
    });
  });
  $effect(() => () => clearChunks());
  $effect(() => {
    void themeKey;
    const m = vf;
    const data = rows;
    if (!m || data.length === 0) return;
    untrack(() => drawGutter(m, gutter, data, STAFF_GUTTER, ink()));
  });

  const xOf = (at: number) => STAFF_GUTTER + timeToX(bars, offsets, anchors, at);
  const playX = $derived(playhead === undefined ? undefined : xOf(playhead));
  const cursorX = $derived(cursor === undefined ? undefined : xOf(cursor));

  // 재생선이 화면 밖으로 나가면 따라간다
  $effect(() => {
    const x = playX;
    if (x === undefined) return;
    untrack(() => {
      const view = scroller.clientWidth;
      if (x < scroller.scrollLeft + STAFF_GUTTER || x > scroller.scrollLeft + view - 24) scroller.scrollLeft = Math.max(0, x - STAFF_GUTTER - 40);
    });
  });

  function onclick(event: MouseEvent) {
    const box = paint.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let hit: StaffHit | undefined;
    for (const c of chunks.values()) hit ??= c.drawn.hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
    if (hit) onpick(hit.trackId, hit.noteId);
    else onseek(xToTime(bars, offsets, anchors, x));
  }

  // 칸 높이 끌기
  let drag: { y: number; h: number } | undefined;
  function ondown(event: PointerEvent) {
    drag = { y: event.clientY, h: height };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function onmove(event: PointerEvent) {
    if (drag) height = Math.max(120, Math.min(900, drag.h + event.clientY - drag.y));
  }
  function onup() {
    if (!drag) return;
    drag = undefined;
    saveStored(HEIGHT_KEY, String(Math.round(height)));
  }
</script>

<section class="staff" style:height="{height}px" aria-label={t("ui.staffView")}>
  <header>
    <strong>{t("ui.staffView")}</strong>
    <span class="muted note">{t("ui.staffViewOnly")}</span>
    {#if approx}<span class="approx-key" title={t("ui.staffApproxHelp")}>{t("ui.staffApprox")}</span>{/if}
    {#if hidden > 0}<span class="muted" title={t("ui.staffHiddenHelp")}>{t("ui.staffHidden", { n: hidden })}</span>{/if}
    <span class="spacer"></span>
    <button class="small" title={t("ui.staffZoomOut")} aria-label={t("ui.staffZoomOut")} disabled={zoom <= STAFF_ZOOM.min} onclick={() => setZoom(zoom / STAFF_ZOOM.step)}>−</button>
    <button class="small" title={t("ui.staffZoomIn")} aria-label={t("ui.staffZoomIn")} disabled={zoom >= STAFF_ZOOM.max} onclick={() => setZoom(zoom * STAFF_ZOOM.step)}>+</button>
    <button class="small" title={t("ui.close")} aria-label={t("ui.close")} onclick={onclose}>×</button>
  </header>
  {#if failed}
    <p class="muted msg">{t("ui.staffFailed")}</p>
  {:else if !vf}
    <p class="muted msg">{t("ui.staffLoading")}</p>
  {:else if rows.length === 0}
    <p class="muted msg">{t("ui.staffNoTracks")}</p>
  {/if}
  <div class="scroller" bind:this={scroller} {onscroll} class:hide={failed || !vf || rows.length === 0}>
    <div class="content" style:width="{STAFF_GUTTER + total + 24}px" style:height="{STAFF_TOP + rows.length * STAFF_ROW + 8}px">
      <div class="gutter" bind:this={gutter} style:width="{STAFF_GUTTER}px"></div>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="paint" bind:this={paint} style:left="{STAFF_GUTTER}px" style:width="{total}px" {onclick}></div>
      {#if cursorX !== undefined && playX === undefined}<div class="line cursor" style:left="{cursorX}px"></div>{/if}
      {#if playX !== undefined}<div class="line play" style:left="{playX}px"></div>{/if}
    </div>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize" title={t("ui.staffResize")} onpointerdown={ondown} onpointermove={onmove} onpointerup={onup} onpointercancel={onup}></div>
</section>

<style>
  .staff {
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 120px;
    /* 편집기 칸을 다 가리지 않게 */
    max-height: 65%;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--panel);
    margin-bottom: 4px;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 6px;
    border-bottom: 1px solid var(--line);
    font-size: 0.9em;
    flex-wrap: wrap;
  }
  .note {
    font-size: 0.9em;
  }
  .approx-key {
    color: var(--ev-marker);
    font-size: 0.9em;
  }
  .spacer {
    flex: 1;
  }
  .small {
    min-width: 28px;
    padding: 0 6px;
  }
  .msg {
    margin: 8px;
  }
  .scroller {
    flex: 1 1 0;
    min-height: 0;
    overflow: auto;
    position: relative;
  }
  .scroller.hide {
    display: none;
  }
  .content {
    position: relative;
  }
  .gutter {
    position: sticky;
    left: 0;
    z-index: 2;
    height: 100%;
    background: var(--panel);
  }
  .paint {
    position: absolute;
    top: 0;
    bottom: 0;
    cursor: pointer;
  }
  .paint :global(.chunk) {
    position: absolute;
    top: 0;
  }
  .line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    pointer-events: none;
    z-index: 1;
  }
  .line.play {
    border-left: 2px solid var(--accent);
  }
  .line.cursor {
    border-left: 1px dashed var(--accent);
  }
  .resize {
    flex: none;
    height: 8px;
    cursor: ns-resize;
    touch-action: none;
    background: linear-gradient(var(--muted), var(--muted)) center / 48px 2px no-repeat;
  }
</style>
