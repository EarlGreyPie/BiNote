<script lang="ts" module>
  import type { VolumeChange } from "@mmlce/core";
  import type { TransposeScope } from "./TransposeDialog.svelte";

  /** 바꿔 보면 어떻게 되는지 (창에 미리 보여 준다). 소리 수는 & 사슬 하나를 한 음으로 센다 */
  export interface VolumeCheck {
    readonly count: number;
    readonly changed: number;
    /** ±로 옮기다 v0·v15에서 멈춘 소리 수 */
    readonly clamped: number;
    /** & 뒤 이어진 음만 골라 바꾸지 않은 수 */
    readonly viaTie: number;
    /** 지금 / 바꾼 뒤 v [최소, 최대] */
    readonly before: readonly [number, number] | undefined;
    readonly after: readonly [number, number] | undefined;
  }
</script>

<script lang="ts">
  import { dbOfVolume, parseBarList, volumeForDb, type BarRange, type GameProfile } from "@mmlce/core";
  import { t } from "./i18n.svelte";

  interface Props {
    scopes: readonly { readonly id: TransposeScope; readonly label: string }[];
    initialScope: TransposeScope;
    profile: Pick<GameProfile, "volume" | "volumeCurve">;
    /** 처음 보여 줄 한 값 (범위 안 음들의 가운데 v 등) */
    initialVol: number;
    /** 반복 구간이 걸친 마디 [첫, 끝]. 반복 구간이 없으면 undefined */
    loopBars?: BarRange | undefined;
    /** bars: 바꿀 마디 범위 (undefined면 모든 마디). 고른 음 범위에는 쓰지 않는다 */
    check: (scope: TransposeScope, change: VolumeChange, bars: readonly BarRange[] | undefined) => VolumeCheck;
    onapply: (scope: TransposeScope, change: VolumeChange, bars: readonly BarRange[] | undefined) => void;
    onclose: () => void;
  }

  let { scopes, initialScope, profile, initialVol, loopBars, check, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let scope = $state<TransposeScope>(initialScope);
  let mode = $state<VolumeChange["kind"]>("set");
  // svelte-ignore state_referenced_locally
  let vol = $state(initialVol);
  let by = $state(0);
  let db = $state(-6);
  const min = $derived(profile.volume.min);
  const max = $derived(profile.volume.max);
  const change = $derived<VolumeChange>(mode === "set" ? { kind: "set", vol } : mode === "shift" ? { kind: "shift", by } : { kind: "db", db });
  // 마디: 모든 마디 / 선택 마디(반복 구간) / 적은 마디
  let barMode = $state<"all" | "loop" | "typed">("all");
  let barText = $state("");
  const typedBars = $derived(parseBarList(barText));
  const bars = $derived<readonly BarRange[] | undefined>(
    scope === "selection" || barMode === "all" ? undefined : barMode === "loop" ? (loopBars ? [loopBars] : []) : (typedBars ?? []),
  );
  const barSpan = (b: BarRange) => (b[0] === b[1] ? `${b[0]}` : `${b[0]}-${b[1]}`);
  const result = $derived(check(scope, change, bars));
  const span = (s: readonly [number, number] | undefined) => (!s ? "—" : s[0] === s[1] ? `v${s[0]}` : `v${s[0]}-v${s[1]}`);
  const dbText = (d: number) => (d === -Infinity ? t("ui.volumeSilent") : d === 0 ? "0 dB" : `−${Math.abs(d).toFixed(1)} dB`);

  $effect(() => {
    dialog.showModal();
  });

  function clampInt(value: number, lo: number, hi: number): number | undefined {
    const v = Math.round(value);
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined;
  }

  function apply() {
    if (result.changed === 0) return;
    onapply(scope, change, bars);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.volumeBulk")}</h2>
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
    {:else if barMode !== "all"}
      <p class="muted small">{t("ui.volumeBarsHelp")}</p>
    {/if}
  {/if}
  <div class="row">
    <label><input type="radio" name="mode" value="set" bind:group={mode} /> {t("ui.volumeSet")}</label>
    <label><input type="radio" name="mode" value="shift" bind:group={mode} /> {t("ui.volumeShift")}</label>
    <label><input type="radio" name="mode" value="db" bind:group={mode} /> {t("ui.volumeDb")}</label>
  </div>
  <div class="row">
    {#if mode === "set"}
      <label>
        v
        <input
          type="number"
          {min}
          {max}
          value={vol}
          oninput={(e) => {
            const v = clampInt(Number(e.currentTarget.value), min, max);
            if (v !== undefined) vol = v;
          }}
        />
      </label>
      <span class="muted">≈ {dbText(dbOfVolume(profile, vol))}</span>
    {:else if mode === "shift"}
      <button onclick={() => (by = Math.max(min - max, by - 1))}>−1</button>
      <label>
        <input
          type="number"
          min={min - max}
          max={max - min}
          value={by}
          oninput={(e) => {
            const v = clampInt(Number(e.currentTarget.value), min - max, max - min);
            if (v !== undefined) by = v;
          }}
        />
        {t("ui.volumeSteps")}
      </label>
      <button onclick={() => (by = Math.min(max - min, by + 1))}>+1</button>
    {:else}
      <label>
        <input
          type="number"
          min="-48"
          max="0"
          step="0.5"
          value={db}
          oninput={(e) => {
            const v = Number(e.currentTarget.value);
            if (Number.isFinite(v)) db = Math.max(-48, Math.min(0, v));
          }}
        />
        dB
      </label>
      <span class="muted">→ v{volumeForDb(profile, db)} ({dbText(dbOfVolume(profile, volumeForDb(profile, db)))})</span>
    {/if}
  </div>
  {#if mode === "db"}
    <p class="muted small">{t("ui.volumeDbHelp")}</p>
  {/if}
  <p class="muted">{t("ui.volumeCount", { count: result.count, changed: result.changed })}</p>
  {#if result.count > 0}
    <p class="muted">{t("ui.volumeSpan", { before: span(result.before), after: span(result.after) })}</p>
  {/if}
  {#if result.clamped > 0}
    <p class="warn">{t("ui.volumeClamped", { count: result.clamped, min, max })}</p>
  {/if}
  {#if result.viaTie > 0}
    <p class="muted small">{t("ui.volumeTiedOnly", { count: result.viaTie })}</p>
  {/if}
  <footer>
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button disabled={result.changed === 0} onclick={apply}>{t("ui.apply")}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(460px, calc(100vw - 32px));
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
  .row,
  footer {
    display: flex;
    align-items: center;
    gap: 8px 12px;
    flex-wrap: wrap;
    margin: 8px 0;
  }
  input[type="number"] {
    width: 4.5em;
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
