<script lang="ts">
  import { barBeatAt, cmp, type Command, type GameProfile, type Rat, type Song } from "@mmlce/core";
  import { mergeTracksResult, mergeTracksSong, type MergeLevel, type MergeTracksOptions, type MergeTracksResult } from "@mmlce/mml";
  import { untrack } from "svelte";
  import { t } from "./i18n.svelte";
  import { previewRows } from "./output";
  import { loadStored, saveStored } from "./persist";
  import {
    defaultMergeRoles,
    defaultPriority,
    MERGE_LEVEL_KEY,
    MERGE_LEVELS,
    mergeGroups,
    parseMergeLevel,
    pitchLabel,
    songEnd,
    spanX,
    trackChars,
    type MergeRole,
  } from "./chordTools";

  /**
   * 화음 병합 창 (곡 메뉴). 같은 악보·같은 악기 트랙 묶음에서 비울 트랙과 남길 트랙을 고르고,
   * 비울 트랙의 음을 남길 트랙이 쉬는 자리로 옮긴다. 자리가 없는 음은 단계(1·2·3)에 따라 그대로 두거나 뺀다.
   * 우선 트랙 음은 빼지 않는다. 뺄 음은 수와 자리(마디·박·높이)를 모두 보여 주고, 띠에 빨갛게 표시한다
   */
  interface Props {
    /** 화면 트랙 색 (트랙 목록·롤과 같은 색). 없는 트랙은 저장된 색 */
    colors?: ReadonlyMap<string, string>;
    song: Song;
    profile: GameProfile;
    locked: ReadonlySet<string>;
    /** 처음 고를 묶음에 든 트랙 (지금 트랙) */
    activeTrackId?: string | undefined;
    where: (trackId: string) => string;
    onseek: (at: Rat) => void;
    onapply: (command: Command) => void;
    onclose: () => void;
  }

  let { song, colors, profile, locked, activeTrackId, where, onseek, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  const limit = $derived(profile.charLimitPerScore);
  // 창은 열 때마다 새로 만들고, 열 때의 곡으로 묶음을 정한다 (적용하면 닫힌다)
  // svelte-ignore state_referenced_locally
  const groups = mergeGroups(song, profile, locked);
  // svelte-ignore state_referenced_locally
  let groupIndex = $state(Math.max(0, groups.findIndex((g) => !!activeTrackId && g.includes(activeTrackId))));
  const ids = $derived(groups[groupIndex] ?? []);
  let roles = $state<Record<string, MergeRole>>({});
  let priority = $state<string>("");
  $effect(() => {
    const now = ids;
    untrack(() => {
      roles = defaultMergeRoles(song, now);
      priority = defaultPriority(song, now) ?? "";
    });
  });
  let level = $state<MergeLevel>(loadStored(MERGE_LEVEL_KEY, parseMergeLevel));

  const options = $derived<MergeTracksOptions>({
    keep: ids.filter((id) => roles[id] === "keep"),
    remove: ids.filter((id) => roles[id] === "remove"),
    level,
    priority: priority || undefined,
  });
  const ready = $derived(options.keep.length > 0 && options.remove.length > 0);

  /** 계산 결과 (고르기를 바꾸면 잠깐 뒤에 다시 센다) */
  let result = $state.raw<MergeTracksResult | undefined>(undefined);
  let busy = $state(false);
  $effect(() => {
    const opts = options;
    const base = song;
    if (!ready) {
      result = undefined;
      busy = false;
      return;
    }
    busy = true;
    const timer = setTimeout(() => {
      result = mergeTracksResult(base, profile, opts, locked);
      busy = false;
    }, 120);
    return () => clearTimeout(timer);
  });
  const changed = $derived(!!result && result.emptied.length > 0 && !result.kept);
  const rows = $derived(changed && result ? previewRows(song, result.song, limit) : []);
  /** 뺀 음 (시간 순) */
  const dropped = $derived(changed && result ? [...result.dropped].sort((a, b) => cmp(a.note.start, b.note.start)) : []);
  const droppedBy = $derived(
    ids.map((id) => ({ id, count: dropped.filter((d) => d.trackId === id).length })).filter((x) => x.count > 0),
  );

  const name = (id: string) => song.tracks.find((tr) => tr.id === id)?.name ?? "";
  const color = (id: string) => colors?.get(id) ?? song.tracks.find((tr) => tr.id === id)?.color ?? "var(--muted)";
  const end = $derived(songEnd(song));
  /** 띠: 남는 트랙마다 한 줄 (원래 음은 흐리게, 다른 트랙에서 온 음은 그 트랙 색), 맨 아래 줄은 뺀 음 */
  const lanes = $derived.by(() => {
    if (!changed || !result) return [];
    const gone = new Set(result.dropped.map((d) => d.note));
    return options.keep.map((id) => {
      const own = (song.tracks.find((x) => x.id === id)?.notes ?? []).filter((n) => !gone.has(n)).map((n) => ({ x: spanX(n.start, end), w: spanX(n.dur, end), by: "" }));
      const came = result!.moves.filter((m) => m.to === id).map((m) => ({ x: spanX(m.note.start, end), w: spanX(m.note.dur, end), by: m.from }));
      return { id, notes: [...own, ...came] };
    });
  });

  function setLevel(next: MergeLevel) {
    level = next;
    saveStored(MERGE_LEVEL_KEY, String(next));
  }

  function place(at: Rat): string {
    const b = barBeatAt(song.timeSig, at);
    return t("ui.checkPlace", { bar: b.bar, beat: b.beat });
  }

  $effect(() => {
    dialog.showModal();
  });

  function apply() {
    if (!changed || busy) return;
    onapply(mergeTracksSong(profile, options, locked, t("ui.merge")));
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.merge")}</h2>
  <p class="muted">{t("ui.mergeIntro")}</p>

  {#if groups.length === 0}
    <p class="warn">{t("ui.mergeNoGroups")}</p>
  {:else}
    {#if groups.length > 1}
      <label class="row">
        {t("ui.mergeGroup")}
        <select bind:value={groupIndex}>
          {#each groups as g, i (g.join())}
            <option value={i}>{where(g[0]!)} · {g.map(name).join(", ")}</option>
          {/each}
        </select>
      </label>
    {/if}

    <table class="roles">
      <thead>
        <tr><th>{t("ui.previewTrack")}</th><th>{t("ui.mergeKeep")}</th><th>{t("ui.mergeRemove")}</th><th>{t("ui.mergeSkip")}</th><th>{t("ui.mergePriority")}</th></tr>
      </thead>
      <tbody>
        {#each ids as id (id)}
          <tr>
            <td>
              <span class="dot" style:background={color(id)}></span>
              {name(id)}
              <span class="muted">· {t("ui.mergeNotes", { count: song.tracks.find((tr) => tr.id === id)?.notes.length ?? 0 })} · {t("ui.spreadChars", { count: trackChars(song, id) })}</span>
            </td>
            <td><input type="radio" name="role-{id}" value="keep" bind:group={roles[id]} aria-label={t("ui.mergeKeep")} /></td>
            <td><input type="radio" name="role-{id}" value="remove" bind:group={roles[id]} aria-label={t("ui.mergeRemove")} /></td>
            <td><input type="radio" name="role-{id}" value="skip" bind:group={roles[id]} aria-label={t("ui.mergeSkip")} /></td>
            <td><input type="radio" name="priority" value={id} bind:group={priority} disabled={roles[id] === "skip"} aria-label={t("ui.mergePriority")} /></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <div class="row">
      <label><input type="radio" name="priority" value="" bind:group={priority} /> {t("ui.mergeNoPriority")}</label>
      <span class="muted small">{t("ui.mergePriorityHelp")}</span>
    </div>

    <fieldset>
      <legend>{t("ui.mergeLevel")}</legend>
      {#each MERGE_LEVELS as l (l)}
        <label>
          <input type="radio" name="level" value={l} checked={level === l} onchange={() => setLevel(l)} />
          <strong>{t("ui.mergeLevelN", { n: l })}</strong>
          <span class="muted">{t(l === 1 ? "ui.mergeLevel1" : l === 2 ? "ui.mergeLevel2" : "ui.mergeLevel3")}</span>
        </label>
      {/each}
    </fieldset>

    {#if !ready}
      <p class="muted">{t("ui.mergePickBoth")}</p>
    {:else if busy}
      <p class="muted">{t("ui.spreadCounting")}</p>
    {:else if result?.kept}
      <p class="warn">{t(result.kept === "sound" ? "ui.spreadKeptSound" : result.kept === "tempo" ? "ui.compactKeptTempo" : "ui.compactKept")}</p>
    {:else if result}
      {#each result.stuck as s (s.trackId)}
        <p class="warn">{t(level === 1 ? "ui.mergeStuck1" : "ui.mergeStuck", { name: name(s.trackId), count: s.left })}</p>
      {/each}
      {#if changed}
        <p>
          {t("ui.mergeSummary", { moved: result.moved, removed: result.emptied.length })}
          {#if dropped.length > 0}
            <strong class="warn">{t("ui.mergeDropped", { count: dropped.length })}</strong>
          {:else}
            <span class="muted">{t("ui.mergeNoDrop")}</span>
          {/if}
        </p>
        <svg class="strip" viewBox="0 0 1000 {12 * (lanes.length + (dropped.length > 0 ? 1 : 0)) + 2}" preserveAspectRatio="none" role="img" aria-label={t("ui.mergePreview")}>
          {#each lanes as lane, k (lane.id)}
            <rect x="0" y={2 + 12 * k} width="1000" height="10" class="lane" />
            {#each lane.notes as n, i (i)}
              <rect x={n.x * 1000} y={2 + 12 * k} width={Math.max(1, n.w * 1000)} height="10" fill={n.by ? color(n.by) : "var(--muted)"} opacity={n.by ? 0.95 : 0.35} />
            {/each}
          {/each}
          {#if dropped.length > 0}
            {#each dropped as d, i (i)}
              <rect x={spanX(d.note.start, end) * 1000} y={2 + 12 * lanes.length} width={Math.max(2, spanX(d.note.dur, end) * 1000)} height="10" class="gone" />
            {/each}
          {/if}
        </svg>
        {#if dropped.length > 0}
          <p class="muted small">
            {droppedBy.map((x) => t("ui.mergeDroppedFrom", { name: name(x.id), count: x.count })).join(" · ")}
          </p>
          {#if (result.louder?.length ?? 0) > 0}
            <p class="muted small">{t("ui.mergeLouder", { count: result.louder!.length })}</p>
          {/if}
          <ul class="gone-list">
            {#each dropped as d, i (i)}
              <li>
                <button class="small link" onclick={() => onseek(d.note.start)}>{place(d.note.start)}</button>
                <span class="dot" style:background={color(d.trackId)}></span>
                {name(d.trackId)} · {pitchLabel(d.note.pitch)} <span class="muted">v{d.note.vol}</span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if rows.length > 0}
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
      {/if}
    {/if}
  {/if}

  <footer>
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={busy || !changed} onclick={apply}>
      {dropped.length > 0 ? t("ui.mergeApplyDrop", { count: dropped.length }) : t("ui.apply")}
    </button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(620px, calc(100vw - 32px));
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
  .roles td:not(:first-child),
  .roles th:not(:first-child) {
    text-align: center;
  }
  .strip {
    width: 100%;
    height: auto;
    max-height: 100px;
    margin: 4px 0;
  }
  .lane {
    fill: var(--line);
    opacity: 0.4;
  }
  .gone {
    fill: var(--danger);
  }
  .gone-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 160px;
    overflow-y: auto;
    font-variant-numeric: tabular-nums;
  }
  .gone-list li {
    padding: 1px 0;
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
