<script lang="ts">
  import { trackInstrument, type Song } from "@mmlce/core";
  import { mmiLayout, type MmiLayoutEntry, type WriteMmiOptions } from "@mmlce/fileio";
  import { instrumentLabel, t } from "./i18n.svelte";
  import { mmiPrefs, setMmiExportQuick } from "./mmiPrefs.svelte";

  /**
   * 마비꼬(.mmi)로 저장. 마비꼬는 mml-track 하나가 악기 하나에 칸 3개(멜로디·화음1·화음2)와 노래 칸이라,
   * 게임 악보(화음 6개, 트랙마다 악기)와 묶는 방식이 다르다.
   * - 자동 묶기: 내보낼 트랙을 고르면 악보마다 악기·팬이 같은 트랙을 차례로 3개씩 묶는다 (미리보기)
   * - 직접 묶기: 마비꼬 트랙을 만들고 이름을 붙여, 트랙마다 어느 마비꼬 트랙의 어느 칸에 넣을지 고른다
   */
  interface Props {
    song: Song;
    onsave: (options: WriteMmiOptions) => void;
    onclose: () => void;
  }

  let { song, onsave, onclose }: Props = $props();

  interface Group {
    /** 화면 key (이름은 바꿀 수 있어서 따로 둔다) */
    key: number;
    name: string;
    parts: string[];
    song?: string | undefined;
  }

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let picked = $state<string[]>(song.tracks.map((tr) => tr.id));
  let manual = $state(false);
  let groups = $state<Group[]>([]);
  let nextKey = 1;
  $effect(() => {
    dialog.showModal();
  });

  const ordered = $derived(song.tracks.filter((tr) => picked.includes(tr.id)).map((tr) => tr.id));
  const layout = $derived(mmiLayout(song, ordered));
  const trackOf = (id: string) => song.tracks.find((tr) => tr.id === id);
  const nameOf = (id: string) => trackOf(id)?.name ?? id;
  const instrumentOf = (id: string) => {
    const track = trackOf(id);
    return track ? instrumentLabel(trackInstrument(song, track)) : "";
  };
  const allPicked = $derived(picked.length === song.tracks.length);
  const slotNames = $derived([t("ui.mmiMelody"), t("ui.mmiChord", { n: 1 }), t("ui.mmiChord", { n: 2 })]);
  /** 직접 묶기에서 마비꼬 트랙 하나는 악기·팬·보이기가 하나라, 첫 칸과 다른 트랙이 있으면 알린다 */
  const sameKey = (a: string, b: string) => {
    const x = trackOf(a);
    const y = trackOf(b);
    if (!x || !y) return true;
    return trackInstrument(song, x).program === trackInstrument(song, y).program && (x.mix?.pan ?? 64) === (y.mix?.pan ?? 64) && (x.mix?.visible ?? true) === (y.mix?.visible ?? true);
  };
  const mixed = (g: Group) => g.parts.some((id) => !sameKey(g.parts[0]!, id));
  const filled = $derived(groups.filter((g) => g.parts.length > 0 || g.song));

  function toggle(id: string, on: boolean) {
    picked = on ? [...picked.filter((x) => x !== id), id] : picked.filter((x) => x !== id);
  }

  /** 직접 묶기를 켜면 지금 자동으로 묶인 모양에서 시작한다 */
  function startManual() {
    groups = layout.map((e) => ({ key: nextKey++, name: e.name, parts: [...e.parts], song: e.song }));
    manual = true;
  }

  /** 트랙이 지금 들어 있는 자리 ("" = 넣지 않음, "k:p" = k번째 마비꼬 트랙의 멜로디·화음 칸, "k:s" = 노래 칸) */
  function placeOf(id: string): string {
    const k = groups.findIndex((g) => g.parts.includes(id) || g.song === id);
    if (k < 0) return "";
    return `${groups[k]!.key}:${groups[k]!.song === id ? "s" : "p"}`;
  }

  function place(id: string, where: string) {
    for (const g of groups) {
      g.parts = g.parts.filter((x) => x !== id);
      if (g.song === id) g.song = undefined;
    }
    if (where === "") return;
    const [key, slot] = where.split(":");
    const g = groups.find((x) => String(x.key) === key);
    if (!g) return;
    if (slot === "s") g.song = id;
    else if (g.parts.length < 3) g.parts = [...g.parts, id];
  }

  function addGroup() {
    groups = [...groups, { key: nextKey++, name: t("ui.mmiExportNewTrack", { n: groups.length + 1 }), parts: [] }];
  }

  function removeGroup(key: number) {
    groups = groups.filter((g) => g.key !== key);
  }

  function moveGroup(k: number, step: number) {
    const j = k + step;
    if (j < 0 || j >= groups.length) return;
    const next = [...groups];
    [next[k], next[j]] = [next[j]!, next[k]!];
    groups = next;
  }

  function movePart(g: Group, i: number, step: number) {
    const j = i + step;
    if (j < 0 || j >= g.parts.length) return;
    const next = [...g.parts];
    [next[i], next[j]] = [next[j]!, next[i]!];
    g.parts = next;
  }

  function save() {
    if (manual) {
      const out: MmiLayoutEntry[] = filled.map((g) => ({ name: g.name.trim() || t("ui.mmiExportNewTrack", { n: 1 }), parts: [...g.parts], ...(g.song ? { song: g.song } : {}) }));
      onsave({ layout: out });
    } else onsave({ trackIds: ordered });
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.mmiExportTitle")}</h2>
  <div class="modes" role="radiogroup">
    <label><input type="radio" name="mmi-mode" checked={!manual} onchange={() => (manual = false)} />{t("ui.mmiExportAuto")}</label>
    <label><input type="radio" name="mmi-mode" checked={manual} onchange={startManual} />{t("ui.mmiExportManual")}</label>
  </div>
  <p class="muted">{manual ? t("ui.mmiExportManualHelp") : t("ui.mmiExportHelp")}</p>

  {#if !manual}
    <label class="all">
      <input type="checkbox" checked={allPicked} onchange={(e) => (picked = e.currentTarget.checked ? song.tracks.map((tr) => tr.id) : [])} />
      {t("ui.selectAll")}
    </label>
  {/if}
  {#each song.players as player (player.id)}
    {@const own = song.tracks.filter((tr) => tr.playerId === player.id)}
    {#if own.length > 0}
      <fieldset>
        <legend>{player.name}</legend>
        {#each own as track (track.id)}
          {#if manual}
            <label class="row">
              <span class="grow">{track.name} <span class="muted">· {instrumentOf(track.id)}</span></span>
              <select value={placeOf(track.id)} onchange={(e) => place(track.id, e.currentTarget.value)} aria-label={t("ui.mmiExportWhere", { name: track.name })}>
                <option value="">{t("ui.mmiExportSkip")}</option>
                {#each groups as g (g.key)}
                  <option value={`${g.key}:p`} disabled={g.parts.length >= 3 && !g.parts.includes(track.id)}>{g.name}</option>
                  <option value={`${g.key}:s`} disabled={!!g.song && g.song !== track.id}>{g.name} · {t("ui.mmiSong")}</option>
                {/each}
              </select>
            </label>
          {:else}
            <label>
              <input type="checkbox" checked={picked.includes(track.id)} onchange={(e) => toggle(track.id, e.currentTarget.checked)} />
              {track.name} <span class="muted">· {instrumentOf(track.id)}</span>
            </label>
          {/if}
        {/each}
      </fieldset>
    {/if}
  {/each}

  {#if manual}
    <h3>{t("ui.mmiExportPreview", { count: filled.length })}</h3>
    <ol class="layout">
      {#each groups as g, k (g.key)}
        <li>
          <div class="head">
            <input class="name" bind:value={g.name} aria-label={t("ui.mmiExportName")} />
            <button class="small" disabled={k === 0} onclick={() => moveGroup(k, -1)} aria-label={t("ui.trackUp")}>↑</button>
            <button class="small" disabled={k === groups.length - 1} onclick={() => moveGroup(k, 1)} aria-label={t("ui.trackDown")}>↓</button>
            <button class="small" onclick={() => removeGroup(g.key)}>{t("ui.mmiExportRemove")}</button>
          </div>
          <span class="slots">
            {#each g.parts as id, j (id)}
              <span class="slot">
                {slotNames[j]}: {nameOf(id)}
                <button class="tiny" disabled={j === 0} onclick={() => movePart(g, j, -1)} aria-label={t("ui.trackUp")}>↑</button>
                <button class="tiny" disabled={j === g.parts.length - 1} onclick={() => movePart(g, j, 1)} aria-label={t("ui.trackDown")}>↓</button>
              </span>
            {/each}
            {#if g.song}<span class="slot">{t("ui.mmiSong")}: {nameOf(g.song)}</span>{/if}
            {#if g.parts.length === 0 && !g.song}<span class="muted">{t("ui.mmiExportEmpty")}</span>{/if}
          </span>
          {#if mixed(g)}<p class="warn">{t("ui.mmiExportMixed")}</p>{/if}
        </li>
      {/each}
    </ol>
    <button onclick={addGroup}>{t("ui.mmiExportAdd")}</button>
  {:else}
    <h3>{t("ui.mmiExportPreview", { count: layout.length })}</h3>
    {#if layout.length === 0}
      <p class="muted">{t("ui.mmiExportNone")}</p>
    {:else}
      <ol class="layout">
        {#each layout as entry, k (k)}
          <li>
            <strong>{entry.name}</strong>
            <span class="slots">
              {#each entry.parts as id, j (id)}<span>{slotNames[j]}: {nameOf(id)}</span>{/each}
              {#if entry.song}<span>{t("ui.mmiSong")}: {nameOf(entry.song)}</span>{/if}
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  {/if}
  <label class="quick">
    <input type="checkbox" checked={mmiPrefs.exportQuick} onchange={(e) => setMmiExportQuick(e.currentTarget.checked)} />
    {t("ui.mmiQuickNext")}
  </label>
  <div class="actions">
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={manual ? filled.length === 0 : ordered.length === 0} onclick={save}>{t("ui.saveMmi")}</button>
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
  .modes {
    display: flex;
    gap: 16px;
    margin: 4px 0;
  }
  fieldset {
    border: 1px solid var(--line);
    border-radius: 6px;
    margin: 6px 0;
    padding: 4px 8px;
  }
  label {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 2px 0;
  }
  .row .grow {
    flex: 1;
    min-width: 0;
  }
  .row select {
    max-width: 50%;
  }
  .all {
    margin-top: 6px;
  }
  .layout {
    margin: 0 0 8px;
    padding-left: 20px;
  }
  .layout li {
    margin: 6px 0;
  }
  .head {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .slots {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    font-size: 0.9em;
  }
  .slot {
    display: inline-flex;
    gap: 2px;
    align-items: center;
  }
  .small {
    padding: 2px 8px;
  }
  .tiny {
    padding: 0 4px;
    font-size: 0.8em;
  }
  .warn {
    margin: 2px 0 0;
    color: var(--warn, #b7791f);
    font-size: 0.85em;
  }
  .quick {
    margin-top: 10px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
