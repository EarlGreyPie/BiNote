<script lang="ts">
  import { isSoloInstrument, type GameProfile, type Rat, type Song, type TempoEvent } from "@mmlce/core";
  import { gamePaste, pasteTempoChoices } from "@mmlce/mml";
  import { instrumentName, t } from "./i18n.svelte";
  import Icon from "./Icon.svelte";
  import { isCopied, nextExportPick, trackStamp, type OutputRow, type TempoAdvice } from "./output";
  import { scaleText, tempoConvertNotice, tempoConvertPlan, type TempoConvertOutcome } from "./tempoConvert";

  /**
   * MML로 내보내기 (출력 점검판, 파일·곡 메뉴). 구조 목록처럼 악보 줄 아래에 트랙 줄을 두고, 모든 악보의 트랙에서
   * 붙여넣기 한 번에 넣을 트랙(게임 악보 한도, 6개)을 골라 MML@ 글 하나로 복사한다. 복사한 트랙은 "복사됨"으로 표시하고
   * 아직 복사하지 않은 트랙을 다음 복사에 미리 체크한다. 아래 "템포 넣기"(기본 켬)를 켜면 복사마다 템포로 시작한다
   * (게임은 붙여넣은 글 하나만 보고, 템포가 없으면 t120으로 친다). 창을 띄운 채 화음 분산·글자 수 줄이기를 하면 수가 바로 바뀐다.
   * 위에는 게임 범위 밖 템포와 글자 수 넘침을 고칠 방법을 모아 둔다
   */
  interface Props {
    song: Song;
    rows: readonly OutputRow[];
    tempo: readonly TempoAdvice[];
    profile: GameProfile;
    /** 악보 하나에 담는 트랙 수 (연주자 악기의 화음 수 한도) */
    chordsOf: (playerId: string) => number;
    /** 트랙 id → 복사할 때의 도장 (곡을 열면 비운다) */
    copied: ReadonlyMap<string, string> | undefined;
    oncopied: (stamps: ReadonlyMap<string, string>) => void;
    /** 트랙 이름을 누르면 그 트랙으로 */
    ontrack: (trackId: string) => void;
    /** 템포 자리로 커서 옮기기 */
    onseek: (at: Rat) => void;
    /**
     * 범위 밖 템포 안내 한 줄을 실제 시간 유지 템포 변환으로 고친다 (실행 취소 한 칸). 결과를 돌려주고,
     * 잠근 트랙 확인에서 그만두면 undefined
     */
    onconvert: (advice: TempoAdvice) => TempoConvertOutcome | undefined;
    /** 화음 분산 창 열기 (처음 고를 보내는 트랙 = 한도를 넘는 첫 트랙) */
    ondistribute: (source?: string) => void;
    onsplit: () => void;
    /** 접힘·오류·경고 표시를 누르면 창을 닫고 상태줄 검사 목록을 연다 (그 자리로 가는 단추가 있다) */
    onchecks: () => void;
    onclose: () => void;
  }

  let { song, rows, tempo, profile, chordsOf, copied, oncopied, ontrack, onseek, onconvert, ondistribute, onsplit, onchecks, onclose }: Props = $props();
  const limit = $derived(profile.charLimitPerScore);
  const tempoRange = $derived(profile.tempo);
  /** 붙여넣기 한 번에 넣을 수 있는 트랙 수 */
  const pickLimit = $derived(profile.maxChordsPerPlayer);

  let dialog: HTMLDialogElement;
  $effect(() => {
    dialog.showModal();
  });
  /** 창을 닫고 할 일 (트랙·자리로 가기, 나누기) */
  function closeThen(run: () => void) {
    dialog.close();
    run();
  }

  const done = (id: string) => isCopied(song, copied, id);
  const trackIdsOf = (row: OutputRow) => row.tracks.map((tr) => tr.trackId);
  // svelte-ignore state_referenced_locally
  let picked = $state<readonly string[]>(nextExportPick(rows.map((r) => ({ trackIds: trackIdsOf(r) })), done, profile.maxChordsPerPlayer));
  /** 곡이 바뀌어 없어진 트랙은 고른 것에서 뺀다 */
  const chosen = $derived(picked.filter((id) => song.tracks.some((tr) => tr.id === id)));
  const full = $derived(chosen.length >= pickLimit);
  /** 방금 복사한 트랙 수 (복사했다는 알림. 고른 것을 바꾸면 지운다) */
  let justCopied = $state(0);

  function toggleTrack(id: string) {
    justCopied = 0;
    if (chosen.includes(id)) picked = chosen.filter((x) => x !== id);
    else if (!full) picked = [...chosen, id];
  }
  /** 악보 체크: 다 골랐으면 모두 빼고, 아니면 남은 트랙을 모두 더한다 (한도를 넘으면 못 누른다) */
  function toggleScore(row: OutputRow) {
    justCopied = 0;
    const ids = trackIdsOf(row);
    if (ids.every((id) => chosen.includes(id))) picked = chosen.filter((id) => !ids.includes(id));
    else picked = [...chosen, ...ids.filter((id) => !chosen.includes(id))];
  }
  const scoreRoom = (row: OutputRow) => chosen.length + trackIdsOf(row).filter((id) => !chosen.includes(id)).length <= pickLimit;

  // 악보 접기: 기본은 모두 펼침. 다 복사한 악보는 복사할 때 접는다 (다시 펼칠 수 있다)
  let collapsed = $state<ReadonlySet<string>>(new Set());
  const rowKey = (row: OutputRow) => `${row.playerId}:${row.index}`;
  function toggleCollapse(row: OutputRow) {
    const next = new Set(collapsed);
    if (!next.delete(rowKey(row))) next.add(rowKey(row));
    collapsed = next;
  }

  // 템포 넣기 (기본 켬). 고른 악보끼리 원문 템포가 다르면 넣을 템포를 고르고, 이 창에서는 다음 복사에도 그 템포를 쓴다
  let withTempo = $state(true);
  let tempoKey = $state<string | undefined>(undefined);
  const choices = $derived(withTempo && chosen.length > 0 ? pasteTempoChoices(song, chosen, chordsOf) : []);
  const tempoPick = $derived(choices.find((c) => c.key === tempoKey) ?? choices[0]);
  /** 섞인 악보를 복사할 때 쓴 템포. 남은 트랙이 한 악보뿐이라 고를 거리가 없어져도 창을 닫을 때까지 이 템포로 넣는다 */
  let keptTempo = $state<readonly TempoEvent[] | undefined>(undefined);
  const tempoMap = $derived(tempoPick?.tempo ?? keptTempo);

  /** 붙여넣는 글 안의 트랙 순서 = 체크한 순서 (곡 구조는 그대로). 악보 체크·미리 체크는 곡 순서로 붙는다 */
  const songOrder = (ids: readonly string[]) => song.tracks.map((tr) => tr.id).filter((id) => ids.includes(id));
  const pasteOrder = $derived(chosen);
  const reordered = $derived(chosen.some((id, k) => id !== songOrder(chosen)[k]));
  function shiftOrder(id: string, step: -1 | 1) {
    const list = [...chosen];
    const k = list.indexOf(id);
    const j = k + step;
    if (k < 0 || j < 0 || j >= list.length) return;
    [list[k], list[j]] = [list[j]!, list[k]!];
    picked = list;
    justCopied = 0;
  }

  const paste = $derived(
    chosen.length > 0 ? gamePaste(song, chosen, chordsOf, pickLimit, { tempo: withTempo, tempoMap, charLimit: limit, order: reordered ? pasteOrder : undefined }) : undefined,
  );
  const pastedCount = (id: string) => paste?.written.get(id)?.length;
  const pasteOver = $derived(paste ? [...paste.written.values()].some((text) => text.length > limit) : false);
  const silent = $derived(paste ? paste.pasted.filter((id): id is string => id !== null && !paste.trackIds.includes(id)) : []);
  const nameOf = (id: string) => song.tracks.find((tr) => tr.id === id)?.name ?? id;
  const silentOver = $derived(silent.filter((id) => (pastedCount(id) ?? 0) > limit).map(nameOf));
  /** 오르골·축음기 트랙이 붙여넣는 글의 소리 칸(앞 화음 수만큼) 밖에 놓였다 */
  const soloMuted = $derived(
    paste
      ? paste.pasted
          .map((id, k) => ({ id, k }))
          .filter(({ id, k }) => {
            const track = id === null ? undefined : song.tracks.find((tr) => tr.id === id);
            const player = track && song.players.find((p) => p.id === track.playerId);
            return track !== undefined && paste.trackIds.includes(track.id) && isSoloInstrument(profile, player?.instrument.canonical) && k >= chordsOf(track.playerId);
          })
          .map(({ id }) => nameOf(id!))
      : [],
  );
  const soloSize = $derived(Math.min(...song.players.filter((p) => isSoloInstrument(profile, p.instrument.canonical)).map((p) => chordsOf(p.id))));

  const tempoText = (list: readonly TempoEvent[]) => (list.length === 0 ? "t120" : list.length === 1 ? `t${list[0]!.bpm}` : `t${list[0]!.bpm} → …`);
  const scoreList = (scores: readonly number[]) => scores.map((k) => rows[k]?.number ?? k + 1).join("·");

  async function copy() {
    // 고른 것을 바꾸면 paste가 다시 계산되므로 복사한 글을 붙잡아 둔다
    const sent = paste;
    if (!sent) return;
    const mixedTempo = withTempo && choices.length > 0 ? tempoPick?.tempo : undefined;
    try {
      await navigator.clipboard.writeText(sent.text);
    } catch {
      justCopied = 0;
      return;
    }
    const stamps = new Map(copied ?? []);
    for (const id of sent.trackIds) {
      const track = song.tracks.find((tr) => tr.id === id);
      if (track) stamps.set(id, trackStamp(song, track));
    }
    oncopied(stamps);
    if (mixedTempo) keptTempo = mixedTempo;
    const now = (id: string) => isCopied(song, stamps, id);
    // 다 복사한 악보는 접고, 아직 복사하지 않은 트랙을 다음 복사에 미리 체크한다
    const fold = new Set(collapsed);
    for (const row of rows) if (trackIdsOf(row).every(now) && trackIdsOf(row).some((id) => sent.trackIds.includes(id))) fold.add(rowKey(row));
    collapsed = fold;
    picked = nextExportPick(rows.map((r) => ({ trackIds: trackIdsOf(r) })), now, pickLimit);
    justCopied = sent.trackIds.length;
  }

  /**
   * 실제 시간 유지 템포 변환을 누른 결과. 거절은 그 줄 아래에(곡이 그대로인 동안), 바꾼 알림은 안내 맨 위에
   * (그 줄은 범위 안이 되어 사라지므로. 실행 취소 등으로 곡이 바뀌면 지운다) 보인다
   */
  let convertNote = $state.raw<{ song: Song; key?: string; text: string; bad: boolean } | undefined>(undefined);
  const adviceKey = (a: TempoAdvice) => `${a.at.n}/${a.at.d}`;
  const shownNote = $derived(convertNote?.song === song ? convertNote : undefined);
  function convert(a: TempoAdvice) {
    const before = song;
    const outcome = onconvert(a);
    if (!outcome) return;
    const note = tempoConvertNotice(before, a, outcome, profile.length.max, t);
    convertNote = outcome.kind === "done" ? { song: outcome.song, text: note.text, bad: false } : { song: before, key: adviceKey(a), text: note.text, bad: note.bad };
  }

  const overCount = $derived(rows.filter((r) => r.over).length);
  const fixCount = $derived(rows.filter((r) => r.over || r.errors > 0).length);
  const allCopied = $derived(rows.length > 0 && rows.every((r) => trackIdsOf(r).every(done)));
</script>

<dialog class="output" bind:this={dialog} {onclose}>
  <header>
    <h2>{t("ui.outputTitle")}</h2>
    <span class="muted">
      {fixCount === 0 && tempo.length === 0 ? t("ui.outputSummaryOk", { count: rows.length }) : t("ui.outputSummaryFix", { count: rows.length, fix: fixCount })}
    </span>
    <span class="spacer"></span>
    <button class="small" onclick={() => dialog.close()}>{t("ui.close")}</button>
  </header>
  <p class="muted help">{t("ui.outputHelp", { max: pickLimit })}</p>

  {#if tempo.length > 0 || overCount > 0 || (shownNote && !shownNote.key)}
    <ul class="advice">
      {#if shownNote && !shownNote.key}<li class="ok" role="status">{shownNote.text}</li>{/if}
      {#each tempo as a (adviceKey(a))}
        {@const plan = tempoConvertPlan(song, a, tempoRange)}
        <li class="warn">
          {a.high
            ? t("ui.outputTempoHigh", { bpm: a.bpm, bar: a.bar, beat: a.beat, min: tempoRange.min, max: tempoRange.max, factor: a.factor, to: a.to, quarter: 4 * a.factor })
            : t("ui.outputTempoLow", { bpm: a.bpm, bar: a.bar, beat: a.beat, min: tempoRange.min, max: tempoRange.max, factor: a.factor, to: a.to })}
          <span class="acts">
            {#if plan}
              <button class="small" title={t("ui.outputTempoConvertHelp", { to: a.to, scale: scaleText(plan.scale) })} onclick={() => convert(a)}>{t("ui.outputTempoConvert")}</button>
            {/if}
            <button class="small" onclick={() => closeThen(() => onseek(a.at))}>{t("ui.outputTempoGo")}</button>
          </span>
          {#if shownNote?.key === adviceKey(a)}<p class="note" class:bad={shownNote.bad} role="status">{shownNote.text}</p>{/if}
        </li>
      {/each}
      {#if overCount > 0}
        <li class="bad">
          {t("ui.outputOver", { limit, count: overCount })}
          <span class="acts">
            <button class="small" title={t("ui.distributeHelp")} onclick={() => ondistribute(rows.flatMap((r) => r.tracks).find((tr) => tr.over)?.trackId)}>{t("ui.distribute")}…</button>
            <button class="small" onclick={() => closeThen(onsplit)}>{t("ui.split")}…</button>
          </span>
        </li>
      {/if}
    </ul>
  {/if}

  <ul class="rows">
    {#each rows as row (rowKey(row))}
      {@const ids = trackIdsOf(row)}
      {@const all = ids.every((id) => chosen.includes(id))}
      {@const some = !all && ids.some((id) => chosen.includes(id))}
      {@const open = !collapsed.has(rowKey(row))}
      <li class="row">
        <div class="head">
          <button class="fold" onclick={() => toggleCollapse(row)} title={open ? t("ui.exportCollapse") : t("ui.exportExpand")} aria-expanded={open}>
            <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
          </button>
          <label class="pick" title={!all && !scoreRoom(row) ? t("ui.exportLimit", { max: pickLimit }) : undefined}>
            <input type="checkbox" checked={all} indeterminate={some} disabled={!all && !scoreRoom(row)} onchange={() => toggleScore(row)} />
            <strong>{t("ui.scoreN", { n: row.number })}</strong>
          </label>
          <span>{instrumentName(row.instrument)}</span>
          <span class="muted">{t("ui.outputTracks", { count: row.tracks.length, max: row.maxChords })}</span>
          {#if ids.every(done)}<span class="badge ok">{t("ui.exportCopiedMark")}</span>{/if}
          {#if row.fold > 0}<button class="badge warn link" title={t("ui.outputChecksHint")} onclick={() => closeThen(onchecks)}>{t("ui.outputFold", { count: row.fold })}</button>{/if}
          {#if row.errors > 0}<button class="badge bad link" title={t("ui.outputChecksHint")} onclick={() => closeThen(onchecks)}>{t("ui.outputErrors", { count: row.errors })}</button>{/if}
          {#if row.warnings > 0}<button class="badge warn link" title={t("ui.outputChecksHint")} onclick={() => closeThen(onchecks)}>{t("ui.outputWarnings", { count: row.warnings })}</button>{/if}
        </div>
        {#if open}
          <div class="tracks">
            {#each row.tracks as tr (tr.trackId)}
              {@const on = chosen.includes(tr.trackId)}
              {@const count = on ? (pastedCount(tr.trackId) ?? tr.count) : tr.count}
              {@const was = copied?.has(tr.trackId) ?? false}
              <div class="track" class:full={count > limit}>
                <label class="pick" title={!on && full ? t("ui.exportLimit", { max: pickLimit }) : undefined}>
                  <input type="checkbox" checked={on} disabled={!on && full} onchange={() => toggleTrack(tr.trackId)} />
                </label>
                <button class="name" onclick={() => closeThen(() => ontrack(tr.trackId))} title={t("ui.outputTrackGo")}>{tr.name}</button>
                <span class="bar"><span style:width="{Math.min(100, (count / limit) * 100)}%"></span></span>
                <span class="count">{count}/{limit}</span>
                {#if done(tr.trackId)}<span class="badge ok">{t("ui.exportCopiedMark")}</span>{:else if was}<span class="badge warn">{t("ui.exportChangedMark")}</span>{/if}
              </div>
            {/each}
          </div>
          {#if row.asIs.length > 0}<p class="muted note">{t("ui.outputAsIs")}</p>{/if}
        {/if}
      </li>
    {/each}
  </ul>

  <footer>
    <label class="pick">
      <input type="checkbox" bind:checked={withTempo} />
      {t("ui.exportTempo")}
    </label>
    {#if !withTempo}
      <p class="muted note">{t("ui.exportTempoOff")}</p>
    {:else if choices.length > 0}
      <div class="tempo-pick">
        <p class="note warn">{t("ui.exportTempoMixed")}</p>
        {#each choices as c (c.key)}
          <label class="pick">
            <input type="radio" name="export-tempo" checked={c === tempoPick} onchange={() => (tempoKey = c.key)} />
            {t("ui.exportTempoChoice", { scores: scoreList(c.scores), tempo: tempoText(c.tempo) })}
          </label>
        {/each}
      </div>
    {:else if keptTempo}
      <p class="muted note">{t("ui.exportTempoKept", { tempo: tempoText(keptTempo) })}</p>
    {/if}
    {#if pasteOrder.length > 1}
      <div class="paste-order">
        <span class="muted" title={t("ui.exportOrderHelp")}>{t("ui.exportOrder")}</span>
        {#each pasteOrder as id, k (id)}
          <span class="chip">
            <button class="small" disabled={k === 0} title={t("ui.exportOrderEarlier")} aria-label={t("ui.exportOrderEarlier")} onclick={() => shiftOrder(id, -1)}>‹</button>
            <span>{k + 1}. {nameOf(id)}</span>
            <button class="small" disabled={k === pasteOrder.length - 1} title={t("ui.exportOrderLater")} aria-label={t("ui.exportOrderLater")} onclick={() => shiftOrder(id, 1)}>›</button>
          </span>
        {/each}
        {#if reordered}<button class="small" onclick={() => (picked = songOrder(chosen))}>{t("ui.exportOrderReset")}</button>{/if}
      </div>
    {/if}
    {#if silent.length > 0}<p class="muted note" title={t("ui.pasteSilentHint")}>{t("ui.pasteSilent", { count: silent.length })} · {t("ui.pasteSilentHint")}</p>{/if}
    {#if silentOver.length > 0}<p class="note bad">{t("ui.outputSilentOver", { names: silentOver.join(", "), limit })}</p>{/if}
    {#if soloMuted.length > 0}<p class="note warn">{t("ui.exportSoloChannel", { names: soloMuted.join(", "), count: soloSize })}</p>{/if}
    {#if paste && paste.asIs.length > 0}<p class="muted note">{t("ui.outputAsIs")}</p>{/if}
    {#if paste && paste.moved.length > 0}<p class="muted note">{t("ui.outputTempoMoved", { count: paste.moved.length })}</p>{/if}
    <div class="copy-row">
      <span class="muted">{chosen.length === 0 && allCopied ? t("ui.exportAllCopied") : t("ui.exportPicked", { count: chosen.length, max: pickLimit })}</span>
      {#if justCopied > 0}<span class="badge ok">{t("ui.exportDone", { count: justCopied })}</span>{/if}
      <span class="spacer"></span>
      <button class="primary" disabled={!paste} onclick={copy} title={chosen.length === 0 ? t("ui.exportNone") : undefined}>
        {pasteOver ? t("ui.exportCopyOver") : t("ui.exportCopy")}
      </button>
    </div>
  </footer>
</dialog>

<style>
  .output {
    width: min(760px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
  }
  .output::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  header,
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  h2 {
    margin: 0;
  }
  .spacer {
    flex: 1;
  }
  .help {
    margin: 4px 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .advice li {
    padding: 3px 0;
  }
  .acts {
    display: inline-flex;
    gap: 6px;
    margin-left: 6px;
  }
  .advice .ok {
    color: var(--accent);
  }
  .advice .warn,
  .badge.warn {
    color: var(--ev-marker);
  }
  .advice .bad,
  .badge.bad {
    color: var(--danger);
  }
  .row {
    border-top: 1px solid var(--line);
    padding: 6px 0;
  }
  .badge {
    font-size: 0.85em;
  }
  .paste-order {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin: 4px 0;
  }
  .paste-order .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 2px;
  }
  button.badge.link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: underline dotted;
  }
  .tracks {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 4px 0 0 22px;
  }
  .track {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
  }
  .name,
  .fold {
    border: none;
    background: none;
    padding: 2px 4px;
    font: inherit;
    color: inherit;
    cursor: pointer;
    border-radius: 4px;
  }
  .fold {
    display: inline-flex;
    padding: 2px;
  }
  .name:hover,
  .fold:hover {
    background: var(--hover, rgba(127, 127, 127, 0.12));
  }
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }
  .badge.ok {
    color: var(--accent);
  }
  .note.warn {
    color: var(--ev-marker);
  }
  .note.bad {
    color: var(--danger);
  }
  footer {
    position: sticky;
    bottom: -12px;
    margin: 6px -16px -12px;
    padding: 8px 16px 12px;
    border-top: 1px solid var(--line);
    background: var(--panel);
  }
  .tempo-pick {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
  }
  .copy-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .bar {
    display: inline-block;
    width: 56px;
    height: 6px;
    border-radius: 3px;
    background: var(--line);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .track.full .bar span {
    background: var(--danger);
  }
  .track.full .count {
    color: var(--danger);
  }
  .count {
    font-variant-numeric: tabular-nums;
    font-size: 0.9em;
  }
  .note {
    margin: 2px 0 0;
    font-size: 0.85em;
  }
</style>
