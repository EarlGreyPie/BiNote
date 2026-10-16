<script lang="ts">
  import type { Song, Track } from "@mmlce/core";
  import type { Diagnostic } from "@mmlce/mml";
  import type { Snippet } from "svelte";
  import { t } from "./i18n.svelte";
  import Menu, { type MenuItem } from "./Menu.svelte";
  import MmlKeyPad from "./MmlKeyPad.svelte";
  import StructureList from "./StructureList.svelte";
  import TrackEditor from "./TrackEditor.svelte";
  import TrackStrip from "./TrackStrip.svelte";
  import { mmlPad } from "./mmlPad.svelte";
  import type { ScoreGroup } from "./scores";
  import type { TrackActions } from "./trackActions";

  /**
   * 트랙 패널. 옆 배치: 머리 · 구조 목록 · 편집기 하나. 아래 배치: 트랙 띠 · 편집기 하나.
   * 세로 화면에서는 머리의 [구조 | MML]로 목록과 편집기 중 하나만 보인다.
   */
  interface Props {
    song: Song;
    groups: readonly ScoreGroup[];
    /** 트랙 → 글·검사 */
    tracks: readonly { track: Track; text: string; diagnostics: readonly Diagnostic[] }[];
    colors: ReadonlyMap<string, string>;
    activeTrackId: string | undefined;
    fileName: string;
    charLimit: number;
    dock: "right" | "bottom";
    portrait: boolean;
    trackInstrument: (track: Track) => string;
    actions: TrackActions;
    reveal: { trackId: string; from: number; to: number; focus: boolean; nonce: number } | undefined;
    /** 재생 중 지금 울리는 음의 글 자리 (고른 트랙) */
    playing?: readonly [number, number] | undefined;
    follow?: boolean;
    moreItems: readonly MenuItem[];
    onedit: (trackId: string, text: string) => void;
    onundo: () => void;
    onredo: () => void;
    ongodiag: (trackId: string, from: number, to: number) => void;
    /** 편집기 둘 나란히: 아래 편집기에 연 트랙 (없으면 편집기 하나) */
    secondTrackId?: string | undefined;
    playingSecond?: readonly [number, number] | undefined;
    onclosesecond?: () => void;
    /** 머리 위에 끼우는 것 (악보책 나누기 결과 등) */
    top?: Snippet | undefined;
  }

  let { song, groups, tracks, colors, activeTrackId, fileName, charLimit, dock, portrait, trackInstrument, actions, reveal, playing, follow = false, moreItems, onedit, onundo, onredo, ongodiag, secondTrackId, playingSecond, onclosesecond, top }: Props = $props();

  let portraitView = $state<"structure" | "mml">("structure");
  // 세로 화면에서 롤의 음을 두 번 눌러(또는 검사로) 글 자리로 가라고 하면 편집기 쪽을 보여 준다
  $effect(() => {
    if (portrait && reveal?.focus) portraitView = "mml";
  });
  const chars = $derived(new Map(tracks.map((a) => [a.track.id, a.text.length])));
  const active = $derived(tracks.find((a) => a.track.id === activeTrackId));
  /** 악보 안에서 몇 번째 트랙인지 (1부터) */
  function indexOf(id: string | undefined): number {
    const g = groups.find((x) => id !== undefined && x.trackIds.includes(id));
    return (g?.trackIds.indexOf(id!) ?? 0) + 1;
  }
  const activeIndex = $derived(indexOf(activeTrackId));
  const second = $derived(secondTrackId === undefined ? undefined : tracks.find((a) => a.track.id === secondTrackId));
  const showStructure = $derived(!portrait || portraitView === "structure");
  const showEditor = $derived(!portrait || portraitView === "mml");
</script>

<div class="track-pane" class:bottom={dock === "bottom" && !portrait}>
  {@render top?.()}
  {#if dock === "bottom" && !portrait}
    <TrackStrip {song} {groups} {chars} {colors} {activeTrackId} {charLimit} {trackInstrument} {actions} />
  {:else}
    <div class="pane-head">
      {#if portrait}
        <span class="seg">
          <button class:on={portraitView === "structure"} onclick={() => (portraitView = "structure")}>{t("ui.paneStructure")}</button>
          <button class:on={portraitView === "mml"} onclick={() => (portraitView = "mml")}>{t("ui.paneMml")}</button>
        </span>
      {/if}
      <strong class="file" title={fileName}>{fileName || t("ui.tracks")}</strong>
      <span class="muted">{t("ui.paneCounts", { scores: groups.length, tracks: song.tracks.length })}</span>
      <span class="spacer"></span>
      <Menu icon="ellipsis" title={t("ui.more")} align="right" items={moreItems} />
    </div>
    {#if showStructure}
      <div class="structure" class:full={portrait}>
        <StructureList {song} {groups} {chars} {colors} {activeTrackId} {charLimit} {trackInstrument} {actions} />
      </div>
    {/if}
  {/if}
  {#if showEditor || (dock === "bottom" && !portrait)}
    {#if active}
      <TrackEditor
        track={active.track}
        index={activeIndex}
        text={active.text}
        diagnostics={active.diagnostics}
        color={colors.get(active.track.id) ?? active.track.color}
        instrument={trackInstrument(active.track)}
        {charLimit}
        showListen={dock === "bottom" && !portrait}
        reveal={reveal?.trackId === active.track.id ? reveal : undefined}
        {playing}
        {follow}
        oninstrument={(canonical) => actions.trackInstrument(active.track.id, canonical)}
        onlisten={(change) => actions.listen(active.track.id, change)}
        {onedit}
        {onundo}
        {onredo}
        ongodiag={(from, to) => ongodiag(active.track.id, from, to)}
        onrename={(name) => actions.renameTrack(active.track.id, name)}
        locked={actions.viewOf(active.track.id).locked === true}
        onlock={(on) => actions.view(active.track.id, { locked: on })}
      />
      {#if second}
        <div class="second">
          <TrackEditor
            track={second.track}
            index={indexOf(second.track.id)}
            text={second.text}
            diagnostics={second.diagnostics}
            color={colors.get(second.track.id) ?? second.track.color}
            instrument={trackInstrument(second.track)}
            {charLimit}
            showListen={true}
            reveal={reveal?.trackId === second.track.id ? reveal : undefined}
            playing={playingSecond}
            {follow}
            oninstrument={(canonical) => actions.trackInstrument(second.track.id, canonical)}
            onlisten={(change) => actions.listen(second.track.id, change)}
            {onedit}
            {onundo}
            {onredo}
            ongodiag={(from, to) => ongodiag(second.track.id, from, to)}
            onrename={(name) => actions.renameTrack(second.track.id, name)}
            locked={actions.viewOf(second.track.id).locked === true}
            onlock={(on) => actions.view(second.track.id, { locked: on })}
            onclose={onclosesecond}
          />
        </div>
      {/if}
    {:else}
      <p class="muted none">{t("ui.noTrackSelected")}</p>
    {/if}
  {/if}
  {#if mmlPad.enabled}<MmlKeyPad />{/if}
</div>

<style>
  /* 아래 편집기: 위 편집기와 높이를 반씩 나눈다 */
  .second {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
    border-top: 2px solid var(--line);
  }
  .track-pane {
    display: flex;
    flex-direction: column;
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
    /* 글은 골라서 복사할 수 있게 */
    user-select: text;
    -webkit-user-select: text;
  }
  .pane-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: 36px;
    padding: 0 8px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  .file {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .structure {
    flex: none;
    max-height: 45%;
    overflow: auto;
    border-bottom: 1px solid var(--line);
  }
  .structure.full {
    flex: 1 1 0;
    max-height: none;
    min-height: 0;
    border-bottom: none;
  }
  .none {
    padding: 8px 12px;
  }
</style>
