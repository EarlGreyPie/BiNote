<script lang="ts">
  import { canWriteExactly, optimizeMml } from "@mmlce/mml";
  import { cmp, graceMax, planGrace, toFloat, type GameProfile, type GraceResult, type Note, type Rat, type Song } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { lengthLabel } from "./Toolbar.svelte";
  import { lengthsFor, noteLengthOf } from "./roll";
  import { formatGraceInput, GRACE_KEY, GRACE_LENGTHS, parseGraceChoice, parseGraceInput, type GraceChoice, type GraceLength } from "./graceOptions";
  import { loadStored, parseJson, saveStored } from "./persist";

  /**
   * 꾸밈음 창 (편집 메뉴): 고른 음(본음) 앞에 짧은 꾸밈음을 붙인다. 타브는 본음 줄의 프렛 번호, 피아노롤은 본음 기준 반음 수로 높이를 받는다.
   * 고르기를 바꿀 때마다 결과를 다시 계산해 미리 보여 주고, 그 길이로 넣을 수 있는 최대 개수를 알려 준다
   */
  interface Props {
    song: Song;
    picked: readonly Note[];
    profile: GameProfile;
    locked: ReadonlySet<string>;
    /** 타브에서 열었으면 기준 본음(첫 본음)의 프렛과 그 줄 (높이를 프렛 번호로 받는다). 없으면 반음 수 */
    tab?: { readonly fret: number; readonly string: number; readonly maxFret: number };
    /** 꾸밈음을 놓을 타브 줄 (본음이 보이는 줄) */
    stringOf?: (note: Note) => number | undefined;
    /** 트랙이 실제로 소리 내는 악기 */
    instrumentOf: (trackId: string) => string | undefined;
    /** 다시 고치기: 만들 때 고른 것 (없으면 이 브라우저에 기억해 둔 값) */
    initial?: GraceChoice | undefined;
    /** 창 제목 (다시 고치기) */
    title?: string | undefined;
    /** 다시 고치기: 창을 닫고 원래 음으로 되돌린다 (있으면 "원래대로" 버튼) */
    onrestore?: (() => void) | undefined;
    /** 적용: 결과와 만든 기록에 남길 고른 것 */
    onapply: (result: GraceResult, choice: GraceChoice) => void;
    onclose: () => void;
  }

  let { song, picked, profile, locked, tab, stringOf, instrumentOf, initial, title, onrestore, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let choice = $state<GraceChoice>(initial ?? loadStored(GRACE_KEY, (raw) => parseGraceChoice(parseJson(raw))));
  function set(change: Partial<GraceChoice>) {
    choice = { ...choice, ...change };
    saveStored(GRACE_KEY, JSON.stringify(choice));
  }
  $effect(() => {
    dialog.showModal();
  });

  // 높이 입력: 처음에는 기억해 둔 높이를 이 본음 기준으로 (타브 줄 밖이면 2프렛 위 하나)
  // svelte-ignore state_referenced_locally
  let text = $state(formatGraceInput(choice.offsets, tab) ?? formatGraceInput([2], tab) ?? "");
  const offsets = $derived(parseGraceInput(text, tab));
  $effect(() => {
    if (offsets && offsets.join() !== choice.offsets.join()) set({ offsets });
  });

  /** 게임이 받는 길이만 */
  const lengths = $derived(lengthsFor<GraceLength>(profile.length, GRACE_LENGTHS));
  const length = $derived(lengths.includes(choice.length) ? choice.length : (lengths[0] ?? "64"));
  const canWrite = (r: Rat) => canWriteExactly(r, profile.length);
  /** 길이마다 넣을 수 있는 최대 개수 (길이 목록에 함께 보인다) */
  const maxOf = $derived(new Map(lengths.map((l) => [l, graceMax(song, picked, { length: noteLengthOf(l, 1), timing: choice.timing, canWrite, locked }, profile)] as const)));

  const result = $derived.by(() => {
    const used = new Set(song.tracks.flatMap((tr) => tr.notes.map((n) => n.id)));
    let k = 0;
    const newId = () => {
      let id: string;
      do id = `gr${++k}`;
      while (used.has(id));
      used.add(id);
      return id;
    };
    return planGrace(
      song,
      picked,
      { offsets: offsets ?? [], length: noteLengthOf(length, 1), timing: choice.timing, tie: choice.tie, canWrite, locked, instrumentOf, ...(stringOf ? { stringOf } : {}) },
      profile,
      newId,
    );
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

  // 미리 보기: 고른 음 앞뒤 구간의 바뀐 트랙 음을 작은 롤로 (만든 꾸밈음과 본음은 강조)
  const W = 400;
  const H = 110;
  const preview = $derived.by(() => {
    if (result.changes.length === 0 || picked.length === 0) return undefined;
    const from = toFloat(picked.reduce<Rat>((m, n) => (cmp(n.start, m) < 0 ? n.start : m), picked[0]!.start)) - 1 / 8;
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

  const ok = $derived(!!offsets && result.made > 0 && !result.tooMany);
  function apply() {
    if (!ok) return;
    onapply(result, { ...choice, length });
    dialog.close();
  }
  const s = $derived(result.skipped);
  const count = $derived(offsets?.length ?? 0);
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{title ?? t("ui.grace")}</h2>
  <div class="grid">
    <span>{t("ui.graceTiming")}</span>
    <span class="row">
      <label title={t("ui.graceOnBeatHelp")}>
        <input type="radio" name="grace-timing" checked={choice.timing === "on"} onchange={() => set({ timing: "on" })} />
        {t("ui.graceOnBeat")} <small class="muted">({t("ui.graceOnBeatHint")})</small>
      </label>
      <label title={t("ui.graceBeforeBeatHelp")}>
        <input type="radio" name="grace-timing" checked={choice.timing === "before"} onchange={() => set({ timing: "before" })} />
        {t("ui.graceBeforeBeat")} <small class="muted">({t("ui.graceBeforeBeatHint")})</small>
      </label>
    </span>
    <span>{tab ? t("ui.graceFrets") : t("ui.graceSemitones")}</span>
    <span class="row">
      <input class="pitches" type="text" inputmode={tab ? "numeric" : "text"} bind:value={text} aria-invalid={!offsets} />
      <small class="muted">{tab ? t("ui.graceFretsHint", { string: tab.string, fret: tab.fret }) : t("ui.graceSemitonesHint")}</small>
    </span>
    <span>{t("ui.graceLength")}</span>
    <select value={length} onchange={(e) => set({ length: e.currentTarget.value as GraceLength })}>
      {#each lengths as l (l)}<option value={l}>{lengthLabel(l)}{maxOf.get(l) !== undefined ? ` · ${t("ui.graceMax", { n: maxOf.get(l)! })}` : ""}</option>{/each}
    </select>
    <span></span>
    <label><input type="checkbox" checked={choice.tie} onchange={(e) => set({ tie: e.currentTarget.checked })} /> {t("ui.graceTie")}</label>
  </div>
  <svg class="preview" viewBox="0 0 {W} {H}" role="img" aria-label={t("ui.arpPreview")}>
    {#if preview}
      {#each preview as r, i (i)}<rect x={r.x} y={r.y} width={r.w} height={r.h} rx="1.5" class:on={r.on} />{/each}
    {/if}
  </svg>
  {#if !offsets}
    <p class="warn">{tab ? t("ui.graceBadFrets", { max: tab.maxFret }) : t("ui.graceBadSemitones")}</p>
  {:else if result.tooMany}
    <p class="warn">{result.max === 0 ? (choice.timing === "on" ? t("ui.graceNoRoomOn") : t("ui.graceNoRoomBefore")) : t("ui.graceTooMany", { n: count, max: result.max })}</p>
  {:else}
    <p class="muted">
      {t("ui.graceMade", { n: result.made, count })}{#if chars}{` · ${t("ui.slideChars", { n: chars.delta })}`}{/if}
    </p>
    {#if chars?.over}<p class="warn">{t("ui.slideCharsOver", { limit: profile.charLimitPerScore })}</p>{/if}
    {#if s.tied + s.short + s.unwritable + s.locked + s.range > 0}
      <p class="muted">{t("ui.graceSkipped", { tied: s.tied, short: s.short + s.unwritable, locked: s.locked, range: s.range })}</p>
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
  .pitches {
    width: 10em;
  }
  .pitches[aria-invalid="true"] {
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
