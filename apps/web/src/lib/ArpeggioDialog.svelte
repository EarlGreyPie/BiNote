<script lang="ts">
  import { CHORD_KIND_IDS, cmp, planArpeggio, toFloat, type ArpResult, type ArpSource, type GameProfile, type Note, type PitchRange, type Rat, type Song } from "@mmlce/core";
  import { untrack } from "svelte";
  import { t } from "./i18n.svelte";
  import { lengthLabel } from "./Toolbar.svelte";
  import { lengthsFor, noteLengthOf } from "./roll";
  import { ARP_KEY, ARP_LENGTHS, parseArpChoice, storeArpChoice, type ArpChoice } from "./arpeggioOptions";
  import { loadStored, parseJson, saveStored } from "./persist";

  /**
   * 아르페지오 창 (편집 메뉴): 고른 음(한 트랙)의 화음을 순서대로 펼쳐 한 트랙에 넣거나, 원래 음을 둔 채 굴려 치거나,
   * 같은 악보 트랙을 돌아가며 되풀이한다. 같은 시간 음은 화음에 넣을 트랙을 체크로 고른다.
   * 고르기를 바꿀 때마다 결과를 다시 계산해 미리 보여 주고, 적용하면 그 결과를 명령 하나로 넣는다
   */
  interface Props {
    song: Song;
    trackId: string;
    picked: readonly Note[];
    division: number;
    /** 게임이 받는 음 길이 범위 (GameProfile.length) */
    lengthRange: GameProfile["length"];
    /** 고른 트랙 악기가 소리 내는 음역 */
    range: PitchRange;
    /** 한 악보 트랙 한도 (maxChordsOf) */
    maxTracks: number;
    locked: ReadonlySet<string>;
    /** 처음 고를 화음 음 가져오기 (타브 커서 자리 화음은 같은 시간 음). 없으면 지난번 값 */
    source?: ArpSource | undefined;
    onapply: (result: ArpResult) => void;
    onclose: () => void;
  }

  let { song, trackId, picked, division, lengthRange, range, maxTracks, locked, source, onapply, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  const stored = loadStored(ARP_KEY, (raw) => parseArpChoice(parseJson(raw)));
  // 처음 고를 값만 쓴다 (창은 열 때마다 새로 만든다)
  const first = untrack(() => source);
  let choice = $state<ArpChoice>(first ? { ...stored, source: first } : stored);
  function set(change: Partial<ArpChoice>) {
    choice = { ...choice, ...change };
    saveStored(ARP_KEY, storeArpChoice(choice));
  }
  $effect(() => {
    dialog.showModal();
  });

  /** 게임이 받는 길이만 (점음표·셋잇단 포함, 길이 순, 격자는 그대로) */
  const lengths = $derived(lengthsFor(lengthRange, ARP_LENGTHS));
  /** 기억해 둔 길이가 게임 한도 밖이면 격자 */
  const length = $derived(lengths.includes(choice.length) ? choice.length : "grid");

  /** 실제로 쓰는 화음 음 가져오기: 굴려 치기는 늘 같은 시간 음 */
  const src = $derived<ArpSource>(choice.style === "roll" ? "together" : choice.source);
  /** 같은 악보 트랙 (미리 보기 줄 순서와 같다) */
  const sameTracks = $derived.by(() => {
    const player = song.tracks.find((tr) => tr.id === trackId)?.playerId;
    return song.tracks.filter((tr) => tr.playerId === player);
  });
  /** 화음에서 뺀 트랙 (창을 열 때마다 비운다: 기본은 모두 넣기). 고른 트랙은 뺄 수 없다 */
  let excluded = $state<ReadonlySet<string>>(new Set());
  function toggleTrack(id: string, on: boolean) {
    const next = new Set(excluded);
    if (on) next.delete(id);
    else next.add(id);
    excluded = next;
  }
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
      },
      newId,
    );
  });

  // 미리 보기: 고른 음 구간의 결과 음을 작은 롤로 (트랙마다 색)
  const W = 400;
  const H = 120;
  const preview = $derived.by(() => {
    const from = picked.reduce<Rat>((m, n) => (cmp(n.start, m) < 0 ? n.start : m), picked[0]!.start);
    // 보이는 구간: 고른 음과, 고른 음 자리에서 시작한 결과 음이 끝나는 곳까지 (고른 음보다 긴 화음 음도 보이게)
    const head = Math.max(...picked.map((n) => toFloat(n.start) + toFloat(n.dur)));
    // 같은 악보 트랙 (바뀐 트랙은 결과로). 굴려 치기에서 그대로 둔 음도 보인다
    const changed = new Map(result.changes.map((c) => [c.trackId, c.notes]));
    const lanes = [...sameTracks.map((tr) => changed.get(tr.id) ?? tr.notes), ...result.newTracks];
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
      hue: (lane * 67) % 360,
    }));
  });

  const ok = $derived(result.notes > 0);
  function apply() {
    if (!ok) return;
    onapply(result);
    dialog.close();
  }

  const CHORD_LABEL = (id: string) => (id === "major" ? t("ui.arpChordMajor") : id === "minor" ? t("ui.arpChordMinor") : id);
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.arpeggio")}</h2>
  <div class="grid">
    <span>{t("ui.arpSource")}</span>
    <span class="row">
      {#each [["together", "ui.arpSourceTogether"], ["selected", "ui.arpSourceSelected"], ["chord", "ui.arpSourceChord"]] as const as [id, key] (id)}
        <label title={choice.style === "roll" && id !== "together" ? t("ui.arpRollTogether") : undefined}>
          <input type="radio" name="arp-source" checked={src === id} disabled={choice.style === "roll" && id !== "together"} onchange={() => set({ source: id })} />
          {t(key)}
        </label>
      {/each}
      {#if src === "chord"}
        <select aria-label={t("ui.arpChord")} value={choice.chord} onchange={(e) => set({ chord: e.currentTarget.value as ArpChoice["chord"] })}>
          {#each CHORD_KIND_IDS as id (id)}<option value={id}>{CHORD_LABEL(id)}</option>{/each}
        </select>
      {/if}
    </span>
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
      <label title={choice.source !== "together" ? t("ui.arpClearOff") : undefined}>
        <input type="checkbox" checked={choice.clear && choice.source === "together"} disabled={choice.source !== "together"} onchange={(e) => set({ clear: e.currentTarget.checked })} />
        {t("ui.arpClear")}
      </label>
    {/if}
  </div>
  {#if src === "together"}
    <div class="row tracks" role="group" aria-label={t("ui.arpTracks")}>
      <span>{t("ui.arpTracks")}</span>
      {#each sameTracks as tr, lane (tr.id)}
        <label>
          <input type="checkbox" checked={chordTracks.has(tr.id)} disabled={tr.id === trackId} onchange={(e) => toggleTrack(tr.id, e.currentTarget.checked)} />
          <span class="dot" style="background: hsl({(lane * 67) % 360} 65% 55%)"></span>{tr.name}
        </label>
      {/each}
    </div>
  {/if}
  <svg class="preview" viewBox="0 0 {W} {H}" role="img" aria-label={t("ui.arpPreview")}>
    {#if preview}
      {#each preview as r, i (i)}<rect x={r.x} y={r.y} width={r.w} height={r.h} rx="1.5" fill="hsl({r.hue} 65% 55%)" />{/each}
    {/if}
  </svg>
  <p class="muted">{t("ui.arpSummary", { notes: result.notes, tracks: result.newTracks.length, dropped: result.outOfRange })}</p>
  {#if result.single > 0}<p class="muted">{t("ui.arpSingle", { n: result.single })}</p>{/if}
  {#if result.lockedSkipped > 0}<p class="warn">{t("ui.arpLocked", { n: result.lockedSkipped })}</p>{/if}
  {#if result.trackLimit !== undefined}<p class="warn">{t("ui.arpTrackLimit", { n: result.trackLimit })}</p>{/if}
  {#if result.tooShort}<p class="warn">{t("ui.arpTooShort", { n: result.tooShort })}</p>{/if}
  {#if result.sequential}<p class="warn">{t("ui.arpSequential", { n: result.sequential })}</p>{/if}
  {#if result.cutCells && choice.style === "spread"}<p class="warn">{t("ui.arpSpreadBlocked", { n: result.cutCells })}</p>
  {:else if result.cutCells && result.cutCells > (result.sequential ?? 0)}<p class="warn">{t("ui.arpCutCells", { n: result.cutCells - (result.sequential ?? 0) })}</p>{/if}
  {#if !ok && !result.cutCells}<p class="warn">{t("ui.arpNothing")}</p>{/if}
  <footer>
    <span class="spacer"></span>
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
