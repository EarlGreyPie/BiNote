<script lang="ts">
  import { staffBars, toFloat, type Song } from "@mmlce/core";
  import { staffRows } from "./staffRows";
  import { untrack } from "svelte";
  import { t } from "./i18n.svelte";
  import { loadStored, saveStored } from "./persist";
  import { drawGutter, drawStaff, loadVexFlow, type StaffDrawn, type StaffHit, type StaffRow, type VexFlowModule } from "./staffDraw";
  import { barIndexAt, barOffsets, barWidths, followSystem, keyLead, linePlace, STAFF_GUTTER, STAFF_ROW, STAFF_TOP, STAFF_ZOOM, timeToX, visibleBars, wrapBars, xToTime, type BarPlace, type TimeAnchors } from "./staffLayout";

  /**
   * 실험실 오선보 보기 (보기만). 편집기 위 칸(또는 full이면 편집 칸 전체)에 트랙마다 한 단씩 그린다. 곡은 읽기만 하고 바꾸지 않는다.
   * 위 칸은 한 줄로 이어 그려 가로로 넘기고, 편집 칸 전체(full)는 악보처럼 칸 폭에서 줄을 바꿔 세로로 넘긴다.
   * 보이는 마디(줄)만 그리고 스크롤하면 다시 그린다. 음을 누르면 그 음으로(피아노롤이 그 자리로 가고 그 음을 고른다), 빈 곳을 누르면 커서만 옮긴다
   */
  interface Props {
    song: Song;
    /** 그릴 트랙 (곡 트랙 순서) */
    trackIds: readonly string[];
    colors: ReadonlyMap<string, string>;
    volume: { readonly min: number; readonly max: number };
    /** 악기별로 MML 음보다 몇 옥타브 높게 소리 나는지 (GameProfile.soundingOctave). 음자리표 8va 표시 */
    soundingOctave?: Readonly<Record<string, number>>;
    /** 재생 중 재생선 (온음표 단위) */
    playhead: number | undefined;
    cursor: number | undefined;
    /** 테마가 바뀌면 다시 그린다 */
    themeKey: string;
    onpick: (trackId: string, noteId: string) => void;
    onseek: (at: number) => void;
    onclose: () => void;
    /** 편집 칸 전체를 쓰는 오선보 보기 (피아노롤·타브와 나란한 보기). 높이 끌기 없이 칸을 채운다. 없으면 편집기 위 칸 */
    full?: boolean;
  }

  let { song, trackIds, colors, volume, soundingOctave = {}, playhead, cursor, themeKey, onpick, onseek, onclose, full = false }: Props = $props();

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
  const rows: StaffRow[] = $derived(staffRows(song, trackIds, bars, colors, volume, soundingOctave));
  const views = $derived(rows.flatMap((r) => r.voices));
  const widths = $derived(barWidths(bars, views, zoom));
  const offsets = $derived(barOffsets(widths));
  const total = $derived(offsets[offsets.length - 1] ?? 0);
  const hidden = $derived(views.reduce((s, v) => s + v.hidden, 0));
  const approx = $derived(views.some((v) => v.measures.some((m) => m.items.some((i) => i.approx))));

  let scroller: HTMLDivElement;
  // 배치(한 줄·줄바꿈)마다 다른 칸에 묶이므로 $state로 둔다 (그리기는 untrack 안에서 읽어 이것으로 다시 그리지는 않는다)
  let paint: HTMLDivElement = $state(undefined as unknown as HTMLDivElement);
  let gutter: HTMLDivElement = $state(undefined as unknown as HTMLDivElement);
  let scrollLeft = $state(0);
  let scrollTop = $state(0);
  let viewWidth = $state(600);
  let viewHeight = $state(400);
  $effect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      viewWidth = entry.contentRect.width;
      viewHeight = entry.contentRect.height;
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
      scrollTop = scroller.scrollTop;
    });
  }

  /** 줄바꿈 배치(full)의 줄 사이 여백과 오른쪽 여백 */
  const SYSTEM_GAP = 12;
  const RIGHT_PAD = 12;
  /** 줄 하나의 높이: 템포 자리 + 단들 + 줄 사이 */
  const systemHeight = $derived(STAFF_TOP + rows.length * STAFF_ROW + SYSTEM_GAP);
  /**
   * 줄바꿈 배치 (full일 때만). 칸 폭은 10px 단위로 내려 잡아, 스크롤 막대가 생기고 없어지는 작은 폭 변화로 다시 그리지 않게 한다
   */
  const lineWidth = $derived(Math.max(160, Math.floor((viewWidth - STAFF_GUTTER - RIGHT_PAD) / 10) * 10));
  const wrapped = $derived(full ? wrapBars(widths, lineWidth, keyLead(bars)) : undefined);
  /** 마디마다 그릴 자리 (한 줄이면 이어 붙인 자리, 줄바꿈이면 줄 안 자리) */
  const place: BarPlace = $derived(wrapped ?? linePlace(widths));

  const range = $derived(visibleBars(offsets, scrollLeft, Math.max(0, viewWidth - STAFF_GUTTER), 0));
  /** 줄바꿈 배치에서 보이는 줄 [첫, 끝] */
  const systemRange = $derived.by((): readonly [number, number] | undefined => {
    const n = wrapped?.systems.length ?? 0;
    if (n === 0) return undefined;
    const first = Math.min(n - 1, Math.max(0, Math.floor(scrollTop / systemHeight)));
    const last = Math.min(n - 1, Math.max(first, Math.floor((scrollTop + viewHeight) / systemHeight)));
    return [first, last];
  });
  /** 범위가 바뀔 때만 그리게 글로 (범위 배열은 스크롤마다 새로 만들어진다) */
  const rangeKey = $derived(wrapped ? (systemRange ? `s${systemRange[0]}-${systemRange[1]}` : "") : range ? `${range[0]}-${range[1]}` : "");

  /**
   * 따로 그린 조각 (SVG 하나씩). 한 줄 배치는 마디 CHUNK개씩, 줄바꿈 배치는 줄 하나씩 (키 = 조각·줄 번호).
   * 스크롤하면 새로 보이는 조각만 그리고, 멀어진 조각은 버린다. 곡·트랙·배율·폭·테마가 바뀌면 모두 버리고 다시 그린다
   */
  const CHUNK = 4;
  const chunks = new Map<number, { el: HTMLDivElement; drawn: StaffDrawn }>();
  let anchors = $state.raw<ReadonlyMap<number, TimeAnchors>>(new Map());

  function ink() {
    const css = getComputedStyle(scroller);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return { text: v("--staff-ink", v("--text", "#1f2430")), muted: v("--muted", "#6b7280"), approx: v("--ev-marker", "#a47c12"), line: v("--staff-line", v("--muted", "#6b7280")) };
  }

  function clearChunks() {
    for (const c of chunks.values()) c.el.remove();
    chunks.clear();
  }

  /** 그린 조각의 음표 자리를 모은다 */
  function collectAnchors() {
    const all = new Map<number, TimeAnchors>();
    for (const c of chunks.values()) for (const [i, a] of c.drawn.anchors) all.set(i, a);
    anchors = all;
  }

  /** 줄바꿈 배치: 보이는 줄과 앞뒤 한 줄을 그리고(없는 것만), 그보다 먼 줄은 버린다. 줄마다 맨 앞에 음자리표·이름 칸 */
  function ensureSystems(m: VexFlowModule, w: NonNullable<typeof wrapped>, r: readonly [number, number]) {
    const from = Math.max(0, r[0] - 1);
    const to = Math.min(w.systems.length - 1, r[1] + 1);
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
      const sys = w.systems[k]!;
      const el = document.createElement("div");
      el.className = "system";
      el.style.top = `${k * systemHeight}px`;
      const head = document.createElement("div");
      head.className = "system-gutter";
      const body = document.createElement("div");
      body.className = "chunk";
      body.style.left = `${STAFF_GUTTER}px`;
      el.append(head, body);
      paint.append(el);
      drawGutter(m, head, rows, STAFF_GUTTER, colors);
      chunks.set(k, { el, drawn: drawStaff(m, body, bars, place, rows, [sys.first, sys.last], colors, true) });
      added = true;
    }
    if (added) collectAnchors();
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
      chunks.set(k, { el, drawn: drawStaff(m, el, bars, place, rows, [first, last], colors) });
      added = true;
    }
    if (added) collectAnchors();
  }

  /** 지금 배치에 맞춰 보이는 곳을 그린다 */
  function ensureVisible(m: VexFlowModule) {
    if (wrapped) {
      if (systemRange) ensureSystems(m, wrapped, systemRange);
    } else if (range) ensureChunks(m, range);
  }

  $effect(() => {
    void themeKey;
    const m = vf;
    void [bars, place, rows, systemHeight];
    untrack(() => {
      clearChunks();
      anchors = new Map();
      if (!m || rows.length === 0) return;
      try {
        ensureVisible(m);
      } catch (e) {
        console.error(e);
        failed = true;
      }
    });
  });
  $effect(() => {
    void rangeKey;
    untrack(() => {
      if (!vf || rows.length === 0 || failed) return;
      try {
        ensureVisible(vf);
      } catch (e) {
        console.error(e);
        failed = true;
      }
    });
  });
  $effect(() => () => clearChunks());
  // 한 줄 배치의 왼쪽에 붙은 음자리표·이름 칸 (줄바꿈 배치는 줄마다 그린다)
  $effect(() => {
    void themeKey;
    const m = vf;
    const data = rows;
    if (!m || data.length === 0 || full) return;
    untrack(() => drawGutter(m, gutter, data, STAFF_GUTTER, ink()));
  });

  /** 곡 시간 → 그림 자리 (x: 내용 칸 기준, system: 줄 번호, top: 그 줄 위 끝. 한 줄 배치는 0) */
  function spotOf(at: number): { x: number; system: number; top: number } {
    const x = STAFF_GUTTER + timeToX(bars, place, anchors, at);
    if (!wrapped || bars.length === 0) return { x, system: 0, top: 0 };
    const system = wrapped.systemOf[barIndexAt(bars, at)] ?? 0;
    return { x, system, top: system * systemHeight };
  }
  const playSpot = $derived(playhead === undefined ? undefined : spotOf(playhead));
  const cursorSpot = $derived(cursor === undefined ? undefined : spotOf(cursor));

  /** 줄바꿈 배치에서 마지막으로 따라간 줄 (재생이 멈추면 -1) */
  let followed = -1;
  // 재생선이 화면 밖으로 나가면 따라간다.
  // 줄바꿈 배치: 재생선이 다른 줄로 넘어갈 때 그 줄이 (칸에 들어가면 다) 보이게 세로로 넘기고, 같은 줄에 있는 동안은
  // 그 줄이 화면에서 완전히 사라졌을 때만 넘긴다. 줄이 칸보다 높아도 아래 단을 보려고 내린 스크롤을 되돌리지 않는다
  $effect(() => {
    const spot = playSpot;
    if (spot === undefined) {
      followed = -1;
      return;
    }
    untrack(() => {
      if (wrapped) {
        const to = followSystem(spot, systemHeight, scroller.scrollTop, scroller.clientHeight, followed);
        if (to !== undefined) scroller.scrollTop = to;
        followed = spot.system;
        return;
      }
      const view = scroller.clientWidth;
      if (spot.x < scroller.scrollLeft + STAFF_GUTTER || spot.x > scroller.scrollLeft + view - 24) scroller.scrollLeft = Math.max(0, spot.x - STAFF_GUTTER - 40);
    });
  });

  function onclick(event: MouseEvent) {
    const box = paint.getBoundingClientRect();
    if (wrapped) {
      // 누른 줄 안에서 찾는다 (줄 칸 기준 자리)
      const k = Math.floor((event.clientY - box.top) / systemHeight);
      const sys = wrapped.systems[k];
      if (!sys) return;
      const x = event.clientX - box.left - STAFF_GUTTER;
      const y = event.clientY - box.top - k * systemHeight;
      const hit = chunks.get(k)?.drawn.hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
      if (hit) onpick(hit.trackId, hit.noteId);
      else {
        // 줄 끝 마디선 오른쪽(늘리지 않은 줄의 빈 곳)을 누르면 그 줄 끝 바로 앞으로 (마디 끝 = 다음 줄 처음이 되지 않게)
        const right = place.left[sys.last]! + place.width[sys.last]!;
        onseek(x <= 0 ? toFloat(bars[sys.first]!.start) : xToTime(bars, place, anchors, Math.min(x, right - 1), [sys.first, sys.last]));
      }
      return;
    }
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let hit: StaffHit | undefined;
    for (const c of chunks.values()) hit ??= c.drawn.hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
    if (hit) onpick(hit.trackId, hit.noteId);
    else onseek(xToTime(bars, place, anchors, x));
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

<section class="staff" class:full style:height={full ? undefined : `${height}px`} aria-label={t("ui.staffView")}>
  <header>
    <strong>{t("ui.staffView")}</strong>
    <span class="muted note">{t("ui.staffViewOnly")}</span>
    {#if approx}<span class="approx-key" title={t("ui.staffApproxHelp")}>{t("ui.staffApprox")}</span>{/if}
    {#if hidden > 0}<span class="muted" title={t("ui.staffHiddenHelp")}>{t("ui.staffHidden", { n: hidden })}</span>{/if}
    <span class="spacer"></span>
    <button class="small" title={t("ui.staffZoomOut")} aria-label={t("ui.staffZoomOut")} disabled={zoom <= STAFF_ZOOM.min} onclick={() => setZoom(zoom / STAFF_ZOOM.step)}>−</button>
    <button class="small" title={t("ui.staffZoomIn")} aria-label={t("ui.staffZoomIn")} disabled={zoom >= STAFF_ZOOM.max} onclick={() => setZoom(zoom * STAFF_ZOOM.step)}>+</button>
    {#if !full}<button class="small" title={t("ui.close")} aria-label={t("ui.close")} onclick={onclose}>×</button>{/if}
  </header>
  {#if failed}
    <p class="muted msg">{t("ui.staffFailed")}</p>
  {:else if !vf}
    <p class="muted msg">{t("ui.staffLoading")}</p>
  {:else if rows.length === 0}
    <p class="muted msg">{t("ui.staffNoTracks")}</p>
  {/if}
  <div class="scroller" bind:this={scroller} {onscroll} class:hide={failed || !vf || rows.length === 0}>
    {#if wrapped}
      <!-- 줄바꿈 배치: 줄마다 음자리표 칸 + 마디들, 세로로 넘긴다 -->
      <div class="content" style:width="{STAFF_GUTTER + wrapped.lineWidth + RIGHT_PAD}px" style:height="{wrapped.systems.length * systemHeight}px">
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="paint wrapped" bind:this={paint} {onclick}></div>
        {#if cursorSpot !== undefined && playSpot === undefined}<div class="line cursor" style:left="{cursorSpot.x}px" style:top="{cursorSpot.top}px" style:height="{systemHeight - SYSTEM_GAP}px"></div>{/if}
        {#if playSpot !== undefined}<div class="line play" style:left="{playSpot.x}px" style:top="{playSpot.top}px" style:height="{systemHeight - SYSTEM_GAP}px"></div>{/if}
      </div>
    {:else}
      <div class="content" style:width="{STAFF_GUTTER + total + 24}px" style:height="{STAFF_TOP + rows.length * STAFF_ROW + 8}px">
        <div class="gutter" bind:this={gutter} style:width="{STAFF_GUTTER}px"></div>
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="paint" bind:this={paint} style:left="{STAFF_GUTTER}px" style:width="{total}px" {onclick}></div>
        {#if cursorSpot !== undefined && playSpot === undefined}<div class="line cursor full-height" style:left="{cursorSpot.x}px"></div>{/if}
        {#if playSpot !== undefined}<div class="line play full-height" style:left="{playSpot.x}px"></div>{/if}
      </div>
    {/if}
  </div>
  {#if !full}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize" title={t("ui.staffResize")} onpointerdown={ondown} onpointermove={onmove} onpointerup={onup} onpointercancel={onup}></div>
  {/if}
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
  /* 오선보 보기: 편집 칸을 채운다 */
  .staff.full {
    flex: 1 1 0;
    height: 100%;
    max-height: none;
    min-height: 0;
    margin-bottom: 0;
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
  /* 줄바꿈 배치: 내용 칸 전체, 줄은 absolute로 쌓는다 */
  .paint.wrapped {
    left: 0;
    right: 0;
  }
  .paint :global(.system) {
    position: absolute;
    left: 0;
    right: 0;
  }
  .paint :global(.system-gutter) {
    position: absolute;
    left: 0;
    top: 0;
  }
  .line {
    position: absolute;
    top: 0;
    width: 0;
    pointer-events: none;
    z-index: 1;
  }
  .line.full-height {
    bottom: 0;
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
