<script lang="ts">
  import { CHORD_KIND_IDS, cmp, planArpeggio, toFloat, type ArpResult, type ArpSource, type GameProfile, type Note, type PitchRange, type Rat, type Song } from "@mmlce/core";
  import { setNotesAndAddTracks } from "@mmlce/mml";
  import { t } from "./i18n.svelte";
  import { lengthLabel } from "./Toolbar.svelte";
  import { lengthsFor, noteLengthOf } from "./roll";
  import { withLengths } from "./tuplet";
  import { ARP_KEY, ARP_LENGTHS, parseArpChoice, storeArpChoice, type ArpChoice, type ArpMade } from "./arpeggioOptions";
  import { loadStored, parseJson, saveStored } from "./persist";
  import { labs } from "./labs.svelte";

  /**
   * 아르페지오 창 (편집 메뉴): 고른 음(같은 악보, 타브는 여러 트랙)의 화음을 순서대로 펼쳐 한 트랙에 넣거나, 원래 음을 둔 채 굴려 치거나,
   * 같은 악보 트랙을 돌아가며 되풀이한다. 같은 시간 음은 화음에 넣을 트랙을 체크로 고른다.
   * 고르기를 바꿀 때마다 결과를 다시 계산해 미리 보여 주고, 적용하면 그 결과를 명령 하나로 넣는다
   */
  interface Props {
    song: Song;
    /** 고른 트랙: 펼치기 결과를 넣는 트랙 */
    trackId: string;
    /** 고른 음 (같은 악보의 여러 트랙 음이어도 된다) */
    picked: readonly Note[];
    division: number;
    /** 게임이 받는 음 길이 범위 (GameProfile.length) */
    lengthRange: GameProfile["length"];
    /** 정해 둔 잇단음 길이 ("20"). 게임이 받으면 길이 목록 제자리에 끼운다 */
    tupletLength?: string | undefined;
    /** 고른 트랙 악기가 소리 내는 음역 */
    range: PitchRange;
    /** 한 악보 트랙 한도 (maxChordsOf) */
    maxTracks: number;
    locked: ReadonlySet<string>;
    /** 곡의 트랙 색 (트랙 바와 같은 색: 색 방식·테마). 미리 보기는 넣은 뒤 곡으로 불러 새 트랙 색도 맞춘다 */
    colorsFor: (song: Song) => ReadonlyMap<string, string>;
    /** 다시 고치기: 만들 때 고른 것 (없으면 이 브라우저에 기억해 둔 값) */
    initial?: ArpMade | undefined;
    /** 창 제목 (다시 고치기) */
    title?: string | undefined;
    /** 다시 고치기: 창을 닫고 원래 음으로 되돌린다 (있으면 "원래대로" 버튼) */
    onrestore?: (() => void) | undefined;
    /** 적용: 결과와 만든 기록에 남길 고른 것 */
    onapply: (result: ArpResult, made: ArpMade) => void;
    onclose: () => void;
  }

  let { song, trackId, picked, division, lengthRange, tupletLength, range, maxTracks, locked, colorsFor, initial, title, onrestore, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  const stored = initial?.choice ?? loadStored(ARP_KEY, (raw) => parseArpChoice(parseJson(raw)));
  let choice = $state<ArpChoice>(stored);
  function set(change: Partial<ArpChoice>) {
    choice = { ...choice, ...change };
    saveStored(ARP_KEY, storeArpChoice(choice));
  }
  $effect(() => {
    dialog.showModal();
  });

  /** 게임이 받는 길이만 (점음표·셋잇단 포함, 길이 순, 격자는 그대로). 정해 둔 잇단음과 지난번에 쓴 잇단음도 끼운다 */
  const lengths = $derived(withLengths(lengthsFor(lengthRange, ARP_LENGTHS), [...(tupletLength ? [tupletLength] : []), choice.length], lengthRange, true));
  /** 기억해 둔 길이가 게임 한도 밖이면 격자 */
  const length = $derived(lengths.includes(choice.length) ? choice.length : "grid");

  /** 실제로 쓰는 화음 음 가져오기: 굴려 치기는 원래 음을 늦추기만 해서 코드 이름이면 같은 시간 음 */
  const src = $derived<ArpSource>(choice.style === "roll" && choice.source === "chord" ? "together" : choice.source);
  /** 같은 악보 트랙 (미리 보기 줄 순서와 같다) */
  const sameTracks = $derived.by(() => {
    const player = song.tracks.find((tr) => tr.id === trackId)?.playerId;
    return song.tracks.filter((tr) => tr.playerId === player);
  });
  /** 화음에서 뺀 트랙 (창을 열 때마다 비운다: 기본은 모두 넣기). 고른 트랙은 뺄 수 없다 */
  // svelte-ignore state_referenced_locally
  let excluded = $state<ReadonlySet<string>>(new Set(initial?.excluded ?? []));
  function toggleTrack(id: string, on: boolean) {
    const next = new Set(excluded);
    if (on) next.delete(id);
    else next.add(id);
    excluded = next;
  }
  /** 트랙 접기 (실험실, 굴려 치기): 고를 수 있는 남길 트랙 수 (2 ~ 악보 트랙 수 − 1) */
  const foldCounts = $derived(Array.from({ length: Math.max(0, Math.min(5, sameTracks.length - 1) - 1) }, (_, i) => i + 2));
  const fold = $derived(labs.on && choice.style === "roll" && foldCounts.includes(choice.fold) ? choice.fold : 0);
  const chordTracks = $derived(new Set(sameTracks.map((tr) => tr.id).filter((id) => id === trackId || !excluded.has(id))));

  const result = $derived.by(() => {
    const used = new Set(song.tracks.flatMap((tr) => tr.notes.map((n) => n.id)));
    let k = 0;
    const newId = () => {
      let id: string;
      do id = `${trackId}.arp${++k}`;
      while (used.has(id));
      used.add(id);
      return id;
    };
    return planArpeggio(
      song,
      trackId,
      picked,
      {
        source: src,
        chord: choice.chord,
        style: choice.style,
        order: choice.order,
        step: noteLengthOf(length, division),
        octaves: choice.octaves,
        repeat: choice.repeat,
        clearChordTracks: choice.clear,
        range,
        maxTracks,
        locked,
        ...(src === "together" ? { tracks: chordTracks } : {}),
        ...(fold > 0 ? { fold } : {}),
      },
      newId,
    );
  });

  /** 넣은 뒤 같은 악보 트랙 (새 트랙 포함, 트랙 바 순서)과 그 색 */
  const after = $derived.by(() => {
    const player = song.tracks.find((tr) => tr.id === trackId)?.playerId;
    const next = player === undefined ? song : setNotesAndAddTracks(player, result.changes, result.newTracks, (n) => String(n), "").apply(song);
    return { tracks: next.tracks.filter((tr) => tr.playerId === player), colors: colorsFor(next) };
  });
  const colorOf = (id: string) => after.colors.get(id) ?? song.tracks.find((tr) => tr.id === id)?.color ?? "var(--muted)";

  // 미리 보기: 고른 음 구간의 결과 음을 작은 롤로 (트랙마다 트랙 바와 같은 색)
  const W = 400;
  const H = 120;
  const preview = $derived.by(() => {
    const from = picked.reduce<Rat>((m, n) => (cmp(n.start, m) < 0 ? n.start : m), picked[0]!.start);
    // 보이는 구간: 고른 음과, 고른 음 자리에서 시작한 결과 음이 끝나는 곳까지 (고른 음보다 긴 화음 음도 보이게)
    const head = Math.max(...picked.map((n) => toFloat(n.start) + toFloat(n.dur)));
    // 넣은 뒤 같은 악보 트랙 (바뀐 트랙은 결과로, 새 트랙 포함). 굴려 치기에서 그대로 둔 음도 보인다
    const lanes = after.tracks.map((tr) => tr.notes);
    const to = Math.max(head, ...lanes.flat().filter((n) => toFloat(n.start) >= toFloat(from) && toFloat(n.start) < head).map((n) => toFloat(n.start) + toFloat(n.dur)));
    const notes = lanes.flatMap((list, lane) =>
      list.filter((n) => toFloat(n.start) < to && toFloat(n.start) + toFloat(n.dur) > toFloat(from)).map((n) => ({ n, lane })),
    );
    if (notes.length === 0) return undefined;
    const lo = Math.min(...notes.map((x) => x.n.pitch)) - 1;
    const hi = Math.max(...notes.map((x) => x.n.pitch)) + 1;
    const x = (at: number) => ((at - toFloat(from)) / Math.max(1e-9, to - toFloat(from))) * W;
    const row = H / (hi - lo + 1);
    return notes.map(({ n, lane }) => ({
      x: x(toFloat(n.start)),
      w: Math.max(1, x(Math.min(to, toFloat(n.start) + toFloat(n.dur))) - x(toFloat(n.start)) - 1),
      y: (hi - n.pitch) * row,
      h: Math.max(2, row - 1),
      color: colorOf(after.tracks[lane]!.id),
    }));
  });

  const ok = $derived(result.notes > 0);
  function apply() {
    if (!ok) return;
    // 격자 길이는 지금 격자 이름으로 남긴다 (다시 고칠 때 격자를 바꿨어도 같은 길이)
    const used = length === "grid" && lengths.includes(String(division) as ArpChoice["length"]) ? (String(division) as ArpChoice["length"]) : length;
    onapply(result, { choice: { ...choice, length: used }, excluded: [...excluded] });
    dialog.close();
  }

  const CHORD_LABEL = (id: string) => (id === "major" ? t("ui.arpChordMajor") : id === "minor" ? t("ui.arpChordMinor") : id);
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{title ?? t("ui.arpeggio")}</h2>
  <div class="grid">
    <span>{t("ui.arpSource")}</span>
    <span class="row">
      {#each [["together", "ui.arpSourceTogether"], ["selected", "ui.arpSourceSelected"], ["chord", "ui.arpSourceChord"]] as const as [id, key] (id)}
        <label>
          <input type="radio" name="arp-source" checked={choice.source === id} onchange={() => set({ source: id })} />
          {t(key)}
        </label>
      {/each}
      {#if src === "chord"}
        <select aria-label={t("ui.arpChord")} value={choice.chord} onchange={(e) => set({ chord: e.currentTarget.value as ArpChoice["chord"] })}>
          {#each CHORD_KIND_IDS as id (id)}<option value={id}>{CHORD_LABEL(id)}</option>{/each}
        </select>
      {/if}
    </span>
    {#if choice.style === "roll" && choice.source === "chord"}
      <span></span>
      <span class="muted help">{t("ui.arpRollTogether")}</span>
    {/if}
    <span>{t("ui.arpStyle")}</span>
    <span class="row">
      {#each [["spread", "ui.arpStyleSpread", "ui.arpStyleSpreadHelp"], ["roll", "ui.arpStyleRoll", "ui.arpStyleRollHelp"], ["strum", "ui.arpStyleStrum", "ui.arpStyleStrumHelp"]] as const as [id, key, help] (id)}
        <label title={t(help)}><input type="radio" name="arp-style" checked={choice.style === id} onchange={() => set({ style: id })} /> {t(key)}</label>
      {/each}
    </span>
    <span></span>
    <span class="muted help">{t(choice.style === "roll" ? "ui.arpStyleRollHelp" : choice.style === "strum" ? "ui.arpStyleStrumHelp" : "ui.arpStyleSpreadHelp")}</span>
    <span>{t("ui.arpOrder")}</span>
    <select value={choice.order} onchange={(e) => set({ order: e.currentTarget.value as ArpChoice["order"] })}>
      <option value="up">{t("ui.arpOrderUp")}</option>
      <option value="down">{t("ui.arpOrderDown")}</option>
      <option value="updown">{t("ui.arpOrderUpDown")}</option>
      <option value="random">{t("ui.arpOrderRandom")}</option>
    </select>
    <span>{t("ui.arpLength")}</span>
    <select value={length} onchange={(e) => set({ length: e.currentTarget.value as ArpChoice["length"] })}>
      {#each lengths as l (l)}<option value={l}>{lengthLabel(l)}</option>{/each}
    </select>
    {#if choice.style !== "roll"}
      <span>{t("ui.arpOctaves")}</span>
      <select value={choice.octaves} onchange={(e) => set({ octaves: Number(e.currentTarget.value) as ArpChoice["octaves"] })}>
        {#each [1, 2, 3] as o (o)}<option value={o}>{o}</option>{/each}
      </select>
    {/if}
  </div>
  <div class="row">
    {#if choice.style !== "roll"}
      <label><input type="checkbox" checked={choice.repeat} onchange={(e) => set({ repeat: e.currentTarget.checked })} /> {t("ui.arpRepeat")}</label>
    {/if}
    {#if choice.style === "spread"}
      <label>
        <input type="checkbox" checked={choice.clear} onchange={(e) => set({ clear: e.currentTarget.checked })} />
        {t("ui.arpClear")}
      </label>
    {/if}
  </div>
  {#if labs.on && choice.style === "roll" && foldCounts.length > 0}
    <div class="row" title={t("ui.arpFoldHelp")}>
      <span>{t("ui.arpFold")}</span>
      <select aria-label={t("ui.arpFold")} value={fold} onchange={(e) => set({ fold: Number(e.currentTarget.value) })}>
        <option value={0}>{t("ui.arpFoldOff")}</option>
        {#each foldCounts as c (c)}<option value={c}>{t("ui.arpFoldTo", { n: c })}</option>{/each}
      </select>
    </div>
    {#if fold > 0}<p class="muted help">{t("ui.arpFoldHelp")}</p>{/if}
  {/if}
  {#if src === "together"}
    <div class="row tracks" role="group" aria-label={t("ui.arpTracks")}>
      <span>{t("ui.arpTracks")}</span>
      {#each sameTracks as tr (tr.id)}
        <label>
          <input type="checkbox" checked={chordTracks.has(tr.id)} disabled={tr.id === trackId} onchange={(e) => toggleTrack(tr.id, e.currentTarget.checked)} />
          <span class="dot" style:background={colorOf(tr.id)}></span>{tr.name}
        </label>
      {/each}
    </div>
  {/if}
  <svg class="preview" viewBox="0 0 {W} {H}" role="img" aria-label={t("ui.arpPreview")}>
    {#if preview}
      {#each preview as r, i (i)}<rect x={r.x} y={r.y} width={r.w} height={r.h} rx="1.5" style:fill={r.color} />{/each}
    {/if}
  </svg>
  <p class="muted">{t("ui.arpSummary", { notes: result.notes, tracks: result.newTracks.length, dropped: result.outOfRange })}</p>
  {#if result.single > 0}<p class="muted">{t("ui.arpSingle", { n: result.single })}</p>{/if}
  {#if result.lockedSkipped > 0}<p class="warn">{t("ui.arpLocked", { n: result.lockedSkipped })}</p>{/if}
  {#if result.trackLimit !== undefined}<p class="warn">{t("ui.arpTrackLimit", { n: result.trackLimit })}</p>{/if}
  {#if result.folded}<p class="muted">{t("ui.arpFolded", { n: result.folded })}</p>{/if}
  {#if result.foldSkipped}<p class="warn">{t("ui.arpFoldSkipped", { n: result.foldSkipped })}</p>{/if}
  {#if result.emptied}<p class="muted">{t("ui.arpFoldEmptied", { names: result.emptied.map((id) => song.tracks.find((tr) => tr.id === id)?.name ?? id).join(", ") })}</p>{/if}
  {#if result.tooShort}<p class="warn">{t("ui.arpTooShort", { n: result.tooShort })}</p>{/if}
  {#if result.sequential}<p class="warn">{t("ui.arpSequential", { n: result.sequential })}</p>{/if}
  {#if result.cutCells && choice.style === "spread"}<p class="warn">{t("ui.arpSpreadBlocked", { n: result.cutCells })}</p>
  {:else if result.cutCells && result.cutCells > (result.sequential ?? 0)}<p class="warn">{t("ui.arpCutCells", { n: result.cutCells - (result.sequential ?? 0) })}</p>{/if}
  {#if !ok && !result.cutCells}<p class="warn">{t("ui.arpNothing")}</p><p class="hint">{t("ui.arpNothingAdopt")}</p>{/if}
  <footer>
    <span class="spacer"></span>
    {#if onrestore}
      <button
        title={t("ui.madeRestoreHelp")}
        onclick={() => {
          onrestore?.();
          dialog.close();
        }}>{t("ui.madeRestoreButton")}</button
      >
    {/if}
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={!ok} onclick={apply}>{t("ui.apply")}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(520px, calc(100vw - 32px));
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
  .grid {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 6px 12px;
  }
  .grid > select {
    justify-self: start;
  }
  .row,
  footer {
    display: flex;
    align-items: center;
    gap: 6px 12px;
    flex-wrap: wrap;
    margin: 8px 0;
  }
  .preview {
    display: block;
    width: 100%;
    height: 120px;
    background: var(--bg, transparent);
    border: 1px solid var(--line);
    border-radius: 4px;
  }
  .help {
    font-size: 0.85rem;
    margin: 0;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 4px;
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
</style>
