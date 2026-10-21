<script lang="ts">
  import { type Command, type GameProfile, type Rat, type Song } from "@mmlce/core";
  import { autoSpreadSpans, findSpreadSpans, spansOverlap, spreadCandidates, spreadResult, spreadSong, type SpreadResult, type SpreadSpan } from "@mmlce/mml";
  import { untrack } from "svelte";
  import { t } from "./i18n.svelte";
  import { previewRows } from "./output";
  import { defaultSpreadSource, songEnd, spanX, trackChars } from "./chordTools";

  /**
   * 화음 분산 창 (곡 메뉴, MML로 내보내기 창의 [화음 분산…]). 글자 수가 넘치는 트랙에서 다른 트랙으로 마디 구간째 음을 옮긴다.
   * 받을 트랙을 고르면 "빈 곳 찾기"가 옮길 수 있는 구간을 늘어놓고, 사용자가 구간을 체크하거나 "넘친 만큼 고르기"로 고른다.
   * 체크를 바꿀 때마다 적용한 결과(글자 수 전후)를 다시 계산해 보여 준다. 음은 빼지 않는다 (자리만 바꾼다)
   */
  interface Props {
    song: Song;
    profile: GameProfile;
    locked: ReadonlySet<string>;
    /** 처음 고를 보내는 트랙 (MML로 내보내기 창에서 연 경우 그 줄의 넘치는 트랙) */
    initialSource?: string | undefined;
    /** 트랙 이름 앞에 붙일 악보 이름 */
    where: (trackId: string) => string;
    /** 이 연주자가 트랙을 더하면 악보가 하나 더 생기는지 */
    newScoreOnAdd: (playerId: string) => boolean;
    onseek: (at: Rat) => void;
    /** 보내는 트랙과 같은 악보에 빈 트랙을 더한다 (실행 취소 한 칸, 창은 그대로) */
    onaddtrack: (playerId: string) => void;
    onsplit: () => void;
    onapply: (command: Command) => void;
    onclose: () => void;
  }

  let { song, profile, locked, initialSource, where, newScoreOnAdd, onseek, onaddtrack, onsplit, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  const limit = $derived(profile.charLimitPerScore);
  // svelte-ignore state_referenced_locally
  let source = $state(defaultSpreadSource(song, profile.charLimitPerScore, locked, initialSource) ?? "");
  const candidates = $derived(source ? spreadCandidates(song, profile, source, locked) : []);
  /** 받을 트랙 (처음엔 받을 수 있는 트랙 모두) */
  let targets = $state<string[]>([]);
  /** 이미 본 받을 수 있는 트랙 (새로 생긴 트랙만 저절로 체크한다) */
  const known = new Set<string>();
  $effect(() => {
    // 보내는 트랙을 바꾸거나 트랙을 더하면 받을 수 있는 트랙을 새로 고른다 (더한 트랙은 체크해 둔다)
    const open = candidates.filter((c) => !c.block).map((c) => c.trackId);
    untrack(() => {
      const kept = targets.filter((id) => open.includes(id));
      targets = kept.length > 0 ? [...kept, ...open.filter((id) => !known.has(id))] : open;
      for (const id of open) known.add(id);
    });
  });
  const spans = $derived(source ? findSpreadSpans(song, source, targets) : []);
  /** 체크한 구간 id */
  let picked = $state<string[]>([]);
  const pickedSpans = $derived(spans.filter((s) => picked.includes(s.id)));
  $effect(() => {
    // 구간 목록이 바뀌면 없어진 구간 체크는 지운다
    const ids = new Set(spans.map((s) => s.id));
    untrack(() => {
      if (picked.some((id) => !ids.has(id))) picked = picked.filter((id) => ids.has(id));
    });
  });

  const name = (id: string) => song.tracks.find((tr) => tr.id === id)?.name ?? "";
  const color = (id: string) => song.tracks.find((tr) => tr.id === id)?.color ?? "var(--muted)";
  const blockText = { locked: "ui.spreadBlockLocked", score: "ui.spreadBlockScore", sound: "ui.spreadBlockSound" } as const;

  /** 적용한 결과 (체크를 바꾸면 잠깐 뒤에 다시 센다: 출력기로 모든 트랙을 다시 써 봐야 해서 느리다) */
  let result = $state.raw<SpreadResult | undefined>(undefined);
  let busy = $state(false);
  $effect(() => {
    const chosen = pickedSpans;
    const from = source;
    const base = song;
    if (chosen.length === 0 || !from) {
      result = undefined;
      busy = false;
      return;
    }
    busy = true;
    const timer = setTimeout(() => {
      result = spreadResult(base, profile, from, chosen, locked);
      busy = false;
    }, 120);
    return () => clearTimeout(timer);
  });
  const rows = $derived(result && result.moved > 0 ? previewRows(song, result.song, limit) : []);
  const sourceChars = $derived(source ? trackChars(song, source) : 0);
  const stillOver = $derived(result && result.moved > 0 ? rows.filter((r) => r.after > limit).length : sourceChars > limit ? 1 : 0);

  let picking = $state(false);
  function autoPick() {
    if (!source || picking) return;
    picking = true;
    // 계산이 길 수 있어 "고르는 중"을 먼저 그린 뒤 고른다
    setTimeout(() => {
      const chosen = autoSpreadSpans(song, profile, source, spans, locked, pickedSpans);
      picked = chosen.map((s) => s.id);
      picking = false;
    }, 20);
  }

  function toggle(span: SpreadSpan, on: boolean) {
    picked = on ? [...picked, span.id] : picked.filter((id) => id !== span.id);
  }
  /** 이미 고른 다른 구간과 시간이 겹치면 고를 수 없다 */
  const clash = (span: SpreadSpan) => pickedSpans.some((p) => p.id !== span.id && spansOverlap(p, span));

  const end = $derived(songEnd(song));
  const player = $derived(song.tracks.find((tr) => tr.id === source)?.playerId);

  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (!result || result.moved === 0 || busy) return;
    onapply(spreadSong(profile, source, pickedSpans, locked, t("ui.distribute")));
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.distribute")}</h2>
  <p class="muted">{t("ui.spreadIntro")}</p>

  <label class="row">
    {t("ui.spreadSource")}
    <select bind:value={source} onchange={() => (picked = [])}>
      {#each song.tracks.filter((tr) => !locked.has(tr.id)) as tr (tr.id)}
        {@const chars = trackChars(song, tr.id)}
        <option value={tr.id}>{where(tr.id)} {tr.name} · {t("ui.spreadChars", { count: chars })}{chars > limit ? " ⚠" : ""}</option>
      {/each}
    </select>
  </label>

  <fieldset>
    <legend>{t("ui.spreadTargets")}</legend>
    {#if candidates.length === 0}
      <p class="muted">{t("ui.spreadNoTargets")}</p>
    {/if}
    {#each candidates as c (c.trackId)}
      <label class:off={!!c.block} title={c.block ? t(blockText[c.block]) : ""}>
        <input type="checkbox" value={c.trackId} bind:group={targets} disabled={!!c.block} onchange={() => (picked = [])} />
        <span class="dot" style:background={color(c.trackId)}></span>
        {name(c.trackId)} <span class="muted">· {t("ui.spreadChars", { count: trackChars(song, c.trackId) })}</span>
        {#if c.block}<span class="muted">({t(blockText[c.block])})</span>{/if}
      </label>
    {/each}
    {#if player}
      <div class="row">
        <!-- 악보가 꽉 차면 더한 트랙은 다음 악보로 가서 받을 수 없다 -->
        {#if newScoreOnAdd(player)}
          <span class="muted small">{t("ui.previewAddTrackNewScore")}</span>
        {:else}
          <button class="small" onclick={() => onaddtrack(player)}>{t("ui.spreadAddTrack")}</button>
        {/if}
      </div>
    {/if}
  </fieldset>

  <fieldset>
    <legend>{t("ui.spreadFind")} <span class="muted">({spans.length})</span></legend>
    {#if spans.length === 0}
      <p class="muted">{t("ui.spreadNoSpans")}</p>
    {:else}
      <svg class="strip" viewBox="0 0 1000 {12 * (targets.length + 1) + 4}" preserveAspectRatio="none" role="img" aria-label={t("ui.spreadFind")}>
        <rect x="0" y="2" width="1000" height="10" class="lane" />
        {#each targets as id, k (id)}
          <rect x="0" y={14 + 12 * k} width="1000" height="10" class="lane" />
        {/each}
        {#each spans as s (s.id)}
          {@const k = targets.indexOf(s.targetId)}
          {@const x = spanX(s.from, end) * 1000}
          {@const w = Math.max(2, (spanX(s.to, end) - spanX(s.from, end)) * 1000)}
          <rect {x} y={14 + 12 * k} width={w} height="10" fill={color(s.targetId)} opacity={picked.includes(s.id) ? 0.95 : 0.25} />
          {#if picked.includes(s.id)}<rect {x} y="2" width={w} height="10" fill={color(source)} opacity="0.9" />{/if}
        {/each}
      </svg>
      <div class="row">
        <button class="small" disabled={picking || sourceChars <= limit} onclick={autoPick}>{picking ? t("ui.spreadPicking") : t("ui.spreadAuto")}</button>
        <button class="small" disabled={picked.length === 0} onclick={() => (picked = [])}>{t("ui.spreadClear")}</button>
      </div>
      <ul class="spans">
        {#each spans as s (s.id)}
          <li class:off={clash(s)}>
            <label>
              <input type="checkbox" checked={picked.includes(s.id)} disabled={clash(s)} onchange={(e) => toggle(s, e.currentTarget.checked)} />
              <span class="dot" style:background={color(s.targetId)}></span>
              {name(s.targetId)} · {s.bars[0] === s.bars[1] ? t("ui.spreadBar", { bar: s.bars[0] }) : t("ui.spreadBars", { from: s.bars[0], to: s.bars[1] })}
              <span class="muted">· {s.take === 0 ? t("ui.spreadGiveEmpty", { count: s.give }) : t("ui.spreadGiveSwap", { count: s.give, take: s.take })}</span>
            </label>
            <button class="small link" onclick={() => onseek(s.from)}>{t("ui.outputTempoGo")}</button>
          </li>
        {/each}
      </ul>
    {/if}
  </fieldset>

  {#if busy}
    <p class="muted">{t("ui.spreadCounting")}</p>
  {:else if result?.kept}
    <p class="warn">{t(result.kept === "sound" ? "ui.spreadKeptSound" : result.kept === "tempo" ? "ui.compactKeptTempo" : "ui.compactKept")}</p>
  {:else if result && result.moved > 0}
    <p>{t("ui.spreadSummary", { moved: result.moved })}</p>
    <table>
      <thead>
        <tr><th>{t("ui.previewTrack")}</th><th>{t("ui.previewBefore")}</th><th>{t("ui.previewAfter")}</th></tr>
      </thead>
      <tbody>
        {#each rows as r (r.trackId)}
          <tr>
            <td><span class="muted">{where(r.trackId)}</span> {r.name}</td>
            <td class="num" class:full={r.before > limit}>{r.before}</td>
            <td class="num" class:full={r.after > limit}>{r.after} <span class="muted">({r.after - r.before >= 0 ? "+" : ""}{r.after - r.before})</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  {#if !busy && stillOver > 0}
    <p class="warn">
      {t("ui.previewStillOver", { count: stillOver, limit })}
      <button class="small" onclick={onsplit}>{t("ui.split")}…</button>
    </p>
  {/if}

  <footer>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={busy || !result || result.moved === 0} onclick={apply}>{t("ui.apply")}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(600px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
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
    margin: 0 0 6px;
  }
  fieldset {
    border: 1px solid var(--line);
    border-radius: 6px;
    margin: 8px 0;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  select {
    max-width: 100%;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    vertical-align: middle;
  }
  .off {
    opacity: 0.5;
  }
  .strip {
    width: 100%;
    height: auto;
    max-height: 90px;
  }
  .lane {
    fill: var(--line);
    opacity: 0.4;
  }
  .spans {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 220px;
    overflow-y: auto;
  }
  .spans li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 2px 0;
    border-bottom: 1px solid var(--line);
  }
  .link {
    white-space: nowrap;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: left;
    padding: 3px 6px;
    border-bottom: 1px solid var(--line);
  }
  .num {
    text-align: right;
    white-space: nowrap;
  }
  th:not(:first-child) {
    text-align: right;
  }
  .full,
  .warn {
    color: var(--danger);
  }
  .small {
    font-size: 0.85em;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
