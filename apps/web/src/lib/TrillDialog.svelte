<script lang="ts">
  import { canWriteExactly, optimizeMml } from "@mmlce/mml";
  import { add, cmp, planTrill, positionToSeconds, toFloat, TRILL_VOLUME_DEPTH_LIMIT, TRILL_VOLUME_PATTERNS, type GameProfile, type Note, type Rat, type Song, type TrillResult, type TrillVolumePattern } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { lengthLabel } from "./Toolbar.svelte";
  import { lengthsFor, noteLengthOf } from "./roll";
  import { DEFAULT_TRILL, formatTrillInput, parseTrillChoice, parseTrillInput, TRILL_KEY, TRILL_LENGTHS, type TrillChoice, type TrillLength } from "./trillOptions";
  import { loadStored, parseJson, saveStored } from "./persist";

  /**
   * 트릴·트레몰로 창 (편집 메뉴): 고른 음을 같은 길이의 짧은 음 여러 개로 나눈다. 트릴은 상대 음을 타브에서는 본음 줄의 프렛 번호,
   * 피아노롤에서는 본음 기준 반음 수로 받는다. 고르기를 바꿀 때마다 결과를 다시 계산해 미리 보여 주고, 늘어나는 글자 수를 알려 준다
   */
  interface Props {
    song: Song;
    picked: readonly Note[];
    profile: GameProfile;
    locked: ReadonlySet<string>;
    /** 타브에서 열었으면 기준 본음(첫 본음)의 프렛과 그 줄 (상대 음을 프렛 번호로 받는다). 없으면 반음 수 */
    tab?: { readonly fret: number; readonly string: number; readonly maxFret: number };
    /** 나눈 음을 놓을 타브 줄 (본음이 보이는 줄) */
    stringOf?: (note: Note) => number | undefined;
    /** 트랙이 실제로 소리 내는 악기 */
    instrumentOf: (trackId: string) => string | undefined;
    /** 다시 고치기: 만들 때 고른 것 (없으면 이 브라우저에 기억해 둔 값) */
    initial?: TrillChoice | undefined;
    /** 창 제목 (다시 고치기) */
    title?: string | undefined;
    /** 다시 고치기: 창을 닫고 원래 음으로 되돌린다 (있으면 "원래대로" 버튼) */
    onrestore?: (() => void) | undefined;
    /** 적용: 결과와 만든 기록에 남길 고른 것 */
    onapply: (result: TrillResult, choice: TrillChoice) => void;
    onclose: () => void;
  }

  let { song, picked, profile, locked, tab, stringOf, instrumentOf, initial, title, onrestore, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let choice = $state<TrillChoice>(initial ?? loadStored(TRILL_KEY, (raw) => parseTrillChoice(parseJson(raw))));
  function set(change: Partial<TrillChoice>) {
    choice = { ...choice, ...change };
    saveStored(TRILL_KEY, JSON.stringify(choice));
  }
  $effect(() => {
    dialog.showModal();
  });

  // 상대 음 입력: 처음에는 기억해 둔 간격을 이 본음 기준으로 (타브 줄 밖이면 기본 간격, 그것도 밖이면 아래로)
  // svelte-ignore state_referenced_locally
  let text = $state(formatTrillInput(choice.offset, tab) ?? formatTrillInput(DEFAULT_TRILL.offset, tab) ?? formatTrillInput(-DEFAULT_TRILL.offset, tab) ?? "");
  const offset = $derived(choice.kind === "tremolo" ? DEFAULT_TRILL.offset : parseTrillInput(text, tab));
  $effect(() => {
    if (choice.kind === "trill" && offset !== undefined && offset !== choice.offset) set({ offset });
  });

  /** 게임이 받는 길이만 */
  const lengths = $derived(lengthsFor<TrillLength>(profile.length, TRILL_LENGTHS));
  const length = $derived(lengths.includes(choice.length) ? choice.length : (lengths[0] ?? "32"));
  const unit = $derived(noteLengthOf(length, 1));
  const canWrite = (r: Rat) => canWriteExactly(r, profile.length);

  const result = $derived.by(() => {
    const used = new Set(song.tracks.flatMap((tr) => tr.notes.map((n) => n.id)));
    let k = 0;
    const newId = () => {
      let id: string;
      do id = `tr${++k}`;
      while (used.has(id));
      used.add(id);
      return id;
    };
    return planTrill(
      song,
      picked,
      {
        kind: choice.kind,
        offset: offset ?? 0,
        length: unit,
        startOther: choice.startOther,
        endOnMain: choice.endOnMain,
        tie: choice.tie,
        staccato: choice.staccato,
        ...(choice.volumePattern !== "same" || choice.volumeLower !== 0 ? { volume: { pattern: choice.volumePattern, depth: choice.volumeDepth, lower: choice.volumeLower } } : {}),
        canWrite,
        locked,
        instrumentOf,
        ...(stringOf ? { stringOf } : {}),
      },
      profile,
      newId,
    );
  });

  // 빠르기: 첫 본음 자리에서 음 하나가 걸리는 시간으로 초당 몇 번인지와 그 자리 템포
  // 빠름 기준: 고른 음 트랙 악기 가운데 가장 낮은 값 (바이올린·플루트처럼 지속음 악기는 더 일찍 흐려진다)
  const fastRate = $derived.by(() => {
    const ids = new Set(picked.map((n) => n.id));
    let low = Infinity;
    for (const tr of song.tracks) {
      if (!tr.notes.some((n) => ids.has(n.id))) continue;
      const instrument = instrumentOf(tr.id);
      low = Math.min(low, (instrument !== undefined ? profile.ornamentFastRateByInstrument[instrument] : undefined) ?? profile.ornamentFastRate);
    }
    return Number.isFinite(low) ? low : profile.ornamentFastRate;
  });
  const rate = $derived.by(() => {
    if (picked.length === 0) return undefined;
    const from = picked.reduce<Rat>((m, n) => (cmp(n.start, m) < 0 ? n.start : m), picked[0]!.start);
    const sec = positionToSeconds(song.tempo, add(from, unit)) - positionToSeconds(song.tempo, from);
    if (!(sec > 0)) return undefined;
    return { n: Math.round(10 / sec) / 10, bpm: Math.round((toFloat(unit) * 240) / sec) };
  });

  // 글자 수: 바뀐 트랙 글을 적용 전후로 출력해 잰 차이 (최적화 출력 기준)
  const chars = $derived.by(() => {
    if (result.changes.length === 0) return undefined;
    let delta = 0;
    let over = false;
    for (const c of result.changes) {
      const track = song.tracks.find((tr) => tr.id === c.trackId);
      if (!track) continue;
      const after = optimizeMml(c.notes, { lengths: profile.length }).text.length;
      delta += after - optimizeMml(track.notes, { lengths: profile.length }).text.length;
      if (after > profile.charLimitPerScore) over = true;
    }
    return { delta, over };
  });

  // 미리 보기: 고른 음 구간의 바뀐 트랙 음을 작은 롤로 (나눈 음은 강조)
  const W = 400;
  const H = 110;
  const preview = $derived.by(() => {
    if (result.changes.length === 0 || picked.length === 0) return undefined;
    const from = toFloat(picked.reduce<Rat>((m, n) => (cmp(n.start, m) < 0 ? n.start : m), picked[0]!.start));
    const to = Math.max(...picked.map((n) => toFloat(n.start) + toFloat(n.dur)));
    const on = new Set(result.ids);
    const notes = result.changes.flatMap((c) => c.notes).filter((n) => toFloat(n.start) < to && toFloat(n.start) + toFloat(n.dur) > from);
    if (notes.length === 0) return undefined;
    const lo = Math.min(...notes.map((n) => n.pitch)) - 1;
    const hi = Math.max(...notes.map((n) => n.pitch)) + 1;
    const x = (at: number) => ((Math.max(from, at) - from) / Math.max(1e-9, to - from)) * W;
    const row = H / (hi - lo + 1);
    return notes.map((n) => ({
      x: x(toFloat(n.start)),
      w: Math.max(1, x(Math.min(to, toFloat(n.start) + toFloat(n.dur))) - x(toFloat(n.start)) - 1),
      y: (hi - n.pitch) * row,
      h: Math.max(2, row - 1),
      on: on.has(n.id),
    }));
  });

  const ok = $derived(offset !== undefined && result.made > 0);
  function apply() {
    if (!ok) return;
    onapply(result, { ...choice, length, ...(offset !== undefined && choice.kind === "trill" ? { offset } : {}) });
    dialog.close();
  }
  const s = $derived(result.skipped);
  /** v 모양 이름 */
  const PATTERN_KEY = {
    same: "ui.trillVolSame",
    alternate: "ui.trillVolAlternate",
    accentFirst: "ui.trillVolAccentFirst",
    accentBeat: "ui.trillVolAccentBeat",
    crescendo: "ui.trillVolCrescendo",
    decrescendo: "ui.trillVolDecrescendo",
  } as const satisfies Record<TrillVolumePattern, string>;
  /** 0~한도 정수 입력 */
  const steps = (raw: string) => Math.min(TRILL_VOLUME_DEPTH_LIMIT, Math.max(0, Math.round(Number(raw) || 0)));
  const trill = $derived(choice.kind === "trill");
  // &로 잇기는 트릴에서만, 끊어 치기와는 함께 쓰지 않는다 (planTrill과 같은 조건)
  const tieOn = $derived(trill && choice.tie && !choice.staccato);
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{title ?? t("ui.trill")}</h2>
  <div class="grid">
    <span>{t("ui.trillKind")}</span>
    <span class="row">
      <label>
        <input type="radio" name="trill-kind" checked={trill} onchange={() => set({ kind: "trill" })} />
        {t("ui.trillKindTrill")} <small class="muted">({t("ui.trillKindTrillHint")})</small>
      </label>
      <label>
        <input type="radio" name="trill-kind" checked={!trill} onchange={() => set({ kind: "tremolo" })} />
        {t("ui.trillKindTremolo")} <small class="muted">({t("ui.trillKindTremoloHint")})</small>
      </label>
    </span>
    {#if trill}
      <span>{tab ? t("ui.trillFret") : t("ui.trillSemitones")}</span>
      <span class="row">
        <input class="pitch" type="text" inputmode={tab ? "numeric" : "text"} bind:value={text} aria-invalid={offset === undefined} />
        <small class="muted">{tab ? t("ui.trillFretHint", { string: tab.string, fret: tab.fret }) : t("ui.trillSemitonesHint")}</small>
      </span>
    {/if}
    <span>{t("ui.trillLength")}</span>
    <span class="row">
      <select value={length} onchange={(e) => set({ length: e.currentTarget.value as TrillLength })}>
        {#each lengths as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
      </select>
      {#if rate}<small class="muted">{t("ui.trillRate", { n: rate.n, bpm: rate.bpm })}</small>{/if}
    </span>
    {#if rate && rate.n > fastRate}
      <span></span>
      <small class="warn">{t("ui.trillFast", { n: fastRate })}</small>
    {/if}
    <span>{t("ui.trillVolume")}</span>
    <span class="row">
      <select value={choice.volumePattern} disabled={tieOn} title={tieOn ? t("ui.trillVolTie") : undefined} onchange={(e) => set({ volumePattern: e.currentTarget.value as TrillVolumePattern })}>
        {#each TRILL_VOLUME_PATTERNS as p (p)}<option value={p}>{t(PATTERN_KEY[p])}</option>{/each}
      </select>
      {#if choice.volumePattern !== "same" && !tieOn}
        <label>{t("ui.trillVolDepth")} <input class="num" type="number" min="0" max={TRILL_VOLUME_DEPTH_LIMIT} value={choice.volumeDepth} onchange={(e) => set({ volumeDepth: steps(e.currentTarget.value) })} /></label>
      {/if}
      <span class="row" title={t("ui.trillVolLowerHelp")}>
        {t("ui.trillVolLower")}
        <label
          ><input type="checkbox" checked={choice.volumeLower === "auto"} onchange={(e) => set({ volumeLower: e.currentTarget.checked ? "auto" : profile.ornamentRepeatLower.single })} />
          {t("ui.trillVolLowerAuto", { single: profile.ornamentRepeatLower.single, chord: profile.ornamentRepeatLower.chord })}</label
        >
        {#if choice.volumeLower !== "auto"}
          <input class="num" type="number" min="0" max={TRILL_VOLUME_DEPTH_LIMIT} value={choice.volumeLower} onchange={(e) => set({ volumeLower: steps(e.currentTarget.value) })} />
        {/if}
      </span>
    </span>
    {#if tieOn && choice.volumePattern !== "same"}
      <span></span>
      <small class="muted">{t("ui.trillVolTie")}</small>
    {/if}
    <span></span>
    <label title={t("ui.trillStaccatoHelp")}><input type="checkbox" checked={choice.staccato} onchange={(e) => set({ staccato: e.currentTarget.checked })} /> {t("ui.trillStaccato")}</label>
    {#if trill}
      <span></span>
      <span class="row">
        <label><input type="checkbox" checked={choice.startOther} onchange={(e) => set({ startOther: e.currentTarget.checked })} /> {t("ui.trillStartOther")}</label>
        <label><input type="checkbox" checked={choice.endOnMain} onchange={(e) => set({ endOnMain: e.currentTarget.checked })} /> {t("ui.trillEndOnMain")}</label>
      </span>
      <span></span>
      <label><input type="checkbox" checked={choice.tie} disabled={choice.staccato} onchange={(e) => set({ tie: e.currentTarget.checked })} /> {t("ui.trillTie")}</label>
    {/if}
  </div>
  <svg class="preview" viewBox="0 0 {W} {H}" role="img" aria-label={t("ui.arpPreview")}>
    {#if preview}
      {#each preview as r, i (i)}<rect x={r.x} y={r.y} width={r.w} height={r.h} rx="1.5" class:on={r.on} />{/each}
    {/if}
  </svg>
  {#if offset === undefined}
    <p class="warn">{tab ? t("ui.trillBadFret", { max: tab.maxFret }) : t("ui.trillBadSemitones")}</p>
  {:else}
    {#if result.made > 0}
      <p class="muted">
        {t("ui.trillMade", { n: result.made, count: result.pieces })}{#if chars}{` · ${t("ui.slideChars", { n: chars.delta })}`}{/if}
      </p>
    {:else}
      <p class="warn">{t("ui.trillNone")}</p>
    {/if}
    {#if chars?.over}<p class="warn">{t("ui.slideCharsOver", { limit: profile.charLimitPerScore })}</p>{/if}
    {#if s.tied + s.short + s.unwritable + s.locked + s.range > 0}
      <p class="muted">{t("ui.trillSkipped", { tied: s.tied, short: s.short, unwritable: s.unwritable, locked: s.locked, range: s.range })}</p>
    {/if}
    {#if s.bend > 0}<p class="warn">{t("ui.slideBend", { n: s.bend })}</p>{/if}
  {/if}
  <footer>
    <span class="spacer"></span>
    {#if onrestore}
      <button
        title={t("ui.madeRestoreHelp")}
        onclick={() => {
          onrestore?.();
          dialog.close();
        }}>{t("ui.madeRestoreButton")}</button
      >
    {/if}
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!ok} onclick={apply}>{t("ui.apply")}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(520px, calc(100vw - 32px));
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1.05rem;
  }
  .grid {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 6px 12px;
  }
  .row,
  footer {
    display: flex;
    align-items: center;
    gap: 6px 12px;
    flex-wrap: wrap;
    margin: 8px 0;
  }
  .pitch {
    width: 5em;
  }
  .num {
    width: 3.5em;
  }
  .pitch[aria-invalid="true"] {
    border-color: var(--danger);
  }
  .preview {
    display: block;
    width: 100%;
    height: 110px;
    margin-top: 8px;
    border: 1px solid var(--line);
    border-radius: 4px;
  }
  .preview rect {
    fill: var(--muted);
  }
  .preview rect.on {
    fill: var(--accent);
  }
  .spacer {
    flex: 1;
  }
  .muted {
    color: var(--muted);
    margin: 4px 0;
  }
  .warn {
    color: var(--danger);
    margin: 4px 0;
  }
</style>
