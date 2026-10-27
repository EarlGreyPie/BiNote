<script lang="ts">
  import { barBeatAt, soundingRangeOf, type GameProfile, type Song, type Track } from "@mmlce/core";
  import { instrumentsCovering, type FoldOption, type FoldPhrase } from "@mmlce/mml";
  import { instrumentName, t } from "./i18n.svelte";
  import { audible } from "./listenState";

  /**
   * 접힘 검토 창 (곡 메뉴, 곡 검사의 접힘 줄). 악기가 낼 수 없는 높이의 음은 게임이 음마다 옥타브째 접어 내므로
   * (실측 음역), 쉼표로 나뉜 구간마다 그대로 둘 때와 구간째 옥타브를 옮길 때를 견준다. 옮긴 뒤 접힘·옥타브 튐·
   * 다른 트랙과 같은 높이로 겹침·음색 경계를 넘는 &를 보이고, 권하는 것을 처음 골라 둔다. 저절로 바꾸지 않는다.
   * 곡을 볼 수 있게 화면을 막지 않는 창으로 띄운다
   */
  interface Props {
    song: Song;
    profile: GameProfile;
    phrases: readonly FoldPhrase[];
    instrumentOf: (track: Track) => string | undefined;
    ongo: (phrase: FoldPhrase) => void;
    onlisten: (phrase: FoldPhrase, shift: number) => void;
    onapply: (picks: readonly { phrase: FoldPhrase; shift: number }[]) => void;
    onclose: () => void;
  }

  let { song, profile, phrases, instrumentOf, ongo, onlisten, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.show();
  });

  const NAMES = ["c", "c+", "d", "d+", "e", "f", "f+", "g", "g+", "a", "a+", "b"];
  const noteName = (midi: number) => `o${Math.floor(midi / 12) - 1}${NAMES[midi % 12]}`;
  const keyOf = (p: FoldPhrase) => `${p.trackId}:${p.noteIds[0]}`;

  /** 구간마다 고른 옮기기 (고르지 않은 구간은 권하는 것). 곡이 바뀌어 지금 선택지에 없는 값이면 권하는 것으로 */
  let chosen = $state<Record<string, number>>({});
  function shiftOf(p: FoldPhrase): number {
    const pick = chosen[keyOf(p)];
    return pick !== undefined && p.options.some((o) => o.shift === pick) ? pick : p.best;
  }
  /** 옮긴 구간은 고른 값을 지운다 (옮긴 뒤 같은 구간이 남아도 옛 옮기기를 다시 걸지 않게) */
  function apply(list: readonly { phrase: FoldPhrase; shift: number }[]) {
    const next = { ...chosen };
    for (const { phrase } of list) delete next[keyOf(phrase)];
    chosen = next;
    onapply(list);
  }

  function shiftLabel(shift: number): string {
    if (shift === 0) return t("ui.foldAsIs");
    return t(shift > 0 ? "ui.foldUp" : "ui.foldDown", { n: Math.abs(shift) / 12 });
  }
  function optionText(o: FoldOption): string {
    const parts = [t("ui.foldFolds", { n: o.folds }), t("ui.foldBreaks", { n: o.breaks })];
    if (o.doubled > 0) parts.push(t("ui.foldDoubled", { n: o.doubled }));
    if (o.timbre > 0) parts.push(t("ui.foldTimbre", { n: o.timbre }));
    return `${shiftLabel(o.shift)} · ${parts.join(" · ")}`;
  }

  const rows = $derived(
    phrases.map((p) => {
      const track = song.tracks.find((tr) => tr.id === p.trackId);
      const { bar, beat } = barBeatAt(song.timeSig, p.start);
      const instrument = track ? instrumentOf(track) : undefined;
      const range = soundingRangeOf(profile, instrument);
      return {
        key: keyOf(p),
        phrase: p,
        track: track?.name ?? "",
        place: t("ui.checkPlace", { bar, beat: Number.isInteger(beat) ? beat : beat.toFixed(2) }),
        span: `${noteName(p.low)}-${noteName(p.high)}`,
        range: `${noteName(range.low)}-${noteName(range.high)}`,
        instrument: instrument ? instrumentName(instrument) : "",
      };
    }),
  );
  const picks = $derived(phrases.map((phrase) => ({ phrase, shift: shiftOf(phrase) })).filter((x) => x.shift !== 0));

  /** 접히는 음이 있는 트랙마다, 그 트랙 음을 모두 낼 수 있는 다른 악기 */
  const covering = $derived(
    [...new Set(phrases.map((p) => p.trackId))].flatMap((id) => {
      const track = song.tracks.find((tr) => tr.id === id);
      if (!track) return [];
      const own = instrumentOf(track);
      const list = instrumentsCovering(profile, track.notes).filter((x) => x !== own);
      return [{ id, name: track.name, list: list.map(instrumentName) }];
    }),
  );

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      dialog.close();
    }
  }
</script>

<dialog bind:this={dialog} {onclose} {onkeydown}>
  <h2>{t("ui.foldReview")}</h2>
  <p class="muted">{t("ui.foldReviewIntro")}</p>
  {#if rows.length === 0}
    <p>{t("ui.foldNone")}</p>
  {:else}
    <p><strong>{t("ui.foldFound", { n: rows.length })}</strong></p>
    <ul>
      {#each rows as row (row.key)}
        {@const shift = shiftOf(row.phrase)}
        <li>
          <span class="where"><span class="muted">{row.track}</span> {row.place}</span>
          <span class="muted range" title={t("ui.foldRangeHelp")}>{t("ui.foldRange", { span: row.span, instrument: row.instrument, range: row.range })}</span>
          <select value={shift} onchange={(e) => (chosen = { ...chosen, [row.key]: Number(e.currentTarget.value) })} aria-label={t("ui.foldPick")}>
            {#each row.phrase.options as o (o.shift)}
              <option value={o.shift}>{optionText(o)}{o.shift === row.phrase.best ? ` (${t("ui.foldBest")})` : ""}</option>
            {/each}
          </select>
          {#if !audible(song, row.phrase.trackId)}<span class="silent">{t("ui.offgridSilent")}</span>{/if}
          <span class="buttons">
            <button class="small" onclick={() => ongo(row.phrase)}>{t("ui.offgridGo")}</button>
            <button class="small" onclick={() => onlisten(row.phrase, 0)}>{t("ui.foldListenAsIs")}</button>
            <button class="small" disabled={shift === 0} onclick={() => onlisten(row.phrase, shift)}>{t("ui.offgridListenAfter")}</button>
            <button class="small primary" disabled={shift === 0} onclick={() => apply([{ phrase: row.phrase, shift }])}>{t("ui.foldApply")}</button>
          </span>
        </li>
      {/each}
    </ul>
    {#each covering as c (c.id)}
      <p class="muted cover">{c.list.length > 0 ? t("ui.foldCover", { track: c.name, list: c.list.join(", ") }) : t("ui.foldCoverNone", { track: c.name })}</p>
    {/each}
  {/if}
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.close")}</button>
    <button class="primary" disabled={picks.length === 0} onclick={() => apply(picks)}>{t("ui.foldApplyAll", { n: picks.length })}</button>
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
  .silent {
    font-size: 0.85rem;
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
    min-width: 9em;
  }
  .range,
  .cover {
    font-size: 0.85rem;
  }
  select {
    max-width: 100%;
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
