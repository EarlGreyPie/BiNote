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
    droppedBars,
    droppedListenStart,
    listenBarOf,
    MERGE_LEVEL_KEY,
    MERGE_LEVELS,
    MERGE_PARTIAL_KEY,
    mergeGroups,
    mergeListenSong,
    parseMergeLevel,
    parseMergePartial,
    type MergeListenMode,
    pitchLabel,
    songEnd,
    spanX,
    gameCharsOf,
    type MergeRole,
  } from "./chordTools";

  /**
   * 화음 병합 창 (곡 메뉴). 같은 악보·같은 악기 트랙 묶음에서 비울 트랙과 남길 트랙을 고르고,
   * 비울 트랙의 음을 남길 트랙이 쉬는 자리로 옮긴다. 자리가 없는 음은 단계(1·2·3)에 따라 그대로 두거나 뺀다.
   * 우선 트랙 음은 빼지 않는다. 뺄 음은 수와 자리(마디·박·높이)를 모두 보여 주고, 띠에 빨갛게 표시한다.
   * 들어 보기: 적용하기 전에 병합 전·병합 후·빠지는 음만을 들려준다 (곡은 바꾸지 않는다). 곡 전체를 커서부터 듣거나,
   * 빠지는 음이 있는 마디만 되풀이해 듣는다 (앱의 반복 구간·커서는 건드리지 않는다)
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
    /** 글자 수 맞추기 창의 한 칸으로 넣는다: 따로 창을 띄우지 않고, 적용해도 닫지 않는다 (취소 단추 없음) */
    embedded?: boolean;
    /** 편집 커서 ("빠지는 음만"을 어디서부터 들을지) */
    cursor?: Rat | undefined;
    /** 이 칸이 시작한 미리 듣기가 지금 소리 나는지 */
    listening?: boolean;
    /** 들을 곡을 넘긴다: range면 그 구간 되풀이, 아니면 from(없으면 커서)부터. keep이면 지금 들리던 자리에서 이어 간다 */
    onlisten?: ((song: Song, opts: { from?: Rat | undefined; range?: readonly [Rat, Rat] | undefined; keep?: boolean }) => Promise<boolean>) | undefined;
    onstoplisten?: (() => void) | undefined;
  }

  let { song, colors, profile, locked, activeTrackId, where, onseek, onapply, onclose, embedded = false, cursor, listening = false, onlisten, onstoplisten }: Props = $props();

  let dialog: HTMLElement;
  /** 창을 닫는다 (글자 수 맞추기 창 안이면 닫지 않는다: 곡이 바뀌면 그 창이 이 칸을 새로 만든다) */
  function finish() {
    if (!embedded) (dialog as HTMLDialogElement).close();
  }
  const limit = $derived(profile.charLimitPerScore);
  /** 트랙 글자 수는 게임 글자 수로 본다 (창 위 막대·화음 분산 칸과 같은 수). 원문 글자 수는 다시 쓰면 줄어드는 몫까지 들어 있다 */
  const chars = $derived(gameCharsOf(song, profile));
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
  /** 트랙은 남기고 옮길 수 있는 음만 몰기 (기본 꺼짐, 기억한다) */
  let partial = $state(loadStored(MERGE_PARTIAL_KEY, parseMergePartial));

  const options = $derived<MergeTracksOptions>({
    keep: ids.filter((id) => roles[id] === "keep"),
    remove: ids.filter((id) => roles[id] === "remove"),
    level,
    priority: priority || undefined,
    partial,
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
  const changed = $derived(!!result && !result.kept && (result.emptied.length > 0 || result.partial.length > 0));
  const rows = $derived(changed && result ? previewRows(song, result.song, limit, (s) => (s === song ? chars : gameCharsOf(s, profile))) : []);
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

  const LISTEN_MODES: readonly MergeListenMode[] = ["before", "after", "dropped"];
  const LISTEN_LABEL = { before: "ui.mergeListenBefore", after: "ui.mergeListenAfter", dropped: "ui.mergeListenDropped" } as const satisfies Record<MergeListenMode, string>;
  const barLabel = (i: number) => {
    const b = bars[i];
    return b ? (b.lastBar > b.bar ? `${b.bar}-${b.lastBar}` : String(b.bar)) : "";
  };

  function setPartial(on: boolean) {
    partial = on;
    saveStored(MERGE_PARTIAL_KEY, on ? "1" : "0");
  }

  /** 비울 트랙에서 옮긴 음 수 (partial 줄) */
  const movedFrom = (id: string) => result?.moves.filter((m) => m.from === id).length ?? 0;

  // ── 들어 보기 ──
  /** 이 트랙들만 (끄면 곡 전체를 지금 끄기·솔로 그대로) */
  let groupOnly = $state(true);
  /** 마지막에 고른 소리 */
  let mode = $state<MergeListenMode | undefined>(undefined);
  /** 마디로 듣는 중이면 그 구간 번호 (bars 안) */
  let barIndex = $state<number | undefined>(undefined);
  const canListen = $derived(!!onlisten && changed && !busy && dropped.length > 0);
  const bars = $derived(canListen ? droppedBars(song, dropped.map((d) => d.note)) : []);
  const silent = $derived(dropped.length > 0 && dropped.every((d) => d.note.vol <= 0));
  const barListening = $derived(listening && barIndex !== undefined);

  function target(m: MergeListenMode): Song | undefined {
    return result ? mergeListenSong(song, result, ids, m, groupOnly) : undefined;
  }
  /** 소리 단추: 듣는 중이면 지금 자리(마디로 듣는 중이면 그 마디)에서 그 소리로 이어 가고, 같은 단추면 멈춘다 */
  function listen(m: MergeListenMode) {
    if (!canListen || !onlisten) return;
    if (listening && mode === m) return onstoplisten?.();
    play(m);
  }
  function play(m: MergeListenMode) {
    if (!canListen || !onlisten) return;
    const next = target(m);
    if (!next) return;
    mode = m;
    if (listening && barIndex !== undefined) {
      const b = bars[barIndex];
      if (b) void onlisten(next, { range: [b.from, b.to], keep: true });
      return;
    }
    if (listening) return void onlisten(next, { keep: true });
    barIndex = undefined;
    void onlisten(next, m === "dropped" ? { from: droppedListenStart(song, dropped.map((d) => d.note), cursor) } : {});
  }
  /** 그 마디 구간을 되풀이한다 (소리는 마지막에 고른 것, 없으면 병합 전). 듣고 있는 마디를 다시 누르면 멈춘다 */
  function listenBar(i: number) {
    if (!canListen || !onlisten || i < 0 || i >= bars.length) return;
    if (barListening && barIndex === i) return onstoplisten?.();
    const b = bars[i]!;
    const m = mode ?? "before";
    const next = target(m);
    if (!next) return;
    mode = m;
    barIndex = i;
    void onlisten(next, { range: [b.from, b.to] });
  }
  function stepBar(delta: number) {
    if (bars.length === 0) return;
    const at = barListening && barIndex !== undefined ? barIndex + delta : delta > 0 ? 0 : bars.length - 1;
    listenBar(Math.min(bars.length - 1, Math.max(0, at)));
  }
  /** "이 트랙들만"을 바꾸면 듣던 자리에서 바뀐 범위로 이어 간다. 아직 소리를 준비 중인 미리 듣기는 옛 범위라 멈춘다 */
  function setGroupOnly(on: boolean) {
    groupOnly = on;
    if (listening && mode && mode !== "dropped") play(mode);
    else if (!listening) onstoplisten?.();
  }
  // 고르기(남기기·비우기·제외, 우선 트랙, 단계, 몰기, 묶음)를 바꾸거나 결과가 바뀌면 멈춘다. 옛 결과를 계속 들려주지 않는다
  // 소리를 준비 중이라 listening이 아직 false여도 그 요청을 끊어야 하므로 늘 부른다 (앱이 자기 미리 듣기일 때만 멈춘다)
  $effect(() => {
    void options;
    void result;
    untrack(() => {
      onstoplisten?.();
      barIndex = undefined;
    });
  });
  // 칸이 사라지면(칸 바꾸기·적용 뒤 새로 만들기·닫기) 멈춘다
  $effect(() => () => untrack(() => onstoplisten?.()));

  function setLevel(next: MergeLevel) {
    level = next;
    saveStored(MERGE_LEVEL_KEY, String(next));
  }

  function place(at: Rat): string {
    const b = barBeatAt(song.timeSig, at);
    return t("ui.checkPlace", { bar: b.bar, beat: b.beat });
  }

  $effect(() => {
    if (!embedded) (dialog as HTMLDialogElement).showModal();
  });

  function apply() {
    if (!changed || busy) return;
    onapply(mergeTracksSong(profile, options, locked, t("ui.merge")));
    finish();
  }
</script>

<svelte:element this={embedded ? "div" : "dialog"} bind:this={dialog} class:embedded {...embedded ? {} : { onclose }}>
  {#if !embedded}<h2>{t("ui.merge")}</h2>{/if}
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
              <span class="muted">· {t("ui.mergeNotes", { count: song.tracks.find((tr) => tr.id === id)?.notes.length ?? 0 })} · {t("ui.spreadChars", { count: chars(id) })}</span>
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
    <label class="partial">
      <input type="checkbox" checked={partial} onchange={(e) => setPartial(e.currentTarget.checked)} />
      {t("ui.mergePartial")}
      <span class="muted small">{t("ui.mergePartialHelp")}</span>
    </label>

    {#if !ready}
      <p class="muted">{t("ui.mergePickBoth")}</p>
    {:else if busy}
      <p class="muted">{t("ui.spreadCounting")}</p>
    {:else if result?.kept}
      <p class="warn">{t(result.kept === "sound" ? "ui.spreadKeptSound" : result.kept === "tempo" ? "ui.compactKeptTempo" : "ui.compactKept")}</p>
    {:else if result}
      {#each result.stuck as s (s.trackId)}
        {#if result.partial.includes(s.trackId)}
          <p>{t("ui.mergePartialLeft", { name: name(s.trackId), moved: movedFrom(s.trackId), count: s.left })}</p>
        {:else}
          <p class="warn">{t(level === 1 ? "ui.mergeStuck1" : "ui.mergeStuck", { name: name(s.trackId), count: s.left })}</p>
        {/if}
      {/each}
      {#if changed}
        <p>
          {#if result.emptied.length > 0}{t("ui.mergeSummary", { moved: result.moved, removed: result.emptied.length })}{/if}
          {#if dropped.length > 0}
            <strong class="warn">{t("ui.mergeDropped", { count: dropped.length })}</strong>
          {:else}
            <span class="muted">{t("ui.mergeNoDrop")}</span>
          {/if}
        </p>
        {#if canListen}
          <div class="listen" role="group" aria-label={t("ui.mergeListen")}>
            <div class="row">
              <strong>{t("ui.mergeListen")}</strong>
              {#each LISTEN_MODES as m (m)}
                {@const on = listening && mode === m}
                <button class="small" class:on aria-pressed={on} onclick={() => listen(m)}>{on ? `■ ${t("ui.mergeListenStop")}` : `▶ ${t(LISTEN_LABEL[m])}`}</button>
              {/each}
              <label class="small"><input type="checkbox" checked={groupOnly} onchange={(e) => setGroupOnly(e.currentTarget.checked)} /> {t("ui.mergeListenGroup")}</label>
            </div>
            <div class="row small">
              <button class="small" onclick={() => stepBar(-1)} title={t("ui.mergeListenPrev")} aria-label={t("ui.mergeListenPrev")}>◀</button>
              <button class="small" onclick={() => stepBar(1)} title={t("ui.mergeListenNext")} aria-label={t("ui.mergeListenNext")}>▶</button>
              {#if barListening && barIndex !== undefined}
                <span>{t("ui.mergeListenBar", { bar: barLabel(barIndex), n: barIndex + 1, count: bars.length })}</span>
              {:else}
                <span class="muted">{t("ui.mergeListenBars", { count: bars.length })}</span>
              {/if}
            </div>
            <p class="muted small">{t("ui.mergeListenHelp")}</p>
            {#if silent}<p class="muted small">{t("ui.mergeListenSilent")}</p>{/if}
          </div>
        {/if}
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
              {@const at = canListen ? listenBarOf(bars, song, d.note) : -1}
              {@const here = barListening && at >= 0 && at === barIndex}
              <li class:here>
                {#if at >= 0}
                  <button class="small play" aria-pressed={here} title={t("ui.mergeListenThisBar")} aria-label={t("ui.mergeListenThisBar")} onclick={() => listenBar(at)}>{here ? "■" : "▶"}</button>
                {/if}
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
    {#if !embedded}<button onclick={() => (dialog as HTMLDialogElement).close()}>{t("ui.cancel")}</button>{/if}
    <button class="primary" disabled={busy || !changed} onclick={apply}>
      {dropped.length > 0 ? t("ui.mergeApplyDrop", { count: dropped.length }) : t("ui.apply")}
    </button>
  </footer>
</svelte:element>

<style>
  .embedded {
    display: block;
  }
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
  .gone-list li.here {
    background: color-mix(in srgb, var(--accent, #4a90e2) 18%, transparent);
  }
  .play {
    min-width: 2em;
  }
  .partial {
    display: block;
    margin: 4px 0 8px;
  }
  .listen {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 10px;
    margin: 6px 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .listen p {
    margin: 0;
  }
  .listen button.on {
    font-weight: bold;
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
