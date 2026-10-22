<script lang="ts">
  import { barBeatAt, rat, type Rat, type Song } from "@mmlce/core";
  import { customOffgrid, offgridLengthText, offgridLimit, type OffgridFix } from "@mmlce/mml";
  import { t } from "./i18n.svelte";
  import { audible, listenState } from "./listenState";

  /**
   * 어긋난 길이 찾기 창 (곡 메뉴, 3MLE·마비꼬·MML@ 글을 열 때 찾은 곳이 있으면 저절로 연다).
   * 자리마다 원래 → 고칠 값을 보이고 이동·원래 듣기·고친 뒤 듣기·고치기를 단다. 저절로 고치는 것은 없다.
   * 곡을 볼 수 있게 화면을 막지 않는 창으로 띄운다.
   * 듣기는 곡 전체를 끄기(M)·솔로(S) 설정대로 재생하므로, 지금 눌린 M/S와 그 자리 트랙이 안 들리는지를 함께 보인다.
   * 고칠 길이는 칸에 직접 적을 수 있다. 제안과 다르면 묶음 끝이 얼마나 늦거나 이른지(뒤가 그만큼 밀림) 바로 보인다
   */
  interface Props {
    song: Song;
    fixes: readonly OffgridFix[];
    ongo: (fix: OffgridFix) => void;
    onlisten: (fix: OffgridFix, fixed: boolean) => void;
    onfix: (fixes: readonly OffgridFix[]) => void;
    onclose: () => void;
  }

  let { song, fixes, ongo, onlisten, onfix, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.show();
  });

  /** 자리마다 사용자가 적은 길이 (적지 않은 자리는 제안대로) */
  let custom = $state<Record<string, string>>({});
  const limit = $derived(offgridLimit(song));

  const rows = $derived(
    fixes.map((fix, k) => {
      const { bar, beat } = barBeatAt(song.timeSig, fix.at);
      const key = `${fix.trackId}:${fix.edits[0]?.span[0] ?? k}:${fix.edits[0]?.from ?? ""}`;
      const suggested = fix.edits[0] ? offgridLengthText(fix.edits[0]) : "";
      const input = custom[key];
      const result = input === undefined || input.trim() === suggested ? undefined : customOffgrid(fix, input, limit);
      return {
        key,
        fix,
        // 실제로 고칠 것: 적은 길이가 없으면 제안, 쓸 수 없는 길이면 없음
        use: input === undefined || input.trim() === suggested ? fix : result?.fix,
        result,
        input: input ?? suggested,
        track: song.tracks.find((tr) => tr.id === fix.trackId)?.name ?? "",
        place: t("ui.checkPlace", { bar, beat: Number.isInteger(beat) ? beat : beat.toFixed(2) }),
        from: fix.edits.map((e) => e.from).join(", "),
      };
    }),
  );
  const usable = $derived(rows.flatMap((row) => (row.use ? [row.use] : [])));

  /** 어긋난 만큼: 64분음표 몇 개로 딱 떨어지면 그렇게, 아니면 4분음표의 몇 분의 몇 */
  function amount(miss: Rat): string {
    const abs = rat(Math.abs(miss.n), miss.d);
    const n64 = (abs.n * 64) / abs.d;
    if (Number.isInteger(n64)) return t("ui.offgridAmount64", { n: n64 });
    const q = rat(abs.n * 4, abs.d);
    return t("ui.offgridAmountQuarter", { frac: `${q.n}/${q.d}` });
  }
  function customNote(row: (typeof rows)[number]): { text: string; bad: boolean } | undefined {
    if (!row.use) return { text: t("ui.offgridCustomBad"), bad: true };
    const r = row.result;
    if (!r) return undefined;
    if (r.miss.n === 0) return { text: t("ui.offgridCustomOk"), bad: false };
    const text = t(r.miss.n > 0 ? "ui.offgridCustomLate" : "ui.offgridCustomEarly", { amount: amount(r.miss) });
    return { text: r.clean ? text : `${text} · ${t("ui.offgridCustomOffgrid")}`, bad: true };
  }

  const listen = $derived(listenState(song, (n) => t("ui.newTrackName", { n })));
  const listenNote = $derived(
    [
      t("ui.offgridListenAll"),
      ...(listen.solo.length > 0 ? [t("ui.offgridListenSolo", { names: listen.solo.join(", ") })] : []),
      ...(listen.muted.length > 0 ? [t("ui.offgridListenMuted", { names: listen.muted.join(", ") })] : []),
    ].join(" · "),
  );

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      dialog.close();
    }
  }
</script>

<dialog bind:this={dialog} {onclose} {onkeydown}>
  <h2>{t("ui.offgrid")}</h2>
  <p class="muted">{t("ui.offgridIntro")}</p>
  {#if rows.length === 0}
    <p>{t("ui.offgridNone")}</p>
  {:else}
    <p><strong>{t("ui.offgridFound", { n: rows.length })}</strong></p>
    <p class="muted listen">{listenNote}</p>
    <ul>
      {#each rows as row (row.key)}
        <li>
          <span class="where"><span class="muted">{row.track}</span> {row.place}</span>
          <span class="change">
            <code>{row.from}</code> →
            <input
              class="length"
              size="7"
              value={row.input}
              title={t("ui.offgridCustomHelp")}
              aria-label={t("ui.offgridCustomHelp")}
              oninput={(e) => (custom = { ...custom, [row.key]: e.currentTarget.value })}
            />
            {#if customNote(row)}{@const note = customNote(row)!}<span class:bad={note.bad} class="custom">{note.text}</span>{/if}
          </span>
          {#if row.fix.kind === "tuplet"}<span class="muted">{t("ui.offgridTuplet")}</span>{/if}
          {#if !audible(song, row.fix.trackId)}<span class="silent">{t("ui.offgridSilent")}</span>{/if}
          <span class="buttons">
            <button class="small" onclick={() => ongo(row.fix)}>{t("ui.offgridGo")}</button>
            <button class="small" onclick={() => onlisten(row.fix, false)}>{t("ui.offgridListenBefore")}</button>
            <button class="small" disabled={!row.use} onclick={() => row.use && onlisten(row.use, true)}>{t("ui.offgridListenAfter")}</button>
            <button class="small primary" disabled={!row.use} onclick={() => row.use && onfix([row.use])}>{t("ui.offgridFix")}</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="actions">
    <span class="spacer"></span>
    <button onclick={() => dialog.close()}>{t("ui.close")}</button>
    <button class="primary" disabled={usable.length === 0} onclick={() => onfix(usable)}>{t("ui.offgridFixAll", { n: usable.length })}</button>
  </div>
</dialog>

<style>
  dialog {
    position: fixed;
    inset: auto 16px 16px auto;
    margin: 0;
    z-index: 50;
    width: min(520px, calc(100vw - 32px));
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
  .listen {
    font-size: 0.85rem;
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
  .change {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .length {
    width: 6em;
    font-family: var(--mono, monospace);
  }
  .custom {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .custom.bad {
    color: var(--danger);
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
