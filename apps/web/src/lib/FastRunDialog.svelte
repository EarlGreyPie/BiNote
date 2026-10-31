<script lang="ts">
  import { barBeatAt, type GameProfile, type Rat, type Song } from "@mmlce/core";
  import { lengthPieces, type FastRunFixResult, type FastRunMoment } from "@mmlce/mml";
  import { t } from "./i18n.svelte";

  /**
   * 연주 누락음 고치기 창 (실험실, 곡 검사의 연주 누락음 위험 줄). 같은 샘플 구간에서 빠른 음 연속 뒤 같은 순간 착지해 게임에서 빠질 수 있는
   * 음을 자리마다 보이고, 그 음을 조금 늦춰 고친다(끝은 그대로). 자리마다 또는 모두 고칠 수 있고, 고칠 때마다 실행 취소 한 칸이다.
   * 기준은 실측 전(GameProfile.fastRunDrop, pending fastRunDrop)이라 그 안내를 함께 보인다. 곡을 볼 수 있게 화면을 막지 않는 창으로 띄운다
   */
  interface Props {
    song: Song;
    profile: GameProfile;
    /**
     * 고치기 계획 (잠근 트랙·실제 악기는 부르는 쪽이 넣는다). only를 주면 그 착지 음이 든 순간만.
     * found를 주면 늘어나는 글자 수·남는 자리를 세지 않는 빠른 미리 보기 (이미 찾은 순간을 다시 쓴다)
     */
    plan: (only?: ReadonlySet<string>, found?: readonly FastRunMoment[]) => FastRunFixResult;
    ongo: (moment: FastRunMoment) => void;
    onapply: (result: FastRunFixResult) => void;
    onclose: () => void;
  }

  let { song, profile, plan, ongo, onapply, onclose }: Props = $props();

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
          <span class="buttons">
            <button class="small" onclick={() => ongo(row.moment)}>{t("ui.offgridGo")}</button>
            <button class="small primary" disabled={row.one.changes.length === 0} title={t("ui.fastRunNotes", { n: row.one.delays.length })} onclick={() => apply(plan(row.ids))}
              >{t("ui.fastRunApply")} ({t("ui.fastRunNotes", { n: row.one.delays.length })})</button
            >
          </span>
        </li>
      {/each}
    </ul>
    <p class="muted">
      {t("ui.fastRunNotes", { n: all.delays.length })}{#if all.chars}{` · ${t("ui.slideChars", { n: all.chars.delta })}`}{/if}
    </p>
    {#if all.chars?.over}<p class="warn">{t("ui.slideCharsOver", { limit: profile.charLimitPerScore })}</p>{/if}
    {#if skippedCount(all) > 0}<p class="muted">{skippedText(all)}</p>{/if}
    {#if all.changes.length > 0 && all.left}<p class="warn">{t("ui.fastRunLeft", { n: all.left })}</p>{/if}
    {#if rule}<p class="muted fine">{t("ui.fastRunOther", { notes: rule.maxStarts })}</p>{/if}
  {/if}
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.close")}</button>
    <button class="primary" disabled={all.changes.length === 0} onclick={() => apply(all)}>{t("ui.fastRunApplyAll", { n: rows.length })}</button>
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
</style>
