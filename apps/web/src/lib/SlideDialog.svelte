<script lang="ts">
  import { cmp, planSlides, toFloat, type GameProfile, type Note, type Rat, type SlidesResult, type Song } from "@mmlce/core";
  import { canWriteExactly, optimizeMml } from "@mmlce/mml";
  import { t } from "./i18n.svelte";
  import { lengthLabel } from "./Toolbar.svelte";
  import { lengthsFor, noteLengthOf, type NoteLength } from "./roll";
  import { parseSlideChoice, SLIDE_KEY, type SlideChoice } from "./slideOptions";
  import { loadStored, parseJson, saveStored } from "./persist";

  /**
   * 슬라이드 창 (편집 메뉴, 피아노롤·타브): 고른 음 사이를 반음씩 잇는 사이 음을 채우거나(두 음 사이),
   * 한 음 앞뒤에 미끄러져 들어가고 나가는 음을 붙인다. 고른 음이 여러 트랙(화음)이면 줄마다 자기 트랙에서 미끄러진다.
   * 고르기를 바꿀 때마다 결과를 다시 계산해 미리 보여 준다
   */
  interface Props {
    song: Song;
    picked: readonly Note[];
    profile: GameProfile;
    /** 트랙이 실제로 소리 내는 악기 (음역 접기·샘플 길이·음색 경계) */
    instrumentOf: (trackId: string) => string | undefined;
    /** 타브에서 열면 음이 보이는 줄 (사이 음도 그 줄에) */
    stringOf?: (note: Note) => number | undefined;
    locked: ReadonlySet<string>;
    /** 다시 고치기: 만들 때 고른 것 (없으면 이 브라우저에 기억해 둔 값) */
    initial?: SlideChoice | undefined;
    /** 창 제목 (다시 고치기) */
    title?: string | undefined;
    /** 다시 고치기: 창을 닫고 원래 음으로 되돌린다 (있으면 "원래대로" 버튼) */
    onrestore?: (() => void) | undefined;
    /** 적용: 결과와 만든 기록에 남길 고른 것 */
    onapply: (result: SlidesResult, choice: SlideChoice) => void;
    onclose: () => void;
  }

  let { song, picked, profile, instrumentOf, stringOf, locked, initial, title, onrestore, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let choice = $state<SlideChoice>(initial ?? loadStored(SLIDE_KEY, (raw) => parseSlideChoice(parseJson(raw))));
  function set(change: Partial<SlideChoice>) {
    choice = { ...choice, ...change };
    saveStored(SLIDE_KEY, JSON.stringify(choice));
  }
  $effect(() => {
    dialog.showModal();
  });

  /** 두 음 사이는 한 트랙에서 음 둘 이상을 골라야 쓸 수 있다 */
  const canBetween = $derived(song.tracks.some((tr) => tr.notes.filter((n) => picked.some((p) => p.id === n.id)).length >= 2));
  const kind = $derived(!canBetween && choice.kind === "between" ? "in" : choice.kind);
  const wantIn = $derived(kind === "in" || kind === "both");
  /** 게임이 받는 길이만 (격자는 빼고) */
  const lengths = $derived(lengthsFor(profile.length).filter((l): l is Exclude<NoteLength, "grid"> => l !== "grid"));
  const fit = (l: Exclude<NoteLength, "grid">) => (lengths.includes(l) ? l : "16");
  const length = $derived(fit(choice.length));
  const outLength = $derived(fit(choice.outLength));
  const step = $derived(choice.step === "auto" || lengths.includes(choice.step) ? choice.step : "auto");
  const canWrite = (r: Rat) => canWriteExactly(r, profile.length);

  const result = $derived.by(() => {
    const used = new Set(song.tracks.flatMap((tr) => tr.notes.map((n) => n.id)));
    let k = 0;
    const newId = (trackId: string) => {
      let id: string;
      do id = `${trackId}.sl${++k}`;
      while (used.has(id));
      used.add(id);
      return id;
    };
    // 나가기만이면 나가는 쪽 값을 위 칸(direction 등)에서 받는다
    const side = kind === "out" ? { direction: choice.outDirection, semitones: choice.outSemitones, length: noteLengthOf(outLength, 1) } : { direction: choice.direction, semitones: choice.semitones, length: noteLengthOf(length, 1) };
    return planSlides(
      song,
      picked,
      {
        kind,
        path: choice.path,
        ...side,
        out: { direction: choice.outDirection, semitones: choice.outSemitones, length: noteLengthOf(outLength, 1) },
        timing: choice.timing,
        breakAtZones: choice.breakAtZones,
        ...(step === "auto" ? {} : { step: noteLengthOf(step, 1) }),
        instrumentOf,
        locked,
        canWrite,
        ...(stringOf ? { stringOf } : {}),
      },
      profile,
      newId,
    );
  });

  // 글자 수: 바뀐 트랙마다 글을 적용 전후로 출력해 잰 차이 (최적화 출력 기준). 가장 많이 는 트랙을 보인다
  const chars = $derived.by(() => {
    let delta: number | undefined;
    let over = false;
    for (const c of result.changes) {
      const track = song.tracks.find((tr) => tr.id === c.trackId);
      if (!track) continue;
      const before = optimizeMml(track.notes, { lengths: profile.length }).text.length;
      const after = optimizeMml(c.notes, { lengths: profile.length }).text.length;
      delta = Math.max(delta ?? -Infinity, after - before);
      if (after > profile.charLimitPerScore) over = true;
    }
    return delta === undefined ? undefined : { delta, over };
  });

  // 미리 보기: 고른 음 구간(박 앞 들어가기는 앞으로 늘어난 자리까지)의 결과 음을 작은 롤로. 만든 사슬은 강조,
  // 음색 경계 자리(끊었으면 다시 치는 음, 아니면 음색이 튀는 음)는 세로줄로 표시
  const W = 400;
  const H = 110;
  const preview = $derived.by(() => {
    if (result.changes.length === 0) return undefined;
    const chain = new Set(result.chain);
    const zone = new Set(result.zoneAt);
    const all = result.changes.flatMap((c) => c.notes);
    const made = all.filter((n) => chain.has(n.id));
    const span = [...picked, ...made];
    const from = span.reduce<Rat>((m, n) => (cmp(n.start, m) < 0 ? n.start : m), span[0]!.start);
    const to = Math.max(...span.map((n) => toFloat(n.start) + toFloat(n.dur)));
    const notes = all.filter((n) => toFloat(n.start) < to && toFloat(n.start) + toFloat(n.dur) > toFloat(from));
    if (notes.length === 0) return undefined;
    const lo = Math.min(...notes.map((n) => n.pitch)) - 1;
    const hi = Math.max(...notes.map((n) => n.pitch)) + 1;
    const x = (at: number) => ((at - toFloat(from)) / Math.max(1e-9, to - toFloat(from))) * W;
    const row = H / (hi - lo + 1);
    return {
      rects: notes.map((n) => ({
        x: Math.max(0, x(toFloat(n.start))),
        w: Math.max(1, x(Math.min(to, toFloat(n.start) + toFloat(n.dur))) - Math.max(0, x(toFloat(n.start))) - 1),
        y: (hi - n.pitch) * row,
        h: Math.max(2, row - 1),
        on: chain.has(n.id),
      })),
      zones: notes.filter((n) => zone.has(n.id)).map((n) => x(toFloat(n.start))),
    };
  });

  const ok = $derived(result.made > 0 && result.changes.length > 0);
  function apply() {
    if (!ok) return;
    onapply(result, choice);
    dialog.close();
  }
  const s = $derived(result.skipped);
  const fretOptions = Array.from({ length: 12 }, (_, i) => i + 1);
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{title ?? t("ui.slide")}</h2>
  <div class="grid">
    <span>{t("ui.slideKind")}</span>
    <span class="row">
      <label title={canBetween ? undefined : t("ui.slideBetweenNeedsTwo")}>
        <input type="radio" name="slide-kind" checked={kind === "between"} disabled={!canBetween} onchange={() => set({ kind: "between" })} />
        {t("ui.slideBetween")}
      </label>
      <label><input type="radio" name="slide-kind" checked={kind === "in"} onchange={() => set({ kind: "in" })} /> {t("ui.slideIn")}</label>
      <label><input type="radio" name="slide-kind" checked={kind === "out"} onchange={() => set({ kind: "out" })} /> {t("ui.slideOut")}</label>
      <label title={t("ui.slideBothHelp")}><input type="radio" name="slide-kind" checked={kind === "both"} onchange={() => set({ kind: "both" })} /> {t("ui.slideBoth")}</label>
    </span>
    <span>{t("ui.slidePath")}</span>
    <span class="row">
      <label><input type="radio" name="slide-path" checked={choice.path === "chromatic"} onchange={() => set({ path: "chromatic" })} /> {t("ui.slideChromatic")}</label>
      <label><input type="radio" name="slide-path" checked={choice.path === "direct"} onchange={() => set({ path: "direct" })} /> {t("ui.slideDirect")}</label>
    </span>
    {#if wantIn}
      <span>{t("ui.slideInSide")}</span>
      <span class="row">
        <select value={choice.direction} onchange={(e) => set({ direction: e.currentTarget.value as SlideChoice["direction"] })}>
          <option value="down">{t("ui.slideFromBelow")}</option>
          <option value="up">{t("ui.slideFromAbove")}</option>
        </select>
        <select value={choice.semitones} onchange={(e) => set({ semitones: Number(e.currentTarget.value) })}>
          {#each fretOptions as n (n)}<option value={n}>{t("ui.slideFrets", { n })}</option>{/each}
        </select>
        <select value={length} title={t("ui.slideLength")} onchange={(e) => set({ length: e.currentTarget.value as SlideChoice["length"] })}>
          {#each lengths as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
        </select>
      </span>
      <span>{t("ui.slideTiming")}</span>
      <span class="row">
        <label title={t("ui.slideOnBeatHelp")}><input type="radio" name="slide-timing" checked={choice.timing === "on"} onchange={() => set({ timing: "on" })} /> {t("ui.slideOnBeat")}</label>
        <label title={t("ui.slideBeforeBeatHelp")}><input type="radio" name="slide-timing" checked={choice.timing === "before"} onchange={() => set({ timing: "before" })} /> {t("ui.slideBeforeBeat")}</label>
      </span>
    {/if}
    {#if kind === "out" || kind === "both"}
      <span>{t("ui.slideOutSide")}</span>
      <span class="row">
        <select value={choice.outDirection} onchange={(e) => set({ outDirection: e.currentTarget.value as SlideChoice["outDirection"] })}>
          <option value="down">{t("ui.slideToBelow")}</option>
          <option value="up">{t("ui.slideToAbove")}</option>
        </select>
        <select value={choice.outSemitones} onchange={(e) => set({ outSemitones: Number(e.currentTarget.value) })}>
          {#each fretOptions as n (n)}<option value={n}>{t("ui.slideFrets", { n })}</option>{/each}
        </select>
        <select value={outLength} title={t("ui.slideLength")} onchange={(e) => set({ outLength: e.currentTarget.value as SlideChoice["outLength"] })}>
          {#each lengths as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
        </select>
      </span>
    {/if}
    {#if kind === "between"}
      <span>{t("ui.slideLength")}</span>
      <select value={length} onchange={(e) => set({ length: e.currentTarget.value as SlideChoice["length"] })}>
        {#each lengths as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
      </select>
    {/if}
    {#if choice.path === "chromatic"}
      <span>{t("ui.slideStep")}</span>
      <select value={step} onchange={(e) => set({ step: e.currentTarget.value as SlideChoice["step"] })}>
        <option value="auto">{t("ui.slideStepAuto")}</option>
        {#each lengths as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
      </select>
    {/if}
  </div>
  <label class="check" title={t("ui.slideBreakZonesHelp")}>
    <input type="checkbox" checked={choice.breakAtZones} onchange={(e) => set({ breakAtZones: e.currentTarget.checked })} />
    {t("ui.slideBreakZones")}
  </label>
  <svg class="preview" viewBox="0 0 {W} {H}" role="img" aria-label={t("ui.arpPreview")}>
    {#if preview}
      {#each preview.rects as r, i (i)}<rect x={r.x} y={r.y} width={r.w} height={r.h} rx="1.5" class:on={r.on} />{/each}
      {#each preview.zones as zx, i (i)}<line class="zone" x1={zx} x2={zx} y1="0" y2={H} />{/each}
    {/if}
  </svg>
  {#if result.locked > 0}<p class="warn">{t("ui.slideLocked")}</p>{/if}
  <p class="muted">
    {t("ui.slideMade", { n: result.made })}{#if chars}
      · {t("ui.slideChars", { n: chars.delta })}{/if}
  </p>
  {#if chars?.over}<p class="warn">{t("ui.slideCharsOver", { limit: profile.charLimitPerScore })}</p>{/if}
  {#if s.gap + s.same + s.short + s.tied + s.unsplittable > 0}
    <p class="muted">
      {t("ui.slideSkipped", { gap: s.gap, same: s.same, short: s.short, tied: s.tied, unsplittable: s.unsplittable })}
    </p>
  {/if}
  {#if s.bend > 0}<p class="warn">{t("ui.slideBend", { n: s.bend, limit: profile.tieBendLimit })}</p>{/if}
  {#if s.zone > 0}<p class="muted">{t("ui.slideZoneSkipped", { n: s.zone })}</p>{/if}
  {#if result.zoneBreaks > 0}<p class="muted"><span class="zone-key"></span>{t("ui.slideZoneBreaks", { n: result.zoneBreaks })}</p>{/if}
  {#if result.zoneCrossings > 0}<p class="warn"><span class="zone-key"></span>{t("ui.slideZoneCrossings", { n: result.zoneCrossings })}</p>{/if}
  {#if result.shortened > 0}<p class="muted">{t("ui.slideShortened", { n: result.shortened })}</p>{/if}
  {#if result.skippedSemitones > 0}<p class="muted">{t("ui.slideSkippedSemitones", { n: result.skippedSemitones })}</p>{/if}
  {#if result.sampleCut > 0}<p class="warn">{t("ui.slideSampleCut", { n: result.sampleCut })}</p>{/if}
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
  .grid > select {
    justify-self: start;
  }
  .row,
  footer {
    display: flex;
    align-items: center;
    gap: 6px 12px;
    flex-wrap: wrap;
    margin: 8px 0;
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
  .preview line.zone {
    stroke: var(--danger);
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
  }
  .zone-key {
    display: inline-block;
    width: 0;
    height: 0.9em;
    margin-right: 6px;
    vertical-align: -0.1em;
    border-left: 2px dashed var(--danger);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
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
