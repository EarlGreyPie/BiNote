<script lang="ts">
  import { toFloat, type GameProfile, type Rat, type Song } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { compareLoudness, SUGGEST_DB, type BarLoudness, type ReferencePower } from "./loudnessCompare";
  import { loadStored, parseJson, saveStored } from "./persist";
  import { clock } from "./time";

  /**
   * 실험실 원곡 대조 셈여림 (보기만): 마디마다 원곡과 지금 곡의 크기를 같은 폭으로 맞춰 견주고,
   * 원곡을 따라가려면 몇 dB·몇 v가 모자라거나 남는지 보여 준다. 곡은 바꾸지 않는다 (고치기는 볼륨 일괄 조정으로).
   * 크게 보기(가운데, 전체를 한눈에)와 작은 패널(떠 있어 띄운 채로 편집, 머리줄을 끌어 옮기고 접기) 두 모양이 있다.
   * 둘 다 모달이 아니라 곡을 고치면 바로 다시 센다
   */
  interface Props {
    song: Song;
    profile: Pick<GameProfile, "volume" | "volumeCurve">;
    power: ReferencePower;
    /** 원곡 어긋남(ms). 원곡 시각 = 곡 시각 + offsetMs */
    offsetMs: number;
    /** 반복 구간 (온음표 단위). 있으면 그 안만 세는 칸이 생긴다 */
    loop: readonly [number, number] | undefined;
    /** 재생선(재생 중)이나 커서 자리 (온음표 단위). 그 마디를 표시한다 */
    now: number | undefined;
    onseek: (at: Rat) => void;
    onclose: () => void;
  }

  let { song, profile, power, offsetMs, loop, now, onseek, onclose }: Props = $props();

  const PREFS_KEY = "mmlce.loudnessPanel";
  interface Prefs {
    /** big: 가운데 크게, panel: 작게 띄워 두기 */
    readonly mode: "big" | "panel";
    readonly collapsed: boolean;
    readonly onlyBig: boolean;
    /** 끌어 옮긴 자리 (px). 없으면 오른쪽 아래 */
    readonly at?: { readonly left: number; readonly top: number };
  }
  function parsePrefs(raw: unknown): Prefs {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const at = o.at as Record<string, unknown> | undefined;
    const ok = at && Number.isFinite(at.left) && Number.isFinite(at.top);
    return { mode: o.mode === "panel" ? "panel" : "big", collapsed: o.collapsed === true, onlyBig: o.onlyBig !== false, ...(ok ? { at: { left: at.left as number, top: at.top as number } } : {}) };
  }
  let prefs = $state<Prefs>(loadStored(PREFS_KEY, (raw) => parsePrefs(parseJson(raw))));
  function setPrefs(change: Partial<Prefs>) {
    prefs = { ...prefs, ...change };
    saveStored(PREFS_KEY, JSON.stringify(prefs));
  }

  let panel: HTMLDialogElement;
  let inLoop = $state(false);
  $effect(() => {
    // 모달이 아니라서 뒤의 피아노롤·타브·MML 편집기를 그대로 쓸 수 있다
    panel.show();
  });

  const result = $derived(compareLoudness(song, power, offsetMs / 1000, profile, inLoop && loop ? loop : undefined));
  const rows = $derived(prefs.onlyBig ? result.bars.filter((b) => Math.abs(b.diff) >= SUGGEST_DB) : result.bars);
  /** 재생선·커서가 있는 마디 (뺀 마디면 없음) */
  const nowBar = $derived(now === undefined ? undefined : result.bars.find((b) => toFloat(b.start) <= now + 1e-9 && now < toFloat(b.end) - 1e-9)?.bar);

  // 그래프: 가로는 마디 번호, 위는 원곡(목표)·지금 두 줄, 아래는 차이 막대
  const W = 600;
  const H = $derived(prefs.mode === "big" ? 120 : 80);
  const D = $derived(prefs.mode === "big" ? 70 : 50);
  const first = $derived(result.bars[0]?.bar ?? 1);
  const last = $derived(result.bars.at(-1)?.bar ?? 1);
  const x = (bar: number) => (last === first ? W / 2 : ((bar - first + 0.5) / (last - first + 1)) * W);
  const step = $derived(W / Math.max(1, last - first + 1));
  const range = $derived.by(() => {
    const all = result.bars.flatMap((b) => [b.current, b.target]);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    return hi - lo < 1 ? [lo - 1, hi + 1] : [lo, hi];
  });
  const y = (db: number) => H - 4 - ((db - range[0]!) / (range[1]! - range[0]!)) * (H - 8);
  const line = (pick: (b: BarLoudness) => number) => result.bars.map((b) => `${x(b.bar).toFixed(1)},${y(pick(b)).toFixed(1)}`).join(" ");
  const maxDiff = $derived(Math.max(SUGGEST_DB * 2, ...result.bars.map((b) => Math.abs(b.diff))));
  const barH = (d: number) => (Math.abs(d) / maxDiff) * (D / 2 - 2);

  /** 부호 붙인 dB (반올림해서 0이면 ±0.0, −0.0으로 보이지 않게) */
  function signed(n: number, digits = 1): string {
    const text = Math.abs(n).toFixed(digits);
    return (Number(text) === 0 ? "±" : n > 0 ? "+" : "−") + text;
  }
  const corr = (r: number | undefined) => (r === undefined ? "—" : r.toFixed(2));
  function suggestText(b: BarLoudness): string {
    if (b.suggest === undefined) return "";
    if (b.suggest === 0) return t("ui.loudnessAtEdge", { vol: b.baseVol });
    return `v${b.baseVol} → v${b.baseVol + b.suggest} (${b.suggest > 0 ? "+" : "−"}${Math.abs(b.suggest)})`;
  }
  /** 그 마디로 커서를 옮긴다 (패널은 그대로 둔다) */
  function go(b: BarLoudness) {
    onseek(b.start);
  }

  // 머리줄 끌어 옮기기. 화면 밖으로 나가지 않게 막는다
  let drag: { dx: number; dy: number; id: number } | undefined;
  function clampAt(left: number, top: number): { left: number; top: number } {
    const r = panel.getBoundingClientRect();
    return { left: Math.max(0, Math.min(window.innerWidth - r.width, left)), top: Math.max(0, Math.min(window.innerHeight - 40, top)) };
  }
  function dragStart(e: PointerEvent) {
    if (prefs.mode !== "panel" || (e.target as HTMLElement).closest("button")) return;
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function dragMove(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    prefs = { ...prefs, at: clampAt(e.clientX - drag.dx, e.clientY - drag.dy) };
  }
  function dragEnd(e: PointerEvent) {
    if (!drag || drag.id !== e.pointerId) return;
    drag = undefined;
    setPrefs({});
  }
  // 창 크기가 바뀌어 옮긴 자리가 화면 밖이 되면 안으로 들인다
  $effect(() => {
    const fit = () => {
      if (prefs.at) prefs = { ...prefs, at: clampAt(prefs.at.left, prefs.at.top) };
    };
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });
</script>

<dialog
  bind:this={panel}
  class="panel"
  class:big={prefs.mode === "big"}
  class:moved={prefs.mode === "panel" && !!prefs.at}
  style={prefs.mode === "panel" && prefs.at ? `left: ${prefs.at.left}px; top: ${prefs.at.top}px;` : ""}
  aria-label={t("ui.labLoudness")}
  {onclose}
>
  <header role="group" onpointerdown={dragStart} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={dragEnd} title={prefs.mode === "panel" ? t("ui.loudnessDrag") : undefined}>
    <h2>{t("ui.labLoudness")}</h2>
    {#if result.bars.length >= 3}
      <span class="muted small">{t("ui.loudnessCorrShort", { bar: corr(result.corrBar), four: corr(result.corr4) })}</span>
    {/if}
    <span class="spacer"></span>
    {#if prefs.mode === "big"}
      <button title={t("ui.loudnessToPanelHelp")} onclick={() => setPrefs({ mode: "panel" })}>{t("ui.loudnessToPanel")}</button>
    {:else}
      <button class="icon" title={t("ui.loudnessToBig")} aria-label={t("ui.loudnessToBig")} onclick={() => setPrefs({ mode: "big", collapsed: false })}>⤢</button>
    {/if}
    {#if prefs.mode === "panel"}<button class="icon" title={prefs.collapsed ? t("ui.loudnessExpand") : t("ui.loudnessCollapse")} aria-label={prefs.collapsed ? t("ui.loudnessExpand") : t("ui.loudnessCollapse")} onclick={() => setPrefs({ collapsed: !prefs.collapsed })}>{prefs.collapsed ? "▴" : "▾"}</button>{/if}
    <button class="icon" title={t("ui.close")} aria-label={t("ui.close")} onclick={() => panel.close()}>✕</button>
  </header>
  {#if prefs.mode === "big"}<p class="muted small">{t("ui.loudnessTempoNote")}</p>{/if}
  {#if result.bars.length < 3}
    <p class="warn">{t("ui.loudnessTooFew")}</p>
  {:else}
    <svg class="graph diff" viewBox="0 0 {W} {D}" preserveAspectRatio="none" role="img" aria-label={t("ui.loudnessDiff")}>
      <line class="zero" x1="0" x2={W} y1={D / 2} y2={D / 2} />
      {#if nowBar !== undefined}<rect class="now" x={x(nowBar) - step / 2} width={step} y="0" height={D} />{/if}
      {#each result.bars as b (b.bar)}
        <rect
          class:up={b.diff > 0}
          class:down={b.diff < 0}
          class:small={Math.abs(b.diff) < SUGGEST_DB}
          x={x(b.bar) - Math.max(1, step * 0.35)}
          width={Math.max(2, step * 0.7)}
          y={b.diff > 0 ? D / 2 - barH(b.diff) : D / 2}
          height={Math.max(0.5, barH(b.diff))}
          role="button"
          tabindex="-1"
          onclick={() => go(b)}
          onkeydown={() => {}}
        >
          <title>{t("ui.loudnessBarTip", { bar: b.bar, diff: signed(b.diff) })}</title>
        </rect>
      {/each}
    </svg>
    {#if prefs.mode === "big" || !prefs.collapsed}
      <div class="legend small">
        <span><i class="swatch target"></i>{t("ui.loudnessTarget")}</span>
        <span><i class="swatch current"></i>{t("ui.loudnessCurrent")}</span>
        <span class="muted">{t("ui.loudnessBars", { from: first, to: last })}</span>
      </div>
      <svg class="graph" viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label={t("ui.labLoudness")}>
        {#if nowBar !== undefined}<rect class="now" x={x(nowBar) - step / 2} width={step} y="0" height={H} />{/if}
        <polyline class="target" points={line((b) => b.target)} />
        <polyline class="current" points={line((b) => b.current)} />
      </svg>
      <div class="row small">
        <label><input type="checkbox" checked={prefs.onlyBig} onchange={(e) => setPrefs({ onlyBig: e.currentTarget.checked })} /> {t("ui.loudnessOnlyBig", { db: SUGGEST_DB })}</label>
        {#if loop}
          <label><input type="checkbox" bind:checked={inLoop} /> {t("ui.loudnessInLoop")}</label>
        {/if}
        <span class="muted">{t("ui.loudnessOffset", { ms: Math.round(offsetMs) })}</span>
      </div>
      <div class="table">
        <table>
          <thead>
            <tr>
              <th>{t("ui.loudnessColBar")}</th>
              <th>{t("ui.loudnessColTime")}</th>
              <th>{t("ui.loudnessColDiff")}</th>
              <th>{t("ui.loudnessColSuggest")}</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as b (b.bar)}
              <tr class:now={b.bar === nowBar}>
                <td><button class="link" title={t("ui.loudnessGo")} onclick={() => go(b)}>{b.bar}</button></td>
                <td>{clock(Math.max(0, b.refSeconds))}</td>
                <td class:up={b.diff >= SUGGEST_DB} class:down={b.diff <= -SUGGEST_DB}>{signed(b.diff)} dB</td>
                <td>{suggestText(b)}</td>
              </tr>
            {:else}
              <tr><td colspan="4" class="muted">{t("ui.loudnessNoBig")}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="small muted">
        {t("ui.loudnessSummary", { bars: result.bars.length, bar: corr(result.corrBar), four: corr(result.corr4) })}
        {#if result.skipped > 0}{t("ui.loudnessSkipped", { count: result.skipped })}{/if}
      </p>
      <details class="small muted" open={prefs.mode === "big"}>
        <summary>{t("ui.loudnessAbout")}</summary>
        <p>{t("ui.loudnessIntro")}</p>
        <p>{t("ui.loudnessHow")}</p>
      </details>
    {/if}
  {/if}
</dialog>

<style>
  .panel {
    position: fixed;
    inset: auto 16px 40px auto;
    margin: 0;
    width: min(460px, calc(100vw - 32px));
    max-height: calc(100vh - 80px);
    overflow: auto;
    z-index: 40;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0 12px 10px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.3);
  }
  .panel.moved {
    inset: auto;
  }
  .panel.big {
    inset: 0;
    margin: auto;
    width: min(640px, calc(100vw - 32px));
    height: fit-content;
    max-height: calc(100vh - 32px);
  }
  .panel.big header {
    cursor: default;
  }
  .panel.big .graph {
    height: 120px;
  }
  .panel.big .graph.diff {
    height: 70px;
  }
  .panel.big .table {
    max-height: 240px;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0 6px;
    background: var(--panel);
    cursor: move;
    touch-action: none;
    user-select: none;
  }
  h2 {
    margin: 0;
    font-size: 0.95rem;
  }
  header > * {
    flex-shrink: 0;
  }
  header h2,
  header > .muted {
    white-space: nowrap;
  }
  header > .muted {
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .icon {
    min-width: 28px;
    padding: 2px 6px;
    cursor: pointer;
  }
  p {
    margin: 6px 0;
  }
  details p {
    margin: 4px 0;
  }
  summary {
    cursor: pointer;
  }
  .row,
  .legend {
    display: flex;
    align-items: center;
    gap: 6px 12px;
    flex-wrap: wrap;
    margin: 6px 0;
  }
  .swatch {
    display: inline-block;
    width: 14px;
    height: 3px;
    margin-right: 4px;
    vertical-align: middle;
  }
  .swatch.target {
    background: var(--accent);
  }
  .swatch.current {
    background: var(--muted);
  }
  .graph {
    display: block;
    width: 100%;
    height: 80px;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--bg);
  }
  .graph.diff {
    height: 50px;
  }
  polyline {
    fill: none;
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  polyline.target {
    stroke: var(--accent);
  }
  polyline.current {
    stroke: var(--muted);
  }
  .zero {
    stroke: var(--line);
    vector-effect: non-scaling-stroke;
  }
  rect {
    cursor: pointer;
  }
  rect.now {
    fill: var(--text);
    opacity: 0.12;
    pointer-events: none;
  }
  rect.up {
    fill: var(--accent);
  }
  rect.down {
    fill: var(--danger);
  }
  rect.small {
    opacity: 0.35;
  }
  .table {
    max-height: 180px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
    font-size: 0.9rem;
  }
  th,
  td {
    padding: 2px 8px;
    text-align: left;
    border-bottom: 1px solid var(--line);
  }
  th {
    position: sticky;
    top: 0;
    background: var(--panel);
  }
  tr.now td {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }
  td.up {
    color: var(--accent);
  }
  td.down {
    color: var(--danger);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .spacer {
    flex: 1;
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 0.85rem;
  }
  .warn {
    color: var(--danger);
  }
</style>
