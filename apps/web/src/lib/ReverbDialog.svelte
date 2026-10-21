<script lang="ts">
  import { untrack } from "svelte";
  import { canWriteExactly, optimizeMml } from "@mmlce/mml";
  import { add, cmp, planReverbBatch, rat, REVERB_LEVELS_MAX, type GameProfile, type Note, type Rat, type ReverbResult, type Song } from "@mmlce/core";
  import { t } from "./i18n.svelte";
  import { parseLevels, REVERB_LENGTHS } from "./labOptions";
  import { batchOptions, reverbPrefs, setReverbChoice } from "./reverbPrefs.svelte";

  /**
   * 실험실 울림 넣기 창: 고른 음(없으면 지금 트랙 전체)에서 조건에 맞는 음에 꼬리를 쪼개 넣고, 켜면 스타카토 빈칸을 채운다.
   * 여기서 고른 꼬리 설정(v 순서·조각 길이·앞부분)은 울림 찍기에도 쓰인다. 결과는 보통 MML이라 게임에서도 그대로 들린다
   */
  interface Props {
    song: Song;
    trackId: string;
    picked: readonly Note[];
    profile: GameProfile;
    locked: ReadonlySet<string>;
    onapply: (result: ReverbResult, label: string) => void;
    onclose: () => void;
  }

  let { song, trackId, picked, profile, locked, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });

  const choice = $derived(reverbPrefs.choice);
  // 처음 열 때 고른 음이 있으면 고른 음, 없으면 트랙 전체
  let scope = $state<"picked" | "track">(untrack(() => picked.length) > 0 ? "picked" : "track");
  const track = $derived(song.tracks.find((tr) => tr.id === trackId));
  const targets = $derived(scope === "picked" ? picked : (track?.notes ?? []));

  let levelsText = $state(reverbPrefs.choice.levels.join(" "));
  const levelsOk = $derived(parseLevels(levelsText, profile.volume.max, REVERB_LEVELS_MAX) !== undefined);
  function setLevels(text: string) {
    levelsText = text;
    const levels = parseLevels(text, profile.volume.max, REVERB_LEVELS_MAX);
    if (levels) setReverbChoice({ levels });
  }
  const PRESETS: readonly (readonly number[])[] = [
    [6, 3, 2, 1],
    [3, 2, 1],
  ];

  const canWrite = (r: Rat) => canWriteExactly(r, profile.length);
  const result = $derived.by(() => {
    const used = new Set(song.tracks.flatMap((tr) => tr.notes.map((n) => n.id)));
    let k = 0;
    const newId = () => {
      let id: string;
      do id = `rv${++k}`;
      while (used.has(id));
      used.add(id);
      return id;
    };
    return planReverbBatch(song, targets, batchOptions(choice), profile, { locked, canWrite, newId });
  });

  // 글자 수: 바뀐 트랙 글을 적용 전후로 출력해 잰 차이 (최적화 출력 기준)
  const chars = $derived.by(() => {
    if (result.changes.length === 0) return undefined;
    let delta = 0;
    let over = false;
    for (const c of result.changes) {
      const tr = song.tracks.find((x) => x.id === c.trackId);
      if (!tr) continue;
      const after = optimizeMml(c.notes, { lengths: profile.length }).text.length;
      delta += after - optimizeMml(tr.notes, { lengths: profile.length }).text.length;
      if (after > profile.charLimitPerScore) over = true;
    }
    return { delta, over };
  });

  const lengths = $derived(REVERB_LENGTHS.filter((n) => n >= profile.length.min && n <= profile.length.max));
  const s = $derived(result.skipped);
  const changedCount = $derived(result.tails + result.fills);
  function apply() {
    if (changedCount === 0) return;
    onapply(result, t("ui.labReverb"));
    dialog.close();
  }
  const clampLevel = (v: number) => (Number.isFinite(v) ? Math.max(1, Math.min(profile.volume.max, Math.round(v))) : 1);
  // 일괄 조건이 꼬리 자리를 넘기면 꼬리가 안 들어간다: 앞부분 + 조각 하나보다 짧은 최소 길이는 미리 알린다
  const tooShort = $derived(cmp(rat(1, choice.minLength), add(rat(1, choice.keep), rat(1, choice.piece))) < 0);
</script>

{#snippet lengthSelect(value: number, onpick: (n: number) => void)}
  <select {value} onchange={(e) => onpick(Number(e.currentTarget.value))}>
    {#each lengths as l (l)}<option value={l}>{t("ui.labReverbLength", { n: l })}</option>{/each}
  </select>
{/snippet}

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.labReverb")} <small class="lab">{t("ui.labBadge")}</small></h2>
  <p class="muted help">{t("ui.labReverbIntro")}</p>
  <h3>{t("ui.labReverbTail")}</h3>
  <div class="grid">
    <span>{t("ui.labReverbLevels")}</span>
    <span class="row">
      <input type="text" class:bad={!levelsOk} value={levelsText} oninput={(e) => setLevels(e.currentTarget.value)} aria-invalid={!levelsOk} />
      {#each PRESETS as p (p.join())}
        <button onclick={() => setLevels(p.join(" "))}>{p.join("-")}</button>
      {/each}
      <small class="muted">{t("ui.labReverbLevelsHint", { max: profile.volume.max })}</small>
    </span>
    <span>{t("ui.labReverbPiece")}</span>
    <span class="row">{@render lengthSelect(choice.piece, (n) => setReverbChoice({ piece: n }))}</span>
    <span>{t("ui.labReverbKeep")}</span>
    <span class="row">{@render lengthSelect(choice.keep, (n) => setReverbChoice({ keep: n }))}<small class="muted">{t("ui.labReverbKeepHint")}</small></span>
  </div>
  <p class="muted help">{t("ui.labReverbStampHint")}</p>
  <h3>{t("ui.labReverbWhere")}</h3>
  <div class="grid">
    <span>{t("ui.labReverbScope")}</span>
    <span class="row">
      <label><input type="radio" name="reverb-scope" disabled={picked.length === 0} checked={scope === "picked"} onchange={() => (scope = "picked")} /> {t("ui.labReverbScopePicked", { n: picked.length })}</label>
      <label><input type="radio" name="reverb-scope" checked={scope === "track"} onchange={() => (scope = "track")} /> {t("ui.labReverbScopeTrack", { name: track?.name ?? "" })}</label>
    </span>
    <span>{t("ui.labReverbMin")}</span>
    <span class="row">{@render lengthSelect(choice.minLength, (n) => setReverbChoice({ minLength: n }))}<small class="muted">{t("ui.labReverbMinHint")}</small></span>
    <span></span>
    <label class="row"><input type="checkbox" checked={choice.beforeRest} onchange={(e) => setReverbChoice({ beforeRest: e.currentTarget.checked })} /> {t("ui.labReverbBeforeRest")}</label>
    <span></span>
    <span class="row">
      <label><input type="checkbox" checked={choice.fill} onchange={(e) => setReverbChoice({ fill: e.currentTarget.checked })} /> {t("ui.labReverbFill")}</label>
      <input type="number" min="1" max={profile.volume.max} disabled={!choice.fill} value={choice.fillLevel} onchange={(e) => setReverbChoice({ fillLevel: clampLevel(e.currentTarget.valueAsNumber) })} aria-label={t("ui.labReverbFillLevel")} />
      <small class="muted">{t("ui.labReverbFillHint", { max: profile.volume.max })}</small>
      {@render lengthSelect(choice.fillMaxNote, (n) => setReverbChoice({ fillMaxNote: n }))}
      <small class="muted">{t("ui.labReverbFillMax")}</small>
    </span>
  </div>
  {#if tooShort}<p class="warn">{t("ui.labReverbTooShort")}</p>{/if}
  <p class="muted">
    {t("ui.labReverbMade", { tails: result.tails, fills: result.fills, added: result.added })}{#if chars}{` · ${t("ui.slideChars", { n: chars.delta })}`}{/if}
  </p>
  {#if chars?.over}<p class="warn">{t("ui.slideCharsOver", { limit: profile.charLimitPerScore })}</p>{/if}
  {#if s.tied + s.locked + s.unwritable + s.silent > 0}
    <p class="muted">{t("ui.labReverbSkipped", { tied: s.tied, locked: s.locked, unwritable: s.unwritable, silent: s.silent })}</p>
  {/if}
  <p class="muted help">{t("ui.labReverbCredit")}</p>
  <footer>
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={changedCount === 0 || !levelsOk} onclick={apply}>{t("ui.apply")}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(600px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
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
  h3 {
    margin: 12px 0 4px;
    font-size: 0.95rem;
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
    margin: 4px 0;
  }
  input[type="number"] {
    width: 4.5em;
  }
  input[type="text"] {
    width: 8em;
  }
  input.bad {
    border-color: var(--danger);
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
