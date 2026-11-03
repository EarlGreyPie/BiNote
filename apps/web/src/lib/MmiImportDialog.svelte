<script lang="ts">
  import { trackInstrument, type Song } from "@mmlce/core";
  import { recommendedMmiGroups, type MmiScoreGroup } from "@mmlce/fileio";
  import { findOffgrid } from "@mmlce/mml";
  import { instrumentLabel, t } from "./i18n.svelte";
  import { mmiPrefs, setMmiImportQuick } from "./mmiPrefs.svelte";

  /**
   * 마비꼬(.mmi) 가져오기: 마비꼬 트랙(멜로디·화음1·화음2·노래 칸)마다 어느 BiNote 악보에 넣을지 고른다 (저장 창의 거꾸로).
   * 처음 모양은 권장 설정(차례로 화음 수까지 악보 하나로 모으기, 노래 칸은 따로)이다
   */
  interface Props {
    /** readMmi로 읽은 곡 (마비꼬 트랙 하나 = 연주자 하나) */
    song: Song;
    /** 악보 하나에 담는 화음 수 (프로필 기본) */
    chords: number;
    /** 악보 악기별 화음 수 (오르골 등) */
    chordsOf: (instrument: string) => number;
    onopen: (groups: MmiScoreGroup[]) => void;
    onclose: () => void;
  }

  let { song, chords, chordsOf, onopen, onclose }: Props = $props();

  interface Score {
    key: number;
    name: string;
  }

  let dialog: HTMLDialogElement;
  let nextKey = 1;
  // svelte-ignore state_referenced_locally
  const start = recommendedMmiGroups(song, chordsOf);
  let scores = $state<Score[]>(start.map((g) => ({ key: nextKey++, name: g.name })));
  /** 마비꼬 트랙(연주자 id)마다 넣을 악보 key. 0 = 가져오지 않음 */
  // svelte-ignore state_referenced_locally
  let target = $state<Record<string, number>>(Object.fromEntries(start.flatMap((g, k) => g.players.map((id) => [id, scores[k]!.key]))));
  $effect(() => {
    dialog.showModal();
  });

  // svelte-ignore state_referenced_locally
  const sources = song.players.filter((p) => song.tracks.some((tr) => tr.playerId === p.id));
  const tracksOf = (id: string) => song.tracks.filter((tr) => tr.playerId === id);
  /** 마비꼬 트랙마다 어긋난 길이(어긋난 길이 찾기 후보) 수. 고치기는 열고 나서 어긋난 길이 창에서 한다 (롤에서 보고 듣고 되돌릴 수 있게) */
  // svelte-ignore state_referenced_locally
  const offgridOf: Record<string, number> = (() => {
    const playerOf = new Map(song.tracks.map((tr) => [tr.id, tr.playerId]));
    const out: Record<string, number> = {};
    for (const f of findOffgrid(song)) {
      const id = playerOf.get(f.trackId);
      if (id) out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  })();
  const offgridTotal = Object.values(offgridOf).reduce((a, b) => a + b, 0);
  const countIn = (key: number) => sources.filter((p) => target[p.id] === key).reduce((sum, p) => sum + tracksOf(p.id).length, 0);
  const used = $derived(scores.filter((s) => countIn(s.key) > 0));
  /** 악보 화음 수: 그 악보 첫 마비꼬 트랙(악보 악기)의 악기로 */
  const limitOf = (key: number) => {
    const first = sources.find((p) => target[p.id] === key);
    return first ? chordsOf(first.instrument.canonical) : chords;
  };

  function addScore() {
    scores = [...scores, { key: nextKey++, name: t("ui.scoreN", { n: scores.length + 1 }) }];
  }

  function removeScore(key: number) {
    scores = scores.filter((s) => s.key !== key);
    for (const id of Object.keys(target)) if (target[id] === key) target[id] = 0;
  }

  function recommended() {
    const groups = recommendedMmiGroups(song, chordsOf);
    scores = groups.map((g) => ({ key: nextKey++, name: g.name }));
    target = Object.fromEntries(groups.flatMap((g, k) => g.players.map((id) => [id, scores[k]!.key])));
  }

  function open() {
    // 악보 차례대로, 그 안은 마비꼬 트랙 차례대로
    const groups: MmiScoreGroup[] = scores.map((s) => ({ name: s.name, players: sources.filter((p) => target[p.id] === s.key).map((p) => p.id) })).filter((g) => g.players.length > 0);
    onopen(groups);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.mmiImportTitle")}</h2>
  <p class="muted">{t("ui.mmiImportHelp", { n: chords })}</p>
  <ol class="sources">
    {#each sources as player (player.id)}
      <li>
        <div class="row">
          <strong class="grow"
            >{player.name} <span class="muted">· {instrumentLabel(player.instrument)}</span>{#if offgridOf[player.id]}<span class="warn offgrid"> · {t("ui.mmiImportOffgrid", { n: offgridOf[player.id]! })}</span>{/if}</strong
          >
          <select bind:value={target[player.id]} aria-label={t("ui.mmiImportWhere", { name: player.name })}>
            <option value={0}>{t("ui.mmiExportSkip")}</option>
            {#each scores as s (s.key)}<option value={s.key}>{s.name}</option>{/each}
          </select>
        </div>
        <span class="parts muted">
          {#each tracksOf(player.id) as track (track.id)}<span>{track.name}{track.instrument ? ` (${instrumentLabel(trackInstrument(song, track))})` : ""}</span>{/each}
        </span>
      </li>
    {/each}
  </ol>
  {#if offgridTotal > 0}<p class="warn">{t("ui.mmiImportOffgridHelp", { n: offgridTotal })}</p>{/if}

  <h3>{t("ui.mmiImportScores", { count: used.length })}</h3>
  <ul class="scores">
    {#each scores as s (s.key)}
      {@const n = countIn(s.key)}
      {@const max = limitOf(s.key)}
      <li>
        <input class="grow" bind:value={s.name} aria-label={t("ui.mmiImportScoreName")} />
        <span class:warn={n > max}>{t("ui.mmiImportCount", { n, max })}</span>
        <button class="small" onclick={() => removeScore(s.key)}>{t("ui.mmiExportRemove")}</button>
      </li>
    {/each}
  </ul>
  {#if used.some((s) => countIn(s.key) > limitOf(s.key))}<p class="warn">{t("ui.mmiImportOver")}</p>{/if}
  <div class="tools">
    <button onclick={addScore}>{t("ui.mmiImportAdd")}</button>
    <button onclick={recommended}>{t("ui.mmiImportRecommended")}</button>
  </div>
  <label class="quick">
    <input type="checkbox" checked={mmiPrefs.importQuick} onchange={(e) => setMmiImportQuick(e.currentTarget.checked)} />
    {t("ui.mmiQuickNext")}
  </label>
  <div class="actions">
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={used.length === 0} onclick={open}>{t("ui.mmiImportOpen")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
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
    margin: 0 0 4px;
    font-size: 1.05rem;
  }
  h3 {
    margin: 12px 0 4px;
    font-size: 0.95rem;
  }
  ol,
  ul {
    margin: 0;
    padding-left: 20px;
  }
  li {
    margin: 4px 0;
  }
  .row,
  .scores li {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .parts {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    font-size: 0.85em;
  }
  .small {
    padding: 2px 8px;
  }
  .tools {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .quick {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-top: 10px;
  }
  .offgrid {
    font-weight: normal;
    font-size: 0.9em;
  }
  .warn {
    color: var(--warn, #b7791f);
  }
  p.warn {
    margin: 4px 0 0;
    font-size: 0.85em;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
