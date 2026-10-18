<script lang="ts">
  import { cmp, planSlide, toFloat, type GameProfile, type Note, type Rat, type SlideResult, type Song } from "@mmlce/core";
  import { optimizeMml } from "@mmlce/mml";
  import { t } from "./i18n.svelte";
  import { lengthLabel } from "./Toolbar.svelte";
  import { lengthsFor, noteLengthOf, type NoteLength } from "./roll";
  import { parseSlideChoice, SLIDE_KEY, type SlideChoice } from "./slideOptions";
  import { loadStored, parseJson, saveStored } from "./persist";

  /**
   * 슬라이드 창 (편집 메뉴): 고른 음(한 트랙) 사이를 반음씩 잇는 사이 음을 채우거나(두 음 사이),
   * 한 음 앞뒤에 미끄러져 들어가고 나가는 음을 붙인다. 고르기를 바꿀 때마다 결과를 다시 계산해 미리 보여 준다
   */
  interface Props {
    song: Song;
    trackId: string;
    picked: readonly Note[];
    profile: GameProfile;
    /** 고른 트랙이 실제로 소리 내는 악기 (음역 접기·샘플 길이) */
    instrument: string;
    locked: ReadonlySet<string>;
    onapply: (result: SlideResult) => void;
    onclose: () => void;
  }

  let { song, trackId, picked, profile, instrument, locked, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  let choice = $state<SlideChoice>(loadStored(SLIDE_KEY, (raw) => parseSlideChoice(parseJson(raw))));
  function set(change: Partial<SlideChoice>) {
    choice = { ...choice, ...change };
    saveStored(SLIDE_KEY, JSON.stringify(choice));
  }
  $effect(() => {
    dialog.showModal();
  });

  /** 고른 음이 하나면 두 음 사이는 쓸 수 없으니 들어가기로 */
  const kind = $derived(picked.length < 2 && choice.kind === "between" ? "in" : choice.kind);
  /** 게임이 받는 길이만 (격자는 빼고) */
  const lengths = $derived(lengthsFor(profile.length).filter((l): l is Exclude<NoteLength, "grid"> => l !== "grid"));
  const length = $derived(lengths.includes(choice.length) ? choice.length : "16");
  const step = $derived(choice.step === "auto" || lengths.includes(choice.step) ? choice.step : "auto");

  const result = $derived.by(() => {
    const used = new Set(song.tracks.flatMap((tr) => tr.notes.map((n) => n.id)));
    let k = 0;
    const newId = () => {
      let id: string;
      do id = `${trackId}.sl${++k}`;
      while (used.has(id));
      used.add(id);
      return id;
    };
    return planSlide(
      song,
      trackId,
      picked,
      {
        kind,
        path: choice.path,
        direction: choice.direction,
        semitones: choice.semitones,
        length: noteLengthOf(length, 1),
        ...(step === "auto" ? {} : { step: noteLengthOf(step, 1) }),
        instrument,
        locked,
      },
      profile,
      newId,
    );
  });

  // 글자 수: 그 트랙 글을 적용 전후로 출력해 잰 차이 (최적화 출력 기준)
  const chars = $derived.by(() => {
    const track = song.tracks.find((tr) => tr.id === trackId);
    if (!track || !result.notes) return undefined;
    const before = optimizeMml(track.notes, { lengths: profile.length }).text.length;
    const after = optimizeMml(result.notes, { lengths: profile.length }).text.length;
    return { delta: after - before, over: after > profile.charLimitPerScore };
  });

  // 미리 보기: 고른 음 구간의 결과 음을 작은 롤로 (만든 사슬은 강조)
  const W = 400;
  const H = 110;
  const preview = $derived.by(() => {
    if (!result.notes) return undefined;
    const from = picked.reduce<Rat>((m, n) => (cmp(n.start, m) < 0 ? n.start : m), picked[0]!.start);
    const to = Math.max(...picked.map((n) => toFloat(n.start) + toFloat(n.dur)));
    const chain = new Set(result.chain);
    const notes = result.notes.filter((n) => toFloat(n.start) < to && toFloat(n.start) + toFloat(n.dur) > toFloat(from));
    if (notes.length === 0) return undefined;
    const lo = Math.min(...notes.map((n) => n.pitch)) - 1;
    const hi = Math.max(...notes.map((n) => n.pitch)) + 1;
    const x = (at: number) => ((at - toFloat(from)) / Math.max(1e-9, to - toFloat(from))) * W;
    const row = H / (hi - lo + 1);
    return notes.map((n) => ({
      x: x(toFloat(n.start)),
      w: Math.max(1, x(Math.min(to, toFloat(n.start) + toFloat(n.dur))) - x(toFloat(n.start)) - 1),
      y: (hi - n.pitch) * row,
      h: Math.max(2, row - 1),
      on: chain.has(n.id),
    }));
  });

  const ok = $derived(result.made > 0 && !result.locked);
  function apply() {
    if (!ok) return;
    onapply(result);
    dialog.close();
  }
  const s = $derived(result.skipped);
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.slide")}</h2>
  <div class="grid">
    <span>{t("ui.slideKind")}</span>
    <span class="row">
      <label title={picked.length < 2 ? t("ui.slideBetweenNeedsTwo") : undefined}>
        <input type="radio" name="slide-kind" checked={kind === "between"} disabled={picked.length < 2} onchange={() => set({ kind: "between" })} />
        {t("ui.slideBetween")}
      </label>
      <label><input type="radio" name="slide-kind" checked={kind === "in"} onchange={() => set({ kind: "in" })} /> {t("ui.slideIn")}</label>
      <label><input type="radio" name="slide-kind" checked={kind === "out"} onchange={() => set({ kind: "out" })} /> {t("ui.slideOut")}</label>
    </span>
    <span>{t("ui.slidePath")}</span>
    <span class="row">
      <label><input type="radio" name="slide-path" checked={choice.path === "chromatic"} onchange={() => set({ path: "chromatic" })} /> {t("ui.slideChromatic")}</label>
      <label><input type="radio" name="slide-path" checked={choice.path === "direct"} onchange={() => set({ path: "direct" })} /> {t("ui.slideDirect")}</label>
    </span>
    {#if kind !== "between"}
      <span>{t("ui.slideFrom")}</span>
      <span class="row">
        <select value={choice.direction} onchange={(e) => set({ direction: e.currentTarget.value as SlideChoice["direction"] })}>
          <option value="down">{t("ui.slideDown")}</option>
          <option value="up">{t("ui.slideUp")}</option>
        </select>
        <select value={choice.semitones} onchange={(e) => set({ semitones: Number(e.currentTarget.value) })}>
          {#each Array.from({ length: 12 }, (_, i) => i + 1) as n (n)}<option value={n}>{t("ui.slideSemitones", { n })}</option>{/each}
        </select>
      </span>
    {/if}
    <span>{t("ui.slideLength")}</span>
    <select value={length} onchange={(e) => set({ length: e.currentTarget.value as SlideChoice["length"] })}>
      {#each lengths as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
    </select>
    {#if choice.path === "chromatic"}
      <span>{t("ui.slideStep")}</span>
      <select value={step} onchange={(e) => set({ step: e.currentTarget.value as SlideChoice["step"] })}>
        <option value="auto">{t("ui.slideStepAuto")}</option>
        {#each lengths as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
      </select>
    {/if}
  </div>
  <svg class="preview" viewBox="0 0 {W} {H}" role="img" aria-label={t("ui.arpPreview")}>
    {#if preview}
      {#each preview as r, i (i)}<rect x={r.x} y={r.y} width={r.w} height={r.h} rx="1.5" class:on={r.on} />{/each}
    {/if}
  </svg>
  {#if result.locked}
    <p class="warn">{t("ui.slideLocked")}</p>
  {:else}
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
    {#if s.bend > 0}<p class="warn">{t("ui.slideBend", { n: s.bend })}</p>{/if}
    {#if result.shortened > 0}<p class="muted">{t("ui.slideShortened", { n: result.shortened })}</p>{/if}
    {#if result.skippedSemitones > 0}<p class="muted">{t("ui.slideSkippedSemitones", { n: result.skippedSemitones })}</p>{/if}
    {#if result.sampleCut > 0}<p class="warn">{t("ui.slideSampleCut", { n: result.sampleCut })}</p>{/if}
  {/if}
  <footer>
    <span class="spacer"></span>
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
