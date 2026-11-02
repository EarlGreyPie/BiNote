<script lang="ts">
  import { trackInstrument, type Song } from "@mmlce/core";
  import { mmiLayout } from "@mmlce/fileio";
  import { instrumentLabel, t } from "./i18n.svelte";

  /**
   * 마비꼬(.mmi)로 저장: 내보낼 트랙을 고르고, 마비꼬 mml-track(멜로디·화음1·화음2·노래)으로 어떻게 묶이는지 미리 본다.
   * 마비꼬는 mml-track 하나가 악기 하나에 칸 3개라, 게임 악보(화음 6개, 트랙마다 악기)와 묶는 방식이 다르다
   */
  interface Props {
    song: Song;
    onsave: (trackIds: string[]) => void;
    onclose: () => void;
  }

  let { song, onsave, onclose }: Props = $props();

  let dialog: HTMLDialogElement;
  // svelte-ignore state_referenced_locally
  let picked = $state<string[]>(song.tracks.map((tr) => tr.id));
  $effect(() => {
    dialog.showModal();
  });

  const ordered = $derived(song.tracks.filter((tr) => picked.includes(tr.id)).map((tr) => tr.id));
  const layout = $derived(mmiLayout(song, ordered));
  const nameOf = (id: string) => song.tracks.find((tr) => tr.id === id)?.name ?? id;
  const allPicked = $derived(picked.length === song.tracks.length);
  const slotNames = $derived([t("ui.mmiMelody"), t("ui.mmiChord", { n: 1 }), t("ui.mmiChord", { n: 2 })]);

  function toggle(id: string, on: boolean) {
    picked = on ? [...picked.filter((x) => x !== id), id] : picked.filter((x) => x !== id);
  }

  function save() {
    onsave(ordered);
    dialog.close();
  }
</script>

<dialog bind:this={dialog} {onclose}>
  <h2>{t("ui.mmiExportTitle")}</h2>
  <p class="muted">{t("ui.mmiExportHelp")}</p>
  <label class="all">
    <input type="checkbox" checked={allPicked} onchange={(e) => (picked = e.currentTarget.checked ? song.tracks.map((tr) => tr.id) : [])} />
    {t("ui.selectAll")}
  </label>
  {#each song.players as player (player.id)}
    {@const own = song.tracks.filter((tr) => tr.playerId === player.id)}
    {#if own.length > 0}
      <fieldset>
        <legend>{player.name}</legend>
        {#each own as track (track.id)}
          <label>
            <input type="checkbox" checked={picked.includes(track.id)} onchange={(e) => toggle(track.id, e.currentTarget.checked)} />
            {track.name} <span class="muted">· {instrumentLabel(trackInstrument(song, track))}</span>
          </label>
        {/each}
      </fieldset>
    {/if}
  {/each}

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
  <div class="actions">
    <button onclick={() => dialog.close()}>{t("ui.cancel")}</button>
    <button class="primary" disabled={ordered.length === 0} onclick={save}>{t("ui.saveMmi")}</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(460px, calc(100vw - 32px));
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
  .all {
    margin-top: 6px;
  }
  .layout {
    margin: 0;
    padding-left: 20px;
  }
  .layout li {
    margin: 4px 0;
  }
  .slots {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    font-size: 0.9em;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
