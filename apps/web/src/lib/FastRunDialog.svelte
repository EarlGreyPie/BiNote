<script lang="ts">
  import { barBeatAt, type GameProfile, type Rat, type Song } from "@mmlce/core";
  import { lengthPieces, type FastRunFitResult, type FastRunFixResult, type FastRunMoment } from "@mmlce/mml";
  import { t } from "./i18n.svelte";

  /**
   * 연주 누락음 고치기 창 (실험실, 곡 검사의 연주 누락음 위험 줄). 같은 샘플 구간에서 빠른 음 연속 뒤 같은 순간 착지해 게임에서 빠질 수 있는
   * 음을 자리마다 보이고, 그 음을 조금 늦춰 고친다(끝은 그대로). 자리마다 또는 모두 고칠 수 있고, 고칠 때마다 실행 취소 한 칸이다.
   * 기준은 실측 전(GameProfile.fastRunDrop, pending fastRunDrop)이라 그 안내를 함께 보인다. 곡을 볼 수 있게 화면을 막지 않는 창으로 띄운다.
   * 모두 고치기는 기본으로 글자 수 한도 안에서만 고친다 (fitFastRunFix: 넘치면 화음 분산, 그래도 넘치면 들어가는 만큼만, 악보책 곡은 권 수가 늘지 않는 만큼).
   * 글자 수 세기는 무거우므로(악보책 곡은 나누기까지 해서 수 초) 곡이 바뀐 뒤 잠깐 쉬었을 때 센다
   */
  interface Props {
    song: Song;
    profile: GameProfile;
    /**
     * 고치기 계획 (잠근 트랙·실제 악기는 부르는 쪽이 넣는다). only를 주면 그 착지 음이 든 순간만.
     * found를 주면 늘어나는 글자 수·남는 자리를 세지 않는 빠른 미리 보기 (이미 찾은 순간을 다시 쓴다)
     */
    plan: (only?: ReadonlySet<string>, found?: readonly FastRunMoment[]) => FastRunFixResult;
    /** 모두 고치기 계획 (글자 수 한도 안에서만, 넘치면 화음 분산). 잠근 트랙·실제 악기·화음 수는 부르는 쪽이 넣는다 */
    fit: (song: Song, options: FitChoice) => FastRunFitResult;
    ongo: (moment: FastRunMoment) => void;
    onapply: (result: FastRunFixResult) => void;
    onapplyfit: (result: FastRunFitResult, options: FitChoice) => void;
    onclose: () => void;
  }
  interface FitChoice {
    readonly limit: boolean;
    readonly distribute: boolean;
  }

  let { song, profile, plan, fit, ongo, onapply, onapplyfit, onclose }: Props = $props();

  /** 곡이 바뀐 뒤 글자 수를 다시 셀 때까지 기다리는 시간 (ms) */
  const FIT_DELAY_MS = 300;
  let limitOn = $state(true);
  let distributeOn = $state(true);
  let fitted = $state.raw<{ readonly song: Song; readonly choice: FitChoice; readonly result: FastRunFitResult } | undefined>(undefined);
  $effect(() => {
    const s = song;
    const choice: FitChoice = { limit: limitOn, distribute: distributeOn };
    const timer = setTimeout(() => {
      fitted = { song: s, choice, result: fit(s, choice) };
    }, FIT_DELAY_MS);
    return () => clearTimeout(timer);
  });
  /** 지금 곡과 고른 방식으로 센 모두 고치기 (세는 중이면 없음) */
  const current = $derived(fitted && fitted.song === song && fitted.choice.limit === limitOn && fitted.choice.distribute === distributeOn ? fitted.result : undefined);
  /** 글자 수 한도 때문에 고치지 않는 자리 (첫 착지 음 id) */
  const overLimit = $derived(new Set(limitOn && current ? current.overLimit.map((m) => m.landings[0]!.noteId) : []));
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.show();
  });

  const NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];
  const noteName = (midi: number) => `o${Math.floor(midi / 12) - 1}${NAMES[midi % 12]}`;
  /** 늦춘 길이를 쉼표 글로 (r64.) */
  const restText = (by: Rat) => (lengthPieces(by, profile.length) ?? []).map((p) => `r${p}`).join("");

  /** 모두 고치기 (글자 수까지 센다) */
  const all = $derived(plan());
  const rule = $derived(profile.fastRunDrop);

  const rows = $derived(
    all.moments.map((m) => {
      const ids = new Set(m.landings.map((l) => l.noteId));
      // 자리마다 미리 보기는 늦출 음과 길이만 (글자 수는 모두 고치기에서 센다: 최적화 출력이 트랙마다 수십 ms라)
      const one = plan(ids, all.moments);
      const { bar, beat } = barBeatAt(song.timeSig, m.at);
      const notes = m.landings.map((l) => {
        const track = song.tracks.find((tr) => tr.id === l.trackId);
        const note = track?.notes.find((n) => n.id === l.noteId);
        return `${track?.name ?? ""} ${note ? noteName(note.pitch) : ""}`;
      });
      const delays = [...new Set(one.delays.map((d) => t("ui.fastRunDelay", { rest: restText(d.by), ms: d.ms })))];
      return { key: m.landings[0]!.noteId, moment: m, ids, one, notes, delays, place: t("ui.checkPlace", { bar, beat: Number.isInteger(beat) ? beat : beat.toFixed(2) }) };
    }),
  );

  const skippedCount = (r: FastRunFixResult) => r.skipped.locked + r.skipped.short + r.skipped.unwritable + r.skipped.noLength;
  const skippedText = (r: FastRunFixResult) =>
    t("ui.fastRunSkipped", { locked: r.skipped.locked, short: r.skipped.short, unwritable: r.skipped.unwritable, none: r.skipped.noLength });

  function apply(result: FastRunFixResult) {
    if (result.changes.length > 0) onapply(result);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      dialog.close();
    }
  }
</script>

<dialog bind:this={dialog} {onclose} {onkeydown}>
  <h2>{t("ui.fastRunFix")} <span class="pending" title={t("ui.fastRunPendingHelp")}>{t("ui.pendingTag")}</span></h2>
  {#if rule}<p class="muted">{t("ui.fastRunIntro", { gap: rule.gapMs })}</p>{/if}
  <p class="muted fine">{t("ui.fastRunPendingHelp")}</p>
  {#if rows.length === 0}
    <p>{t("ui.fastRunNone")}</p>
  {:else}
    <p><strong>{t("ui.fastRunFound", { n: rows.length })}</strong></p>
    <ul>
      {#each rows as row (row.key)}
        <li>
          <span class="where">{row.place}</span>
          <span class="notes">{row.notes.join(" · ")}</span>
          <span class="muted fine">{row.delays.join(" · ")}</span>
          {#if skippedCount(row.one) > 0}<span class="muted fine">{skippedText(row.one)}</span>{/if}
          {#if overLimit.has(row.key)}<span class="warn fine">{t("ui.fastRunRowOverLimit")}</span>{/if}
          <span class="buttons">
            <button class="small" onclick={() => ongo(row.moment)}>{t("ui.offgridGo")}</button>
            <button class="small primary" disabled={row.one.changes.length === 0} title={t("ui.fastRunNotes", { n: row.one.delays.length })} onclick={() => apply(plan(row.ids))}
              >{t("ui.fastRunApply")} ({t("ui.fastRunNotes", { n: row.one.delays.length })})</button
            >
          </span>
        </li>
      {/each}
    </ul>
    <label class="choice"><input type="checkbox" bind:checked={limitOn} /> {t("ui.fastRunLimitOn", { limit: profile.charLimitPerScore })}</label>
    <label class="choice sub"><input type="checkbox" bind:checked={distributeOn} disabled={!limitOn} /> {t("ui.fastRunDistributeOn")}</label>
    {#if !current}
      <p class="muted">{t("ui.fastRunCounting")}</p>
    {:else}
      <p class="muted">
        {t("ui.fastRunNotes", { n: current.plan.delays.length })} · {t("ui.fastRunFitChars", { n: signed(current.chars.delta), longest: current.chars.longest, limit: profile.charLimitPerScore })}{#if current.books}{` · ${t("ui.fastRunBooks", { from: current.books.from, to: current.books.to })}`}{/if}
      </p>
      {#if current.moved > 0}<p class="muted">{t("ui.fastRunMoved", { n: current.moved })}</p>{/if}
      {#if limitOn && current.overLimit.length > 0}
        <p class="warn">{t("ui.fastRunOverLimit", { n: current.overLimit.length })}</p>
        {#if current.distributeKept}<p class="muted">{t("ui.fastRunNoDistribute")}</p>{/if}
        {#if current.fullOver > 0}<p class="muted">{t("ui.fastRunFullOver", { n: current.fullOver, limit: profile.charLimitPerScore })}</p>{/if}
      {/if}
      {#if !limitOn && !current.books && current.chars.longest > profile.charLimitPerScore}<p class="warn">{t("ui.slideCharsOver", { limit: profile.charLimitPerScore })}</p>{/if}
    {/if}
    {#if skippedCount(all) > 0}<p class="muted">{skippedText(all)}</p>{/if}
    {#if all.changes.length > 0 && all.left}<p class="warn">{t("ui.fastRunLeft", { n: all.left })}</p>{/if}
    {#if rule}<p class="muted fine">{t("ui.fastRunOther", { notes: rule.maxStarts })}</p>{/if}
  {/if}
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.close")}</button>
    <button
      class="primary"
      disabled={!current || current.song === current.before}
      onclick={() => current && onapplyfit(current, { limit: limitOn, distribute: distributeOn })}
      >{limitOn ? t("ui.fastRunApplyFit", { n: current?.fixed.length ?? 0, total: rows.length }) : t("ui.fastRunApplyAll", { n: rows.length })}</button
    >
  </div>
</dialog>

<style>
  dialog {
    position: fixed;
    inset: auto 16px 16px auto;
    margin: 0;
    z-index: 50;
    width: min(620px, calc(100vw - 32px));
    max-height: min(70vh, 640px);
    overflow: auto;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.3);
  }
  h2 {
    margin: 0 0 6px;
    font-size: 1.05rem;
  }
  p {
    margin: 4px 0;
  }
  .fine {
    font-size: 0.85rem;
  }
  .pending {
    margin-left: 6px;
    padding: 0 5px;
    border: 1px solid var(--line);
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: normal;
    color: var(--muted);
    cursor: help;
  }
  .warn {
    color: var(--danger);
  }
  ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    padding: 6px 0;
    border-top: 1px solid var(--line);
  }
  .where {
    min-width: 7em;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-left: auto;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .spacer {
    flex: 1;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 0;
  }
  .choice.sub {
    margin-left: 1.5em;
  }
</style>
