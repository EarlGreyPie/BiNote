<script lang="ts">
  import { optimizeMml } from "@mmlce/mml";
  import { planGhost, planHarmonic, planLabClear, volumeStepMax, type GameProfile, type HarmonicType, type LabResult, type Note, type Song } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { loadStored, parseJson, saveStored } from "./persist";
  import { parseLabChoice, LAB_CHOICE_KEY, type LabChoice } from "./labOptions";

  /**
   * 실험실 창: 고른 음을 고스트 노트나 하모닉스로 바꾸거나, 실험실 표시를 풀어 처음 값으로 되돌린다.
   * 결과는 보통 v·높이라 게임에서도 그대로 들린다. 고르기를 바꿀 때마다 바뀌는 음 수를 다시 센다
   */
  interface Props {
    kind: "ghost" | "harmonic";
    song: Song;
    picked: readonly Note[];
    profile: GameProfile;
    locked: ReadonlySet<string>;
    /** 타브에서 열었으면 음이 놓인 줄·프렛과 그 줄 개방현 높이 (자연 하모닉스에 필요). 피아노롤이면 없음 */
    positionOf?: (note: Note) => { readonly string: number; readonly fret: number; readonly open: number } | undefined;
    onapply: (result: LabResult, label: string) => void;
    onclose: () => void;
  }

  let { kind, song, picked, profile, locked, positionOf, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  let choice = $state<LabChoice>(loadStored(LAB_CHOICE_KEY, (raw) => parseLabChoice(parseJson(raw))));
  function set(change: Partial<LabChoice>) {
    choice = { ...choice, ...change };
    saveStored(LAB_CHOICE_KEY, JSON.stringify(choice));
  }
  $effect(() => {
    dialog.showModal();
  });

  /** 자연 하모닉스는 타브에서만 (줄을 알아야 한다) */
  const harmonicType = $derived<HarmonicType>(positionOf ? choice.harmonic : "artificial");
  const result = $derived(
    kind === "ghost"
      ? planGhost(song, picked, { steps: choice.ghostSteps, locked }, profile)
      : planHarmonic(song, picked, { type: harmonicType, quieter: choice.harmonicQuieter, locked, ...(positionOf ? { positionOf } : {}) }, profile),
  );
  const marked = $derived(picked.filter((n) => n.lab).length);
  const clear = $derived(marked > 0 ? planLabClear(song, picked, { locked }) : undefined);

  /** 바뀌는 v 묶음 (예: v12→v8 ×3), 많으면 앞의 몇 개만 */
  const volumes = $derived.by(() => {
    const before = new Map(song.tracks.flatMap((tr) => tr.notes.map((n) => [n.id, n] as const)));
    const ids = new Set(picked.map((n) => n.id));
    const pairs = new Map<string, number>();
    for (const c of result.changes) {
      for (const n of c.notes) {
        const was = before.get(n.id);
        if (!was || !ids.has(n.id) || was.vol === n.vol) continue;
        const key = `v${was.vol}→v${n.vol}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
    const list = [...pairs].sort((a, b) => b[1] - a[1]);
    return list.slice(0, 4).map(([k, c]) => (c > 1 ? `${k} ×${c}` : k)).join(", ") + (list.length > 4 ? " …" : "");
  });

  // 글자 수: 바뀐 트랙 글을 적용 전후로 출력해 잰 차이 (최적화 출력 기준. v가 늘면 글자도 는다)
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

  const title = $derived(kind === "ghost" ? t("ui.labGhost") : t("ui.labHarmonic"));
  const s = $derived(result.skipped);
  function apply() {
    if (result.made === 0) return;
    onapply(result, title);
    dialog.close();
  }
  function unmark() {
    if (!clear || clear.made === 0) return;
    onapply(clear, t("ui.labClear"));
    dialog.close();
  }
  // 단계 입력 상한은 곡 프로필의 v 범위 전체
  const stepMax = $derived(volumeStepMax(profile));
  const clampStep = (v: number, min: number) => (Number.isFinite(v) ? Math.max(min, Math.min(stepMax, Math.round(v))) : min);
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{title} <small class="lab">{t("ui.labBadge")}</small></h2>
  <div class="grid">
    {#if kind === "ghost"}
      <span>{t("ui.labGhostSteps")}</span>
      <span class="row">
        <input type="number" min="1" max={stepMax} value={choice.ghostSteps} onchange={(e) => set({ ghostSteps: clampStep(e.currentTarget.valueAsNumber, 1) })} />
        <small class="muted">{t("ui.labGhostStepsHint")}</small>
      </span>
    {:else}
      <span>{t("ui.labHarmonicType")}</span>
      <span class="row">
        <label title={positionOf ? t("ui.labNaturalHelp") : t("ui.labNaturalTabOnly")}>
          <input type="radio" name="harmonic-type" disabled={!positionOf} checked={harmonicType === "natural"} onchange={() => set({ harmonic: "natural" })} />
          {t("ui.labNatural")} <small class="muted">({t("ui.labNaturalHint")})</small>
        </label>
        <label title={t("ui.labArtificialHelp")}>
          <input type="radio" name="harmonic-type" checked={harmonicType === "artificial"} onchange={() => set({ harmonic: "artificial" })} />
          {t("ui.labArtificial")} <small class="muted">({t("ui.labArtificialHint")})</small>
        </label>
      </span>
      <span>{t("ui.labHarmonicQuieter")}</span>
      <span class="row">
        <input type="number" min="0" max={stepMax} value={choice.harmonicQuieter} onchange={(e) => set({ harmonicQuieter: clampStep(e.currentTarget.valueAsNumber, 0) })} />
        <small class="muted">{t("ui.labHarmonicQuieterHint")}</small>
      </span>
      {#if !positionOf}<span></span><small class="muted">{t("ui.labNaturalTabOnly")}</small>{/if}
    {/if}
  </div>
  <p class="muted">
    {t("ui.labMade", { n: result.made })}{#if volumes}{` · ${volumes}`}{/if}{#if chars}{` · ${t("ui.slideChars", { n: chars.delta })}`}{/if}
  </p>
  {#if chars?.over}<p class="warn">{t("ui.slideCharsOver", { limit: profile.charLimitPerScore })}</p>{/if}
  {#if s.tied + s.locked + s.fret + s.range + s.same > 0}
    <p class="muted">{t("ui.labSkipped", { tied: s.tied, locked: s.locked, fret: s.fret, range: s.range, same: s.same })}</p>
  {/if}
  <p class="muted help">{t("ui.labPlainOutput")}</p>
  <footer>
    {#if clear}
      <button title={t("ui.labClearHelp")} disabled={clear.made === 0} onclick={unmark}>{t("ui.labClear")} ({clear.made})</button>
    {/if}
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={result.made === 0} onclick={apply}>{t("ui.apply")}</button>
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
  .lab {
    font-size: 0.75rem;
    font-weight: normal;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 0 4px;
    vertical-align: middle;
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
  input[type="number"] {
    width: 4.5em;
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
  .help {
    font-size: 0.85rem;
  }
</style>
