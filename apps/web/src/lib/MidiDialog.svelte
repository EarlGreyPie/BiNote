<script lang="ts">
  import { INSTRUMENTS, type GameProfile, type Song } from "@mmlce/core";
  import {
    allocateChords,
    GRID_CHOICES,
    instrumentRef,
    midiToSong,
    suggestPlan,
    type CompressPreset,
    type ImportPlan,
    type ImportResult,
    type MidiAnalysis,
    type MusicXmlReport,
  } from "@mmlce/midi";
  import type { MessageKey } from "@mmlce/i18n";
  import { optimizeMml } from "@mmlce/mml";
  import { instrumentName, t } from "./i18n.svelte";
  import { chordPrefs, setMidiMerge } from "./chordPrefs.svelte";

  interface Props {
    analysis: MidiAnalysis;
    name: string;
    /** MusicXML에서 읽은 파트면 그 보고 (칸 맞추기 대신 적힌 길이 그대로, 화음 감쇠를 고를 수 있다) */
    musicXml?: MusicXmlReport | undefined;
    profile: GameProfile;
    onimport: (song: Song) => void;
    onclose: () => void;
  }

  let { analysis, name, musicXml, profile, onimport, onclose }: Props = $props();

  interface PlayerRow {
    key: string;
    name: string;
    canonical: string;
    chords: number;
    preset: CompressPreset;
    dropFirst: "both" | "right" | "left";
    /** 빼지 않을 파트 id ("" = 없음) */
    protect: string;
  }

  const DRUMS = new Set(["bass-drum", "cymbal"]);
  const BUDGETS = [3, 6, 12, 18, 24];
  const PRESETS: CompressPreset[] = ["outer", "top", "bottom", "strong", "long"];

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  const suggested = suggestPlan(analysis, profile);
  const melodic = suggested.players.filter((p) => !DRUMS.has(p.instrument.canonical)).length;
  let budget = $state(melodic > 1 ? 12 : 6);
  // 처음 화음 수는 곡 전체 예산을 나눈 값
  // svelte-ignore state_referenced_locally
  const initial = allocateChords(analysis, suggested, budget, profile);
  let players = $state<PlayerRow[]>(
    initial.players.map((p, k) => ({
      key: `k${k}`,
      name: DRUMS.has(p.instrument.canonical) ? instrumentName(p.instrument.canonical) : p.name,
      canonical: p.instrument.canonical,
      chords: p.chords,
      preset: "outer",
      dropFirst: "both",
      protect: "",
    })),
  );
  /** 파트 → 연주자 key ("" = 빼기). 드럼 파트는 "drums"면 타악기 연주자 모두에게 */
  // svelte-ignore state_referenced_locally
  let assign = $state<Record<string, string>>(
    Object.fromEntries(
      analysis.parts.map((part) => [
        part.id,
        part.drum ? "drums" : `k${initial.players.findIndex((p) => p.parts.includes(part.id))}`,
      ]),
    ),
  );
  let grid = $state<number | "auto">("auto");
  let triplets = $state(true);
  let straighten = $state(false);
  let fill = $state(true);
  // BiNote가 내보낸 MusicXML은 v가 이미 감쇠된 값이라 처음부터 끈다
  // svelte-ignore state_referenced_locally
  let attenuate = $state(!musicXml?.fromBiNote);

  $effect(() => {
    dialog.showModal();
  });
  // 셋잇단을 끄면 곧게 맞추기도 푼다 (셋잇단 박이 없으니 할 일이 없다)
  $effect(() => {
    if (!triplets) straighten = false;
  });

  function validChords(n: unknown): number {
    return typeof n === "number" && Number.isFinite(n) ? Math.min(profile.maxChordsPerPlayer * 2, Math.max(1, Math.floor(n))) : 1;
  }

  function plan(): ImportPlan {
    return {
      players: players.map((p) => ({
        name: p.name,
        instrument: instrumentRef(p.canonical),
        parts: analysis.parts
          .filter((part) => (part.drum ? DRUMS.has(p.canonical) && assign[part.id] === "drums" : assign[part.id] === p.key))
          .map((part) => part.id),
        // 입력 중 빈 칸·0은 1로 본다 (미리보기가 깨지지 않게)
        chords: validChords(p.chords),
        preset: p.preset,
        dropFirst: p.dropFirst,
        ...(p.protect ? { protect: [p.protect] } : {}),
      })),
      quantize: musicXml ? { exact: true } : { grid, triplets, straighten: triplets && straighten },
      fill,
      merge: chordPrefs.merge,
      ...(musicXml ? { attenuate } : {}),
    };
  }

  /** 곡 전체 예산으로 연주자마다 화음 수를 다시 나눈다 */
  function rebalance() {
    const next = allocateChords(analysis, plan(), budget, profile);
    players = players.map((p, k) => ({ ...p, chords: next.players[k]!.chords }));
  }

  function addPlayer() {
    players = [...players, { key: `k${Date.now()}`, name: t("ui.midiNewPlayer", { n: players.length + 1 }), canonical: "piano", chords: 3, preset: "outer", dropFirst: "both", protect: "" }];
  }

  const total = $derived(players.filter((p) => analysis.parts.some((part) => assign[part.id] === p.key) || (DRUMS.has(p.canonical) && analysis.parts.some((part) => part.drum && assign[part.id] === "drums"))).reduce((s, p) => s + validChords(p.chords), 0));

  // 미리보기: 설정이 바뀔 때마다 다시 만든다
  // 만들다 실패하면(아주 큰 곡에서 메모리 등) 창을 깨뜨리지 않고 알린다
  const preview = $derived.by((): { result: ImportResult; maxChars: number } | undefined => {
    const p = plan();
    if (p.players.every((x) => x.parts.length === 0)) return undefined;
    try {
      const result = midiToSong(analysis, p, profile, musicXml?.title || name);
      const maxChars = result.song.tracks.reduce((m, tr) => Math.max(m, optimizeMml(tr.notes).text.length), 0);
      return { result, maxChars };
    } catch (e) {
      console.error(e);
      return undefined;
    }
  });
  const previewFailed = $derived(!preview && !plan().players.every((x) => x.parts.length === 0));

  const partsOf = (key: string) => analysis.parts.filter((part) => !part.drum && assign[part.id] === key);
  const pitch = (p: number) => `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][p % 12]}${Math.floor(p / 12) - 1}`;

  function finish() {
    if (!preview) return;
    const song = preview.result.song;
    // MusicXML 작곡자는 곡 정보로 (내보내기의 creator와 짝)
    onimport(musicXml?.composer ? { ...song, meta: { ...song.meta, author: musicXml.composer } } : song);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <header>
    <h2>{t(musicXml ? "ui.musicXmlImport" : "ui.midiImport")}</h2>
    <span class="muted">{name}</span>
    <span class="spacer"></span>
    <button class="small" onclick={() => dialog.close()}>{t("ui.close")}</button>
  </header>
  <p class="muted">{t(musicXml ? "ui.musicXmlHelp" : "ui.midiHelp")}</p>

  <section class="row">
    <label>
      {t("ui.midiBudget")}
      <select bind:value={budget} onchange={rebalance}>
        {#each BUDGETS as b (b)}<option value={b}>{b}</option>{/each}
      </select>
    </label>
    <span class={total > budget ? "warn" : "muted"}>{t("ui.midiTotal", { count: total })}</span>
    {#if musicXml}
      <label title={t("ui.musicXmlAttenuateHelp")}><input type="checkbox" bind:checked={attenuate} /> {t("ui.musicXmlAttenuate")}</label>
    {:else}
      <label>
        {t("ui.midiGrid")}
        <select bind:value={grid}>
          <option value="auto">{t("ui.midiGridAuto")}</option>
          {#each GRID_CHOICES as g (g)}<option value={g}>{t("ui.midiGridNote", { n: g })}</option>{/each}
        </select>
      </label>
      <label><input type="checkbox" bind:checked={triplets} /> {t("ui.midiTriplets")}</label>
      <label title={t("ui.midiStraightenHelp")}><input type="checkbox" bind:checked={straighten} disabled={!triplets} /> {t("ui.midiStraighten")}</label>
    {/if}
    <label title={t("ui.midiFillHelp")}><input type="checkbox" bind:checked={fill} /> {t("ui.midiFill")}</label>
    <label title={t("ui.mergeHelp")}><input type="checkbox" checked={chordPrefs.merge} onchange={(e) => setMidiMerge(e.currentTarget.checked)} /> {t("ui.merge")}</label>
  </section>

  <h3>{t(musicXml ? "ui.musicXmlParts" : "ui.midiParts")}</h3>
  <table>
    <thead>
      <tr>
        <th>{t("ui.midiPart")}</th>
        <th>{t("ui.midiNotes")}</th>
        <th>{t("ui.midiRange")}</th>
        <th>{t("ui.midiPoly")}</th>
        <th>{t("ui.midiTo")}</th>
      </tr>
    </thead>
    <tbody>
      {#each analysis.parts as part (part.id)}
        <tr>
          <td>
            {part.name} <span class="muted">{musicXml ? "" : `ch${part.channel + 1} `}{part.drum ? t("ui.midiDrum") : `#${part.program}`}</span>
            {#if !part.drum && !part.suggestion.matched}<span class="warn" title={t("ui.midiNoMatchHelp")}>{t("ui.midiNoMatch")}</span>{/if}
          </td>
          <td>{part.notes.length}</td>
          <td>{pitch(part.low)}–{pitch(part.high)}</td>
          <td>{part.polyphony}</td>
          <td>
            <select bind:value={assign[part.id]}>
              <option value="">{t("ui.midiSkip")}</option>
              {#if part.drum}
                <option value="drums">{t("ui.midiToDrums")}</option>
              {:else}
                {#each players.filter((p) => !DRUMS.has(p.canonical)) as p (p.key)}<option value={p.key}>{p.name}</option>{/each}
              {/if}
            </select>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <h3>{t("ui.midiPlayers")} <button class="small" onclick={addPlayer}>+ {t("ui.midiAddPlayer")}</button></h3>
  <table>
    <thead>
      <tr>
        <th>{t("ui.midiPlayer")}</th>
        <th>{t("ui.pasteInstrument")}</th>
        <th>{t("ui.midiChords")}</th>
        <th>{t("ui.midiPreset")}</th>
        <th>{t("ui.midiProtect")}</th>
      </tr>
    </thead>
    <tbody>
      {#each players as p, k (p.key)}
        {@const result = preview?.result.compressed.find((c) => c.plan === k)}
        <tr>
          <td><input class="name" bind:value={p.name} /></td>
          <td>
            <select bind:value={p.canonical}>
              {#each INSTRUMENTS as info (info.id)}<option value={info.id}>{instrumentName(info.id)}</option>{/each}
            </select>
          </td>
          <td>
            <input type="number" min="1" max={profile.maxChordsPerPlayer * 2} bind:value={p.chords} />
            {#if p.chords > profile.maxChordsPerPlayer}<span class="muted">{t("ui.midiSplitPlayers")}</span>{/if}
          </td>
          <td>
            {#if DRUMS.has(p.canonical)}
              <span class="muted">—</span>
            {:else}
              <select bind:value={p.preset}>
                {#each PRESETS as preset (preset)}<option value={preset}>{t(`ui.midiPreset.${preset}` as MessageKey)}</option>{/each}
              </select>
              {#if p.preset === "outer"}
                <select bind:value={p.dropFirst} title={t("ui.midiDropFirst")}>
                  <option value="both">{t("ui.midiDropBoth")}</option>
                  <option value="right">{t("ui.midiDropRight")}</option>
                  <option value="left">{t("ui.midiDropLeft")}</option>
                </select>
              {/if}
            {/if}
          </td>
          <td>
            {#if !DRUMS.has(p.canonical)}
              <select bind:value={p.protect}>
                <option value="">{t("ui.midiProtectNone")}</option>
                {#each partsOf(p.key) as part (part.id)}<option value={part.id}>{part.name}{musicXml ? "" : ` ch${part.channel + 1}`}</option>{/each}
              </select>
            {/if}
            {#if result && (result.dropped > 0 || result.filled > 0)}
              <span class="muted">{t("ui.midiDropped", { dropped: result.dropped, filled: result.filled })}</span>
            {/if}
            {#if result && result.merged > 0}
              <span class="muted">{t("ui.midiMerged", { count: result.merged })}</span>
            {/if}
            {#if partsOf(p.key).length === 0 && !DRUMS.has(p.canonical)}
              <button class="small" onclick={() => (players = players.filter((_, i) => i !== k))}>{t("ui.remove")}</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <footer>
    {#if previewFailed}<span class="warn">{t("ui.midiBuildFailed")}</span>{/if}
    {#if preview}
      <span class="muted">
        {#if musicXml}
          {t("ui.musicXmlSummary", { tracks: preview.result.song.tracks.length })}
        {:else}
          {t("ui.midiSummary", { grid: preview.result.grid, triplets: preview.result.tripletBeats, tracks: preview.result.song.tracks.length })}
        {/if}
      </span>
      <span class={preview.maxChars > profile.charLimitPerScore ? "warn" : "muted"}>
        {t("ui.midiMaxChars", { count: preview.maxChars, limit: profile.charLimitPerScore })}
      </span>
      {#if preview.result.unmappedDrums > 0}<span class="warn">{t("ui.midiUnmappedDrums", { count: preview.result.unmappedDrums })}</span>{/if}
      {#if preview.result.merged > 0}<span class="warn">{t("ui.midiCollapsed", { count: preview.result.merged })}</span>{/if}
    {/if}
    {#if musicXml}
      {#if musicXml.grace > 0}<span class="warn">{t("ui.musicXmlGrace", { count: musicXml.grace })}</span>{/if}
      {#if musicXml.cue > 0}<span class="muted">{t("ui.musicXmlCue", { count: musicXml.cue })}</span>{/if}
      {#if musicXml.repeats > 0}<span class="warn">{t("ui.musicXmlRepeats", { count: musicXml.repeats })}</span>{/if}
      {#if musicXml.silent > 0}<span class="muted">{t("ui.musicXmlSilent", { count: musicXml.silent })}</span>{/if}
      {#if preview?.result.folded}<span class="warn">{t("ui.musicXmlFolded", { count: preview.result.folded })}</span>{/if}
      {#if musicXml.microtones > 0}<span class="warn">{t("ui.musicXmlMicrotones", { count: musicXml.microtones })}</span>{/if}
      {#if preview?.result.fitted}<span class="warn">{t("ui.musicXmlFitted", { count: preview.result.fitted })}</span>{/if}
      {#if preview?.result.tempoFixed?.clamped}<span class="warn">{t("ui.musicXmlTempoClamped", { count: preview.result.tempoFixed.clamped, min: profile.tempo.min, max: profile.tempo.max })}</span>{/if}
      {#if preview?.result.tempoFixed?.rounded}<span class="muted">{t("ui.musicXmlTempoRounded", { count: preview.result.tempoFixed.rounded })}</span>{/if}
      {#if musicXml.tabStrings > 0}<span class="muted">{t("ui.musicXmlTabs", { count: musicXml.tabStrings })}</span>{/if}
    {/if}
    <span class="spacer"></span>
    <button onclick={finish} disabled={!preview}>{t("ui.midiDoImport")}</button>
  </footer>
</dialog>

<style>
  dialog {
    width: min(920px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  header,
  footer,
  .row {
    display: flex;
    align-items: center;
    gap: 8px 12px;
    flex-wrap: wrap;
  }
  footer {
    margin-top: 10px;
  }
  h2 {
    margin: 0;
    font-size: 1.05rem;
  }
  h3 {
    margin: 12px 0 4px;
    font-size: 0.95rem;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .spacer {
    flex: 1;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th {
    text-align: left;
    font-weight: 600;
    padding: 4px 8px 4px 0;
    border-bottom: 1px solid var(--line);
  }
  td {
    padding: 3px 8px 3px 0;
    vertical-align: middle;
  }
  input[type="number"] {
    width: 4em;
  }
  input.name {
    width: 12em;
  }
  .warn {
    color: var(--danger);
  }
</style>
