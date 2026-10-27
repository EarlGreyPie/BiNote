<script lang="ts" module>
  import type { BarRange } from "@mmlce/core";
  import type { TransposeScope } from "./TransposeDialog.svelte";
  import type { ChordAttPrefs } from "./chordAttPrefs";

  /** 적용하면 어떻게 되는지 (창에 미리 보여 준다). 소리 수는 & 사슬 하나를 한 음으로 센다 */
  export interface ChordAttCheck {
    readonly count: number;
    readonly changed: number;
    /** 함께 울린 음 수 → 소리 수 */
    readonly bySize: ReadonlyMap<number, number>;
    /** 같이 시작한 음만 셀 때보다 더 많이 센 소리 수 */
    readonly fromOverlap: number;
    readonly floored: number;
    readonly viaTie: number;
    readonly before: readonly [number, number] | undefined;
    readonly after: readonly [number, number] | undefined;
  }

  export type ChordAttApply = (scope: TransposeScope, prefs: ChordAttPrefs, bars: readonly BarRange[] | undefined) => void;
</script>

<script lang="ts">
  import { parseBarList, type GameProfile } from "@mmlce/core";
  import { t } from "./i18n.svelte";

  interface Props {
    scopes: readonly { readonly id: TransposeScope; readonly label: string }[];
    initialScope: TransposeScope;
    initial: ChordAttPrefs;
    profile: Pick<GameProfile, "volume">;
    /** 반복 구간이 걸친 마디 [첫, 끝]. 반복 구간이 없으면 undefined */
    loopBars?: BarRange | undefined;
    check: (scope: TransposeScope, prefs: ChordAttPrefs, bars: readonly BarRange[] | undefined) => ChordAttCheck;
    onapply: ChordAttApply;
    onclose: () => void;
  }

  let { scopes, initialScope, initial, profile, loopBars, check, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let scope = $state<TransposeScope>(initialScope);
  // svelte-ignore state_referenced_locally
  let p = $state<ChordAttPrefs>({ ...initial });
  const min = $derived(profile.volume.min);
  const max = $derived(profile.volume.max);
  let barMode = $state<"all" | "loop" | "typed">("all");
  let barText = $state("");
  const typedBars = $derived(parseBarList(barText));
  const bars = $derived<readonly BarRange[] | undefined>(
    scope === "selection" || barMode === "all" ? undefined : barMode === "loop" ? (loopBars ? [loopBars] : []) : (typedBars ?? []),
  );
  const barSpan = (b: BarRange) => (b[0] === b[1] ? `${b[0]}` : `${b[0]}-${b[1]}`);
  const result = $derived(check(scope, p, bars));
  const span = (s: readonly [number, number] | undefined) => (!s ? "—" : s[0] === s[1] ? `v${s[0]}` : `v${s[0]}-v${s[1]}`);
  /** 1음·2음·3음·4음 이상으로 묶어 보여 준다 */
  const sizes = $derived.by(() => {
    const out: string[] = [];
    let more = 0;
    for (const [size, n] of [...result.bySize].sort((a, b) => a[0] - b[0])) {
      if (size >= 4) more += n;
      else out.push(t("ui.chordAttSize", { size, count: n }));
    }
    if (more > 0) out.push(t("ui.chordAttSizeMore", { size: 4, count: more }));
    return out.join(" · ");
  });

  $effect(() => {
    dialog.showModal();
  });

  function clampInt(value: number, lo: number, hi: number): number | undefined {
    const v = Math.round(value);
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined;
  }

  function setStep(i: 0 | 1 | 2, value: number) {
    const v = clampInt(value, 0, 8);
    if (v === undefined) return;
    const steps = [...p.steps] as [number, number, number];
    steps[i] = v;
    p = { ...p, steps };
  }

  function apply() {
    if (result.changed === 0) return;
    onapply(scope, p, bars);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.chordAtt")}</h2>
  <p class="muted small">{t("ui.chordAttHelp")}</p>
  <div class="row">
    {#each scopes as s (s.id)}
      <label><input type="radio" name="scope" value={s.id} bind:group={scope} /> {s.label}</label>
    {/each}
  </div>
  {#if scope !== "selection"}
    <div class="row">
      <span>{t("ui.volumeBars")}</span>
      <label><input type="radio" name="bars" value="all" bind:group={barMode} /> {t("ui.volumeBarsAll")}</label>
      <label title={loopBars ? undefined : t("ui.volumeBarsNoLoop")}>
        <input type="radio" name="bars" value="loop" bind:group={barMode} disabled={!loopBars} />
        {loopBars ? t("ui.volumeBarsLoop", { bars: barSpan(loopBars) }) : t("ui.volumeBarsLoopNone")}
      </label>
      <label><input type="radio" name="bars" value="typed" bind:group={barMode} /> {t("ui.volumeBarsTyped")}</label>
      {#if barMode === "typed"}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="bars" type="text" inputmode="text" autofocus placeholder={t("ui.volumeBarsPlaceholder")} bind:value={barText} aria-label={t("ui.volumeBarsTyped")} />
      {/if}
    </div>
    {#if barMode === "typed" && barText.trim() !== "" && !typedBars}
      <p class="warn">{t("ui.volumeBarsInvalid")}</p>
    {/if}
  {/if}

  <fieldset>
    <legend>{t("ui.chordAttCount")}</legend>
    <div class="row">
      <label><input type="radio" name="count" checked={!p.sameStartOnly} onchange={() => (p = { ...p, sameStartOnly: false })} /> {t("ui.chordAttOverlap")}</label>
      <label><input type="radio" name="count" checked={p.sameStartOnly} onchange={() => (p = { ...p, sameStartOnly: true })} /> {t("ui.chordAttSameStart")}</label>
    </div>
    {#if !p.sameStartOnly}
      <div class="row">
        <span>{t("ui.chordAttRoll")}</span>
        {#each [0, 32, 16, 8] as const as r (r)}
          <label><input type="radio" name="roll" checked={p.roll === r} onchange={() => (p = { ...p, roll: r })} /> {r === 0 ? t("ui.chordAttRollNone") : `1/${r}`}</label>
        {/each}
      </div>
      <p class="muted small">{t("ui.chordAttRollHelp")}</p>
    {/if}
    <div class="row">
      <span>{t("ui.chordAttSplit")}</span>
      <label><input type="radio" name="split" checked={p.split === "pitch"} onchange={() => (p = { ...p, split: "pitch" })} /> {t("ui.chordAttSplitPitch")}</label>
      <label><input type="radio" name="split" checked={p.split === "role"} onchange={() => (p = { ...p, split: "role" })} /> {t("ui.chordAttSplitRole")}</label>
      <label><input type="radio" name="split" checked={p.split === "none"} onchange={() => (p = { ...p, split: "none" })} /> {t("ui.chordAttSplitNone")}</label>
    </div>
  </fieldset>

  <fieldset>
    <legend>{t("ui.chordAttAmount")}</legend>
    <div class="row">
      <label><input type="radio" name="amount" checked={p.amount === "steps"} onchange={() => (p = { ...p, amount: "steps" })} /> {t("ui.chordAttSteps")}</label>
      <label><input type="radio" name="amount" checked={p.amount === "law"} onchange={() => (p = { ...p, amount: "law" })} /> {t("ui.chordAttLaw")}</label>
    </div>
    {#if p.amount === "steps"}
      <div class="row">
        {#each [0, 1, 2] as const as i (i)}
          <label>
            {i === 0 ? t("ui.chordAttTwo") : i === 1 ? t("ui.chordAttThree") : t("ui.chordAttFourPlus")}
            −<input type="number" min="0" max="8" value={p.steps[i]} oninput={(e) => setStep(i, Number(e.currentTarget.value))} />
          </label>
        {/each}
      </div>
    {:else}
      <p class="muted small">{t("ui.chordAttLawHelp")}</p>
    {/if}
    <div class="row">
      <label>
        {t("ui.chordAttFloor")} v
        <input
          type="number"
          {min}
          {max}
          value={p.floor}
          oninput={(e) => {
            const v = clampInt(Number(e.currentTarget.value), min, max);
            if (v !== undefined) p = { ...p, floor: v };
          }}
        />
      </label>
    </div>
    <div class="row">
      <span>{t("ui.chordAttBase")}</span>
      <label><input type="radio" name="base" checked={!p.useBase} onchange={() => (p = { ...p, useBase: false })} /> {t("ui.chordAttBaseNow")}</label>
      <label><input type="radio" name="base" checked={p.useBase} onchange={() => (p = { ...p, useBase: true })} /> {t("ui.chordAttBaseSet")}</label>
      {#if p.useBase}
        <label>
          v
          <input
            type="number"
            {min}
            {max}
            value={p.base}
            oninput={(e) => {
              const v = clampInt(Number(e.currentTarget.value), min, max);
              if (v !== undefined) p = { ...p, base: v };
            }}
          />
        </label>
      {/if}
    </div>
  </fieldset>

  <p class="muted">{t("ui.volumeCount", { count: result.count, changed: result.changed })}</p>
  {#if result.count > 0}
    <p class="muted">{t("ui.chordAttSizes", { list: sizes })}</p>
    <p class="muted">{t("ui.volumeSpan", { before: span(result.before), after: span(result.after) })}</p>
  {/if}
  {#if result.fromOverlap > 0}
    <p class="muted small">{t("ui.chordAttFromOverlap", { count: result.fromOverlap })}</p>
  {/if}
  {#if result.floored > 0}
    <p class="warn">{t("ui.chordAttFloored", { count: result.floored, floor: p.floor })}</p>
  {/if}
  {#if result.viaTie > 0}
    <p class="muted small">{t("ui.volumeTiedOnly", { count: result.viaTie })}</p>
  {/if}
  {#if !p.useBase}
    <p class="muted small">{t("ui.chordAttAgain")}</p>
  {/if}
  <footer>
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button disabled={result.changed === 0} onclick={apply}>{t("ui.apply")}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow: auto;
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
  fieldset {
    border: 1px solid var(--line);
    border-radius: 6px;
    margin: 8px 0;
    padding: 4px 10px;
  }
  legend {
    padding: 0 4px;
  }
  .row,
  footer {
    display: flex;
    align-items: center;
    gap: 8px 12px;
    flex-wrap: wrap;
    margin: 8px 0;
  }
  input[type="number"] {
    width: 4em;
  }
  input.bars {
    width: 9em;
  }
  .spacer {
    flex: 1;
  }
  .muted {
    color: var(--muted);
    margin: 4px 0;
  }
  .small {
    font-size: 0.85rem;
  }
  .warn {
    color: var(--danger);
    margin: 4px 0;
  }
</style>
